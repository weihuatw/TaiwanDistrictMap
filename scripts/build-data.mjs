import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, rename, rm, readdir, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { colorRegions, geometryBounds, focusBounds } from '../src/geometry.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releases = JSON.parse(await readFile(path.join(root, 'data/sources.json'), 'utf8'));
const staging = path.join(root, 'data/build');
await mkdir(staging, { recursive: true });
const levels = {
  county: { code: 'COUNTYCODE', name: 'COUNTYNAME', tolerance: 90 },
  town: { code: 'TOWNCODE', name: 'TOWNNAME', tolerance: 35 },
  village: { code: 'VILLCODE', name: 'VILLNAME', tolerance: 10 },
};
const collections = {};

for (const release of releases) {
  const config = levels[release.level];
  const destination = path.join(staging, `${release.level}.geojson`);
  const run = spawnSync(path.join(root, 'node_modules/.bin/mapshaper'), [
    '-i', path.join(root, release.shapefile),
    '-proj', 'wgs84',
    '-simplify', 'dp', `interval=${config.tolerance}`, 'keep-shapes',
    '-each', 'labelX=$.innerX;labelY=$.innerY',
    '-o', destination, 'format=geojson', 'precision=0.000001', 'force',
  ], { stdio: 'inherit' });
  if (run.status !== 0) throw new Error(`Conversion failed for ${release.level}`);
  const source = JSON.parse(await readFile(destination, 'utf8'));
  const seen = new Set();
  const features = source.features.map((feature) => {
    const p = feature.properties;
    const code = String(p[config.code] ?? '').trim();
    if (!code || seen.has(code)) throw new Error(`Missing/duplicate ${release.level} code: ${code}`);
    seen.add(code);
    if (!feature.geometry) throw new Error(`Empty geometry: ${code}`);
    const bounds = geometryBounds(feature.geometry);
    return {
      type: 'Feature', id: code, geometry: feature.geometry,
      properties: {
        code,
        name: String(p[config.name] ?? '').trim() || '未編定村里',
        countyCode: String(p.COUNTYCODE),
        countyName: p.COUNTYNAME,
        ...(release.level !== 'county' ? { townCode: String(p.TOWNCODE), townName: p.TOWNNAME } : {}),
        level: release.level,
        unassigned: release.level === 'village' && !String(p.VILLNAME ?? '').trim(),
        note: String(p.NOTE ?? '').trim(),
        label: [p.labelX, p.labelY],
        bounds,
        focusBounds: focusBounds(feature.geometry),
      },
    };
  }).sort((a, b) => a.properties.code.localeCompare(b.properties.code));
  colorRegions(features);
  collections[release.level] = { type: 'FeatureCollection', features };
  console.log(`${release.level}: ${features.length} regions`);
}

const countyIds = new Set(collections.county.features.map((f) => f.id));
const townIds = new Set(collections.town.features.map((f) => f.id));
for (const town of collections.town.features) {
  if (!countyIds.has(town.properties.countyCode)) throw new Error(`Orphan town: ${town.id}`);
  town.properties.childCount = collections.village.features.filter((f) => f.properties.townCode === town.id).length;
}
for (const village of collections.village.features) {
  if (!townIds.has(village.properties.townCode)) throw new Error(`Orphan village: ${village.id}`);
}
for (const county of collections.county.features) {
  county.properties.childCount = collections.town.features.filter((f) => f.properties.countyCode === county.id).length;
}

// Build into a fresh staging folder and publish only after all conversions succeed.
const next = path.join(root, 'public/data.next');
await rm(next, { recursive: true, force: true });
await mkdir(path.join(next, 'towns'), { recursive: true });
await mkdir(path.join(next, 'villages'), { recursive: true });
const save = (name, value) => writeFile(path.join(next, name), JSON.stringify(value) + '\n');
await save('counties.geojson', collections.county);
for (const county of collections.county.features) {
  await save(`towns/${county.id}.geojson`, {
    type: 'FeatureCollection',
    features: collections.town.features.filter((f) => f.properties.countyCode === county.id),
  });
}
for (const town of collections.town.features) {
  await save(`villages/${town.id}.geojson`, {
    type: 'FeatureCollection',
    features: collections.village.features.filter((f) => f.properties.townCode === town.id),
  });
}
const manifest = {
  schemaVersion: 1,
  builtAt: new Date().toISOString(),
  counts: Object.fromEntries(Object.entries(collections).map(([level, data]) => [level, data.features.length])),
  unassignedCount: collections.village.features.filter((f) => f.properties.unassigned).length,
  sources: releases.map(({ shapefile, supplementaryFiles, ...source }) => ({
    ...source,
    supplementaryFiles: supplementaryFiles.map((file) => path.basename(file)),
  })),
  simplificationMeters: Object.fromEntries(Object.entries(levels).map(([level, spec]) => [level, spec.tolerance])),
  notes: [
    '使用官方全國主圖層；官方另附的瑪家鄉／三和村補充圖層與主圖層有重疊，保留原檔但未混入展示圖層。',
    '詮釋資料更新日期不代表全部界線的生效日期；資料版本以來源檔名標示。',
    '圖形經拓樸共邊簡化供地圖展示，原始 SHP 與下載雜湊另存。',
    '全台與縣市預設視野聚焦本島及臺灣周邊離島，遠方島嶼可由村里清單直接選取。',
  ],
};
await save('manifest.json', manifest);
// Boundary rebuilds own these four entries; preserve independently built themes.
const owned = new Set(['counties.geojson', 'towns', 'villages', 'manifest.json']);
const currentData = path.join(root, 'public/data');
let entries = [];
try { entries = await readdir(currentData); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
for (const name of entries) {
  if (!owned.has(name)) await cp(path.join(currentData, name), path.join(next, name), { recursive: true });
}
await rm(path.join(root, 'public/data'), { recursive: true, force: true });
await rename(next, path.join(root, 'public/data'));
console.log(`Published ${manifest.counts.county} counties, ${manifest.counts.town} towns, ${manifest.counts.village} village features.`);
