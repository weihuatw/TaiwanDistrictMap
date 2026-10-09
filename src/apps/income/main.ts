import './style.css';
import type { HashRouter, Route } from '../../routing/hash-router';
import { BoundaryRepository } from '../../map-core/boundaries';
import { createMap } from '../../map-core/create-map';
import { RegionNavigator } from '../../map-core/navigation';
import { createRegionLayer } from '../../map-core/region-layer';
import { createMapShell } from '../../ui/map-shell';
import type { Region } from '../../map-core/types';
import { IncomeRepository } from './data';
import { createIncomePanel } from './panel';
import { FILL_OPACITY, formatWan, recordColor } from './theme';
import type { IncomeManifest } from './types';

export function startIncomeApp(root: HTMLElement, routing?: HashRouter) {
  const base = import.meta.env.BASE_URL;
  const boundaries = new BoundaryRepository(`${base}data/`);
  const income = new IncomeRepository(`${base}data/income/2024/`);
  const getColor = (region: Region) => recordColor(income.get(region.properties.code));
  let manifest: IncomeManifest;
  let layer: ReturnType<typeof createRegionLayer> | undefined;
  let basemap: ReturnType<typeof createMap> | undefined;
  let alive = true;
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
  const panel = createIncomePanel(shell, income);
  const navigator = new RegionNavigator(
    async (file) => {
      const [geometry, , meta] = await Promise.all([boundaries.load(file), income.load(file), income.manifest()]);
      manifest = meta;
      return geometry;
    },
    (view, restore = false) => {
      routing?.commit({ theme: 'income', ids: view.path.map(r => r.properties.code), query: '' });
      shell.render(view); panel.render(view, manifest);
      layer?.render(view, navigator.context, restore);
    },
    (loading) => { shell.setBusy(loading); layer?.setBusy(loading); if (!loading) layer?.cancelPreview(); },
    (error, retry) => shell.showError(error, retry),
    region => layer?.previewRegion(region),
  );
  function restoreRoute(route: Route) { return navigator.restorePath(route.ids); }
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
    if (routing) void restoreRoute(routing.current); else void navigator.start();
  } catch { shell.showInitializationError(() => location.reload()); }
  void Promise.all([boundaries.manifest(), income.manifest()])
    .then(([geometry, stats]) => { if (alive) { shell.renderManifest(geometry); panel.showSources(stats); } })
    .catch(() => { if (alive) shell.showManifestError(); });
  return { restoreRoute, destroy() {
    if (!alive) return;
    alive = false; navigator.destroy(); layer?.destroy(); basemap?.destroy(); shell.destroy(); root.classList.remove('income-page');
  } };
}
