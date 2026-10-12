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
  age0to14: number;
  age15to64: number;
  age65plus: number;
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
  private records = new Map<string, PopulationRecord>();

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

  /** Load only the current map level; age summaries travel with these small shards. */
  async loadRegions(level: 'county' | 'town' | 'village', parentCode?: string): Promise<void> {
    if (level !== 'county' && !new RegExp(`^\\d{${level === 'town' ? 5 : 8}}$`).test(parentCode ?? '')) {
      throw new Error('Invalid population parent code');
    }
    const manifest = await this.manifest();
    const path = level === 'county' ? manifest.files.counties
      : level === 'town' ? manifest.files.towns.replace('{countyCode}', parentCode!)
      : manifest.files.villages.replace('{townCode}', parentCode!);
    const shard = await this.loadJson<{ schemaVersion: number; period: string; level: string; parentCode?: string;
      records: Record<string, PopulationRecord> }>(path);
    const valid = shard.schemaVersion === 1 && shard.period === manifest.period && shard.level === level
      && (level === 'county' || shard.parentCode === parentCode)
      && shard.records && !Array.isArray(shard.records) && typeof shard.records === 'object'
      && Object.entries(shard.records).every(([code, record]) => {
        const length = level === 'county' ? 5 : level === 'town' ? 8 : 11;
        return new RegExp(`^\\d{${length}}$`).test(code) && record?.code === code
          && (level === 'county' || code.startsWith(parentCode!))
          && [record.households, record.population, record.male, record.female, record.age0to14, record.age15to64, record.age65plus]
            .every(value => Number.isInteger(value) && value >= 0)
          && record.male + record.female === record.population
          && record.age0to14 + record.age15to64 + record.age65plus === record.population;
      });
    if (!valid) { this.cache.delete(path); throw new Error('Invalid population map summary'); }
    for (const [code, record] of Object.entries(shard.records)) this.records.set(code, record);
  }

  get(code: string): PopulationRecord | null { return this.records.get(code) ?? null; }

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
