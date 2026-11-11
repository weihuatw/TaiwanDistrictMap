import './style.css';
import { BoundaryRepository } from '../../map-core/boundaries';
import { createMap } from '../../map-core/create-map';
import { RegionNavigator } from '../../map-core/navigation';
import { createRegionLayer } from '../../map-core/region-layer';
import { sortRegionsByValue } from '../../map-core/region-sort';
import type { Camera, Region, View } from '../../map-core/types';
import { type HashRouter, type Route } from '../../routing/hash-router';
import { createMapShell } from '../../ui/map-shell';
import { loadChildSafetyData, validStatistics, type ChildSafetyData } from './data';
import { createChildSafetyPanel, type Filter } from './panel';
import { color, format, readFilter, value } from './theme';

export function startChildSafetyApp(root: HTMLElement, routing?: HashRouter) {
  const lifetime = new AbortController();
  const boundaries = new BoundaryRepository(`${import.meta.env.BASE_URL}data/`);
  let statistics: Promise<ChildSafetyData> | undefined;
  let data: ChildSafetyData | undefined;
  let filter: Filter = { year: '', metric: 'reports' };
  let query = '';
  let preserveViewport = false;
  let overviewCamera: Camera | null = null;
  let map: ReturnType<typeof createMap> | undefined;
  let layer: ReturnType<typeof createRegionLayer> | undefined;

  const shown = (region: Region) => value(data?.years[filter.year]?.[region.properties.code], filter.metric);
  const getColor = (region: Region) => color(shown(region), filter.metric);
  const shell = createMapShell(root, {
    routing, brandTitle: '兒少保護與教保', pageTitle: '臺灣兒少保護與教保地圖',
    getCamera: () => layer?.ready && nav.current ? layer.camera() : undefined,
    getColor, showSelectionCard: false,
    loadingText: '載入兒少保護統計與縣市界線…',
    errorText: '兒少保護資料載入失敗，請重試。',
    sourceIntro: '兒少保護採衛福部縣市統計，人口採內政部戶籍資料，教保統計和幼兒園名錄由教育部提供。',
    rowMeta: region => format(shown(region), filter.metric),
    sortRegions: (regions, direction) => sortRegionsByValue(regions, shown, direction),
    formatTooltip: ({ region }) => `${region.properties.name} · ${format(shown(region), filter.metric)}`,
    onChoose: choose, onBack: back, onHome: home, onNavigate: back,
    onPanelChange: () => layer?.scheduleLabels(),
  });
  shell.root.classList.add('child-page');
  shell.mapContainer.setAttribute('aria-label', '臺灣兒少保護縣市互動地圖');

  function routeFor(view: View): Route {
    return {
      theme: 'child-safety',
      ids: view.selected ? [view.selected.properties.code] : [],
      query: new URLSearchParams({ year: filter.year, metric: filter.metric }).toString(),
    };
  }

  const panel = createChildSafetyPanel(shell, lifetime.signal, next => {
    const view = nav.current;
    if (!view || !data) return;
    filter = next;
    query = routeFor(view).query;
    shell.hideTooltip();
    present(view, true);
  });

  function present(view: View, preserveCamera = false) {
    if (!data || lifetime.signal.aborted) return;
    const route = routeFor(view);
    const camera = routing?.consumeRouteCamera(route);
    if (camera) view.camera = camera;
    routing?.commit(route);
    const search = root.querySelector<HTMLInputElement>('[data-ui=region-search]')!;
    const searchText = preserveCamera ? search.value : '';
    shell.render(view);
    if (searchText) {
      search.value = searchText;
      shell.refreshList();
    }
    panel.render(data, filter, view.selected?.properties.code, view.selected?.properties.name ?? '全臺');
    layer?.render(view, nav.context, !!camera || !!view.camera, undefined, undefined, preserveCamera && !camera);
  }

  const nav = new RegionNavigator(async file => {
    statistics ??= loadChildSafetyData<ChildSafetyData>('statistics.json', validStatistics, lifetime.signal)
      .catch(error => { statistics = undefined; throw error; });
    const [geometry, snapshot] = await Promise.all([boundaries.load(file), statistics]);
    if (!lifetime.signal.aborted) data = snapshot;
    return geometry;
  }, view => {
    if (!data) return;
    filter = readFilter(query, Object.keys(data.years).sort().reverse());
    view.camera = view.selected ? null : overviewCamera;
    present(view, preserveViewport);
  }, busy => {
    shell.setBusy(busy);
    panel.setBusy(busy || !data);
    layer?.setBusy(busy);
  }, (error, retry) => shell.showError(error, retry));

  function restoreRoute(route: Route) {
    query = route.query;
    const view = nav.current;
    preserveViewport = !!view && (view.selected?.properties.code ?? '') === (route.ids[0] ?? '');
    if (view && !view.selected && route.ids.length && layer?.ready) overviewCamera = layer.camera();
    return nav.restorePath(route.ids, 'county');
  }

  function choose(region: Region) {
    if (layer?.ready && nav.current) {
      void restoreRoute({ ...routeFor(nav.current), ids: [region.properties.code] });
    }
  }

  function back() {
    if (nav.current?.selected) void restoreRoute({ ...routeFor(nav.current), ids: [] });
  }

  function home() {
    if (!nav.current) return;
    overviewCamera = null;
    if (nav.current.selected) back();
    else layer?.focus(nav.current);
  }

  try {
    map = createMap({ container: shell.mapContainer, apiKey: import.meta.env.VITE_TOMTOM_API_KEY, style: 'monoLight', onStatus: shell.setBasemapStatus });
    layer = createRegionLayer(map.map, {
      getColor, isMissing: region => shown(region) === null, fillOpacity: .68, hoverOpacity: .68, selectedOpacity: .68,
      getPadding: shell.getPadding, getLabelObstacles: () => [...shell.getLabelObstacles(), ...panel.obstacles()],
      duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 720,
      onReady: shell.markMapReady, onHover: shell.showTooltip, onHoverEnd: shell.hideTooltip,
      onSelect: ({ region }) => choose(region),
    });
    void restoreRoute(routing?.current ?? { theme: 'child-safety', ids: [], query: '' });
  } catch {
    shell.showInitializationError(() => location.reload());
  }

  return {
    restoreRoute,
    get map() { return map?.map; },
    destroy() {
      if (lifetime.signal.aborted) return;
      lifetime.abort();
      nav.destroy();
      panel.destroy();
      layer?.destroy();
      map?.destroy();
      shell.root.classList.remove('child-page');
      shell.destroy();
    },
  };
}
