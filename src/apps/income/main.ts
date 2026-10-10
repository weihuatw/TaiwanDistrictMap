import './style.css';
import type { HashRouter, Route } from '../../routing/hash-router';
import { BoundaryRepository } from '../../map-core/boundaries';
import { createMap } from '../../map-core/create-map';
import { RegionNavigator } from '../../map-core/navigation';
import { createRegionLayer } from '../../map-core/region-layer';
import { createMapShell } from '../../ui/map-shell';
import type { Region } from '../../map-core/types';
import type { FeatureCollection, Point } from 'geojson';
import { IncomeRepository } from './data';
import { createIncomePanel, type IncomePartyMode } from './panel';
import { createPartyMarkers } from './party-markers';
import { PoliticsRepository } from '../politics/data';
import { recordColor as politicalColor, recordMissing } from '../politics/theme';
import { FILL_OPACITY, formatWan, recordColor } from './theme';
import type { IncomeManifest } from './types';

export function startIncomeApp(root: HTMLElement, routing?: HashRouter) {
  const base = import.meta.env.BASE_URL;
  const boundaries = new BoundaryRepository(`${base}data/`);
  const income = new IncomeRepository(`${base}data/income/2024/`);
  const politics = new PoliticsRepository(`${base}data/politics/`);
  const getColor = (region: Region) => recordColor(income.get(region.properties.code));
  let manifest: IncomeManifest;
  let layer: ReturnType<typeof createRegionLayer> | undefined;
  let basemap: ReturnType<typeof createMap> | undefined;
  let partyMarkers: ReturnType<typeof createPartyMarkers> | undefined;
  let alive = true;
  let partyMode: IncomePartyMode | null = null;
  let partySequence = 0;
  const shell = createMapShell(root, {
    brandTitle: '所得地圖', pageTitle: '臺灣所得地圖', getColor, showSelectionCard: false,
    loadingText: '載入所得與行政區…', errorText: '所得或行政區資料載入失敗，請重試。',
    sourceIntro: '2024初步核定綜合所得統計由財政部財政資訊中心提供，行政區界來自國土測繪中心，底圖為TomTom向量地圖。',
    rowMeta: (region) => {
      const mean = income.get(region.properties.code)?.meanK;
      return mean == null ? '無資料' : `${formatWan(mean)} 萬`;
    },
    sortRegions: (regions) => [...regions].sort((a, b) => (income.get(b.properties.code)?.meanK ?? -Infinity) - (income.get(a.properties.code)?.meanK ?? -Infinity) || a.properties.code.localeCompare(b.properties.code)),
    formatTooltip: (hit) => panel.tooltip(hit),
    onChoose: (region) => { if (layer?.ready && navigator.current) void navigator.enter(region, layer.camera()); },
    onBack: () => navigator.back(), onHome: () => navigator.home(), onNavigate: (index) => navigator.goTo(index),
    onPanelChange: () => layer?.scheduleLabels(),
  });
  const panel = createIncomePanel(shell, income, mode => {
    partyMode = mode;
    const view = navigator.current;
    if (!view) return;
    routing?.commit({ theme: 'income', ids: view.path.map(r => r.properties.code), query: mode ? new URLSearchParams({ party: mode }).toString() : '' });
    if (mode) void renderPartyMarkers(view, mode);
    else { partySequence++; partyMarkers?.clear(); panel.setPartyStatus(''); }
  });
  const navigator = new RegionNavigator(
    async (file) => {
      const [geometry, , meta] = await Promise.all([boundaries.load(file), income.load(file), income.manifest()]);
      manifest = meta;
      return geometry;
    },
    (view, restore = false) => {
      routing?.commit({ theme: 'income', ids: view.path.map(r => r.properties.code), query: partyMode ? new URLSearchParams({ party: partyMode }).toString() : '' });
      shell.render(view); panel.render(view, manifest);
      layer?.render(view, navigator.context, restore);
      if (partyMode) void renderPartyMarkers(view, partyMode);
      else partyMarkers?.clear();
    },
    (loading) => { shell.setBusy(loading); layer?.setBusy(loading); if (!loading) layer?.cancelPreview(); },
    (error, retry) => shell.showError(error, retry),
    region => layer?.previewRegion(region),
  );
  function restoreRoute(route: Route) {
    const params = new URLSearchParams(route.query);
    const requestedMode = params.get('party');
    if (requestedMode === 'mayor' || requestedMode === 'president') partyMode = requestedMode;
    else if (!routing?.isHistoryNavigation || !navigator.current) partyMode = null;
    panel.setPartyMode(partyMode);
    return navigator.restorePath(route.ids);
  }

  async function renderPartyMarkers(view: import('../../map-core/types').View, mode: IncomePartyMode) {
    const ticket = ++partySequence;
    const file = view.level === 'county' ? 'counties.geojson'
      : view.level === 'town' ? `towns/${view.path[0].properties.code}.geojson`
      : `villages/${view.path.at(-1)?.properties.code ?? ''}.geojson`;
    panel.setPartyStatus('正在載入選舉結果…');
    partyMarkers?.clear();
    try {
      const [, meta] = await Promise.all([politics.load(mode, file), politics.manifest()]);
      if (!alive || ticket !== partySequence || partyMode !== mode || navigator.current !== view) return;
      const collection: FeatureCollection<Point, { code: string; color: string }> = {
        type: 'FeatureCollection',
        features: view.data.features.flatMap(region => {
          const record = politics.get(mode, region.properties.code);
          if (recordMissing(record)) return [];
          return [{
            type: 'Feature' as const, id: region.properties.code,
            geometry: { type: 'Point' as const, coordinates: region.properties.label },
            properties: { code: region.properties.code, color: politicalColor(record, meta.colors) },
          }];
        }),
      };
      partyMarkers?.render(collection);
      panel.setPartyStatus(`顯示 ${mode === 'mayor' ? '2022 縣市長' : '2024 總統'}選舉結果 · ${collection.features.length.toLocaleString()} 個區域有可標示結果`);
    } catch {
      if (!alive || ticket !== partySequence || partyMode !== mode) return;
      partyMarkers?.clear(); panel.setPartyStatus('選舉結果載入失敗，所得地圖仍可使用。');
    }
  }
  try {
    basemap = createMap({ container: shell.mapContainer, apiKey: import.meta.env.VITE_TOMTOM_API_KEY, style: 'monoLight', onStatus: shell.setBasemapStatus });
    layer = createRegionLayer(basemap.map, {
      getColor, isMissing: (region) => income.get(region.properties.code)?.meanK == null,
      fillOpacity: FILL_OPACITY, hoverOpacity: FILL_OPACITY, selectedOpacity: FILL_OPACITY,
      outlineColor: '#59796e', emphasisColor: '#174d3f',
      getPadding: shell.getPadding,
      getLabelObstacles: () => [...shell.getLabelObstacles(), ...panel.obstacles()],
      duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 720,
      onReady: shell.markMapReady, onHover: shell.showTooltip, onHoverEnd: shell.hideTooltip,
      onSelect: (hit) => {
        if (!layer?.ready || !navigator.current) return;
        if (hit.parentIndex !== undefined) void navigator.switchTo(hit.region, hit.parentIndex);
        else void navigator.enter(hit.region, layer.camera());
      },
    });
    partyMarkers = createPartyMarkers(basemap.map);
    if (routing) void restoreRoute(routing.current); else void navigator.start();
  } catch { shell.showInitializationError(() => location.reload()); }
  void Promise.all([boundaries.manifest(), income.manifest()])
    .then(([geometry, stats]) => { if (alive) { shell.renderManifest(geometry); panel.showSources(stats); } })
    .catch(() => { if (alive) shell.showManifestError(); });
  return { restoreRoute, destroy() {
    if (!alive) return;
    alive = false; partySequence++; navigator.destroy(); partyMarkers?.destroy(); layer?.destroy(); basemap?.destroy(); shell.destroy(); root.classList.remove('income-page');
  } };
}
