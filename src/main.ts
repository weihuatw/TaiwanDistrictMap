import './ui/style.css';
import { HashRouter, type Theme } from './routing/hash-router';
import type { ThemeAppLoader } from './routing/theme-app-host';
import { createComparisonWorkspace } from './comparison/workspace';

const rootElement = document.getElementById('app');
if (!rootElement) throw new Error('Missing application root');
const root = rootElement;
if (location.pathname.endsWith('/index.html')) history.replaceState(history.state, '', import.meta.env.BASE_URL + location.search + location.hash);
const routing = new HashRouter(window);
const loaders = (root: HTMLElement, routing: HashRouter): Record<Theme, ThemeAppLoader> => ({
  admin: () => import('./apps/admin/main').then(({ startAdminApp }) => () => startAdminApp(root, routing)),
  population: () => import('./apps/population/main').then(({ startPopulationApp }) => () => startPopulationApp(root, routing)),
  income: () => import('./apps/income/main').then(({ startIncomeApp }) => () => startIncomeApp(root, routing)),
  school: () => import('./apps/school/main').then(({ startSchoolApp }) => () => startSchoolApp(root, routing)),
  housing: () => import('./apps/housing/main').then(({ startHousingApp }) => () => startHousingApp(root, routing)),
  politics: () => import('./apps/politics/main').then(({ startPoliticsApp }) => () => startPoliticsApp(root, routing)),
  indigenous: () => import('./apps/indigenous/main').then(({ startIndigenousApp }) => () => startIndigenousApp(root, routing)),
  traffic: () => import('./apps/traffic/main').then(({ startTrafficApp }) => () => startTrafficApp(root, routing)),
  crime: () => import('./apps/crime/main').then(({ startCrimeApp }) => () => startCrimeApp(root, routing)),
});

const workspace = createComparisonWorkspace(root, routing, loaders);
import.meta.hot?.dispose(() => { workspace.destroy(); routing.destroy(); });
