import test from 'node:test';
import assert from 'node:assert/strict';
import { COLORS, MISSING, formatValue, metricValue, parseMetric, recordColor, thresholds } from '../src/apps/population/theme.ts';

const record = { population: 1000, households: 450, male: 480, female: 520, age0to14: 150, age15to64: 600, age65plus: 250 };
test('Population indicators use the selected area\'s population as denominator and handle missing/zero data', () => {
  assert.equal(metricValue(record, 'population'), 1000);
  assert.equal(metricValue(record, 'households'), 450);
  assert.equal(metricValue(record, 'elderly'), 25);
  assert.equal(metricValue(record, 'young'), 15);
  assert.equal(metricValue(record, 'female'), 52);
  assert.equal(metricValue(null, 'population'), null);
  assert.equal(metricValue({ ...record, population: 0 }, 'elderly'), null);
  assert.equal(metricValue({ ...record, population: 0 }, 'population'), 0);
  assert.equal(metricValue({ ...record, age65plus: undefined }, 'elderly'), null);
});
test('Population query defaults and fixed legends agree at threshold boundaries', () => {
  assert.equal(parseMetric('metric=elderly'), 'elderly');
  assert.equal(parseMetric('metric=unknown'), 'population');
  assert.equal(parseMetric(''), 'population');
  assert.equal(recordColor(record, 'elderly', 'village'), COLORS[4]);
  assert.equal(recordColor(null, 'elderly', 'county'), MISSING);
  assert.deepEqual(thresholds('elderly', 'county'), thresholds('elderly', 'village'));
  assert.notDeepEqual(thresholds('population', 'county'), thresholds('population', 'village'));
  assert.equal(formatValue(25, 'elderly'), '25.0 %');
  assert.equal(formatValue(null, 'elderly'), '無資料');
});
