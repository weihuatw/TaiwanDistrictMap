import './ui/style.css';
import { HashRouter, type Theme } from './routing/hash-router';
import { createThemeAppHost, type ThemeAppLoader } from './routing/theme-app-host';

const rootElement = document.getElementById('app');
if (!rootElement) throw new Error('Missing application root');
const root = rootElement;
if (location.pathname.endsWith('/index.html')) history.replaceState(history.state, '', import.meta.env.BASE_URL + location.search + location.hash);
const routing = new HashRouter(window);
const loaders: Record<Theme, ThemeAppLoader> = {
  admin: () => import('./apps/admin/main').then(({ startAdminApp }) => () => startAdminApp(root, routing)),
  income: () => import('./apps/income/main').then(({ startIncomeApp }) => () => startIncomeApp(root, routing)),
  school: () => import('./apps/school/main').then(({ startSchoolApp }) => () => startSchoolApp(root, routing)),
  housing: () => import('./apps/housing/main').then(({ startHousingApp }) => () => startHousingApp(root, routing)),
  politics: () => import('./apps/politics/main').then(({ startPoliticsApp }) => () => startPoliticsApp(root, routing)),
};

function showLoading() {
  root.className = '';
  root.innerHTML = '<div class="loading-pill" role="status"><span class="spinner" aria-hidden="true"></span><span>載入地圖…</span></div>';
}

function showLoadError(retry: () => void) {
  root.className = '';
  root.innerHTML = '<div class="error-banner" role="alert"><span>地圖程式載入失敗，請重試。</span><button type="button">重試</button></div>';
  root.querySelector('button')?.addEventListener('click', retry, { once: true });
}

const appHost = createThemeAppHost(routing, loaders, showLoading, showLoadError);
routing.subscribe(route => appHost.activate(route));
import.meta.hot?.dispose(() => { appHost.destroy(); routing.destroy(); });
