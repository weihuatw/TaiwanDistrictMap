import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {resolveVillageLinks} from './village-links.mjs';
import {booleanPointInPolygon,point} from '@turf/turf';

export const normalize = value => (value ?? '').normalize('NFKC').replace(/\s/g,'').replaceAll('台','臺');
export function schoolKey(value, towns=[]) {
  let name=normalize(value);
  const counties=[...new Set(towns.map(t=>normalize(t.properties.countyName)))];
  const county=counties.find(c=>name.startsWith(c));
  if(county){name=name.slice(county.length);if(name.startsWith('立'))name=name.slice(1);}
  name=name.replace(/^國立|^市立|^縣立|^私立|^連江縣立|^金門縣立/,'');
  const district=towns.map(t=>normalize(t.properties.name)).sort((a,b)=>b.length-a.length).find(t=>name.startsWith(t));
  if(district)name=name.slice(district.length);
  return name.replace(/^國立|^市立|^縣立|^私立|^連江縣立|^金門縣立/,'').replace(/\([^)]*\)|（[^）]*）/g,'').replace(/國民中小學|國中小|中小學/g,'').replace(/國小部|國中部|國民小學|國民中學|國小|國中|實小|實中|高級中等學校|高級中學|高中|中學|附設|附小|實驗/g,'').replace(/學校財團法人/g,'');
}
export async function attachNational({root,records,campuses,shelters,towns,villages,school}) {
  const rows=[...JSON.parse(await readFile(path.join(root,'data/build/school/national-rows.json'),'utf8')),...JSON.parse(await readFile(path.join(root,'data/school/site-rows.json'),'utf8'))];
  const unmatchedSchools=[]; const unmatchedVillages=[];const missingPositions=[];
  const countyTowns=new Map();const countyVillages=new Map();
  for(const t of towns) { const a=countyTowns.get(t.properties.countyCode)??[];a.push(t);countyTowns.set(t.properties.countyCode,a); }
  for(const v of villages) { const a=countyVillages.get(v.properties.countyCode)??[];a.push(v.properties);countyVillages.set(v.properties.countyCode,a); }
  const moe=JSON.parse(await readFile(path.join(root,'data/school/moe-schools.json'),'utf8'));
  // The ministry roster supplies identities and includes departments/private schools absent from the campus map.
  for(const [id,r] of records)if(r.countyCode!=='63000')records.delete(id);
  const locations=[];
  for(const m of moe){
    const sourceTown=towns.find(t=>normalize(t.properties.countyName)===normalize(m.countyName)&&t.properties.name===m.townName);
    if(!sourceTown){missingPositions.push({code:m.code,name:m.name,reason:'unknown administrative name'});continue;}
    const ct=countyTowns.get(sourceTown.properties.countyCode);
    const geo=ct.find(t=>booleanPointInPolygon(point(m.position),t));
    const campus=campuses.find(c=>c.town.countyCode===sourceTown.properties.countyCode&&schoolKey(c.name,ct)===schoolKey(m.name,ct)&&(/小學|國小|中小/.test(c.name)?m.level==='elementary':m.level==='junior'));
    if(!geo&&!campus){missingPositions.push({code:m.code,name:m.name,reason:'official point outside county geometry'});continue;}
    const c={name:m.name,code:m.code,level:m.level,town:geo?.properties??campus.town,position:geo?m.position:campus.position,sourceId:geo?m.sourceId:campus.sourceId,objectId:geo?m.code:campus.objectId,area:0};
    locations.push(c);
    if(c.town.countyCode==='63000')continue;
    const id=m.code+'-'+m.level;records.set(id,school(c,m.level,id,m.name,m.code));
  }
  const groups=new Map();
  for(const row of rows) {
    const key=[row.countyCode,row.level,row.name,row.townName].join('|');
    const previous=groups.get(key);if(previous){previous.parts.push(...row.parts);previous.notes += '\n'+row.notes;}else groups.set(key,{...row,parts:[...row.parts]});
  }
  let matched=0;const excludedSchools=[];
  const coverage=[];
  const nationalAliases=JSON.parse(await readFile(path.join(root,'data/school/aliases.json'),'utf8'));
  for(const row of groups.values()) {
    if(/廢校|裁併|裁校|已停辦|學年度起停辦|學區併入/.test(row.parts.map(p=>p.text).join('')+row.notes)){excludedSchools.push(row);continue;}
    let ct=countyTowns.get(row.countyCode)??[];
    if(row.townName&&!ct.some(t=>t.properties.name===row.townName)){
      const other=towns.filter(t=>t.properties.name===row.townName);
      if(other.length===1){row.countyCode=other[0].properties.countyCode;ct=countyTowns.get(row.countyCode);}
    }
    const key=schoolKey(row.name,ct);
    const preferred=nationalAliases.schools[row.countyCode+'|'+row.name];
    let catalog=locations.filter(c=>c.town.countyCode===row.countyCode&&c.level===row.level&&(row.code?c.code===row.code:schoolKey(c.name,ct)===key));
    if(!catalog.length&&preferred)catalog=locations.filter(c=>c.town.countyCode===row.countyCode&&c.level===row.level&&schoolKey(c.name,ct)===schoolKey(preferred,ct));
    let candidates=campuses.filter(c=>c.town.countyCode===row.countyCode&&(preferred?c.name===preferred:schoolKey(c.name,ct)===key));
    if(catalog.length)candidates=catalog;
    if(row.level==='elementary') candidates=candidates.filter(c=>/小學|國小|中小|分校|分班/.test(c.name)||c.level==='elementary'||preferred||/高中|高級|國小部/.test(row.name));
    else {
      candidates=candidates.filter(c=>/中學|國中|中小/.test(c.name)||c.level==='junior'||preferred);
      const ordinary=candidates.filter(c=>/中學|國中|中小/.test(c.name)&&!/高級|高中/.test(c.name));
      const high=candidates.filter(c=>/高級|高中/.test(c.name));
      if(/高中|高級|附中/.test(row.name)&&high.length)candidates=high;
      else if(!/高中|高級|附中/.test(row.name)&&ordinary.length)candidates=ordinary;
    }
    const partTowns=new Set(row.parts.map(p=>p.townName));
    const hint=candidates.filter(c=>partTowns.has(c.town.name));
    if(hint.length===1)candidates=hint;
    if(/高中|高級/.test(row.name)&&!row.name.startsWith('國立')){const municipal=candidates.filter(c=>!c.name.startsWith('國立'));if(municipal.length)candidates=municipal;}
    const inTown=candidates.filter(c=>c.town.name===normalize(row.townName));if(inTown.length)candidates=inTown;
    if(candidates.length>1&&new Set(candidates.map(c=>c.town.code)).size===1){
      const [a,b]=candidates;
      if(Math.hypot(a.position[0]-b.position[0],a.position[1]-b.position[1])<0.003)candidates=[candidates.reduce((x,y)=>x.area>y.area?x:y)];
    }
    if(candidates.length===0){
      const points=shelters.filter(s=>schoolKey(s.name,ct)===key).map(s=>{
        const t=ct.find(t=>normalize(t.properties.countyName+t.properties.name)===normalize(s.town));
        const position=s.position.map(Number);
        return t&&position.every(Number.isFinite)&&booleanPointInPolygon(point(position),t)?{name:row.name,town:t.properties,position,sourceId:'taipei-shelters',objectId:s.objectId,area:0}:null;
      }).filter(Boolean);
      if(points.length===1)candidates=points;
    }
    if(candidates.length!==1){unmatchedSchools.push({countyCode:row.countyCode,name:row.name,level:row.level,town:row.townName,sourceId:row.sourceId,candidates:candidates.map(c=>c.name)});continue;}
    const c=candidates[0]; const id=c.code?c.code+'-'+row.level:`${c.sourceId}-${c.objectId}-${row.level}`;
    let r=records.get(id)??[...records.values()].find(r=>r.countyCode===c.town.countyCode&&r.level===row.level&&schoolKey(r.name,ct)===schoolKey(c.name,ct));if(!r){r=school(c,row.level,id);records.set(id,r);}
    if(!r.catchment)r.catchment={year:row.year,sourceId:row.sourceId,sourceIds:[],villages:[],text:'',notes:''};
    r.catchment.sourceIds??=[];if(!r.catchment.sourceIds.includes(row.sourceId))r.catchment.sourceIds.push(row.sourceId);
    r.catchment.text += row.parts.map(p=>(p.townName?p.townName+'：':'')+p.text).join('\n')+'\n';
    r.catchment.notes += row.notes+'\n';
    matched++;
    for(const part of row.parts){
      let text=part.text;
      for(const other of groups.values())if(other.name?.length>2)text=text.replaceAll(other.name,'【學校】');
      const result=resolveVillageLinks({text,countyCode:row.countyCode,townName:part.townName||c.town.name,omitVillageSuffix:part.omitVillageSuffix&&!/等國小學區|之學區/.test(text),shared:part.shared,partial:part.partial,villageAliases:nationalAliases.villages},villages.map(v=>v.properties),towns.map(t=>({name:t.properties.name,countyName:t.properties.countyName,countyCode:t.properties.countyCode})));
      for(const v of result.links)add(r,v,v.partial,v.shared);
      for(const v of result.unresolved){
        unmatchedVillages.push({schoolId:r.id,sourceId:row.sourceId,...v});
        r.catchment.unresolvedVillages??=[];
        if(!r.catchment.unresolvedVillages.includes(v.name))r.catchment.unresolvedVillages.push(v.name);
      }
    }
    // Some official tables place a school's only mapped range in a note such as
    // "共同學區：甲里、乙里" while leaving the main catchment cell empty.
    for(const note of row.notes.matchAll(/(?:共同|自由)學區\s*[:：]\s*([^。；;]*)/gu)){
      const scope=note[1];if(!scope.trim())continue;
      const result=resolveVillageLinks({text:scope,countyCode:row.countyCode,townName:c.town.name,omitVillageSuffix:true,shared:/共同學區/u.test(note[0]),villageAliases:nationalAliases.villages},villages.map(v=>v.properties),towns.map(t=>({name:t.properties.name,countyName:t.properties.countyName,countyCode:t.properties.countyCode})));
      for(const v of result.links)add(r,v,v.partial,v.shared);
      for(const v of result.unresolved){
        unmatchedVillages.push({schoolId:r.id,sourceId:row.sourceId,...v});
        r.catchment.unresolvedVillages??=[];
        if(!r.catchment.unresolvedVillages.includes(v.name))r.catchment.unresolvedVillages.push(v.name);
      }
    }
    // These official notes make every resident of the county eligible outside
    // the ordinary assigned zones, so expose the county as a shared catchment.
    if(/設籍本縣之學生|得不受本縣學區限制/u.test(row.notes)){
      const result=resolveVillageLinks({text:'全縣',countyCode:row.countyCode,townName:c.town.name,shared:true,villageAliases:nationalAliases.villages},villages.map(v=>v.properties),towns.map(t=>({name:t.properties.name,countyName:t.properties.countyName,countyCode:t.properties.countyCode})));
      for(const v of result.links)add(r,v,v.partial,v.shared);
    }
  }

  function add(r,v,partial,shared){
    const old=r.catchment.villages.find(p=>p.code===v.code);
    if(old){old.partial&&=partial;old.shared||=shared;}else r.catchment.villages.push({code:v.code,name:v.name,townCode:v.townCode,townName:v.townName,partial,shared});
  }
  for(const r of records.values()){
    if(r.level!=='junior'||!r.catchment||r.catchment.villages.length)continue;
    const text=normalize(r.catchment.text);
    if(!/等國小學區|國小.*之學區|各國小學區/.test(text))continue;
    const ct=countyTowns.get(r.countyCode);
    for(const child of records.values()){
      if(child.level!=='elementary'||child.countyCode!==r.countyCode||!child.catchment?.villages.length)continue;
      const key=schoolKey(child.name,ct);
      const regex=new RegExp(`(?:^|[^\\p{L}])${key}(?=國小|[、,，(])`,'u');
      if(regex.test(text))for(const v of child.catchment.villages)add(r,v,v.partial,v.shared||/共同學區/.test(text));
    }
  }
  for(const [code,ct] of countyTowns){
    const schools=[...records.values()].filter(r=>r.countyCode===code);
    const sourceRows=[...groups.values()].filter(r=>r.countyCode===code);
    coverage.push({countyCode:code,countyName:ct[0].properties.countyName,schools:schools.length,withCatchment:schools.filter(r=>r.catchment).length,sourceSchools:code==='63000'?212:sourceRows.length,unmatchedSchools:unmatchedSchools.filter(r=>r.countyCode===code).length,years:[...new Set(schools.map(r=>r.catchment?.year).filter(Number.isFinite))].sort()});
  }
  return {matchedRows:matched,missingPositions,excludedSchools,coverage,unmatchedSchools,unmatchedVillages};
}
