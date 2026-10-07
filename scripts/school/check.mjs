import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { booleanPointInPolygon, point } from '@turf/turf';

const json = async file => JSON.parse(await readFile(new URL('../../'+file, import.meta.url),'utf8'));
const manifest = await json('public/data/school/manifest.json');
const ids = new Set();
const codes = new Set();
const counts = {schools:0,elementary:0,junior:0,withCatchment:0};
const sourceIds = new Set(manifest.sources.map(s=>s.id));
const towns = (await json('public/data/towns/63000.geojson')).features;
const villageCollections = new Map();
let crossTown=0, partial=0, shared=0;
for (const town of towns) {
  const schools = await json(`public/data/school/towns/${town.properties.code}.json`);
  for (const s of schools) {
    assert.equal(s.countyCode,'63000'); assert.equal(s.townCode,town.properties.code);
    assert.ok(!ids.has(s.id)); ids.add(s.id);
    assert.ok(['elementary','junior'].includes(s.level)); assert.ok(s.name);
    assert.ok(s.position?.length===2 && s.position.every(Number.isFinite));
    assert.ok(sourceIds.has(s.positionSource));
    assert.ok(booleanPointInPolygon(point(s.position),town),`School outside district: ${s.name}`);
    counts.schools++; counts[s.level]++;
    if (!s.catchment) continue;
    counts.withCatchment++;
    assert.equal(s.catchment.year,115); assert.ok(sourceIds.has(s.catchment.sourceId));
    assert.ok(!codes.has(s.code)); codes.add(s.code);
    assert.ok(s.catchment.villages.length>0);
    const villageCodes=new Set();
    for(const v of s.catchment.villages) {
      assert.ok(!villageCodes.has(v.code)); villageCodes.add(v.code);
      if(!villageCollections.has(v.townCode)) villageCollections.set(v.townCode, await json(`public/data/villages/${v.townCode}.geojson`));
      const feature=villageCollections.get(v.townCode).features.find(f=>f.properties.code===v.code);
      assert.ok(feature,`${s.name}: Missing village ${v.code}`); assert.equal(feature.properties.name,v.name);
      assert.equal(typeof v.partial,'boolean'); assert.equal(typeof v.shared,'boolean');
      if(v.townCode!==s.townCode) crossTown++;
      if(v.partial) partial++;
      if(v.shared) shared++;
    }
  }
}
assert.deepEqual(counts,manifest.counts);
assert.equal(counts.withCatchment,212);
assert.ok(partial>0&&shared>0&&crossTown>0);
const report=await json('public/data/school/join-report.json');
assert.deepEqual(report.unmatchedSchools,[]); assert.deepEqual(report.unmatchedVillages,[]);
console.log(`School data: ${counts.schools} records, ${counts.withCatchment} catchments; ${partial} partial, ${shared} shared, ${crossTown} cross-district village links verified.`);
