#!/usr/bin/env python3
"""Fetch every ODRP018 page for one explicitly requested month."""
import hashlib, json, pathlib, sys, urllib.request, datetime, tempfile, shutil, os
ROOT = pathlib.Path(__file__).resolve().parents[2]
month = sys.argv[1] if len(sys.argv) > 1 else '11508'
if len(month) != 5 or not month.isdigit() or not 1 <= int(month[3:]) <= 12: raise SystemExit('用法: npm run indigenous:fetch -- 11508')
base = f'https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP018/{month}?PAGE='
out = ROOT / 'data/raw/indigenous' / month
out.parent.mkdir(parents=True, exist_ok=True)
payloads=[]
def get(page):
    req = urllib.request.Request(base+str(page), headers={'User-Agent':'TaiwanDistrictMap data pipeline'})
    with urllib.request.urlopen(req, timeout=30) as response: return json.load(response)
first = get(1)
if not str(first.get('responseCode', '')).endswith('-S'): raise SystemExit(f"官方 API 回應錯誤: {first.get('responseCode')}")
pages = int(first['totalPage']); total = int(first['totalDataSize']); all_data=[]
for page in range(1, pages+1):
    payload = first if page == 1 else get(page)
    if not str(payload.get('responseCode', '')).endswith('-S'): raise SystemExit(f'第 {page} 頁 API 回應錯誤: {payload.get("responseCode")}')
    if int(payload.get('page', page)) != page or int(payload['totalPage']) != pages or int(payload['totalDataSize']) != total: raise SystemExit(f'第 {page} 頁 metadata 不一致')
    rows = payload.get('responseData')
    if not isinstance(rows, list): raise SystemExit(f'第 {page} 頁沒有 responseData')
    body = json.dumps(payload, ensure_ascii=False, separators=(',',':'))+'\n'
    payloads.append((page, body))
    all_data.extend(rows)
if len(all_data) != total: raise SystemExit(f'總列數不符：{len(all_data)} != {total}')
merged={'sourceMonth':month,'totalPage':pages,'totalDataSize':total,'responseData':all_data}
raw=json.dumps(merged,ensure_ascii=False,separators=(',',':'))+'\n'
root_raw=ROOT/'data/raw/indigenous'; temp=pathlib.Path(tempfile.mkdtemp(prefix=f'.{month}-',dir=root_raw))
try:
    page_rows=[]
    for page,body in payloads:
        path=temp/f'page-{page}.json';path.write_text(body);page_rows.append({'page':page,'url':base+str(page),'sha256':hashlib.sha256(body.encode()).hexdigest()})
    (temp/'merged.json').write_text(raw)
    reg=ROOT/'data/indigenous/sources.json'; registry=json.loads(reg.read_text()) if reg.exists() else {'months':{}}
    months=registry.setdefault('months',{})
    months[month]={'sourceMonth':month,'period':f"{1911+int(month[:3]):04d}-{month[3:5]}",'retrievedAt':datetime.date.today().isoformat(),'totalPage':pages,'totalDataSize':total,'pages':page_rows,'mergedSha256':hashlib.sha256(raw.encode()).hexdigest()}
    regtmp=reg.with_suffix('.json.tmp');regtmp.write_text(json.dumps(registry,ensure_ascii=False,indent=2)+'\n')
    backup=root_raw/f'.{month}.previous'
    if backup.exists():shutil.rmtree(backup)
    if out.exists():os.replace(out,backup)
    try:
        os.replace(temp,out);os.replace(regtmp,reg)
    except Exception:
        if backup.exists():
            if out.exists():shutil.rmtree(out)
            os.replace(backup,out)
        raise
    if backup.exists():shutil.rmtree(backup)
finally:
    if temp.exists():shutil.rmtree(temp,ignore_errors=True)
print(f"已取得 {pages} 頁、{len(all_data)} 筆；SHA-256 {months[month]['mergedSha256']}")
