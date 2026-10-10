import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PoliticsRepository, politicalPath, validatePart } from '../src/apps/politics/data.ts';
import { availableModes, defaultMode, modeForLevel, winners, recordParty, recordColor, recordMissing, recordLabel, recordLabelStyle, TIE_COLOR, MISSING_COLOR } from '../src/apps/politics/theme.ts';
const manifest = JSON.parse(await readFile(new URL('../public/data/politics/manifest.json', import.meta.url)));
const part = JSON.parse(await readFile(new URL(`../public/data/politics/${manifest.paths.president}villages/63000080.json`, import.meta.url)));
const official = JSON.parse(await readFile(new URL(`../public/data/politics/${manifest.paths.officials}villages/63000080.json`, import.meta.url)));
const code = Object.keys(part.records)[0];
const response = value => ({ ok: true, json: async () => structuredClone(value) });

test('politics uses safe boundary paths and preserves leading zero codes', () => {
  assert.equal(politicalPath('villages/09007010.geojson'), 'villages/09007010.json');
  assert.throws(() => politicalPath('../counties.geojson'));
  assert.throws(() => politicalPath('towns/9007.geojson'));
  assert.equal(defaultMode('county'), 'officials'); assert.equal(defaultMode('town'), 'mayor'); assert.equal(defaultMode('village'), 'officials');
  assert.deepEqual(availableModes('county'), ['officials','mayor','president']);
  assert.deepEqual(availableModes('town'), ['mayor','president']);
  assert.deepEqual(availableModes('village'), ['officials','mayor','president']);
  assert.equal(modeForLevel('town', 'president', 'mayor'), 'president');
  assert.equal(modeForLevel('county', 'president', 'officials'), 'president');
  assert.equal(modeForLevel('county', 'mayor', 'officials'), 'mayor');
  assert.equal(modeForLevel('town', 'officials', undefined), 'mayor');
});
test('national mayor and presidential modes have a winner record for every county', async () => {
  for (const mode of ['mayor','president']) {
    const folder = manifest.paths[mode];
    const shard = JSON.parse(await readFile(new URL(`../public/data/politics/${folder}counties.json`, import.meta.url)));
    assert.equal(Object.keys(shard.records).length, 22);
    assert.ok(Object.values(shard.records).every(r => r.level === 'county' && winners(r.candidates).length > 0));
  }
  const mayor = JSON.parse(await readFile(new URL(`../public/data/politics/${manifest.paths.mayor}counties.json`, import.meta.url)));
  assert.equal(mayor.records['10020'].date, '2022-12-18');
});
test('winner comparison treats independent candidates separately and marks ties/zero ballots', () => {
  const candidates = [{ id:'1',number:1,name:'甲',party:'A',votes:10 },{ id:'2',number:2,name:'乙',party:'無黨籍及未經政黨推薦',votes:6 },{ id:'3',number:3,name:'丙',party:'無黨籍及未經政黨推薦',votes:6 }];
  const record = { ...part.records[code], candidates, validVotes:22 };
  assert.equal(recordParty(record), 'A'); // 6+6 must not become one independent party.
  assert.equal(recordColor(record, { A:'#123456' }), '#123456');
  candidates[1].votes = 10;
  assert.equal(winners(candidates).length, 2); assert.equal(recordColor(record, {}), TIE_COLOR); assert.equal(recordLabel(record), '最高票並列');
  candidates.forEach(c => c.votes = 0); assert.equal(recordMissing(record), true); assert.equal(recordColor(record, {}), MISSING_COLOR);
});
test('pooled ballots and missing party stay unknown; explicit independent remains valid', () => {
  const partial = { ...part.records[code], partialReason:'部分票數合併列示' };
  assert.equal(recordMissing(partial), true); assert.equal(recordParty(partial), null); assert.equal(recordColor(partial, {}), MISSING_COLOR);
  const r = { ...official.records[code], name:'甲', party:'無黨籍' };
  assert.equal(recordMissing(r), false); assert.equal(recordColor(r, { '無黨籍':'#8a929c' }), '#8a929c');
  r.party = null; assert.equal(recordMissing(r), true);
  r.status = 'conflicting-roster'; r.name = null; assert.equal(recordLabel(r), '名錄待查證');
});
test('party label fills use readable foregrounds and distinguish independents and ties', () => {
  const winner = party => ({ ...part.records[code], candidates: [
    { id:'1', number:1, name:'甲', party, votes:10 },
    { id:'2', number:2, name:'乙', party:'其他黨', votes:1 },
  ], validVotes:11 });
  assert.deepEqual(recordLabelStyle(winner('中國國民黨'), {}), { backgroundColor:'#376bb3', textColor:'#ffffff' });
  assert.deepEqual(recordLabelStyle(winner('民主進步黨'), {}), { backgroundColor:'#407c55', textColor:'#ffffff' });
  assert.deepEqual(recordLabelStyle(winner('台灣民眾黨'), {}), { backgroundColor:'#51aeb4', textColor:'#17363a' });
  assert.deepEqual(recordLabelStyle(winner('無黨籍及未經政黨推薦'), {}), { backgroundColor:'#e4e7eb', textColor:'#17363a' });
  assert.deepEqual(recordLabelStyle(winner('時代力量'), { '時代力量':'#f2cb0d' }), { backgroundColor:'#f2cb0d', textColor:'#17363a' });
  assert.deepEqual(recordLabelStyle({ ...winner('中國國民黨'), candidates: [
    { id:'1', number:1, name:'甲', party:'中國國民黨', votes:10 },
    { id:'2', number:2, name:'乙', party:'民主進步黨', votes:10 },
  ], validVotes:20 }, {}), { backgroundColor:'#795f95', textColor:'#ffffff' });
  assert.equal(recordLabelStyle({ ...winner('中國國民黨'), partialReason:'合併票數' }, {}), null);
});
test('politics repositories coalesce requests, isolate modes, and use project base', async () => {
  const calls = [];
  const repository = new PoliticsRepository('/TaiwanDistrictMap/data/politics/', async (url, init) => {
    calls.push(url); assert.ok(init.signal); return response(url.endsWith('manifest.json') ? manifest : url.includes('/officials/') ? official : part);
  });
  await Promise.all([repository.load('president','villages/63000080.geojson'),repository.load('president','villages/63000080.geojson')]);
  assert.equal(calls.length,2); assert.equal(calls[1],'/TaiwanDistrictMap/data/politics/president/2024/villages/63000080.json');
  await repository.load('officials','villages/63000080.geojson');
  assert.ok('candidates' in repository.get('president',code)); assert.ok('party' in repository.get('officials',code));
  assert.equal(repository.get('mayor',code),null);
});
test('failed/malformed shards evict cache and never commit partial records', async () => {
  let attempt = 0;
  const repository = new PoliticsRepository('/data/politics/', async url => {
    if (url.endsWith('manifest.json')) return response(manifest);
    attempt++;
    if (attempt === 1) return { ok:false };
    if (attempt === 2) { const invalid = structuredClone(part); invalid.records[code].validVotes++; return response(invalid); }
    return response(part);
  });
  await assert.rejects(repository.load('president','villages/63000080.geojson'));
  await assert.rejects(repository.load('president','villages/63000080.geojson'));
  assert.equal(repository.get('president',code),null);
  await repository.load('president','villages/63000080.geojson'); assert.equal(attempt,3);
});
test('manifest failure retries and unsafe manifest path is rejected', async () => {
  let n = 0;
  const repository = new PoliticsRepository('/data/politics/', async () => {
    n++; const m = structuredClone(manifest); if (n === 1) m.paths.president='../'; return response(m);
  });
  await assert.rejects(repository.manifest()); await repository.manifest(); assert.equal(n,2);
});
test('published shards reject wrong parents, duplicate candidate numbers, and wrong elections', () => {
  for (const mutate of [p => { p.parentCode = '09007010'; }, p => { p.records[code].candidates.push(p.records[code].candidates[0]); }, p => { p.records[code].electionId = 'county-2022'; }]) {
    const p = structuredClone(part); mutate(p); assert.throws(() => validatePart(p,'president','villages/63000080.json','2024'));
  }
});
