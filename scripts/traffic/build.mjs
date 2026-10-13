import fs from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import { booleanPointInPolygon, bbox } from '@turf/turf';
import { addressRegions, assignRegions } from './spatial.mjs';

const read = async p => JSON.parse(await fs.readFile(p, 'utf8'));
const write = async (p, d) => { await fs.mkdir(p.slice(0, p.lastIndexOf('/')), { recursive: true }); await fs.writeFile(p, JSON.stringify(d) + '\n'); };
const counties = (await read('public/data/counties.geojson')).features;
const towns = [], villages = [];
for (const c of counties) towns.push(...(await read(`public/data/towns/${c.properties.code}.geojson`)).features);
for (const t of towns) villages.push(...(await read(`public/data/villages/${t.properties.code}.geojson`)).features);

// A spatial grid limits point-in-polygon checks. No nearest-polygon allocation.
function index(features) {
  const cells = new Map();
  for (const feature of features) {
    const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const coordinates of polygons) {
      const polygon = { type: 'Feature', properties: feature.properties, geometry: { type: 'Polygon', coordinates } };
      const b = bbox(polygon);
      for (let x = Math.floor(Math.max(118, b[0]) * 50); x <= Math.floor(Math.min(123, b[2]) * 50); x++) {
        for (let y = Math.floor(Math.max(21, b[1]) * 50); y <= Math.floor(Math.min(27, b[3]) * 50); y++) {
          const key = `${x}:${y}`; if (!cells.has(key)) cells.set(key, []); cells.get(key).push(polygon);
        }
      }
    }
  }
  return point => {
    if (!point) return [];
    const candidates = cells.get(`${Math.floor(point[0] * 50)}:${Math.floor(point[1] * 50)}`) ?? [];
    return [...new Map(candidates.filter(p => booleanPointInPolygon(point, p)).map(p => [p.properties.code, p.properties])).values()];
  };
}
const countyProperties = counties.map(c => c.properties), townProperties = towns.map(t => t.properties);
const findVillage = index(villages), findTown = index(towns), findCounty = index(counties);
const sources = (await read('data/traffic/sources.json')).resources;
const years = [];
const fields = ['accidents', 'injuries', 'deaths', 'located', 'villageAssigned'];
for (const year of [2024, 2025, 2026]) {
  const input = await read(`data/build/traffic/${year}.json`);
  const population = new Map();
  const populationLabel = year === 2026 ? '2026 年 8 月戶籍人口' : `${year} 年兩年底平均戶籍人口`;
  if (year === 2026) {
    const folder = 'public/data/population/2026-08';
    for (const p of [`${folder}/counties.json`, ...counties.map(c => `${folder}/towns/${c.properties.code}.json`), ...towns.map(t => `${folder}/villages/${t.properties.code}.json`)]) {
      for (const [code, r] of Object.entries((await read(p)).records)) population.set(code, r.population);
    }
    population.set('TW', (await read(`${folder}/national.json`)).record.population);
  } else {
    const folder = `public/data/population/annual/${year}`;
    for (const p of [`${folder}/counties.json`, ...counties.map(c => `${folder}/towns/${c.properties.code}.json`), ...towns.map(t => `${folder}/villages/${t.properties.code}.json`)]) {
      for (const [code, r] of Object.entries((await read(p)).records)) population.set(code, r.meanPopulation);
    }
    population.set('TW', (await read(`${folder}/national.json`)).record.meanPopulation);
  }
  const make = p => ({ code: p.code, name: p.name, countyCode: p.countyCode, townCode: p.townCode,
    accidents: 0, injuries: 0, deaths: 0, located: 0, villageAssigned: 0, population: population.get(p.code) ?? null });
  const records = new Map([...counties, ...towns, ...villages].map(f => [f.properties.code, make(f.properties)]));
  const national = make({ code: 'TW', name: '全臺' });
  const eventShards = new Map(counties.map(c => [c.properties.code, []]));
  const report = { sourceEvents: input.events.length, invalidCoordinates: 0, noCounty: 0, noTown: 0, noVillage: 0,
    ambiguousVillage: 0, addressCoordinateTownMismatch: 0, addressCoordinateCountyMismatch: 0,
    rejectedCoordinates: 0, coordinateConflictsByVillage: {}, unassigned: {}, sourceEndDates: input.sourceEndDates,
    sourceMonths: input.sourceMonths, excludedOutsideCommonMonths: input.excludedOutsideCommonMonths };
  const unresolved = [];
  let counter = 0;
  for (const e of input.events) {
    const address = addressRegions(e.location, countyProperties, townProperties);
    const hits = findVillage(e.coordinates);
    const th = hits.length === 1 ? [] : findTown(e.coordinates);
    const ch = hits.length || th.length === 1 ? [] : findCounty(e.coordinates);
    const assignment = assignRegions({ coordinates: e.coordinates, address, villageHits: hits, townHits: th, countyHits: ch });
    const { countyCode, townCode, villageCode, coordinates } = assignment;
    if (assignment.ambiguousVillage) report.ambiguousVillage++;
    if (assignment.townMismatch) report.addressCoordinateTownMismatch++;
    if (assignment.countyMismatch) report.addressCoordinateCountyMismatch++;
    if (assignment.coordinateConflict) {
      report.rejectedCoordinates++;
      const code = assignment.spatialVillageCode;
      if (code) report.coordinateConflictsByVillage[code] = (report.coordinateConflictsByVillage[code] ?? 0) + 1;
    }
    if (!e.coordinates) report.invalidCoordinates++;
    if (!countyCode) report.noCounty++;
    if (!townCode) report.noTown++;
    if (!villageCode) report.noVillage++;
    const codes = [countyCode, townCode, villageCode].filter(Boolean);
    for (const r of [national, ...codes.map(code => records.get(code))]) {
      r.accidents++; r.injuries += e.injuries; r.deaths += e.deaths;
      if (coordinates) r.located++;
      if (villageCode) r.villageAssigned++;
    }
    if (countyCode && coordinates) eventShards.get(countyCode).push([e.id, ...coordinates, e.date, e.time, e.type, e.deaths, e.injuries, townCode, villageCode, e.location]);
    if (!villageCode) unresolved.push({ id: e.id, coordinates: e.coordinates, location: e.location, countyCode, townCode,
      reason: assignment.coordinateConflict ? 'address-coordinate-conflict' : !e.coordinates ? 'invalid-coordinates' : 'no-unique-village',
      ...(assignment.coordinateConflict ? { spatialCountyCode: assignment.spatialCountyCode, spatialTownCode: assignment.spatialTownCode, spatialVillageCode: assignment.spatialVillageCode } : {}) });
    if (++counter % 100000 === 0) console.log(year, counter);
  }
  const folder = `public/data/traffic/${year}`;
  const shard = (level, rows, parentCode) => ({ schemaVersion: 1, year, level, ...(parentCode ? { parentCode } : {}), records: Object.fromEntries(rows.map(p => [p.code, records.get(p.code)])) });
  await write(`${folder}/counties.json`, shard('county', counties.map(c => c.properties)));
  for (const c of counties) {
    await write(`${folder}/towns/${c.properties.code}.json`, shard('town', towns.filter(t => t.properties.countyCode === c.properties.code).map(t => t.properties), c.properties.code));
    const eventPath=`${folder}/events/${c.properties.code}.json`;
    await fs.mkdir(`${folder}/events`,{recursive:true});
    await fs.writeFile(eventPath+'.gz',gzipSync(JSON.stringify({schemaVersion:1,year,countyCode:c.properties.code,events:eventShards.get(c.properties.code)}),{level:9}));
    await fs.unlink(eventPath).catch(error=>{if(error.code!=='ENOENT')throw error});
  }
  for (const t of towns) await write(`${folder}/villages/${t.properties.code}.json`, shard('village', villages.filter(v => v.properties.townCode === t.properties.code).map(v => v.properties), t.properties.code));
  await write(`${folder}/national.json`, { schemaVersion: 1, year, record: national });
  for (const r of [national, ...counties.map(c => records.get(c.properties.code)), ...towns.map(t => records.get(t.properties.code))]) {
    const children = r.code === 'TW' ? counties : r.code.length === 5 ? towns.filter(t => t.properties.countyCode === r.code) : villages.filter(v => v.properties.townCode === r.code);
    const totals = Object.fromEntries(fields.map(f => [f, children.reduce((sum, c) => sum + records.get(c.properties.code)[f], 0)]));
    report.unassigned[r.code] = Object.fromEntries(fields.map(f => [f, r[f] - totals[f]]));
  }
  await write(`${folder}/join-report.json`, report);
  await write(`${folder}/unmatched.json`, unresolved);
  const meta = { schemaVersion: 1, year, months: input.months.map(m => Number(m.slice(4))), complete: input.months.length === 12,
    populationLabel, rateScale: 100000, sourceUrls: [...new Set(sources.filter(s => s.year === year).map(s => s.catalogUrl))],
    totals: national, report: `${year}/join-report.json` };
  await write(`${folder}/manifest.json`, meta);
  years.push({ year, months: meta.months, complete: meta.complete, populationLabel });
  console.log(year, JSON.stringify({ ...report, unassigned: undefined, coordinateConflictsByVillage: undefined }));
}
await write('public/data/traffic/manifest.json', { schemaVersion: 1, years: years.reverse(), eventFields: ['id', 'longitude', 'latitude', 'date', 'time', 'type', 'deaths', 'injuries', 'townCode', 'villageCode', 'location'] });
