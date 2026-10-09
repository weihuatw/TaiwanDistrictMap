"""Check published politics shards and full historical aggregates without raw downloads."""
import collections
import json
from pathlib import Path
import re
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/data/politics'

def read(path):return json.loads(path.read_text())

def check():
    manifest, report = read(OUT / 'manifest.json'), read(OUT / 'join-report.json')
    assert manifest['schemaVersion'] == report['schemaVersion'] == 1
    assert manifest['snapshot'] == report['snapshot']
    geometry = {r['properties']['code']: r['properties'] for f in [ROOT / 'public/data/counties.geojson', *sorted((ROOT / 'public/data/towns').glob('*.geojson')), *sorted((ROOT / 'public/data/villages').glob('*.geojson'))] for r in read(f)['features']}
    all_records = {}
    for mode, folder in manifest['paths'].items():
        assert re.fullmatch(r'(officials/\d{4}-\d{2}-\d{2}|mayor/2022|president/2024)/', folder)
        records = {}
        files = [OUT / folder / 'counties.json']
        files += [OUT / folder / f'towns/{g["code"]}.json' for g in geometry.values() if g['level'] == 'county']
        files += [OUT / folder / f'villages/{g["code"]}.json' for g in geometry.values() if g['level'] == 'town']
        for file in files:
            p = read(file)
            assert p['schemaVersion'] == 1 and p['mode'] == mode and p['version'] == folder.split('/')[1]
            level = 'county' if file.name == 'counties.json' else 'town' if file.parent.name == 'towns' else 'village'
            assert p['level'] == level and p['parentCode'] == (None if level == 'county' else file.stem)
            for code, r in p['records'].items():
                assert code not in records and code == r['code'] and code in geometry and not geometry[code]['unassigned']
                g = geometry[code]
                assert g['level'] == r['level'] == level and g['countyCode'] == r['countyCode']
                assert level == 'county' or p['parentCode'] == (r['countyCode'] if level == 'town' else r['townCode'])
                assert not any(k in r for k in ['辦公電話', '辦公地址', '電子信箱', 'phone', 'address', 'email'])
                if mode == 'officials':
                    assert r['verifiedAt'] == manifest['snapshot'] and r['sourceUrl'].startswith('https://')
                    assert r['name'] is None or isinstance(r['name'], str)
                    assert r['party'] is None or isinstance(r['party'], str)
                else:validate_votes(r)
                records[code] = r
        all_records[mode] = records
        cov = manifest['coverage'][mode]
        named = [g for g in geometry.values() if g['level'] == 'village' and not g['unassigned']]
        missing = [g['code'] for g in named if g['code'] not in records or mode == 'officials' and not records[g['code']]['name']]
        assert cov['namedBoundaries'] == len(named)
        assert cov['mappedVillages'] + len(missing) == len(named)
        assert cov['partialVillages'] == sum(bool(r.get('partialReason')) for r in records.values())
        assert sorted(missing) == sorted(r['code'] for r in report['coverage'][mode]['missingNamedBoundaries'])
        assert sum(r['level'] == 'county' for r in records.values()) == 22
        if mode != 'officials':assert sum(r['level'] == 'town' for r in records.values()) == 368
    assert all_records['officials']['10002']['name'] == '林茂盛' and all_records['officials']['10002']['party'] is None
    assert all_records['officials']['10018']['party'] == '無黨籍'
    assert all_records['officials']['10005']['party'] == '中國國民黨'
    assert all_records['officials']['09020']['party'] == '台灣民眾黨'
    assert all_records['mayor']['10020']['date'] == '2022-12-18'
    assert all_records['president']['10020']['date'] == '2024-01-13'
    total_president = collections.Counter()
    for r in all_records['president'].values():
        if r['level'] == 'county':total_president.update({c['number']:c['votes'] for c in r['candidates']})
    assert total_president == {1:3690466, 2:5586019, 3:4671021}, 'presidential partners must not be double counted'
    for eid, audit in report['elections'].items():
        mode = 'president' if eid.startswith('president') else 'mayor'
        source = collections.defaultdict(dict)
        for r in all_records[mode].values():
            if r['electionId'] == eid:source[r['level']][r['cecKey']] = r
        for gap in audit['unmappedSourceVillages']:
            r = gap['record'];validate_votes(r)
            assert r['code'] is None and r['cecKey'] not in source['village']
            source['village'][r['cecKey']] = r
        assert {level:len(records) for level,records in source.items()} == audit['sourceCounts']
        for child_level, parent_level in [('village','town'),('town','county')]:
            groups = collections.defaultdict(list)
            for key,r in source[child_level].items():
                bits = key.split('_')
                parent = '_'.join(bits[:3] + ([bits[3],'0000'] if parent_level == 'town' else ['000','0000']))
                groups[parent].append(r)
            for key, children in groups.items():
                parent = source[parent_level][key]
                for metric in ['validVotes','invalidVotes','electors']:
                    assert sum(r[metric] for r in children) == parent[metric], (eid,key,metric)
                for c in parent['candidates']:
                    assert sum(next(x['votes'] for x in r['candidates'] if x['number']==c['number']) for r in children) == c['votes']
    # Reviewed omissions protect future rebuilds from silent coverage regressions.
    expected = read(ROOT / 'data/politics/expected-exceptions.json')
    assert expected['snapshot'] == manifest['snapshot']
    for mode in all_records:
        assert expected['missingNamedBoundaries'][mode] == sorted(r['code'] for r in report['coverage'][mode]['missingNamedBoundaries'])
        assert expected['partialBoundaries'][mode] == sorted(code for code,r in all_records[mode].items() if r.get('partialReason'))
    print('Politics checked:', manifest['officialCounts'], manifest['coverage'])

def validate_votes(r):
    assert all(not re.search(r'@[0-9a-fA-F]{4,6}@', c['name']) for c in r['candidates'])
    for key in ['validVotes','invalidVotes','electors']:
        assert isinstance(r[key],int) and r[key]>=0
    assert r['candidates'] and len(set(c['number'] for c in r['candidates'])) == len(r['candidates'])
    assert all(isinstance(c['votes'],int) and c['votes']>=0 and c['id'].isdigit() and c['number']>=1 for c in r['candidates'])
    assert sum(c['votes'] for c in r['candidates']) == r['validVotes']
    assert r['validVotes']+r['invalidVotes']<=r['electors']
    assert re.fullmatch(r'\d{4}-\d{2}-\d{2}',r['date'])

if __name__ == '__main__':check()
