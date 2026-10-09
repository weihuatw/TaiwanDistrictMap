import test from 'node:test';
import assert from 'node:assert/strict';
import { RegionNavigator } from '../src/map-core/navigation.ts';
import { SchoolNavigator } from '../src/apps/school/navigation.ts';
import { createCameraController } from '../src/map-core/camera.ts';
const region = (code, bounds=[121,24,122,25]) => ({id:code,properties:{code,level:'county',focusBounds:bounds,bounds}});
const county=region('63000'),town=region('63000010');
const data=(...features)=>({type:'FeatureCollection',features});
const original={center:[120,23],zoom:7,bearing:0,pitch:0};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function cameraFixture(initialZoom=7){
  const fits=[],eases=[];let live={...original,zoom:initialZoom};
  let padding={top:50,left:20,right:50,bottom:180};
  const map={getCenter:()=>({lng:live.center[0],lat:live.center[1]}),getZoom:()=>live.zoom,getBearing:()=>live.bearing,getPitch:()=>live.pitch,cameraForBounds:(bounds,options)=>{fits.push({bounds,options});return {center:[121.5,24.5],zoom:Math.min(15,options.maxZoom),padding:options.padding};},easeTo:options=>eases.push(options)};
  return {camera:createCameraController(map,()=>padding,720),fits,eases,setPadding:value=>{padding=value;},pan:()=>{live={...original,center:[121.5,24.5],zoom:11};}};
}
test('Region navigation starts the preview before I/O and commits only after data resolves',async()=>{
  const pending=deferred(),order=[];
  const nav=new RegionNavigator(file=>{if(file==='counties.geojson')return Promise.resolve(data(county));order.push('load');return pending.promise;},()=>order.push('commit'),()=>{},()=>{},()=>order.push('preview'));
  await nav.start();order.length=0;
  const request=nav.enter(county,original);
  assert.deepEqual(order,['preview','load']);assert.equal(nav.current.level,'county');
  pending.resolve(data(town));await request;assert.deepEqual(order,['preview','load','commit']);
  nav.back();assert.deepEqual(nav.current.camera,original);
});
test('Schools and catchments start previews while retaining the current view until ready',async()=>{
  const schools=deferred(),catchment=deferred(),previews=[];
  const school={id:'school',level:'elementary',position:[121.5,24.5],catchment:null};
  const nav=new SchoolNavigator({loadRegions:async f=>f==='counties.geojson'?data(county):data(town),loadSchools:()=>schools.promise,loadCatchment:()=>catchment.promise,onChange:()=>{},onBusy:()=>{},onError:()=>{},onPreview:t=>previews.push(t)});
  await nav.start();await nav.enter(county,original);
  const request=nav.enter(town,original);assert.equal(previews.at(-1),town);assert.equal(nav.current.level,'town');
  schools.resolve([school]);await request;
  const choice=nav.choose(school,original);assert.equal(previews.at(-1),school);assert.equal(nav.current.selected,null);
  catchment.resolve(data());await choice;assert.equal(nav.current.selected,school);
});
test('An identical final region fit keeps the original animation and saved return camera',()=>{
  const f=cameraFixture();f.camera.previewRegion(county);f.pan();
  assert.deepEqual(f.camera.capture(),original);
  f.camera.fit({level:'town',path:[county],selected:null});assert.equal(f.fits.length,1);assert.equal(f.camera.isPreviewing,false);
  f.camera.cancelPreview();assert.equal(f.eases.length,1);
});
test('Cancelled or failed previews restore the camera before the first pending selection',()=>{
  const f=cameraFixture();f.camera.previewRegion(county);f.pan();f.camera.previewRegion(region('other',[120,22,121,23]));
  f.camera.cancelPreview();assert.deepEqual(f.eases.at(-1).center,original.center);assert.equal(f.eases.at(-1).zoom,7);assert.equal(f.camera.isPreviewing,false);
  f.camera.cancelPreview();assert.equal(f.eases.length,3);
});
test('A school point preview reframes to the loaded cross-district catchment',()=>{
  const f=cameraFixture();f.camera.previewPoint([121.5,25]);assert.equal(f.eases[0].zoom,7);
  f.camera.fit({level:'village',path:[region('catchment',[121,24,123,26])],selected:null});
  assert.deepEqual(f.fits[0].bounds,[[121,24],[123,26]]);assert.equal(f.camera.isPreviewing,false);
});
test('Returning during a preview replaces its animation with the saved viewport',()=>{
  const f=cameraFixture();f.camera.previewRegion(county);f.camera.restore({camera:original});
  assert.equal(f.camera.isPreviewing,false);assert.deepEqual(f.eases.at(-1).center,original.center);
});

test('School previews preserve both overview and user-adjusted zoom until bounds are ready',()=>{
  for(const zoom of [10,13,17]) {
    const f=cameraFixture(zoom);f.camera.previewPoint([121.5,25]);
    assert.equal(f.eases[0].zoom,zoom);
    assert.deepEqual(f.eases[0].padding,{top:0,right:0,bottom:0,left:0});
    assert.deepEqual(f.eases[0].offset,[-15,-65]);
    f.camera.fit({level:'village',path:[town],selected:null});
    assert.equal(f.eases.length,2);assert.equal(f.eases[1].zoom,15);
  }
});
test('Repeated viewport fits reserve the sheet once and do not retain padding or use flight arcs',()=>{
  const f=cameraFixture();
  for(let i=0;i<3;i++)f.camera.fit({level:'town',path:[county],selected:null});
  for(const fit of f.fits)assert.equal(fit.options.absolutePadding,true);
  for(const ease of f.eases){
    assert.deepEqual(ease.padding,{top:0,right:0,bottom:0,left:0});
    assert.deepEqual(ease.offset,[-15,-65]);assert.equal(ease.zoom,14);
  }
});
test('Small towns and catchments can fill the viewport beyond zoom 14',()=>{
  const f=cameraFixture(),smallTown={...town,properties:{...town.properties,level:'town'}};
  f.camera.previewRegion(smallTown);
  f.camera.fit({level:'village',path:[smallTown],selected:null});
  assert.equal(f.fits.length,1);assert.equal(f.eases[0].zoom,15);
  f.camera.fit({level:'detail',path:[smallTown],selected:smallTown});
  assert.equal(f.fits.at(-1).options.maxZoom,16);
});
test('Detail camera bounds ignore distant offshore fragments when they overwhelm the local village',()=>{
  const f=cameraFixture();
  const dashi={...town,properties:{...town.properties,level:'village',bounds:[121.839048,24.927924,124.561154,25.928878],focusBounds:[121.839048,24.927924,121.904671,24.964388]}};
  f.camera.fit({level:'detail',path:[dashi],selected:dashi});
  assert.deepEqual(f.fits[0].bounds,[[121.839048,24.927924],[121.904671,24.964388]]);
  assert.equal(f.fits[0].options.maxZoom,16);
});
test('The final region fit updates when the mobile sheet height changes while loading',()=>{
  const f=cameraFixture();f.camera.previewRegion(county);
  f.setPadding({top:50,left:20,right:50,bottom:300});
  f.camera.fit({level:'town',path:[county],selected:null});
  assert.equal(f.fits.length,2);assert.deepEqual(f.eases.at(-1).offset,[-15,-125]);
});
