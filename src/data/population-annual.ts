/** Annual registration events and official area, independent of monthly population. */
export interface AnnualPopulationRecord {
  code: string; name: string; monthsCovered: number;
  observedBirths: number; observedDeaths: number;
  births: number | null; deaths: number | null; naturalIncrease: number | null;
  startPopulation: number | null; endPopulation: number | null; meanPopulation: number | null;
  densityPopulation: number | null;
  areaKm2: number | null;
}
export interface AnnualPopulationManifest {
  schemaVersion: 1; year: number; populationType: 'registered'; eventBasis: 'registration';
  rateDenominator: 'mean-of-year-end-populations'; densityLevels: ['county', 'town'];
  sources: { title: string; url: string }[];
  files: { counties: string; towns: string; villages: string; national: string; report: string };
}
export interface AnnualPopulationIndex { schemaVersion: 1; years: number[]; }
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export function validAnnualRecord(record: AnnualPopulationRecord | null, code: string, village: boolean): boolean {
  if (!record || record.code !== code || typeof record.name !== 'string' || !count(record.monthsCovered)
    || record.monthsCovered > 12 || !count(record.observedBirths) || !count(record.observedDeaths)) return false;
  const complete = record.monthsCovered === 12;
  const start = record.startPopulation, end = record.endPopulation;
  return record.births === (complete ? record.observedBirths : null)
    && record.deaths === (complete ? record.observedDeaths : null)
    && record.naturalIncrease === (complete ? record.observedBirths - record.observedDeaths : null)
    && (start === null || count(start)) && (end === null || count(end))
    && (record.densityPopulation === null || count(record.densityPopulation))
    && record.meanPopulation === (start !== null && end !== null ? (start + end) / 2 : null)
    && (village ? record.areaKm2 === null && record.densityPopulation === null : complete && start !== null && end !== null
      && record.densityPopulation !== null && typeof record.areaKm2 === 'number' && Number.isFinite(record.areaKm2) && record.areaKm2 > 0);
}
export class AnnualPopulationRepository {
  private baseUrl: string;
  private fetcher: typeof fetch;
  private cache = new Map<string, Promise<unknown>>();
  private records = new Map<string, AnnualPopulationRecord>();
  private indexPromise?: Promise<AnnualPopulationIndex>;
  private manifests = new Map<number, Promise<AnnualPopulationManifest>>();
  constructor(dataUrl: string, fetcher: typeof fetch = (input, init) => fetch(input, init)) {
    this.baseUrl = dataUrl.endsWith('/') ? dataUrl : `${dataUrl}/`; this.fetcher = fetcher;
  }
  availableYears(): Promise<number[]> {
    if (!this.indexPromise) this.indexPromise = this.load<AnnualPopulationIndex>('manifest.json').then(index => {
      if (index.schemaVersion !== 1 || !Array.isArray(index.years) || index.years.length === 0
        || index.years.some(year => !Number.isInteger(year) || year < 2020 || year > 2025)
        || index.years.some((year, position) => position > 0 && year >= index.years[position - 1])) {
        throw new Error('Invalid annual population index');
      }
      return index;
    }).catch(error => { this.indexPromise = undefined; this.cache.delete('manifest.json'); throw error; });
    return this.indexPromise.then(index => [...index.years]);
  }
  manifest(year?: number): Promise<AnnualPopulationManifest> {
    const loadManifest = async () => {
      const available = await this.availableYears();
      const selectedYear = year ?? available[0];
      if (!available.includes(selectedYear)) throw new Error('Annual population year is unavailable');
      const meta = await this.load<AnnualPopulationManifest>(`${selectedYear}/manifest.json`);
      const manifestYear = meta.year;
      const files = { counties: `${manifestYear}/counties.json`, towns: `${manifestYear}/towns/{countyCode}.json`,
        villages: `${manifestYear}/villages/{townCode}.json`, national: `${manifestYear}/national.json`, report: `${manifestYear}/join-report.json` };
      if (manifestYear !== selectedYear || meta.schemaVersion !== 1 || !Number.isInteger(manifestYear) || manifestYear < 2020 || meta.populationType !== 'registered'
        || meta.eventBasis !== 'registration' || meta.rateDenominator !== 'mean-of-year-end-populations'
        || JSON.stringify(meta.densityLevels) !== '["county","town"]'
        || !meta.files || Object.entries(files).some(([key, path]) => meta.files[key as keyof typeof files] !== path)
        || !Array.isArray(meta.sources) || meta.sources.length < 3
        || meta.sources.some(source => typeof source.title !== 'string' || typeof source.url !== 'string' || !source.url.startsWith('https://'))) {
        throw new Error('Invalid annual population manifest');
      }
      return meta;
    };
    const selectedYear = year ?? 0;
    if (!this.manifests.has(selectedYear)) this.manifests.set(selectedYear, loadManifest().catch(error => { this.manifests.delete(selectedYear); throw error; }));
    return this.manifests.get(selectedYear)!;
  }
  async loadRegions(level: 'county' | 'town' | 'village', parentCode?: string, year?: number): Promise<void> {
    if (level !== 'county' && !new RegExp(`^\\d{${level === 'town' ? 5 : 8}}$`).test(parentCode ?? '')) throw new Error('Invalid annual parent code');
    const meta = await this.manifest(year);
    const path = level === 'county' ? meta.files.counties : level === 'town'
      ? meta.files.towns.replace('{countyCode}', parentCode!) : meta.files.villages.replace('{townCode}', parentCode!);
    const shard = await this.load<{ schemaVersion: number; year: number; level: string; parentCode?: string;
      records: Record<string, AnnualPopulationRecord> }>(path);
    const length = level === 'county' ? 5 : level === 'town' ? 8 : 11;
    if (shard.schemaVersion !== 1 || shard.year !== meta.year || shard.level !== level
      || (level !== 'county' && shard.parentCode !== parentCode)
      || !shard.records || typeof shard.records !== 'object' || Array.isArray(shard.records)
      || Object.entries(shard.records).some(([code, record]) => !new RegExp(`^\\d{${length}}$`).test(code)
        || (level !== 'county' && !code.startsWith(parentCode!)) || !validAnnualRecord(record, code, level === 'village'))) {
      this.cache.delete(path); throw new Error('Invalid annual population summary');
    }
    for (const [code, record] of Object.entries(shard.records)) this.records.set(`${meta.year}:${code}`, record);
  }
  get(code: string, year?: number): AnnualPopulationRecord | null {
    const selectedYear = year ?? 2025;
    return this.records.get(`${selectedYear}:${code}`) ?? null;
  }
  async getNational(year?: number): Promise<AnnualPopulationRecord> {
    const meta = await this.manifest(year);
    const shard = await this.load<{ schemaVersion: number; year: number; record: AnnualPopulationRecord }>(meta.files.national);
    if (shard.schemaVersion !== 1 || shard.year !== meta.year || !validAnnualRecord(shard.record, 'TW', false)) {
      this.cache.delete(meta.files.national); throw new Error('Invalid annual national population');
    }
    return shard.record;
  }
  private load<T>(path: string): Promise<T> {
    const cached = this.cache.get(path); if (cached) return cached as Promise<T>;
    const request = this.fetcher(`${this.baseUrl}${path}`, { signal: AbortSignal.timeout(20_000) }).then(async response => {
      if (!response.ok) throw new Error('Annual population request failed');
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object') throw new Error('Invalid annual population data');
      return data as T;
    }).catch(error => { this.cache.delete(path); throw error; });
    this.cache.set(path, request); return request;
  }
}
