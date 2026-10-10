import type { Map as MapLibreMap } from 'maplibre-gl';
import type { FeatureCollection, Point } from 'geojson';

interface PartyMarkerProperties { code: string; color: string }
type PartyMarkers = FeatureCollection<Point, PartyMarkerProperties>;
const SOURCE_ID = 'income-party-markers';
const LAYER_ID = 'income-party-markers';
const IMAGE_ID = 'income-party-rounded-square';

/** A single GeoJSON symbol layer keeps the optional election overlay lightweight. */
export function createPartyMarkers(map: MapLibreMap) {
  let data: PartyMarkers = { type: 'FeatureCollection', features: [] };
  let destroyed = false;

  function ensureLayer() {
    if (destroyed || !map.getStyle()) return false;
    if (!map.hasImage(IMAGE_ID)) {
      const size = 24;
      const pixels = new Uint8Array(size * size * 4);
      const radius = 5;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const dx = Math.max(radius - x, 0, x - (size - radius - 1));
        const dy = Math.max(radius - y, 0, y - (size - radius - 1));
        if (dx * dx + dy * dy <= radius * radius) pixels.set([255, 255, 255, 255], (y * size + x) * 4);
      }
      map.addImage(IMAGE_ID, { width: size, height: size, data: pixels }, { sdf: true });
    }
    if (!map.getSource(SOURCE_ID)) map.addSource(SOURCE_ID, { type: 'geojson', data, promoteId: 'code' });
    if (!map.getLayer(LAYER_ID)) {
      const before = map.getStyle().layers?.find(layer => layer.type === 'symbol')?.id;
      map.addLayer({
        id: LAYER_ID, type: 'symbol', source: SOURCE_ID,
        layout: {
          'icon-image': IMAGE_ID, 'icon-size': ['interpolate', ['linear'], ['zoom'], 5, .42, 10, .52, 15, .62],
          'icon-allow-overlap': true, 'icon-ignore-placement': true,
        },
        paint: { 'icon-color': ['get', 'color'], 'icon-halo-color': '#fff', 'icon-halo-width': 1.1, 'icon-opacity': .95 },
      }, before);
    }
    return true;
  }

  function render(next: PartyMarkers) {
    data = next;
    if (ensureLayer()) (map.getSource(SOURCE_ID) as import('maplibre-gl').GeoJSONSource).setData(data);
  }
  const onStyleLoad = () => { if (ensureLayer()) (map.getSource(SOURCE_ID) as import('maplibre-gl').GeoJSONSource).setData(data); };
  map.on('style.load', onStyleLoad);
  return {
    render,
    clear() { render({ type: 'FeatureCollection', features: [] }); },
    destroy() {
      destroyed = true; map.off('style.load', onStyleLoad);
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      if (map.hasImage(IMAGE_ID)) map.removeImage(IMAGE_ID);
    },
  };
}
