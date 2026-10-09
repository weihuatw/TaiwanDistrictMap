import type { BoundaryRepository } from '../../map-core/boundaries';
import type { Regions } from '../../map-core/types';
import type { School, SchoolManifest, SchoolLevel } from './types';

export function filterSchools(schools: School[], filter: Record<SchoolLevel, boolean>) {
  return schools.filter(school => filter[school.level]);
}

/** Missing catchment and an empty published catchment are distinct states. */
export class SchoolRepository {
  private root: string;
  private cache = new Map<string, School[]>();
  private fetcher: typeof fetch;
  private villageIndexes = new Map<string, Promise<Record<string, { id: string; townCode: string }[]>>>();
  private villageSchools = new Map<string, Promise<School[]>>();
  private manifestRequest?: Promise<SchoolManifest>;
  constructor(root: string, fetcher: typeof fetch = (input, init) => fetch(input, init)) {
    this.root = root.endsWith('/') ? root : `${root}/`; this.fetcher = fetcher;
  }
  async load(townCode: string): Promise<School[]> {
    if (!/^\d{8}$/.test(townCode)) throw new Error('Invalid town code');
    if (this.cache.has(townCode)) return this.cache.get(townCode)!;
    const response = await this.fetcher(`${this.root}towns/${townCode}.json`, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error('School data request failed');
    const data: School[] = await response.json();
    if (!Array.isArray(data) || data.some(s => s.townCode !== townCode || !['elementary', 'junior'].includes(s.level) || !s.id || !s.name)) throw new Error('Invalid school data');
    this.cache.set(townCode, data); return data;
  }
  async catchment(school: School, boundaries: Pick<BoundaryRepository, 'load'>): Promise<Regions> {
    if (!school.catchment) return { type: 'FeatureCollection', features: [] };
    const townCodes = [...new Set(school.catchment.villages.map(v => v.townCode))];
    const codes = new Set(school.catchment.villages.map(v => v.code));
    const geometry = await Promise.all(townCodes.map(code => boundaries.load(`villages/${code}.geojson`)));
    const features = geometry.flatMap(g => g.features).filter(v => codes.has(v.properties.code));
    if (features.length !== codes.size) throw new Error('Catchment boundaries incomplete');
    return { type: 'FeatureCollection', features };
  }
  async schoolsForVillage(villageCode: string): Promise<School[]> {
    if (!/^\d{8}(?:\d{3}|[A-Z]\d{2})$/.test(villageCode)) throw new Error('Invalid village code');
    if (!this.villageSchools.has(villageCode)) this.villageSchools.set(villageCode, (async () => {
      const townCode = villageCode.slice(0, 8);
      const manifest = await this.manifest();
      const indexPath = manifest.villageIndex ?? 'villages/{townCode}.json';
      const file = indexPath.replace('{townCode}', townCode);
      if (file === indexPath || file.startsWith('/') || file.split('/').includes('..')) throw new Error('Invalid school village index path');
      const indexKey = townCode;
      if (!this.villageIndexes.has(indexKey)) this.villageIndexes.set(indexKey, (async () => {
        const response = await this.fetcher(`${this.root}${file}`, { signal: AbortSignal.timeout(20_000) });
        if (!response.ok) throw new Error('School village index unavailable');
        const data: { townCode: string; villages: Record<string, { id: string; townCode: string }[]> } = await response.json();
        if (data.townCode !== townCode || !data.villages || Array.isArray(data.villages)) throw new Error('Invalid school village index');
        for (const [code, refs] of Object.entries(data.villages)) {
          if (!/^\d{8}(?:\d{3}|[A-Z]\d{2})$/.test(code) || code.slice(0, 8) !== townCode || !Array.isArray(refs)
            || refs.some(ref => !ref || typeof ref.id !== 'string' || !/^\d{8}$/.test(ref.townCode))) {
            throw new Error('Invalid school village index entry');
          }
        }
        return data.villages;
      })());
      let villages: Record<string, { id: string; townCode: string }[]>;
      try { villages = await this.villageIndexes.get(indexKey)!; }
      catch (error) { this.villageIndexes.delete(indexKey); throw error; }
      const refs = villages[villageCode] ?? [];
      const townCodes = [...new Set(refs.map(ref => ref.townCode))];
      const shards = await Promise.all(townCodes.map(code => this.load(code)));
      const ids = new Set(refs.map(ref => ref.id));
      const matches = shards.flat().filter(school => ids.has(school.id)
        && school.catchment?.villages.some(village => village.code === villageCode));
      if (matches.length !== ids.size) throw new Error('School village index does not match school records');
      return matches.sort((a, b) => a.level.localeCompare(b.level) || a.name.localeCompare(b.name, 'zh-Hant'));
    })());
    try { return await this.villageSchools.get(villageCode)!; }
    catch (error) { this.villageSchools.delete(villageCode); throw error; }
  }
  async manifest(): Promise<SchoolManifest> {
    if (!this.manifestRequest) this.manifestRequest = (async () => {
      const response = await this.fetcher(`${this.root}manifest.json`, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error('School manifest unavailable');
      const data: SchoolManifest = await response.json();
      if (!Array.isArray(data.sources) || !data.sources.every(source => typeof source.id === 'string' && typeof source.title === 'string')) throw new Error('Invalid school manifest');
      return data;
    })();
    try { return await this.manifestRequest; }
    catch (error) { this.manifestRequest = undefined; throw error; }
  }
}
