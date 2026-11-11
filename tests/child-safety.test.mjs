import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { color, legendItems, readFilter, value } from '../src/apps/child-safety/theme.ts';
import { parseRoute, routeHash, transferTheme } from '../src/routing/hash-router.ts';

const data = JSON.parse(readFileSync(new URL('../public/data/child-safety/statistics.json', import.meta.url)));

test('兒少保護色階使用通報件次或每萬名兒少的標準化件次', () => {
  const records = data.years['2025'];
  const county = records['65000'];
  assert.equal(value(county, 'reports'), 21788);
  assert.equal(value(county, 'rate'), 21788 / county.population * 10000);
  assert.equal(value(records.TW, 'rate'), 136592 / 3243464 * 10000);
  assert.notEqual(color(value(county, 'reports'), 'reports'), color(value(county, 'rate'), 'rate'));
  assert.equal(value(undefined, 'rate'), null);
  assert.equal(value({ ...county, population: 0 }, 'rate'), null);
  for (const metric of ['reports', 'rate', 'abused']) {
    assert.equal(color(0, metric), legendItems(metric)[0].color);
    assert.equal(color(null, metric), legendItems(metric).at(-1).color);
  }
});

test('兒少保護分享網址還原年份與著色，跨主題時保留縣市', () => {
  const route = parseRoute('#/child-safety/65000?year=2024&metric=rate');
  assert.deepEqual(readFilter(route.query, ['2025', '2024']), { year: '2024', metric: 'rate' });
  assert.deepEqual(readFilter('year=1900&metric=unknown', ['2025', '2024']), { year: '2025', metric: 'reports' });
  assert.throws(() => parseRoute('#/child-safety/65000/65000010'));
  const fromAdmin = parseRoute('#/admin/65000/65000010/65000010001');
  assert.equal(routeHash(transferTheme(fromAdmin, 'child-safety', route.query)), routeHash(route));
});
