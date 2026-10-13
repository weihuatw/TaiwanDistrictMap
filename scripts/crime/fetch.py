#!/usr/bin/env python3
"""Download registered official crime resources, retaining hashes and source periods."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / 'data/raw/crime'
SOURCES = ROOT / 'data/crime/sources.json'

def fetch_resource(item):
    path = RAW / item['file']
    payload = subprocess.run(['curl', '-fLsS', '--retry', '2', '--max-time', '60', item['url']], check=True, capture_output=True).stdout
    if not payload or payload.lstrip().startswith(b'<'):
        raise ValueError('Expected official CSV, received empty response or HTML')
    path.write_bytes(payload)
    return {**item, 'sha256': hashlib.sha256(payload).hexdigest(), 'bytes': len(payload), 'retrievedAt': datetime.now(timezone.utc).isoformat()}

def main():
    RAW.mkdir(parents=True, exist_ok=True)
    data = json.loads(SOURCES.read_text())
    with ThreadPoolExecutor(max_workers=4) as pool:
        data['resources'] = list(pool.map(fetch_resource, data['resources']))
    spec = importlib.util.spec_from_file_location('annual_fetch', ROOT / 'scripts/population/annual_fetch.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    populations = []
    for period in ['11306', '11406', '11506', '11508']:
        item = module.fetch_table('ODRP013', period, RAW)
        item['file'] = f"data/raw/crime/ODRP013-{period}.json"
        populations.append(item)
    data['populations'] = populations
    SOURCES.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    print(f"Downloaded {len(data['resources'])} crime resources and {len(populations)} population snapshots")

if __name__ == '__main__':
    main()
