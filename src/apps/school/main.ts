import './style.css';
import type { HashRouter, Route } from '../../routing/hash-router';
import { BoundaryRepository } from '../../map-core/boundaries';
import { createMap, type BasemapStyle } from '../../map-core/create-map';
import { createRegionLayer } from '../../map-core/region-layer';
import type { Region, RegionOutline, Regions, View } from '../../map-core/types';
import { createMapShell } from '../../ui/map-shell';
import { SchoolRepository } from './data';
import { createCatchmentOutline } from './catchment-outline';
import { SchoolNavigator, polygonView } from './navigation';
import { createSchoolMarkers } from './markers';
import { emptyRegions, levelName, schoolColor, type School, type SchoolView, type SchoolManifest } from './types';
import { IncomeRepository } from '../income/data';
import type { IncomeRecord } from '../income/types';
import { COLORS as INCOME_COLORS, LABELS as INCOME_LABELS, MISSING_COLOR as INCOME_MISSING, recordColor, formatWan } from '../income/theme';
import { HousingRepository } from '../housing/data';
import { COLORS as HOUSING_COLORS, LABELS as HOUSING_LABELS, MISSING as HOUSING_MISSING, color as housingColor, formatPrice } from '../housing/theme';

type MapDisplayMode = 'school' | 'income' | 'housing';
const HOUSING_YEAR = 2025;
const HOUSING_GROUP = 'standard' as const;
const EMPTY_OUTLINE: RegionOutline = { type: 'FeatureCollection', features: [] };
const catchmentOutlineCache = new WeakMap<Regions, RegionOutline>();

function outlineForCatchment(regions: Regions): RegionOutline {
  let outline = catchmentOutlineCache.get(regions);
  if (!outline) {
    outline = createCatchmentOutline(regions.features);
    catchmentOutlineCache.set(regions, outline);
  }
  return outline;
}

function comparisonStyle(mode: MapDisplayMode): BasemapStyle {
  return mode === 'school' ? 'standardLight' : 'monoLight';
}

function housingCode(region: Region) {
  if (region.properties.level === 'village') return region.properties.townCode ?? region.properties.code.slice(0, 8);
  return region.properties.code;
}

export function startSchoolApp(root: HTMLElement, routing?: HashRouter) {
  root.classList.add('school-page');
  const base = import.meta.env.BASE_URL;
  const boundaries = new BoundaryRepository(`${base}data/`);
  const schools = new SchoolRepository(`${base}data/school/`);
  const income = new IncomeRepository(`${base}data/income/2024/`);
  const housing = new HousingRepository(`${base}data/housing/`);
  let layer: ReturnType<typeof createRegionLayer> | undefined;
  let markers: ReturnType<typeof createSchoolMarkers> | undefined;
  let basemap: ReturnType<typeof createMap> | undefined;
  let alive = true;
  let previousPath = '';
  let schoolManifest: SchoolManifest | undefined;
  const initialMode = new URLSearchParams(routing?.current.query ?? '').get('map');
  let displayMode: MapDisplayMode = initialMode === 'income' || initialMode === 'housing' ? initialMode : 'school';
  let navigationBusy = false;
  let overlayBusy = false;
  let overlaySequence = 0;
  let displayedView: View | undefined;
  const el = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const getColor = (r: Region) => {
    if (displayMode === 'income') return recordColor(income.get(r.properties.code));
    if (displayMode === 'housing') return housingColor(housing.get(HOUSING_YEAR, HOUSING_GROUP, housingCode(r)));
    return navigator.current?.selected ? schoolColor(navigator.current.selected.level) : r.properties.color;
  };
  const isMissing = (r: Region) => displayMode === 'income'
    ? income.get(r.properties.code)?.meanK == null
    : displayMode === 'housing' && (() => {
      const summary = housing.get(HOUSING_YEAR, HOUSING_GROUP, housingCode(r));
      return !summary || summary.status === 'no_samples' || summary.status === 'insufficient' || summary.medianWanPing == null;
    })();
  const chooseSchool = (school: School) => { if (layer?.ready) void navigator.choose(school, layer.camera(), displayMode !== 'school'); };
  const shell = createMapShell(root, {
    brandTitle: '學區地圖', pageTitle: '臺灣學區地圖', getColor, showSelectionCard: false,
    loadingText: '載入學校與學區…', errorText: '學校或行政區資料載入失敗，請重試。',
    sourceIntro: '學校位置採教育部地理資訊及國土測繪中心校地圖；學區依各縣市官方公告對照村里，學年度與收錄情況分別標示。',
    onChoose: region => { if (layer?.ready && navigator.current?.level !== 'school') void navigator.enter(region, layer.camera()); },
    onBack: () => navigator.back(), onHome: () => navigator.home(), onNavigate: index => navigator.goTo(index),
    onPanelChange: () => layer?.scheduleLabels(),
    customList: (_view: View, query: string, list: HTMLElement) => {
      const view = navigator.current;
      if (view?.level !== 'school') return;
      list.replaceChildren();
      const visible = navigator.visibleSchools;
      const matches = visible.filter(s => `${s.name} ${s.code ?? s.id}`.replaceAll('台', '臺').toLowerCase().includes(query));
      for (const school of matches) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'region-option school-option';
        button.dataset.schoolId = school.id;
        button.setAttribute('aria-pressed', String(view.selected?.id === school.id));
        const swatch = document.createElement('span'); swatch.className = 'region-swatch'; swatch.style.background = schoolColor(school.level);
        const name = document.createElement('span'); name.className = 'region-option-name'; name.textContent = school.name;
        const meta = document.createElement('span'); meta.className = 'region-option-meta'; meta.textContent = `${levelName(school.level)} · ${school.catchment ? school.catchment.villages.length ? `${school.catchment.villages.length} 里` : '尚無里界對照' : '學區未收錄'}${school.position ? '' : ' · 位置缺漏'}`;
        button.append(swatch, name, meta);
        button.addEventListener('click', () => {
          chooseSchool(school);
          if (innerWidth <= 760) el('list-close').click();
        }); list.append(button);
      }
      if (!matches.length) {
        const empty = document.createElement('p'); empty.className = 'empty-list';
        empty.textContent = !navigator.filter.elementary && !navigator.filter.junior ? '請勾選國小或國中以顯示學校。'
          : !view.schools.length ? '此行政區沒有已收錄的國小或國中。'
          : '找不到符合的學校，請調整篩選或搜尋校名。';
        list.append(empty);
      }
      return { title: '選擇學校', summary: `${matches.length} / ${visible.length} 所學校` };
    },
    formatTooltip: hit => {
      if (hit.parentIndex !== undefined) return `切換至 ${hit.region.properties.name}`;
      const village = navigator.current?.selected?.catchment?.villages.find(v => v.code === hit.region.properties.code);
      const baseName = village ? `${village.townName} ${village.name}${village.partial ? ' · 含部分鄰' : ''}${village.shared ? ' · 共同學區' : ''}` : hit.region.properties.name;
      if (displayMode === 'income') {
        const value = income.get(hit.region.properties.code)?.meanK;
        return `${baseName} · ${value == null ? '無所得資料' : `${formatWan(value)} 萬／戶／年`}`;
      }
      if (displayMode === 'housing') {
        const value = housing.get(HOUSING_YEAR, HOUSING_GROUP, housingCode(hit.region));
        const scope = hit.region.properties.level === 'village' ? `${hit.region.properties.townName ?? '所屬鄉鎮'}房價` : '房價';
        return `${baseName} · ${scope} ${formatPrice(value?.medianWanPing)}${value?.status === 'low_sample' ? ' · 樣本偏少' : ''}`;
      }
      return baseName;
    },
  });
  shell.mapContainer.setAttribute('aria-label', '臺灣國小與國中學區互動地圖');
  shell.viewExtra.innerHTML = `<fieldset class="school-filter"><legend>顯示學校</legend><label><input type="checkbox" id="filter-elementary" checked /><span class="school-key elementary"></span>國小</label><label><input type="checkbox" id="filter-junior" checked /><span class="school-key junior"></span>國中</label></fieldset><fieldset class="school-map-display"><legend>地圖著色</legend><label><input type="radio" name="school-map-mode" value="school" checked />學區</label><label><input type="radio" name="school-map-mode" value="income" />所得</label><label><input type="radio" name="school-map-mode" value="housing" />房價</label></fieldset><p id="school-map-description" class="school-map-description"></p><div id="school-map-legend" class="school-map-legend" hidden></div><p id="school-coverage" class="school-coverage">全臺學校 · 學區依各縣市公告收錄</p><div id="school-detail" class="school-detail" hidden></div>`;
  const mapStatus = document.createElement('div');
  mapStatus.className = 'school-map-status'; mapStatus.setAttribute('role', 'status'); mapStatus.setAttribute('aria-live', 'polite'); mapStatus.hidden = true;
  root.querySelector('.map-ui')?.append(mapStatus);
  for (const level of ['elementary', 'junior'] as const) el<HTMLInputElement>(`filter-${level}`).addEventListener('change', event => {
    if (layer) navigator.setFilter(level, (event.target as HTMLInputElement).checked, layer.camera());
  });
  const navigator = new SchoolNavigator({
    loadRegions: file => boundaries.load(file), loadSchools: code => schools.load(code),
    loadCatchment: school => schools.catchment(school, boundaries),
    onChange: (view, restore) => {
      const pathKey = view.path.map(r => r.properties.code).join('/');
      const search = pathKey === previousPath ? el<HTMLInputElement>('region-search').value : '';
      const polygons = polygonView(view);
      shell.render(polygons); renderChrome(view);
      if (search) { el<HTMLInputElement>('region-search').value = search; shell.refreshList(); }
      previousPath = pathKey;
      for (const level of ['elementary', 'junior'] as const) el<HTMLInputElement>(`filter-${level}`).checked = navigator.filter[level];
      commitRoute(view);
      renderMapForView(view, restore);
    },
    onBusy: busy => { navigationBusy = busy; updateBusy(); if (!busy) layer?.cancelPreview(); },
    onError: (error, retry) => shell.showError(error, retry),
    onPreview: target => {
      if ('properties' in target) layer?.previewRegion(target);
      else if (target.position) layer?.previewPoint(target.position);
    },
  });

  for (const input of shell.viewExtra.querySelectorAll<HTMLInputElement>('input[name="school-map-mode"]')) {
    input.addEventListener('change', () => {
      if (!input.checked || !['school', 'income', 'housing'].includes(input.value)) return;
      const previousMode = displayMode;
      displayMode = input.value as MapDisplayMode;
      const view = navigator.current;
      if (!view) return;
      commitRoute(view);
      renderChrome(view);
      setBasemapStyle(displayMode);
      renderMapForView(view, true, true, previousMode !== displayMode);
    });
  }

  function setBasemapStyle(mode: MapDisplayMode) {
    const style = comparisonStyle(mode);
    if (!basemap?.supportsStyleChanges || basemap.style === style) return;
    layer?.prepareStyleChange();
    basemap.setStyle(style);
  }

  function updateBusy() {
    const busy = navigationBusy || overlayBusy;
    shell.setBusy(busy); layer?.setBusy(busy); markers?.setBusy(busy);
    if (!busy) layer?.cancelPreview();
  }

  function commitRoute(view: SchoolView) {
    const params = new URLSearchParams();
    for (const [level, checked] of Object.entries(navigator.filter)) if (!checked) params.set(level, 'false');
    if (displayMode !== 'school') params.set('map', displayMode);
    routing?.commit({
      theme: 'school', ids: [...view.path.map(r => r.properties.code), ...(view.selected ? [view.selected.id] : [])],
      query: params.toString(),
    });
  }

  function comparisonDescription(view: SchoolView) {
    if (displayMode === 'school') return '依學校官方公告顯示學區涵蓋里；選校後以學區填色。';
    if (displayMode === 'income') return `2024 年平均綜合所得（萬元／申報戶／年）。${view.level === 'school' ? '顯示目前行政區各里資料' : '依目前行政層級著色'}；斜紋表示無資料，底圖改為灰階。`;
    return `2025 年住宅成交單價中位數（萬元／坪），以鄉鎮市區資料著色。${view.level === 'school' ? '顯示全縣市各行政區' : '同一鄉鎮的各里呈現相同色階'}；灰色表示樣本不足，底圖改為灰階。`;
  }

  function updateDisplayChrome(view: SchoolView) {
    const description = el('school-map-description');
    const legend = el('school-map-legend');
    const selected = view.selected;
    const name = displayMode === 'school' ? '學區' : displayMode === 'income' ? '所得' : '房價';
    const scope = view.level === 'county' ? '全臺縣市'
      : view.level === 'town' ? '縣市內鄉鎮市區'
      : displayMode === 'housing' ? '全縣市鄉鎮市區' : '目前行政區各里';
    const entries = displayMode === 'income'
      ? INCOME_LABELS.map((label, index) => [label, INCOME_COLORS[index]] as const)
      : displayMode === 'housing' ? HOUSING_LABELS.map((label, index) => [label, HOUSING_COLORS[index]] as const) : [];
    description.textContent = comparisonDescription(view);
    legend.hidden = displayMode === 'school';
    legend.replaceChildren();
    if (displayMode !== 'school') {
      const heading = document.createElement('strong'); heading.textContent = `${name}色階 · ${scope}`; legend.append(heading);
      const row = document.createElement('div'); row.className = 'school-map-legend-row';
      for (const [label, color] of entries) {
        const item = document.createElement('span'); item.className = 'school-map-legend-item';
        const swatch = document.createElement('i'); swatch.style.backgroundColor = color; swatch.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span'); text.textContent = label; item.append(swatch, text); row.append(item);
      }
      const missing = document.createElement('span'); missing.className = 'school-map-legend-item';
      const swatch = document.createElement('i'); swatch.style.backgroundColor = displayMode === 'income' ? INCOME_MISSING : HOUSING_MISSING; swatch.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span'); text.textContent = '無資料'; missing.append(swatch, text); row.append(missing);
      legend.append(row);
    }
    for (const input of shell.viewExtra.querySelectorAll<HTMLInputElement>('input[name="school-map-mode"]')) input.checked = input.value === displayMode;
    mapStatus.hidden = displayMode === 'school';
    mapStatus.textContent = displayMode === 'school' ? '' : `${name} · ${scope}${selected ? ' · 學區粗框' : ''}`;
  }

  async function comparisonRegions(view: SchoolView, normal: View, mode: MapDisplayMode): Promise<Regions> {
    if (view.level !== 'school') return normal.data;
    if (mode === 'housing') {
      const countyCode = view.path[0]?.properties.code;
      if (!countyCode) return emptyRegions();
      return boundaries.load(`towns/${countyCode}.geojson`);
    }
    const townCode = view.path.at(-1)?.properties.code;
    if (!townCode) return emptyRegions();
    return boundaries.load(`villages/${townCode}.geojson`);
  }

  async function loadComparisonSummaries(mode: MapDisplayMode, view: SchoolView, regions: Regions) {
    if (mode === 'income') {
      if (view.level === 'county') return income.load('counties.geojson');
      if (view.level === 'town') return income.load(`towns/${view.path[0].properties.code}.geojson`);
      const towns = new Set(regions.features.map(region => region.properties.townCode ?? region.properties.code.slice(0, 8)));
      for (const village of view.selected?.catchment?.villages ?? []) towns.add(village.townCode);
      return Promise.all([...towns].map(code => income.load(`villages/${code}.geojson`)));
    }
    if (mode === 'housing') {
      if (view.level === 'county') return housing.load('counties.geojson', HOUSING_YEAR, HOUSING_GROUP);
      const counties = new Set(view.level === 'town'
        ? [view.path[0].properties.code]
        : regions.features.map(region => region.properties.code.slice(0, 5)));
      for (const village of view.selected?.catchment?.villages ?? []) counties.add(village.townCode.slice(0, 5));
      return Promise.all([...counties].map(code => housing.load(`towns/${code}.geojson`, HOUSING_YEAR, HOUSING_GROUP)));
    }
  }

  function renderSchoolAreaStats(view: SchoolView, state: 'loading' | 'ready' | 'error' = 'ready') {
    const stats = root.querySelector<HTMLElement>('.school-area-stats');
    if (!stats || displayMode === 'school' || !view.selected) return;
    stats.replaceChildren();
    const heading = document.createElement('strong'); stats.append(heading);
    if (state === 'loading' || state === 'error') {
      heading.textContent = displayMode === 'income' ? '學區所得行政區參考' : '學區房價行政區參考';
      const message = document.createElement('p');
      message.textContent = state === 'loading' ? '行政區資料載入中…' : '行政區統計載入失敗，請重試。';
      stats.append(message); return;
    }
    const villages = [...new Map((view.selected.catchment?.villages ?? []).map(village => [village.code, village])).values()];
    if (!villages.length) {
      heading.textContent = displayMode === 'income' ? '學區所得行政區參考' : '學區房價行政區參考';
      const message = document.createElement('p'); message.className = 'school-note';
      message.textContent = '此校目前沒有可對應的學區里，無法彙整行政區參考數值。'; stats.append(message); return;
    }
    if (displayMode === 'income') {
      heading.textContent = '2024 年學區涵蓋里所得加權平均';
      const records = villages.map(village => income.get(village.code))
        .filter((record): record is IncomeRecord => record !== null && record.taxUnits > 0 && record.meanK != null);
      const taxUnits = records.reduce((sum, record) => sum + record.taxUnits, 0);
      const incomeTotalK = records.reduce((sum, record) => sum + record.incomeTotalK, 0);
      const value = document.createElement('p'); value.className = 'school-area-stats-value';
      value.textContent = taxUnits ? `${formatWan(incomeTotalK / taxUnits)} 萬元／申報戶／年` : '無可彙整所得資料';
      const coverage = document.createElement('p'); coverage.className = 'school-note';
      coverage.textContent = `涵蓋里所得資料 ${records.length}／${villages.length} 里；以申報戶數加權，缺漏里不納入。部分鄰／共同學區仍採整里統計。`;
      stats.append(value, coverage);
      return;
    }
    heading.textContent = `${HOUSING_YEAR} 年住宅成交單價中位數（依學區涵蓋行政區）`;
    const towns = new Map<string, string>();
    for (const village of villages) towns.set(village.townCode, village.townName);
    const list = document.createElement('ul'); list.className = 'school-area-stats-list';
    for (const [townCode, townName] of towns) {
      const summary = housing.get(HOUSING_YEAR, HOUSING_GROUP, townCode);
      const row = document.createElement('li');
      const area = document.createElement('span'); area.textContent = townName;
      const price = document.createElement('strong');
      price.textContent = !summary || summary.status === 'no_samples' || summary.status === 'insufficient'
        ? '樣本不足' : `${formatPrice(summary.medianWanPing)}${summary.status === 'low_sample' ? ' · 樣本偏少' : ''}`;
      row.append(area, price);
      if (summary && summary.status !== 'no_samples' && summary.status !== 'insufficient') {
        const count = document.createElement('span'); count.className = 'school-note'; count.textContent = `${summary.eligibleCount.toLocaleString()} 筆`; row.append(count);
      }
      list.append(row);
    }
    const caveat = document.createElement('p'); caveat.className = 'school-note';
    caveat.textContent = '房價僅能提供鄉鎮市區統計；各區中位數分列，不合併成學區價格。部分鄰／共同學區仍按整里所屬行政區列示。';
    stats.append(list, caveat);
  }

  function renderMapForView(view: SchoolView, restore = false, preserveCamera = false, fitComparisonArea = false) {
    const ticket = ++overlaySequence;
    const mode = displayMode;
    const normal = polygonView(view);
    const cameraSnapshot = preserveCamera ? layer?.camera() : undefined;
    const visibleSchools = navigator.visibleSchools;
    const afterRender = () => markers?.render(view.level === 'school' ? visibleSchools : [], view.selected, view.level === 'school' ? view.path.at(-1) : undefined);
    updateDisplayChrome(view);
    if (mode !== 'school' && view.selected?.catchment) renderSchoolAreaStats(view, 'loading');
    if (displayMode === 'school') {
      overlayBusy = false; updateBusy();
      const current = { ...normal, camera: view.camera ?? cameraSnapshot ?? normal.camera };
      displayedView = current;
      layer?.render(current, navigator.context, restore || cameraSnapshot != null, afterRender, EMPTY_OUTLINE);
      return;
    }
    overlayBusy = true; updateBusy();
    void (async () => {
      const regions = await comparisonRegions(view, normal, mode);
      await loadComparisonSummaries(mode, view, regions);
      if (!alive || ticket !== overlaySequence) return;
      renderSchoolAreaStats(view);
      const current: View = { ...normal, data: regions, camera: fitComparisonArea ? null : view.camera ?? cameraSnapshot ?? normal.camera };
      const frameRegion = view.level === 'school'
        ? mode === 'income' ? view.path.at(-1) : view.path[0]
        : undefined;
      const frame = frameRegion && view.level === 'school' ? {
        ...current,
        path: [...current.path.slice(0, -1), { ...current.path.at(-1)!, properties: { ...current.path.at(-1)!.properties, focusBounds: frameRegion.properties.focusBounds } }],
      } : current;
      const emphasis = view.selected ? outlineForCatchment(view.catchment) : EMPTY_OUTLINE;
      displayedView = current;
      layer?.render(frame, navigator.context, restore || view.camera != null || cameraSnapshot != null || fitComparisonArea, afterRender, emphasis);
      overlayBusy = false; updateBusy();
      updateDisplayChrome(view);
    })().catch(error => {
      if (!alive || ticket !== overlaySequence) return;
      renderSchoolAreaStats(view, 'error');
      overlayBusy = false; updateBusy();
      shell.showError(error, () => renderMapForView(view, true, true));
    });
  }

  function renderChrome(view: SchoolView) {
    const selected = view.selected;
    el('school-detail').hidden = !selected;
    const county = view.path[0]?.properties.countyCode;
    const coverage = schoolManifest?.coverage?.find(c => c.countyCode === county);
    el('school-coverage').textContent = view.level === 'school'
      ? `${view.schools.filter(s => s.catchment).length} / ${view.schools.length} 所有學區資料 · 部分鄰以整里呈現`
      : coverage ? `${coverage.countyName}：${coverage.withCatchment} 所有學區資料${coverage.years.length ? ` · ${coverage.years.join('、')}學年度` : ''}` : '全臺學校 · 學區依各縣市公告收錄';
    el('hint-text').textContent = view.level === 'county' ? '點選縣市，探索學校與學區'
      : view.level === 'town' ? '點選行政區查看學校 · 灰色縣市可切換'
      : displayMode !== 'school' ? '點選灰色鄰近行政區切換比較，或點選學校查看學區'
      : !navigator.visibleSchools.length ? '勾選國小或國中，或選擇其他行政區'
      : selected ? '點選其他學校切換學區 · 返回查看學校位置' : '點選學校標記，查看學區涵蓋的里';
    el<HTMLInputElement>('region-search').placeholder = view.level === 'school' ? '搜尋校名或學校代碼' : '搜尋目前層級的區域';
    el('region-search').setAttribute('aria-label', el<HTMLInputElement>('region-search').placeholder);
    if (view.level !== 'school') return;
    const title = selected?.name ?? view.path.at(-1)!.properties.name;
    el('location-title').textContent = title; document.title = `${title}｜臺灣學區地圖`;
    el('level-badge').textContent = selected ? '學區' : '學校';
    el('region-count').textContent = selected ? selected.catchment ? view.catchment.features.length ? `${view.catchment.features.length} 個學區里` : '尚無里界對照' : '學區尚未收錄' : `${navigator.visibleSchools.length} 所學校`;
    el('back-label').textContent = `返回${selected ? view.path.at(-1)!.properties.name : view.path[0].properties.name}`;
    el('announcement').textContent = `${title}，${el('region-count').textContent}`;
    if (selected) {
      const crumbs = el('breadcrumbs'); crumbs.replaceChildren();
      for (const [index, name] of ['全臺', ...view.path.map(r => r.properties.name), selected.name].entries()) {
        if (index) { const divider = document.createElement('span'); divider.textContent = '›'; divider.className = 'breadcrumb-divider'; crumbs.append(divider); }
        const node = document.createElement(index < 3 ? 'button' : 'span'); node.textContent = name;
        if (index < 3) node.addEventListener('click', () => navigator.goTo(index));
        else node.setAttribute('aria-current', 'location');
        crumbs.append(node);
      }
      const detail = el('school-detail'); detail.replaceChildren();
      const info = document.createElement('p'); info.textContent = `${levelName(selected.level)}${selected.code ? ` · 學校代碼 ${selected.code}` : ''}${selected.position ? '' : ' · 校地位置缺漏，可查看學區'}`;
      const note = document.createElement('p'); note.className = 'school-note';
      const displayNote = displayMode === 'school' ? '填色標示涵蓋里' : '粗框標示涵蓋里';
      note.textContent = selected.catchment ? `${selected.catchment.year ? `${selected.catchment.year}學年度資料` : '現行學區公告'} · ${displayNote}，部分鄰與共同學區另有註記。` : '尚未取得此校的官方學區對照資料。';
      detail.append(info, note);
      if (displayMode !== 'school' && selected.catchment) {
        const stats = document.createElement('section'); stats.className = 'school-area-stats';
        stats.setAttribute('aria-live', 'polite'); detail.append(stats);
        renderSchoolAreaStats(view, 'loading');
      }
      if (displayMode !== 'school' && selected.catchment?.villages.length) {
        const focus = document.createElement('button'); focus.type = 'button'; focus.className = 'back-button school-fit-catchment';
        focus.textContent = '查看完整學區'; focus.addEventListener('click', () => { if (displayedView) layer?.focus(displayedView); });
        detail.append(focus);
      }
      if (selected.catchment) {
        if (selected.catchment.unresolvedVillages?.length) {
          const incomplete = document.createElement('p'); incomplete.className = 'school-note';
          incomplete.textContent = `部分村里尚未完成里界對照：${selected.catchment.unresolvedVillages.join('、')}。請參照官方原文。`;
          detail.append(incomplete);
        }
        const details = document.createElement('details');
        const summary = document.createElement('summary'); summary.textContent = `涵蓋里清單（${selected.catchment.villages.length}）`;
        const list = document.createElement('ul');
        for (const v of selected.catchment.villages) { const li = document.createElement('li'); li.textContent = `${v.townName} ${v.name}${v.partial ? ' · 部分鄰' : ''}${v.shared ? ' · 共同學區' : ''}`; list.append(li); }
        details.append(summary, list); detail.append(details);
        for (const id of selected.catchment.sourceIds ?? [selected.catchment.sourceId]) {
          const source = schoolManifest?.sources.find(s => s.id === id);
          if (source) { const link = document.createElement('a'); link.href = source.datasetUrl; link.textContent = '查看官方資料 ↗'; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.className = 'school-source-link'; detail.append(link); }
        }
        if (selected.catchment.text) {
          const original = document.createElement('details');
          const heading = document.createElement('summary'); heading.textContent = '官方學區原文與備註';
          const text = document.createElement('p'); text.className = 'school-original'; text.textContent = `${selected.catchment.text}${selected.catchment.notes ?? ''}`;
          original.append(heading, text); detail.append(original);
        }
      }
    }
  }

  function restoreRoute(route: Route) {
    const params = new URLSearchParams(route.query);
    const requestedMode = params.get('map');
    if (requestedMode === 'income' || requestedMode === 'housing') displayMode = requestedMode;
    else if (!navigator.current || !routing?.isHistoryNavigation) displayMode = 'school';
    setBasemapStyle(displayMode);
    if (!navigator.current || !routing?.isHistoryNavigation) for (const level of ['elementary', 'junior'] as const) navigator.filter[level] = params.get(level) !== 'false';
    return navigator.restorePath(route.ids);
  }
  try {
    basemap = createMap({ container: shell.mapContainer, apiKey: import.meta.env.VITE_TOMTOM_API_KEY, style: comparisonStyle(displayMode), onStatus: shell.setBasemapStatus });
    layer = createRegionLayer(basemap.map, {
      getColor, fillOpacity: .35, hoverOpacity: .47, contextOpacity: .4, contextHoverOpacity: .5,
      isMissing,
      deferUntilMoveEnd: true, fadeDuration: 180,
      getPadding: shell.getPadding,
      getLabelObstacles: shell.getLabelObstacles,
      duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 720,
      onReady: shell.markMapReady, onHover: shell.showTooltip, onHoverEnd: shell.hideTooltip,
      onSelect: hit => {
        if (!layer?.ready) return;
        if (hit.parentIndex !== undefined) void navigator.enter(hit.region, undefined, hit.parentIndex);
        else if (displayMode === 'housing' && navigator.current?.level === 'school'
          && hit.region.properties.level === 'town'
          && hit.region.properties.code !== navigator.current?.path.at(-1)?.properties.code) {
          void navigator.enter(hit.region, layer.camera(), 1);
        }
        else if (navigator.current?.level !== 'school') void navigator.enter(hit.region, layer.camera());
      },
    });
    markers = createSchoolMarkers(basemap.map, chooseSchool);
    if (routing) void restoreRoute(routing.current); else void navigator.start();
  } catch { shell.showInitializationError(() => location.reload()); }
  void Promise.all([boundaries.manifest(), schools.manifest()]).then(([geometry, manifest]) => {
    if (!alive) return;
    schoolManifest = manifest;
    if (navigator.current) renderChrome(navigator.current);
    shell.renderManifest(geometry);
    for (const source of manifest.sources) {
      const row = document.createElement('div'); row.className = 'source-row';
      const link = document.createElement('a'); link.href = source.datasetUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = `${source.title} ↗`;
      const text = document.createElement('p'); text.textContent = `${source.provider} · ${source.release} · 下載 ${source.downloadedAt.slice(0, 10)}`;
      row.append(link, text); shell.sourceContent.append(row);
    }
    const note = document.createElement('p'); note.className = 'source-footnote';
    note.textContent = `${manifest.counts.schools.toLocaleString()} 筆學校／學部資料；${manifest.counts.withCatchment} 筆具學區對照。${manifest.notes.join(' ')} ${manifest.unmatchedSchools} 筆公告學校名稱尚未完成對照。`;
    const audit = document.createElement('a'); audit.href = `${base}data/school/join-report.json`; audit.textContent = '查看資料對照紀錄 ↗'; audit.target = '_blank'; audit.rel = 'noopener noreferrer'; audit.className = 'license-link';
    shell.sourceContent.append(note, audit);
  }).catch(() => { if (alive) shell.showManifestError(); });
  return { restoreRoute, destroy() {
    if (!alive) return;
    alive = false; navigator.destroy(); markers?.destroy(); layer?.destroy(); basemap?.destroy(); shell.destroy(); root.classList.remove('school-page');
  } };
}
