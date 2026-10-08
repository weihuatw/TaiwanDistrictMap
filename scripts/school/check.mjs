import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { booleanPointInPolygon, point } from '@turf/turf';
const json = async file => JSON.parse(await readFile(new URL('../../'+file, import.meta.url),'utf8'));
const manifest=await json('public/data/school/manifest.json');
const counties=(await json('public/data/counties.geojson')).features;
const towns=(await Promise.all(counties.map(c=>json(`public/data/towns/${c.properties.code}.geojson`)))).flatMap(c=>c.features);
const ids=new Set(), codes=new Set(), sourceIds=new Set(manifest.sources.map(s=>s.id));
const counts={schools:0,elementary:0,junior:0,withCatchment:0};
const villageCollections=new Map();let crossTown=0,partial=0,shared=0,mapped=0,taipei=0;
for(const t of towns){
 const schools=await json(`public/data/school/towns/${t.properties.code}.json`);
 for(const s of schools){
  assert.equal(s.countyCode,t.properties.countyCode);assert.equal(s.townCode,t.properties.code);
  assert.ok(!ids.has(s.id),`Duplicate school ${s.id}`);ids.add(s.id);
  assert.ok(['elementary','junior'].includes(s.level));assert.ok(s.name);
  if(s.code){assert.match(s.code,/^\d{6}[A-Z]?$/);const key=s.code+'|'+s.level;assert.ok(!codes.has(key),`Duplicate code/department ${key}`);codes.add(key);}
  if(s.position){assert.ok(s.position.length===2&&s.position.every(Number.isFinite));assert.ok(sourceIds.has(s.positionSource));assert.ok(booleanPointInPolygon(point(s.position),t),`School outside district: ${s.name}`);}
  counts.schools++;counts[s.level]++;
  if(!s.catchment)continue;
  counts.withCatchment++;if(s.countyCode==='63000')taipei++;
  assert.ok(s.catchment.year===null||s.catchment.year>=100&&s.catchment.year<=115);assert.ok(sourceIds.has(s.catchment.sourceId));
  for(const id of s.catchment.sourceIds??[])assert.ok(sourceIds.has(id));
  if(s.catchment.villages.length)mapped++;
  else assert.ok(s.catchment.text,'An unmapped catchment must retain its official text');
  const seen=new Set();
  for(const v of s.catchment.villages){
   assert.ok(!seen.has(v.code));seen.add(v.code);
   if(!villageCollections.has(v.townCode))villageCollections.set(v.townCode,await json(`public/data/villages/${v.townCode}.geojson`));
   const feature=villageCollections.get(v.townCode).features.find(f=>f.properties.code===v.code);
   assert.ok(feature,`${s.name}: missing village ${v.code}`);assert.equal(feature.properties.name,v.name);assert.equal(feature.properties.townCode,v.townCode);
   assert.equal(typeof v.partial,'boolean');assert.equal(typeof v.shared,'boolean');
   if(v.townCode!==s.townCode)crossTown++;if(v.partial)partial++;if(v.shared)shared++;
  }
 }
}
assert.deepEqual(counts,manifest.counts);assert.equal(taipei,212);assert.equal(manifest.schoolCounties.length,22);
assert.ok(mapped>3000&&partial>0&&shared>0&&crossTown>0);
const daguan=(await json('public/data/school/towns/65000060.json')).find(s=>s.level==='junior'&&s.name.includes('達觀'));
assert.ok(daguan);assert.deepEqual(new Set(daguan.catchment.villages.map(v=>v.name)),new Set(['德安里','小城里','吉祥里','玫瑰里','明城里','達觀里','雙城里','日興里','香坡里']));
const report=await json('public/data/school/join-report.json');assert.deepEqual(report.unmatchedSchools,[]);assert.deepEqual(report.unmatchedVillages,[]);
assert.equal(manifest.unmatchedSchools,report.national.unmatchedSchools.length);assert.equal(manifest.unmatchedVillages,report.national.unmatchedVillages.length);
console.log(`School data: ${counts.schools} records in 22 counties, ${counts.withCatchment} official catchment records (${mapped} with village geometry); ${partial} partial, ${shared} shared, ${crossTown} cross-district links verified.`);
