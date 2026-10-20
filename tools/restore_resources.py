#!/usr/bin/env python3
"""Restore oversized resources from Git parts with SHA-256 verification."""
import hashlib
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ARCHIVE = ROOT / 'resource-parts'


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def main():
    for entry in json.loads((ARCHIVE / 'manifest.json').read_text()):
        target = ROOT / entry['path']
        if target.exists() and digest(target) == entry['sha256']:
            print('Already verified:', entry['path'])
            continue
        temporary = target.with_name(target.name + '.restore-tmp')
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            with temporary.open('wb') as output:
                for part in entry['parts']:
                    source = ARCHIVE / part['name']
                    if digest(source) != part['sha256']:
                        raise ValueError('Part checksum mismatch: ' + str(source))
                    with source.open('rb') as stream:
                        for block in iter(lambda: stream.read(1024 * 1024), b''):
                            output.write(block)
            if temporary.stat().st_size != entry['size'] or digest(temporary) != entry['sha256']:
                raise ValueError('Resource checksum mismatch: ' + entry['path'])
            os.replace(temporary, target)
            print('Restored:', entry['path'])
        finally:
            if temporary.exists():
                temporary.unlink()


if __name__ == '__main__':
    main()
