import test from 'node:test';
import assert from 'node:assert/strict';
import { createThemeAppHost } from '../src/routing/theme-app-host.ts';

const route = (theme, ids = []) => ({ theme, ids, query: '' });
const flush = () => new Promise(resolve => setImmediate(resolve));
const allLoaders = (overrides = {}) => Object.fromEntries(
  ['admin', 'income', 'school', 'housing', 'politics'].map(theme => [theme, overrides[theme] ?? (() => Promise.resolve(() => ({ restoreRoute() {}, destroy() {} })))]),
);

test('starts only the requested theme and restores routes without reloading it', async () => {
  let current = route('school');
  const calls = [];
  const host = createThemeAppHost(
    { get current() { return current; } },
    allLoaders({ school: async () => { calls.push('load'); return () => ({ restoreRoute(value) { calls.push(value.ids[0]); }, destroy() {} }); } }),
    () => {}, () => {},
  );

  host.activate(current);
  await flush();
  assert.deepEqual(calls, ['load']);
  current = route('school', ['63000']);
  host.activate(current);
  assert.deepEqual(calls, ['load', '63000']);
  host.destroy();
});

test('a late theme import cannot replace a more recent route', async () => {
  let current = route('school');
  let finishSchool;
  const started = [];
  const host = createThemeAppHost(
    { get current() { return current; } },
    allLoaders({
      school: () => new Promise(resolve => { finishSchool = resolve; }),
      income: async () => () => { started.push('income'); return { restoreRoute() {}, destroy() {} }; },
    }),
    () => {}, () => {},
  );

  host.activate(current);
  current = route('income');
  host.activate(current);
  await flush();
  finishSchool(() => { started.push('school'); return { restoreRoute() {}, destroy() {} }; });
  await flush();
  assert.deepEqual(started, ['income']);
  host.destroy();
});
