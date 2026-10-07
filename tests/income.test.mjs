import test from 'node:test';
import assert from 'node:assert/strict';
import { IncomeRepository, incomePath } from '../src/apps/income/data.ts';
import { COLORS, MISSING_COLOR, displayedWan, classIndex, recordColor, compareIncome } from '../src/apps/income/theme.ts';

const record = { code: '09007', level: 'county', name: '連江縣', countyCode: '09007', townCode: null, taxUnits: 2, incomeTotalK: 1400, meanK: 700 };
const part = { year: 2024, level: 'county', parentCode: null, records: { '09007': record } };

test('Income paths retain leading zeroes and reject unexpected paths', () => {
  assert.equal(incomePath('towns/09007.geojson'), 'towns/09007.json');
  assert.equal(incomePath('villages/09007010.geojson'), 'villages/09007010.json');
  assert.throws(() => incomePath('../private.json'));
});
test('Income records use the configured data root and successful concurrent loads share one request', async () => {
  let count = 0; let release;
  const repository = new IncomeRepository('/project/data/income/2024', (url) => {
    count++; assert.equal(url, '/project/data/income/2024/counties.json');
    return new Promise((resolve) => { release = () => resolve(Response.json(part)); });
  });
  const first = repository.load('counties.geojson'); const second = repository.load('counties.geojson');
  release(); assert.equal(await first, await second); assert.equal(count, 1);
  assert.equal(repository.get('09007').meanK, 700); assert.equal(repository.get('not-present'), null);
});
test('Failed income requests are not cached and a retry can succeed', async () => {
  let calls = 0;
  const repository = new IncomeRepository('/income/', async () => ++calls === 1 ? new Response(null, { status: 503 }) : Response.json(part));
  await assert.rejects(repository.load('counties.geojson'), /unavailable/);
  await repository.load('counties.geojson'); assert.equal(calls, 2);
});
test('A wrong income year or a mismatched mean is rejected before cache publication', async () => {
  const wrongYear = new IncomeRepository('/income/', async () => Response.json({ ...part, year: 2023 }));
  await assert.rejects(wrongYear.load('counties.geojson'), /Invalid income dataset/);
  assert.equal(wrongYear.get('09007'), null);
  const wrongMean = new IncomeRepository('/income/', async () => Response.json({ ...part, records: { '09007': { ...record, meanK: 50 } } }));
  await assert.rejects(wrongMean.load('counties.geojson'), /Invalid income mean/);
});
test('Statistics fetched for the wrong administrative parent do not enter the record cache', async () => {
  const repository = new IncomeRepository('/income/', async () => Response.json({ year: 2024, level: 'town', parentCode: '63000', records: {} }));
  await assert.rejects(repository.load('towns/09007.geojson'), /parent mismatch/);
});
test('Zero taxpayers produce missing means while a genuine zero income remains a valid low value', async () => {
  const repository = new IncomeRepository('/income/', async () => Response.json({ ...part, records: { '09007': { ...record, taxUnits: 0, incomeTotalK: 0, meanK: null } } }));
  await repository.load('counties.geojson');
  assert.equal(recordColor(repository.get('09007')), MISSING_COLOR);
  assert.equal(recordColor({ meanK: 0 }), COLORS[0]);
});
test('Fixed absolute classes agree with the displayed amount at every threshold', () => {
  assert.equal(displayedWan(649.9), 65);
  assert.equal(classIndex(649.9), 2);
  assert.equal(classIndex(1499), 5); assert.equal(classIndex(1500), 6);
  assert.equal(classIndex(4591.567), 6); assert.equal(classIndex(null), null);
  assert.equal(recordColor(undefined), MISSING_COLOR);
});
test('Comparison uses income values and handles missing or zero references', () => {
  assert(Math.abs(compareIncome(1200, 1000) - 20) < 1e-9);
  assert.equal(compareIncome(null, 1000), null); assert.equal(compareIncome(1200, 0), null);
});
