import './ui/style.css';
import './apps/income/style.css';
import './apps/school/style.css';
import './apps/housing/style.css';
import './apps/politics/style.css';
import { startAdminApp } from './apps/admin/main';
import { startIncomeApp } from './apps/income/main';
import { startSchoolApp } from './apps/school/main';
import { startHousingApp } from './apps/housing/main';
import { startPoliticsApp } from './apps/politics/main';
import { HashRouter, type Theme } from './routing/hash-router';

const root = document.getElementById('app');
if (!root) throw new Error('Missing application root');
if (location.pathname.endsWith('/index.html')) history.replaceState(history.state, '', import.meta.env.BASE_URL + location.search + location.hash);
const routing = new HashRouter(window);
const starters = {
  admin: startAdminApp,
  income: startIncomeApp,
  school: startSchoolApp,
  housing: startHousingApp,
  politics: startPoliticsApp,
};
let app: ReturnType<typeof startAdminApp> | undefined;
let theme: Theme | undefined;

// Keep the startup graph static: Vite can preload SDK, theme code and CSS from HTML.
// Async CSS followed by a dynamic import adds two discovery rounds before the shell.
routing.subscribe(route => {
  if (app && theme === route.theme) { void app.restoreRoute(route); return; }
  app?.destroy(); theme = route.theme;
  root.className = '';
  app = starters[route.theme](root, routing);
});
import.meta.hot?.dispose(() => { app?.destroy(); routing.destroy(); });
