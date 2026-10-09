import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachNational } from './national.mjs';
import { writeVillageIndexes } from './village-index.mjs';
import { pointOnFeature, booleanPointInPolygon, area } from '@turf/turf';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const json = async (file) => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const write = async (file, data) => { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), JSON.stringify(data) + '\n'); };
const sources = [...await json('data/school/sources.json'), ...await json('data/school/national-downloads.json'),...await json('data/school/moe-sources.json'),...await json('data/school/site-sources.json')];
const nationalAliases = await json('data/school/aliases.json');
const counties = (await json('public/data/counties.geojson')).features;
const towns = (await Promise.all(counties.map(c => json(`public/data/towns/${c.properties.code}.geojson`)))).flatMap(c => c.features);
const norm = s => s.replaceAll('台', '臺').replace(/\s/g, '');
const shortName = s => norm(s).replace(/^.*?(?:縣|市)(?:.*?(?:區|鄉|鎮|市)|立|私立)?/, '').replace(/^國立|^市立|^縣立/, '').replace(/國民小學|國小|實小|國民中學|國中|實中|高級中學|高中|\(國中部\)|實驗|\d+$/g, '');
// Explicit aliases: never fuzzy-match different schools just because names resemble each other.
const aliases = {
  '國立臺北教大實小': '國立臺北教育大學附設實驗國民小學',
  '市立北市大附小': '臺北市立大學附設實驗國民小學',
  '國立師大附中(國中部)': '國立臺灣師範大學附屬高級中學',
  '國立政大附中(國中部)': '國立政治大學附屬高級中學',
  '市立北市大附中(國中部)': '臺北市立大理高級中學',
  '市立?公國中': '臺北市立瑠公國民中學',
};
const campuses = [];
const skippedLocations = [];
for (const zone of [119,121]) {
  await mkdir(path.join(root, 'data/build/school'), { recursive: true });
  const output = path.join(root, `data/build/school/campus-${zone}.geojson`);
  const result = spawnSync(path.join(root, 'node_modules/.bin/mapshaper'), ['-i', path.join(root, `data/raw/school/campus-${zone}/campus.shp`), '-proj', 'wgs84', '-o', output, 'format=geojson', 'force'], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Campus conversion failed: ${zone}`);
  for (const f of JSON.parse(await readFile(output, 'utf8')).features) {
    const name = norm(f.properties.BLOCKNAME).replace(/\d+$/, '');
    const point = pointOnFeature(f);
    const [x,y] = point.geometry.coordinates;
    const town = towns.find(t => { const b=t.properties.bounds; return x>=b[0]&&x<=b[2]&&y>=b[1]&&y<=b[3]&&booleanPointInPolygon(point,t); });
    if (!town) { skippedLocations.push({name, zone, objectId:f.properties.OBJECTID}); continue; }
    campuses.push({ name, town: town.properties, position: [Number(x.toFixed(6)),Number(y.toFixed(6))], area:area(f), sourceId:`campus-${zone}`, objectId:f.properties.OBJECTID });
  }
}
const largest = new Map();
for (const campus of campuses) {
  const key=campus.town.countyCode+'|'+campus.name;
  if (!largest.has(key)||largest.get(key).area<campus.area) largest.set(key,campus);
}
await write('data/build/school/campuses.json',[...largest.values()]);
const supplementResult=spawnSync('python3',['-c', `import csv,json,re,sys
from pathlib import Path
raw=Path(sys.argv[1])
rows=list(csv.DictReader(open(raw/'taipei-shelters.csv',encoding='utf-8-sig')))
r=next(r for r in rows if r['縣市及鄉鎮市區']=='臺北市中山區' and r['避難收容處所名稱']=='長安國小')
text=(raw/'taipei-garden.html').read_text()
if '市立和平實驗國小' not in text: raise ValueError('Wrong garden school')
lon=re.search(r'for="base_longitude" class="title">經度</label>\\s*([0-9.]+)度',text).group(1)
lat=re.search(r'for="base_latitude" class="title">緯度</label>\\s*([0-9.]+)度',text).group(1)
print(json.dumps({'343603':{'town':'中山區','position':[float(r['經度']),float(r['緯度'])],'source':'taipei-shelters'},'333611':{'town':'大安區','position':[float(lon),float(lat)],'source':'taipei-garden'}}))`,path.join(root,'data/raw/school')],{encoding:'utf8'});
if(supplementResult.status!==0) throw new Error(supplementResult.stderr);
const supplements=JSON.parse(supplementResult.stdout);
const records = new Map();
function school(campus, level, id, name=campus.name, code=null) {
  return { id, code, name, level, countyCode:campus.town.countyCode, countyName:campus.town.countyName,
    townCode:campus.town.code, townName:campus.town.name, position:campus.position,
    positionSource:campus.sourceId, positionObjectId:campus.objectId, catchment:null };
}
for (const c of largest.values()) {

  const levels = /國民中小學|國中小/.test(c.name) ? ['elementary','junior'] : /國民小學|國小/.test(c.name) ? ['elementary'] : /國民中學|國中/.test(c.name) ? ['junior'] : [];
  for (const level of levels) { const id=`${c.sourceId}-${c.objectId}-${level}`; records.set(id,school(c,level,id)); }
}
const villages = (await Promise.all((await readdir(path.join(root,'public/data/villages'))).filter(f=>f.endsWith('.geojson')).map(f=>json(`public/data/villages/${f}`)))).flatMap(c=>c.features);
const villageIndex = new Map(villages.map(v=>[norm(v.properties.countyName+'|'+v.properties.townName+'|'+v.properties.name),v.properties]));
const unmatchedSchools=[];
const supplementedSchools=[];
const unmatchedVillages=[];
const nameToId=new Map();
const official = [];
for (const level of ['elementary','junior']) {
  const result=spawnSync('python3',['-c', 'import csv,json,sys; print(json.dumps(list(csv.DictReader(open(sys.argv[1],encoding="utf-8-sig"))),ensure_ascii=False))',path.join(root,`data/raw/school/taipei-${level}.csv`)],{encoding:'utf8'});
  if(result.status!==0) throw new Error('CSV parsing failed');
  const rows=JSON.parse(result.stdout);
  const grouped=new Map();
  for(const r of rows) { const key=r['學校代碼']; if(!grouped.has(key)) grouped.set(key,[]); grouped.get(key).push(r); }
  for(const [code, entries] of grouped) {
    const name=entries[0]['學校名稱'];
    const preferred=aliases[name];
    const eligible=[...largest.values()].filter(c=>c.town.countyCode==='63000'&&(!name.startsWith('市立')||!c.name.includes('私立'))&&(preferred ? c.name===preferred : shortName(c.name)===shortName(name)));
    const candidates=eligible.filter(c=>/高中/.test(name) ? /高級中學/.test(c.name) : level==='elementary' ? /國民小學/.test(c.name) : /國民中學/.test(c.name));
    const match=preferred ? eligible : candidates;
    let c=match[0];
    if(match.length!==1) {
      const extra=supplements[code];
      if(!extra) { unmatchedSchools.push({code,name,level,candidates:match.map(c=>c.name)}); continue; }
      c={town:towns.find(t=>t.properties.countyCode==='63000'&&t.properties.name===extra.town).properties,position:extra.position,sourceId:extra.source,objectId:null};
      supplementedSchools.push({code,name,sourceId:extra.source,position:extra.position});
    }
    // Replace the campus-only entry with the official school-code entry.
    for(const [id,r] of records) if(c.position&&r.positionSource===c.sourceId&&r.positionObjectId===c.objectId&&r.level===level) records.delete(id);
    const id=`${code}-${level}`;
    const record=school(c,level,id,name==='市立?公國中'?'市立瑠公國中':name,code);
    record.catchment={year:115,sourceId:`taipei-${level}`,villages:[]};
    records.set(id,record);nameToId.set(level+'|'+name,id);
    official.push({id,level,entries});
  }
}
function addVillage(id, row, shared) {
  const record=records.get(id);
  const p=villageIndex.get(norm(row['縣市']+'|'+row['鄉鎮市區']+'|'+(row['村里']==='糖?里'?'糖廍里':row['村里'])));
  if(!p) { unmatchedVillages.push({schoolId:id,town:row['鄉鎮市區'],village:row['村里']});return; }
  // 99 / 999 is the table's whole-village sentinel. Display the complete geometry in either case.
  const partial=!(Number(row['（起始）鄰'])===1&&[99,999].includes(Number(row['（結束）鄰'])));
  const previous=record.catchment.villages.find(v=>v.code===p.code);
  if(previous) { previous.partial=previous.partial&&partial;previous.shared=previous.shared||shared;return; }
  record.catchment.villages.push({code:p.code,name:p.name,townCode:p.townCode,townName:p.townName,partial,shared});
}
for(const {id,level,entries} of official) for(const row of entries) {
  const common=row['共同學區學校']?.trim();
  addVillage(id,row,Boolean(common));
  for(const name of (common??'').split(/[，、,]/).filter(Boolean)) {
    const other=nameToId.get(level+'|'+name.trim());
    if(other) addVillage(other,row,true);
  }
}
const shelterResult=spawnSync('python3',['-c',`import csv,json,sys
r=list(csv.DictReader(open(sys.argv[1],encoding='utf-8-sig')))
print(json.dumps([{'name':x['避難收容處所名稱'],'town':x['縣市及鄉鎮市區'],'position':[x['經度'],x['緯度']],'objectId':x['序號']} for x in r],ensure_ascii=False))`,path.join(root,'data/raw/school/taipei-shelters.csv')],{encoding:'utf8'});
if(shelterResult.status!==0)throw new Error(shelterResult.stderr);
const shelters=JSON.parse(shelterResult.stdout);
const nationalReport = await attachNational({root, records, campuses:[...largest.values()], shelters, towns, villages, school});
for(const r of records.values()) r.catchment?.villages.sort((a,b)=>a.code.localeCompare(b.code));
for(const t of towns) await write(`public/data/school/towns/${t.properties.code}.json`,[...records.values()].filter(r=>r.townCode===t.properties.code).sort((a,b)=>a.name.localeCompare(b.name,'zh-Hant')));
await writeVillageIndexes([...records.values()], towns.map(t=>t.properties.code), root);
const report={national:nationalReport,unmatchedSchools,unmatchedVillages,supplementedSchools,skippedLocations,schoolAliases:aliases,villageAliases:{'萬華區 糖?里':'萬華區 糖廍里'},scopedVillageAliases:nationalAliases.villages};
await write('public/data/school/join-report.json',report);
const counts={schools:records.size,elementary:[...records.values()].filter(r=>r.level==='elementary').length,junior:[...records.values()].filter(r=>r.level==='junior').length,withCatchment:[...records.values()].filter(r=>r.catchment).length};
const usedSources=new Set([...records.values()].flatMap(r=>[r.positionSource,r.catchment?.sourceId,...(r.catchment?.sourceIds??[])]).filter(Boolean));
await write('public/data/school/manifest.json',{sources:sources.filter(s=>usedSources.has(s.id)),counts,schoolCounties:counties.map(c=>c.properties.code),catchmentCounties:[...new Set([...records.values()].filter(r=>r.catchment).map(r=>r.countyCode))],coverage:nationalReport.coverage,catchmentYear:115,
  villageIndex:'villages/{townCode}.json',
  notes:['學區依各縣市公告與官方學校資料收錄，學年度各自標示；未取得或未完整對照的學區會列出收錄狀態。','全臺學校位置主要採教育部地理資訊名錄，並以國土測繪中心校地代表點及官方校園點補足。未收錄的學區不以鄰近學校或距離推估；招生不採固定里界的學校請查看官方原文。','只要部分鄰屬於學區即標示整個里，共同學區亦納入；整里填色不代表全里皆屬於該校學區。'],unmatchedSchools:unmatchedSchools.length+nationalReport.unmatchedSchools.length,unmatchedVillages:unmatchedVillages.length+nationalReport.unmatchedVillages.length});
console.log(JSON.stringify({counts,unmatchedSchools,unmatchedVillages},null,2));
