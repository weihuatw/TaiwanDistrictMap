import type { Camera, ContextRegion, Region, Regions, View } from '../../map-core/types';
import { emptyRegions, type School, type SchoolLevel, type SchoolView } from './types.ts';
import { filterSchools } from './data.ts';

/** County → town → schools. School selection keeps the town's overview camera. */
export class SchoolNavigator {
  private history: SchoolView[] = [];
  private sequence = 0;
  readonly filter: Record<SchoolLevel, boolean> = { elementary: true, junior: true };
  private loadRegions: (file: string) => Promise<Regions>;
  private loadSchools: (townCode: string) => Promise<School[]>;
  private loadCatchment: (school: School) => Promise<Regions>;
  private onChange: (view: SchoolView, restore: boolean) => void;
  private onBusy: (busy: boolean) => void;
  private onError: (error: unknown, retry: () => Promise<void>) => void;
  private onPreview: (target: Region | School) => void;
  constructor(options: {
    loadRegions: (file: string) => Promise<Regions>; loadSchools: (townCode: string) => Promise<School[]>;
    loadCatchment: (school: School) => Promise<Regions>;
    onChange: (view: SchoolView, restore: boolean) => void; onBusy: (busy: boolean) => void;
    onError: (error: unknown, retry: () => Promise<void>) => void;
    onPreview?: (target: Region | School) => void;
  }) {
    this.loadRegions = options.loadRegions; this.loadSchools = options.loadSchools;
    this.loadCatchment = options.loadCatchment; this.onChange = options.onChange;
    this.onBusy = options.onBusy; this.onError = options.onError;
    this.onPreview = options.onPreview ?? (() => {});
  }
  get current() { return this.history.at(-1); }
  get visibleSchools() { return filterSchools(this.current?.schools ?? [], this.filter); }
  get context(): ContextRegion[] {
    const view = this.current;
    if (!view) return [];
    return this.history.slice(0, -1).flatMap((parent, parentIndex) => parent.data.features
      .filter(r => r.properties.code !== view.path[parentIndex]?.properties.code)
      .map(region => ({ region, parentIndex })));
  }
  private async request(work: () => Promise<() => void>, retry: () => Promise<void>) {
    const token = ++this.sequence; this.onBusy(true);
    try { const commit = await work(); if (token === this.sequence) commit(); }
    catch (error) { if (token === this.sequence) this.onError(error, retry); }
    finally { if (token === this.sequence) this.onBusy(false); }
  }
  async start(): Promise<void> {
    return this.request(async () => {
      const data = await this.loadRegions('counties.geojson');
      return () => { this.history = [{ level: 'county', path: [], data, schools: [], selected: null, catchment: emptyRegions(), camera: null, overviewCamera: null }]; this.onChange(this.current!, false); };
    }, () => this.start());
  }
  async enter(region: Region, camera?: Camera, parentIndex = this.history.length - 1): Promise<void> {
    const parent = this.history[parentIndex];
    if (!parent || parent.level === 'school' || !parent.data.features.some(r => r.properties.code === region.properties.code)) return;
    return this.request(async () => {
      const level = parent.level === 'county' ? 'town' : 'school';
      this.onPreview(region);
      const data = level === 'town' ? await this.loadRegions(`towns/${region.properties.code}.geojson`) : emptyRegions();
      const schools = level === 'school' ? await this.loadSchools(region.properties.code) : [];
      return () => {
        if (camera) parent.camera = camera;
        this.history = [...this.history.slice(0, parentIndex + 1), { level, path: [...parent.path, region], data, schools, selected: null, catchment: emptyRegions(), camera: null, overviewCamera: null }];
        this.onChange(this.current!, false);
      };
    }, () => this.enter(region, camera, parentIndex));
  }
  async choose(school: School, camera: Camera, preserveCamera = false): Promise<void> {
    const view = this.current;
    if (!view || view.level !== 'school' || !this.filter[school.level] || !view.schools.some(s => s.id === school.id)) return;
    return this.request(async () => {
      if (!preserveCamera) this.onPreview(school);
      const catchment = await this.loadCatchment(school);
      return () => {
        if (!view.selected) view.overviewCamera = camera;
        if (preserveCamera) view.camera = camera;
        view.selected = school; view.catchment = catchment;
        this.onChange(view, false);
      };
    }, () => this.choose(school, camera, preserveCamera));
  }
  setFilter(level: SchoolLevel, checked: boolean, camera: Camera) {
    this.filter[level] = checked;
    const view = this.current;
    if (!view) return;
    ++this.sequence; this.onBusy(false);
    if (view.selected && !this.filter[view.selected.level]) this.clearSelection();
    else { view.camera = camera; this.onChange(view, true); }
  }
  private clearSelection() {
    const view = this.current!;
    view.selected = null; view.catchment = emptyRegions(); view.camera = view.overviewCamera;
    view.overviewCamera = null; this.onChange(view, true);
  }
  back() {
    if (!this.current) return;
    ++this.sequence; this.onBusy(false);
    if (this.current?.selected) this.clearSelection();
    else this.goTo(this.history.length - 2);
  }
  home() { if (this.history[0]) this.history[0].camera = null; this.goTo(0); }
  goTo(index: number) {
    if (!this.history.length) return;
    ++this.sequence; this.onBusy(false);
    if (index < 0 || index >= this.history.length) return;
    if (index === this.history.length - 1 && this.current?.selected) { this.clearSelection(); return; }
    this.history = this.history.slice(0, index + 1); this.onChange(this.current!, true);
  }
  async restorePath(ids: string[]): Promise<void> {
    return this.request(async () => {
      const data = await this.loadRegions('counties.geojson');
      const previous: SchoolView[] = this.history;
      const next: SchoolView[] = [{ level: 'county', path: [], data, schools: [], selected: null, catchment: emptyRegions(), camera: previous[0]?.camera ?? null, overviewCamera: null }];
      for (const [index, code] of ids.entries()) {
        const parent = next.at(-1)!;
        if (index === 2) {
          const school = parent.schools.find(s => s.id === code);
          if (!school) return () => { this.history = next; this.onChange(this.current!, true); this.onError(new Error('此網址的學校不存在'), () => this.restorePath(ids)); };
          const catchment = await this.loadCatchment(school);
          parent.selected = school; parent.catchment = catchment;
          parent.overviewCamera = parent.camera; parent.camera = null;
        } else {
          const region = parent.data.features.find(r => r.properties.code === code);
          if (!region) return () => { this.history = next; this.onChange(this.current!, true); this.onError(new Error('此網址的行政區不存在'), () => this.restorePath(ids)); };
          const level = index === 0 ? 'town' : 'school';
          const regions = level === 'town' ? await this.loadRegions(`towns/${code}.geojson`) : emptyRegions();
          const schools = level === 'school' ? await this.loadSchools(code) : [];
          const saved = previous[index + 1];
          const same = saved?.path.map(r => r.properties.code).join('/') === ids.slice(0, index + 1).join('/');
          next.push({ level, path: [...parent.path, region], data: regions, schools, selected: null, catchment: emptyRegions(), camera: same ? saved.overviewCamera ?? saved.camera : null, overviewCamera: null });
        }
      }
      return () => { this.history = next; if (this.current?.selected) this.filter[this.current.selected.level] = true; this.onChange(this.current!, true); };
    }, () => this.restorePath(ids));
  }
  destroy() { ++this.sequence; this.history = []; }
}

/** Adapt school state to the shared polygon renderer without changing cached boundaries. */
export function polygonView(view: SchoolView): View {
  let path = view.path;
  if (view.selected) {
    // Some villages include distant offshore islets in their official geometry.
    // Use each village's curated focusBounds for framing while still rendering
    // its complete geometry as the school catchment outline.
    const bounds = view.catchment.features.map(v => v.properties.focusBounds ?? v.properties.bounds);
    if (view.selected.position) { const [x,y] = view.selected.position; bounds.push([x-.001,y-.001,x+.001,y+.001]); }
    if (bounds.length) {
      const focusBounds = [Math.min(...bounds.map(b=>b[0])),Math.min(...bounds.map(b=>b[1])),Math.max(...bounds.map(b=>b[2])),Math.max(...bounds.map(b=>b[3]))];
      path = [...path.slice(0,-1), { ...path.at(-1)!, properties: { ...path.at(-1)!.properties, focusBounds } }];
    }
  }
  return { level: view.level === 'school' ? 'village' : view.level, path,
    data: view.level === 'school' ? view.catchment : view.data, camera: view.camera, selected: null };
}
