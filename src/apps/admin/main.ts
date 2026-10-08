import { BoundaryRepository } from '../../map-core/boundaries';
import { createMap } from '../../map-core/create-map';
import { RegionNavigator } from '../../map-core/navigation';
import { createRegionLayer } from '../../map-core/region-layer';
import type { Region } from '../../map-core/types';
import { createMapShell } from '../../ui/map-shell';
import { PopulationRepository } from '../../data/population';
import { createPopulationPanel } from './population-panel';

/** Compose the administrative explorer from shared map and UI modules. */
export function startAdminApp(root: HTMLElement) {
  const boundaries = new BoundaryRepository(`${import.meta.env.BASE_URL}data/`);
  const population = new PopulationRepository(`${import.meta.env.BASE_URL}data/population/`);
  const getColor = (region: Region) => region.properties.color;
  let layer: ReturnType<typeof createRegionLayer> | undefined;
  let basemap: ReturnType<typeof createMap> | undefined;
  let alive = true;
  const shell = createMapShell(root, {
    getColor,
    onChoose: (region) => {
      if (layer?.ready && navigator.current) void navigator.enter(region, layer.camera());
    },
    onBack: () => navigator.back(),
    onHome: () => navigator.home(),
    onNavigate: (index) => navigator.goTo(index),
    onPanelChange: () => layer?.scheduleLabels(),
    showSelectionCard: false,
  });
  const populationPanel = createPopulationPanel(shell.infoExtra, population, () => layer?.scheduleLabels());
  const navigator = new RegionNavigator(
    (file) => boundaries.load(file),
    (view, restore = false) => {
      shell.render(view);
      populationPanel.render(view);
      layer?.render(view, navigator.context, restore);
    },
    (loading) => { shell.setBusy(loading); layer?.setBusy(loading); if (!loading) layer?.cancelPreview(); },
    (error, retry) => shell.showError(error, retry),
    region => layer?.previewRegion(region),
  );
  try {
    basemap = createMap({ container: shell.mapContainer, apiKey: import.meta.env.VITE_TOMTOM_API_KEY, onStatus: shell.setBasemapStatus });
    layer = createRegionLayer(basemap.map, {
      getColor,
      getPadding: shell.getPadding,
      getLabelObstacles: shell.getLabelObstacles,
      duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 720,
      onReady: shell.markMapReady,
      onHover: shell.showTooltip,
      onHoverEnd: shell.hideTooltip,
      onSelect: (hit) => {
        if (!layer?.ready || !navigator.current) return;
        if (hit.parentIndex !== undefined) void navigator.switchTo(hit.region, hit.parentIndex);
        else void navigator.enter(hit.region, layer.camera());
      },
    });
    void navigator.start();
  } catch { shell.showInitializationError(() => location.reload()); }
  void boundaries.manifest()
    .then((manifest) => { if (alive) shell.renderManifest(manifest); })
    .catch(() => { if (alive) shell.showManifestError(); });

  return {
    destroy() {
      if (!alive) return;
      alive = false; populationPanel.destroy(); navigator.destroy(); layer?.destroy(); basemap?.destroy(); shell.destroy();
    },
  };
}
