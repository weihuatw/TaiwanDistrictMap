#!/usr/bin/env python3
"""Extract source rows before matching schools or villages; preserve raw wording."""
import csv,json,re,unicodedata,zipfile
from pathlib import Path
from lxml import html,etree
import pdfplumber
ROOT=Path(__file__).resolve().parents[2];RAW=ROOT/'data/raw/school/nationwide';OUT=ROOT/'data/build/school'

def clean(t):return re.sub(r'\s+','',unicodedata.normalize('NFKC',t or '')).replace('台','臺')
def level(n,default='elementary'):
 if '國小部' in n:return 'elementary'
 return 'junior' if '國中部' in n or '實中' in n or '高中' in n or '中學' in n or '國中' in n and '國小部' not in n else default if default!='both' else 'elementary'
def is_school(n):return bool(re.search(r'國[小中]|實[小中]|中[小]?學|分[校班]|附小|附中',n))
rows=[]
town_names={}
all_town_names={f['properties']['name'] for file in (ROOT/'public/data/towns').glob('*.geojson') for f in json.loads(file.read_text())['features']}
def clean_town(value,county):
 value=clean(value)
 if county not in town_names:
  town_names[county]=[f['properties']['name'] for f in json.loads((ROOT/f'public/data/towns/{county}.geojson').read_text())['features']]
 names=all_town_names
 if value in names:return value
 return next((n for n in sorted(names,key=len,reverse=True) if value=='國中部'+n or value=='國小部'+n),'')
def emit(s,name,town,parts,notes='',page=None):
 name=clean(name).lstrip('★◎※');town=clean_town(town,s['countyCode'])
 if any(w in name for w in ['劃分表','範圍一覽表']):return
 if not name or name in ['學校名稱','校名','學區學校','學校','國小','國中']:return
 name=re.sub(r'\((?:總量管制|實驗教育學校|總量管制學校)\)','',name)
 omit=s['id'].startswith(('taoyuan','hsinchucity')) or s['id'] in ['keelung','tainan-junior','taitung-junior','newtaipei-junior']
 for v in parts:
  v['townName']=clean_town(v['townName'],s['countyCode'])
  v['omitVillageSuffix']=omit or bool(re.search(r'等[村里]',clean(v['text']))) or bool(re.fullmatch(r'[\u4e00-\u9fff]{2,3}',clean(v['text'])))
 rows.append(dict(name=name,townName=town,countyCode=s['countyCode'],level=level(name,s['level']),year=s['year'],sourceId=s['id'],page=page,parts=parts,notes=notes))
def part(text,town='',shared=False,partial=False):return dict(text=text or '',townName=clean(town),shared=shared,partial=partial)

def tables(s):
 cache=OUT/(s['id']+'-tables.json')
 if cache.exists():return json.loads(cache.read_text())
 file=RAW/(s['id']+'.pdf')
 with pdfplumber.open(file) as doc:
  result=[]
  for i,p in enumerate(doc.pages):
   # Word draws border strips and text/background rectangles; only border strips are table edges.
   edges=[e for r in p.rects if r['width']<3 or r['height']<3 for e in pdfplumber.utils.rect_to_edges(r)]
   cfg={'vertical_strategy':'explicit','horizontal_strategy':'explicit','explicit_vertical_lines':[e for e in edges if e['orientation']=='v'],'explicit_horizontal_lines':[e for e in edges if e['orientation']=='h']}
   ts=p.find_tables(cfg) if len(edges)>10 else p.find_tables()
   result.append(dict(page=i+1,text=p.extract_text() or '',tables=[t.extract() for t in ts]))
 return result

def parse_pdf(s):
 pages=tables(s);(OUT/(s['id']+'-tables.json')).write_text(json.dumps(pages,ensure_ascii=False,indent=2))
 id=s['id'];current=None;schoolTown='';town=s.get('town','');lastColumns={}
 for p in pages:
  pageSource={**s}
  if s['level']=='both':
   heading=clean(p['text'][:170])
   if re.search('國民中學學區|國中學區',heading):pageSource['level']='junior'
   elif re.search('國民小學學區|國小學區',heading):pageSource['level']='elementary'
  if id.startswith('pingtung'):
   # Town headings are embedded in the table, not the school name.
   pass
  for t in p['tables']:
   if id=='penghu':
    group=[];junior='';elementary='';groupParts=[]
    def common_group():
     for name,schoolTown,lv in set(group):
      emit({**pageSource,'level':lv},name,schoolTown,[{**v,'shared':True} for v in groupParts],notes='共同自由學區；原學區學生優先，在可容納班級數量下開放其他共同學區學生就學。',page=p['page'])
    for rr in t:
     r=[v or '' for v in rr]+['']*4;n=[clean(v) for v in r]
     if n[0] and n[0]!='鄉市別':
      m=re.match(r'(.{2,4}?[鄉市])',n[0]);town=m.group(1) if m else town
     if '以上各國中' in n[1]:common_group();group=[];groupParts=[];continue
     if '全縣國中自由學區' in n[1]:continue
     if is_school(n[1]) and len(n[1])<25 and not any(w in n[1] for w in ['原(','自由學區']):junior=n[1]
     if n[2] and len(n[2])<22 and not any(w in n[2] for w in ['自由學區','優先','村','里']):
      elementary=n[2] if is_school(n[2]) else n[2]+'國小'
     if not r[3]:continue
     if junior and not n[1].startswith('原('):emit({**pageSource,'level':'junior'},junior,town,[part(r[3],town)],page=p['page']);group.append((junior,town,'junior'))
     if elementary:emit({**pageSource,'level':'elementary'},elementary,town,[part(r[3],town)],page=p['page']);group.append((elementary,town,'elementary'))
     groupParts.append(part(r[3],town))
    continue
   if id.startswith('taichung'):
    names=next((r for r in t[:3] if any(is_school(clean(v)) and len(clean(v))<30 for v in r[2:])),None)
    admins=next((r for r in t if any('行政' in clean(c) for c in r[:2])),None)
    villages=next((r for r in t if any(clean(c).endswith('里鄰') for c in r[:2])),None)
    addresses=next((r for r in t if clean(r[0])=='校址'),None)
    if not villages:continue
    name=''
    for j in range(2,len(villages)):
     if names and j<len(names) and names[j]:name=clean(names[j])
     elif not names:name=lastColumns.get(j,'')
     if not name:continue
     lastColumns[j]=name
     addr=clean(addresses[j]) if addresses and j<len(addresses) else ''
     towns=json.loads((ROOT/'public/data/towns/66000.geojson').read_text())['features']
     foundTown=next((x['properties']['name'] for x in towns if x['properties']['name'] in addr),'')
     admin=clean(admins[j]) if admins and j<len(admins) else ''
     emit(pageSource,name,foundTown,[part(villages[j],admin)],page=p['page'])
    continue
   for r in t:
    r=list(r)+['']*6;r=[v or '' for v in r];n=[clean(v) for v in r]
    if id.startswith('pingtung') and re.match(r'.{2,4}[鄉鎮市]各國民',n[0]):
     town=re.match(r'(.{2,4}[鄉鎮市])各國民',n[0]).group(1);continue
    if id.startswith('hsinchucity'):
     if is_school(n[1]) and len(n[1])<25:
      current=n[1];emit(pageSource,current,'',[part(r[2]),part(r[3],shared='共同學區' in r[4],partial=True)],notes=r[4],page=p['page'])
     elif current and not n[1] and n[3]:emit(pageSource,current,'',[part(r[3],partial=True,shared='共同學區' in r[4])],notes=r[4],page=p['page'])
     continue
    if id=='hualien':
     if is_school(n[0]) and len(n[0])<30:current=n[0];emit(pageSource,current,'',[part(r[1])],page=p['page'])
     elif not n[0] and current and r[1]:emit(pageSource,current,'',[part(r[1])],page=p['page'])
     continue
    if id=='taitung-junior' or id.startswith('pingtung'):
     if is_school(n[0]) and len(n[0])<35:current=n[0];emit(pageSource,current,town,[part(r[1])],r[2],p['page'])
     elif not n[0] and current and r[1]:emit(pageSource,current,town,[part(r[1])],r[2],p['page'])
     continue
    if id=='keelung':
     if is_school(n[0]) and len(n[0])<25:current=n[0]
     if current and re.fullmatch(r'.{1,4}區',n[1]) and r[2]:emit(pageSource,current,'',[part(r[2],n[1])],page=p['page'])
     continue
    if id.startswith('kaohsiung'):
     if is_school(n[1]) and len(n[1])<35:current=n[1];schoolTown=n[2] if n[2] else town
     if current and r[3] and n[1] not in ['校名','學校名稱']:
      if re.fullmatch(r'.{1,4}區',n[2]):town=n[2]
      emit(pageSource,current,schoolTown,[part(r[3],town)],page=p['page'])
     continue
    if id.startswith('tainan'):
     if is_school(n[2]) and len(n[2])<40:current=n[2]
     if n[1].endswith('區') and len(n[1])<5:town=n[1]
     if current and n[2] not in ['學校名稱','名稱'] and (r[3] or r[4]):emit(pageSource,current,town,[part(r[3],town),part(r[4],town,shared=True)],page=p['page'])
     continue
    if id=='nantou-junior':
     if is_school(n[0]) and len(n[0])<30:emit(pageSource,n[0],n[1],[part(r[2],n[1])],page=p['page'])
     continue
    if id=='yunlin':
     if is_school(n[1]) and len(n[1])<30:current=n[1];emit(pageSource,current,'',[part(r[2])],r[3],p['page'])
     elif not n[1] and current and r[2]:emit(pageSource,current,'',[part(r[2])],r[3],p['page'])
     continue
    if id=='kinmen':
     if is_school(n[0]) and len(n[0])<30:emit(pageSource,n[0],'',[part(r[2])],r[3],p['page'])
     continue
    # town / school / catchment format: Taoyuan, Changhua, Nantou elementary, Hsinchu County, Taitung elementary.
    if clean_town(n[0],s['countyCode']):town=clean_town(n[0],s['countyCode'])
    school=n[1]
    if id=='changhua' and school and len(school)<25 and school!='學校' and r[2]:school=school if is_school(school) else school+'國小'
    if is_school(school) and len(school)<40:current=school;emit(pageSource,current,town,[part(r[2],town)],r[3] if id not in ['taitung-elementary'] else r[4],p['page'])
    elif not school and current and r[2] and n[0] not in ['鄉鎮市','行政區']:emit(pageSource,current,town,[part(r[2],town)],page=p['page'])

for s in json.loads((ROOT/'data/school/national-sources.json').read_text()):
 fmt=s['format'];f=RAW/(s['id']+'.'+fmt)
 if not f.exists() or fmt=='page':continue
 start=len(rows)
 if fmt=='pdf':
  if f.read_bytes().startswith(b'%PDF'):parse_pdf(s)
 elif fmt=='csv':
  rs=list(csv.DictReader(f.open(encoding='utf-8-sig')))
  for r in rs:
   if s['id'].startswith('newtaipei'):emit(s,r['sname'],r['district'],[part(r['pzoon'],r['district']),part(r['fzoon'],r['district'],shared=True)],r['mark'])
   else:emit(s,r['校名'],'',[part(r['學區範圍'])])
 elif fmt=='html':
  doc=html.fromstring(f.read_bytes())
  for tr in doc.xpath('//tr'):
   cells=tr.xpath('./td|./th');r=[c.text_content().strip() for c in cells]
   if len(r)==3 and is_school(clean(r[1])) and len(clean(r[1]))<40:emit(s,r[1],r[0],[part(r[2],r[0])])
 elif fmt=='odt':
  with zipfile.ZipFile(f) as z:doc=etree.fromstring(z.read('content.xml'))
  ns={'t':'urn:oasis:names:tc:opendocument:xmlns:table:1.0','text':'urn:oasis:names:tc:opendocument:xmlns:text:1.0'};currentTown=''
  for tr in doc.xpath('//t:table-row',namespaces=ns):
   r=['\n'.join(c.xpath('.//text:p//text()',namespaces=ns)) for c in tr.xpath('./t:table-cell|./t:covered-table-cell',namespaces=ns)]
   if len(r)<3:continue
   if clean(r[0]).endswith(('鄉','鎮','市')):currentTown=clean(r[0])
   if is_school(clean(r[1])) and len(clean(r[1]))<40:emit(s,r[1],currentTown,[part(r[2],currentTown),part(r[3] if len(r)>3 else '',currentTown,shared=True)])
 print(s['id'],len(rows)-start,flush=True)
OUT.mkdir(parents=True,exist_ok=True);(OUT/'national-rows.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
print('TOTAL',len(rows))
