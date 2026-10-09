import './ui/style.css';
import { HashRouter, type Route, type Theme } from './routing/hash-router';

const root = document.getElementById('app');
if (!root) throw new Error('Missing application root');
if (location.pathname.endsWith('/index.html')) history.replaceState(history.state, '', import.meta.env.BASE_URL + location.search + location.hash);
const routing = new HashRouter(window);
let app: { destroy(): void; restoreRoute(route: Route): Promise<void> } | undefined;
let theme: Theme | undefined;
let sequence = 0;
const loaders = {
  admin: async () => (await import('./apps/admin/main')).startAdminApp,
  income: async () => { await import('./apps/income/style.css'); return (await import('./apps/income/main')).startIncomeApp; },
  school: async () => { await import('./apps/school/style.css'); return (await import('./apps/school/main')).startSchoolApp; },
  housing: async () => { await import('./apps/housing/style.css'); return (await import('./apps/housing/main')).startHousingApp; },
  politics: async () => { await import('./apps/politics/style.css'); return (await import('./apps/politics/main')).startPoliticsApp; },
};
routing.subscribe(route => {
  if (app && theme === route.theme) { void app.restoreRoute(route); return; }
  const token = ++sequence;
  app?.destroy(); app = undefined; theme = route.theme;
  root.className = ''; root.textContent = '載入地圖…';
  void loaders[route.theme]().then(start => {
    if (token !== sequence) return;
    app = start(root, routing);
  }).catch(() => { if (token === sequence) root.textContent = '地圖載入失敗，請重新整理。'; });
});
import.meta.hot?.dispose(() => { ++sequence; app?.destroy(); routing.destroy(); });
