import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {TrafficRepository,validEvent,validRecord} from '../../src/data/traffic.ts';
import {addressRegions} from './spatial.mjs';
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const base='public/data/traffic/';
const repo=new TrafficRepository(base,async path=>new Response(await fs.readFile(String(path))));
const fields=['accidents','injuries','deaths','located','villageAssigned'];
const sum=rows=>Object.fromEntries(fields.map(f=>[f,rows.reduce((s,r)=>s+r[f],0)]));
const counties=(await read('public/data/counties.geojson')).features;
const countyProperties=counties.map(c=>c.properties);
const townProperties=(await Promise.all(counties.map(c=>read(`public/data/towns/${c.properties.code}.geojson`)))).flatMap(d=>d.features.map(f=>f.properties));
for(const y of await repo.years()){
 const meta=await repo.manifest(y.year),report=await read(base+meta.report),national=meta.totals;
 assert.deepEqual(meta.months,y.months);assert.equal(meta.complete,y.complete);
 assert.equal(national.accidents,report.sourceEvents);
 assert.equal(national.accidents-national.located,report.invalidCoordinates+report.rejectedCoordinates);
 assert.equal(national.accidents-national.villageAssigned,report.noVillage);
 await repo.loadRegions('county',undefined,y.year);
 const ids=new Set();let totalPoints=0;
 const checkChildren=(parent,children)=>{const s=sum(children),missing=report.unassigned[parent.code];assert.ok(missing);for(const f of fields){assert.ok(missing[f]>=0);assert.equal(parent[f],s[f]+missing[f],`${y.year}:${parent.code}:${f}`)}};
 checkChildren(national,counties.map(c=>repo.get(c.properties.code,y.year)));
 for(const c of counties){
  const county=repo.get(c.properties.code,y.year);assert.ok(validRecord(county,c.properties.code));
  const events=await repo.events(c.properties.code,y.year);assert.equal(events.length,county.located);totalPoints+=events.length;
  const townEvent=new Map(),villageEvent=new Map();
  const add=(map,key,e)=>{if(!key)return;if(!map.has(key))map.set(key,{accidents:0,injuries:0,deaths:0});const v=map.get(key);v.accidents++;v.injuries+=e[7];v.deaths+=e[6]};
  for(const e of events){assert.ok(validEvent(e,y.year,c.properties.code));assert.ok(meta.months.includes(Number(e[3].slice(4,6))));assert.ok(!ids.has(e[0]));ids.add(e[0]);
   const address=addressRegions(e[10],countyProperties,townProperties);
   if(address.county)assert.equal(c.properties.code,address.county.code,`${e[0]}: event county conflicts with official address`);
   if(address.town&&e[8])assert.equal(e[8],address.town.code,`${e[0]}: event town conflicts with official address`);
   add(townEvent,e[8],e);add(villageEvent,e[9],e)}
  assert.ok(events.reduce((s,e)=>s+e[6],0)<=county.deaths);assert.ok(events.reduce((s,e)=>s+e[7],0)<=county.injuries);
  await repo.loadRegions('town',c.properties.code,y.year);
  const towns=(await read(`public/data/towns/${c.properties.code}.geojson`)).features;
  checkChildren(county,towns.map(t=>repo.get(t.properties.code,y.year)));
  for(const t of towns){
   const town=repo.get(t.properties.code,y.year);assert.ok(town);assert.equal(town.located,townEvent.get(t.properties.code)?.accidents??0);
   await repo.loadRegions('village',t.properties.code,y.year);
   const villages=(await read(`public/data/villages/${t.properties.code}.geojson`)).features;
   checkChildren(town,villages.map(v=>repo.get(v.properties.code,y.year)));
   for(const v of villages){const r=repo.get(v.properties.code,y.year);assert.ok(validRecord(r,v.properties.code));const s=villageEvent.get(v.properties.code)??{accidents:0,injuries:0,deaths:0};for(const f of ['accidents','injuries','deaths'])assert.equal(r[f],s[f]);assert.equal(r.located,r.accidents);assert.equal(r.villageAssigned,r.accidents)}
  }
 }
 const unmatched=await read(`${base}${y.year}/unmatched.json`);
 assert.equal(unmatched.length,report.noVillage);
 const rejected=unmatched.filter(e=>e.reason==='address-coordinate-conflict');
 assert.equal(rejected.length,report.rejectedCoordinates);
 assert.equal(rejected.filter(e=>e.spatialTownCode&&e.townCode&&e.spatialTownCode!==e.townCode).length,report.addressCoordinateTownMismatch);
 assert.equal(rejected.filter(e=>e.spatialCountyCode&&e.spatialCountyCode!==e.countyCode).length,report.addressCoordinateCountyMismatch);
 const byVillage={};const rejectedIds=new Set();
 for(const e of rejected){
  assert.ok(!ids.has(e.id),`${e.id}: rejected coordinate must not be published as an event point`);
  assert.ok(!rejectedIds.has(e.id));rejectedIds.add(e.id);
  const address=addressRegions(e.location,countyProperties,townProperties);
  assert.equal(e.countyCode,address.county?.code);assert.equal(e.townCode,address.town?.code??null);
  assert.ok((e.spatialTownCode&&address.town&&e.spatialTownCode!==address.town.code)||(e.spatialCountyCode&&e.spatialCountyCode!==address.county.code));
  if(e.spatialVillageCode)byVillage[e.spatialVillageCode]=(byVillage[e.spatialVillageCode]??0)+1;
 }
 assert.deepEqual(byVillage,report.coordinateConflictsByVillage);
 assert.equal(totalPoints,national.located);
 assert.equal(ids.size,totalPoints);
 console.log(`${y.year}: ${national.accidents.toLocaleString()} 件、${national.injuries.toLocaleString()} 傷、${national.deaths.toLocaleString()} 死、${totalPoints.toLocaleString()} 點位；逐層加總與未對照報告一致`);
}
