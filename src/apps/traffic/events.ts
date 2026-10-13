import {Popup,type Map,type MapMouseEvent,type GeoJSONSource} from 'maplibre-gl';
import type {TrafficEvent} from '../../data/traffic';
import {createSettledUpdate} from '../../map-core/settled-update.ts';

/** GPU circles keep tens of thousands of event positions usable without DOM markers. */
export function createTrafficEvents(map:Map){
 const source='traffic-events',dots='traffic-event-dots';
 const settled=createSettledUpdate(map);
 let rows:TrafficEvent[]=[],alive=true,busy=false,clickHandled=false;
 let popup:Popup|undefined;
 const data=()=>({type:'FeatureCollection' as const,features:rows.map(e=>({type:'Feature' as const,geometry:{type:'Point' as const,coordinates:[e[1],e[2]]},properties:{id:e[0],deaths:e[6],injuries:e[7]}}))});
 function update(){if(!alive||!map.getStyle())return;if(!map.getSource(source)){map.addSource(source,{type:'geojson',data:{type:'FeatureCollection',features:[]}});map.addLayer({id:dots,type:'circle',source,paint:{'circle-radius':['interpolate',['linear'],['zoom'],6,2,12,4,16,6],'circle-color':['case',['>', ['get','deaths'],0],'#a82332','#e88426'],'circle-opacity':.8,'circle-stroke-color':'#ffffff','circle-stroke-width':.8}})}(map.getSource(source) as GeoJSONSource).setData(busy?{type:'FeatureCollection',features:[]}:data());map.moveLayer(dots);map.setLayoutProperty(dots,'visibility',busy||!rows.length?'none':'visible')}
 const style=()=>settled.queue(update);
 const click=(e:MapMouseEvent)=>{
  clickHandled=false;
  if(busy||settled.pending||!map.getLayer(dots))return;
  const hit=map.queryRenderedFeatures(e.point,{layers:[dots]})[0];if(!hit)return;
  clickHandled=true;queueMicrotask(()=>{clickHandled=false});
  const row=rows.find(r=>r[0]===hit.properties?.id);if(!row)return;
  const content=document.createElement('section'),title=document.createElement('strong'),date=document.createElement('p'),place=document.createElement('p'),counts=document.createElement('p');
  title.textContent=`${row[5]} 傷亡交通事故`;date.textContent=`${row[3].slice(0,4)}-${row[3].slice(4,6)}-${row[3].slice(6)} ${row[4].slice(0,2)}:${row[4].slice(2,4)}`;place.textContent=row[10];counts.textContent=`死亡 ${row[6]} 人（24 小時）・受傷 ${row[7]} 人`;content.append(title,date,place,counts);content.className='traffic-event-popup';
  popup?.remove();popup=new Popup({closeButton:true,maxWidth:'280px'}).setLngLat([row[1],row[2]]).setDOMContent(content).addTo(map);
 };
 map.on('style.load',style);map.on('click',click);
 const hide=()=>{if(map.getLayer(dots))map.setLayoutProperty(dots,'visibility','none')};
 return{get clickHandled(){return clickHandled},render(next:TrafficEvent[]){rows=next;popup?.remove();hide();settled.queue(update)},setBusy(next:boolean){busy=next;if(next){popup?.remove();hide();settled.cancel()}else settled.queue(update)},destroy(){alive=false;settled.destroy();popup?.remove();map.off('style.load',style);map.off('click',click);if(map.getLayer(dots))map.removeLayer(dots);if(map.getSource(source))map.removeSource(source)}}
}
