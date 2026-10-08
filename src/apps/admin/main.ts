import { BoundaryRepository } from '../../map-core/boundaries';
import { createMap } from '../../map-core/create-map';
import { RegionNavigator } from '../../map-core/navigation';
import { createRegionLayer } from '../../map-core/region-layer';
import type { Region } from '../../map-core/types';
import { createMapShell } from '../../ui/map-shell';
import { PopulationRepository } from '../../data/population';

/** Compose the administrative explorer from shared map and UI modules. */
export function startAdminApp(root: HTMLElement) {
  const boundaries = new BoundaryRepository(`${import.meta.env.BASE_URL}data/`);
  const population = new PopulationRepository(`${import.meta.env.BASE_URL}data/population/`);
  const getColor = (region: Region) => region.properties.color;
  let layer: ReturnType<typeof createRegionLayer> | undefined;
  let basemap: ReturnType<typeof createMap> | undefined;
  let alive = true;
  let populationRequest = 0;
  const shell = createMapShell(root, {
    getColor,
    onChoose: (region) => {
      if (layer?.ready && navigator.current) void navigator.enter(region, layer.camera());
    },
    onBack: () => navigator.back(),
    onHome: () => navigator.home(),
    onNavigate: (index) => navigator.goTo(index),
    onPanelChange: () => layer?.scheduleLabels(),
    renderSelectionDetails: (region, container) => {
      const request = ++populationRequest;
      if (!region) return;
      if (region.properties.unassigned) {
        const note = document.createElement('p');
        note.textContent = '未編定範圍沒有村里戶籍統計';
        container.append(note);
        return;
      }
      const status = document.createElement('p');
      status.textContent = '載入戶籍人口…';
      container.append(status);
      const load = () => {
        void population.getVillage(region.properties.code).then((result) => {
          if (!alive || request !== populationRequest) return;
          const record = result.record;
          if (!record) {
            status.textContent = '此村里沒有可對應的戶籍人口資料';
            return;
          }
          const summary = document.createElement('div');
          summary.className = 'population-summary';
          const add = (label: string, value: number, unit: string) => {
            const item = document.createElement('span');
            item.append(`${label} `);
            const strong = document.createElement('strong');
            strong.textContent = `${value.toLocaleString()} ${unit}`;
            item.append(strong);
            summary.append(item);
          };
          summary.append(status);
          add('人口', record.population, '人');
          add('男', record.male, '人');
          add('女', record.female, '人');
          add('戶數', record.households, '戶');
          status.className = 'population-attribution';
          status.textContent = `${result.label} · 戶籍人口`;
          container.replaceChildren(summary);
          const source = document.createElement('a');
          source.className = 'population-source';
          source.href = 'https://data.gov.tw/dataset/77132';
          source.target = '_blank';
          source.rel = 'noopener noreferrer';
          source.textContent = '內政部戶政司資料 ↗';
          container.append(source);
        }).catch(() => {
          if (!alive || request !== populationRequest) return;
          status.textContent = '戶籍人口資料暫時無法載入。';
          const retry = document.createElement('button');
          retry.type = 'button';
          retry.className = 'population-retry';
          retry.textContent = '重試';
          retry.addEventListener('click', load);
          status.replaceChildren(document.createTextNode('戶籍人口資料暫時無法載入。 '), retry);
        });
      };
      load();
    },
  });
  const navigator = new RegionNavigator(
    (file) => boundaries.load(file),
    (view, restore = false) => {
      shell.render(view);
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
      alive = false; navigator.destroy(); layer?.destroy(); basemap?.destroy(); shell.destroy();
      populationRequest++;
    },
  };
}
