import test from 'node:test';
import assert from 'node:assert/strict';
import { SchoolRepository, filterSchools } from '../src/apps/school/data.ts';
import { SchoolNavigator, polygonView } from '../src/apps/school/navigation.ts';

const region=(code,level)=>({type:'Feature',id:code,geometry:{type:'Polygon',coordinates:[]},properties:{code,name:code,level,countyCode:'63000',countyName:'臺北市',townCode:code,focusBounds:[121,24,122,26],bounds:[121,24,122,26]}});
const data=(...features)=>({type:'FeatureCollection',features});
const county=region('63000','county');const county2=region('65000','county');
const town=region('63000010','town');const town2=region('63000020','town');
const village=region('63000010001','village');const crossVillage=region('65000010001','village');
const camera={center:[121.5,25],zoom:12,bearing:0,pitch:0};
const elementary={id:'one-elementary',code:'one',name:'國小',level:'elementary',townCode:'63000010',position:[121.5,25],catchment:{year:115,sourceId:'taipei-elementary',villages:[{code:village.id,townCode:'63000010',partial:true,shared:true},{code:crossVillage.id,townCode:'65000010',partial:false,shared:true}]}};
const junior={...elementary,id:'two-junior',code:'two',name:'國中',level:'junior',catchment:null};
function fixture(overrides={}) {
  const events=[],busy=[],errors=[],loads=[];
  const nav=new SchoolNavigator({loadRegions:async file=>{loads.push(file);return file==='counties.geojson'?data(county,county2):data(town,town2);},loadSchools:async()=>[elementary,junior],loadCatchment:async s=>s.catchment?data(village,crossVillage):data(),onChange:(view,restore)=>events.push({view,restore}),onBusy:value=>busy.push(value),onError:(error,retry)=>errors.push({error,retry}),...overrides});
  return {nav,events,busy,errors,loads};
}
async function inTown(f) {await f.nav.start();await f.nav.enter(county,camera);await f.nav.enter(town,{...camera,zoom:13});}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('County → town → school overview never loads all village polygons, and back restores cameras',async()=>{
  const f=fixture();await inTown(f);assert.equal(f.nav.current.level,'school');assert.equal(polygonView(f.nav.current).data.features.length,0);assert.deepEqual(f.loads,['counties.geojson','towns/63000.geojson']);
  await f.nav.choose(elementary,{...camera,zoom:14});assert.equal(polygonView(f.nav.current).data.features.length,2);
  f.nav.back();assert.equal(f.nav.current.selected,null);assert.equal(f.nav.current.camera.zoom,14);assert.equal(f.events.at(-1).restore,true);
  f.nav.back();assert.equal(f.nav.current.level,'town');assert.equal(f.nav.current.camera.zoom,13);
  f.nav.back();assert.equal(f.nav.current.level,'county');assert.deepEqual(f.nav.current.camera,camera);
});
test('Filters default to both checked, allow neither, and clear a hidden school and its catchment',async()=>{
  const f=fixture();await inTown(f);assert.equal(f.nav.visibleSchools.length,2);await f.nav.choose(elementary,camera);
  f.nav.setFilter('elementary',false,camera);assert.equal(f.nav.current.selected,null);assert.equal(f.nav.current.catchment.features.length,0);assert.deepEqual(f.nav.visibleSchools,[junior]);
  f.nav.setFilter('junior',false,camera);assert.deepEqual(f.nav.visibleSchools,[]);
  f.nav.back();assert.deepEqual(f.nav.filter,{elementary:false,junior:false});
});
test('Switching schools restores the original overview, and missing catchment clears old fills',async()=>{
  const f=fixture();await inTown(f);await f.nav.choose(elementary,camera);await f.nav.choose(junior,{...camera,zoom:16});
  assert.equal(f.nav.current.selected.id,junior.id);assert.deepEqual(f.nav.current.catchment,data());f.nav.back();assert.deepEqual(f.nav.current.camera,camera);
});
test('Switching a gray county or district replaces the child path and schools',async()=>{
  const f=fixture();await inTown(f);assert.ok(f.nav.context.some(c=>c.region.id===county2.id&&c.parentIndex===0));assert.ok(f.nav.context.some(c=>c.region.id===town2.id&&c.parentIndex===1));
  await f.nav.enter(town2,undefined,1);assert.deepEqual(f.nav.current.path.map(r=>r.id),[county.id,town2.id]);
  await f.nav.enter(county2,undefined,0);assert.equal(f.nav.current.level,'town');assert.deepEqual(f.nav.current.path.map(r=>r.id),[county2.id]);assert.deepEqual(f.nav.current.schools,[]);
});
test('Newer school selection wins; back, filtering and teardown discard pending catchments',async()=>{
  for(const action of ['choose','back','filter','destroy']) {
    const pending=deferred();const f=fixture({loadCatchment:s=>s.id===elementary.id?pending.promise:Promise.resolve(data())});await inTown(f);
    const request=f.nav.choose(elementary,camera);
    if(action==='choose') await f.nav.choose(junior,camera);
    if(action==='back') f.nav.back();
    if(action==='filter') f.nav.setFilter('elementary',false,camera);
    if(action==='destroy') f.nav.destroy();
    const count=f.events.length;pending.resolve(data(village));await request;assert.equal(f.events.length,count);
    if(action==='choose') assert.equal(f.nav.current.selected.id,junior.id);
  }
});
test('Failed school selection keeps old state and retries; an empty school district is valid',async()=>{
  let attempts=0;const f=fixture({loadCatchment:async()=>{if(++attempts===1)throw new Error('offline');return data(village);}});await inTown(f);
  await f.nav.choose(elementary,camera);assert.equal(f.nav.current.selected,null);assert.equal(f.errors.length,1);await f.errors[0].retry();assert.equal(f.nav.current.selected.id,elementary.id);
  const empty=fixture({loadSchools:async()=>[]});await inTown(empty);assert.equal(empty.nav.current.level,'school');assert.deepEqual(empty.nav.visibleSchools,[]);
});
test('Catchment I/O includes cross-district villages and shared partial links without duplicates',async()=>{
  const repository=new SchoolRepository('/project/data/school/');const files=[];
  const loaded=await repository.catchment(elementary,{load:async file=>{files.push(file);return file.includes('63000')?data(village,region('unused','village')):data(crossVillage);}});
  assert.deepEqual(files,['villages/63000010.geojson','villages/65000010.geojson']);assert.deepEqual(loaded.features,[village,crossVillage]);
  assert.deepEqual(await repository.catchment(junior,{load:()=>assert.fail('Missing data must not fetch villages')}),data());
  await assert.rejects(repository.catchment(elementary,{load:async()=>data()}),/incomplete/);
});
test('School I/O preserves codes, caches successes, retries failures and treats unsupported counties as empty',async()=>{
  let calls=0;const repository=new SchoolRepository('/project/data/school',async url=>{calls++;assert.equal(url,'/project/data/school/towns/63000010.json');return calls===1?new Response(null,{status:503}):Response.json([elementary,junior]);});
  await assert.rejects(repository.load('63000010'));assert.equal((await repository.load('63000010')).length,2);await repository.load('63000010');assert.equal(calls,2);
  assert.deepEqual(await repository.load('65000010'),[]);assert.equal(calls,2);await assert.rejects(repository.load('../private'));
});
test('Catchment fitting includes cross-district bounds without mutating cached town boundaries',async()=>{
  const f=fixture();await inTown(f);const before=JSON.stringify(town);await f.nav.choose(elementary,camera);
  const v=polygonView(f.nav.current);assert.equal(JSON.stringify(town),before);assert.notEqual(v.path.at(-1),town);assert.equal(v.data.features.length,2);
  assert.equal(filterSchools([elementary,junior],{elementary:false,junior:true}).length,1);
});

test('Home, back and checkbox changes during initial load preserve the initial request',async()=>{
  const pending=deferred();const f=fixture({loadRegions:()=>pending.promise});const started=f.nav.start();
  f.nav.home();f.nav.back();f.nav.setFilter('elementary',false,camera);
  pending.resolve(data(county));await started;assert.equal(f.nav.current.level,'county');assert.equal(f.nav.filter.elementary,false);assert.equal(f.busy.at(-1),false);
});
