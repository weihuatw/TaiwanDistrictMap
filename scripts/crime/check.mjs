import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { CrimeRepository } from '../../src/data/crime.ts';
const read = async p => JSON.parse(await fs.readFile(p, 'utf8'));
const repo = new CrimeRepository('public/data/crime/', async path => new Response(await fs.readFile(String(path))));
const counties = (await read('public/data/counties.geojson')).features.map(f => f.properties);
const towns = (await Promise.all(counties.map(async c => (await read(`public/data/towns/${c.code}.geojson`)).features.map(f => f.properties)))).flat();
const expected = await read('data/crime/expected-totals.json');
const index = await repo.index();
assert.equal(index.snapshots.length, 12);
for (const item of index.snapshots) {
  const d = await repo.snapshot(item.year, item.scope, item.period), rows = d.records, total = rows.TW;
  assert.equal(Object.keys(rows).length, item.scope === 'official' ? 23 : 391);
  const reviewed = expected[`${item.year}:${item.scope}:${item.period}`]; assert.ok(reviewed);
  assert.equal(total.cases.total, reviewed.cases);
  assert.equal(total.suspects?.total ?? null, reviewed.suspects);
  assert.equal(total.unassigned.total, reviewed.unassignedTown);
  assert.equal(total.unassigned['county:total'] ?? 0, reviewed.unassignedCounty);
  assert.ok(Math.abs(total.population - counties.reduce((s, c) => s + rows[c.code].population, 0)) < .01);
  assert.ok(Array.isArray(d.sources) && d.sources.length > 0);
  for (const source of d.sources) assert.match(source.sha256, /^[a-f0-9]{64}$/);
  for (const category of d.categories) {
    const countySum = counties.reduce((s, c) => s + rows[c.code].cases[category], 0);
    if (item.scope === 'official') {
      assert.equal(total.cases[category], countySum + total.unassigned[`cases:${category}`]);
      assert.equal(total.suspects[category], counties.reduce((s, c) => s + rows[c.code].suspects[category], 0) + total.unassigned[`suspects:${category}`]);
    } else {
      assert.equal(total.cases[category], countySum + (total.unassigned[`county:${category}`] ?? 0));
      assert.equal(total.unassigned[category], counties.reduce((s, c) => s + rows[c.code].unassigned[category], 0) + (total.unassigned[`county:${category}`] ?? 0));
      for (const c of counties) {
        const children = towns.filter(t => t.countyCode === c.code);
        assert.equal(rows[c.code].cases[category], children.reduce((s, t) => s + rows[t.code].cases[category], 0) + rows[c.code].unassigned[category]);
        assert.ok(Math.abs(rows[c.code].population - children.reduce((s, t) => s + rows[t.code].population, 0)) < .01);
      }
    }
  }
  if (item.scope === 'regional') for (const r of Object.values(rows)) assert.equal(r.cases.total, d.categories.filter(c => c !== 'total').reduce((s, c) => s + r.cases[c], 0));
  // Published output contains only region aggregates; no event arrays, dates, addresses or point coordinates.
  for (const r of Object.values(rows)) assert.deepEqual(Object.keys(r).sort(), ['cases','code',...(Object.hasOwn(r, 'countyCode') ? ['countyCode'] : []),'name','population','suspects','unassigned'].sort());
  console.log(`${item.year} ${item.scope} ${item.period}: 1–${d.endMonth} 月，${total.cases.total.toLocaleString()} 件；地域／案類加總與人口分母通過`);
}
