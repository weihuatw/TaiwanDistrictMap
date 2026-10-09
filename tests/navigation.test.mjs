import test from 'node:test';
import assert from 'node:assert/strict';
import { RegionNavigator } from '../src/map-core/navigation.ts';
import { dataPath, geometryBounds, focusBounds, colorRegions } from '../src/geometry.mjs';

const feature = (code, name = code) => ({ id: code, properties: { code, name } });
const data = (...features) => ({ type: 'FeatureCollection', features });
const county = feature('63000'); const town = feature('63000010'); const village = feature('63000010001');
const camera = { center: [121.5, 25.0], zoom: 9, bearing: 0, pitch: 0 };
function fixture(load = async (file) => file === 'counties.geojson' ? data(county) : file.startsWith('towns/') ? data(town) : data(village)) {
  const events = []; const errors = []; const busy = [];
  const nav = new RegionNavigator(load, (state, restore) => events.push({ state, restore }), (value) => busy.push(value), (error, retry) => errors.push({ error, retry }));
  return { nav, events, errors, busy };
}

test('Drill down and restore the saved viewport at each previous level', async () => {
  const { nav, events } = fixture();
  await nav.start(); await nav.enter(county, camera); await nav.enter(town, { ...camera, zoom: 12 }); await nav.enter(village, { ...camera, zoom: 14 });
  assert.equal(nav.current.level, 'detail'); assert.equal(nav.stack.length, 4);
  nav.back(); assert.equal(nav.current.level, 'village'); assert.equal(nav.current.camera.zoom, 14);
  nav.back(); assert.equal(nav.current.level, 'town'); assert.equal(nav.current.camera.zoom, 12);
  nav.back(); assert.equal(nav.current.level, 'county'); assert.deepEqual(nav.current.camera, camera);
  assert.equal(events.at(-1).restore, true);
});

test('The latest click wins when requests complete out of order', async () => {
  const deferred = new Map();
  const { nav } = fixture((file) => file === 'counties.geojson' ? Promise.resolve(data(county)) : new Promise((resolve) => deferred.set(file, resolve)));
  await nav.start();
  const first = nav.enter(county, camera); const second = nav.enter(feature('65000'), camera);
  deferred.get('towns/65000.geojson')(data(feature('65000010'))); await second;
  deferred.get('towns/63000.geojson')(data(town)); await first;
  assert.equal(nav.current.path[0].id, '65000'); assert.equal(nav.stack.length, 2);
});

test('Home cancels an in-flight drill-down without corrupting the stack', async () => {
  let resolve;
  const { nav, busy } = fixture((file) => file === 'counties.geojson' ? Promise.resolve(data(county)) : new Promise((r) => { resolve = r; }));
  await nav.start(); const pending = nav.enter(county, camera); nav.home(); resolve(data(town)); await pending;
  assert.equal(nav.current.level, 'county'); assert.equal(nav.stack.length, 1); assert.equal(busy.at(-1), false);
});

test('Home during initial loading does not discard the initial data request', async () => {
  let resolve;
  const { nav } = fixture(() => new Promise((r) => { resolve = r; }));
  const initial = nav.start(); nav.home(); nav.back(); resolve(data(county)); await initial;
  assert.equal(nav.current.level, 'county'); assert.equal(nav.stack.length, 1);
});

test('Disposing a page cancels pending navigation and prevents updates to the removed UI', async () => {
  let resolve;
  const { nav, events } = fixture((file) => file === 'counties.geojson' ? Promise.resolve(data(county)) : new Promise((r) => { resolve = r; }));
  await nav.start(); const pending = nav.enter(county, camera);
  const previousEvents = events.length;
  nav.destroy(); resolve(data(town)); await pending;
  assert.equal(events.length, previousEvents); assert.equal(nav.current, undefined); assert.equal(nav.stack.length, 0);
});

test('The home shortcut resets the nationwide viewport instead of a saved zoom', async () => {
  const { nav, events } = fixture();
  await nav.start(); await nav.enter(county, camera); nav.home();
  assert.equal(nav.current.level, 'county'); assert.equal(nav.current.camera, null);
  assert.equal(events.at(-1).restore, true);
});

test('Failed loading preserves the current level and offers a working retry', async () => {
  let fail = true;
  const { nav, errors } = fixture(async (file) => {
    if (file === 'counties.geojson') return data(county);
    if (fail) throw new Error('Offline');
    return data(town);
  });
  await nav.start(); await nav.enter(county, camera);
  assert.equal(nav.current.level, 'county'); assert.equal(nav.stack.length, 1); assert.equal(errors.length, 1);
  fail = false; await errors[0].retry(); assert.equal(nav.current.level, 'town');
});

test('Selecting another village reuses the detail history entry', async () => {
  const { nav } = fixture();
  await nav.start(); await nav.enter(county, camera); await nav.enter(town, camera); await nav.enter(village, camera);
  await nav.enter(feature('63000010002'), { ...camera, zoom: 16 });
  assert.equal(nav.stack.length, 4); assert.equal(nav.current.selected.id, '63000010002');
  nav.back(); assert.equal(nav.current.level, 'village'); assert.deepEqual(nav.current.camera, camera);
});

function neighboringFixture(customLoad) {
  const otherCounty = feature('65000');
  const otherTown = feature('63000020');
  const otherCountyTown = feature('65000010');
  const load = async (file) => {
    if (file === 'counties.geojson') return data(county, otherCounty);
    if (file === 'towns/63000.geojson') return data(town, otherTown);
    if (file === 'towns/65000.geojson') return data(otherCountyTown);
    return data(feature(`${file.includes(otherTown.id) ? otherTown.id : town.id}001`));
  };
  return { ...fixture(customLoad ? (file) => customLoad(file, load) : load), otherCounty, otherTown, otherCountyTown };
}

test('Surrounding layers retain county and town peers and omit the selected branch', async () => {
  const { nav, otherCounty, otherTown } = neighboringFixture();
  await nav.start(); assert.deepEqual(nav.context, []);
  await nav.enter(county, camera);
  assert.deepEqual(nav.context.map(({ region, parentIndex }) => [region.id, parentIndex]), [[otherCounty.id, 0]]);
  await nav.enter(town, camera);
  assert.deepEqual(nav.context.map(({ region, parentIndex }) => [region.id, parentIndex]), [[otherCounty.id, 0], [otherTown.id, 1]]);
  await nav.enter(nav.current.data.features[0], camera);
  assert.deepEqual(nav.context.map(({ region }) => region.id), [otherCounty.id, otherTown.id]);
});

test('Switching counties replaces the selection and makes the former county a peer', async () => {
  const { nav, otherCounty, otherCountyTown } = neighboringFixture();
  await nav.start(); await nav.enter(county, camera);
  await nav.switchTo(otherCounty, 0);
  assert.equal(nav.stack.length, 2); assert.equal(nav.current.level, 'town');
  assert.deepEqual(nav.current.path.map((region) => region.id), [otherCounty.id]);
  assert.equal(nav.current.data.features[0].id, otherCountyTown.id);
  assert.deepEqual(nav.context.map(({ region }) => region.id), [county.id]);
  nav.back(); assert.deepEqual(nav.current.camera, camera); assert.equal(nav.current.level, 'county');
});

test('Switching towns replaces village data while preserving the county overview for back', async () => {
  const { nav, otherTown } = neighboringFixture();
  await nav.start(); await nav.enter(county, camera);
  const townCamera = { ...camera, zoom: 11 };
  await nav.enter(town, townCamera); await nav.enter(nav.current.data.features[0], { ...camera, zoom: 14 });
  await nav.switchTo(otherTown, 1);
  assert.equal(nav.stack.length, 3); assert.equal(nav.current.level, 'village');
  assert.deepEqual(nav.current.path.map((region) => region.id), [county.id, otherTown.id]);
  assert.equal(nav.current.data.features[0].id, `${otherTown.id}001`);
  assert.equal(nav.current.camera, null);
  assert.equal(nav.context.find(({ parentIndex }) => parentIndex === 1).region.id, town.id);
  nav.back(); assert.equal(nav.current.level, 'town'); assert.deepEqual(nav.current.camera, townCamera);
});

test('Switching a county from village detail discards the old district and village branch', async () => {
  const { nav, otherCounty } = neighboringFixture();
  await nav.start(); await nav.enter(county, camera); await nav.enter(town, camera);
  await nav.enter(nav.current.data.features[0], camera);
  await nav.switchTo(otherCounty, 0);
  assert.equal(nav.stack.length, 2); assert.equal(nav.current.level, 'town');
  assert.deepEqual(nav.current.path.map((region) => region.id), [otherCounty.id]);
  nav.back(); assert.equal(nav.current.level, 'county');
});

test('A failed peer switch preserves the visible selection until retry succeeds', async () => {
  let fail = true;
  const { nav, otherCounty, errors } = neighboringFixture((file, load) => {
    if (file === 'towns/65000.geojson' && fail) throw new Error('Offline');
    return load(file);
  });
  await nav.start(); await nav.enter(county, camera); await nav.enter(town, camera);
  const previous = nav.current;
  await nav.switchTo(otherCounty, 0);
  assert.equal(nav.current, previous); assert.equal(nav.stack.length, 3);
  assert.equal(errors.length, 1);
  fail = false; await errors[0].retry();
  assert.equal(nav.current.path[0].id, otherCounty.id); assert.equal(nav.stack.length, 2);
});

test('The latest peer switch wins and back cancels an unfinished switch', async () => {
  const deferred = new Map();
  let delay = false;
  const { nav, otherCounty, otherTown } = neighboringFixture((file, load) => {
    if (delay) return new Promise((resolve) => deferred.set(file, () => resolve(load(file))));
    return load(file);
  });
  await nav.start(); await nav.enter(county, camera); await nav.enter(town, camera);
  delay = true;
  const first = nav.switchTo(otherCounty, 0); const second = nav.switchTo(otherTown, 1);
  deferred.get(`villages/${otherTown.id}.geojson`)(); await second;
  deferred.get('towns/65000.geojson')(); await first;
  assert.equal(nav.current.path[1].id, otherTown.id); assert.equal(nav.stack.length, 3);
  const pending = nav.switchTo(otherCounty, 0);
  nav.back(); deferred.get('towns/65000.geojson')(); await pending;
  assert.equal(nav.current.level, 'town'); assert.equal(nav.current.path[0].id, county.id);
});

test('Data paths preserve administrative codes and reject invalid parent paths', () => {
  assert.equal(dataPath('town', '09007'), 'towns/09007.geojson');
  assert.equal(dataPath('village', '09007010'), 'villages/09007010.geojson');
  assert.throws(() => dataPath('village', '../secret'));
});

test('Remote islands remain in full geometry while the overview fits nearby Taiwan', () => {
  const geometry = { type: 'MultiPolygon', coordinates: [
    [[[120, 23], [121, 23], [121, 24], [120, 23]]],
    [[[114, 10], [114.1, 10], [114.1, 10.1], [114, 10]]],
  ] };
  assert.deepEqual(geometryBounds(geometry), [114, 10, 121, 24]);
  assert.deepEqual(focusBounds(geometry), [120, 23, 121, 24]);
});

test('Regions sharing a boundary are colored differently', () => {
  const a = { geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, properties: {} };
  const b = { geometry: { type: 'Polygon', coordinates: [[[1, 0], [2, 0], [1, 1], [1, 0]]] }, properties: {} };
  colorRegions([a, b]); assert.notEqual(a.properties.color, b.properties.color);
});

test('Shared village links resolve all ancestors with one committed render', async () => {
  const { nav, events } = fixture();
  await nav.restorePath([county.id, town.id, village.id]);
  assert.equal(events.length, 1); assert.equal(nav.current.level, 'detail');
  assert.deepEqual(nav.current.path.map(f => f.id), [county.id, town.id, village.id]);
  nav.back(); assert.equal(nav.current.level, 'village');
});
test('Shared-link restoration preserves ancestor camera and newer navigation wins', async () => {
  let resolve;
  const { nav, events } = fixture(file => file === 'counties.geojson' ? Promise.resolve(data(county)) : new Promise(r => { resolve = r; }));
  await nav.start(); const first = nav.enter(county, camera); resolve(data(town)); await first;
  const pending = nav.restorePath([county.id, town.id]);
  await new Promise(r => setImmediate(r)); nav.home();
  const count = events.length; resolve(data(town)); await pending;
  assert.equal(events.length, count); assert.equal(nav.current.level, 'county');
});
test('Housing links stop at town selection and sibling selections do not drill into villages', async () => {
  const { nav } = fixture();
  await nav.restorePath([county.id, town.id], true);
  assert.equal(nav.current.level, 'town'); assert.equal(nav.current.selected.id, town.id);
  nav.selectTown(null); assert.equal(nav.current.selected, null); assert.equal(nav.stack.length, 2);
});
test('Invalid shared links are reported and leave an initialized home view', async () => {
  const { nav, errors } = fixture(); await nav.restorePath(['99999']);
  assert.equal(errors.length, 1); assert.equal(nav.current.level, 'county');
});
