import { Marker, type Map as MapLibreMap, type MapMouseEvent, type GeoJSONSource } from 'maplibre-gl';
import { createCameraController } from './camera';
import type { ContextRegion, Padding, Rect, Region, RegionColor, RegionHit, Regions, View } from './types';

export interface RegionLayerOptions {
  getPadding: () => Padding;
  duration: number;
  getLabelObstacles?: () => Rect[];
  getColor?: RegionColor;
  fillOpacity?: number;
  hoverOpacity?: number;
  selectedOpacity?: number;
  outlineColor?: string;
  emphasisColor?: string;
  isMissing?: (region: Region) => boolean;
  onSelect: (hit: RegionHit) => void;
  onHover?: (hit: RegionHit, point: { x: number; y: number }) => void;
  onHoverEnd?: () => void;
  onReady?: () => void;
}

/** Polygon rendering and hit testing, with no knowledge of page DOM or data I/O. */
export function createRegionLayer(map: MapLibreMap, options: RegionLayerOptions) {
  const camera = createCameraController(map, options.getPadding, options.duration);
  let mapReady = map.loaded();
  let pendingRestore = false;
  let view: View | null = null;
  let contextRegions: ContextRegion[] = [];
  let hovered: { code: string; source: 'regions' | 'context' } | null = null;
  let busy = false;
  let renderFrame = 0;
  let labels: { marker: Marker; element: HTMLDivElement; region: Region; context: boolean }[] = [];

  const onLoad = () => {
    mapReady = true;
    if (view) renderMap(view, pendingRestore);
    options.onReady?.();
  };
  const onResize = () => {
    scheduleLabels();
    if (view && mapReady) camera.fit(view, 0);
  };
  const onClick = (event: MapMouseEvent) => {
    const hit = regionAt(event.point);
    if (hit) options.onSelect(hit);
  };
  const onMove = (event: MapMouseEvent) => {
    if (busy) return;
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
  map.on('load', onLoad);
  map.on('move', scheduleLabels);
  map.on('resize', onResize);
  map.on('click', onClick);
  map.on('mousemove', onMove);
  map.on('movestart', hideTooltip);
  map.getCanvas().addEventListener('mouseleave', clearHover);
  if (mapReady) options.onReady?.();

  function regionAt(point: { x: number; y: number }): RegionHit | null {
    const layers = ['region-fill', 'context-fill'].filter((id) => map.getLayer(id));
    if (!layers.length || !view) return null;
    // Rendered features are ordered from top to bottom, so child polygons win
    // over the coarser surrounding boundaries at their shared edges.
    for (const feature of map.queryRenderedFeatures([point.x, point.y], { layers })) {
      const code = feature.properties.code;
      if (feature.source === 'regions') {
        const region = view.data.features.find((candidate) => candidate.properties.code === code);
        if (region) return { region, source: 'regions' };
      } else {
        const entry = contextRegions.find((candidate) => candidate.region.properties.code === code);
        if (entry) return { ...entry, source: 'context' };
      }
    }
    return null;
  }

  function clearHover() {
    if (hovered && map.getSource(hovered.source)) map.setFeatureState({ source: hovered.source, id: hovered.code }, { hover: false });
    hovered = null; map.getCanvas().style.cursor = ''; options.onHoverEnd?.();
  }
  function renderMap(current: View, restore: boolean) {
    clearHover();
    // Keep vector basemap labels above the administrative fill and outlines.
    const beforeLabel = map.getStyle().layers.find((layer) => layer.type === 'symbol')?.id;
    const surrounding: Regions = { type: 'FeatureCollection', features: contextRegions.map(({ region }) => region) };
    if (map.getSource('context')) {
      map.removeFeatureState({ source: 'context' });
      (map.getSource('context') as GeoJSONSource).setData(surrounding);
    } else {
      map.addSource('context', { type: 'geojson', data: surrounding, promoteId: 'code' });
      map.addLayer({ id: 'context-fill', type: 'fill', source: 'context', paint: {
        'fill-color': '#aeb8b4',
        'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.38, 0.24],
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
    labels.forEach(({ marker }) => marker.remove()); labels = [];
    const labelRegions = [
      ...current.data.features.map((region) => ({ region, context: current.level === 'detail' && region.id !== current.selected?.id })),
      ...[...contextRegions].sort((a, b) => b.parentIndex - a.parentIndex).map(({ region }) => ({ region, context: true })),
    ];
    for (const { region, context } of labelRegions) {
      const label = document.createElement('div');
      label.className = `map-label${context ? ' context' : ''}${region.properties.unassigned ? ' unassigned' : ''}`;
      label.dataset.code = region.properties.code;
      label.textContent = region.properties.name;
      label.setAttribute('aria-hidden', 'true');
      const marker = new Marker({ element: label, anchor: 'center' }).setLngLat(region.properties.label).addTo(map);
      labels.push({ marker, element: label, region, context });
    }
    if (restore) camera.restore(current);
    else camera.fit(current);
    scheduleLabels();
  }

  function scheduleLabels() {
    if (renderFrame) return;
    renderFrame = requestAnimationFrame(() => { renderFrame = 0; layoutLabels(); });
  }
  function layoutLabels() {
    if (!mapReady || !view) return;
    const occupied = options.getLabelObstacles?.() ?? [];
    const ordered = [...labels].sort((a, b) => Number(b.region.id === view!.selected?.id) - Number(a.region.id === view!.selected?.id) || Number(a.context) - Number(b.context) || Number(a.region.properties.unassigned) - Number(b.region.properties.unassigned));
    for (const { region, element } of ordered) {
      const p = map.project(region.properties.label);
      const width = element.offsetWidth + 12; const height = 26;
      const r = { x: p.x - width / 2, y: p.y - height / 2, w: width, h: height };
      const collision = occupied.some((o) => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y);
      const outside = p.x < 15 || p.x > map.getContainer().clientWidth - 25 || p.y < 15 || p.y > map.getContainer().clientHeight - 45;
      const tooSmall = region.properties.unassigned && map.getZoom() < 12;
      element.style.visibility = outside || collision || tooSmall ? 'hidden' : 'visible';
      if (!outside && !collision && !tooSmall) occupied.push(r);
    }
  }

  return {
    get ready() { return mapReady; },
    camera: camera.capture,
    render(current: View, surrounding: ContextRegion[], restore = false) {
      view = current; contextRegions = surrounding; pendingRestore = restore;
      if (mapReady) renderMap(current, restore);
    },
    setBusy(loading: boolean) { busy = loading; if (loading) clearHover(); },
    scheduleLabels,
    destroy() {
      map.off('load', onLoad); map.off('move', scheduleLabels); map.off('resize', onResize);
      map.off('click', onClick); map.off('mousemove', onMove); map.off('movestart', hideTooltip);
      map.getCanvas().removeEventListener('mouseleave', clearHover);
      if (renderFrame) cancelAnimationFrame(renderFrame);
      clearHover(); labels.forEach(({ marker }) => marker.remove()); labels = [];
      for (const id of ['region-emphasis', 'region-line', 'region-missing', 'region-fill', 'context-emphasis', 'context-line', 'context-fill']) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
      for (const id of ['regions', 'context']) if (map.getSource(id)) map.removeSource(id);
      if (options.isMissing && map.hasImage('region-missing-hatch')) map.removeImage('region-missing-hatch');
      view = null; mapReady = false;
    },
  };
}
