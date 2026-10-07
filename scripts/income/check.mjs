import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '../..');
const base = resolve(root, 'public/data/income/2024');
const load = async (path) => JSON.parse(await readFile(path, 'utf8'));
const manifest = await load(resolve(base, 'manifest.json'));
const report = await load(resolve(base, 'join-report.json'));
assert.equal(manifest.year, 2024); assert.equal(manifest.status, 'preliminary');
assert.equal(manifest.metric, '綜合所得總額');
assert.equal(report.reconciliations.length, 22);
for (const r of report.reconciliations) {
  assert.equal(r.taxUnits, r.officialTaxUnits);
  assert(Math.abs(r.incomeTotalK - r.officialIncomeTotalK) <= r.roundingToleranceK);
}
const totals = { county: 0, town: 0, village: 0 };
const mapped = new Map();
const county = await load(resolve(base, 'counties.json'));
const geometries = await load(resolve(root, 'public/data/counties.geojson'));
let nationalUnits = 0; let nationalIncome = 0; let mappedUnits = 0; let zeroUnitVillages = 0;
function check(part, geometry, level, parent = null) {
  assert.equal(part.year, 2024); assert.equal(part.level, level); assert.equal(part.parentCode, parent);
  const features = new Map(geometry.features.map((f) => [f.properties.code, f]));
  for (const [code, r] of Object.entries(part.records)) {
    assert.equal(code, r.code); assert.equal(typeof code, 'string'); assert.equal(r.level, level);
    const region = features.get(code); assert(region, `No polygon for ${code}`);
    assert.equal(r.name, region.properties.name); assert.equal(r.countyCode, region.properties.countyCode);
    if (level !== 'county') assert.equal(r.townCode, region.properties.townCode);
    assert(Number.isSafeInteger(r.taxUnits) && r.taxUnits >= 0); assert(Number.isFinite(r.incomeTotalK));
    if (r.taxUnits) assert.equal(r.meanK, r.incomeTotalK / r.taxUnits);
    else { assert.equal(r.meanK, null); if (level === 'village') zeroUnitVillages++; }
    if (r.meanK !== null && r.reportedMeanK !== null) assert(Math.abs(r.meanK - r.reportedMeanK) <= 1.01);
    assert(!mapped.has(code)); mapped.set(code, r); totals[level]++;
    if (level === 'village') mappedUnits += r.taxUnits;
  }
}
check(county, geometries, 'county');
for (const r of Object.values(county.records)) { nationalUnits += r.taxUnits; nationalIncome += r.incomeTotalK; }
for (const c of geometries.features) {
  const code = c.properties.code;
  const towns = await load(resolve(root, `public/data/towns/${code}.geojson`));
  const townPart = await load(resolve(base, `towns/${code}.json`));
  check(townPart, towns, 'town', code);
  assert.equal(Object.keys(townPart.records).length, towns.features.length);
  for (const town of towns.features) {
    const villages = await load(resolve(root, `public/data/villages/${town.properties.code}.geojson`));
    check(await load(resolve(base, `villages/${town.properties.code}.json`)), villages, 'village', town.properties.code);
  }
}
assert.equal((await readdir(resolve(base, 'towns'))).length, 22);
assert.equal((await readdir(resolve(base, 'villages'))).length, 368);
assert.deepEqual(totals, { county: manifest.counts.county, town: manifest.counts.town, village: manifest.counts.village });
assert.equal(nationalUnits, manifest.national.taxUnits); assert.equal(nationalIncome, manifest.national.incomeTotalK);
assert.equal(manifest.national.meanK, nationalIncome / nationalUnits);
assert.equal(mappedUnits, manifest.coverage.mappedTaxUnits);
assert.equal(report.missingBoundaries.length, manifest.coverage.missingNamedBoundaries);
assert.equal(report.unmatched.filter((r) => r.level === 'village' && r.kind === 'unmatched').length, manifest.coverage.unmatchedNamedVillages);
const boundaries = await load(resolve(root, 'public/data/manifest.json'));
for (const source of manifest.boundarySources) assert.equal(source.releaseFile, boundaries.sources.find((s) => s.level === source.level).releaseFile);
console.log(`Verified 2024 preliminary income: ${totals.county} counties, ${totals.town} towns, ${totals.village} matched villages.`);
console.log(`All 22 county tax-unit totals reconciled; ${zeroUnitVillages} zero-unit villages remain null.`);
console.log(`Mapped taxpayer coverage ${(mappedUnits / nationalUnits * 100).toFixed(2)}%; ${manifest.coverage.missingNamedBoundaries} named polygons without a 2024 match.`);
