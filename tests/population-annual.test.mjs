import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AnnualPopulationRepository, validAnnualRecord } from '../src/data/population-annual.ts';
import { metricValue, recordColor, MISSING, metricPath, parseMetric, metricColors, formatValue } from '../src/apps/population/theme.ts';
const fixture = async path => JSON.parse(await readFile(new URL(`../public/data/population/annual/${path}`, import.meta.url), 'utf8'));
const index = await fixture('manifest.json');
const meta = await fixture('2025/manifest.json');
const full = { code: '63000010', name: '松山區', monthsCovered: 12, observedBirths: 100, observedDeaths: 150,
  births: 100, deaths: 150, naturalIncrease: -50, startPopulation: 8000, endPopulation: 12000, meanPopulation: 10000, densityPopulation: 12000, areaKm2: 2 };
function repository(responses) {
  const calls = [];
  const repo = new AnnualPopulationRepository('/TaiwanDistrictMap/data/population/annual', async url => {
    calls.push(url); const path = url.replace('/TaiwanDistrictMap/data/population/annual/', '');
    const result = responses[path];
    if (result instanceof Error) throw result;
    return { ok: result !== undefined, json: async () => structuredClone(result) };
  });
  return { repo, calls };
}
test('Annual indicators distinguish counts, per mille rates, official area and incomplete data', () => {
  assert.equal(metricValue(null, 'density', full), 6000);
  assert.equal(metricValue(null, 'birthRate', full), 10);
  assert.equal(metricValue(null, 'deathRate', full), 15);
  assert.equal(metricValue(null, 'naturalIncrease', full), -50);
  assert.equal(metricValue(null, 'naturalRate', full), -5);
  assert.equal(metricValue(null, 'births', { ...full, births: 0 }), 0);
  assert.equal(metricValue(null, 'birthRate', { ...full, meanPopulation: 0 }), null);
  assert.equal(metricValue(null, 'density', { ...full, areaKm2: null }), null);
  assert.equal(metricValue(null, 'births', { ...full, births: null }), null);
  assert.equal(recordColor(null, 'births', 'village', { ...full, births: null }), MISSING);
  assert.notDeepEqual(metricColors('naturalRate'), metricColors('birthRate'));
  assert.equal(formatValue(10, 'birthRate'), '10.0 ‰');
  assert.equal(formatValue(-50, 'naturalIncrease'), '-50 人');
  assert.equal(parseMetric('metric=density'), 'density');
  const ids = ['63000', '63000010', '63000010001'];
  assert.deepEqual(metricPath(ids, 'density'), ids.slice(0, 2));
  assert.deepEqual(metricPath(ids, 'births'), ids);
});
test('Annual repository loads only requested shards, shares concurrent requests and preserves BASE_URL', async () => {
  const responses = { 'manifest.json': index, '2025/manifest.json': meta, '2025/towns/63000.json': { schemaVersion: 1, year: 2025, level: 'town', parentCode: '63000', records: { [full.code]: full } } };
  const { repo, calls } = repository(responses);
  assert.deepEqual(calls, []);
  await Promise.all([repo.loadRegions('town', '63000'), repo.loadRegions('town', '63000')]);
  assert.equal(calls.length, 3);
  assert.equal(repo.get(full.code).births, 100);
  assert.equal(repo.get('63000010001'), null);
  assert.ok(calls.every(url => url.startsWith('/TaiwanDistrictMap/data/population/annual/')));
  assert.ok(calls.every(url => !url.includes('/villages/') && !url.includes('/ages/')));
  await assert.rejects(repo.loadRegions('village', '63000'), /parent/);
});
test('Rejected metadata and failed responses are retryable and never publish partial records', async () => {
  const responses = { 'manifest.json': index, '2025/manifest.json': meta };
  const { repo } = repository(responses);
  const path = '2025/towns/63000.json';
  responses[path] = new Error('offline');
  await assert.rejects(repo.loadRegions('town', '63000'), /offline/);
  const shard = { schemaVersion: 1, year: 2024, level: 'town', parentCode: '63000', records: { [full.code]: full } };
  responses[path] = shard;
  await assert.rejects(repo.loadRegions('town', '63000'), /summary/);
  assert.equal(repo.get(full.code), null);
  shard.year = 2025; shard.parentCode = '65000';
  await assert.rejects(repo.loadRegions('town', '63000'), /summary/);
  shard.parentCode = '63000'; shard.records['65000010'] = { ...full, code: '65000010' };
  await assert.rejects(repo.loadRegions('town', '63000'), /summary/);
  assert.equal(repo.get(full.code), null);
  delete shard.records['65000010'];
  await repo.loadRegions('town', '63000'); assert.equal(repo.get(full.code).meanPopulation, 10000);
  const badMeta = repository({ 'manifest.json': index, '2025/manifest.json': { ...meta, files: { ...meta.files, national: '../national.json' } } });
  await assert.rejects(badMeta.repo.manifest(), /manifest/);
});
test('Annual validation keeps incomplete months null and rejects incorrect denominators or invented village area', () => {
  assert.ok(validAnnualRecord(full, full.code, false));
  assert.equal(validAnnualRecord({ ...full, meanPopulation: 12000 }, full.code, false), false);
  assert.equal(validAnnualRecord({ ...full, monthsCovered: 11 }, full.code, false), false);
  const partial = { ...full, code: '63000010001', monthsCovered: 11, births: null, deaths: null, naturalIncrease: null,
    startPopulation: null, meanPopulation: null, densityPopulation: null, areaKm2: null };
  assert.ok(validAnnualRecord(partial, partial.code, true));
  assert.equal(validAnnualRecord({ ...partial, births: 0 }, partial.code, true), false);
  assert.equal(validAnnualRecord({ ...partial, areaKm2: 1 }, partial.code, true), false);
});
test('Published annual data reproduce national totals and use aggregate denominators rather than averaging local rates', async () => {
  const national = (await fixture('2025/national.json')).record;
  const counties = Object.values((await fixture('2025/counties.json')).records);
  assert.equal(national.births, 107812); assert.equal(national.deaths, 200268);
  assert.equal(national.naturalIncrease, -92456);
  assert.equal(national.endPopulation, 23299132);
  for (const key of ['births', 'deaths', 'startPopulation', 'endPopulation', 'meanPopulation'])
    assert.equal(counties.reduce((sum, row) => sum + row[key], 0), national[key]);
  const weightedBirthRate = counties.reduce((sum, row) => sum + metricValue(null, 'birthRate', row) * row.meanPopulation, 0) / national.meanPopulation;
  assert.ok(Math.abs(weightedBirthRate - metricValue(null, 'birthRate', national)) < 1e-10);
  const report = await fixture('2025/join-report.json'); assert.equal(report.incompleteEvents.length, 46);
  const { repo } = repository({ 'manifest.json': index, '2025/manifest.json': meta, '2025/national.json': { schemaVersion: 1, year: 2024, record: national } });
  await assert.rejects(repo.getNational(), /national/);
});
