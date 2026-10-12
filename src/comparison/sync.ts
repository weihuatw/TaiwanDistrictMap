import type { Camera } from '../map-core/types.ts';
import { routeHash, transferTheme, type Route } from '../routing/hash-router.ts';

export function comparisonRoute(source: Route, target: Route): Route {
  const route = source.theme === target.theme
    ? { ...target, ids: [...source.ids] }
    : transferTheme(source, target.theme, target.query);
  if (target.theme === 'population' && new URLSearchParams(target.query).get('metric') === 'density') route.ids = route.ids.slice(0, 2);
  return route;
}

export interface SyncPane {
  route(): Route;
  camera(): Camera | undefined;
  navigate(route: Route, camera?: Camera): void;
  move(camera: Camera): void;
}

/** Only the pane owning the latest user interaction may broadcast changes.
 * Applying a camera is also guarded synchronously: jumpTo emits move events.
 * Late data/style completion in the follower replays the owner's camera.
 */
export function createComparisonSync(panes: [SyncPane, SyncPane]) {
  let enabled = false, owner: 0 | 1 = 0, applying = false;
  const pending: [Route | undefined, Route | undefined] = [undefined, undefined];
  const previous: [Route | undefined, Route | undefined] = [undefined, undefined];
  let location: Route | undefined;
  function copyCamera() {
    if (!enabled || applying) return;
    const camera = panes[owner].camera();
    if (!camera) return;
    applying = true;
    try { panes[owner === 0 ? 1 : 0].move(camera); }
    finally { applying = false; }
  }
  function copyRoute() {
    if (!enabled || applying) return;
    const index = owner === 0 ? 1 : 0;
    const target = panes[index];
    const route = comparisonRoute(location ?? panes[owner].route(), target.route());
    if (routeHash(route) !== routeHash(target.route())) {
      pending[index] = route;
      target.navigate(route, panes[owner].camera());
    }
  }
  return {
    get owner() { return owner; },
    get enabled() { return enabled; },
    get location() { return location ?? panes[owner].route(); },
    interact(index: 0 | 1) { if (!applying) owner = index; },
    setEnabled(value: boolean) {
      enabled = value;
      if (value) {
        location = panes[owner].route(); previous[0] = panes[0].route(); previous[1] = panes[1].route();
        copyRoute(); copyCamera();
      } else { pending[0] = pending[1] = undefined; location = undefined; }
    },
    committed(index: 0 | 1) {
      const route = panes[index].route(), expected = pending[index];
      const replicated = expected?.theme === route.theme && expected.ids.join('/') === route.ids.join('/');
      pending[index] = undefined;
      const old = previous[index]; previous[index] = route;
      // Changing theme or its filters is independent of geographic selection.
      // In particular density can normalize a village path to its town without
      // asking the other pane to discard the selected village.
      const preference = old && (old.theme !== route.theme || old.query !== route.query)
        && location && comparisonRoute(location, route).ids.join('/') === route.ids.join('/');
      if (index === owner && !replicated && !preference) location = route;
      if ((!replicated && index === owner) || preference) copyRoute();
      copyCamera();
    },
    moved(index: 0 | 1) { if (index === owner) copyCamera(); },
    refresh: copyCamera,
  };
}
