import './style.css';
import type {HashRouter,Route} from '../../routing/hash-router';
import {BoundaryRepository} from '../../map-core/boundaries';
import {createMap} from '../../map-core/create-map';
import {RegionNavigator} from '../../map-core/navigation';
import {createRegionLayer} from '../../map-core/region-layer';
import type {Region,View} from '../../map-core/types';
import {createMapShell} from '../../ui/map-shell';
import {TrafficRepository,type TrafficEvent,type TrafficManifest} from '../../data/traffic';
import {createTrafficPanel} from './panel';
import {createTrafficEvents} from './events';
import {color,format,parseMetric,parseYear,value,eventsForView,type Metric} from './theme';

export function startTrafficApp(root:HTMLElement,routing?:HashRouter){
 const base=import.meta.env.BASE_URL,boundaries=new BoundaryRepository(`${base}data/`),repo=new TrafficRepository(`${base}data/traffic/`);
 let metric:Metric='accidents',year=2024,alive=true,restoreRequest=0;
 let layer:ReturnType<typeof createRegionLayer>|undefined,map:ReturnType<typeof createMap>|undefined,points:ReturnType<typeof createTrafficEvents>|undefined;
 const eventCache=new Map<string,TrafficEvent[]>(),manifests=new Map<number,TrafficManifest>();
 const val=(r:Region)=>repo.get(r.properties.code,year),shownValue=(r:Region)=>value(val(r),metric),getColor=(r:Region)=>color(val(r),metric,r.properties.level);
 const routeFor=(v:View):Route=>({theme:'traffic',ids:v.path.map(x=>x.properties.code),query:new URLSearchParams({metric,year:String(year)}).toString()});
 const shell=createMapShell(root,{routing,getCamera:()=>layer?.ready&&nav.current?layer.camera():undefined,brandTitle:'交通事故',pageTitle:'臺灣傷亡交通事故地圖',getColor,showSelectionCard:false,loadingText:'載入交通事故與行政區…',errorText:'交通事故或行政區資料載入失敗，請重試。',sourceIntro:'警政署公開 A1／A2 傷亡交通事故逐案資料，以第一當事人列計算每案一次。人口分母來自內政部戶政司。未收錄純財損 A3；死亡採官方檔案的 24 小時口徑。',rowMeta:r=>format(shownValue(r),metric),sortRegions:rs=>[...rs].sort((a,b)=>(shownValue(b)??-Infinity)-(shownValue(a)??-Infinity)||a.properties.code.localeCompare(b.properties.code)),formatTooltip:h=>`${h.parentIndex!==undefined?'切換至 ':''}${h.region.properties.name}${h.parentIndex===undefined?` · ${format(shownValue(h.region),metric)}`:''}`,onChoose:r=>{if(layer?.ready)void nav.enter(r,layer.camera())},onBack:()=>nav.back(),onHome:()=>nav.home(),onNavigate:i=>nav.goTo(i),onPanelChange:()=>layer?.scheduleLabels()});
 const panel=createTrafficPanel(shell,repo,(m,y)=>{if(!nav.current)return;if(y!==year){const route={...routeFor(nav.current),query:new URLSearchParams({metric:m,year:String(y)}).toString()};void restoreRoute(route)}else{metric=m;render(nav.current,false,true)}});
 function render(view:View,restore=false,keepCamera=false){
  const route=routeFor(view),cam=routing?.consumeRouteCamera(route);if(cam)view.camera=cam;
  routing?.commit(route);shell.render(view);const meta=manifests.get(year);if(meta)panel.render(view,metric,meta);
  layer?.render(view,nav.context,restore,undefined,undefined,keepCamera);
  const county=view.path[0]?.properties.code;points?.render(county?eventsForView(eventCache.get(`${year}:${county}`)??[],view):[]);
 }
 const nav=new RegionNavigator(async file=>{
  const requestedYear=year,level=file==='counties.geojson'?'county':file.startsWith('towns/')?'town':'village',parent=file.match(/\/([0-9]+)\.geojson$/)?.[1];
  const county=parent?.slice(0,5);
  const [geom,meta,,events]=await Promise.all([boundaries.load(file),repo.manifest(requestedYear),repo.loadRegions(level,parent,requestedYear),county?repo.events(county,requestedYear):Promise.resolve(undefined)]);
  manifests.set(requestedYear,meta);if(county&&events)eventCache.set(`${requestedYear}:${county}`,events);return geom;
 },(view,restore=false)=>render(view,restore),busy=>{shell.setBusy(busy);shell.root.querySelectorAll('select').forEach(x=>(x as HTMLSelectElement).disabled=busy);layer?.setBusy(busy);points?.setBusy(busy);if(!busy)layer?.cancelPreview()},(error,retry)=>shell.showError(error,retry),r=>layer?.previewRegion(r));
 async function restoreRoute(route:Route){
  const request=++restoreRequest;
  shell.setBusy(true);
  try{const years=await repo.years();if(!alive||request!==restoreRequest)return;year=parseYear(route.query,years.map(y=>y.year));metric=parseMetric(route.query);await nav.restorePath(route.ids)}
  catch(error){if(alive&&request===restoreRequest)shell.showError(error,()=>restoreRoute(route))}
 }
 try{
  map=createMap({container:shell.mapContainer,apiKey:import.meta.env.VITE_TOMTOM_API_KEY,style:'monoLight',onStatus:shell.setBasemapStatus});
  // The point click listener precedes the polygon listener, so an event popup owns that click.
  points=createTrafficEvents(map.map);
  layer=createRegionLayer(map.map,{getColor,isMissing:r=>value(val(r),metric)===null,fillOpacity:.65,hoverOpacity:.65,selectedOpacity:.65,getPadding:shell.getPadding,getLabelObstacles:()=>[...shell.getLabelObstacles(),...panel.obstacles()],duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:720,onReady:shell.markMapReady,onHover:shell.showTooltip,onHoverEnd:shell.hideTooltip,onSelect:h=>{if(!layer?.ready||points?.clickHandled)return;if(h.parentIndex!==undefined)void nav.switchTo(h.region,h.parentIndex);else void nav.enter(h.region,layer.camera())}});
  const init=async()=>{const years=await repo.years();if(!alive)return;panel.init(years);await restoreRoute(routing?.current??{theme:'traffic',ids:[],query:''})};
  void init().catch(error=>{if(alive)shell.showError(error,init)});
 }catch{shell.showInitializationError(()=>location.reload())}
 return{restoreRoute,get map(){return map?.map},destroy(){if(!alive)return;alive=false;restoreRequest++;nav.destroy();panel.destroy();points?.destroy();layer?.destroy();map?.destroy();shell.destroy()}}
}
