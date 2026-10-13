import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){if(specifier==='maplibre-gl')return{shortCircuit:true,url:'data:text/javascript,'+encodeURIComponent(`export class Popup {setLngLat(){return this}setDOMContent(){return this}addTo(){return this}remove(){}}`)};return next(specifier,context)}});
const {createTrafficEvents}=await import('../src/apps/traffic/events.ts');
const row=['2024-1',121.5,25,'20240101','120000','A2',0,1,'63000010','63000010002','臺北市松山區'];
function fixture(){
 const events=new Map(),sources=new Map(),layers=new Map(),frames=new Map();let moving=false,frame=0;
 globalThis.requestAnimationFrame=fn=>{frames.set(++frame,fn);return frame};globalThis.cancelAnimationFrame=id=>frames.delete(id);
 globalThis.document={createElement:()=>({append(){},set className(x){}})};
 const map={isMoving:()=>moving,getStyle:()=>({layers:[]}),on(n,f){if(!events.has(n))events.set(n,new Set());events.get(n).add(f)},off(n,f){events.get(n)?.delete(f)},getSource:id=>sources.get(id),addSource(id,o){sources.set(id,{data:o.data,setData(d){this.data=d}})},removeSource:id=>sources.delete(id),getLayer:id=>layers.get(id),addLayer:l=>layers.set(l.id,l),removeLayer:id=>layers.delete(id),moveLayer(){},setLayoutProperty(id,k,v){layers.get(id)[k]=v},queryRenderedFeatures:()=>[{properties:{id:row[0]}}]};
 const points=createTrafficEvents(map);const emit=(n,e)=>{for(const f of events.get(n)??[])f(e)};
 return{points,sources,layers,emit,tick(){const fs=[...frames.values()];frames.clear();fs.forEach(f=>f())},start(){moving=true},stop(){moving=false;emit('moveend')},clearStyle(){sources.clear();layers.clear();emit('style.load')},listeners:()=>[...events.values()].reduce((s,x)=>s+x.size,0)};
}
test('event layers wait for movement, keep the latest data, clear on national overview, and rebuild after style changes',()=>{
 const f=fixture();f.start();f.points.render([row]);f.points.render([{...row}]);f.points.render([row]);f.tick();assert.equal(f.sources.size,0);f.stop();f.tick();assert.equal(f.sources.get('traffic-events').data.features.length,1);
 f.points.render([]);assert.equal(f.layers.get('traffic-event-dots').visibility,'none');f.tick();assert.equal(f.sources.get('traffic-events').data.features.length,0);
 f.points.render([row]);f.tick();f.clearStyle();f.tick();assert.equal(f.sources.get('traffic-events').data.features.length,1);f.points.destroy();assert.equal(f.listeners(),0);assert.equal(f.layers.size,0);assert.equal(f.sources.size,0);
});
test('busy or pending point updates cannot open stale events, and an event click owns one turn without preventing the next polygon click',async()=>{
 const f=fixture();f.points.render([row]);f.emit('click',{point:{x:1,y:1}});assert.equal(f.points.clickHandled,false);f.tick();f.emit('click',{point:{x:1,y:1}});assert.equal(f.points.clickHandled,true);await Promise.resolve();assert.equal(f.points.clickHandled,false);
 f.points.setBusy(true);assert.equal(f.layers.get('traffic-event-dots').visibility,'none');f.emit('click',{point:{x:1,y:1}});assert.equal(f.points.clickHandled,false);f.points.setBusy(false);f.tick();assert.equal(f.layers.get('traffic-event-dots').visibility,'visible');f.points.destroy();
});
