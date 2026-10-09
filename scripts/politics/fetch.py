"""Fetch pinned public CEC election tables and MOI officeholder exports (curl TLS)."""
import concurrent.futures
import datetime
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / 'data/raw/politics'
CEC = 'https://db.cec.gov.tw/static/elections/'
ELECTIONS = [
    ('president-2024', 'P0', '4d83db17c1707e3defae5dc4d4e9c800', '2024-01-13'),
    ('municipal-2022', 'C1', '05cc7b904c7a30cc7c88d5b10898c98e', '2022-11-26'),
    ('county-2022', 'C2', '63615098f5afa8ec53159c4a86fc01d3', '2022-11-26'),
    ('chiayi-2022', 'C2', '1275d73551f2c0caf202e803b1766057', '2022-12-18'),
]

def download(file, url, post=None):
    path = RAW / file
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.part')
    cmd = ['curl', '--fail', '--location', '--silent', '--show-error', '--retry', '3', '--max-time', '90', url, '-o', str(tmp)]
    if post:
        cmd += ['--data-urlencode', post]
    subprocess.run(cmd, check=True)
    if file.endswith('.json'):
        json.loads(tmp.read_text())
    tmp.replace(path)
    return {'file': file, 'url': url, 'method': 'POST' if post else 'GET', 'form': post, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'bytes': path.stat().st_size}

def main():
    records = []
    for eid, subject, theme, date in ELECTIONS:
        prefix = f'data/{{kind}}/ELC/{subject}/00/{theme}/'
        jobs = [(f'{eid}/{kind}-C.json', CEC + prefix.format(kind=kind) + 'C/00_000_00_000_0000.json') for kind in ['tickets', 'profiles']]
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            records += list(pool.map(lambda args: download(*args), jobs))
        county_rows = [r for group in json.loads((RAW / f'{eid}/tickets-C.json').read_text()).values() for r in group]
        counties = sorted({(r['prv_code'], r['city_code']) for r in county_rows})
        jobs = [(f'{eid}/{kind}-{level}-{prv}_{city}.json', CEC + prefix.format(kind=kind) + f'{level}/{prv}_{city}_00_000_0000.json') for prv, city in counties for kind in ['tickets', 'profiles'] for level in ['D', 'L']]
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            records += list(pool.map(lambda args: download(*args), jobs))
        print(eid, len(counties), '縣市完成', flush=True)
    records.append(download('president-2024/tickets-N.json', CEC + 'data/tickets/ELC/P0/00/4d83db17c1707e3defae5dc4d4e9c800/N/00_000_00_000_0000.json'))
    records.append(download('party-colors.json', 'https://db.cec.gov.tw/static/webs/configs/party_colors.json'))
    for kind, n, typ in [('villages', 577, 'KND0007'), ('municipal', 578, 'KND0004'), ('county', 579, 'KND0005')]:
        records.append(download(f'officials/{kind}.xls', f'https://www.moi.gov.tw/LocalOfficial.aspx?n={n}&TYP={typ}', 'JLocalOfficial_ExportOds=轉出Ods'))
        print('MOI', kind, '完成', flush=True)
    source = {'schemaVersion': 1, 'retrievedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'snapshot': datetime.date.today().isoformat(), 'license': 'https://data.gov.tw/license', 'elections': [{'id': e, 'subject': s, 'theme': t, 'date': d} for e, s, t, d in ELECTIONS], 'catalogs': ['https://data.gov.tw/dataset/13119', 'https://data.gov.tw/dataset/7057', 'https://data.gov.tw/dataset/7058', 'https://data.gov.tw/dataset/7061'], 'downloads': records}
    (ROOT / 'data/politics/sources.json').write_text(json.dumps(source, ensure_ascii=False, indent=2) + '\n')

if __name__ == '__main__':
    main()
