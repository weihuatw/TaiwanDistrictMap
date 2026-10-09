import './style.css';
import type { HashRouter, Route } from '../../routing/hash-router';
import { BoundaryRepository } from '../../map-core/boundaries';
import { createMap } from '../../map-core/create-map';
import { RegionNavigator } from '../../map-core/navigation';
import { createRegionLayer } from '../../map-core/region-layer';
import type { Region, View } from '../../map-core/types';
import { createMapShell } from '../../ui/map-shell';
import { HousingRepository } from './data';
import { createHousingPanel } from './panel';
import type { HousingGroup, HousingManifest } from './types';
import { color, formatPrice } from './theme';

export function startHousingApp(root: HTMLElement, routing?: HashRouter){
  const base=import.meta.env.BASE_URL,boundaries=new BoundaryRepository(`${base}data/`),housing=new HousingRepository(`${base}data/housing/`);
  let year=Number((routing?.params ?? new URLSearchParams(location.search)).get('year'))===2024?2024:2025;
  const known:HousingGroup[]=['standard','apartment','elevator_low','elevator_high','house'];
  let group=known.includes((routing?.params ?? new URLSearchParams(location.search)).get('type') as HousingGroup)?(routing?.params ?? new URLSearchParams(location.search)).get('type') as HousingGroup:'standard';
  let layer:ReturnType<typeof createRegionLayer>|undefined,basemap:ReturnType<typeof createMap>|undefined,manifest:HousingManifest|undefined,alive=true;
  const getColor=(region:Region)=>color(housing.get(year,group,region.properties.code));
  const shell=createMapShell(root,{
    brandTitle:'房價地圖',pageTitle:'臺灣實價登錄地圖',getColor,showSelectionCard:false,
    loadingText:'載入房價與行政區…',errorText:'房價或行政區資料載入失敗，請重試。',
    sourceIntro:'內政部不動產成交案件實際資訊（免費批次），行政區界來自國土測繪中心，底圖為TomTom向量地圖。',
    rowMeta:(region)=>{const s=housing.get(year,group,region.properties.code);return s?.status==='insufficient'?'樣本不足':formatPrice(s?.medianWanPing);},
    sortRegions:(regions)=>[...regions].sort((a,b)=>(housing.get(year,group,b.properties.code)?.medianWanPing??-Infinity)-(housing.get(year,group,a.properties.code)?.medianWanPing??-Infinity)||a.properties.code.localeCompare(b.properties.code)),
    formatTooltip:(hit)=>panel.tooltip(hit),
    onChoose:(region)=>choose(region),onBack:()=>back(),onHome:()=>navigator.home(),
    onNavigate:(index)=>{if(index === navigator.stack.length - 1) navigator.selectTown(null);else navigator.goTo(index);},onPanelChange:()=>layer?.scheduleLabels(),
  });
  const panel=createHousingPanel(shell,housing,changeFilter);
  const navigator=new RegionNavigator(
    async(file)=>{const [geometry]=await Promise.all([boundaries.load(file),housing.load(file,year,group)]);return geometry;},
    (view,restore=false)=>{routing?.commit(housingRoute(view));shell.render(view);panel.setFilter(year,group);panel.render(view);layer?.render(view,navigator.context,restore);},
    (loading)=>{shell.setBusy(loading);layer?.setBusy(loading);if(!loading)layer?.cancelPreview();},
    (error,retry)=>shell.showError(error,retry),region=>layer?.previewRegion(region),
  );
  function restoreRoute(route: Route) { const params = new URLSearchParams(route.query); if (!navigator.current || !routing?.isHistoryNavigation) { year = params.get('year') === '2024' ? 2024 : 2025; const type = params.get('type') as HousingGroup; group = known.includes(type) ? type : 'standard'; } return navigator.restorePath(route.ids, true); }
  function housingRoute(view: View): Route { return { theme: 'housing', ids: [...view.path.map(r => r.properties.code), ...(view.selected ? [view.selected.properties.code] : [])], query: new URLSearchParams({ year: String(year), type: group }).toString() }; }
  function choose(region:Region){
    if(!layer?.ready||!navigator.current)return;
    if(navigator.current.level==='town'){
      navigator.selectTown(region);return;
    }
    void navigator.enter(region,layer.camera());
  }
  function back(){
    if(navigator.current?.selected){navigator.selectTown(null);return;}
    navigator.back();
  }
  async function changeFilter(nextYear: number, nextGroup: HousingGroup) {
    year = nextYear; group = nextGroup;
    const view = navigator.current;
    if (view && layer) view.camera = layer.camera();
    const ids = view ? housingRoute(view).ids : [];
    await navigator.restorePath(ids, true);
  }
  try{
    basemap=createMap({container:shell.mapContainer,apiKey:import.meta.env.VITE_TOMTOM_API_KEY,style:'monoLight',onStatus:shell.setBasemapStatus});
    layer=createRegionLayer(basemap.map,{getColor,isMissing:(r)=>{const s=housing.get(year,group,r.properties.code);return !s||s.status==='no_samples'||s.status==='insufficient';},fillOpacity:.4,hoverOpacity:.4,selectedOpacity:.4,outlineColor:'#a86243',emphasisColor:'#812f27',getPadding:shell.getPadding,getLabelObstacles:shell.getLabelObstacles,duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:720,onReady:shell.markMapReady,onHover:shell.showTooltip,onHoverEnd:shell.hideTooltip,onSelect:(hit)=>{
      if(!layer?.ready||!navigator.current)return;
      if(hit.parentIndex!==undefined){void navigator.switchTo(hit.region,hit.parentIndex);return;}
      choose(hit.region);
    }});
    if (routing) void restoreRoute(routing.current); else void navigator.start();
  }catch{shell.showInitializationError(()=>location.reload());}
  void Promise.all([boundaries.manifest(),housing.manifest()]).then(([geometry,data])=>{if(alive){manifest=data;shell.renderManifest(geometry);panel.showSources(data);}}).catch(()=>{if(alive)shell.showManifestError();});
  return{restoreRoute,destroy(){if(!alive)return;alive=false;panel.destroy();navigator.destroy();layer?.destroy();basemap?.destroy();shell.destroy();root.classList.remove('housing-page');}};
}
