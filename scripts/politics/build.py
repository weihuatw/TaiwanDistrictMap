"""Build separate official roster/election datasets; never redistribute historical votes."""
import collections
import hashlib
import json
from pathlib import Path
import re
import shutil
import unicodedata

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / 'data/raw/politics'
OUT = ROOT / 'public/data/politics'

def read(path):
    return json.loads(path.read_text())

def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')

def person_name(s):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', s))

def normal(s):
    return person_name(s).replace('台', '臺')

def cec_name(s):
    # CEC encodes rare Unicode glyphs as @HEX@, e.g. @2F97F@ for 聰.
    def glyph(match):
        value = int(match.group(1), 16)
        assert value <= 0x10ffff and not 0xd800 <= value <= 0xdfff
        return unicodedata.normalize('NFKC', chr(value))
    return re.sub(r'@([0-9a-fA-F]{4,6})@', glyph, s)

def rows(data):
    return [row for group in data.values() for row in group]

def cec_key(r):
    return '_'.join(str(r[k]) for k in ['prv_code', 'city_code', 'area_code', 'dept_code', 'li_code'])

def candidate_rows(source):
    grouped = collections.defaultdict(lambda: collections.defaultdict(list))
    for r in source:
        assert r['tbox_no'] == '0000', 'precinct table cannot be used as village totals'
        grouped[cec_key(r)][int(r['cand_no'])].append(r)
    result = {}
    for key, ballots in grouped.items():
        result[key] = []
        for number, pair in sorted(ballots.items()):
            assert len(pair) in [1, 2], 'duplicate candidate row'
            primary = pair[0]
            name = primary['cand_name']
            if len(pair) == 2:
                assert sum(r.get('is_vice') == 'Y' for r in pair) == 1
                assert pair[0]['ticket_num'] == pair[1]['ticket_num'] and pair[0]['party_name'] == pair[1]['party_name']
                primary = next(r for r in pair if r.get('is_vice') != 'Y')
                vice = next(r for r in pair if r.get('is_vice') == 'Y')
                name = primary['cand_name'] + '／' + vice['cand_name']
            candidate = {'id': str(primary['cand_id']), 'number': number, 'name': cec_name(name), 'party': primary['party_name'], 'votes': int(primary['ticket_num'])}
            if candidate['name'] != name:candidate['sourceName'] = name
            result[key].append(candidate)
    return result

def main():
    import xlrd
    sources = read(ROOT / 'data/politics/sources.json')
    snapshot = sources['snapshot']
    for source in sources['downloads']:
        assert hashlib.sha256((RAW / source['file']).read_bytes()).hexdigest() == source['sha256'], source['file']
    aliases = read(ROOT / 'data/politics/aliases.json')['villageNames']
    geometry = {}
    for f in [ROOT / 'public/data/counties.geojson', *sorted((ROOT / 'public/data/towns').glob('*.geojson')), *sorted((ROOT / 'public/data/villages').glob('*.geojson'))]:
        geometry.update({r['properties']['code']: r['properties'] for r in read(f)['features']})
    counties = {normal(g['name']): g for g in geometry.values() if g['level'] == 'county'}
    towns = {(normal(g['countyName']), normal(g['name'])): g for g in geometry.values() if g['level'] == 'town'}
    villages = {(normal(g['countyName']), normal(g['townName']), normal(g['name'])): g for g in geometry.values() if g['level'] == 'village' and not g['unassigned']}
    assert len(villages) == sum(g['level'] == 'village' and not g['unassigned'] for g in geometry.values())
    report = {'schemaVersion': 1, 'snapshot': snapshot, 'normalization': 'NFKC、移除空白、台／臺；村里字形另列明確別名，不模糊比對', 'elections': {}, 'officials': {}, 'unassignedBoundaries': sum(g['unassigned'] for g in geometry.values())}
    results = {'mayor': {}, 'president': {}, 'officials': {}}
    aggregates = {}
    for election in sources['elections']:
        eid, date = election['id'], election['date']
        mode = 'president' if eid.startswith('president') else 'mayor'
        cp = rows(read(RAW / eid / 'profiles-C.json'))
        county_map = {(r['prv_code'], r['city_code']): counties[normal(r['area_name'])] for r in cp}
        parts = [('county', RAW / eid / 'tickets-C.json', RAW / eid / 'profiles-C.json')]
        for prv, city in county_map:
            parts += [(level, RAW / eid / f'tickets-{kind}-{prv}_{city}.json', RAW / eid / f'profiles-{kind}-{prv}_{city}.json') for level, kind in [('town', 'D'), ('village', 'L')]]
        town_map = {}
        source_records = {'county': {}, 'town': {}, 'village': {}}
        missing, mismatches = [], []
        for level, tickets, profiles in parts:
            t = candidate_rows(rows(read(tickets)))
            for r in rows(read(profiles)):
                key = cec_key(r)
                county = county_map[(r['prv_code'], r['city_code'])]
                if level == 'county':
                    g = county
                elif level == 'town':
                    g = towns.get((normal(county['name']), normal(r['area_name'])))
                    assert g, 'town name not found: ' + r['area_name']
                    town_map[(r['prv_code'], r['city_code'], r['dept_code'])] = g
                else:
                    town = town_map[(r['prv_code'], r['city_code'], r['dept_code'])]
                    names = [county['name'], town['name'], r['area_name']]
                    alias = aliases.get('|'.join(names), r['area_name'])
                    g = villages.get((normal(names[0]), normal(names[1]), normal(alias)))
                    if not g:
                        missing.append({'cecKey': key, 'county': names[0], 'town': names[1], 'village': names[2], 'validVotes': int(r['valid_ticket'])})
                candidates = t.pop(key)
                valid, invalid, electors = [int(r[k]) for k in ['valid_ticket', 'invalid_ticket', 'votable_population']]
                assert sum(c['votes'] for c in candidates) == valid, (eid, key, 'candidate sum')
                assert valid + invalid == int(r['vote_ticket']) <= electors, (eid, key, 'ballot sum')
                record = {'code': g['code'] if g else None, 'name': r['area_name'], 'level': level, 'countyCode': county['code'], 'townCode': town_map.get((r['prv_code'], r['city_code'], r['dept_code']), {}).get('code'), 'cecKey': key, 'electionId': eid, 'date': date, 'validVotes': valid, 'invalidVotes': invalid, 'electors': electors, 'candidates': candidates}
                source_records[level][key] = record
                if not g:missing[-1]['record'] = record
                if g:
                    assert g['code'] not in results[mode], ('duplicate region', eid, g['code'])
                    results[mode][g['code']] = record
                    if normal(g['name']) != normal(r['area_name']):mismatches.append({'code': g['code'], 'mapName': g['name'], 'sourceName': r['area_name']})
            assert not t, 'candidate areas missing from profiles'
        # Compare each candidate and ballot count using all historical source villages,
        # including places that no longer join to current boundaries.
        for child_level, parent_level in [('village', 'town'), ('town', 'county')]:
            grouped = collections.defaultdict(list)
            for key, record in source_records[child_level].items():
                bits = key.split('_')
                parent = '_'.join(bits[:3] + ([bits[3], '0000'] if parent_level == 'town' else ['000', '0000']))
                grouped[parent].append(record)
            for key, children in grouped.items():
                parent = source_records[parent_level][key]
                for metric in ['validVotes', 'invalidVotes', 'electors']:
                    assert sum(c[metric] for c in children) == parent[metric], (eid, key, metric)
                for c in parent['candidates']:
                    assert sum(next(x['votes'] for x in child['candidates'] if x['number'] == c['number']) for child in children) == c['votes'], (eid, key, c['number'])
        # Some official tables pool indigenous electors or several villages.
        # Individual rows then represent only a subset of the village ballot.
        for gap in missing:
            if not re.search(r'[A-Z]', gap['cecKey'].split('_')[-1]):continue
            names = gap['village'].split('、')
            for record in source_records['village'].values():
                if record['townCode'] == gap['record']['townCode'] and record['code'] and ('各里' in gap['village'] or record['name'] in names):
                    record['partialReason'] = '部分選民票數由中選會合併列示：' + gap['village'] + '；不拆分合併票，因此不判定完整村里的最高票政黨。'
        aggregates[eid] = {level: len(values) for level, values in source_records.items()}
        report['elections'][eid] = {'sourceCounts': aggregates[eid], 'unmappedSourceVillages': missing, 'nameDifferences': mismatches, 'aggregateChecks': 'all candidate, valid, invalid and elector sums agree'}
        print(eid, aggregates[eid], 'unmapped', len(missing))
    # Read only the current-term MOI roster, and deliberately omit contact/private fields.
    roster = collections.defaultdict(list)
    for kind, level in [('municipal', 'county'), ('county', 'county'), ('villages', 'village')]:
        sheet = xlrd.open_workbook(RAW / f'officials/{kind}.xls').sheet_by_index(0)
        headers = sheet.row_values(0)
        for index in range(1, sheet.nrows):
            r = dict(zip(headers, sheet.row_values(index)))
            if not r['選舉年'].startswith('111年度') or level == 'village' and r['選舉年'] != '111年度村里長選舉':continue
            g = counties.get(normal(r['市縣別'])) if level == 'county' else villages.get((normal(r['市縣別']), normal(r['鄉鎮市區']), normal(aliases.get('|'.join([r['市縣別'], r['鄉鎮市區'], r['村里別']]), r['村里別']))))
            safe = {'name': person_name(r['姓名']), 'role': r['職稱'], 'party': '無黨籍' if r['黨籍'] == '無' else r['黨籍'] or None, 'term': r['選舉年'], 'sourceUrl': f'https://www.moi.gov.tw/LocalOfficial.aspx?n={577 if level == "village" else 578 if kind == "municipal" else 579}&TYP={"KND0007" if level == "village" else "KND0004" if kind == "municipal" else "KND0005"}', 'verifiedAt': snapshot, 'status': 'acting' if '代理' in r['職稱'] else 'registry', 'note': '內政部本屆名錄；查核日為下載日期，非逐里現職查核。'}
            if g:roster[g['code']].append(safe)
            else:report['officials'].setdefault('unmappedRows', []).append({'county': r['市縣別'], 'town': r.get('鄉鎮市區'), 'village': r.get('村里別'), **safe})
    conflicts = []
    for code, entries in roster.items():
        unique = list({(r['name'], r['role'], r['party']): r for r in entries}.values())
        g = geometry[code]
        common = {k: g.get(k) for k in ['code', 'name', 'level', 'countyCode', 'townCode']}
        if len(unique) != 1:
            conflicts.append({'code': code, 'regionName': g['name'], 'entries': unique})
            results['officials'][code] = {**common, 'name': None, 'party': None, 'status': 'conflicting-roster', 'role': '村里長', 'verifiedAt': snapshot, 'sourceUrl': unique[0]['sourceUrl'], 'note': '官方本屆名錄有多位不同人員，尚未確認現職。'}
        else:
            results['officials'][code] = {**common, **unique[0]}
    for code, override in read(ROOT / 'data/politics/official-overrides.json')['records'].items():
        assert code in geometry and not geometry[code]['unassigned'] and override['verifiedAt'] == snapshot
        if code in results['officials']:
            results['officials'][code] = {**results['officials'][code], **override, 'registryParty': results['officials'][code]['party']}
        else:
            g = geometry[code]
            results['officials'][code] = {**{k:g.get(k) for k in ['code','level','countyCode','townCode']}, **override}
    report['officials']['conflicts'] = conflicts
    report['officials']['mappedCounts'] = {level: sum(geometry[c]['level'] == level and r['name'] is not None for c, r in results['officials'].items()) for level in ['county', 'village']}
    for mode in results:
        named = [g for g in geometry.values() if g['level'] == 'village' and not g['unassigned']]
        report.setdefault('coverage', {})[mode] = {'mappedVillages': sum(g['code'] in results[mode] and (mode != 'officials' or results[mode][g['code']]['name'] is not None) for g in named), 'namedBoundaries': len(named), 'partialVillages': sum(bool(r.get('partialReason')) for r in results[mode].values()), 'missingNamedBoundaries': [{'code': g['code'], 'county': g['countyName'], 'town': g['townName'], 'name': g['name'], 'reason': 'conflicting-roster' if g['code'] in results[mode] else 'no-match'} for g in named if g['code'] not in results[mode] or mode == 'officials' and results[mode][g['code']]['name'] is None]}
    for mode, coverage in report['coverage'].items():
        coverage['counties'] = []
        for county in sorted(counties.values(), key=lambda g:g['code']):
            named = [g for g in geometry.values() if g['level'] == 'village' and not g['unassigned'] and g['countyCode'] == county['code']]
            mapped = [results[mode][g['code']] for g in named if g['code'] in results[mode] and (mode != 'officials' or results[mode][g['code']]['name'] is not None)]
            coverage['counties'].append({'code':county['code'], 'name':county['name'], 'namedBoundaries':len(named), 'mappedVillages':len(mapped), 'partialVillages':sum(bool(r.get('partialReason')) for r in mapped)})
    colors = {r['party_name']: '#' + r['color_code'] for r in read(RAW / 'party-colors.json')}
    colors.update(read(ROOT / 'data/politics/colors.json')['colors'])
    # Output each mode independently and shard at the same granularity as geometry.
    for mode, records in results.items():
        version = snapshot if mode == 'officials' else '2024' if mode == 'president' else '2022'
        target = OUT / mode / version
        if target.exists():shutil.rmtree(target)
        groups = {'counties.json': ('county', None, {})}
        for g in geometry.values():
            if g['level'] == 'county':groups[f'towns/{g["code"]}.json'] = ('town', g['code'], {})
            if g['level'] == 'town':groups[f'villages/{g["code"]}.json'] = ('village', g['code'], {})
        for code, r in records.items():
            g = geometry[code]
            file = 'counties.json' if g['level'] == 'county' else f'towns/{g["countyCode"]}.json' if g['level'] == 'town' else f'villages/{g["townCode"]}.json'
            groups[file][2][code] = r
        for file, (level, parent, part) in groups.items():
            write(target / file, {'schemaVersion': 1, 'mode': mode, 'version': version, 'level': level, 'parentCode': parent, 'records': part})
    manifest = {'schemaVersion': 1, 'snapshot': snapshot, 'paths': {mode: f'{mode}/{snapshot if mode == "officials" else "2024" if mode == "president" else "2022"}/' for mode in results}, 'elections': sources['elections'], 'colors': colors, 'coverage': {mode: {k: v for k, v in coverage.items() if k not in ['missingNamedBoundaries', 'counties']} for mode, coverage in report['coverage'].items()}, 'officialCounts': report['officials']['mappedCounts'], 'sources': [{'title': '中選會選舉資料庫', 'url': 'https://db.cec.gov.tw/ElecTable'}, {'title': '內政部地方公職人員本屆名錄', 'url': 'https://www.moi.gov.tw/LocalOfficial.aspx?n=577&TYP=KND0007'}], 'notes': ['首長／村里長名錄與歷史參選推薦政黨獨立；名錄可能延遲，非即時黨籍系統。', '行政區色彩取原始候選人票數最高者的參選推薦政黨；無黨籍候選人逐人比較，並列不硬選勝者。', '歷史村里無法對應現行界線時不分攤；未編定範圍沒有政治統計。', '投票率以中選會選舉人數計算，不使用戶籍人口。', '政黨色彩採網站辨識配色，參考中選會設定，非官方標準色；未知、並列、鄰區以圖例區分。']}
    write(OUT / 'manifest.json', manifest)
    write(OUT / 'join-report.json', report)
    print('coverage', manifest['coverage'], 'officials', manifest['officialCounts'])

if __name__ == '__main__':main()
