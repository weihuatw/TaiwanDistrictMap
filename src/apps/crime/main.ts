import './style.css';
import { routeHash, type HashRouter, type Route } from '../../routing/hash-router';
import { BoundaryRepository } from '../../map-core/boundaries';
import { createMap } from '../../map-core/create-map';
import { RegionNavigator } from '../../map-core/navigation';
import { createRegionLayer } from '../../map-core/region-layer';
import { sortRegionsByValue } from '../../map-core/region-sort';
import type { Region, View, Camera } from '../../map-core/types';
import { createMapShell } from '../../ui/map-shell';
import { CrimeRepository, type CrimeSnapshot } from '../../data/crime';
import { createCrimePanel } from './panel';
import { color, format, parseFilter, filterQuery, value, type Filter } from './theme';

export function startCrimeApp(root: HTMLElement, routing?: HashRouter) {
  const base = import.meta.env.BASE_URL, boundaries = new BoundaryRepository(`${base}data/`), repo = new CrimeRepository(`${base}data/crime/`);
  let filter = parseFilter(routing?.current.query ?? ''), requested = filter, data: CrimeSnapshot | undefined;
  let alive = true, loaded: CrimeSnapshot | undefined, saved: { camera: Camera; search: string } | undefined;
  let layer: ReturnType<typeof createRegionLayer> | undefined, map: ReturnType<typeof createMap> | undefined;
  const record = (r: Region) => data?.records[r.properties.code], shown = (r: Region) => value(record(r), filter), getColor = (r: Region) => color(record(r), filter, r.properties.level);
  const idsFor = (view: View) => [...view.path.map(r => r.properties.code), ...(view.selected ? [view.selected.properties.code] : [])];
  const routeFor = (view: View): Route => ({ theme: 'crime', ids: idsFor(view), query: filterQuery(filter) });
  const shell = createMapShell(root, { routing, getCamera: () => layer?.ready && nav.current ? layer.camera() : undefined, brandTitle: '刑事統計', pageTitle: '臺灣刑事統計地圖', getColor, showSelectionCard: false,
    loadingText: '載入刑事統計與行政區…', errorText: '刑事統計或行政區載入失敗，請重試。', sourceIntro: '警政署與內政部公開刑事統計，行政區界來自國土測繪中心。只呈現區域彙總，人口分母採戶政司對應期間人口。',
    rowMeta: r => format(shown(r), filter.metric), sortRegions: (regions, direction) => sortRegionsByValue(regions, shown, direction), formatTooltip: hit => `${hit.region.properties.name} · ${format(shown(hit.region), filter.metric)}`,
    onChoose: choose, onBack: back, onHome: home, onNavigate: index => { cancelPending(); if (nav.current?.selected && index === nav.stack.length - 1) void nav.restorePath(nav.current.path.map(r => r.properties.code), selection()); else nav.goTo(index); }, onPanelChange: () => layer?.scheduleLabels() });
  const panel = createCrimePanel(shell, changeFilter);
  const selection = () => requested.scope === 'official' ? 'county' as const : true;
  const nav = new RegionNavigator(async file => {
    const pending = requested;
    const [geometry, next] = await Promise.all([boundaries.load(file), repo.snapshot(pending.year, pending.scope, pending.period)]);
    if (alive && requested === pending) loaded = next;
    return geometry;
  }, (view, restore = false) => {
    if (!alive || !loaded) return;
    filter = { ...requested, category: loaded.categories.includes(requested.category) ? requested.category : 'total' }; requested = filter; data = loaded;
    const route = routeFor(view), camera = routing?.consumeRouteCamera(route), keep = saved;
    if (camera) view.camera = camera; else if (keep) view.camera = keep.camera;
    saved = undefined; routing?.commit(route); shell.render(view); panel.render(view, filter, data);
    // History can still be removing an old descendant while this new view renders.
    const ownLink = shell.root.querySelector<HTMLAnchorElement>('[data-map-page=crime]');
    if (ownLink) ownLink.href = routeHash(route);
    if (keep) { shell.root.querySelector<HTMLInputElement>('[data-ui=region-search]')!.value = keep.search; shell.refreshList(); }
    layer?.render(view, nav.context, restore && !keep, undefined, undefined, !!keep);
  }, busy => { shell.setBusy(busy); panel.setBusy(busy || !nav.current); layer?.setBusy(busy); if (!busy) layer?.cancelPreview(); }, (error, retry) => { saved = undefined; panel.setFilter(filter, data?.categories); shell.showError(error, retry); }, r => layer?.previewRegion(r));
  function choose(region: Region) {
    if (!layer?.ready || !nav.current) return;
    cancelPending();
    if (filter.scope === 'official') { nav.current.camera = null; void nav.restorePath([region.properties.code], 'county'); }
    else if (nav.current.level === 'town') { nav.current.camera = layer.camera(); nav.selectTown(region); }
    else void nav.enter(region, layer.camera());
  }
  function cancelPending() { requested = filter; loaded = data; saved = undefined; }
  function back() { cancelPending(); if (nav.current?.selected) void nav.restorePath(nav.current.path.map(r => r.properties.code), selection()); else nav.back(); }
  function home() { cancelPending(); if (nav.stack[0]) nav.stack[0].camera = null; void nav.restorePath([], selection()); }
  function changeFilter(next: Filter) {
    if (!alive || !nav.current) return;
    if (layer?.ready) saved = { camera: layer.camera(), search: shell.root.querySelector<HTMLInputElement>('[data-ui=region-search]')!.value };
    requested = next; panel.setBusy(true); shell.hideTooltip();
    void nav.restorePath(idsFor(nav.current).slice(0, next.scope === 'official' ? 1 : 2), selection());
  }
  function restoreRoute(route: Route) { saved = undefined; requested = parseFilter(route.query); return nav.restorePath(route.ids.slice(0, requested.scope === 'official' ? 1 : 2), selection()); }
  panel.setFilter(filter); panel.setBusy(true);
  try {
    map = createMap({ container: shell.mapContainer, apiKey: import.meta.env.VITE_TOMTOM_API_KEY, style: 'monoLight', onStatus: shell.setBasemapStatus });
    layer = createRegionLayer(map.map, { getColor, isMissing: r => shown(r) === null, fillOpacity: .65, hoverOpacity: .65, selectedOpacity: .65, getPadding: shell.getPadding, getLabelObstacles: () => [...shell.getLabelObstacles(), ...panel.obstacles()], duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 720, onReady: shell.markMapReady, onHover: shell.showTooltip, onHoverEnd: shell.hideTooltip, onSelect: hit => { if (!layer?.ready) return; cancelPending(); if (hit.parentIndex !== undefined) void nav.switchTo(hit.region, hit.parentIndex); else choose(hit.region); } });
    void restoreRoute(routing?.current ?? { theme: 'crime', ids: [], query: '' });
  } catch { shell.showInitializationError(() => location.reload()); }
  return { restoreRoute, get map() { return map?.map; }, destroy() { if (!alive) return; alive = false; nav.destroy(); panel.destroy(); layer?.destroy(); map?.destroy(); shell.destroy(); } };
}
