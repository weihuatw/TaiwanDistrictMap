import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Build town-sized reverse indexes so village cards can find schools across town boundaries. */
export async function writeVillageIndexes(schools, townCodes, root) {
  const byTown = new Map(townCodes.map(code => [code, new Map()]));
  for (const school of schools) {
    for (const village of school.catchment?.villages ?? []) {
      if (!/^\d{8}(?:\d{3}|[A-Z]\d{2})$/.test(village.code) || village.code.slice(0, 8) !== village.townCode || !byTown.has(village.townCode)) {
        throw new Error(`Invalid catchment village link for ${school.id}`);
      }
      const entries = byTown.get(village.townCode);
      const refs = entries.get(village.code) ?? [];
      if (!refs.some(ref => ref.id === school.id && ref.townCode === school.townCode)) {
        refs.push({ id: school.id, townCode: school.townCode });
        entries.set(village.code, refs);
      }
    }
  }
  const output = path.join(root, 'public/data/school/villages');
  await mkdir(output, { recursive: true });
  const current = await readdir(output);
  const expected = new Set(townCodes.map(code => `${code}.json`));
  await Promise.all(current.filter(file => file.endsWith('.json') && !expected.has(file)).map(file => rm(path.join(output, file))));
  for (const code of townCodes) {
    const villages = Object.fromEntries([...byTown.get(code).entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([villageCode, refs]) => [villageCode, refs.sort((a, b) => a.id.localeCompare(b.id))]));
    await writeFile(path.join(output, `${code}.json`), JSON.stringify({ townCode: code, villages }) + '\n');
  }
  return [...byTown.values()].reduce((sum, villages) => sum + villages.size, 0);
}
