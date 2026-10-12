#!/usr/bin/env python3
"""Normalize ODRP018 and join its numerator to the matching ODRP014 snapshot."""
import hashlib,json,pathlib,re,sys,shutil,tempfile,atexit,os,calendar
ROOT=pathlib.Path(__file__).resolve().parents[2]; month=sys.argv[1] if len(sys.argv)>1 else '11508'
if len(month)!=5 or not month.isdigit() or not 1<=int(month[3:])<=12: raise SystemExit('月份須為民國五碼年月，例如 11508')
period=f'{1911+int(month[:3]):04d}-{month[3:5]}'; last_day=calendar.monthrange(int(period[:4]),int(period[5:]))[1]
rawdir=ROOT/'data/raw/indigenous'/month
pages=sorted(rawdir.glob('page-*.json'))
if not pages: raise SystemExit(f'找不到 {rawdir}，先執行 indigenous:fetch')
page_payloads=[json.loads(p.read_text(encoding='utf-8-sig')) for p in pages]
if len(pages)!=int(page_payloads[0]['totalPage']) or any(not str(x.get('responseCode','')).endswith('-S') or int(x['page'])!=i+1 or int(x['totalPage'])!=len(pages) or int(x['totalDataSize'])!=int(page_payloads[0]['totalDataSize']) for i,x in enumerate(page_payloads)): raise SystemExit('分頁不完整或頁碼不連續')
rows=[r for p in page_payloads for r in p['responseData']]
if len(rows)!=int(page_payloads[0]['totalDataSize']): raise SystemExit('總筆數與 API metadata 不符')
source_index=json.loads((ROOT/'data/indigenous/sources.json').read_text()) if (ROOT/'data/indigenous/sources.json').exists() else {'months':{}}
source_registry=source_index.get('months',{}).get(month)
if not source_registry: raise SystemExit(f'{month} 缺少 data/indigenous/sources.json 來源登錄')
if source_registry:
 if source_registry.get('sourceMonth')!=month or source_registry.get('totalPage')!=len(pages) or source_registry.get('totalDataSize')!=len(rows): raise SystemExit('sources.json 與下載月份／頁數／總筆數不符')
 for i,payload in enumerate(page_payloads,1):
  actual=hashlib.sha256((rawdir/f'page-{i}.json').read_bytes()).hexdigest()
  expected=next((x['sha256'] for x in source_registry.get('pages',[]) if x.get('page')==i),None)
  if expected!=actual: raise SystemExit(f'第 {i} 頁 SHA-256 與來源登錄不符')
 merged_blob=(json.dumps({'sourceMonth':month,'totalPage':len(pages),'totalDataSize':len(rows),'responseData':rows},ensure_ascii=False,separators=(',',':'))+'\n').encode()
 if source_registry.get('mergedSha256')!=hashlib.sha256(merged_blob).hexdigest(): raise SystemExit('合併資料 SHA-256 與來源登錄不符')
tribes=json.loads((ROOT/'data/indigenous/tribes.json').read_text()); ids={t['id'] for t in tribes}
# Detect newly introduced aggregate fields. Identity-class fields (plain/mountain/pingpu) are not tribe totals.
allowed={'total','undeclared'}
seen=set()
for k in rows[0]:
 m=re.fullmatch(r'indigenous_([a-z]+)_[mf]',k)
 if m and m.group(1) not in allowed and not m.group(1).startswith(('plain','mountain','pingpu')): seen.add(m.group(1))
if seen != ids: raise SystemExit(f'族別欄位與 tribes.json 不一致，缺少 {sorted(seen-ids)}，多出 {sorted(ids-seen)}')
# Load the frozen same-month population denominator from existing public ODRP014 artifacts.
popdir=ROOT/'public/data/population'/period
pm=json.loads((popdir/'manifest.json').read_text())
if pm['period']!=period or pm['sourceMonth']!=month: raise SystemExit('人口分母快照月份不一致')
pop={}; denominator_shards=[]
for f in sorted((popdir/'villages').glob('*.json')):
 pop.update(json.loads(f.read_text())['records'])
 denominator_shards.append({'path':f.relative_to(ROOT).as_posix(),'sha256':hashlib.sha256(f.read_bytes()).hexdigest()})
boundaries={}
for f in (ROOT/'public/data/villages').glob('*.geojson'):
 for feature in json.loads(f.read_text())['features']:
  pr=feature['properties']
  if not pr.get('unassigned'): boundaries[pr['code']]=pr['name']
# County/town aggregates and village lookup are sourced from their established public population records.
county=json.loads((popdir/'counties.json').read_text())['records']
towns={}
for f in (popdir/'towns').glob('*.json'): towns.update(json.loads(f.read_text())['records'])
normalized={}; names=[]; no_boundary=[]
for row in rows:
 code=str(row.get('district_code','')).strip()
 if not re.fullmatch(r'\d{11}',code): raise SystemExit(f'非法村里代碼: {code!r}')
 if code in normalized: raise SystemExit(f'重複村里代碼: {code}')
 if str(row.get('statistic_yyymm'))!=month: raise SystemExit(f'統計年月錯誤: {code}')
 def num(key):
  value=row.get(key)
  if not isinstance(value,str) or not re.fullmatch(r'\d+',value.strip()): raise SystemExit(f'{code} 欄位 {key} 非非負整數: {value!r}')
  return int(value)
 male,female=num('indigenous_total_m'),num('indigenous_total_f'); total=num('indigenous_total')
 tv={t['id']:num(f"indigenous_{t['sourceStem']}_m")+num(f"indigenous_{t['sourceStem']}_f") for t in tribes}
 undeclared=num('indigenous_undeclared_m')+num('indigenous_undeclared_f')
 if male+female!=total or sum(tv.values())+undeclared!=total: raise SystemExit(f'{code} 性別或族別加總不符')
 denom=pop.get(code)
 if denom is None: raise SystemExit(f'原住民來源碼 {code} 在人口快照缺分母')
 denominator=int(denom['population'])
 if total>denominator: raise SystemExit(f'{code} 原住民人數大於總人口')
 rec={'code':code,'name':str(row.get('village','')).strip(),'countyCode':code[:5],'townCode':code[:8], 'totalPopulation':denominator,'indigenous':total,'male':male,'female':female,'undeclared':undeclared,'tribes':tv}
 # Preserve official-name vs boundary-name discrepancies for review.
 boundary_name=boundaries.get(code)
 if boundary_name and rec['name']!=boundary_name: names.append({'code':code,'sourceName':rec['name'],'boundaryName':boundary_name})
 if code not in boundaries: no_boundary.append(code)
 normalized[code]=rec
if len(normalized)!=len(rows): raise SystemExit('來源代碼非唯一')
expected=json.loads((ROOT/'data/indigenous/expected-exceptions.json').read_text())
expected_unmatched=set(expected['sourceWithoutBoundaryCodes'])
missing_boundary=set(boundaries)-set(normalized)
actual_unmatched=set(normalized)-set(boundaries)
if missing_boundary: raise SystemExit(f'具名界線缺少原住民來源資料: {sorted(missing_boundary)[:20]}')
if actual_unmatched!=expected_unmatched: raise SystemExit(f'無界線來源代碼與已審核例外不符: {sorted(actual_unmatched)}')
expected_names=set(json.loads((ROOT/'data/population/expected-exceptions.json').read_text())[month]['nameMismatches'])
if {x['code'] for x in names}!=expected_names: raise SystemExit('來源與界線名稱差異代碼和已審核清單不符')
# Aggregate with integers before any percentage calculation.
def aggregate(items,code,name,level):
 first=next(iter(items.values())); rec={'code':code,'name':name,'totalPopulation':sum(x['totalPopulation'] for x in items.values()),'indigenous':sum(x['indigenous'] for x in items.values()),'male':sum(x['male'] for x in items.values()),'female':sum(x['female'] for x in items.values()),'undeclared':sum(x['undeclared'] for x in items.values()),'tribes':{t['id']:sum(x['tribes'][t['id']] for x in items.values()) for t in tribes}}
 if level in ('town','village'):rec['countyCode']=first['countyCode']
 if level=='village':rec['townCode']=first['townCode']
 return rec
bytown={}; bycounty={}
for code,r in normalized.items(): bytown.setdefault(r['townCode'],{})[code]=r; bycounty.setdefault(r['countyCode'],{})[code]=r
# Include the no-boundary 三和村 in aggregate numerators and denominators, exactly once.
# Source denominator is integrated from its existing county/town official population aggregate delta.
for code in no_boundary:
 if code=='10013280006':
  r=normalized[code]; town=towns.get(code[:8]); countyrec=county.get(code[:5])
  if not town or not countyrec: raise SystemExit('三和村合法上層行政區不存在')
  # Aggregate denominators come from published ODRP014 village records; the source-only numerator remains included.
for code,r in normalized.items():
 bytown.setdefault(r['townCode'],{})[code]=r; bycounty.setdefault(r['countyCode'],{})[code]=r
outroot=ROOT/'public/data/indigenous'/period; stage=pathlib.Path(tempfile.mkdtemp(prefix='indigenous-',dir=ROOT/'public/data'))/period
atexit.register(shutil.rmtree,stage.parent,ignore_errors=True)
(stage/'towns').mkdir(parents=True); (stage/'villages').mkdir()
for town,items in bytown.items():
 towncode=town; recs={c:r for c,r in items.items()}
 (stage/'villages'/f'{town}.json').write_text(json.dumps({'schemaVersion':1,'period':period,'level':'village','parentCode':town,'records':recs},ensure_ascii=False,separators=(',',':'))+'\n')
 townrecord=aggregate(items,town,towns.get(town,{}).get('name',town),'town')
 ccode=town[:5]
 tf=stage/'towns'/f'{ccode}.json'
 old=json.loads(tf.read_text()) if tf.exists() else {'schemaVersion':1,'period':period,'level':'town','parentCode':ccode,'records':{}}
 old['records'][town]=townrecord; tf.write_text(json.dumps(old,ensure_ascii=False,separators=(',',':'))+'\n')
countyrecords={}
for ccode,items in bycounty.items():
 countyrecords[ccode]=aggregate(items,ccode,county.get(ccode,{}).get('name',ccode),'county')
(stage/'counties.json').write_text(json.dumps({'schemaVersion':1,'period':period,'level':'county','records':countyrecords},ensure_ascii=False,separators=(',',':'))+'\n')
national=aggregate(normalized,'TW','臺灣','national')
(stage/'national.json').write_text(json.dumps({'schemaVersion':1,'period':period,'level':'national','record':national},ensure_ascii=False,separators=(',',':'))+'\n')
manifest={'schemaVersion':1,'period':period,'sourceMonth':month,'label':f"民國{month[:3]}年{int(month[3:])}月底（{period}-{last_day:02d}）",'populationType':'registered','denominatorPeriod':period,'supportedTribes':tribes,'source':{'title':'現住原住民人口按性別、身分、原住民族別分（新增區域代碼）','agency':'內政部戶政司','catalogUrl':'https://data.gov.tw/dataset/77052','api':'https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP018','pages':source_registry.get('pages',[]) if source_registry else [],'mergedSha256':source_registry.get('mergedSha256') if source_registry else None},'denominatorSource':{'title':pm['source']['title'],'catalogUrl':pm['source']['catalogUrl'],'sourceSha256':pm['source']['sha256'],'shards':denominator_shards},'files':{'villages':f'{period}/villages/{{townCode}}.json','towns':f'{period}/towns/{{countyCode}}.json','counties':f'{period}/counties.json','national':f'{period}/national.json'},'report':f'{period}/join-report.json','counts':{'sourceVillages':len(rows),'matched':len(rows)-len(no_boundary),'sourceWithoutBoundary':len(no_boundary)}}
(stage/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
(stage/'join-report.json').write_text(json.dumps({'sourceMonth':month,'sourceRows':len(rows),'sourceWithoutBoundaryCodes':no_boundary,'nameDifferences':names},ensure_ascii=False,indent=2)+'\n')
outroot.parent.mkdir(parents=True,exist_ok=True);backup=outroot.with_name(f'.{period}.previous')
if backup.exists():shutil.rmtree(backup)
if outroot.exists():os.replace(outroot,backup)
rootman={'schemaVersion':1,'period':period,'sourceMonth':month,'files':f'{period}/manifest.json'}
root_path=ROOT/'public/data/indigenous/manifest.json';root_tmp=root_path.with_suffix('.json.tmp')
try:
 os.replace(stage,outroot)
 root_tmp.write_text(json.dumps(rootman,ensure_ascii=False,indent=2)+'\n')
 os.replace(root_tmp,root_path)
except Exception:
 if backup.exists():
  if outroot.exists():shutil.rmtree(outroot)
  os.replace(backup,outroot)
 raise
else:
 if backup.exists():shutil.rmtree(backup)
shutil.rmtree(stage.parent,ignore_errors=True)
print(f'完成 {period}: {len(rows)} rows, unmatched {no_boundary}, name differences {len(names)}')
