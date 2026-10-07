import type { BoundaryManifest, Regions } from './types';

/** Owns boundary I/O and cache; independent of the basemap and page UI. */
export class BoundaryRepository {
  private dataUrl: string;
  private fetcher: typeof fetch;
  private cache = new Map<string, Regions>();

  constructor(dataUrl: string, fetcher: typeof fetch = (input, init) => fetch(input, init)) {
    this.dataUrl = dataUrl.endsWith('/') ? dataUrl : `${dataUrl}/`;
    this.fetcher = fetcher;
  }

  async load(file: string): Promise<Regions> {
    if (this.cache.has(file)) return this.cache.get(file)!;
    const response = await this.fetcher(`${this.dataUrl}${file}`, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error('Administrative data request failed');
    const data = await response.json();
    if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('Invalid administrative data');
    this.cache.set(file, data);
    return data;
  }

  async manifest(): Promise<BoundaryManifest> {
    const response = await this.fetcher(`${this.dataUrl}manifest.json`, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error('Manifest unavailable');
    return response.json();
  }
}
