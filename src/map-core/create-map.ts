import { TomTomConfig } from '@tomtom-org/maps-sdk/core';
import { BASE_MAP_SOURCE_ID, TomTomMap } from '@tomtom-org/maps-sdk/map';
import { Map, NavigationControl, ScaleControl, setWorkerUrl, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

export type BasemapStatus = 'preview' | 'unavailable' | 'ready';
interface MapOptions {
  container: HTMLElement;
  apiKey?: string;
  style?: 'standardLight' | 'monoLight';
  onStatus?: (status: BasemapStatus) => void;
}

/** The basemap adapter owns SDK setup and emits status without touching UI. */
export function createMap({ container, apiKey, onStatus, style = 'standardLight' }: MapOptions) {
  setWorkerUrl(workerUrl);
  const key = apiKey?.trim();
  const common = { container, center: [120.8, 23.75] as [number, number], zoom: 6, minZoom: 3, maxZoom: 19, renderWorldCopies: false, attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false };
  const emptyStyle: StyleSpecification = {
    version: 8, sources: {},
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e8eeeb' } }],
  };
  if (key) TomTomConfig.instance.put({ apiKey: key, language: 'zh-Hant' });
  const sdk = key ? new TomTomMap({
    language: 'zh-Hant',
    style: { type: 'standard', id: style, include: [] },
    mapLibre: common,
  }) : undefined;
  const map = sdk?.mapLibreMap ?? new Map({ ...common, style: emptyStyle });
  if (!key) {
    onStatus?.('preview');
    map.on('load', () => addPreviewGrid(map));
  }
  map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left');
  let basemapFailed = false;
  map.on('error', (event) => {
    const message = event.error?.message ?? '';
    if (key && (('sourceId' in event && event.sourceId === BASE_MAP_SOURCE_ID) || /401|403|tile|glyph|sprite|style/i.test(message))) {
      basemapFailed = true;
      onStatus?.('unavailable');
    }
  });
  map.on('sourcedata', (event) => {
    if (event.sourceId === BASE_MAP_SOURCE_ID) {
      container.dataset.basemapType = map.getSource(BASE_MAP_SOURCE_ID)?.type ?? '';
      container.dataset.basemapLoaded = String(event.isSourceLoaded);
    }
    if (key && !basemapFailed && event.sourceId === BASE_MAP_SOURCE_ID && event.isSourceLoaded) onStatus?.('ready');
  });
  return { map, destroy: () => map.remove() };
}

function addPreviewGrid(map: Map) {
  const features = [];
  for (let lon = 112; lon <= 128; lon++) features.push({ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: [[lon, 8], [lon, 29]] } });
  for (let lat = 8; lat <= 29; lat++) features.push({ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: [[112, lat], [128, lat]] } });
  map.addSource('preview-grid', { type: 'geojson', data: { type: 'FeatureCollection', features } });
  map.addLayer({ id: 'preview-grid', type: 'line', source: 'preview-grid', paint: { 'line-color': '#c4d1ca', 'line-width': 0.6, 'line-opacity': 0.4 } });
}
