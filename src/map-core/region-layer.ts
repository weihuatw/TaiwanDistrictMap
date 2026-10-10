import { Marker, type Map as MapLibreMap, type MapMouseEvent, type GeoJSONSource } from 'maplibre-gl';
import { createCameraController } from './camera.ts';
import { createSettledUpdate } from './settled-update.ts';
import type { ContextRegion, Padding, Rect, Region, RegionColor, RegionHit, RegionOutline, Regions, View } from './types';

export interface RegionLayerOptions {
  getPadding: () => Padding;
  duration: number;
  deferUntilMoveEnd?: boolean;
  fadeDuration?: number;
  getLabelObstacles?: () => Rect[];
  getColor?: RegionColor;
  fillOpacity?: number;
  hoverOpacity?: number;
  selectedOpacity?: number;
  contextOpacity?: number;
  contextHoverOpacity?: number;
  outlineColor?: string;
  emphasisColor?: string;
  isMissing?: (region: Region) => boolean;
  getLabelStyle?: (region: Region) => { backgroundColor: string; textColor: string } | null;
  onSelect: (hit: RegionHit) => void;
  onHover?: (hit: RegionHit, point: { x: number; y: number }) => void;
  onHoverEnd?: () => void;
  onReady?: () => void;
}

/** Polygon rendering and hit testing, with no knowledge of page DOM or data I/O. */
export function createRegionLayer(map: MapLibreMap, options: RegionLayerOptions) {
  const camera = createCameraController(map, options.getPadding, options.duration);
  const updates = createSettledUpdate(map);
  const reveals = createSettledUpdate(map);
  const fadeDuration = options.duration === 0 ? 0 : options.fadeDuration ?? 0;
  let revealing = false;
  let afterRender: (() => void) | undefined;
  let displayedView: View | null = null;
  let displayedContext: ContextRegion[] = [];
  // Style readiness is enough to add our overlays. Waiting for `load` also
  // waits for the basemap's visible tiles and glyphs, even though the local
  // administrative GeoJSON is already ready.
  let styleReady = Boolean(map.getStyle());
  let pendingRestore = false;
  let view: View | null = null;
  let contextRegions: ContextRegion[] = [];
  let emphasisRegions: RegionOutline = { type: 'FeatureCollection', features: [] };
  let hovered: { code: string; source: 'regions' | 'context' } | null = null;
  let busy = false;
  let renderFrame = 0;
  let labels: { marker: Marker; element: HTMLDivElement; region: Region; context: boolean }[] = [];

  const onStyleLoad = () => {
    if (styleReady) return;
    styleReady = true;
    if (view) present(view, pendingRestore);
    options.onReady?.();
  };
  const onResize = () => {
    scheduleLabels();
    if (view && styleReady && !camera.isPreviewing) camera.fit(view, 0);
  };
  const onClick = (event: MapMouseEvent) => {
    if (updates.pending || revealing) return;
    const hit = regionAt(event.point);
    if (hit) options.onSelect(hit);
  };
  const onMove = (event: MapMouseEvent) => {
    if (busy || updates.pending || revealing) return;
    const hit = regionAt(event.point);
    if (!hit) { clearHover(); return; }
    const code = hit.region.properties.code;
    if (hovered?.code !== code || hovered.source !== hit.source) {
      clearHover(); hovered = { code, source: hit.source };
      map.setFeatureState({ source: hit.source, id: code }, { hover: true });
    }
    map.getCanvas().style.cursor = 'pointer';
    options.onHover?.(hit, event.point);
  };
  const hideTooltip = () => options.onHoverEnd?.();
  map.on('style.load', onStyleLoad);
  map.on('move', scheduleLabels);
  map.on('moveend', scheduleLabels);
  map.on('sourcedata', checkReveal);
  map.on('resize', onResize);
  map.on('click', onClick);
  map.on('mousemove', onMove);
  map.on('movestart', hideTooltip);
  map.getCanvas().addEventListener('mouseleave', clearHover);
  if (styleReady) options.onReady?.();

  function regionAt(point: { x: number; y: number }): RegionHit | null {
    const layers = ['region-fill', 'context-fill'].filter((id) => map.getLayer(id));
    if (!layers.length || !displayedView) return null;
    // Rendered features are ordered from top to bottom, so child polygons win
    // over the coarser surrounding boundaries at their shared edges.
    for (const feature of map.queryRenderedFeatures([point.x, point.y], { layers })) {
      const code = feature.properties.code;
      if (feature.source === 'regions') {
        const region = displayedView.data.features.find((candidate) => candidate.properties.code === code);
        if (region) return { region, source: 'regions' };
      } else {
        const entry = displayedContext.find((candidate) => candidate.region.properties.code === code);
        if (entry) return { ...entry, source: 'context' };
      }
    }
    return null;
  }

  function clearHover() {
    if (hovered && map.getSource(hovered.source)) map.setFeatureState({ source: hovered.source, id: hovered.code }, { hover: false });
    hovered = null; map.getCanvas().style.cursor = ''; options.onHoverEnd?.();
  }
  function present(current: View, restore: boolean) {
    updates.cancel(); reveals.cancel();
    // The first view has no previous map to transition from. Do not delay its
    // geometry behind an initial camera animation; retain ongoing previews.
    const duration = !displayedView && !camera.isPreviewing ? 0 : undefined;
    if (restore) camera.restore(current, duration);
    else camera.fit(current, duration);
    const update = () => {
      displayedView = current; displayedContext = contextRegions;
      renderMap(current);
      afterRender?.(); afterRender = undefined;
    };
    if (options.deferUntilMoveEnd) updates.queue(update);
    else update();
  }

  function setOpacity(visible: boolean) {
    const transition = { duration: visible ? fadeDuration : 0, delay: 0 };
    for (const id of ['region-fill', 'context-fill', 'region-missing']) if (map.getLayer(id)) {
      map.setPaintProperty(id, 'fill-layer-opacity-transition', transition);
      map.setPaintProperty(id, 'fill-layer-opacity', visible ? 1 : 0);
    }
    for (const [id, opacity] of [['region-line', .62], ['context-line', .65], ['region-emphasis', 1], ['context-emphasis', 1]] as const) if (map.getLayer(id)) {
      map.setPaintProperty(id, 'line-opacity-transition', transition);
      map.setPaintProperty(id, 'line-opacity', visible ? opacity : 0);
    }
    for (const { element } of labels) {
      element.style.transition = visible ? `opacity ${fadeDuration}ms ease-out` : 'none';
      element.style.opacity = visible ? '1' : '0';
    }
  }
  function checkReveal() {
    if (!revealing || updates.pending) return;
    reveals.queue(() => {
      if (!revealing || !map.isSourceLoaded('regions') || !map.isSourceLoaded('context')) return;
      revealing = false; setOpacity(true); scheduleLabels();
    });
  }

  function renderMap(current: View) {
    clearHover();
    revealing = fadeDuration > 0;
    if (revealing) setOpacity(false);
    // Keep fills and ordinary outlines below the basemap labels. Some styles
    // interleave labels and geographic linework, so catchment emphasis needs a
    // later anchor: immediately below the first symbol layer after the last
    // non-symbol basemap layer. That keeps every basemap boundary beneath the
    // school outline while leaving the final label stack above it.
    const styleLayers = map.getStyle().layers;
    const beforeLabel = styleLayers.find((layer) => layer.type === 'symbol')?.id;
    const lastGeometryIndex = styleLayers.reduce((last, layer, index) =>
      layer.type !== 'symbol' && layer.type !== 'background' ? index : last, -1);
    const beforeEmphasis = styleLayers.slice(lastGeometryIndex + 1).find((layer) => layer.type === 'symbol')?.id;
    const surrounding: Regions = { type: 'FeatureCollection', features: contextRegions.map(({ region }) => region) };
    if (map.getSource('context')) {
      map.removeFeatureState({ source: 'context' });
      (map.getSource('context') as GeoJSONSource).setData(surrounding);
    } else {
      map.addSource('context', { type: 'geojson', data: surrounding, promoteId: 'code' });
      map.addLayer({ id: 'context-fill', type: 'fill', source: 'context', paint: {
        'fill-color': '#aeb8b4',
        'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], options.contextHoverOpacity ?? 0.38, options.contextOpacity ?? 0.24],
      } }, beforeLabel);
      map.addLayer({ id: 'context-line', type: 'line', source: 'context', paint: {
        'line-color': '#87938e', 'line-opacity': 0.65,
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.65, 10, 1.1, 15, 1.5],
      } }, beforeLabel);
      map.addLayer({ id: 'context-emphasis', type: 'line', source: 'context', paint: {
        'line-color': '#667770',
        'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2, 0],
      } }, beforeLabel);
    }
    const presented = { ...current.data, features: current.data.features.map((region) => ({ ...region, properties: { ...region.properties,
      displayColor: options.getColor?.(region) ?? region.properties.color, displayMissing: options.isMissing?.(region) ?? false } })) };
    if (map.getSource('regions')) {
      map.removeFeatureState({ source: 'regions' });
      (map.getSource('regions') as GeoJSONSource).setData(presented);
    } else {
      map.addSource('regions', { type: 'geojson', data: presented, promoteId: 'code' });
      map.addLayer({ id: 'region-fill', type: 'fill', source: 'regions', paint: {
        'fill-color': ['case', ['boolean', ['feature-state', 'dim'], false], '#aeb8b4', ['get', 'displayColor']],
        'fill-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], options.selectedOpacity ?? 0.52,
          ['boolean', ['feature-state', 'hover'], false], options.hoverOpacity ?? 0.49,
          ['boolean', ['feature-state', 'dim'], false], 0.24, options.fillOpacity ?? 0.32],
      } }, beforeLabel);
      if (options.isMissing) {
        const size = 12;
        const pixels = new Uint8Array(size * size * 4);
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
          if ((x + y) % size < 2) pixels.set([91, 111, 126, 190], (y * size + x) * 4);
        }
        map.addImage('region-missing-hatch', { width: size, height: size, data: pixels });
        map.addLayer({ id: 'region-missing', type: 'fill', source: 'regions', filter: ['==', ['get', 'displayMissing'], true],
          paint: { 'fill-pattern': 'region-missing-hatch', 'fill-opacity': 0.65 } }, beforeLabel);
      }
      map.addLayer({ id: 'region-line', type: 'line', source: 'regions', paint: {
        'line-color': ['case', ['boolean', ['feature-state', 'dim'], false], '#87938e', options.outlineColor ?? '#486958'], 'line-opacity': 0.62,
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.65, 10, 1.2, 15, 1.7],
      } }, beforeLabel);
      map.addLayer({ id: 'region-emphasis', type: 'line', source: 'regions', paint: {
        'line-color': options.emphasisColor ?? '#164c3e',
        'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 3, ['boolean', ['feature-state', 'hover'], false], 2, 0],
      } }, beforeLabel);
    }
    if (current.selected) for (const region of current.data.features) {
      map.setFeatureState({ source: 'regions', id: region.properties.code }, { selected: region.id === current.selected.id, dim: region.id !== current.selected.id });
    }
    if (map.getSource('emphasis')) {
      (map.getSource('emphasis') as GeoJSONSource).setData(emphasisRegions);
    } else {
      map.addSource('emphasis', { type: 'geojson', data: emphasisRegions, promoteId: 'code' });
      map.addLayer({ id: 'emphasis-casing', type: 'line', source: 'emphasis', paint: {
        'line-color': '#fff', 'line-opacity': 0.98,
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 5, 10, 6, 15, 7],
      } }, beforeEmphasis);
      map.addLayer({ id: 'emphasis-line', type: 'line', source: 'emphasis', paint: {
        'line-color': options.emphasisColor ?? '#174a7e', 'line-opacity': 1,
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 2.2, 10, 3, 15, 3.8],
      } }, beforeEmphasis);
    }
    labels.forEach(({ marker }) => marker.remove()); labels = [];
    const labelRegions = [
      ...current.data.features.map((region) => ({ region, context: current.level === 'detail' && region.id !== current.selected?.id })),
      ...[...contextRegions].sort((a, b) => b.parentIndex - a.parentIndex).map(({ region }) => ({ region, context: true })),
    ];
    for (const { region, context } of labelRegions) {
      const label = document.createElement('div');
      label.className = `map-label${context ? ' context' : ''}${region.properties.unassigned ? ' unassigned' : ''}`;
      label.dataset.code = region.properties.code;
      renderLabelContent(label, region, !context);
      label.setAttribute('aria-hidden', 'true');
      const marker = new Marker({ element: label, anchor: 'center' }).setLngLat(region.properties.label).addTo(map);
      labels.push({ marker, element: label, region, context });
    }
    if (revealing) { setOpacity(false); checkReveal(); }
    else if (options.fadeDuration) setOpacity(true);
    scheduleLabels();
  }

  function renderLabelContent(element: HTMLDivElement, region: Region, includeStyle = true) {
    element.replaceChildren(region.properties.name);
    const labelStyle = includeStyle ? options.getLabelStyle?.(region) : null;
    element.style.backgroundColor = labelStyle?.backgroundColor ?? '';
    element.style.color = labelStyle?.textColor ?? '';
    element.style.textShadow = labelStyle ? 'none' : '';
    element.style.borderRadius = labelStyle ? '3px' : '';
    // Expand the painted background without padding or changing marker bounds,
    // so switching party mode never moves the region name or alters collisions.
    element.style.boxShadow = labelStyle ? `0 0 0 2px ${labelStyle.backgroundColor}` : '';
  }

  function refreshLabels() {
    for (const { element, region, context } of labels) renderLabelContent(element, region, !context);
    scheduleLabels();
  }

  function scheduleLabels() {
    // MapLibre moves marker positions itself; avoid layout reads and collision
    // calculations on every animation frame, particularly on mobile.
    if (renderFrame || map.isMoving()) return;
    renderFrame = requestAnimationFrame(() => { renderFrame = 0; layoutLabels(); });
  }
  function layoutLabels() {
    if (!styleReady || !displayedView || map.isMoving()) return;
    const occupied = options.getLabelObstacles?.() ?? [];
    const ordered = [...labels].sort((a, b) => Number(b.region.id === displayedView!.selected?.id) - Number(a.region.id === displayedView!.selected?.id) || Number(a.context) - Number(b.context) || Number(a.region.properties.unassigned) - Number(b.region.properties.unassigned));
    const candidates = ordered.map(label => ({ ...label, width: label.element.offsetWidth + 12, point: map.project(label.region.properties.label) }));
    const containerWidth = map.getContainer().clientWidth;
    const containerHeight = map.getContainer().clientHeight;
    for (const { region, element, width, point: p } of candidates) {
      const height = 26;
      const r = { x: p.x - width / 2, y: p.y - height / 2, w: width, h: height };
      const collision = occupied.some((o) => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y);
      const outside = p.x < 15 || p.x > containerWidth - 25 || p.y < 15 || p.y > containerHeight - 45;
      const tooSmall = region.properties.unassigned && map.getZoom() < 12;
      element.style.visibility = outside || collision || tooSmall ? 'hidden' : 'visible';
      if (!outside && !collision && !tooSmall) occupied.push(r);
    }
  }

  return {
    get ready() { return styleReady; },
    camera: camera.capture,
    previewRegion: camera.previewRegion,
    previewPoint: camera.previewPoint,
    cancelPreview: camera.cancelPreview,
    prepareStyleChange() {
      if (!styleReady) return;
      styleReady = false;
      updates.cancel(); reveals.cancel(); revealing = false; afterRender = undefined;
      clearHover(); labels.forEach(({ marker }) => marker.remove()); labels = [];
      view = null; contextRegions = []; emphasisRegions = { type: 'FeatureCollection', features: [] };
    },
    render(current: View, surrounding: ContextRegion[], restore = false, onRendered?: () => void, emphasis: RegionOutline = { type: 'FeatureCollection', features: [] }) {
      view = current; contextRegions = surrounding; emphasisRegions = emphasis; pendingRestore = restore; afterRender = onRendered;
      if (styleReady) present(current, restore);
    },
    focus(current: View) { camera.fit(current); },
    setBusy(loading: boolean) {
      busy = loading;
      if (loading) clearHover();
    },
    scheduleLabels,
    refreshLabels,
    destroy() {
      updates.destroy(); reveals.destroy(); revealing = false; afterRender = undefined;
      map.off('style.load', onStyleLoad); map.off('move', scheduleLabels); map.off('resize', onResize);
      map.off('moveend', scheduleLabels); map.off('sourcedata', checkReveal);
      map.off('click', onClick); map.off('mousemove', onMove); map.off('movestart', hideTooltip);
      map.getCanvas().removeEventListener('mouseleave', clearHover);
      if (renderFrame) cancelAnimationFrame(renderFrame);
      clearHover(); labels.forEach(({ marker }) => marker.remove()); labels = [];
      for (const id of ['emphasis-line', 'emphasis-casing', 'region-emphasis', 'region-line', 'region-missing', 'region-fill', 'context-emphasis', 'context-line', 'context-fill']) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
      for (const id of ['emphasis', 'regions', 'context']) if (map.getSource(id)) map.removeSource(id);
      if (options.isMissing && map.hasImage('region-missing-hatch')) map.removeImage('region-missing-hatch');
      view = null; styleReady = false;
    },
  };
}
