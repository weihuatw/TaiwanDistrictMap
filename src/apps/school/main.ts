import { BoundaryRepository } from '../../map-core/boundaries';
import { createMap } from '../../map-core/create-map';
import { createRegionLayer } from '../../map-core/region-layer';
import type { Region, View } from '../../map-core/types';
import { createMapShell } from '../../ui/map-shell';
import { SchoolRepository } from './data';
import { SchoolNavigator, polygonView } from './navigation';
import { createSchoolMarkers } from './markers';
import { levelName, schoolColor, type School, type SchoolView } from './types';

export function startSchoolApp(root: HTMLElement) {
  root.classList.add('school-page');
  const base = import.meta.env.BASE_URL;
  const boundaries = new BoundaryRepository(`${base}data/`);
  const schools = new SchoolRepository(`${base}data/school/`);
  let layer: ReturnType<typeof createRegionLayer> | undefined;
  let markers: ReturnType<typeof createSchoolMarkers> | undefined;
  let basemap: ReturnType<typeof createMap> | undefined;
  let alive = true;
  let previousPath = '';
  const el = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const getColor = (r: Region) => navigator.current?.selected ? schoolColor(navigator.current.selected.level) : r.properties.color;
  const chooseSchool = (school: School) => { if (layer?.ready) void navigator.choose(school, layer.camera()); };
  const shell = createMapShell(root, {
    brandTitle: '學區地圖', pageTitle: '臺灣學區地圖', getColor, showSelectionCard: false,
    loadingText: '載入學校與學區…', errorText: '學校或行政區資料載入失敗，請重試。',
    sourceIntro: '學校位置主要取自國土測繪中心校地範圍圖，並以官方校園點位補足缺漏；學區收錄臺北市115學年度里鄰對照表，行政區界由國土測繪中心提供。',
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
        const meta = document.createElement('span'); meta.className = 'region-option-meta'; meta.textContent = `${levelName(school.level)} · ${school.catchment ? `${school.catchment.villages.length} 里` : '學區未收錄'}${school.position ? '' : ' · 位置缺漏'}`;
        button.append(swatch, name, meta);
        button.addEventListener('click', () => {
          chooseSchool(school);
          if (innerWidth <= 760) el('list-close').click();
        }); list.append(button);
      }
      if (!matches.length) {
        const empty = document.createElement('p'); empty.className = 'empty-list';
        empty.textContent = !navigator.filter.elementary && !navigator.filter.junior ? '請勾選國小或國中以顯示學校。'
          : !view.schools.length ? '此行政區尚未收錄學校；第一版支援臺北市。'
          : '找不到符合的學校，請調整篩選或搜尋校名。';
        list.append(empty);
      }
      return { title: '選擇學校', summary: `${matches.length} / ${visible.length} 所學校` };
    },
    formatTooltip: hit => {
      if (hit.parentIndex !== undefined) return `切換至 ${hit.region.properties.name}`;
      const village = navigator.current?.selected?.catchment?.villages.find(v => v.code === hit.region.properties.code);
      return village ? `${village.townName} ${village.name}${village.partial ? ' · 含部分鄰' : ''}${village.shared ? ' · 共同學區' : ''}` : hit.region.properties.name;
    },
  });
  shell.mapContainer.setAttribute('aria-label', '臺灣國小與國中學區互動地圖');
  shell.viewExtra.innerHTML = `<fieldset class="school-filter"><legend>顯示學校</legend><label><input type="checkbox" id="filter-elementary" checked /><span class="school-key elementary"></span>國小</label><label><input type="checkbox" id="filter-junior" checked /><span class="school-key junior"></span>國中</label></fieldset><p id="school-coverage" class="school-coverage">學區：臺北市115學年度；其他縣市尚未收錄。</p><div id="school-detail" class="school-detail" hidden></div>`;
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
      layer?.render(polygons, navigator.context, restore);
      markers?.render(view.level === 'school' ? navigator.visibleSchools : [], view.selected, view.level === 'school' ? view.path.at(-1) : undefined);
    },
    onBusy: busy => { shell.setBusy(busy); layer?.setBusy(busy); markers?.setBusy(busy); },
    onError: (error, retry) => shell.showError(error, retry),
  });

  function renderChrome(view: SchoolView) {
    const selected = view.selected;
    el('school-detail').hidden = !selected;
    const county = view.path[0]?.properties.countyCode;
    el('school-coverage').textContent = county && county !== '63000' ? '此縣市尚未收錄；第一版支援臺北市。' : '學區：臺北市115學年度；部分鄰以整里呈現。';
    el('hint-text').textContent = view.level === 'county' ? '點選縣市，探索學校與學區'
      : view.level === 'town' ? '點選行政區查看學校 · 灰色縣市可切換'
      : !navigator.visibleSchools.length ? '勾選國小或國中，或選擇其他行政區'
      : selected ? '點選其他學校切換學區 · 返回查看學校位置' : '點選學校標記，查看學區涵蓋的里';
    el<HTMLInputElement>('region-search').placeholder = view.level === 'school' ? '搜尋校名或學校代碼' : '搜尋目前層級的區域';
    el('region-search').setAttribute('aria-label', el<HTMLInputElement>('region-search').placeholder);
    if (view.level !== 'school') return;
    const title = selected?.name ?? view.path.at(-1)!.properties.name;
    el('location-title').textContent = title; document.title = `${title}｜臺灣學區地圖`;
    el('level-badge').textContent = selected ? '學區' : '學校';
    el('region-count').textContent = selected ? selected.catchment ? `${view.catchment.features.length} 個學區里` : '學區尚未收錄' : `${navigator.visibleSchools.length} 所學校`;
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
      note.textContent = selected.catchment ? `${selected.catchment.year}學年度 · 包含部分鄰與共同學區；填色顯示整個里。` : '尚未取得此校的官方學區對照資料。';
      detail.append(info, note);
      if (selected.catchment) {
        const details = document.createElement('details');
        const summary = document.createElement('summary'); summary.textContent = `涵蓋里清單（${selected.catchment.villages.length}）`;
        const list = document.createElement('ul');
        for (const v of selected.catchment.villages) { const li = document.createElement('li'); li.textContent = `${v.townName} ${v.name}${v.partial ? ' · 部分鄰' : ''}${v.shared ? ' · 共同學區' : ''}`; list.append(li); }
        details.append(summary, list); detail.append(details);
      }
    }
  }

  try {
    basemap = createMap({ container: shell.mapContainer, apiKey: import.meta.env.VITE_TOMTOM_API_KEY, onStatus: shell.setBasemapStatus });
    layer = createRegionLayer(basemap.map, {
      getColor, fillOpacity: .35, hoverOpacity: .47,
      getPadding: () => {
        const rect = root.querySelector('.location-panel')!.getBoundingClientRect();
        if (innerWidth <= 760) return { top: Math.min(rect.bottom + 16, innerHeight * .55), right: 48, bottom: 95, left: 24 };
        return shell.getPadding();
      },
      getLabelObstacles: shell.getLabelObstacles,
      duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 720,
      onReady: shell.markMapReady, onHover: shell.showTooltip, onHoverEnd: shell.hideTooltip,
      onSelect: hit => {
        if (!layer?.ready) return;
        if (hit.parentIndex !== undefined) void navigator.enter(hit.region, undefined, hit.parentIndex);
        else if (navigator.current?.level !== 'school') void navigator.enter(hit.region, layer.camera());
      },
    });
    markers = createSchoolMarkers(basemap.map, chooseSchool);
    void navigator.start();
  } catch { shell.showInitializationError(() => location.reload()); }
  void Promise.all([boundaries.manifest(), schools.manifest()]).then(([geometry, manifest]) => {
    if (!alive) return;
    shell.renderManifest(geometry);
    for (const source of manifest.sources) {
      const row = document.createElement('div'); row.className = 'source-row';
      const link = document.createElement('a'); link.href = source.datasetUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = `${source.title} ↗`;
      const text = document.createElement('p'); text.textContent = `${source.provider} · ${source.release} · 下載 ${source.downloadedAt.slice(0, 10)}`;
      row.append(link, text); shell.sourceContent.append(row);
    }
    const note = document.createElement('p'); note.className = 'source-footnote';
    note.textContent = `${manifest.counts.schools.toLocaleString()} 筆學校／學部資料；${manifest.counts.withCatchment} 筆具學區對照。${manifest.notes.join(' ')} ${manifest.unmatchedSchools} 所學校校地位置未對應。`;
    const audit = document.createElement('a'); audit.href = `${base}data/school/join-report.json`; audit.textContent = '查看資料對照紀錄 ↗'; audit.target = '_blank'; audit.rel = 'noopener noreferrer'; audit.className = 'license-link';
    shell.sourceContent.append(note, audit);
  }).catch(() => { if (alive) shell.showManifestError(); });
  return { destroy() {
    if (!alive) return;
    alive = false; navigator.destroy(); markers?.destroy(); layer?.destroy(); basemap?.destroy(); shell.destroy(); root.classList.remove('school-page');
  } };
}
