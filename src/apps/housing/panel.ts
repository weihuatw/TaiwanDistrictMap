import type { View, Rect, RegionHit } from '../../map-core/types';
import type { createMapShell } from '../../ui/map-shell';
import type { HousingRepository } from './data';
import type { HousingGroup, HousingManifest, HousingSummary } from './types';
import { COLORS, LABELS, formatPrice, groupName } from './theme';

type Shell = ReturnType<typeof createMapShell>;
const GROUPS: HousingGroup[] = ['standard','apartment','elevator_low','elevator_high','house'];
const BASE = import.meta.env.BASE_URL;
const money = (n: number | null) => n == null ? '—' : `${(n/10000).toLocaleString('zh-TW',{maximumFractionDigits:0})} 萬`;
const area = (n: number | null) => n == null ? '—' : `${(n*121/400).toFixed(1)} 坪`;

export function createHousingPanel(shell: Shell, repo: HousingRepository, onFilter: (year: number, group: HousingGroup) => void) {
  shell.root.classList.add('housing-page');
  const controls=document.createElement('section'); controls.className='housing-controls';
  controls.innerHTML='<label>交易年度 <select id="housing-year" aria-label="交易年度"></select></label><label>住宅型態 <select id="housing-group" aria-label="住宅型態"></select></label>';
  const yearSelect=controls.querySelector<HTMLSelectElement>('#housing-year')!;
  for (const y of [2025,2024]) { const o=document.createElement('option');o.value=String(y);o.textContent=`${y} 年`;yearSelect.append(o); }
  const groupSelect=controls.querySelector<HTMLSelectElement>('#housing-group')!;
  for (const g of GROUPS) { const o=document.createElement('option');o.value=g;o.textContent=groupName(g);groupSelect.append(o); }
  yearSelect.value=new URLSearchParams(location.search).get('year')==='2024'?'2024':'2025';
  groupSelect.value=GROUPS.includes(new URLSearchParams(location.search).get('type') as HousingGroup)?new URLSearchParams(location.search).get('type')!: 'standard';
  shell.viewExtra.append(controls);
  const summary=document.createElement('section');summary.className='housing-summary';summary.setAttribute('aria-label','成交統計');
  summary.innerHTML='<p class="housing-metric-label">可比住宅成交單價中位數</p><strong class="housing-price">載入中…</strong><p class="housing-description"></p><div class="housing-facts"><span>有效樣本 <b class="housing-eligible">—</b></span><span>住宅案件 <b class="housing-residential">—</b></span></div><p class="housing-spread"></p><p class="housing-exclusions"></p>';
  shell.viewExtra.append(summary);
  const legend=document.createElement('section');legend.className='housing-legend';legend.setAttribute('aria-label','房價色階圖例');
  legend.innerHTML='<div class="housing-legend-title"><strong>成交單價中位數</strong><span>萬元／坪</span></div><div class="housing-scale"></div><p>固定級距；樣本數少於10不著色。</p><div class="housing-key"><span></span>灰色：無足夠可比樣本</div><p class="housing-note">僅統計住家用公寓、華廈與住宅大樓；透天可切換。成交不代表區內所有住宅行情。</p><a class="housing-map-link" href="./index.html">行政區瀏覽 ↗</a>';
  const scale=legend.querySelector('.housing-scale')!;
  for(const [i,label] of LABELS.entries()){const item=document.createElement('div');item.className='housing-scale-item';const sw=document.createElement('span');sw.style.background=COLORS[i];const tx=document.createElement('small');tx.textContent=label;item.append(sw,tx);scale.append(item);}
  shell.uiContainer.append(legend);shell.addMobileContent(legend);
  const transactions=document.createElement('section');transactions.className='housing-transactions';transactions.setAttribute('aria-label','成交清單');
  transactions.innerHTML='<div class="housing-transaction-heading"><h2>行政區成交明細</h2><button type="button" class="housing-all-button">顯示排除案件</button></div><p class="housing-page-label">請點選行政區查看成交</p><div class="housing-rows"></div><div class="housing-pagination"><button class="housing-prev" disabled>上一批</button><button class="housing-next" disabled>下一批</button></div>';
  shell.viewExtra.append(transactions);
  const pageLabel=transactions.querySelector<HTMLElement>('.housing-page-label')!, rows=transactions.querySelector<HTMLElement>('.housing-rows')!;
  const prev=transactions.querySelector<HTMLButtonElement>('.housing-prev')!,next=transactions.querySelector<HTMLButtonElement>('.housing-next')!;
  const allButton=transactions.querySelector<HTMLButtonElement>('.housing-all-button')!;
  let year=Number(yearSelect.value), group=groupSelect.value as HousingGroup, manifest:HousingManifest|null=null;
  let currentTown:string|null=null, page=0, request=0, showAll=false;
  let lastView:View|null=null;const national=new Map<string,HousingSummary>();let nationalRequest='';
  const query=new URLSearchParams(location.search);
  function updateFilter(){year=Number(yearSelect.value);group=groupSelect.value as HousingGroup;page=0;currentTown=null;query.set('year',String(year));query.set('type',group);history.replaceState(null,'',`${location.pathname}?${query}`);onFilter(year,group);if(manifest)renderSources(manifest);}
  yearSelect.addEventListener('change',updateFilter);groupSelect.addEventListener('change',updateFilter);
  allButton.addEventListener('click',()=>{showAll=!showAll;allButton.textContent=showAll?'只顯示住宅樣本':'顯示排除案件';page=0;if(currentTown)void loadTransactions(currentTown);});
  prev.addEventListener('click',()=>{page=Math.max(0,page-1);if(currentTown)void loadTransactions(currentTown);});
  next.addEventListener('click',()=>{page++;if(currentTown)void loadTransactions(currentTown);});

  async function loadTransactions(town:string){
    const token=++request;currentTown=town;pageLabel.textContent='載入成交資料…';rows.replaceChildren();prev.disabled=true;next.disabled=true;
    try{
      const result=await repo.transactionPage(town,year,page);
      if(token!==request)return;
      const candidates=result.records.filter(t=>showAll || (t.mainUse==='住家用' && (group==='standard'?['apartment','elevator_low','elevator_high'].includes(t.buildingTypeGroup??''):group==='house'?t.buildingTypeGroup==='house':t.buildingTypeGroup===group)));
      pageLabel.textContent=`第 ${page+1} 批 · 收錄${result.total.toLocaleString()}筆住家型態案件；本批${candidates.length}筆符合所選條件`;
      for(const t of candidates){const row=document.createElement('article');row.className='housing-row';
        const head=document.createElement('div');head.className='housing-row-head';const addr=document.createElement('strong');addr.textContent=t.address||t.townName;const amount=document.createElement('b');amount.textContent=t.eligible?formatPrice(t.unitPriceTwdM2!*400/121/10000):'未納入單價';head.append(addr,amount);
        const meta=document.createElement('p');meta.textContent=`${t.tradeDate} · ${t.buildingType||t.target} · ${money(t.totalPriceTwd)} · ${area(t.buildingAreaM2)}`;
        const reason=document.createElement('p');reason.className='housing-row-reason';reason.textContent=t.priceBasis==='parking_included_unknown'?'含車位但無法扣除車位價格／面積':t.reasons.length?`未納入：${t.reasons.join('、')}`:`車位口徑：${t.priceBasis==='no_parking'?'無車位':'已扣車位'}${t.floor?` · ${t.floor}`:''}`;
        const details=document.createElement('details');const more=document.createElement('summary');more.textContent='交易欄位與備註';const detail=document.createElement('p');detail.textContent=`主要用途：${t.mainUse||'未填'}\n總價：${money(t.totalPriceTwd)}\n建物面積：${t.buildingAreaM2??'未填'} m²\n車位：${t.parkingCount??'未標明'} 個；${money(t.parkingPriceTwd)}\n原始單價：${t.sourceUnitPriceTwdM2==null?'未提供':`${Math.round(t.sourceUnitPriceTwdM2).toLocaleString()} 元/m²`}\n備註：${t.note||'無'}\n來源批次：${t.sourceBatch}`;details.append(more,detail);row.append(head,meta,reason,details);rows.append(row);
      }
      if(!candidates.length){const empty=document.createElement('p');empty.textContent='本批沒有符合條件的案件，可切換顯示排除案件或前後批次。';rows.append(empty);}
      prev.disabled=page===0;next.disabled=!result.hasNext;
    }catch(error){if(token!==request)return;pageLabel.textContent=`成交清單載入失敗：${error instanceof Error?error.message:'未知錯誤'}`;const retry=document.createElement('button');retry.textContent='重試';retry.addEventListener('click',()=>void loadTransactions(town));rows.append(retry);}
  }
  function render(view:View){
    lastView=view;const feature=view.selected??view.path.at(-1);const key=`${year}/${group}`;
    const record=feature?repo.get(year,group,feature.properties.code):national.get(key)??null;
    if(!feature&&!record&&nationalRequest!==key){nationalRequest=key;summary.querySelector<HTMLElement>('.housing-price')!.textContent='載入全臺統計…';void repo.getNational(year,group).then(value=>{if(nationalRequest===key){national.set(key,value);if(lastView)render(lastView);}}).catch(()=>{if(nationalRequest===key)summary.querySelector<HTMLElement>('.housing-price')!.textContent='全臺彙總載入失敗';});}
    const price=summary.querySelector<HTMLElement>('.housing-price')!;price.textContent=record?formatPrice(record.status==='insufficient'?null:record.medianWanPing):feature?formatPrice(null):price.textContent;
    summary.querySelector<HTMLElement>('.housing-description')!.textContent=feature?`${feature.properties.name} · ${year} 年 · ${groupName(group)}${record?.status==='low_sample'?' · 樣本偏少':''}`:`${year} 年全臺各縣市成交統計 · ${groupName(group)}`;
    summary.querySelector<HTMLElement>('.housing-eligible')!.textContent=record?record.eligibleCount.toLocaleString('zh-TW'):'—';
    summary.querySelector<HTMLElement>('.housing-residential')!.textContent=record?record.residentialCount.toLocaleString('zh-TW'):'—';
    summary.querySelector<HTMLElement>('.housing-spread')!.textContent=record?.eligibleCount?`P25–P75：${formatPrice(record.p25TwdM2==null?null:record.p25TwdM2*400/121/10000)} 至 ${formatPrice(record.p75TwdM2==null?null:record.p75TwdM2*400/121/10000)}`:'中位數由個別成交單價計算；不平均子行政區統計。';
    summary.querySelector<HTMLElement>('.housing-exclusions')!.textContent=record?`住宅案件 ${record.residentialCount.toLocaleString()} 筆；車位無法拆分 ${record.parkingUnknownCount} 筆；其他未納入 ${record.excludedCount} 筆。`:'樣本不足10筆時不顯示價格色階。';
    const selectedTown=view.selected?.properties.level==='town'?view.selected.properties.code:null;
    if(selectedTown && currentTown!==selectedTown)void loadTransactions(selectedTown);
    else if(!selectedTown){currentTown=null;request++;rows.replaceChildren();pageLabel.textContent=view.level==='county'?'選擇縣市查看行政區統計':'選擇行政區查看成交';}
  }
  function tooltip(hit:RegionHit){const v=repo.get(year,group,hit.region.properties.code);return `${hit.region.properties.name}\n${v?.status==='insufficient'?'樣本不足':formatPrice(v?.medianWanPing)} · ${v?.eligibleCount??0}筆`+(hit.parentIndex!==undefined?'\n點選切換區域':'');}
  function showSources(m:HousingManifest){manifest=m;renderSources(m);}
  function renderSources(m:HousingManifest){
    const section=document.createElement('div');section.className='source-row housing-source';const link=document.createElement('a');link.href=m.catalogUrl;link.target='_blank';link.rel='noopener noreferrer';link.textContent='內政部不動產成交案件實際資訊（買賣）↗';
    const body=document.createElement('p');body.textContent=`來源：${m.provider}；交易年度：${m.periods.join('、')}。下載時間：${m.retrievedAt}。資料建置：${m.builtAt.slice(0,10)}。\n預設統計是住家用公寓／華廈／住宅大樓的可比單價中位數。車位價格和面積齊全時扣除；無法拆分者不計入單價樣本。每案按成交日期歸年。\n${m.limitations.join('\n')}\n${m.counts.conflictingSerials}筆跨批次編號內容衝突已按批次順位處理，詳見品質報告。`;
    body.style.whiteSpace='pre-line';const audit=document.createElement('a');audit.href=`${BASE}data/housing/reports/serial-conflicts.json`;audit.target='_blank';audit.rel='noopener noreferrer';audit.textContent='批次衝突紀錄 ↗';const license=document.createElement('a');license.href=m.licenseUrl;license.target='_blank';license.rel='noopener noreferrer';license.textContent=m.license+' ↗';section.append(link,body,audit,license);shell.sourceContent.replaceChildren(section);
  }
  function obstacles():Rect[]{if(innerWidth<=760)return[];const origin=shell.mapContainer.getBoundingClientRect(),rect=legend.getBoundingClientRect();return[{x:rect.x-origin.x-6,y:rect.y-origin.y-6,w:rect.width+12,h:rect.height+12}];}
  return {render,tooltip,showSources,obstacles,get year(){return year},get group(){return group},get onFilter(){return updateFilter}};
}
