#!/usr/bin/env python3
"""Read only the school-background chapter from the official public curriculum portal."""
import concurrent.futures,hashlib,json,subprocess,urllib.parse,re
from pathlib import Path
from lxml import html
import pdfplumber
ROOT=Path(__file__).resolve().parents[2];RAW=ROOT/'data/raw/school/chiayi-backgrounds';RAW.mkdir(parents=True,exist_ok=True)
schools=[s for s in json.loads((ROOT/'data/school/moe-schools.json').read_text()) if s['countyName']=='嘉義縣' and s['public']]

def get(url,file):
 if not file.exists():
  temp=file.with_suffix(file.suffix+'.part');subprocess.run(['curl','-fLsS','--retry','1','--max-time','30','--max-filesize','15000000','-o',str(temp),url],check=True,stderr=subprocess.DEVNULL);temp.replace(file)
 return file.read_bytes()
def run(s):
 url='https://course.cyc.edu.tw/course/pub/cou_dsp.php?sch_id='+s['code']+'&q_year=115';file=RAW/(s['code']+'.html')
 try:
  doc=html.fromstring(get(url,file).decode('utf8',errors='replace'))
  links=[a for a in doc.xpath('//a[@href]') if 'cou_down' in a.get('href') and any(t in a.text_content() for t in ['學校現況','背景分析','學校概況','基本資料'])]
  if not links:return dict(school=s,url=url,error='No background chapter')
  link=links[0];u=urllib.parse.urljoin(url,link.get('href'));pdf=RAW/(s['code']+'.pdf');data=get(u,pdf)
  with pdfplumber.open(pdf) as d:text='\n'.join(p.extract_text() or '' for p in d.pages[:15])
  (RAW/(s['code']+'.txt')).write_text(text)
  return dict(school=s,url=url,downloadUrl=u,file=str(pdf.relative_to(ROOT)),sha256=hashlib.sha256(data).hexdigest(),bytes=len(data),excerpts=[text[max(0,m.start()-100):m.start()+650] for m in re.finditer('學區',text)])
 except Exception as e:return dict(school=s,url=url,error=type(e).__name__)
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as p:r=list(p.map(run,schools))
(ROOT/'data/build/school/chiayi-backgrounds.json').write_text(json.dumps(r,ensure_ascii=False,indent=2))
print('Schools',len(r),'chapters',sum('file' in x for x in r),'with catchment text',sum(bool(x.get('excerpts')) for x in r))
