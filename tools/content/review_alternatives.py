#!/usr/bin/env python3
"""Sample generated answer alternatives for review, and remove the ones a reviewer judged wrong.

    python3 tools/content/review_alternatives.py sample OUT.json [--size 200] [--seed N]
    python3 tools/content/review_alternatives.py apply VERDICTS.json

`sample` draws a seeded sample of examples that have alternatives, split across the pack bands
by how many such examples each holds. `apply` reads verdicts keyed by entry ID, each a list of
{"alternative", "verdict": "correct" | "wrong" | "unsure", "reason"}, prints the tally and moves
every `wrong` alternative to `rejected` in content/alternatives.json. See
docs/design/answer-alternatives.md, decision 13.
"""
import argparse
import json
import random
import sys
from pathlib import Path
from generate_alternatives import ALTERNATIVES, MODEL, load, save
from publish_catalogue import BANDS, DRAFT, band_of

ROOT = Path(__file__).resolve().parents[2]
VERDICTS = ('correct', 'wrong', 'unsure')


def sample(rows, records, size=200, seed=0):
    """Up to `size` current examples with alternatives, allotted to bands by share (largest remainder)."""
    by_band = {band.key: [] for band in BANDS}
    for r in sorted(rows, key=lambda r: r['id']):
        record = records.get(r['id'])
        if record and record['example'] == r['example'] and record['accepted']:
            by_band[band_of(r['rank']).key].append(dict(id=r['id'], band=band_of(r['rank']).key, english=r['english'],
                                                        example=r['example'], accepted=record['accepted']))
    total = sum(map(len, by_band.values()))
    size = min(size, total)
    shares = {k: size * len(v) / total for k, v in by_band.items()} if total else {}
    quota = {k: int(s) for k, s in shares.items()}
    for k in sorted(shares, key=lambda k: shares[k] - quota[k], reverse=True)[:size - sum(quota.values())]:
        quota[k] += 1
    rng = random.Random(seed)
    return [item for k, items in by_band.items() for item in rng.sample(items, quota.get(k, 0))]


def tally(verdicts):
    counts = dict.fromkeys(VERDICTS, 0)
    for judged in verdicts.values():
        for v in judged:
            counts[v['verdict']] += 1
    return counts


def drop_wrong(records, verdicts):
    """Moves every alternative judged wrong to `rejected`; returns how many. Checks every verdict first."""
    for key, judged in verdicts.items():
        seen = set()
        for v in judged:
            if v.get('verdict') not in VERDICTS or not isinstance(v.get('reason'), str) or v.get('alternative') in seen \
                    or v.get('alternative') not in records.get(key, {}).get('accepted', ()):
                raise ValueError(f'{key}: verdict {v!r} is not one well-formed verdict on a recorded alternative')
            seen.add(v['alternative'])
    removed = 0
    for key, judged in verdicts.items():
        record = records[key]
        for v in judged:
            if v['verdict'] == 'wrong':
                record['accepted'].remove(v['alternative'])
                record['rejected'].append({'candidate': v['alternative'], 'reason': f"review: {v['reason']}".strip()})
                removed += 1
    return removed


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest='command', required=True)
    take = commands.add_parser('sample')
    take.add_argument('out', type=Path)
    take.add_argument('--size', type=int, default=200)
    take.add_argument('--seed', type=int, default=0)
    apply = commands.add_parser('apply')
    apply.add_argument('verdicts', type=Path)
    args = parser.parse_args(argv)
    path = ROOT / ALTERNATIVES
    records = load(path)
    if args.command == 'sample':
        rows = json.loads((ROOT / DRAFT).read_text())
        picked = sample(rows, records, args.size, args.seed)
        args.out.write_text(json.dumps(picked, ensure_ascii=False, indent=2) + '\n')
        print(f'{len(picked)} examples, {sum(len(p["accepted"]) for p in picked)} alternatives', file=sys.stderr)
    else:
        verdicts = json.loads(args.verdicts.read_text())
        counts = tally(verdicts)
        removed = drop_wrong(records, verdicts)
        save(path, records, json.loads(path.read_text()).get('model', MODEL))
        judged = counts['correct'] + counts['wrong']
        print(f'{counts}; wrong {counts["wrong"] / judged:.1%} of judged; removed {removed}' if judged else counts,
              file=sys.stderr)


if __name__ == '__main__':
    main()
