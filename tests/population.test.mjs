import test from 'node:test';
import assert from 'node:assert/strict';
import { PopulationRepository } from '../src/data/population.ts';
import { populationTarget } from '../src/apps/admin/population-panel.ts';

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

test('Population targets follow the visible national, county, town and selected village scope', () => {
  const region = (level, code, name, unassigned = false) => ({ properties: { level, code, name, unassigned } });
  const county = region('county', '63000', '臺北市');
  const town = region('town', '63000080', '文山區');
  const village = region('village', '63000080027', '木柵里');
  assert.equal(populationTarget({ path: [], selected: null }).level, 'national');
  assert.equal(populationTarget({ path: [county], selected: null }).code, '63000');
  assert.equal(populationTarget({ path: [county, town], selected: null }).code, '63000080');
  assert.equal(populationTarget({ path: [county, town, village], selected: village }).code, '63000080027');
  assert.equal(populationTarget({ path: [county, town], selected: region('village', '63000080A01', '未編定村里', true) }).unassigned, true);
});

test('Population aggregates load the appropriate national, county and town resources', async () => {
  const requested = [];
  const repo = new PopulationRepository('/population/', async url => {
    requested.push(url);
    if (url.endsWith('/manifest.json')) return json(manifest);
    if (url.endsWith('/national.json')) return json({ record: { ...record, code: 'TW' } });
    if (url.endsWith('/counties.json')) return json({ records: { '09007': { ...record, code: '09007' } } });
    return json({ records: { '09007010': { ...record, code: '09007010' } } });
  });
  assert.equal((await repo.getNational()).record.code, 'TW');
  assert.equal((await repo.getCounty('09007')).record.code, '09007');
  assert.equal((await repo.getTown('09007010')).record.code, '09007010');
  assert.deepEqual(requested, ['/population/manifest.json', '/population/2026-08/national.json', '/population/2026-08/counties.json', '/population/2026-08/towns/09007.json']);
});

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

test('Population map levels reuse small summary shards and never request single-age detail', async () => {
  const requested = [];
  const repo = new PopulationRepository('/TaiwanDistrictMap/data/population/', async url => {
    requested.push(url);
    if (url.endsWith('/manifest.json')) return json(manifest);
    const level = url.includes('/counties.json') ? 'county' : url.includes('/towns/') ? 'town' : 'village';
    const code = level === 'county' ? '09007' : level === 'town' ? '09007010' : record.code;
    return json({ schemaVersion: 1, period: manifest.period, level,
      parentCode: level === 'town' ? '09007' : '09007010',
      records: { [code]: { ...record, code, age0to14: 3, age15to64: 16, age65plus: 4 } } });
  });
  await Promise.all([repo.loadRegions('county'), repo.loadRegions('county')]);
  await repo.loadRegions('town', '09007');
  await repo.loadRegions('village', '09007010');
  assert.equal(repo.get(record.code).age65plus, 4);
  assert.equal(repo.get('missing'), null);
  assert.deepEqual(requested.map(url => url.split('/population/')[1]), [
    'manifest.json', '2026-08/counties.json', '2026-08/towns/09007.json', '2026-08/villages/09007010.json',
  ]);
  await assert.rejects(repo.loadRegions('village', '09007'), /Invalid population parent code/);
  await assert.rejects(repo.loadRegions('town', '../00'), /Invalid population parent code/);
});

test('Population map validation rejects wrong months and broken age sums before publishing records', async () => {
  let attempt = 0;
  const repo = new PopulationRepository('/population/', async url => {
    if (url.endsWith('/manifest.json')) return json(manifest);
    attempt++;
    return json({ schemaVersion: 1, period: attempt === 1 ? '2026-07' : '2026-08', level: 'village', parentCode: '09007010',
      records: { [record.code]: { ...record, age0to14: 3, age15to64: 16, age65plus: attempt === 2 ? 5 : 4 } } });
  });
  for (let i = 0; i < 2; i++) {
    await assert.rejects(repo.loadRegions('village', '09007010'), /Invalid population map summary/);
    assert.equal(repo.get(record.code), null);
  }
  await repo.loadRegions('village', '09007010');
  assert.equal(repo.get(record.code).age65plus, 4);
});
