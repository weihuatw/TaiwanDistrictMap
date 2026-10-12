import { HashRouter, routeHash, type Route } from './hash-router.ts';

/** The second pane owns a normal hierarchy without writing the browser URL. */
export function createLocalRouter(route: Route) {
  const entries = [{ hash: routeHash(route), state: null as any }];
  let index = 0, alive = true;
  const listeners = new Map<string, Set<() => void>>();
  const location = { hash: entries[0].hash, pathname: '', search: '' };
  const router = new HashRouter({
    location,
    history: {
      get state() { return entries[index].state; },
      replaceState(state, _, hash) { entries[index] = { hash, state }; location.hash = hash; },
      pushState(state, _, hash) { entries.splice(++index, Infinity, { hash, state }); location.hash = hash; },
      go(delta) {
        queueMicrotask(() => {
          if (!alive) return;
          index = Math.max(0, Math.min(entries.length - 1, index + delta));
          location.hash = entries[index].hash;
          for (const listener of listeners.get('popstate') ?? []) listener();
        });
      },
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
  });
  const destroy = router.destroy.bind(router);
  router.destroy = () => { alive = false; destroy(); listeners.clear(); };
  return router;
}
