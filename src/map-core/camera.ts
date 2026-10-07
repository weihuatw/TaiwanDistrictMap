import type { Map, LngLatBoundsLike } from 'maplibre-gl';
import type { Camera, Padding, View } from './types';

export const TAIWAN_BOUNDS: LngLatBoundsLike = [[118.05, 21.75], [122.12, 26.42]];

export function createCameraController(map: Map, getPadding: () => Padding, duration: number) {
  const capture = (): Camera => {
    const center = map.getCenter();
    return { center: [center.lng, center.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
  };
  const fit = (view: View, animationDuration = duration) => {
    const region = view.selected ?? view.path.at(-1);
    const bounds = region ? view.level === 'detail' ? region.properties.bounds : region.properties.focusBounds : null;
    const target: LngLatBoundsLike = bounds ? [[bounds[0], bounds[1]], [bounds[2], bounds[3]]] : TAIWAN_BOUNDS;
    map.fitBounds(target, { padding: getPadding(), maxZoom: view.level === 'detail' ? 16 : 14, duration: animationDuration });
  };
  const restore = (view: View) => {
    if (view.camera) map.easeTo({ ...view.camera, duration, padding: { top: 0, right: 0, bottom: 0, left: 0 } });
    else fit(view);
  };
  return { capture, fit, restore };
}
