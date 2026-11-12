#!/usr/bin/env python3
"""Package editorially approved, sense-aligned TSV entries for offline Android import.

Input has the pilot's six pipe-separated columns: ID, French, English, French
definition, sentence with one {answer}, topic. This tool does not approve raw
corpus candidates or infer equivalent meanings from matching headwords.
"""
import argparse
import csv
import hashlib
import json
import re
from pathlib import Path


def prepare(path, source, license_name):
    if not source.strip() or not license_name.strip():
        raise ValueError('Source and license are required')
    entries, ids = [], set()
    for row in csv.reader(Path(path).read_text().splitlines(), delimiter='|'):
        if not row:
            continue
        if len(row) != 6:
            raise ValueError('Expected six columns')
        entry = dict(zip(('id', 'word', 'english', 'definition', 'example', 'topic'), row))
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', entry['id']) or entry['id'] in ids:
            raise ValueError('Invalid or duplicate ID')
        if not all(value.strip() and len(value) <= 2000 for value in row):
            raise ValueError('Blank or oversized field')
        if entry['topic'] not in ('daily', 'culture', 'news'):
            raise ValueError('Unknown topic')
        if not re.fullmatch(r'[^{}]*\{[^{}]+\}[^{}]*', entry['example']):
            raise ValueError('Expected one marked answer')
        ids.add(entry['id'])
        entries.append(entry)
    if not 0 < len(entries) <= 30000:
        raise ValueError('Expected 1–30000 entries')
    return dict(format='langocard-pack', version=1, source=source, license=license_name, entries=entries)


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
