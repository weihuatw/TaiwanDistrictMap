import test from 'node:test';
import assert from 'node:assert/strict';
import { HashRouter, parseRoute, routeHash } from '../src/routing/hash-router.ts';
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
