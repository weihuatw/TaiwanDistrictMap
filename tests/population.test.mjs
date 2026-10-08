import test from 'node:test';
import assert from 'node:assert/strict';
import { PopulationRepository } from '../src/data/population.ts';

const manifest = {
  schemaVersion: 1,
  period: '2026-08',
  sourceMonth: '11508',
  label: '民國115年8月底（2026-08-31）',
  populationType: 'registered',
  ageBuckets: [],
  source: { title: '戶籍人口', catalogUrl: 'https://data.gov.tw/dataset/77132' },
  files: {
    villages: '2026-08/villages/{townCode}.json',
    towns: '2026-08/towns/{countyCode}.json',
    counties: '2026-08/counties.json',
    national: '2026-08/national.json',
    ages: '2026-08/ages/{townCode}.json',
  },
};
const record = { code: '09007010001', name: '莒光里', countyCode: '09007', countyName: '連江縣', townCode: '09007010', townName: '南竿鄉', households: 10, population: 23, male: 12, female: 11 };
const json = (data) => Response.json(data);

test('Population repository keeps leading zeroes, shares concurrent loads, and exposes the month', async () => {
  const requested = [];
  const repo = new PopulationRepository('/data/population/', async (url) => {
    requested.push(url);
    if (url.endsWith('/manifest.json')) return json(manifest);
    if (url.endsWith('/2026-08/villages/09007010.json')) return json({ records: { [record.code]: record } });
    return new Response(null, { status: 404 });
  });
  const [first, second] = await Promise.all([repo.getVillage(record.code), repo.getVillage(record.code)]);
  assert.deepEqual(first, { period: '2026-08', label: manifest.label, record });
  assert.equal(second.record.code, '09007010001');
  assert.deepEqual(requested, ['/data/population/manifest.json', '/data/population/2026-08/villages/09007010.json']);
  await assert.rejects(repo.getVillage('../unsafe'));
});

test('Failed population requests are not cached and can be retried', async () => {
  let villageCalls = 0;
  const repo = new PopulationRepository('/population/', async (url) => {
    if (url.endsWith('/manifest.json')) return json(manifest);
    villageCalls++;
    return villageCalls === 1
      ? new Response(null, { status: 503 })
      : json({ records: { [record.code]: record } });
  });
  await assert.rejects(repo.getVillage(record.code), /Population data request failed/);
  assert.equal((await repo.getVillage(record.code)).record.population, 23);
  assert.equal(villageCalls, 2);
});

test('Malformed population shards are rejected and can be refetched', async () => {
  let villageCalls = 0;
  const repo = new PopulationRepository('/population/', async (url) => {
    if (url.endsWith('/manifest.json')) return json(manifest);
    villageCalls++;
    return json(villageCalls === 1 ? { values: {} } : { records: { [record.code]: record } });
  });
  await assert.rejects(repo.getVillage(record.code), /Invalid population record shard/);
  assert.equal((await repo.getVillage(record.code)).record.population, 23);
  assert.equal(villageCalls, 2);
});

test('Village age shards remain opt-in and share the same period', async () => {
  const requested = [];
  const ages = { male: Array(101).fill(0), female: Array(101).fill(0) };
  const repo = new PopulationRepository('/population/', async (url) => {
    requested.push(url);
    if (url.endsWith('/manifest.json')) return json(manifest);
    return json({ records: { [record.code]: ages } });
  });
  const result = await repo.getVillageAges(record.code);
  assert.equal(result.period, '2026-08');
  assert.equal(result.record.male.length, 101);
  assert(requested.includes('/population/2026-08/ages/09007010.json'));
});
