import type { Camera } from '../map-core/types.ts';

export const themes = ['admin', 'population', 'income', 'school', 'housing', 'politics', 'indigenous', 'traffic'] as const;
export type Theme = typeof themes[number];
export interface Route { theme: Theme; ids: string[]; query: string }
export function parseRoute(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const [theme = 'admin', ...ids] = path.split('/').filter(Boolean);
  if (!themes.includes(theme as Theme) || ids.length > (theme === 'housing' ? 2 : 3) || ids.some(id => !/^[A-Za-z0-9_-]+$/.test(id))) throw new Error('無效的地圖網址');
  return { theme: theme as Theme, ids, query: new URLSearchParams(query).toString() };
}
export function routeHash(route: Route): string {
  return `#/${route.theme}${route.ids.length ? '/' + route.ids.join('/') : ''}${route.query ? '?' + route.query : ''}`;
}
export function commonDepth(a: Route, b: Route): number {
  if (a.theme !== b.theme) return -1;
  let depth = 0;
  while (depth < a.ids.length && depth < b.ids.length && a.ids[depth] === b.ids[depth]) depth++;
  return depth;
}

/** School IDs cannot be transferred as village codes; housing stops at towns. */
export function transferTheme(route: Route, theme: Theme, query = ''): Route {
  const geographicIds = route.theme === 'school' ? route.ids.slice(0, 2) : route.ids;
  return { theme, ids: geographicIds.slice(0, theme === 'school' || theme === 'housing' ? 2 : 3), query };
}

function validCamera(value: unknown): value is Camera {
  const camera = value as Camera | undefined;
  return !!camera && Array.isArray(camera.center) && camera.center.length === 2
    && [...camera.center, camera.zoom, camera.bearing, camera.pitch].every(Number.isFinite)
    && Math.abs(camera.center[0]) <= 180 && Math.abs(camera.center[1]) <= 90
    && camera.zoom >= 0 && camera.zoom <= 24 && camera.pitch >= 0 && camera.pitch <= 85;
}
interface Browser {
  location: { hash: string; pathname: string; search: string };
  history: { state: any; pushState(data: any, unused: string, url: string): void; replaceState(data: any, unused: string, url: string): void; go(delta: number): void };
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}
/** One owned browser entry per hierarchy level. Same-level choices replace it. */
export class HashRouter {
  private commitListeners = new Set<(route: Route) => void>();
  observeCommits(listener: (route: Route) => void) {
    this.commitListeners.add(listener);
    return () => this.commitListeners.delete(listener);
  }
  private browser: Browser;
  private session: string;
  private committed?: Route;
  isHistoryNavigation = false;
  private applying = false;
  private target?: Route;
  private pending?: Route;
  private handler?: (route: Route) => void;
  private lastEvent = '';
  private themeQueries = new Map<Theme, string>();
  private restorationCamera: Camera | null = null;
  private queuedNavigation?: { route: Route; camera?: Camera };
  constructor(browser: Browser) {
    this.browser = browser;
    this.session = browser.history.state?.mapSession ?? `${Date.now()}-${Math.random()}`;
    browser.addEventListener('popstate', this.onEvent);
    browser.addEventListener('hashchange', this.onEvent);
  }
  get current(): Route { try { return parseRoute(this.browser.location.hash); } catch { return { theme: 'admin', ids: [], query: '' }; } }
  get params() { return new URLSearchParams(this.current.query); }
  themeRoute(theme: Theme, source: Route = this.committed ?? this.current): Route {
    return transferTheme(source, theme, this.themeQueries.get(theme) ?? '');
  }
  /** Save the outgoing viewport in this browser entry, then open a new theme branch. */
  navigate(route: Route, camera?: Camera) {
    if (routeHash(route) === routeHash(this.current)) return;
    if (this.pending) { this.queuedNavigation = { route, camera }; return; }
    const source = this.committed?.theme === this.current.theme ? this.committed : this.current;
    this.themeQueries.set(source.theme, source.query);
    this.browser.history.replaceState({ ...this.browser.history.state, mapSession: this.session, route: source,
      ...(validCamera(camera) ? { camera } : {}) }, '', routeHash(source));
    this.browser.history.pushState(validCamera(camera) ? { transferCamera: camera } : null, '', routeHash(route));
    this.isHistoryNavigation = false;
    this.apply();
  }
  consumeRouteCamera(route: Route): Camera | null {
    if (route.theme !== this.target?.theme || route.ids.join('/') !== this.target.ids.join('/')) return null;
    const camera = this.restorationCamera;
    this.restorationCamera = null;
    return camera;
  }
  subscribe(handler: (route: Route) => void) { this.handler = handler; this.apply(); }
  private onEvent = () => {
    const key = this.browser.location.hash;
    if (this.pending) {
      if (this.queuedNavigation) {
        const next = this.queuedNavigation;
        this.pending = undefined; this.queuedNavigation = undefined; this.committed = this.current;
        this.navigate(next.route, next.camera);
        return;
      }
      const target = this.pending; this.pending = undefined;
      this.committed = this.current;
      this.commit(target);
      this.lastEvent = this.browser.location.hash;
      return;
    }
    if (key === this.lastEvent) return;
    this.isHistoryNavigation = this.browser.history.state?.mapSession === this.session;
    this.apply();
  };
  private apply() {
    this.lastEvent = this.browser.location.hash;
    this.applying = true; this.target = this.current;
    const state = this.browser.history.state;
    const camera = state?.route && routeHash(state.route) === routeHash(this.current) ? state.camera : state?.transferCamera;
    this.restorationCamera = validCamera(camera) ? camera : null;
    try { this.handler?.(this.current); }
    catch { this.handler?.({ theme: 'admin', ids: [], query: '' }); }
  }
  private write(route: Route, replace: boolean, camera?: Camera) {
    const previous = this.browser.history.state;
    const saved = camera ?? (replace && previous?.route?.theme === route.theme
      && previous.route.ids.join('/') === route.ids.join('/') ? previous.camera : undefined);
    const state = { mapSession: this.session, route, ...(validCamera(saved) ? { camera: saved } : {}) };
    this.browser.history[replace ? 'replaceState' : 'pushState'](state, '', routeHash(route));
    this.lastEvent = this.browser.location.hash;
  }
  private seed(route: Route) {
    const camera = this.browser.history.state?.transferCamera;
    for (let depth = 0; depth <= route.ids.length; depth++) this.write({ ...route, ids: route.ids.slice(0, depth) }, depth === 0,
      depth === route.ids.length ? camera : undefined);
  }
  commit(route: Route) {
    this.themeQueries.set(route.theme, route.query);
    const old = this.committed;
    this.committed = route;
    for (const listener of this.commitListeners) listener(route);
    if (this.pending) { this.pending = route; return; }
    if (this.applying && this.target?.theme === route.theme && this.target.ids.join('/') === route.ids.join('/')) {
      this.applying = false;
      if (this.browser.history.state?.mapSession === this.session) this.write(route, true);
      else this.seed(route);
      return;
    }
    this.applying = false;
    if (!old || old.theme !== route.theme || this.browser.history.state?.mapSession !== this.session) {
      this.seed(route); return;
    }
    const common = commonDepth(old, route);
    // Siblings occupy a single entry; returning or crossing ancestors removes old children.
    const sameParent = old.ids.length === route.ids.length && common >= old.ids.length - 1;
    if (sameParent) { this.write(route, true); return; }
    if (common < old.ids.length) {
      this.pending = route;
      this.browser.history.go(common - old.ids.length);
      return;
    }
    for (let depth = common + 1; depth <= route.ids.length; depth++) this.write({ ...route, ids: route.ids.slice(0, depth) }, false);
    if (common === route.ids.length) this.write(route, true);
  }
  destroy() {
    this.commitListeners.clear();
    this.browser.removeEventListener('popstate', this.onEvent);
    this.browser.removeEventListener('hashchange', this.onEvent);
    this.handler = undefined; this.pending = undefined; this.queuedNavigation = undefined; this.restorationCamera = null;
  }
}
