import './style.css';
import type { Map } from 'maplibre-gl';
import type { Camera } from '../map-core/types';
import { HashRouter, themes, type Route, type Theme } from '../routing/hash-router';
import { createLocalRouter } from '../routing/local-router';
import { createThemeAppHost, type ThemeAppLoader } from '../routing/theme-app-host';
import { comparisonRoute, createComparisonSync, type SyncPane } from './sync';

const labels: Record<Theme, string> = { admin: '行政區', population: '人口', income: '所得', school: '學區', housing: '房價', politics: '政黨', indigenous: '原住民', traffic: '交通事故' };
type Loaders = (root: HTMLElement, routing: HashRouter) => Record<Theme, ThemeAppLoader>;

export function createComparisonWorkspace(root: HTMLElement, routing: HashRouter, loaders: Loaders) {
  const lifetime = new AbortController(), desktop = matchMedia('(min-width: 761px)');
  const workspace = document.createElement('div'); workspace.className = 'comparison-workspace';
  workspace.innerHTML = `<div class="comparison-settings">
    <button type="button" class="comparison-toggle" aria-expanded="false" aria-controls="comparison-settings-panel">地圖比較</button>
    <div id="comparison-settings-panel" class="comparison-controls" role="region" aria-label="地圖比較設定" hidden>
    <div class="comparison-heading"><span class="comparison-title">地圖比較</span><button type="button" class="close-button comparison-close" aria-label="關閉比較設定">×</button></div>
    <label>畫面 <select aria-label="地圖畫面模式"><option value="single">單一地圖</option><option value="dual">雙地圖</option></select></label>
    <label><span class="left-setting-label">主題</span> <select aria-label="左側地圖主題"></select></label>
    <label class="right-setting" hidden>右側 <select aria-label="右側地圖主題"></select></label>
    <label class="sync-setting" hidden><input type="checkbox" checked>保持同步</label>
    <label><input class="cards-setting" type="checkbox" checked>顯示資訊卡</label>
  </div></div><div class="comparison-stage">
    <section class="comparison-pane" aria-label="左側地圖" data-active="true"><span class="comparison-pane-label" hidden></span></section>
    <section class="comparison-pane" aria-label="右側地圖" hidden><span class="comparison-pane-label" hidden></span><div id="comparison-right" class="pane-content"></div></section>
    <button type="button" class="comparison-divider" role="separator" aria-label="調整左右地圖寬度" aria-orientation="vertical" aria-valuemin="25" aria-valuemax="75" aria-valuenow="50" hidden><span aria-hidden="true">⋮</span></button>
  </div>`;
  root.before(workspace);
  const panes = [...workspace.querySelectorAll<HTMLElement>('.comparison-pane')] as [HTMLElement, HTMLElement];
  panes[0].append(root); root.classList.add('pane-content');
  const roots: [HTMLElement, HTMLElement] = [root, workspace.querySelector<HTMLElement>('#comparison-right')!];
  const selects = [...workspace.querySelectorAll<HTMLSelectElement>('select')];
  const modeSelect = selects[0], themeSelects = selects.slice(1);
  const syncInput = workspace.querySelector<HTMLInputElement>('.sync-setting input')!;
  const cardsInput = workspace.querySelector<HTMLInputElement>('.cards-setting')!;
  const divider = workspace.querySelector<HTMLElement>('.comparison-divider')!;
  const settings = workspace.querySelector<HTMLElement>('.comparison-settings')!;
  const settingsPanel = workspace.querySelector<HTMLElement>('.comparison-controls')!;
  const settingsToggle = workspace.querySelector<HTMLButtonElement>('.comparison-toggle')!;
  const paneLabels = [...workspace.querySelectorAll<HTMLElement>('.comparison-pane-label')];
  function setSettingsOpen(open: boolean, restoreFocus = false) {
    settingsPanel.hidden = !open;
    settingsToggle.setAttribute('aria-expanded', String(open));
    if (restoreFocus) settingsToggle.focus();
  }
  settingsToggle.addEventListener('click', () => setSettingsOpen(settingsPanel.hidden), { signal: lifetime.signal });
  workspace.querySelector('.comparison-close')!.addEventListener('click', () => setSettingsOpen(false, true), { signal: lifetime.signal });
  document.addEventListener('pointerdown', event => {
    if (!settingsPanel.hidden && !settings.contains(event.target as Node)) setSettingsOpen(false);
  }, { capture: true, signal: lifetime.signal });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !settingsPanel.hidden) {
      event.preventDefault(); event.stopPropagation(); setSettingsOpen(false, true);
    }
  }, { capture: true, signal: lifetime.signal });
  settings.addEventListener('focusout', event => {
    if (event.relatedTarget && !settings.contains(event.relatedTarget as Node)) setSettingsOpen(false);
  }, { signal: lifetime.signal });
  for (const select of themeSelects) for (const theme of themes) {
    const option = document.createElement('option'); option.value = theme; option.textContent = labels[theme]; select.append(option);
  }
  const routers: [HashRouter, HashRouter | undefined] = [routing, undefined];
  const maps: [Map | undefined, Map | undefined] = [undefined, undefined];
  const detach: [(() => void) | undefined, (() => void) | undefined] = [undefined, undefined];
  let dual = false, ratio = 50, frame = 0, alive = true;
  let rightHost: ReturnType<typeof createThemeAppHost> | undefined;
  let rightRoute: Route | undefined;
  function updateSettingsStatus() {
    settingsToggle.textContent = dual ? `比較中 · ${syncInput.checked ? '同步' : '獨立'}` : '地圖比較';
    settingsToggle.setAttribute('aria-label', dual ? `${settingsToggle.textContent}，開啟地圖比較設定` : '地圖比較');
    workspace.querySelector('.left-setting-label')!.textContent = dual ? '左側' : '主題';
    for (const index of [0, 1] as const) {
      paneLabels[index].hidden = !dual;
      paneLabels[index].textContent = `${index === 0 ? '左' : '右'} · ${labels[themeSelects[index].value as Theme] ?? ''}`;
    }
  }
  const readCamera = (index: 0 | 1): Camera | undefined => {
    const map = maps[index]; if (!map) return;
    const center = map.getCenter();
    return { center: [center.lng, center.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
  };
  const adapters = ([0, 1] as const).map(index => ({
    route: () => routers[index]!.current,
    camera: () => readCamera(index),
    navigate: (route: Route, camera?: Camera) => routers[index]?.navigate(route, camera),
    move: (camera: Camera) => {
      const map = maps[index]; if (!map) return;
      const current = readCamera(index)!;
      if (current.center.every((v, i) => Math.abs(v - camera.center[i]) < 1e-9)
        && Math.abs(current.zoom - camera.zoom) < 1e-9 && current.bearing === camera.bearing && current.pitch === camera.pitch && !map.isMoving()) return;
      map.jumpTo({ ...camera, padding: { top: 0, right: 0, bottom: 0, left: 0 } }, { comparisonSync: true });
    },
  })) as [SyncPane, SyncPane];
  const sync = createComparisonSync(adapters);
  function scheduleRefresh() {
    if (frame || !alive) return;
    frame = requestAnimationFrame(() => { frame = 0; if (alive) sync.refresh(); });
  }
  function updateNote() {
    for (const index of [0, 1] as const) {
      let note = panes[index].querySelector<HTMLElement>('.comparison-note');
      const source = dual && sync.enabled ? sync.location : routers[sync.owner]?.current, target = routers[index]?.current;
      const limited = source && target && source.theme !== 'school'
        && source.ids.length > comparisonRoute(source, target).ids.length;
      if (!note) { note = document.createElement('div'); note.className = 'comparison-note'; note.setAttribute('role', 'status'); panes[index].append(note); }
      note.hidden = !dual || !sync.enabled || !limited;
      note.textContent = '此主題資料止於鄉鎮市區；視角仍與另一側同步。';
    }
  }
  function bindMap(index: 0 | 1, map: Map | undefined) {
    detach[index]?.(); detach[index] = undefined; maps[index] = map;
    if (!map) return;
    const move = () => sync.moved(index);
    const refresh = () => scheduleRefresh();
    map.on('move', move); map.on('style.load', refresh); map.on('resize', refresh);
    detach[index] = () => { map.off('move', move); map.off('style.load', refresh); map.off('resize', refresh); };
    scheduleRefresh();
  }
  function showLoading(index: 0 | 1) {
    roots[index].className = 'pane-content';
    roots[index].innerHTML = '<div class="loading-pill" role="status"><span class="spinner" aria-hidden="true"></span><span>載入地圖…</span></div>';
  }
  function showError(index: 0 | 1) {
    roots[index].innerHTML = '<div class="error-banner" role="alert"><span>地圖程式載入失敗，請重試。</span><button type="button">重試</button></div>';
    roots[index].querySelector('button')?.addEventListener('click', () => location.reload(), { once: true });
  }
  function observe(index: 0 | 1, router: HashRouter) {
    return router.observeCommits(() => {
      queueMicrotask(() => {
        if (!alive || index === 1 && !dual) return;
        themeSelects[index].value = router.current.theme;
        updateSettingsStatus();
        if (dual) { sync.committed(index); updateNote(); scheduleRefresh(); }
      });
    });
  }
  const stopLeft = observe(0, routing);
  let stopRight: (() => void) | undefined;
  const leftHost = createThemeAppHost(routing, loaders(root, routing), () => showLoading(0), () => showError(0), app => bindMap(0, app?.map));
  routing.subscribe(route => {
    if (routing.isHistoryNavigation) {
      sync.interact(0); panes[0].dataset.active = 'true'; panes[1].dataset.active = 'false';
    }
    themeSelects[0].value = route.theme; updateSettingsStatus(); leftHost.activate(route);
  });
  function resizeMaps() {
    for (const map of maps) map?.resize({ preserveViewport: true });
    roots.forEach(element => element.dispatchEvent(new Event('comparisonlayout')));
    scheduleRefresh();
  }
  const resize = new ResizeObserver(resizeMaps); panes.forEach(pane => resize.observe(pane));
  function setDual(value: boolean) {
    dual = value && desktop.matches;
    modeSelect.value = dual ? 'dual' : 'single'; workspace.classList.toggle('comparison-dual', dual);
    panes[1].hidden = !dual; divider.hidden = !dual;
    workspace.querySelectorAll<HTMLElement>('.right-setting, .sync-setting').forEach(element => { element.hidden = !dual; });
    if (dual) {
      panes[0].dataset.active = 'true'; panes[1].dataset.active = 'false';
      const initial = rightRoute ?? routing.themeRoute(routing.current.theme === 'income' ? 'population' : 'income');
      const route = syncInput.checked ? comparisonRoute(routing.current, initial) : initial;
      const router = createLocalRouter(route); routers[1] = router;
      stopRight = observe(1, router);
      rightHost = createThemeAppHost(router, loaders(roots[1], router), () => showLoading(1), () => showError(1), app => bindMap(1, app?.map));
      router.subscribe(next => { themeSelects[1].value = next.theme; updateSettingsStatus(); rightHost?.activate(next); });
      sync.interact(0); sync.setEnabled(syncInput.checked);
    } else {
      sync.setEnabled(false); rightRoute = routers[1]?.current ?? rightRoute;
      stopRight?.(); rightHost?.destroy(); routers[1]?.destroy();
      rightHost = undefined; routers[1] = undefined; roots[1].className = 'pane-content';
    }
    updateSettingsStatus(); updateNote(); resizeMaps();
  }
  modeSelect.addEventListener('change', () => setDual(modeSelect.value === 'dual'), { signal: lifetime.signal });
  cardsInput.addEventListener('change', () => { workspace.classList.toggle('cards-hidden', !cardsInput.checked); resizeMaps(); }, { signal: lifetime.signal });
  syncInput.addEventListener('change', () => { sync.setEnabled(dual && syncInput.checked); updateSettingsStatus(); updateNote(); scheduleRefresh(); }, { signal: lifetime.signal });
  for (const index of [0, 1] as const) {
    const interact = () => {
      sync.interact(index); panes.forEach((pane, i) => { pane.dataset.active = String(i === index); });
      updateNote();
    };
    for (const type of ['pointerdown', 'wheel', 'keydown']) panes[index].addEventListener(type, interact, { capture: true, signal: lifetime.signal });
    themeSelects[index].addEventListener('change', () => {
      const router = routers[index]; if (!router) return;
      const theme = themeSelects[index].value as Theme;
      const next = router.themeRoute(theme);
      const route = sync.enabled ? comparisonRoute(sync.location, next) : next;
      router.navigate(route, readCamera(index));
    }, { signal: lifetime.signal });
  }
  function setRatio(value: number) {
    ratio = Math.max(25, Math.min(75, value)); workspace.style.setProperty('--split-ratio', `${ratio}%`);
    divider.setAttribute('aria-valuenow', String(Math.round(ratio))); resizeMaps();
  }
  let pointer: number | undefined;
  divider.addEventListener('pointerdown', event => {
    if (event.button !== 0) return; pointer = event.pointerId; divider.setPointerCapture(pointer); event.preventDefault();
  }, { signal: lifetime.signal });
  divider.addEventListener('pointermove', event => {
    if (event.pointerId !== pointer) return;
    const bounds = workspace.getBoundingClientRect(); setRatio((event.clientX - bounds.left) / bounds.width * 100);
  }, { signal: lifetime.signal });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) divider.addEventListener(type, () => { pointer = undefined; }, { signal: lifetime.signal });
  divider.addEventListener('dblclick', () => setRatio(50), { signal: lifetime.signal });
  divider.addEventListener('keydown', event => {
    const key = (event as KeyboardEvent).key;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return;
    event.preventDefault(); setRatio(key === 'Home' ? 25 : key === 'End' ? 75 : ratio + (key === 'ArrowLeft' ? -2 : 2));
  }, { signal: lifetime.signal });
  desktop.addEventListener('change', () => {
    if (!desktop.matches) {
      setSettingsOpen(false);
      if (dual) setDual(false);
      cardsInput.checked = true; workspace.classList.remove('cards-hidden'); resizeMaps();
    }
  }, { signal: lifetime.signal });
  return { destroy() {
    alive = false; lifetime.abort(); resize.disconnect(); if (frame) cancelAnimationFrame(frame);
    stopLeft(); stopRight?.(); sync.setEnabled(false); detach.forEach(fn => fn?.());
    leftHost.destroy(); rightHost?.destroy(); routers[1]?.destroy();
    workspace.before(root); workspace.remove();
  } };
}
