import type { HashRouter, Route, Theme } from './hash-router';

interface ThemeApp {
  restoreRoute(route: Route): unknown;
  destroy(): void;
}

export type ThemeAppLoader = () => Promise<() => ThemeApp>;

/** Loads only the selected theme and ignores imports made stale by a later route. */
export function createThemeAppHost(
  router: HashRouter,
  loaders: Record<Theme, ThemeAppLoader>,
  showLoading: () => void,
  showLoadError: (retry: () => void) => void,
) {
  let app: ThemeApp | undefined;
  let activeTheme: Theme | undefined;
  let loadingTheme: Theme | undefined;
  let request = 0;
  let disposed = false;

  function activate(route: Route) {
    if (app && activeTheme === route.theme) {
      void app.restoreRoute(route);
      return;
    }
    if (loadingTheme === route.theme) return;

    const currentRequest = ++request;
    loadingTheme = route.theme;
    activeTheme = undefined;
    app?.destroy();
    app = undefined;
    showLoading();

    void loaders[route.theme]().then(start => {
      if (disposed || currentRequest !== request || router.current.theme !== route.theme) return;
      loadingTheme = undefined;
      activeTheme = route.theme;
      app = start();
    }).catch(() => {
      if (disposed || currentRequest !== request) return;
      loadingTheme = undefined;
      showLoadError(() => activate(router.current));
    });
  }

  function destroy() {
    disposed = true;
    request++;
    app?.destroy();
    app = undefined;
    loadingTheme = undefined;
    activeTheme = undefined;
  }

  return { activate, destroy };
}
