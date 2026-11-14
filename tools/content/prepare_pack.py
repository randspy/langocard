#!/usr/bin/env python3
"""Package editorially approved, sense-aligned TSV entries for offline Android import.

Input has the pilot's pipe-separated columns: ID, French, English, French
definition, topic, then one to five example sentences, each with one {answer}.
This tool does not approve raw corpus candidates or infer equivalent meanings
from matching headwords.
"""
import argparse
import csv
import hashlib
import json
import re
from pathlib import Path

MAX_EXAMPLES = 5


def prepare(path, source, license_name):
    if not source.strip() or not license_name.strip():
        raise ValueError('Source and license are required')
    entries, ids = [], set()
    for row in csv.reader(Path(path).read_text().splitlines(), delimiter='|'):
        if not row:
            continue
        if not 6 <= len(row) <= 5 + MAX_EXAMPLES:
            raise ValueError(f'Expected five columns and 1–{MAX_EXAMPLES} examples')
        entry = dict(zip(('id', 'word', 'english', 'definition', 'topic'), row))
        entry['examples'] = row[5:]
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', entry['id']) or entry['id'] in ids:
            raise ValueError('Invalid or duplicate ID')
        if not all(value.strip() and len(value) <= 2000 for value in row):
            raise ValueError('Blank or oversized field')
        if entry['topic'] not in ('daily', 'culture', 'news'):
            raise ValueError('Unknown topic')
        if not all(re.fullmatch(r'[^{}]*\{[^{}]*\S[^{}]*\}[^{}]*', example) for example in entry['examples']):
            raise ValueError('Expected one marked answer in each example')
        if len({example.strip() for example in entry['examples']}) != len(entry['examples']):
            raise ValueError('Duplicate example')
        ids.add(entry['id'])
        entries.append(entry)
    if not 0 < len(entries) <= 30000:
        raise ValueError('Expected 1–30000 entries')
    return dict(format='langocard-pack', version=2, source=source, license=license_name, entries=entries)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--source', required=True)
    parser.add_argument('--license', required=True)
    args = parser.parse_args()
    payload = json.dumps(prepare(args.input, args.source, args.license), ensure_ascii=False, indent=2).encode()
    if len(payload) > 20 * 1024 * 1024:
        parser.error('Split the library into packs smaller than 20 MB')
    args.output.write_bytes(payload)
    print(f'{len(json.loads(payload)["entries"])} meanings; SHA256 {hashlib.sha256(payload).hexdigest()}')
