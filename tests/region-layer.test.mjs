import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Exercise renderer timing without WebGL; geometry and camera math have their
// own tests. Markers only need the lifecycle used by the renderer here.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'maplibre-gl') return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(`
    export class Marker {
      constructor(options) { this.element = options.element; }
      setLngLat() { return this; }
      addTo() { return this; }
      remove() {}
    }
  `) };
  return nextResolve(specifier, context);
} });
const { createRegionLayer } = await import('../src/map-core/region-layer.ts');
const county = code => ({ type: 'Feature', id: code, geometry: { type: 'Polygon', coordinates: [] },
  properties: { code, name: code, level: 'county', focusBounds: [121, 24, 122, 25], bounds: [121, 24, 122, 25], label: [121.5, 24.5], color: '#abc' } });
const view = code => ({ level: 'town', path: [county('parent')], data: { type: 'FeatureCollection', features: [county(code)] }, selected: null, camera: null });

function fixture(duration = 720, renderOptions = {}, styleAvailable = true) {
  let moving = false, nextFrame = 0, layouts = 0, hasStyle = styleAvailable;
  const frames = new Map(), events = new Map(), sources = new Map(), layers = new Map(), eases = [];
  const canvas = { style: {}, addEventListener() {}, removeEventListener() {} };
  const container = { clientWidth: 390, clientHeight: 844 };
  globalThis.requestAnimationFrame = fn => { frames.set(++nextFrame, fn); return nextFrame; };
  globalThis.cancelAnimationFrame = id => frames.delete(id);
  globalThis.document = { createdElements: [], createElement() {
    const element = { dataset: {}, style: {}, children: [], setAttribute() {},
      replaceChildren(...children) { this.children = children; }, append(...children) { this.children.push(...children); },
      get offsetWidth() { layouts++; return 50; } };
    this.createdElements.push(element); return element;
  } };
  const emit = name => { for (const fn of events.get(name) ?? []) fn(); };
  const map = {
    loaded: () => hasStyle, isMoving: () => moving,
    on(name, fn) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); },
    off(name, fn) { events.get(name)?.delete(fn); },
    getCenter: () => ({ lng: 120, lat: 23 }), getZoom: () => 7, getBearing: () => 0, getPitch: () => 0,
    cameraForBounds: () => ({ center: [121.5, 24.5], zoom: 11 }),
    easeTo(options) { eases.push(options); moving = options.duration > 0; },
    getCanvas: () => canvas, getContainer: () => container, getStyle: () => ({ layers: [] }),
    getSource: id => sources.get(id), isSourceLoaded: id => sources.get(id)?.loaded ?? false,
    addSource(id, options) { sources.set(id, { data: options.data, loaded: false, setData(data) { this.data = data; this.loaded = false; } }); },
    removeSource: id => sources.delete(id),
    getLayer: id => layers.get(id), addLayer: layer => layers.set(layer.id, layer), removeLayer: id => layers.delete(id),
    setPaintProperty(id, name, value) { layers.get(id).paint[name] = value; },
    setFeatureState() {}, removeFeatureState() {}, queryRenderedFeatures: () => [],
    getStyle: () => hasStyle ? { layers: [] } : undefined,
    project: () => ({ x: 150, y: 300 }),
  };
  const layer = createRegionLayer(map, { duration, deferUntilMoveEnd: true, fadeDuration: 180, ...renderOptions,
    getPadding: () => ({ top: 0, right: 0, bottom: 0, left: 0 }), onSelect() {} });
  return { layer, map, sources, layers, eases, emit, get layouts() { return layouts; },
    tick() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()); },
    stop() { moving = false; emit('moveend'); },
    start() { moving = true; emit('movestart'); },
    loadStyle() { hasStyle = true; emit('style.load'); },
    clearStyle() { sources.clear(); layers.clear(); hasStyle = false; },
    loadSources() { sources.forEach(source => { source.loaded = true; }); emit('sourcedata'); },
    get listenerCount() { return [...events.values()].reduce((sum, set) => sum + set.size, 0); },
  };
}

test('First view positions immediately; later navigation and returning retain camera animations', () => {
  const f = fixture();
  f.layer.render(view('initial'), [], true); f.tick();
  assert.equal(f.eases[0].duration, 0);
  assert.equal(f.sources.get('regions').data.features[0].id, 'initial');
  f.layer.render(view('next'), []); f.tick();
  assert.equal(f.eases.at(-1).duration, 720);
  assert.equal(f.sources.get('regions').data.features[0].id, 'initial');
  f.stop(); f.tick();
  const camera = { center: [120, 23], zoom: 7, bearing: 0, pitch: 0 };
  f.layer.render({ ...view('returned'), camera }, [], true);
  assert.equal(f.eases.at(-1).duration, 720);
  assert.deepEqual(f.eases.at(-1).center, camera.center);
  f.layer.destroy();
});

test('An initial saved camera restores immediately even when basemap style arrives late', () => {
  const f = fixture(720, {}, false);
  const camera = { center: [120, 23], zoom: 7, bearing: 0, pitch: 0 };
  f.layer.render({ ...view('initial'), camera }, [], true);
  assert.equal(f.eases.length, 0);
  f.loadStyle(); f.tick();
  assert.equal(f.eases[0].duration, 0);
  assert.deepEqual(f.eases[0].center, camera.center);
  assert.equal(f.sources.get('regions').data.features[0].id, 'initial');
  f.layer.destroy();
});

test('Administrative overlays start on style readiness without waiting for basemap tiles', () => {
  let readyCalls = 0;
  const f = fixture(0, { onReady: () => readyCalls++ }, false);
  f.layer.render(view('early'), []);
  assert.equal(f.layer.ready, false);
  assert.equal(readyCalls, 0);
  assert.equal(f.sources.size, 0);
  f.emit('load');
  assert.equal(f.sources.size, 0);
  f.loadStyle();
  f.tick();
  assert.equal(f.layer.ready, true);
  assert.equal(readyCalls, 1);
  assert.equal(f.sources.get('regions').data.features[0].properties.code, 'early');
  f.loadStyle();
  assert.equal(readyCalls, 1);
  f.layer.destroy();
});

test('Context fill opacity can be tuned per map theme', () => {
  const f = fixture(0, { contextOpacity: .4, contextHoverOpacity: .5 });
  f.layer.render(view('selected'), [{ region: county('neighbor'), parentIndex: 0 }]); f.tick();
  assert.deepEqual(f.layers.get('context-fill').paint['fill-opacity'], ['case', ['boolean', ['feature-state', 'hover'], false], .5, .4]);
  f.layer.destroy();
});

test('Party colors update the existing label background without moving or replacing its text', () => {
  let labelStyle = null;
  const f = fixture(0, { getLabelStyle: () => labelStyle });
  f.layer.render(view('region'), [], true); f.tick();
  const label = document.createdElements.find(element => element.className === 'map-label');
  assert.deepEqual(label.children, ['region']);
  labelStyle = { backgroundColor: '#407c55', textColor: '#ffffff' };
  f.layer.refreshLabels();
  assert.deepEqual(label.children, ['region']);
  assert.equal(label.style.backgroundColor, '#407c55');
  assert.equal(label.style.color, '#ffffff');
  assert.equal(label.style.textShadow, 'none');
  assert.equal(label.style.borderRadius, '3px');
  assert.equal(label.style.boxShadow, '0 0 0 2px #407c55');
  assert.equal(label.style.padding, undefined);
  labelStyle = null;
  f.layer.refreshLabels();
  assert.deepEqual(label.children, ['region']);
  assert.equal(label.style.backgroundColor, '');
  assert.equal(label.style.color, '');
  assert.equal(label.style.boxShadow, '');
  assert.equal(f.sources.get('regions').data.features[0].properties.code, 'region');
  f.layer.destroy();
});

test('School catchment emphasis uses an independent outline source above comparison fills', () => {
  const f = fixture(0);
  const highlighted = county('catchment');
  f.layer.render(view('comparison'), [], false, undefined, { type: 'FeatureCollection', features: [highlighted] });
  f.tick();
  assert.deepEqual(f.sources.get('emphasis').data.features, [highlighted]);
  assert.equal(f.layers.get('emphasis-line').source, 'emphasis');
  assert.deepEqual(f.layers.get('emphasis-casing').paint['line-color'], '#fff');
  assert.deepEqual(f.layers.get('emphasis-line').paint['line-color'], '#174a7e');
  assert.ok(f.layers.get('emphasis-casing').paint['line-width'][4] > f.layers.get('emphasis-line').paint['line-width'][4]);
  f.layer.render(view('comparison-next'), [], false, undefined, { type: 'FeatureCollection', features: [] });
  f.tick();
  assert.deepEqual(f.sources.get('emphasis').data.features, []);
  f.layer.destroy();
  assert.equal(f.sources.has('emphasis'), false);
  assert.equal(f.layers.has('emphasis-casing'), false);
});

test('A basemap style change recreates current fills and school outlines after the new style loads', () => {
  const f = fixture(0), highlighted = county('catchment'); let renders = 0;
  f.layer.render(view('before'), [], false, () => renders++, { type: 'FeatureCollection', features: [highlighted] }); f.tick();
  f.layer.prepareStyleChange(); f.clearStyle();
  f.layer.render(view('after'), [], true, () => renders++, { type: 'FeatureCollection', features: [highlighted] });
  assert.equal(f.sources.size, 0);
  f.loadStyle(); f.tick();
  assert.equal(f.sources.get('regions').data.features[0].properties.code, 'after');
  assert.deepEqual(f.sources.get('emphasis').data.features, [highlighted]);
  assert.ok(f.layers.has('emphasis-casing'));
  assert.equal(renders, 2);
  f.layer.destroy();
});

test('Fast and cached data wait for the preview to stop; final fit keeps its animation', () => {
  const f = fixture(); let markers = 0;
  f.layer.previewRegion(county('parent'));
  f.layer.render(view('new'), [], false, () => markers++);
  f.layer.setBusy(false); f.layer.cancelPreview(); f.tick();
  assert.equal(f.sources.size, 0); assert.equal(markers, 0);
  f.stop(); f.tick();
  assert.equal(f.sources.get('regions').data.features[0].id, 'new'); assert.equal(markers, 1);
  assert.equal(f.layers.get('region-fill').paint['fill-layer-opacity'], 0);
  f.loadSources(); f.tick();
  assert.equal(f.layers.get('region-fill').paint['fill-layer-opacity'], 1);
  assert.equal(f.layers.get('region-fill').paint['fill-layer-opacity-transition'].duration, 180);
  f.layer.destroy();
});

test('Slow downloads after movement still render without another moveend', () => {
  const f = fixture();
  f.layer.previewRegion(county('parent')); f.stop();
  f.layer.render(view('late'), []); f.tick();
  assert.equal(f.sources.get('regions').data.features[0].id, 'late');
  f.layer.destroy();
});

test('Returning before a queued update applies renders only the newest view', () => {
  const f = fixture(); const rendered = [];
  f.layer.render(view('obsolete'), [], false, () => rendered.push('obsolete'));
  f.layer.render(view('returned'), [], true, () => rendered.push('returned'));
  f.stop(); f.tick();
  assert.deepEqual(rendered, ['returned']);
  assert.equal(f.sources.get('regions').data.features[0].id, 'returned');
  f.layer.destroy();
});

test('A gesture restarting between moveend and the frame postpones updates and reveal', () => {
  const f = fixture(); f.layer.render(view('new'), []);
  f.stop(); f.start(); f.tick(); assert.equal(f.sources.size, 0);
  f.stop(); f.tick(); f.loadSources(); f.start(); f.tick();
  assert.equal(f.layers.get('region-fill').paint['fill-layer-opacity'], 0);
  f.stop(); f.tick(); assert.equal(f.layers.get('region-fill').paint['fill-layer-opacity'], 1);
  f.layer.destroy();
});

test('Reduced motion skips camera and opacity animations', () => {
  const f = fixture(0); f.layer.render(view('new'), []); f.tick();
  assert.equal(f.sources.get('regions').data.features[0].id, 'new');
  assert.equal(f.layers.get('region-fill').paint['fill-layer-opacity'], 1);
  assert.equal(f.layers.get('region-fill').paint['fill-layer-opacity-transition'].duration, 0);
  f.layer.destroy();
});

test('Label layout is suspended during movement and resumes after stopping', () => {
  const f = fixture(0); f.layer.render(view('new'), []); f.tick(); f.tick();
  const before = f.layouts;
  f.start(); for (let i = 0; i < 10; i++) { f.emit('move'); f.tick(); }
  assert.equal(f.layouts, before);
  f.stop(); f.tick(); assert.ok(f.layouts > before);
  f.layer.destroy();
});

test('Destroy cancels pending geometry, marker callbacks and all listeners', () => {
  const f = fixture(); let rendered = false;
  f.layer.render(view('new'), [], false, () => { rendered = true; });
  f.layer.destroy(); f.stop(); f.tick();
  assert.equal(f.sources.size, 0); assert.equal(rendered, false); assert.equal(f.listenerCount, 0);
});
