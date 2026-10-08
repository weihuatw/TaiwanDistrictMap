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

export function startHousingApp(root:HTMLElement){
  const base=import.meta.env.BASE_URL,boundaries=new BoundaryRepository(`${base}data/`),housing=new HousingRepository(`${base}data/housing/`);
  let year=Number(new URLSearchParams(location.search).get('year'))===2024?2024:2025;
  const known:HousingGroup[]=['standard','apartment','elevator_low','elevator_high','house'];
  let group=known.includes(new URLSearchParams(location.search).get('type') as HousingGroup)?new URLSearchParams(location.search).get('type') as HousingGroup:'standard';
  let layer:ReturnType<typeof createRegionLayer>|undefined,basemap:ReturnType<typeof createMap>|undefined,manifest:HousingManifest|undefined,alive=true,selectedTown:Region|null=null,filterSequence=0;
  const getColor=(region:Region)=>color(housing.get(year,group,region.properties.code));
  const shell=createMapShell(root,{
    brandTitle:'房價地圖',pageTitle:'臺灣實價登錄地圖',getColor,showSelectionCard:false,
    loadingText:'載入房價與行政區…',errorText:'房價或行政區資料載入失敗，請重試。',
    sourceIntro:'內政部不動產成交案件實際資訊（免費批次），行政區界來自國土測繪中心，底圖為TomTom向量地圖。',
    rowMeta:(region)=>{const s=housing.get(year,group,region.properties.code);return s?.status==='insufficient'?'樣本不足':formatPrice(s?.medianWanPing);},
    sortRegions:(regions)=>[...regions].sort((a,b)=>(housing.get(year,group,b.properties.code)?.medianWanPing??-Infinity)-(housing.get(year,group,a.properties.code)?.medianWanPing??-Infinity)||a.properties.code.localeCompare(b.properties.code)),
    formatTooltip:(hit)=>panel.tooltip(hit),
    onChoose:(region)=>choose(region),onBack:()=>back(),onHome:()=>{selectedTown=null;navigator.home();},
    onNavigate:(index)=>{selectedTown=null;navigator.goTo(index);},onPanelChange:()=>layer?.scheduleLabels(),
  });
  const panel=createHousingPanel(shell,housing,changeFilter);
  const navigator=new RegionNavigator(
    async(file)=>{const [geometry]=await Promise.all([boundaries.load(file),housing.load(file,year,group)]);return geometry;},
    (view,restore=false)=>{const effective:View=selectedTown&&view.level==='town'?{...view,selected:selectedTown}:view;view=effective;shell.render(view);panel.render(view);layer?.render(view,navigator.context,restore);},
    (loading)=>{shell.setBusy(loading);layer?.setBusy(loading);if(!loading)layer?.cancelPreview();},
    (error,retry)=>shell.showError(error,retry),region=>layer?.previewRegion(region),
  );
  function choose(region:Region){
    if(!layer?.ready||!navigator.current)return;
    if(navigator.current.level==='town'){
      selectedTown=region;const selected={...navigator.current,selected:region};shell.render(selected);panel.render(selected);layer.render(selected,navigator.context);return;
    }
    void navigator.enter(region,layer.camera());
  }
  function back(){
    if(navigator.current?.level==='town'&&selectedTown){selectedTown=null;const view=navigator.current;shell.render(view);panel.render(view);layer?.render(view,navigator.context);return;}
    selectedTown=null;navigator.back();
  }
  async function changeFilter(nextYear:number,nextGroup:HousingGroup){
    year=nextYear;group=nextGroup;selectedTown=null;
    const token=++filterSequence,view=navigator.current;if(!view)return;
    shell.setBusy(true);layer?.setBusy(true);
    try{
      const file=view.level==='county'?'counties.geojson':`towns/${view.path[0]?.properties.code}.geojson`;
      await housing.load(file,year,group);
      if(!alive||token!==filterSequence)return;
      selectedTown=null;shell.render(view);panel.render(view);layer?.render(view,navigator.context);
    }catch(error){if(token===filterSequence)shell.showError(error,()=>void changeFilter(year,group));}
    finally{if(token===filterSequence){shell.setBusy(false);layer?.setBusy(false);}}
  }
  try{
    basemap=createMap({container:shell.mapContainer,apiKey:import.meta.env.VITE_TOMTOM_API_KEY,style:'monoLight',onStatus:shell.setBasemapStatus});
    layer=createRegionLayer(basemap.map,{getColor,isMissing:(r)=>{const s=housing.get(year,group,r.properties.code);return !s||s.status==='no_samples'||s.status==='insufficient';},fillOpacity:.4,hoverOpacity:.4,selectedOpacity:.4,outlineColor:'#59796e',emphasisColor:'#174d3f',getPadding:shell.getPadding,getLabelObstacles:shell.getLabelObstacles,duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:720,onReady:shell.markMapReady,onHover:shell.showTooltip,onHoverEnd:shell.hideTooltip,onSelect:(hit)=>{
      if(!layer?.ready||!navigator.current)return;
      if(hit.parentIndex!==undefined){selectedTown=null;void navigator.switchTo(hit.region,hit.parentIndex);return;}
      choose(hit.region);
    }});
    void navigator.start();
  }catch{shell.showInitializationError(()=>location.reload());}
  void Promise.all([boundaries.manifest(),housing.manifest()]).then(([geometry,data])=>{if(alive){manifest=data;shell.renderManifest(geometry);panel.showSources(data);}}).catch(()=>{if(alive)shell.showManifestError();});
  return{destroy(){if(!alive)return;alive=false;filterSequence++;navigator.destroy();layer?.destroy();basemap?.destroy();shell.destroy();root.classList.remove('housing-page');}};
}
