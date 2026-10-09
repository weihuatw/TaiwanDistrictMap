import type { Map, LngLatBoundsLike } from 'maplibre-gl';
import type { Camera, Padding, Region, View } from './types';

export const TAIWAN_BOUNDS: LngLatBoundsLike = [[118.05, 21.75], [122.12, 26.42]];

function detailBounds(region: Region) {
  const full=region.properties.bounds,focus=region.properties.focusBounds;
  const fullArea=(full[2]-full[0])*(full[3]-full[1]);
  const focusArea=(focus[2]-focus[0])*(focus[3]-focus[1]);
  const fullSpan=Math.max(full[2]-full[0],full[3]-full[1]);
  // Some village polygons include distant offshore islets. Keep their full official
  // geometry, but center detail views on the Taiwan-area bounds when those islets
  // would make the selected village unreadably small or send the camera far away.
  return fullSpan>0.5&&fullArea>Math.max(focusArea*25,0.02)?focus:full;
}

export function createCameraController(map: Map, getPadding: () => Padding, duration: number) {
  const zeroPadding = { top: 0, right: 0, bottom: 0, left: 0 };
  let preview: { original: Camera; frame: string | null } | null = null;
  const frameKey = (bounds: LngLatBoundsLike, maxZoom: number) => JSON.stringify([bounds, maxZoom, getPadding()]);
  const frame = (bounds: LngLatBoundsLike, maxZoom: number, animationDuration: number) => {
    const padding = getPadding();
    // Calculate against the visible viewport once, without retaining padding
    // that would shrink subsequent fits. Offset puts the bounds above the sheet.
    const target = map.cameraForBounds(bounds, { padding, absolutePadding: true, maxZoom });
    if (target) map.easeTo({ ...target, padding: zeroPadding,
      offset: [(padding.left - padding.right) / 2, (padding.top - padding.bottom) / 2], duration: animationDuration });
  };
  const capture = (): Camera => {
    const center = map.getCenter();
    return { center: [center.lng, center.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
  };
  const fit = (view: View, animationDuration = duration) => {
    const region = view.selected ?? view.path.at(-1);
    const bounds = region ? view.level === 'detail' ? detailBounds(region) : region.properties.focusBounds : null;
    const target: LngLatBoundsLike = bounds ? [[bounds[0], bounds[1]], [bounds[2], bounds[3]]] : TAIWAN_BOUNDS;
    const maxZoom = view.level === 'detail' || view.level === 'village' ? 16 : 14;
    const alreadyMoving = preview?.frame === frameKey(target, maxZoom);
    preview = null;
    if (alreadyMoving && animationDuration !== 0) return;
    frame(target, maxZoom, animationDuration);
  };
  const restore = (view: View, animationDuration = duration) => {
    preview = null;
    if (view.camera) map.easeTo({ ...view.camera, duration: animationDuration, padding: zeroPadding });
    else fit(view, animationDuration);
  };
  const previewRegion = (region: Region) => {
    const b = region.properties.focusBounds;
    const target: LngLatBoundsLike = [[b[0], b[1]], [b[2], b[3]]];
    const maxZoom = region.properties.level === 'town' ? 16 : 14;
    preview = { original: preview?.original ?? capture(), frame: frameKey(target, maxZoom) };
    frame(target, maxZoom, duration);
  };
  const previewPoint = (center: [number, number]) => {
    preview = { original: preview?.original ?? capture(), frame: null };
    const padding = getPadding();
    // The catchment's size is unknown until loading finishes. Pan immediately
    // at the current zoom, then make a single zoom to the complete bounds.
    map.easeTo({ center, zoom: map.getZoom(), duration, padding: zeroPadding,
      offset: [(padding.left - padding.right) / 2, (padding.top - padding.bottom) / 2] });
  };
  const cancelPreview = () => {
    if (!preview) return;
    const original = preview.original; preview = null;
    map.easeTo({ ...original, duration, padding: zeroPadding });
  };
  return { capture: () => preview?.original ?? capture(), fit, restore, previewRegion, previewPoint, cancelPreview, get isPreviewing() { return preview !== null; } };
}
