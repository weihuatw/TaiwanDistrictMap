import type { PoliticalManifest, PoliticalMode, PoliticalPart, PoliticalRecord } from './types';

export function politicalPath(file: string) {
  if (!/^(counties\.geojson|towns\/\d{5}\.geojson|villages\/\d{8}\.geojson)$/.test(file)) throw new Error('Invalid politics boundary path');
  return file.replace(/\.geojson$/, '.json');
}
export function validatePart(data: PoliticalPart, mode: PoliticalMode, file: string, version: string) {
  const level = file === 'counties.json' ? 'county' : file.startsWith('towns/') ? 'town' : 'village';
  const parent = file === 'counties.json' ? null : file.split('/')[1].replace('.json', '');
  if (data.schemaVersion !== 1 || data.mode !== mode || data.version !== version || data.level !== level || data.parentCode !== parent || !data.records || Array.isArray(data.records)) throw new Error('Invalid politics dataset');
  for (const [code, r] of Object.entries(data.records)) {
    if (code.length !== ({ county: 5, town: 8, village: 11 }[level]) || !/^\d{5}(\d{3}(\d{3})?)?$/.test(code) || code !== r.code || r.level !== level || r.countyCode !== code.slice(0, 5) || level === 'town' && r.countyCode !== parent || level === 'village' && (r.townCode !== parent || code.slice(0, 8) !== parent)) throw new Error('Politics parent mismatch');
    if (mode === 'officials') {
      if (!('verifiedAt' in r) || !/^\d{4}-\d{2}-\d{2}$/.test(r.verifiedAt) || r.name !== null && typeof r.name !== 'string' || r.party !== null && typeof r.party !== 'string' || !['registry', 'acting', 'in-office', 'conflicting-roster'].includes(r.status)) throw new Error('Invalid official record');
    } else {
      if (!('candidates' in r) || !Array.isArray(r.candidates) || !r.candidates.length || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || !(mode === 'president' ? r.electionId === 'president-2024' : ['municipal-2022', 'county-2022', 'chiayi-2022'].includes(r.electionId)) || !['validVotes', 'invalidVotes', 'electors'].every(k => Number.isSafeInteger(r[k as keyof typeof r]) && Number(r[k as keyof typeof r]) >= 0)) throw new Error('Invalid election record');
      const numbers = new Set<number>();
      for (const c of r.candidates) {
        if (typeof c.id !== 'string' || typeof c.name !== 'string' || typeof c.party !== 'string' || !Number.isSafeInteger(c.number) || c.number < 1 || numbers.has(c.number) || !Number.isSafeInteger(c.votes) || c.votes < 0) throw new Error('Invalid candidate');
        numbers.add(c.number);
      }
      if (r.candidates.reduce((sum, c) => sum + c.votes, 0) !== r.validVotes || r.validVotes + r.invalidVotes > r.electors) throw new Error('Invalid election totals');
    }
  }
}

/** Independent mode caches keyed by administrative code, never stored in GeoJSON. */
export class PoliticsRepository {
  private base: string;
  private fetcher: typeof fetch;
  private requests = new Map<string, Promise<PoliticalPart>>();
  private records = new Map<string, PoliticalRecord>();
  private manifestRequest?: Promise<PoliticalManifest>;
  constructor(base: string, fetcher: typeof fetch = (input, init) => fetch(input, init)) {
    this.base = base.endsWith('/') ? base : `${base}/`; this.fetcher = fetcher;
  }
  get(mode: PoliticalMode, code: string) { return this.records.get(`${mode}:${code}`) ?? null; }
  async manifest() {
    if (!this.manifestRequest) this.manifestRequest = (async () => {
      const response = await this.fetcher(`${this.base}manifest.json`, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error('Politics manifest unavailable');
      const data: PoliticalManifest = await response.json();
      if (data.schemaVersion !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(data.snapshot) || !data.colors || !data.coverage || !Array.isArray(data.sources) || !Array.isArray(data.notes)) throw new Error('Invalid politics manifest');
      for (const mode of ['officials', 'mayor', 'president'] as const) {
        if (!new RegExp(`^${mode}/(?:\\d{4}|\\d{4}-\\d{2}-\\d{2})/$`).test(data.paths?.[mode] ?? '') || !Number.isSafeInteger(data.coverage[mode]?.mappedVillages)) throw new Error('Invalid politics manifest paths');
      }
      if (!Object.values(data.colors).every(color => /^#[0-9a-f]{6}$/i.test(color))) throw new Error('Invalid party colors');
      return data;
    })();
    try { return await this.manifestRequest; } catch (error) { this.manifestRequest = undefined; throw error; }
  }
  async load(mode: PoliticalMode, boundaryFile: string) {
    const file = politicalPath(boundaryFile), key = `${mode}:${file}`;
    if (this.requests.has(key)) return this.requests.get(key)!;
    const request = (async () => {
      const manifest = await this.manifest();
      const path = manifest.paths[mode];
      const response = await this.fetcher(`${this.base}${path}${file}`, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error('Politics data unavailable');
      const data: PoliticalPart = await response.json();
      validatePart(data, mode, file, path.split('/')[1]);
      for (const [code, record] of Object.entries(data.records)) this.records.set(`${mode}:${code}`, record);
      return data;
    })();
    this.requests.set(key, request);
    try { return await request; } catch (error) { this.requests.delete(key); throw error; }
  }
}
