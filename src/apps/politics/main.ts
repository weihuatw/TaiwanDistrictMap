import { BoundaryRepository } from '../../map-core/boundaries';
import { createMap } from '../../map-core/create-map';
import { RegionNavigator } from '../../map-core/navigation';
import { createRegionLayer } from '../../map-core/region-layer';
import { createMapShell } from '../../ui/map-shell';
import { PopulationRepository } from '../../data/population';
import { createPopulationPanel } from '../admin/population-panel';
import type { Region, View } from '../../map-core/types';
import { PoliticsRepository } from './data';
import { createPoliticsPanel } from './panel';
import { modeForLevel, recordLabel, recordMissing } from './theme';
import type { PoliticalManifest, PoliticalMode } from './types';

export function startPoliticsApp(root: HTMLElement) {
  const base = import.meta.env.BASE_URL;
  const boundaries = new BoundaryRepository(`${base}data/`);
  const politics = new PoliticsRepository(`${base}data/politics/`);
  const population = new PopulationRepository(`${base}data/population/`);
  const modes = new Map<View['level'], PoliticalMode>();
  let mode: PoliticalMode = 'officials';
  // An explicit selection takes priority on every level that supports it.
  let preferredMode: PoliticalMode | null = null;
  let manifest: PoliticalManifest;
  let layer: ReturnType<typeof createRegionLayer> | undefined;
  let basemap: ReturnType<typeof createMap> | undefined;
  let alive = true;
  const getColor = (region: Region) => panel.getColor(politics.get(mode, region.properties.code));
  const shell = createMapShell(root, {
    brandTitle: '政治地圖', pageTitle: '臺灣政治地圖', getColor, showSelectionCard: false,
    loadingText: '載入政治與行政區資料…', errorText: '政治或行政區資料載入失敗，請重試。',
    sourceIntro: '縣市首長與村里長使用內政部本屆名錄及逐筆補充；歷史得票使用中選會正式統計。兩者的政黨欄位與日期獨立呈現。',
    rowMeta: region => recordLabel(politics.get(mode, region.properties.code)),
    formatTooltip: hit => panel.tooltip(hit),
    onChoose: region => { if (layer?.ready && navigator.current) void navigator.enter(region, layer.camera()); },
    onBack: () => navigator.back(), onHome: () => navigator.home(), onNavigate: index => navigator.goTo(index),
    onPanelChange: () => layer?.scheduleLabels(),
  });
  shell.mapContainer.setAttribute('aria-label', '臺灣政治互動地圖');
  const panel = createPoliticsPanel(shell, politics, selected => {
    const view = navigator.current;
    if (!view || !alive) return;
    mode = selected; preferredMode = selected; modes.set(view.level === 'detail' ? 'village' : view.level, mode);
    shell.hideTooltip(); panel.render(view, mode, manifest); shell.refreshList();
    // Data for all modes was committed with this view; switching preserves the camera.
    layer?.render({ ...view, camera: layer.camera() }, navigator.context, true);
  });
  const populationPanel = createPopulationPanel(panel.populationContainer, population, () => layer?.scheduleLabels());
  const onResize = () => layer?.scheduleLabels();
  root.addEventListener('politicsresize', onResize);
  const navigator = new RegionNavigator(
    async file => {
      // Prefetch three small administrative shards so mode changes are immediate,
      // and share the navigator's existing latest-request and retry semantics.
      const [geometry, meta] = await Promise.all([boundaries.load(file), politics.manifest(), ...(['officials', 'mayor', 'president'] as const).map(m => politics.load(m, file))]);
      manifest = meta; return geometry;
    },
    (view, restore = false) => {
      const level = view.level === 'detail' ? 'village' : view.level;
      mode = modeForLevel(level, preferredMode, modes.get(level));
      modes.set(level, mode);
      shell.render(view); panel.render(view, mode, manifest); populationPanel.render(view);
      layer?.render(view, navigator.context, restore);
    },
    loading => { shell.setBusy(loading); panel.setBusy(loading); layer?.setBusy(loading); if (!loading) layer?.cancelPreview(); },
    (error, retry) => shell.showError(error, retry), region => layer?.previewRegion(region),
  );
  try {
    basemap = createMap({ container: shell.mapContainer, apiKey: import.meta.env.VITE_TOMTOM_API_KEY, style: 'monoLight', onStatus: shell.setBasemapStatus });
    layer = createRegionLayer(basemap.map, {
      getColor, isMissing: region => recordMissing(politics.get(mode, region.properties.code)),
      fillOpacity: .5, hoverOpacity: .5, selectedOpacity: .5,
      outlineColor: '#707687', emphasisColor: '#383b56', getPadding: shell.getPadding,
      getLabelObstacles: shell.getLabelObstacles,
      duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 720,
      onReady: shell.markMapReady, onHover: shell.showTooltip, onHoverEnd: shell.hideTooltip,
      onSelect: hit => {
        if (!layer?.ready || !navigator.current) return;
        if (hit.parentIndex !== undefined) void navigator.switchTo(hit.region, hit.parentIndex);
        else void navigator.enter(hit.region, layer.camera());
      },
    });
    void navigator.start();
  } catch { shell.showInitializationError(() => location.reload()); }
  void Promise.all([boundaries.manifest(), politics.manifest()]).then(([geometry, stats]) => {
    if (alive) { shell.renderManifest(geometry); panel.showSources(stats); }
  }).catch(() => { if (alive) shell.showManifestError(); });
  return { destroy() {
    if (!alive) return;
    alive = false; navigator.destroy(); populationPanel.destroy(); panel.destroy(); layer?.destroy(); basemap?.destroy();
    root.removeEventListener('politicsresize', onResize); shell.destroy(); root.classList.remove('politics-page');
  } };
}
