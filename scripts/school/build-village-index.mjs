import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeVillageIndexes } from './village-index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const json = async file => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const counties = (await json('public/data/counties.geojson')).features;
const towns = (await Promise.all(counties.map(c => json(`public/data/towns/${c.properties.code}.geojson`)))).flatMap(data => data.features);
const schools = (await Promise.all(towns.map(t => json(`public/data/school/towns/${t.properties.code}.json`)))).flat();
const villages = await writeVillageIndexes(schools, towns.map(t => t.properties.code), root);
console.log(`School village indexes: ${villages.toLocaleString()} village entries across ${towns.length} town files.`);
