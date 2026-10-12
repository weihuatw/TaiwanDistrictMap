import test from 'node:test';
import assert from 'node:assert/strict';
import { comparisonRoute, createComparisonSync } from '../src/comparison/sync.ts';
import { createLocalRouter } from '../src/routing/local-router.ts';

const route = (theme = 'admin', ids = [], query = '') => ({ theme, ids, query });
const camera = (x = 121, zoom = 10) => ({ center: [x, 24], zoom, bearing: 0, pitch: 0 });
const flush = () => new Promise(resolve => setImmediate(resolve));

test('comparison clips coarse themes and density without transferring their filters', () => {
  const source = route('admin', ['63000', '63000020', '63000020001']);
  for (const theme of ['housing', 'school']) {
    assert.deepEqual(comparisonRoute(source, route(theme, [], 'year=2024')).ids, source.ids.slice(0, 2));
  }
  assert.deepEqual(comparisonRoute(source, route('population', [], 'metric=density')).ids, source.ids.slice(0, 2));
  const target = comparisonRoute(source, route('population', [], 'metric=elderly'));
  assert.deepEqual(target.ids, source.ids); assert.equal(target.query, 'metric=elderly');
  assert.deepEqual(source.ids, ['63000', '63000020', '63000020001']);
});

test('school IDs are preserved only between school panes', () => {
  const source = route('school', ['63000', '63000020', '323604-elementary']);
  assert.deepEqual(comparisonRoute(source, route('school')).ids, source.ids);
  assert.deepEqual(comparisonRoute(source, route('income')).ids, source.ids.slice(0, 2));
});

function setup(left = route(), right = route('income')) {
  const state = [left, right], cameras = [camera(), camera(120, 7)], navigations = [], movements = [];
  let sync;
  const panes = [0, 1].map(index => ({
    route: () => state[index], camera: () => cameras[index],
    navigate(value) { state[index] = value; navigations.push([index, value]); sync.committed(index); },
    move(value) { cameras[index] = value; movements.push(index); sync.moved(index); },
  }));
  sync = createComparisonSync(panes);
  return { sync, state, cameras, navigations, movements };
}

test('bidirectional camera and selection updates do not feed back through emitted events', () => {
  const s = setup(route('admin', ['63000']));
  s.sync.setEnabled(true);
  assert.deepEqual(s.state[1].ids, ['63000']); assert.deepEqual(s.cameras[1], s.cameras[0]);
  assert.equal(s.navigations.length, 1);
  s.sync.interact(1); s.cameras[1] = camera(122, 14); s.sync.moved(1);
  assert.deepEqual(s.cameras[0], camera(122, 14));
  s.state[1] = route('income', ['65000', '65000010']); s.sync.committed(1);
  assert.deepEqual(s.state[0].ids, ['65000', '65000010']); assert.equal(s.navigations.length, 2);
  assert.ok(s.movements.length < 10);
});

test('a coarse follower keeps town data and receives the village camera', () => {
  const s = setup(route('admin', ['63000', '63000020', '63000020001']), route('housing', [], 'year=2024'));
  s.cameras[0] = camera(121.56, 16); s.sync.setEnabled(true);
  assert.deepEqual(s.state[1].ids, ['63000', '63000020']);
  assert.equal(s.state[1].query, 'year=2024'); assert.deepEqual(s.cameras[1], camera(121.56, 16));
  s.cameras[0] = camera(121.57, 17); s.sync.moved(0);
  assert.deepEqual(s.cameras[1], camera(121.57, 17));
});

test('follower imports, camera animations and late data cannot override the owner', () => {
  const s = setup(route('admin', ['63000'])); s.sync.setEnabled(true);
  s.cameras[1] = camera(119, 6); s.sync.moved(1);
  assert.deepEqual(s.cameras[0], camera());
  s.sync.refresh(); assert.deepEqual(s.cameras[1], camera());
});

test('a delayed replicated commit after user pan does not resend a clipped town route', () => {
  const state = [route('admin', ['63000', '63000020', '63000020001']), route('housing')];
  const requested = [];
  const sync = createComparisonSync([0, 1].map(i => ({
    route: () => state[i], camera: () => camera(), move() {},
    navigate(r) { state[i] = r; requested.push(i); },
  })));
  sync.setEnabled(true); sync.interact(1); sync.committed(1);
  assert.deepEqual(requested, [1]); assert.equal(state[0].ids.length, 3);
});

test('density normalization and theme switches preserve the finer geographic selection', () => {
  const village = ['63000', '63000020', '63000020001'];
  const s = setup(route('admin', village), route('population', village, 'metric=population'));
  s.sync.setEnabled(true); s.sync.interact(1);
  s.state[1] = route('population', village.slice(0, 2), 'metric=density'); s.sync.committed(1);
  assert.deepEqual(s.state[0].ids, village); assert.deepEqual(s.sync.location.ids, village);
  s.sync.moved(1); assert.deepEqual(s.sync.location.ids, village);
  s.state[1] = route('income', village); s.sync.committed(1);
  assert.deepEqual(s.state[0].ids, village);
  // An explicit geographic return still changes both panes.
  s.state[1] = route('income', village.slice(0, 2)); s.sync.committed(1);
  assert.deepEqual(s.state[0].ids, village.slice(0, 2));
});

test('disabling sync keeps both panes independent and enabling uses the last active pane', () => {
  const s = setup(); s.sync.setEnabled(true); s.sync.setEnabled(false);
  const previous = s.cameras[1]; s.cameras[0] = camera(119, 12); s.sync.moved(0);
  assert.deepEqual(s.cameras[1], previous);
  s.sync.interact(1); s.state[1] = route('income', ['65000']); s.cameras[1] = camera(120, 13);
  s.sync.setEnabled(true); assert.deepEqual(s.state[0].ids, ['65000']); assert.deepEqual(s.cameras[0], camera(120, 13));
});

test('a pane still loading its map receives the latest camera when ready', () => {
  const s = setup(); s.cameras[0] = undefined; s.sync.setEnabled(true);
  assert.equal(s.movements.length, 0);
  s.cameras[0] = camera(121.6, 15); s.sync.refresh(); assert.deepEqual(s.cameras[1], camera(121.6, 15));
});

test('right pane maintains its own hierarchy and theme queries without browser writes', async () => {
  const router = createLocalRouter(route('income', ['63000', '63000020', '63000020001']));
  const restored = []; router.subscribe(r => { restored.push(r); router.commit(r); });
  router.commit(route('income', ['63000', '63000020'])); await flush();
  assert.deepEqual(router.current.ids, ['63000', '63000020']);
  router.navigate(route('housing', ['63000', '63000020'], 'year=2024')); await flush();
  assert.equal(router.current.theme, 'housing');
  router.navigate(route('income', ['65000'])); await flush();
  assert.equal(router.themeRoute('housing').query, 'year=2024');
  router.destroy(); const count = restored.length; await flush(); assert.equal(restored.length, count);
});
