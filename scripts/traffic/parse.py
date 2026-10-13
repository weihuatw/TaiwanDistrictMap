"""Extract one event per first party, without retaining party personal attributes."""
import csv
import hashlib
import io
import json
from pathlib import Path
import re
import zipfile
from collections import Counter

ROOT = Path(__file__).resolve().parents[2]

def event(row):
    if row['當事者順位'].strip() != '1':
        return None
    match = re.fullmatch(r'死亡(\d+);受傷(\d+)', row['死亡受傷人數'].strip())
    if not match:
        raise ValueError('Unknown casualty format: ' + row['死亡受傷人數'])
    date = row['發生日期'].strip()
    year = int(row['發生年度'])
    assert date.startswith(str(year)) and len(date) == 8
    try:
        lon, lat = float(row['經度']), float(row['緯度'])
        coordinates = [round(lon, 6), round(lat, 6)] if 118 <= lon <= 123 and 21 <= lat <= 27 else None
    except ValueError:
        coordinates = None
    return {'date': date, 'time': row['發生時間'].zfill(6), 'type': row['事故類別名稱'],
            'location': row['發生地點'], 'coordinates': coordinates,
            'deaths': int(match[1]), 'injuries': int(match[2])}

def main():
    sources = json.loads((ROOT / 'data/traffic/sources.json').read_text())['resources']
    events = {year: [] for year in (2024, 2025, 2026)}
    for source in sources:
        path = ROOT / 'data/raw/traffic' / source['file']
        assert hashlib.sha256(path.read_bytes()).hexdigest() == source['sha256']
        if path.suffix == '.zip':
            archive = zipfile.ZipFile(path)
            streams = [io.TextIOWrapper(archive.open(name), encoding='utf-8-sig') for name in archive.namelist()
                       if name.endswith('.csv') and name not in ('file.csv', 'manifest.csv', 'schema-file.csv')]
        else:
            streams = [path.open(encoding='utf-8-sig')]
        for stream in streams:
            for row in csv.DictReader(stream):
                if row['發生年度'].startswith(('資料提供日期：', '事故類別：')):
                    continue
                assert int(row['發生年度']) == source['year']
                item = event(row)
                if item:
                    events[source['year']].append(item)
            stream.close()
        print(source['file'], len(events[source['year']]), flush=True)
    folder = ROOT / 'data/build/traffic'
    folder.mkdir(parents=True, exist_ok=True)
    for year, rows in events.items():
        months = {kind: Counter(r['date'][:6] for r in rows if r['type'] == kind) for kind in ('A1', 'A2')}
        ends = {kind: max(r['date'] for r in rows if r['type'] == kind) for kind in ('A1', 'A2')}
        # Only complete months present in both streams. Current-year feeds may have different cutoffs.
        common = sorted(set(months['A1']) & set(months['A2']))
        if year == 2026:
            common = [m for m in common if m < min(ends.values())[:6]]
        assert common == [f'{year}{m:02}' for m in range(1, len(common) + 1)]
        selected = [r for r in rows if r['date'][:6] in common]
        selected.sort(key=lambda r: (r['date'], r['time'], r['location'], r['type']))
        for i, r in enumerate(selected):
            r['id'] = f'{year}-{i + 1}'
        report = {'year': year, 'months': common, 'sourceEndDates': ends, 'sourceMonths': months,
                  'excludedOutsideCommonMonths': len(rows) - len(selected), 'events': selected}
        (folder / f'{year}.json').write_text(json.dumps(report, ensure_ascii=False, separators=(',', ':')))
        print(year, 'common months', common, 'events', len(selected), 'source ends', ends, flush=True)

if __name__ == '__main__':
    main()
