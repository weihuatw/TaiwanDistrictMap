#!/usr/bin/env python3
"""Fetch recorded official nationwide catchment sources, without guessing data."""
import concurrent.futures,hashlib,json,subprocess,urllib.parse
from datetime import datetime
from pathlib import Path
from lxml import html
ROOT=Path(__file__).resolve().parents[2]
RAW=ROOT/'data/raw/school/nationwide'

def download(url,file):
 file.parent.mkdir(parents=True,exist_ok=True)
 if file.exists() and file.stat().st_size>100: return file.read_bytes()
 temp=file.with_suffix(file.suffix+'.part')
 subprocess.run(['curl','-fLsS','--retry','2','--max-time','90','-o',str(temp),urllib.parse.quote(url,safe=':/?=&%')],check=True)
 temp.replace(file)
 return file.read_bytes()

def fetch(s):
 fmt=s['format'];file=RAW/(s['id']+'.'+('html' if fmt=='page' else fmt))
 data=download(s['downloadUrl'],file)
 if fmt=='page':
  doc=html.fromstring(data);links=[]
  for a in doc.xpath('//a[@href]'):
   u=urllib.parse.urljoin(s['datasetUrl'],a.get('href'));label=''.join(a.itertext()).strip()
   if any(x in u.lower() for x in ['.pdf','download.ashx','downloadfile','getfile']):
    links.append((label,u))
  (RAW/(s['id']+'-links.json')).write_text(json.dumps(links,ensure_ascii=False,indent=2))
  print(s['id'],'links',len(links),flush=True)
 else:print(s['id'],len(data),flush=True)
 return {**s,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'downloadedAt':datetime.fromtimestamp(file.stat().st_mtime).astimezone().isoformat(timespec='seconds')}

def main():
 sources=json.loads((ROOT/'data/school/national-sources.json').read_text())
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
  results=[]
  tasks={pool.submit(fetch,s):s for s in sources}
  for task in concurrent.futures.as_completed(tasks):
   try: results.append(task.result())
   except Exception as e: print('FAILED',tasks[task]['id'],str(e),flush=True)
 (ROOT/'data/school/national-downloads.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
if __name__=='__main__':main()
