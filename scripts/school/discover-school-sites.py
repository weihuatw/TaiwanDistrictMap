#!/usr/bin/env python3
"""Find catchment/overview links on official school sites for counties lacking central tables."""
import concurrent.futures,json,subprocess,urllib.parse
from pathlib import Path
from lxml import html
ROOT=Path(__file__).resolve().parents[2];RAW=ROOT/'data/raw/school/sites';RAW.mkdir(parents=True,exist_ok=True)
records=json.loads((ROOT/'data/school/moe-schools.json').read_text());sites={}
for r in records:
 if r['countyName'] in ['嘉義縣','連江縣'] and r['website'].strip():sites.setdefault(r['website'].replace('http://','https://').rstrip('/'),[]).append(r)
def run(item):
 url,schools=item;key=schools[0]['code'];file=RAW/(key+'-home.html')
 try:
  if not file.exists():subprocess.run(['curl','-fLsS','--retry','1','--max-time','18','-o',str(file),url],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  doc=html.fromstring(file.read_bytes().decode('utf-8',errors='replace'));links=[]
  for a in doc.xpath('//a[@href]'):
   label=''.join(a.itertext()).strip();u=urllib.parse.urljoin(url,a.get('href'))
   if any(w in label for w in ['學區','學校概況','學校簡介','學校沿革','本校概況','校史','學校介紹','校園簡介','學校願景']) and len(label)<100:links.append(dict(title=label,url=u))
  return dict(schools=[dict(code=s['code'],name=s['name'],level=s['level'],county=s['countyName'],town=s['townName']) for s in schools],url=url,file=str(file.relative_to(ROOT)),links=links)
 except Exception as e:return dict(url=url,schools=[dict(code=s['code'],name=s['name']) for s in schools],error=type(e).__name__)
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as p:result=list(p.map(run,sites.items()))
(ROOT/'data/build/school/school-site-links.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
print('sites',len(result),'with links',sum(bool(r.get('links')) for r in result),'errors',sum('error' in r for r in result))
for r in result:
 if r.get('links'):print(r['schools'][0]['name'],[(a['title'],a['url']) for a in r['links'] if '學區' in a['title']])
