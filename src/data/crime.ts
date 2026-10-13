export type CrimeScope = 'official' | 'regional';
export type CrimePeriod = 'available' | 'half';
export interface CrimeRecord {
  code: string; name: string; countyCode?: string; population: number;
  cases: Record<string, number>; suspects: Record<string, number> | null; unassigned: Record<string, number>;
}
export interface CrimeSnapshot {
  schemaVersion: 1; year: number; scope: CrimeScope; period: CrimePeriod; endMonth: number; complete: boolean;
  categories: string[]; populationLabel: string; sourceUrls: string[]; records: Record<string, CrimeRecord>;
}
export interface CrimeIndex { schemaVersion: 1; snapshots: Array<Pick<CrimeSnapshot, 'year' | 'scope' | 'period' | 'endMonth' | 'complete' | 'categories'> & { file: string }> }
const counts = (v: Record<string, number>) => !!v && typeof v === 'object' && Object.values(v).every(n => Number.isSafeInteger(n) && n >= 0);
export function validSnapshot(d: CrimeSnapshot, year: number, scope: CrimeScope, period: CrimePeriod): boolean {
  return d.schemaVersion === 1 && d.year === year && d.scope === scope && d.period === period
    && Number.isInteger(d.endMonth) && d.endMonth >= 1 && d.endMonth <= 12 && d.complete === (d.endMonth === 12)
    && (period !== 'half' || d.endMonth === 6) && Array.isArray(d.categories) && d.categories.includes('total') && new Set(d.categories).size === d.categories.length
    && typeof d.populationLabel === 'string' && Array.isArray(d.sourceUrls) && d.sourceUrls.length > 0 && d.sourceUrls.every(u => u.startsWith('https://data.gov.tw/dataset/'))
    && !!d.records?.TW && Object.entries(d.records).every(([code, r]) => (code === 'TW' || /^\d{5}$/.test(code) || (scope === 'regional' && /^\d{8}$/.test(code)))
      && r.code === code && typeof r.name === 'string' && Number.isFinite(r.population) && r.population > 0
      && counts(r.cases) && counts(r.unassigned) && d.categories.every(k => Number.isSafeInteger(r.cases[k]))
      && (scope === 'regional' ? r.suspects === null : !!r.suspects && counts(r.suspects) && d.categories.every(k => Number.isSafeInteger(r.suspects![k]))));
}
export class CrimeRepository {
  private base: string; private fetcher: typeof fetch; private cache = new Map<string, Promise<unknown>>();
  constructor(base: string, fetcher: typeof fetch = (url, init) => fetch(url, init)) { this.base = base.endsWith('/') ? base : base + '/'; this.fetcher = fetcher; }
  private load<T>(path: string, valid: (d: T) => boolean): Promise<T> {
    const cached = this.cache.get(path); if (cached) return cached as Promise<T>;
    const promise = this.fetcher(this.base + path, { signal: AbortSignal.timeout(20000) }).then(async response => {
      if (!response.ok) throw Error('刑事統計載入失敗'); const data = await response.json() as T;
      if (!valid(data)) throw Error('刑事統計資料驗證失敗'); return data;
    }).catch(error => { this.cache.delete(path); throw error; });
    this.cache.set(path, promise); return promise;
  }
  index() { return this.load<CrimeIndex>('manifest.json', d => d.schemaVersion === 1 && Array.isArray(d.snapshots) && d.snapshots.length > 0 && d.snapshots.every(s => [2024, 2025, 2026].includes(s.year) && ['official', 'regional'].includes(s.scope) && ['available', 'half'].includes(s.period) && s.file === `${s.year}/${s.scope}-${s.period}.json`)); }
  async snapshot(year: number, scope: CrimeScope, period: CrimePeriod) {
    const index = await this.index(); const entry = index.snapshots.find(s => s.year === year && s.scope === scope && s.period === period);
    if (!entry) throw Error('此期間尚無刑事統計');
    return this.load<CrimeSnapshot>(entry.file, d => validSnapshot(d, year, scope, period) && d.endMonth === entry.endMonth && d.complete === entry.complete && JSON.stringify(d.categories) === JSON.stringify(entry.categories));
  }
}
