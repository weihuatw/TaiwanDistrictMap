import type { Camera, ContextRegion, Region, Regions, View } from './types';
import { dataPath } from '../geometry.mjs';

/** Commit a drill-down only when its data is ready. Newer navigation wins. */
export class RegionNavigator {
  private load: (file: string) => Promise<Regions>;
  private onChange: (view: View, restore?: boolean) => void;
  private onBusy: (busy: boolean) => void;
  private onError: (error: unknown, retry: () => Promise<void>) => void;
  private onPreview: (region: Region) => void;
  private history: View[] = [];
  get stack(): readonly View[] { return this.history; }
  private sequence = 0;
  constructor(
    load: (file: string) => Promise<Regions>,
    onChange: (view: View, restore?: boolean) => void,
    onBusy: (busy: boolean) => void,
    onError: (error: unknown, retry: () => Promise<void>) => void,
    onPreview: (region: Region) => void = () => {},
  ) {
    this.load = load; this.onChange = onChange; this.onBusy = onBusy; this.onError = onError;
    this.onPreview = onPreview;
    this.history = []; this.sequence = 0;
  }
  get current() { return this.stack.at(-1); }
  get context(): ContextRegion[] {
    const path = this.current?.path ?? [];
    return this.stack.slice(0, -1).flatMap((parent, parentIndex) => {
      if (parent.level !== 'county' && parent.level !== 'town') return [];
      const selectedCode = path[parentIndex]?.properties.code;
      return parent.data.features
        .filter((region) => region.properties.code !== selectedCode)
        .map((region) => ({ region, parentIndex }));
    });
  }
  async start() {
    const token = ++this.sequence;
    this.onBusy(true);
    try {
      const data = await this.load(dataPath('county'));
      if (token !== this.sequence) return;
      this.history = [{ level: 'county', path: [], data, camera: null, selected: null }];
      this.onChange(this.current!);
    } catch (error) { if (token === this.sequence) this.onError(error, () => this.start()); }
    finally { if (token === this.sequence) this.onBusy(false); }
  }
  async enter(feature: Region, camera: Camera) {
    const parent = this.current;
    if (!parent) return;
    if (parent.level === 'detail') {
      ++this.sequence;
      this.history[this.stack.length - 1] = { ...parent, path: [...parent.path.slice(0, -1), feature], selected: feature };
      this.onBusy(false); this.onChange(this.current!); return;
    }
    if (parent.level === 'village') {
      ++this.sequence;
      parent.camera = camera;
      this.history.push({ ...parent, level: 'detail', path: [...parent.path, feature], selected: feature });
      this.onBusy(false); this.onChange(this.current!); return;
    }
    return this.drill(feature, this.stack.length - 1, camera);
  }
  async switchTo(feature: Region, parentIndex: number) {
    return this.drill(feature, parentIndex);
  }
  private async drill(feature: Region, parentIndex: number, camera?: Camera) {
    const parent = this.stack[parentIndex];
    if (!parent || (parent.level !== 'county' && parent.level !== 'town')) return;
    const token = ++this.sequence;
    const level = parent.level === 'county' ? 'town' : 'village';
    this.onBusy(true);
    this.onPreview(feature);
    try {
      const data = await this.load(dataPath(level, feature.properties.code));
      if (token !== this.sequence || parent !== this.stack[parentIndex]) return;
      if (!data.features.length) throw new Error('此區域目前沒有下一層圖資');
      if (camera !== undefined) parent.camera = camera;
      this.history = [...this.stack.slice(0, parentIndex + 1), { level, path: [...parent.path, feature], data, camera: null, selected: null }];
      this.onChange(this.current!);
    } catch (error) { if (token === this.sequence) this.onError(error, () => this.drill(feature, parentIndex, camera)); }
    finally { if (token === this.sequence) this.onBusy(false); }
  }
  /** Resolve a shared link atomically, retaining ancestor cameras when available. */
  async restorePath(ids: string[], townSelection = false): Promise<void> {
    const token = ++this.sequence;
    this.onBusy(true);
    try {
      const data = await this.load(dataPath('county'));
      if (token !== this.sequence) return;
      const previous = this.history;
      const root = previous[0] ?? { level: 'county' as const, path: [], data, camera: null, selected: null };
      const next: View[] = [{ ...root, selected: null }];
      for (const [index, code] of ids.entries()) {
        const parent = next.at(-1)!;
        const feature = parent.data.features.find(f => f.properties.code === code);
        if (!feature) {
          if (token !== this.sequence) return;
          if (!this.history.length) { this.history = [next[0]]; this.onChange(this.current!, true); }
          throw new Error('此網址的行政區不存在');
        }
        if (townSelection && index === 1) { next[next.length - 1] = { ...parent, selected: feature }; break; }
        if (parent.level === 'village') {
          next.push({ ...parent, level: 'detail', path: [...parent.path, feature], selected: feature });
        } else {
          const level = parent.level === 'county' ? 'town' : 'village';
          const children = await this.load(dataPath(level, code));
          if (token !== this.sequence) return;
          const saved = previous[index + 1];
          const same = saved?.path.map(f => f.properties.code).join('/') === ids.slice(0, index + 1).join('/');
          next.push({ level, path: [...parent.path, feature], data: children, camera: same ? saved.camera : null, selected: null });
        }
      }
      if (token !== this.sequence) return;
      this.history = next; this.onChange(this.current!, true);
    } catch (error) { if (token === this.sequence) this.onError(error, () => this.restorePath(ids, townSelection)); }
    finally { if (token === this.sequence) this.onBusy(false); }
  }
  selectTown(feature: Region | null) {
    if (this.current?.level !== 'town') return;
    ++this.sequence; this.onBusy(false);
    this.history[this.history.length - 1] = { ...this.current, selected: feature };
    this.onChange(this.current!, true);
  }
  destroy() { ++this.sequence; this.history = []; }
  back() { this.goTo(this.stack.length - 2); }
  home() { if (this.stack[0]) this.stack[0].camera = null; this.goTo(0); }
  goTo(index: number) {
    if (!this.stack.length) return;
    ++this.sequence; this.onBusy(false);
    if (index < 0 || index >= this.stack.length) return;
    this.history = this.stack.slice(0, index + 1);
    this.onChange(this.current!, true);
  }
}
