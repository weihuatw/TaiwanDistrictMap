import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { booleanPointInPolygon, point } from '@turf/turf';
import { geometryBounds } from '../src/geometry.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/data');
const load = async (name) => JSON.parse(await readFile(path.join(root, name), 'utf8'));
const manifest = await load('manifest.json');
const counties = await load('counties.geojson');
const countiesByCode = new Map(counties.features.map((f) => [f.id, f]));
assert.equal(counties.features.length, 22, 'All 22 counties must be present');
const townIds = new Set(); const villageIds = new Set();
let townCount = 0; let villageCount = 0; let unassigned = 0;
let maxVillageBytes = 0;

function check(collection, level, parent) {
  assert.equal(collection.type, 'FeatureCollection');
  const ids = new Set();
  for (const f of collection.features) {
    assert.equal(f.id, f.properties.code);
    assert.equal(typeof f.id, 'string');
    assert(!ids.has(f.id), `Duplicate ID: ${f.id}`); ids.add(f.id);
    assert.equal(f.properties.level, level);
    assert(f.properties.name.trim());
    assert(/^#[0-9a-f]{6}$/i.test(f.properties.color));
    assert(f.properties.label.every(Number.isFinite), `Invalid label: ${f.id}`);
    assert(booleanPointInPolygon(point(f.properties.label), f), `Label outside region: ${f.id}`);
    if (level === 'town') assert.equal(f.properties.countyCode, parent);
    if (level === 'village') assert.equal(f.properties.townCode, parent);
    const bounds = geometryBounds(f.geometry);
    assert.deepEqual(bounds, f.properties.bounds);
    assert(bounds[0] >= -180 && bounds[2] <= 180 && bounds[1] >= -90 && bounds[3] <= 90);
    const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    assert(['Polygon', 'MultiPolygon'].includes(f.geometry.type));
    for (const polygon of polygons) for (const ring of polygon) {
      assert(ring.length >= 4, `Collapsed ring: ${f.id}`);
      assert.deepEqual(ring[0], ring.at(-1), `Unclosed ring: ${f.id}`);
      for (const position of ring) assert(position.every(Number.isFinite));
    }
  }
}

check(counties, 'county');
for (const county of counties.features) {
  const towns = await load(`towns/${county.id}.geojson`);
  check(towns, 'town', county.id);
  assert.equal(towns.features.length, county.properties.childCount);
  for (const town of towns.features) {
    assert(!townIds.has(town.id)); townIds.add(town.id); townCount++;
    const villages = await load(`villages/${town.id}.geojson`);
    check(villages, 'village', town.id);
    assert.equal(villages.features.length, town.properties.childCount);
    maxVillageBytes = Math.max(maxVillageBytes, JSON.stringify(villages).length);
    for (const village of villages.features) {
      assert(!villageIds.has(village.id)); villageIds.add(village.id); villageCount++;
      assert(countiesByCode.has(village.properties.countyCode));
      assert.equal(village.properties.countyCode, county.id);
      if (village.properties.unassigned) unassigned++;
    }
  }
}
assert.equal(townCount, manifest.counts.town);
assert.equal(villageCount, manifest.counts.village);
assert.equal(unassigned, manifest.unassignedCount);
assert.equal((await readdir(path.join(root, 'towns'))).length, 22);
assert.equal((await readdir(path.join(root, 'villages'))).length, townCount);
console.log(`Verified ${counties.features.length} counties, ${townCount} towns, ${villageCount} village features (${unassigned} unassigned).`);
console.log(`Largest township village file: ${(maxVillageBytes / 1024).toFixed(0)} KiB.`);
