export const themes = ['admin', 'income', 'school', 'housing', 'politics'] as const;
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
interface Browser {
  location: { hash: string; pathname: string; search: string };
  history: { state: any; pushState(data: any, unused: string, url: string): void; replaceState(data: any, unused: string, url: string): void; go(delta: number): void };
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}
/** One owned browser entry per hierarchy level. Same-level choices replace it. */
export class HashRouter {
  private browser: Browser;
  private session: string;
  private committed?: Route;
  isHistoryNavigation = false;
  private applying = false;
  private target?: Route;
  private pending?: Route;
  private handler?: (route: Route) => void;
  private lastEvent = '';
  constructor(browser: Browser) {
    this.browser = browser;
    this.session = browser.history.state?.mapSession ?? `${Date.now()}-${Math.random()}`;
    browser.addEventListener('popstate', this.onEvent);
    browser.addEventListener('hashchange', this.onEvent);
  }
  get current(): Route { try { return parseRoute(this.browser.location.hash); } catch { return { theme: 'admin', ids: [], query: '' }; } }
  get params() { return new URLSearchParams(this.current.query); }
  subscribe(handler: (route: Route) => void) { this.handler = handler; this.apply(); }
  private onEvent = () => {
    const key = this.browser.location.hash;
    if (this.pending) {
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
    try { this.handler?.(this.current); }
    catch { this.handler?.({ theme: 'admin', ids: [], query: '' }); }
  }
  private write(route: Route, replace: boolean) {
    const state = { mapSession: this.session, route };
    this.browser.history[replace ? 'replaceState' : 'pushState'](state, '', routeHash(route));
    this.lastEvent = this.browser.location.hash;
  }
  private seed(route: Route) {
    for (let depth = 0; depth <= route.ids.length; depth++) this.write({ ...route, ids: route.ids.slice(0, depth) }, depth === 0);
  }
  commit(route: Route) {
    const old = this.committed;
    this.committed = route;
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
    this.browser.removeEventListener('popstate', this.onEvent);
    this.browser.removeEventListener('hashchange', this.onEvent);
    this.handler = undefined; this.pending = undefined;
  }
}
