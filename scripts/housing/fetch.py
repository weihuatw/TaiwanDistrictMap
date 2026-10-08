#!/usr/bin/env python3
"""Fetch official MOI sales snapshots. Does not run as part of the site build."""
import argparse
import hashlib
import json
import pathlib
import subprocess
import time
import urllib.error
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
RAW = ROOT / 'data/raw/housing'
BASE = 'https://plvr.land.moi.gov.tw'
DEFAULT_SEASONS = ['112S4'] + [f'{y}S{q}' for y in (113,114,115) for q in range(1,5) if (y,q) <= (115,3)]


def get(url, timeout=90):
    result = subprocess.run(['curl','--fail','--silent','--show-error','--location','--retry','3',
        '--connect-timeout','20','--max-time',str(timeout),url], capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError(result.stderr.decode('utf-8',errors='replace').strip() or f'curl exit {result.returncode}')
    return result.stdout


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--seasons', nargs='*', default=DEFAULT_SEASONS)
    parser.add_argument('--skip-current', action='store_true')
    args = parser.parse_args()
    RAW.mkdir(parents=True, exist_ok=True)
    sources = {'provider': '內政部地政司', 'catalogUrl': BASE + '/DownloadOpenData',
               'license': '政府資料開放授權條款第1版', 'retrievedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
               'batches': []}
    targets = [(f'{s}.zip', f'{BASE}/DownloadSeason?season={s}&type=zip&fileName=lvr_landcsv.zip', s) for s in args.seasons]
    if not args.skip_current:
        targets.append(('current.zip', f'{BASE}/Download?type=zip&fileName=lvr_landcsv.zip', 'current'))
    for filename, url, batch in targets:
        path = RAW / filename
        payload = path.read_bytes() if path.exists() else None
        last_error = None
        for attempt in range(4):
            try:
                if payload is None:
                    payload = get(url)
                with zipfile.ZipFile(__import__('io').BytesIO(payload)) as archive:
                    names = archive.namelist()
                    if 'manifest.csv' not in names or 'schema-main.csv' not in names:
                        raise ValueError('ZIP lacks official manifest/schema')
                    coverage = archive.read('build_time.xml').decode('utf-8', errors='replace') if 'build_time.xml' in names else ''
                break
            except (OSError, ValueError, zipfile.BadZipFile, urllib.error.URLError) as error:
                last_error = error; payload = None
                if attempt < 3: time.sleep(2 ** attempt)
        else:
            raise RuntimeError(f'{batch} download failed: {last_error}')
        path.write_bytes(payload)
        sources['batches'].append({'batch': batch, 'url': url, 'file': filename,
            'sha256': hashlib.sha256(payload).hexdigest(), 'bytes': len(payload),
            'members': len(names), 'coverageDescription': coverage})
        print(f'{batch}: {len(payload):,} bytes sha256={sources["batches"][-1]["sha256"]}')
    (ROOT / 'data/housing').mkdir(parents=True, exist_ok=True)
    (ROOT / 'data/housing/sources.json').write_text(json.dumps(sources, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
