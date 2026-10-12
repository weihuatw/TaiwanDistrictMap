import test from 'node:test';
import assert from 'node:assert/strict';
import { HashRouter, parseRoute, routeHash, transferTheme } from '../src/routing/hash-router.ts';
function browser(hash = '#/school') {
  const listeners = new Map(), entries = [{ hash, state: null }]; let index = 0;
  const location = { hash, pathname: '/TaiwanDistrictMap/', search: '' };
  const emit = type => { for (const listener of listeners.get(type) ?? []) listener(); };
  const history = {
    get state() { return entries[index].state; },
    replaceState(state, _, hash) { entries[index] = { hash, state }; location.hash = hash; },
    pushState(state, _, hash) { entries.splice(++index, Infinity, { hash, state }); location.hash = hash; },
    go(delta) { queueMicrotask(() => { index += delta; assert.ok(index >= 0 && index < entries.length); location.hash = entries[index].hash; emit('popstate'); emit('hashchange'); }); },
  };
  return { location, history, entries, emit, addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); }, removeEventListener(type, fn) { listeners.get(type)?.delete(fn); } };
}
const route = (ids = [], theme = 'school', query = '') => ({ theme, ids, query });
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup(hash) {
  const b = browser(hash), router = new HashRouter(b), restored = [];
  router.subscribe(r => { restored.push(r); router.commit(r); });
  return { b, router, restored };
}
test('ASCII routes parse filters and reject malformed names and extra hierarchy', () => {
  assert.deepEqual(parseRoute('#/school/63000/63000020/323604-elementary?junior=false'), route(['63000','63000020','323604-elementary'],'school','junior=false'));
  assert.equal(routeHash(route(['63000'])), '#/school/63000');
  for (const hash of ['#/other', '#/school/臺北市', '#/housing/a/b/c', '#/admin/a/b/c/d', '#/school/%2F']) assert.throws(() => parseRoute(hash));
});
test('Direct school links seed parents; Back and Forward restore hierarchy exactly once', async () => {
  const { b, router, restored } = setup('#/school/63000/63000020/323604-elementary');
  assert.equal(b.entries.length, 4);
  b.history.go(-1); await flush(); assert.deepEqual(router.current.ids, ['63000','63000020']);
  assert.equal(restored.length, 2);
  b.history.go(1); await flush(); assert.equal(router.current.ids.at(-1), '323604-elementary');
});
test('School siblings replace the leaf; browser Back goes to the district', async () => {
  const { b, router } = setup();
  router.commit(route(['63000'])); router.commit(route(['63000','63000020'])); router.commit(route(['63000','63000020','first'])); router.commit(route(['63000','63000020','second']));
  assert.equal(b.entries.length, 4); b.history.go(-1); await flush(); assert.equal(router.current.ids.length, 2);
});
test('Cross-district and cross-county changes rebuild ancestors without old siblings', async () => {
  const { b, router } = setup('#/school/63000/63000020/first');
  router.commit(route(['63000','63000030'])); await flush();
  assert.equal(b.entries.length, 3); b.history.go(-1); await flush(); assert.deepEqual(router.current.ids, ['63000']);
  router.commit(route(['65000','65000010','other'])); await flush();
  b.history.go(-1); await flush(); assert.deepEqual(router.current.ids, ['65000','65000010']);
  b.history.go(-1); await flush(); assert.deepEqual(router.current.ids, ['65000']);
});
test('In-app back removes children and allows a fresh drill-down', async () => {
  const { b, router } = setup('#/income/63000/63000020/63000020001');
  router.commit(route(['63000','63000020'],'income')); await flush();
  router.commit(route(['63000','63000020','63000020002'],'income'));
  b.history.go(-1); await flush(); assert.equal(router.current.ids.length, 2);
});
test('Query-only changes replace history; refresh does not seed parents twice', () => {
  const { b, router } = setup('#/housing/63000/63000020?year=2024');
  router.commit(route(['63000','63000020'],'housing','year=2025&type=house'));
  assert.equal(b.entries.length, 3); router.destroy();
  const next = new HashRouter(b); next.subscribe(r => next.commit(r)); assert.equal(b.entries.length, 3);
});
test('Rapid commits during ancestor traversal retain the newest selection', async () => {
  const { b, router } = setup('#/school/63000/63000020/first');
  router.commit(route(['65000'])); router.commit(route(['10001','10001010'])); await flush();
  assert.deepEqual(router.current.ids, ['10001','10001010']); assert.equal(b.entries.length, 3);
});
test('Switching themes restores separate history and teardown removes listeners', async () => {
  const { b, router, restored } = setup('#/school/63000');
  b.history.pushState(null, '', '#/income'); b.emit('hashchange');
  assert.equal(router.current.theme, 'income'); b.history.go(-1); await flush(); assert.equal(router.current.theme, 'school');
  const count = restored.length; router.destroy(); b.emit('popstate'); assert.equal(restored.length, count);
});

test('Theme transfers keep geographical codes, clip unsupported leaves and never reuse school IDs', () => {
  const village = route(['09007', '09007010', '09007010001'], 'admin');
  assert.deepEqual(transferTheme(village, 'population', 'metric=young'), route(village.ids, 'population', 'metric=young'));
  for (const theme of ['school', 'housing']) assert.deepEqual(transferTheme(village, theme).ids, village.ids.slice(0, 2));
  assert.deepEqual(transferTheme(route(['63000', '63000020', '323604-elementary']), 'income').ids, ['63000', '63000020']);
});

test('Cross-theme links retain each theme\'s own filters and do not copy source queries', () => {
  const { router } = setup('#/population/63000/63000020?metric=elderly');
  router.navigate(router.themeRoute('housing'));
  router.commit(route(['63000', '63000020'], 'housing', 'year=2024&type=house'));
  assert.equal(router.themeRoute('population').query, 'metric=elderly');
  assert.equal(router.themeRoute('income').query, '');
  router.navigate(router.themeRoute('population'));
  assert.equal(router.themeRoute('housing').query, 'year=2024&type=house');
});

test('Cross-theme viewports survive entry, refresh and browser Back without appearing in share URLs', async () => {
  const { b, router } = setup('#/admin/63000/63000020/63000020001');
  const camera = { center: [121.57, 25.03], zoom: 15.5, bearing: 0, pitch: 0 };
  const target = router.themeRoute('income');
  router.navigate(target, camera);
  assert.deepEqual(router.consumeRouteCamera(target), camera);
  assert.equal(router.consumeRouteCamera(target), null);
  assert.deepEqual(b.history.state.camera, camera);
  assert.ok(!b.location.hash.includes('camera'));
  b.history.go(-4); await flush();
  assert.equal(router.current.theme, 'admin');
  assert.deepEqual(router.consumeRouteCamera(router.current), camera);
  router.destroy();
  const next = new HashRouter(b);
  next.subscribe(r => next.commit(r));
  assert.deepEqual(next.consumeRouteCamera(next.current), camera);
  assert.equal(b.entries.length, 8);
});

test('Invalid cameras and cameras for incomplete routes are not applied', () => {
  const { router } = setup('#/admin/63000');
  const target = router.themeRoute('population');
  router.navigate(target, { center: [Infinity, 25], zoom: 10, bearing: 0, pitch: 0 });
  assert.equal(router.consumeRouteCamera(target), null);
  router.navigate(router.themeRoute('income'), { center: [121, 25], zoom: 10, bearing: 0, pitch: 0 });
  assert.equal(router.consumeRouteCamera(route([], 'income')), null);
  assert.ok(router.consumeRouteCamera(router.current));
});

test('A theme switch during ancestor traversal wins over the older geography commit', async () => {
  const { router } = setup('#/admin/63000/63000020/63000020001');
  router.commit(route(['65000'], 'admin'));
  router.navigate(route(['63000', '63000020'], 'population', 'metric=young'));
  await flush();
  assert.deepEqual(router.current, route(['63000', '63000020'], 'population', 'metric=young'));
});

test('Leaving a still-loading theme preserves its requested route and preferences', () => {
  const b = browser('#/admin/63000/63000020');
  const router = new HashRouter(b), requested = [];
  router.subscribe(r => requested.push(r));
  router.commit(route(['63000', '63000020'], 'admin'));
  const loading = route(['63000', '63000020'], 'population', 'metric=elderly');
  router.navigate(loading);
  router.navigate(route(['63000', '63000020'], 'income'));
  assert.deepEqual(b.entries.at(-2).state.route, loading);
  assert.equal(router.themeRoute('population').query, 'metric=elderly');
  assert.equal(requested.at(-1).theme, 'income');
});
test('Indigenous links preserve geographic hierarchy with independent metric and tribe query', () => {
  const indigenous = route(['10001','10001010','10001010001'], 'indigenous', 'metric=share&tribe=siraya');
  assert.deepEqual(parseRoute(routeHash(indigenous)), indigenous);
  assert.deepEqual(transferTheme(indigenous, 'admin').ids, indigenous.ids);
  assert.deepEqual(transferTheme(indigenous, 'housing').ids, indigenous.ids.slice(0, 2));
});
