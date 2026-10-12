#!/usr/bin/env python3
"""Validate the published indigenous snapshot without raw downloads."""
import json,pathlib,re,sys
R=pathlib.Path(__file__).resolve().parents[2]; root=R/'public/data/indigenous'; m=json.loads((root/'manifest.json').read_text()); d=root/m['period']; meta=json.loads((d/'manifest.json').read_text()); exceptions=json.loads((R/'data/indigenous/expected-exceptions.json').read_text());
assert meta['schemaVersion']==1 and meta['period']==m['period'] and meta['sourceMonth']==m['sourceMonth']
assert meta['denominatorPeriod']==meta['period'] and meta['denominatorSource']['sourceSha256'] and meta['denominatorSource']['shards']
tribes=meta['supportedTribes']; ids=[x['id'] for x in tribes]; assert len(ids)==26 and len(set(ids))==26
national=json.loads((d/'national.json').read_text())['record']; counties=json.loads((d/'counties.json').read_text())['records']; assert national['code']=='TW' and 'countyCode' not in national
village_files=list((d/'villages').glob('*.json')); town_files=list((d/'towns').glob('*.json')); villages={};towns={}
for f in village_files:
 s=json.loads(f.read_text()); assert s['schemaVersion']==1 and s['period']==m['period'] and s['level']=='village'
 for code,r in s['records'].items(): assert code==r['code'] and code.startswith(s['parentCode']); villages[code]=r
for f in town_files:
 s=json.loads(f.read_text()); assert s['schemaVersion']==1 and s['period']==m['period'] and s['level']=='town'
 for code,r in s['records'].items(): assert code==r['code'];towns[code]=r
assert len(villages)==7781 and len(towns)==368 and len(counties)==22
unmatched=exceptions['sourceWithoutBoundaryCodes']; report=json.loads((d/'join-report.json').read_text()); assert report['sourceWithoutBoundaryCodes']==unmatched
assert len(report['nameDifferences'])==exceptions['expectedNameDifferences']==23
expected_names=set(json.loads((R/'data/population/expected-exceptions.json').read_text())[m['sourceMonth']]['nameMismatches'])
assert {x['code'] for x in report['nameDifferences']}==expected_names
expected_unmatched=set(exceptions['sourceWithoutBoundaryCodes'])
boundary_names={}
for f in (R/'public/data/villages').glob('*.geojson'):
 for feature in json.loads(f.read_text())['features']:
  pr=feature['properties']
  if not pr.get('unassigned'): boundary_names[pr['code']]=pr['name']
assert set(villages)-set(boundary_names)==expected_unmatched
assert set(boundary_names)-set(villages)==set()
assert {x['code'] for x in report['nameDifferences']}=={c for c,r in villages.items() if c in boundary_names and r['name']!=boundary_names[c]}
for code,r in villages.items():
 assert re.fullmatch(r'\d{11}',code) and r['totalPopulation']>=r['indigenous']>=0
 assert r['male']+r['female']==r['indigenous']
 assert sum(r['tribes'].get(t,0) for t in ids)+r['undeclared']==r['indigenous']
 assert set(r['tribes'])==set(ids)
for code,r in [*towns.items(),*counties.items(),('TW',national)]:
 assert r['male']+r['female']==r['indigenous'] and sum(r['tribes'][t] for t in ids)+r['undeclared']==r['indigenous']
# Verify each parent aggregate against its direct children for every stored field.
def compare(parent,children):
 for field in ('totalPopulation','indigenous','male','female','undeclared'):
  assert parent[field]==sum(c[field] for c in children),(parent['code'],field)
 for tribe in ids: assert parent['tribes'][tribe]==sum(c['tribes'][tribe] for c in children),(parent['code'],tribe)
for tc,t in towns.items(): compare(t,[v for v in villages.values() if v['townCode']==tc])
for cc,c in counties.items(): compare(c,[t for tc,t in towns.items() if tc.startswith(cc)])
compare(national,list(counties.values()))
# Verify sums from source village records, including the confirmed source-only Sanhe record.
def summed(key):return sum(v[key] for v in villages.values())
for key in ('totalPopulation','indigenous','male','female','undeclared'):
 assert national[key]==summed(key),(key,national[key],summed(key))
for t in ids: assert national['tribes'][t]==sum(v['tribes'][t] for v in villages.values())
if m['sourceMonth']=='11508':
 assert national['indigenous']==639340 and national['totalPopulation']==23224721 and national['undeclared']==7688 and national['tribes']['siraya']==40
print(f"indigenous:check passed: {len(villages)} villages, {len(towns)} towns, {len(counties)} counties, {len(ids)} tribes")
