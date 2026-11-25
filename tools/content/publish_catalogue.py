#!/usr/bin/env python3
"""Publish content/core-entries.json, with content/alternatives.json merged in, as rank-band packs and a digest-pinned catalogue.

Rerun after editing the draft or NOTICE.md. The same input gives byte-identical output.
"""
import hashlib
import json
import re
from pathlib import Path
from typing import NamedTuple
from urllib.parse import quote

from generate_alternatives import ALTERNATIVES, folded, load

ROOT = Path(__file__).resolve().parents[2]
DRAFT = 'content/core-entries.json'
NOTICE = 'content/NOTICE.md'
# The vocabulary starting-check items, shared by the app and the web.
PLACEMENT = 'content/placement-items.json'
ASSETS = 'apps/android/app/src/main/assets'
BASE_URL = 'https://raw.githubusercontent.com/randspy/langocard/content-v4/content/'
SOURCE = ('French definitions adapted from French Wiktionary contributors, https://fr.wiktionary.org/ '
          '(per-entry sourceUrl), extracted with Wiktextract via Kaikki, https://kaikki.org/dictionary/rawdata.html. '
          'Frequency ranks: Lexique 3.83, Boris New, Christophe Pallier and contributors, '
          'https://openlexicon.fr/datasets-info/Lexique383/README-Lexique.html. '
          'English glosses and example sentences are machine-generated and not independently reviewed. '
          'Accepted answer alternatives are machine-generated (gemma4:26b) and checked by a second model pass; '
          'a 200-example sample was reviewed by Claude Haiku. '
          'Adaptations: one selected meaning per lemma, noun articles, cloze markup, frequency ranks.')
LICENSE = 'CC BY-SA 4.0 https://creativecommons.org/licenses/by-sa/4.0/; see NOTICE.md for attribution and modifications'
STATUS = ('French definitions source-aligned; English glosses, examples and answer alternatives machine-generated; '
          'not independently language-reviewed')

MAX_BYTES = 20 * 1024 * 1024
MAX_ENTRIES = 30000
MAX_EXAMPLES = 5
MAX_ALTERNATIVES = 5
TOPICS = {'daily', 'culture', 'news'}
ID = re.compile(r'[A-Za-z0-9_-]{1,100}')
ONE_ANSWER = re.compile(r'[^{}]*\{[^{}]*\S[^{}]*\}[^{}]*')


class Band(NamedTuple):
    key: str
    title: str
    low: int
    high: int | None

    @property
    def pack_id(self):
        return f'fr-core-{self.key}-2026-11-v1'

    def holds(self, rank):
        return self.low <= rank and (self.high is None or rank <= self.high)


BANDS = (
    Band('frequent', 'Frequent French', 103, 2500),
    Band('everyday', 'Everyday expansion', 2501, 7000),
    Band('extended', 'Beyond the everyday', 7001, None),
)
BUNDLED = BANDS[0]

# A noun of either gender ("élève") has no single article to practise, so it gets no Gender card.
NOUN_FORMS = {'m': ('un ', 'masculine'), 'f': ('une ', 'feminine'), 'm/f': ('', None)}


class ContentError(ValueError):
    pass


def with_alternatives(row, record):
    """The row's example with the record's accepted alternatives after its target: {target|alternative}."""
    example = row['example']
    if record is None:
        return example
    if record['example'] != example:
        raise ContentError(f"{row['id']}: alternatives were generated for another example")
    accepted = record['accepted']
    if not isinstance(accepted, list) or not all(isinstance(a, str) and a.strip() and not set(a) & set('{}|') for a in accepted):
        raise ContentError(f"{row['id']}: accepted alternatives must be non-blank words without braces or bars")
    if not accepted:
        return example
    start, end = example.index('{'), example.index('}')
    return example[:start + 1] + '|'.join([example[start + 1:end], *accepted]) + example[end:]


def pack_entry(row, record=None):
    """A draft row as the app reads it. `gender` is always written, because the app takes an absent one from the article."""
    article, gender = NOUN_FORMS[row['gender']] if row['sourcePos'] == 'noun' else ('', None)
    return {
        'id': row['id'],
        'word': article + row['word'],
        'english': row['english'],
        'definition': row['definition'],
        'examples': [with_alternatives(row, record)],
        'topic': row['topic'],
        'lemma': row['lemma'],
        'rank': row['rank'],
        'sourceUrl': 'https://fr.wiktionary.org/wiki/' + quote(row['lemma'].replace(' ', '_')) + '#fr',
        'license': 'CC BY-SA 4.0',
        'sourceSense': row['sourceSense'],
        'sourcePos': row['sourcePos'],
        'gender': gender,
    }


def band_of(rank):
    band = next((band for band in BANDS if band.holds(rank)), None)
    if band is None:
        raise ContentError(f'Rank {rank} falls in no band')
    return band


def pack(band, entries):
    return dict(format='langocard-pack', version=3, packId=band.pack_id, packVersion=3,
                source=SOURCE, license=LICENSE, status=STATUS, entries=entries)


def serialize(data):
    return (json.dumps(data, ensure_ascii=False, indent=2) + '\n').encode()


def entry_problem(entry):
    """The first rule the app's importer would reject `entry` for, or None."""
    examples = entry['examples']
    if not ID.fullmatch(entry['id']):
        return 'invalid ID'
    if not all(text.strip() and len(text) <= 2000 for text in (entry['word'], entry['english'], entry['definition'], *examples)):
        return 'blank or oversized field'
    if entry['topic'] not in TOPICS:
        return 'unknown topic'
    if not 1 <= len(examples) <= MAX_EXAMPLES:
        return f'expected 1–{MAX_EXAMPLES} examples'
    if not all(ONE_ANSWER.fullmatch(example) for example in examples):
        return 'each example needs exactly one {answer}'
    if len({example.strip() for example in examples}) != len(examples):
        return 'duplicate example'
    for example in examples:
        parts = example[example.index('{') + 1:example.index('}')].split('|')
        if len(parts) > 1 and (len(parts) > MAX_ALTERNATIVES + 1 or not all(p.strip() for p in parts)
                               or len({folded(p.strip()) for p in parts}) != len(parts)):
            return 'alternatives must be different, non-empty words (at most 5)'
    return None


def validate(packs):
    """Raise ContentError for the first pack or entry the app would refuse; IDs must be unique across packs."""
    ids = set()
    for p in packs:
        if not 0 < len(p['entries']) <= MAX_ENTRIES:
            raise ContentError(f"{p['packId']}: expected 1–{MAX_ENTRIES} entries")
        if len(serialize(p)) >= MAX_BYTES:
            raise ContentError(f"{p['packId']}: pack reaches 20 MB")
        for entry in p['entries']:
            if entry['id'] in ids:
                raise ContentError(f"{entry['id']}: duplicate ID")
            ids.add(entry['id'])
            if problem := entry_problem(entry):
                raise ContentError(f"{entry['id']}: {problem}")


def build(rows, notice, alternatives=None, placement=None):
    """
    Every published file, keyed by repository path, from the draft rows, NOTICE.md bytes,
    alternatives by entry ID and the starting-check items' bytes.
    """
    alternatives = alternatives or {}
    if unknown := set(alternatives) - {row['id'] for row in rows}:
        raise ContentError(f'Alternatives for entries not in the draft: {sorted(unknown)[:5]}')
    by_band = {band: [] for band in BANDS}
    for row in rows:
        by_band[band_of(row['rank'])].append(pack_entry(row, alternatives.get(row['id'])))
    packs = [pack(band, entries) for band, entries in by_band.items()]
    validate(packs)
    files, listing = {}, []
    for band, p in zip(BANDS, packs):
        payload = serialize(p)
        files[f'content/{band.pack_id}.json'] = payload
        high = band.high or max(entry['rank'] for entry in p['entries'])
        listing.append(dict(
            id=band.pack_id, title=band.title,
            description=f'Selected meanings from frequency ranks {band.low:,}–{high:,}.',
            meanings=len(p['entries']), lemmas=len({entry['lemma'] for entry in p['entries']}),
            url=f'{BASE_URL}{band.pack_id}.json', sha256=hashlib.sha256(payload).hexdigest()))
    catalogue = serialize(dict(format='langocard-catalogue', version=1, packs=listing))
    files['content/catalogue.json'] = catalogue
    files[f'{ASSETS}/catalogue.json'] = catalogue
    files[f'{ASSETS}/frequent-pack.json'] = files[f'content/{BUNDLED.pack_id}.json']
    files[f'{ASSETS}/CONTENT-NOTICE.md'] = notice
    if placement is not None:
        files[f'{ASSETS}/placement-items.json'] = placement
    return files


def publish(root=ROOT):
    files = build(json.loads((root / DRAFT).read_text()), (root / NOTICE).read_bytes(), load(root / ALTERNATIVES),
                  (root / PLACEMENT).read_bytes())
    for path, data in files.items():
        (root / path).write_bytes(data)
    return files


if __name__ == '__main__':
    for path, data in publish().items():
        print(f'{path}  {len(data):,} bytes  sha256 {hashlib.sha256(data).hexdigest()}')
