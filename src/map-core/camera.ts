import type { Map, LngLatBoundsLike } from 'maplibre-gl';
import type { Camera, Padding, Region, View } from './types';

export const TAIWAN_BOUNDS: LngLatBoundsLike = [[118.05, 21.75], [122.12, 26.42]];

export function createCameraController(map: Map, getPadding: () => Padding, duration: number) {
  let preview: { original: Camera; bounds: string | null } | null = null;
  const capture = (): Camera => {
    const center = map.getCenter();
    return { center: [center.lng, center.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
  };
  const fit = (view: View, animationDuration = duration) => {
    const region = view.selected ?? view.path.at(-1);
    const bounds = region ? view.level === 'detail' ? region.properties.bounds : region.properties.focusBounds : null;
    const target: LngLatBoundsLike = bounds ? [[bounds[0], bounds[1]], [bounds[2], bounds[3]]] : TAIWAN_BOUNDS;
    const alreadyMoving = preview?.bounds === JSON.stringify(bounds);
    preview = null;
    if (alreadyMoving && animationDuration !== 0) return;
    map.fitBounds(target, { padding: getPadding(), maxZoom: view.level === 'detail' ? 16 : 14, duration: animationDuration });
  };
  const restore = (view: View) => {
    preview = null;
    if (view.camera) map.easeTo({ ...view.camera, duration, padding: { top: 0, right: 0, bottom: 0, left: 0 } });
    else fit(view);
  };
  const previewRegion = (region: Region) => {
    preview = { original: preview?.original ?? capture(), bounds: JSON.stringify(region.properties.focusBounds) };
    const b = region.properties.focusBounds;
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: getPadding(), maxZoom: 14, duration });
  };
  const previewPoint = (center: [number, number]) => {
    preview = { original: preview?.original ?? capture(), bounds: null };
    map.easeTo({ center, zoom: Math.max(14, map.getZoom()), duration, padding: getPadding() });
  };
  const cancelPreview = () => {
    if (!preview) return;
    const original = preview.original; preview = null;
    map.easeTo({ ...original, duration, padding: { top: 0, right: 0, bottom: 0, left: 0 } });
  };
  return { capture: () => preview?.original ?? capture(), fit, restore, previewRegion, previewPoint, cancelPreview, get isPreviewing() { return preview !== null; } };
}
