export interface PopulationRecord {
  code: string;
  name: string;
  countyCode?: string;
  countyName?: string;
  townCode?: string;
  townName?: string;
  households: number;
  population: number;
  male: number;
  female: number;
}

export interface PopulationAgeBreakdown { male: number[]; female: number[] }
export interface PopulationManifest {
  schemaVersion: 1;
  period: string;
  sourceMonth: string;
  label: string;
  populationType: 'registered';
  ageBuckets: string[];
  source: { title: string; catalogUrl: string };
  files: {
    villages: string;
    towns: string;
    counties: string;
    national: string;
    ages: string;
  };
}

interface PopulationLookup<T> { period: string; label: string; record: T | null }

/** Loads month-pinned population data independently of any map theme or geometry. */
export class PopulationRepository {
  private baseUrl: string;
  private fetcher: typeof fetch;
  private cache = new Map<string, Promise<unknown>>();
  private manifestPromise?: Promise<PopulationManifest>;

  constructor(dataUrl: string, fetcher: typeof fetch = (input, init) => fetch(input, init)) {
    this.baseUrl = dataUrl.endsWith('/') ? dataUrl : `${dataUrl}/`;
    this.fetcher = fetcher;
  }

  manifest(): Promise<PopulationManifest> {
    if (!this.manifestPromise) {
      this.manifestPromise = this.loadJson<PopulationManifest>('manifest.json').then((manifest) => {
        if (manifest.schemaVersion !== 1 || manifest.populationType !== 'registered'
          || !/^\d{4}-\d{2}$/.test(manifest.period) || !/^\d{5}$/.test(manifest.sourceMonth)
          || !manifest.files || Object.values(manifest.files).some((path) => typeof path !== 'string'
            || path.startsWith('/') || path.split('/').includes('..'))
          || typeof manifest.files.villages !== 'string' || typeof manifest.files.towns !== 'string'
          || typeof manifest.files.counties !== 'string' || typeof manifest.files.national !== 'string'
          || typeof manifest.files.ages !== 'string'
          || !manifest.files.villages.includes('{townCode}') || !manifest.files.towns.includes('{countyCode}')
          || !manifest.files.ages.includes('{townCode}')) {
          throw new Error('Invalid population manifest');
        }
        return manifest;
      }).catch((error) => {
        this.manifestPromise = undefined;
        this.cache.delete('manifest.json');
        throw error;
      });
    }
    return this.manifestPromise;
  }

  async getVillage(code: string): Promise<PopulationLookup<PopulationRecord>> {
    if (!/^\d{11}$/.test(code)) throw new Error('Invalid village code');
    const manifest = await this.manifest();
    const townCode = code.slice(0, 8);
    const path = manifest.files.villages.replace('{townCode}', townCode);
    const shard = await this.loadRecordShard(path);
    return { period: manifest.period, label: manifest.label, record: shard.records[code] ?? null };
  }

  async getTown(code: string): Promise<PopulationLookup<PopulationRecord>> {
    if (!/^\d{8}$/.test(code)) throw new Error('Invalid town code');
    const manifest = await this.manifest();
    const countyCode = code.slice(0, 5);
    const path = manifest.files.towns.replace('{countyCode}', countyCode);
    const shard = await this.loadRecordShard(path);
    return { period: manifest.period, label: manifest.label, record: shard.records[code] ?? null };
  }

  async getCounty(code: string): Promise<PopulationLookup<PopulationRecord>> {
    if (!/^\d{5}$/.test(code)) throw new Error('Invalid county code');
    const manifest = await this.manifest();
    const shard = await this.loadRecordShard(manifest.files.counties);
    return { period: manifest.period, label: manifest.label, record: shard.records[code] ?? null };
  }

  async getNational(): Promise<PopulationLookup<PopulationRecord>> {
    const manifest = await this.manifest();
    const shard = await this.loadJson<{ record?: PopulationRecord }>(manifest.files.national);
    if (!shard.record || typeof shard.record !== 'object') {
      this.cache.delete(manifest.files.national);
      throw new Error('Invalid national population record');
    }
    return { period: manifest.period, label: manifest.label, record: shard.record ?? null };
  }

  async getVillageAges(code: string): Promise<PopulationLookup<PopulationAgeBreakdown>> {
    if (!/^\d{11}$/.test(code)) throw new Error('Invalid village code');
    const manifest = await this.manifest();
    const townCode = code.slice(0, 8);
    const path = manifest.files.ages.replace('{townCode}', townCode);
    const shard = await this.loadRecordShard<PopulationAgeBreakdown>(path);
    return { period: manifest.period, label: manifest.label, record: shard.records[code] ?? null };
  }

  private loadJson<T>(path: string): Promise<T> {
    const cached = this.cache.get(path);
    if (cached) return cached as Promise<T>;
    const request = this.fetcher(`${this.baseUrl}${path}`, { signal: AbortSignal.timeout(20_000) })
      .then(async (response) => {
        if (!response.ok) throw new Error('Population data request failed');
        const data: unknown = await response.json();
        if (!data || typeof data !== 'object') throw new Error('Invalid population data');
        return data as T;
      })
      .catch((error) => {
        this.cache.delete(path);
        throw error;
      });
    this.cache.set(path, request);
    return request as Promise<T>;
  }

  private async loadRecordShard<T = PopulationRecord>(path: string): Promise<{ records: Record<string, T> }> {
    const shard = await this.loadJson<{ records?: Record<string, T> }>(path);
    if (!shard.records || typeof shard.records !== 'object' || Array.isArray(shard.records)) {
      this.cache.delete(path);
      throw new Error('Invalid population record shard');
    }
    return { records: shard.records };
  }
}
