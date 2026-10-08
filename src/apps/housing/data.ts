import type { HousingGroup, HousingManifest, HousingPart, HousingSummary, HousingTransaction } from './types';

function safeCode(value: string, length: number) {
  if (!new RegExp(`^\\d{${length}}$`).test(value)) throw new Error('Invalid administrative code');
  return value;
}

export class HousingRepository {
  private base: string;
  private fetcher: typeof fetch;
  private summaries = new Map<string, Map<string, HousingSummary>>();
  private requests = new Map<string, Promise<Map<string, HousingSummary>>>();
  private manifestRequest: Promise<HousingManifest> | undefined;
  private indices = new Map<string, Promise<{ pages: { file: string; count: number }[]; pageSize: number; count: number }>>();
  private parts = new Map<string, Promise<HousingTransaction[]>>();
  private national = new Map<string, Promise<HousingSummary>>();

  constructor(base: string, fetcher: typeof fetch = (input, init) => fetch(input, init)) {
    this.base = base.endsWith('/') ? base : `${base}/`; this.fetcher = fetcher;
  }
  get(year: number, group: HousingGroup, code: string) { return this.summaries.get(`${year}/${group}`)?.get(code) ?? null; }
  async getNational(year: number, group: HousingGroup) {
    const key=`${year}/${group}`;
    if(!this.national.has(key))this.national.set(key,(async()=>{
      const response=await this.fetcher(`${this.base}summary/${year}/${group}/national.json`,{signal:AbortSignal.timeout(20_000)});
      if(!response.ok)throw new Error('National housing summary unavailable');
      const data:{year:number;group:HousingGroup;summary:HousingSummary}=await response.json();
      if(data.year!==year||data.group!==group||data.summary.code!=='TW')throw new Error('Invalid national housing summary');
      return data.summary;
    })());
    try{return await this.national.get(key)!;}catch(error){this.national.delete(key);throw error;}
  }
  async manifest() {
    if (!this.manifestRequest) this.manifestRequest = (async () => {
      const response = await this.fetcher(`${this.base}manifest.json`, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error('Housing manifest unavailable');
      const data: HousingManifest = await response.json();
      if (data.schemaVersion !== 1 || !Array.isArray(data.periods) || !data.groups.includes('standard')) throw new Error('Invalid housing manifest');
      return data;
    })();
    try { return await this.manifestRequest; }
    catch (error) { this.manifestRequest = undefined; throw error; }
  }
  async load(file: string, year: number, group: HousingGroup) {
    const county = file === 'counties.geojson';
    const countyCode = county ? '' : file.match(/^towns\/(\d{5})\.geojson$/)?.[1];
    if (!county && !countyCode) throw new Error('Invalid housing summary path');
    const key = `${year}/${group}/${county ? 'county' : countyCode}`;
    if (this.requests.has(key)) return this.requests.get(key)!;
    const path = county ? `summary/${year}/${group}/counties.json` : `summary/${year}/${group}/towns/${safeCode(countyCode!,5)}.json`;
    const request = (async () => {
      const response = await this.fetcher(`${this.base}${path}`, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error('Housing summary unavailable');
      const data: HousingPart<HousingSummary> & { countyCode?: string } = await response.json();
      if (data.year !== year || data.group !== group || !data.records || (!county && data.countyCode !== countyCode)) throw new Error('Invalid housing summary');
      const records = new Map(Object.entries(data.records));
      this.summaries.set(`${year}/${group}`, new Map([...(this.summaries.get(`${year}/${group}`) ?? new Map()), ...records]));
      return records;
    })();
    this.requests.set(key, request);
    try { return await request; }
    catch (error) { this.requests.delete(key); throw error; }
  }
  async transactionPage(townCode: string, year: number, page: number) {
    safeCode(townCode, 8);
    const indexKey = `${year}/${townCode}`;
    if (!this.indices.has(indexKey)) this.indices.set(indexKey, (async () => {
      const response = await this.fetcher(`${this.base}transactions/${year}/${townCode}/index.json`, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error('Transaction index unavailable');
      return response.json();
    })());
    const index = await this.indices.get(indexKey)!;
    const pageSize = 50;
    const offset = page * pageSize;
    const partNumber = Math.floor(offset / index.pageSize);
    const part = index.pages[partNumber];
    if (!part) return { records: [] as HousingTransaction[], total: index.count, hasNext: false };
    const partKey = `${indexKey}/${part.file}`;
    if (!this.parts.has(partKey)) this.parts.set(partKey, (async () => {
      const response = await this.fetcher(`${this.base}transactions/${year}/${townCode}/${part.file}`, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error('Transaction data unavailable');
      const stream=response.body?.pipeThrough(new DecompressionStream('gzip'));
      if(!stream)throw new Error('Gzip decompression is unavailable');
      const data: { records: HousingTransaction[] } = await new Response(stream).json();
      if (!Array.isArray(data.records) || data.records.length !== part.count) throw new Error('Invalid transaction shard');
      return data.records;
    })());
    try {
      const all = await this.parts.get(partKey)!;
      const start = offset % index.pageSize;
      const records = all.slice(start, start + pageSize);
      return { records, total: index.count, hasNext: offset + records.length < index.count };
    } catch (error) { this.parts.delete(partKey); throw error; }
  }
}
