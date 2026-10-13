#!/usr/bin/env python3
"""Aggregate crime statistics without publishing individual event rows."""
import csv
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import re
import unicodedata

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / 'public/data'
RAW = ROOT / 'data/raw/crime'
DEST = PUBLIC / 'crime'
REGIONAL = {'住宅竊盜':'homeTheft','汽車竊盜':'carTheft','機車竊盜':'motorcycleTheft','強盜':'robbery','搶奪':'snatching','毒品':'drugs','強制性交':'sexualAssault','組織犯罪防制條例':'organized'}
OFFICIAL = {'總計':'total','竊盜':'theft','詐欺背信':'fraud','傷害':'injury','公共危險':'publicDanger','違反毒品危害防制條例':'drugs','強盜搶奪':'robberySnatching','妨害性自主罪':'sexualOffense'}

def read(path): return json.loads(path.read_text())
def write(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n')
def normal(s): return re.sub(r'\s','',unicodedata.normalize('NFKC',s)).replace('台','臺')
def number(s):
    if s=='-': return 0  # Official numeric tables use '-' for no cases.
    if not re.fullmatch(r'\d+',s): raise ValueError(f'Invalid official count: {s!r}')
    return int(s)

def main():
    sources=read(ROOT/'data/crime/sources.json')
    for item in sources['resources']+sources['populations']:
        path=ROOT/item['file'] if item in sources['populations'] else RAW/item['file']
        if hashlib.sha256(path.read_bytes()).hexdigest()!=item['sha256']: raise ValueError(f'Source hash mismatch: {path}')
    counties=[f['properties'] for f in read(PUBLIC/'counties.geojson')['features']]
    towns=[f['properties'] for c in counties for f in read(PUBLIC/f"towns/{c['code']}.geojson")['features']]
    county_names={normal(c['name']):c['code'] for c in counties}
    town_names={(c['code'],normal(t['name'])):t['code'] for c in counties for t in towns if t['countyCode']==c['code']}
    geographies={p['code']:p for p in counties+towns}
    geographies['TW']={'code':'TW','name':'全臺'}
    annual={}
    for year in [2024,2025]:
        folder=PUBLIC/f'population/annual/{year}'
        annual[year]={code:r for path in [folder/'counties.json',*[folder/f"towns/{c['code']}.json" for c in counties]] for code,r in read(path)['records'].items()}
        annual[year]['TW']=read(folder/'national.json')['record']
    def populations(year,end):
        if end==12:return {code:r['meanPopulation'] for code,r in annual[year].items()}
        snapshot=read(RAW/f'ODRP013-{year-1911}{end:02}.json')
        final=defaultdict(int)
        for r in snapshot:
            if r['statistic_yyymm']!=f'{year-1911}{end:02}':raise ValueError('Population month mismatch')
            n=number(r['people_total'])
            if n!=number(r['people_total_m'])+number(r['people_total_f']):raise ValueError('Population sex totals mismatch')
            for code in [r['district_code'][:8],r['district_code'][:5],'TW']:final[code]+=n
        start={code:r['startPopulation'] for code,r in annual[year].items()} if year<2026 else {code:r['endPopulation'] for code,r in annual[2025].items()}
        if set(start)!=set(final):raise ValueError('Population geography mismatch')
        return {code:(start[code]+final[code])/2 for code in start}
    tables={kind:list(csv.DictReader((RAW/f'{kind}.csv').read_text(encoding='utf-8-sig').splitlines())) for kind in ['cases','suspects']}
    regional={year:[] for year in [2024,2025,2026]}
    for year in regional:
        quarters=sorted((r['startMonth'],r['endMonth']) for r in sources['resources'] if r['kind']=='regional' and r['year']==year)
        if quarters!=([(1,3),(4,6)] if year==2026 else [(1,3),(4,6),(7,9),(10,12)]):raise ValueError('Missing or overlapping crime quarters')
    for item in sources['resources']:
        if item['kind']!='regional':continue
        for r in csv.DictReader((RAW/item['file']).read_text(encoding='utf-8-sig').splitlines()):
            if r['type']=='案類' and r['oc_year']=='發生年度':continue
            if r['type'] not in REGIONAL or int(r['oc_year'])+1911!=item['year']:raise ValueError('Unexpected crime category or year')
            date=r['oc_data'].zfill(4)
            from datetime import date as calendar_date
            calendar_date(item['year'],int(date[:2]),int(date[2:]))
            if not item['startMonth']<=int(date[:2])<=item['endMonth']:raise ValueError('Wrong source quarter')
            regional[item['year']].append((int(date[:2]),r))
    manifests=[]
    for year in [2024,2025,2026]:
        for scope in ['official','regional']:
            for period in ['available','half']:
                end=6 if period=='half' or (year==2026 and scope=='regional') else 8 if year==2026 else 12
                pop=populations(year,end)
                keys=['total',*REGIONAL.values()] if scope=='regional' else list(OFFICIAL.values())
                records={code:{'code':code,'name':p['name'],'countyCode':p.get('countyCode'),'population':pop[code],'cases':dict.fromkeys(keys,0),'suspects':dict.fromkeys(keys,0) if scope=='official' else None,'unassigned':dict.fromkeys(keys,0)} for code,p in geographies.items() if scope=='regional' or len(code)==5 or code=='TW'}
                if scope=='regional':
                    for month,r in regional[year]:
                        if month>end:continue
                        county=county_names.get(normal(r['oc_county']))
                        if not county and (r['oc_county'],r['oc_region']) not in {('999990','00'),('999990','0'),('2',''),('','')}:
                            raise ValueError(f"Unknown county: {r['oc_county']}")
                        town=town_names.get((county,normal(r['oc_region'])))
                        if county and r['oc_region'].strip() and not town:raise ValueError(f"Unmatched township: {r['oc_county']} {r['oc_region']}")
                        category=REGIONAL[r['type']]
                        for code in ['TW',*([county] if county else []),*([town] if town else [])]:
                            for k in ['total',category]:records[code]['cases'][k]+=1
                        if not town:
                            for code in ['TW',*([county] if county else [])]:
                                for k in ['total',category]:records[code]['unassigned'][k]+=1
                        if not county:
                            for k in ['total',category]:records['TW']['unassigned'][f'county:{k}']=records['TW']['unassigned'].get(f'county:{k}',0)+1
                else:
                    for kind,rows in tables.items():
                        selected=defaultdict(list)
                        for r in rows:
                            label=r[next(iter(r))]
                            if not label:continue
                            time,name=label.split('/',1)
                            code='TW' if normal(name)=='機關別總計' else county_names.get(normal(name))
                            if not code:continue
                            expected=f'{year-1911}年'+(f' (1~{end}月)' if year==2026 and period=='available' else '')
                            if period=='available' and time==expected:selected[code].append(r)
                            elif period=='half' and re.fullmatch(rf'{year-1911}年 [1-6]月',time):selected[code].append(r)
                        if set(selected)!=set(records):raise ValueError('Missing official county statistics')
                        for code,items in selected.items():
                            if len(items)!=(6 if period=='half' else 1):raise ValueError('Incomplete or duplicate official period')
                            records[code][kind]={k:sum(number(r[name]) for r in items) for name,k in OFFICIAL.items()}
                    for kind in ['cases','suspects']:
                        for k in keys:
                            residual=records['TW'][kind][k]-sum(records[c['code']][kind][k] for c in counties)
                            if residual<0:raise ValueError('Negative central-agency residual')
                            records['TW']['unassigned'][f'{kind}:{k}']=residual
                selected_sources=[item for item in sources['resources'] if item['kind']=='regional' and item['year']==year and item['startMonth']<=end] if scope=='regional' else [item for item in sources['resources'] if item['kind'] in ['cases','suspects']]
                meta={'schemaVersion':1,'year':year,'scope':scope,'period':period,'endMonth':end,'complete':end==12,'categories':keys,'populationLabel':f'{year-1} 年底與 {year} 年 {end} 月底平均戶籍人口','sourceUrls':['https://data.gov.tw/dataset/14200'] if scope=='regional' else ['https://data.gov.tw/dataset/9603','https://data.gov.tw/dataset/9604'],'sources':selected_sources,'records':records}
                path=f'{year}/{scope}-{period}.json';write(DEST/path,meta)
                manifests.append({k:meta[k] for k in ['year','scope','period','endMonth','complete','categories'] }|{'file':path})
                print(year,scope,period,records['TW']['cases']['total'],'cases')
    write(DEST/'manifest.json',{'schemaVersion':1,'snapshots':manifests})

if __name__=='__main__': main()
