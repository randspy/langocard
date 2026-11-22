#!/usr/bin/env python3
"""Generate answer alternatives for content/core-entries.json into content/alternatives.json.

A local Ollama model proposes other words that fill each example's gap with the same
meaning, deterministic filters drop what other checks already handle, and a second,
independent model call accepts or rejects each remaining candidate in the full sentence.
Runs resume: examples already recorded with the same text are skipped. See
docs/design/answer-alternatives.md.

    python3 tools/content/generate_alternatives.py [--limit N] [--workers N] [--model M]
"""
import argparse
import json
import re
import sys
import unicodedata
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DRAFT = 'content/core-entries.json'
ALTERNATIVES = 'content/alternatives.json'
MODEL = 'gemma4:26b'
OLLAMA = 'http://localhost:11434/api/generate'
MAX_ALTERNATIVES = 5
MAX_TEXT = 2000
DESCRIPTION = ('Answer alternatives for content/core-entries.json, keyed by entry ID. `example` is the draft example '
               'they were generated for; publishing fails if it no longer matches. `accepted` alternatives are merged '
               'into the example as {target|alternative}; `rejected` records the other candidates and why.')

ARTICLE = re.compile(r"^(?:(?:une|un|les|le|la|des|du)\s+|l['’]\s*)", re.IGNORECASE)
GAP = '________'

PROPOSE = """You help build French vocabulary flashcards. A learner sees the English meaning and the French \
sentence with a gap, and types the missing French.

English meaning: {english}
Sentence: {cloze}
Expected answer: {target}

List other French words or short phrases a learner could type in the gap instead of the expected answer, \
such that the completed sentence is grammatical, natural, and means the same thing. Each one must fit the gap \
exactly as written: same agreement, same tense, and it must not repeat or drop the words around the gap. \
Rewrite the full sentence in your head to check each one. Only real synonyms in this context; most gaps have none. \
Do not include the expected answer, spelling variants of it, or the same word with another article.
Reply with JSON: {{"alternatives": ["..."]}}"""

CHECK = """You are a strict French teacher checking flashcard answers. A wrong acceptance teaches a learner a \
mistake, so when in doubt, reject.

English meaning of the gap word: {english}
Original sentence: {sentence}

Each candidate below replaces "{target}" in the original sentence. For each, in order, judge the new sentence:
- grammatical: correct French with the right agreement and construction, nothing missing or doubled;
- same_meaning: a native speaker would say it means the same thing, in the same register; a broader, narrower \
or merely related word is not the same meaning.

{candidates}
Reply with JSON, one verdict per candidate in the same order: \
{{"verdicts": [{{"candidate": "...", "reason": "one short sentence", "grammatical": true or false, \
"same_meaning": true or false}}]}}"""


class OllamaError(RuntimeError):
    pass


def ollama(prompt, model=MODEL, url=OLLAMA, timeout=300):
    """One deterministic JSON reply from a local Ollama model."""
    body = json.dumps({'model': model, 'prompt': prompt, 'stream': False, 'format': 'json', 'think': False,
                       'options': {'temperature': 0}}).encode()
    request = urllib.request.Request(url, body, {'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            reply = json.load(response)['response']
    except (OSError, KeyError, ValueError) as e:
        raise OllamaError(f'Ollama request failed: {e}') from e
    try:
        return json.loads(reply)
    except ValueError:
        return {}


def folded(text):
    """Lower case without accents or ligatures: the comparison the app forgives."""
    text = unicodedata.normalize('NFD', text.replace('’', "'").lower())
    return ''.join(c for c in text if unicodedata.category(c) != 'Mn').replace('œ', 'oe').replace('æ', 'ae')


def target_of(example):
    return example[example.index('{') + 1:example.index('}')]


def rejection(candidate, target, seen):
    """Why a proposed candidate is dropped before the checker sees it, or None."""
    if not isinstance(candidate, str) or not candidate.strip():
        return 'blank'
    if any(c in candidate for c in '{}|') or len(candidate) > MAX_TEXT:
        return 'malformed'
    if folded(candidate) == folded(target):
        return 'target variant'
    if folded(ARTICLE.sub('', candidate)) == folded(ARTICLE.sub('', target)):
        return 'article variant'
    if len(candidate.split()) > len(target.split()) + 1:
        return 'too long'
    if folded(candidate) in seen:
        return 'duplicate'
    return None


class UnusableReply(ValueError):
    """The model's reply can't be used; the row stays pending for the next run."""


def alternatives_for(row, generate):
    """The record for one draft row: accepted alternatives and rejected candidates with reasons."""
    example = row['example']
    target = target_of(example)
    cloze = example.replace('{' + target + '}', GAP)
    proposed = generate(PROPOSE.format(english=row['english'], cloze=cloze, target=target)).get('alternatives')
    if not isinstance(proposed, list):
        raise UnusableReply(f"{row['id']}: no list of alternatives")
    candidates, rejected, seen = [], [], set()
    for candidate in proposed:
        candidate = candidate.strip() if isinstance(candidate, str) else candidate
        reason = rejection(candidate, target, seen)
        if reason:
            rejected.append({'candidate': candidate if isinstance(candidate, str) else str(candidate), 'reason': reason})
        else:
            candidates.append(candidate)
            seen.add(folded(candidate))
    accepted = []
    if candidates:
        listing = ''.join(f'{i}. {c}: {cloze.replace(GAP, c)}\n' for i, c in enumerate(candidates, 1))
        reply = generate(CHECK.format(english=row['english'], sentence=example.replace('{', '').replace('}', ''),
                                      target=target, candidates=listing)).get('verdicts')
        complete = lambda v: isinstance(v, dict) and isinstance(v.get('candidate'), str) and \
            isinstance(v.get('grammatical'), bool) and isinstance(v.get('same_meaning'), bool)
        if not isinstance(reply, list) or not all(map(complete, reply)):
            raise UnusableReply(f"{row['id']}: incomplete verdicts")
        verdicts = {folded(v['candidate'].strip()): v for v in reply}
        # Exactly one complete verdict per candidate, or the reply can't be trusted.
        if len(verdicts) != len(reply) or set(verdicts) != {folded(c) for c in candidates}:
            raise UnusableReply(f"{row['id']}: no single complete verdict for every candidate")
        for c in candidates:
            v = verdicts[folded(c)]
            if v['grammatical'] and v['same_meaning'] and len(accepted) < MAX_ALTERNATIVES:
                accepted.append(c)
            else:
                rejected.append({'candidate': c, 'reason': f"checker: {v.get('reason', '')}".strip()})
    return {'example': example, 'accepted': accepted, 'rejected': rejected}


def load(path):
    if not path.exists():
        return {}
    return json.loads(path.read_text())['examples']


def save(path, records, model):
    data = {'description': DESCRIPTION, 'model': model, 'examples': dict(sorted(records.items()))}
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    tmp.replace(path)


def pending(rows, records):
    """Rows without a record for their current example text, most frequent first."""
    return sorted((r for r in rows if records.get(r['id'], {}).get('example') != r['example']), key=lambda r: r['rank'])


def run(rows, records, generate, workers=1, limit=None, on_progress=None):
    """
    Fills `records` in place for pending rows; calls `on_progress(done, total)` after each one.
    A row whose reply is unusable is left out, so the next run retries it.
    """
    todo = pending(rows, records)[:limit]

    def attempt(row):
        try:
            return alternatives_for(row, generate)
        except (UnusableReply, OllamaError) as e:
            print(f'skipped {e}', file=sys.stderr, flush=True)
            return None

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for done, (row, record) in enumerate(zip(todo, pool.map(attempt, todo)), 1):
            if record is not None:
                records[row['id']] = record
            if on_progress:
                on_progress(done, len(todo))
    return records


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--limit', type=int, help='stop after this many examples')
    parser.add_argument('--workers', type=int, default=1, help='parallel requests (match OLLAMA_NUM_PARALLEL)')
    parser.add_argument('--model', default=MODEL)
    args = parser.parse_args(argv)
    rows = json.loads((ROOT / DRAFT).read_text())
    path = ROOT / ALTERNATIVES
    ids = {row['id'] for row in rows}
    records = {k: v for k, v in load(path).items() if k in ids}  # entries since removed from the draft

    def progress(done, total):
        if done % 50 == 0 or done == total:
            save(path, records, args.model)
            print(f'{done}/{total}', flush=True)

    run(rows, records, lambda prompt: ollama(prompt, args.model), args.workers, args.limit, progress)
    save(path, records, args.model)
    accepted = sum(len(r['accepted']) for r in records.values())
    print(f'{len(records)} examples recorded, {accepted} alternatives accepted', file=sys.stderr)


if __name__ == '__main__':
    main()
