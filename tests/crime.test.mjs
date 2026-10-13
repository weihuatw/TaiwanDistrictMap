import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { CrimeRepository, validSnapshot } from '../src/data/crime.ts';
import { parseFilter, value, color, cuts, filterQuery } from '../src/apps/crime/theme.ts';
import { parseRoute, transferTheme } from '../src/routing/hash-router.ts';
import { comparisonRoute } from '../src/comparison/sync.ts';

const sample = JSON.parse(await fs.readFile('public/data/crime/2026/official-available.json', 'utf8'));
const index = JSON.parse(await fs.readFile('public/data/crime/manifest.json', 'utf8'));
test('Crime rates use corresponding-period population, with no annualization or resident percentage', () => {
  const f = parseFilter('metric=rate'), r = { ...sample.records.TW, population: 200000, cases: { total: 10 }, suspects: { total: 4 } };
  assert.equal(value(r, f), 5);
  assert.equal(value(r, { ...f, metric: 'offenderRate' }), 2);
  assert.equal(value({ ...r, suspects: null }, { ...f, metric: 'suspects' }), null);
  assert.equal(value(null, f), null);
  assert.notEqual(color(null, f, 'county'), color({ ...r, cases: { total: 0 } }, f, 'county'));
});
test('Crime route filters constrain unavailable suspect metrics and geographic depth', () => {
  const f = parseFilter('scope=regional&metric=offenderRate&year=2025&period=half&category=motorcycleTheft');
  assert.equal(f.metric, 'rate'); assert.equal(f.period, 'half'); assert.equal(f.year, 2025);
  assert.deepEqual(parseFilter(filterQuery(f)), f);
  assert.equal(parseRoute('#/crime/63000/63000020?scope=regional').theme, 'crime');
  assert.throws(() => parseRoute('#/crime/a/b/c'));
  assert.deepEqual(transferTheme({ theme: 'admin', ids: ['63000', '63000020', '63000020001'], query: '' }, 'crime').ids, ['63000', '63000020']);
  assert.deepEqual(comparisonRoute({ theme: 'admin', ids: ['63000','63000020','63000020001'], query: '' }, { theme: 'crime', ids: [], query: 'scope=official' }).ids, ['63000']);
});
test('Crime repository caches successful snapshots and retries failed validation', async () => {
  let attempts = 0;
  const repo = new CrimeRepository('/crime/', async url => {
    if (String(url).endsWith('manifest.json')) return Response.json(index);
    attempts++; return Response.json(attempts === 1 ? { ...sample, year: 2025 } : sample);
  });
  await assert.rejects(repo.snapshot(2026, 'official', 'available'), /驗證/);
  const [a,b] = await Promise.all([repo.snapshot(2026,'official','available'),repo.snapshot(2026,'official','available')]);
  assert.equal(a,b); assert.equal(attempts,2);
  for (const bad of [{ ...sample, endMonth: 13 }, { ...sample, complete: true }, { ...sample, period: 'half' }, { ...sample, records: { TW: { ...sample.records.TW, population: 0 } } }, { ...sample, records: { TW: { ...sample.records.TW, cases: { total: -1 } } } }]) assert.equal(validSnapshot(bad,2026,'official','available'),false);
});

test('Sparse crime categories have meaningful fixed scales across years', () => {
  const f = parseFilter('scope=regional&category=robbery&metric=rate');
  assert.deepEqual(cuts(f,'county'),cuts({...f,year:2024},'county'));
  const r = {...sample.records.TW, population:100000, cases:{robbery:1}};
  assert.notEqual(color(r,f,'county'),color({...r,cases:{robbery:5}},f,'county'));
});
