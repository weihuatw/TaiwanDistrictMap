#!/usr/bin/env python3
"""Read the Ministry of Education's public school search (ASP.NET form)."""
import hashlib,http.cookiejar,json,urllib.request,urllib.parse
from datetime import datetime
from pathlib import Path
from lxml import html
ROOT=Path(__file__).resolve().parents[2];URL='https://stats.moe.gov.tw/edugissys/default.aspx'
RAW=ROOT/'data/raw/school';sources=[];schools=[]
for level,label in [('elementary','國小'),('junior','國中')]:
 jar=http.cookiejar.CookieJar();client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
 source=client.open(URL,timeout=60).read();x=html.fromstring(source)
 params=[(e.get('name'),'3' if e.get('name')=='ctytown' else e.get('value','')) for e in x.xpath('//input[@type="hidden"]')]
 params += [(e.get('name'),e.get('value','')) for e in x.xpath('//input[@type="text"]') if e.get('name')]
 params += [(e.get('name'),e.get('value','')) for e in x.xpath('//input[@type="checkbox"][@checked]') if e.get('name')]
 params += [('areatype','0'),('CityName','0'),('DistName','0'),('lv',label),('Button2','學校搜尋')]
 result=client.open(URL,urllib.parse.urlencode(params).encode(),timeout=90).read()
 (RAW/('moe-'+level+'.html')).write_bytes(result);x=html.fromstring(result)
 values=x.xpath('//input[@name="RadioButtonList1"]/@value')
 if len(values)<900:raise ValueError('Incomplete MOE school search')
 for value in values:
  fields=value.split('|')
  schools.append(dict(code=fields[6],name=fields[2],countyName=fields[7],townName=fields[8],position=[float(fields[0]),float(fields[1])],level=level,sourceId='moe-'+level,address=fields[3],website=fields[5],public=fields[13]!='私立'))
 sources.append(dict(id='moe-'+level,title='教育部全臺'+label+'地理資訊名錄',provider='教育部統計處',datasetUrl=URL,downloadUrl=URL,release=datetime.now().astimezone().strftime('%Y-%m-%d')+'公開名錄查詢；頁面未註資料學年度',downloadedAt=datetime.now().astimezone().isoformat(timespec='seconds'),sha256=hashlib.sha256(result).hexdigest(),bytes=len(result),records=len(values)))
 print(level,len(values),flush=True)
(ROOT/'data/school/moe-schools.json').write_text(json.dumps(schools,ensure_ascii=False,separators=(',',':'))+'\n')
(ROOT/'data/school/moe-sources.json').write_text(json.dumps(sources,ensure_ascii=False,indent=2)+'\n')
