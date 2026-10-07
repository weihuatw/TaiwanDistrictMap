import type { IncomeManifest, IncomePart, IncomeRecord } from './types';

export const INCOME_YEAR = 2024;
export function incomePath(boundaryFile: string) {
  if (!/^(counties\.geojson|towns\/\d{5}\.geojson|villages\/\d{8}\.geojson)$/.test(boundaryFile)) throw new Error('Invalid income data path');
  return boundaryFile.replace(/\.geojson$/, '.json');
}

function validatePart(data: IncomePart) {
  if (data.year !== INCOME_YEAR || !['county', 'town', 'village'].includes(data.level) || !data.records || Array.isArray(data.records)) throw new Error('Invalid income dataset');
  for (const [code, r] of Object.entries(data.records)) {
    if (code !== r.code || typeof r.code !== 'string' || r.level !== data.level || !Number.isSafeInteger(r.taxUnits) || r.taxUnits < 0 || !Number.isFinite(r.incomeTotalK)) throw new Error('Invalid income record');
    if (r.taxUnits === 0 ? r.meanK !== null : r.meanK === null || !Number.isFinite(r.meanK) || Math.abs(r.meanK - r.incomeTotalK / r.taxUnits) > 1e-6) throw new Error('Invalid income mean');
  }
}

/** Income stays separate from boundary geometry, keyed by official string codes. */
export class IncomeRepository {
  private base: string;
  private fetcher: typeof fetch;
  private parts = new Map<string, Promise<IncomePart>>();
  private records = new Map<string, IncomeRecord>();
  private manifestRequest: Promise<IncomeManifest> | undefined;
  constructor(base: string, fetcher: typeof fetch = (input, init) => fetch(input, init)) {
    this.base = base.endsWith('/') ? base : `${base}/`; this.fetcher = fetcher;
  }
  get(code: string) { return this.records.get(code) ?? null; }
  async load(boundaryFile: string) {
    const file = incomePath(boundaryFile);
    if (this.parts.has(file)) return this.parts.get(file)!;
    const request = (async () => {
      const response = await this.fetcher(`${this.base}${file}`, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error('Income data unavailable');
      const data: IncomePart = await response.json(); validatePart(data);
      const expectedLevel = file === 'counties.json' ? 'county' : file.startsWith('towns/') ? 'town' : 'village';
      const expectedParent = file === 'counties.json' ? null : file.split('/')[1].replace('.json', '');
      if (data.level !== expectedLevel || data.parentCode !== expectedParent) throw new Error('Income parent mismatch');
      for (const r of Object.values(data.records)) {
        if (data.level === 'town' && r.countyCode !== expectedParent || data.level === 'village' && r.townCode !== expectedParent) throw new Error('Income record parent mismatch');
      }
      for (const r of Object.values(data.records)) this.records.set(r.code, r);
      return data;
    })();
    this.parts.set(file, request);
    try { return await request; }
    catch (error) { this.parts.delete(file); throw error; }
  }
  async manifest(): Promise<IncomeManifest> {
    if (!this.manifestRequest) this.manifestRequest = (async () => {
      const response = await this.fetcher(`${this.base}manifest.json`, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error('Income manifest unavailable');
      const data: IncomeManifest = await response.json();
      if (data.year !== INCOME_YEAR || data.status !== 'preliminary' || !Number.isFinite(data.national?.meanK)) throw new Error('Invalid income manifest');
      return data;
    })();
    try { return await this.manifestRequest; }
    catch (error) { this.manifestRequest = undefined; throw error; }
  }
}
