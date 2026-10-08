import test from 'node:test';
import assert from 'node:assert/strict';
import { RegionNavigator } from '../src/map-core/navigation.ts';
import { SchoolNavigator } from '../src/apps/school/navigation.ts';
import { createCameraController } from '../src/map-core/camera.ts';
const region = (code, bounds=[121,24,122,25]) => ({id:code,properties:{code,focusBounds:bounds,bounds}});
const county=region('63000'),town=region('63000010');
const data=(...features)=>({type:'FeatureCollection',features});
const original={center:[120,23],zoom:7,bearing:0,pitch:0};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function cameraFixture(){
  const fits=[],eases=[];let live=original;
  const map={getCenter:()=>({lng:live.center[0],lat:live.center[1]}),getZoom:()=>live.zoom,getBearing:()=>live.bearing,getPitch:()=>live.pitch,fitBounds:(bounds,options)=>fits.push({bounds,options}),easeTo:options=>eases.push(options)};
  return {camera:createCameraController(map,()=>({top:50,left:20,right:50,bottom:180}),720),fits,eases,pan:()=>{live={...original,center:[121.5,24.5],zoom:11};}};
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
  f.camera.cancelPreview();assert.equal(f.eases.length,0);
});
test('Cancelled or failed previews restore the camera before the first pending selection',()=>{
  const f=cameraFixture();f.camera.previewRegion(county);f.pan();f.camera.previewRegion(region('other',[120,22,121,23]));
  f.camera.cancelPreview();assert.deepEqual(f.eases.at(-1).center,original.center);assert.equal(f.eases.at(-1).zoom,7);assert.equal(f.camera.isPreviewing,false);
  f.camera.cancelPreview();assert.equal(f.eases.length,1);
});
test('A school point preview reframes to the loaded cross-district catchment',()=>{
  const f=cameraFixture();f.camera.previewPoint([121.5,25]);assert.equal(f.eases[0].zoom,14);
  f.camera.fit({level:'village',path:[region('catchment',[121,24,123,26])],selected:null});
  assert.deepEqual(f.fits[0].bounds,[[121,24],[123,26]]);assert.equal(f.camera.isPreviewing,false);
});
test('Returning during a preview replaces its animation with the saved viewport',()=>{
  const f=cameraFixture();f.camera.previewRegion(county);f.camera.restore({camera:original});
  assert.equal(f.camera.isPreviewing,false);assert.deepEqual(f.eases.at(-1).center,original.center);
});
