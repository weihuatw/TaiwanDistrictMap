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
  constructor(root: string, fetcher: typeof fetch = (input, init) => fetch(input, init)) {
    this.root = root.endsWith('/') ? root : `${root}/`; this.fetcher = fetcher;
  }
  async load(townCode: string): Promise<School[]> {
    if (!/^\d{8}$/.test(townCode)) throw new Error('Invalid town code');
    // First release covers Taipei; an unsupported district is not an HTTP error.
    if (!townCode.startsWith('63000')) return [];
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
  async manifest(): Promise<SchoolManifest> {
    const response = await this.fetcher(`${this.root}manifest.json`, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error('School manifest unavailable');
    return response.json();
  }
}
