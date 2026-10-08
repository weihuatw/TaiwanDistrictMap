import template from './map-shell.html?raw';
import type { BoundaryManifest, Padding, Rect, Region, RegionColor, RegionHit, View } from '../map-core/types';
import type { BasemapStatus } from '../map-core/create-map';

interface ShellOptions {
  onChoose: (region: Region) => void;
  onBack: () => void;
  onHome: () => void;
  onNavigate: (index: number) => void;
  onPanelChange: () => void;
  getColor?: RegionColor;
  brandTitle?: string;
  pageTitle?: string;
  rowMeta?: (region: Region) => string;
  sortRegions?: (regions: Region[]) => Region[];
  formatTooltip?: (hit: RegionHit) => string;
  showSelectionCard?: boolean;
  loadingText?: string;
  errorText?: string;
  sourceIntro?: string;
  renderSelectionDetails?: (region: Region | null, container: HTMLElement) => void;
  customList?: (view: View, query: string, list: HTMLElement) => { title: string; summary: string } | undefined;
}

/** Shared page chrome; map and data modules communicate through callbacks. */
export function createMapShell(root: HTMLElement, options: ShellOptions) {
  root.innerHTML = template;
  const el = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const element = root.querySelector<T>(`#${id}`);
    if (!element) throw new Error(`Missing map UI element: ${id}`);
    return element;
  };
  const lifetime = new AbortController();
  const mapContainer = el('map');
  const mobile = matchMedia('(max-width: 760px)');
  const infoPanel = el('info-toggle').closest<HTMLElement>('.location-panel')!;
  const infoContent = el('info-content');
  let collapsed = false;
  let sheetFrame = 0;
  function updateSheet() {
    infoPanel.classList.toggle('is-collapsed', collapsed);
    infoContent.inert = mobile.matches && collapsed;
    el('info-toggle').setAttribute('aria-expanded', String(!collapsed));
    el('info-toggle').setAttribute('aria-label', collapsed ? '展開地圖資訊' : '收折地圖資訊');
    if (sheetFrame) cancelAnimationFrame(sheetFrame);
    sheetFrame = requestAnimationFrame(() => {
      sheetFrame = 0;
      if (lifetime.signal.aborted) return;
      const visible = mobile.matches ? Math.max(0, innerHeight - infoPanel.getBoundingClientRect().top) : 0;
      root.style.setProperty('--info-visible-height', `${visible}px`);
      options.onPanelChange();
    });
  }
  let drag: { id: number; y: number; offset: number; max: number } | undefined;
  let suppressClick = false;
  const handle = el('info-toggle');
  handle.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') suppressClick = false;
  });
  handle.addEventListener('click', () => {
    if (suppressClick) { suppressClick = false; return; }
    suppressClick = false;
    collapsed = !collapsed; updateSheet();
  });
  handle.addEventListener('pointerdown', event => {
    if (!mobile.matches || event.button !== 0) return;
    suppressClick = false;
    const safeBottom = parseFloat(getComputedStyle(infoContent).paddingBottom) - 16;
    const max = Math.max(0, infoPanel.offsetHeight - 34 - safeBottom);
    drag = { id: event.pointerId, y: event.clientY, offset: collapsed ? max : 0, max };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId || Math.abs(event.clientY - drag.y) < 5) return;
    infoPanel.classList.add('is-dragging');
    infoPanel.style.transform = `translateY(${Math.max(0, Math.min(drag.max, drag.offset + event.clientY - drag.y))}px)`;
  });
  const finishDrag = () => { drag = undefined; infoPanel.classList.remove('is-dragging'); infoPanel.style.removeProperty('transform'); };
  handle.addEventListener('pointerup', event => {
    if (drag?.id !== event.pointerId) return;
    const distance = event.clientY - drag.y;
    if (Math.abs(distance) > 24) {
      collapsed = distance > 0; suppressClick = true; updateSheet();
    }
    finishDrag();
  });
  handle.addEventListener('pointercancel', () => { finishDrag(); updateSheet(); });
  // Move supporting cards into the scrollable sheet on phones, retaining desktop placement.
  function addMobileContent(element: HTMLElement) {
    const parent = element.parentElement!;
    const move = () => { (mobile.matches ? infoContent : parent).append(element); updateSheet(); };
    mobile.addEventListener('change', move, { signal: lifetime.signal }); move();
  }
  addMobileContent(el('selection-card'));
  mobile.addEventListener('change', updateSheet, { signal: lifetime.signal });
  const panelResize = new ResizeObserver(updateSheet); panelResize.observe(infoPanel);
  panelResize.observe(el('selection-card'));
  infoPanel.addEventListener('transitionend', updateSheet);
  if (options.brandTitle) el('brand-title').textContent = options.brandTitle;
  const currentPage = location.pathname.split('/').filter(Boolean).at(-1) ?? 'index.html';
  root.querySelectorAll<HTMLAnchorElement>('[data-map-page]').forEach((link) => {
    if (link.dataset.mapPage === currentPage) link.setAttribute('aria-current', 'page');
  });
  if (options.loadingText) el('loading-text').textContent = options.loadingText;
  if (options.sourceIntro) root.querySelector<HTMLElement>('.source-intro')!.textContent = options.sourceIntro;
  const getColor = options.getColor ?? ((region: Region) => region.properties.color);
  let view: View | null = null;
  let retry: (() => void) | null = null;
  const announce = (message: string) => { el('announcement').textContent = message; };
  const hideTooltip = () => { el('hover-tooltip').hidden = true; };
  const clearError = () => { el('error-banner').hidden = true; retry = null; };
  const setBusy = (loading: boolean) => {
    el('loading').hidden = !loading;
    mapContainer.setAttribute('aria-busy', String(loading));
    if (loading) hideTooltip();
  };
  const showError = (error: unknown, retryAction: () => void) => {
    retry = retryAction;
    // Upstream error messages may contain credentials; show only safe text.
    el('error-text').textContent = error instanceof Error && error.message === '此區域目前沒有下一層圖資'
      ? error.message : options.errorText ?? '行政區圖資載入失敗，請重試。';
    el('error-banner').hidden = false;
    announce('行政區圖資載入失敗。');
  };
  const showInitializationError = (retryAction: () => void) => {
    showError(null, retryAction);
    el('error-text').textContent = '無法啟動互動地圖，請確認瀏覽器支援 WebGL 後重新整理。';
  };
  const setBasemapStatus = (status: BasemapStatus) => {
    const messages = { preview: '圖資預覽 · TomTom 底圖尚未啟用', unavailable: 'TomTom 底圖載入失敗 · 行政區範圍仍可操作', ready: '' };
    el('basemap-status').textContent = messages[status];
    el('basemap-status').hidden = status === 'ready';
  };
  const showTooltip = (hit: RegionHit, point: { x: number; y: number }) => {
    const bounds = mapContainer.getBoundingClientRect();
    el('hover-tooltip').textContent = options.formatTooltip?.(hit) ?? `${hit.parentIndex !== undefined ? '切換至 ' : ''}${hit.region.properties.name}`;
    el('hover-tooltip').style.left = `${Math.min(bounds.left + point.x + 15, innerWidth - 140)}px`;
    el('hover-tooltip').style.top = `${Math.min(bounds.top + point.y + 15, innerHeight - 45)}px`;
    el('hover-tooltip').hidden = false;
  };
  const getPadding = (): Padding => innerWidth <= 760
    ? { top: 55, right: 55, bottom: Math.min(innerHeight * .45, Math.max(34, innerHeight - infoPanel.getBoundingClientRect().top)) + 20, left: 20 }
    : { top: 70, right: 90, bottom: 90, left: 355 };
  const getLabelObstacles = (): Rect[] => {
    const origin = mapContainer.getBoundingClientRect();
    const location = el('location-title').closest('.location-panel')!.getBoundingClientRect();
    const rectangles = [{ x: location.left - origin.left - 8, y: location.top - origin.top - 8, w: location.width + 16, h: location.height + 16 }];
    if (!el('region-panel').hidden) {
      const panel = el('region-panel').getBoundingClientRect();
      rectangles.push({ x: panel.x - origin.left, y: panel.y - origin.top, w: panel.width, h: panel.height });
    }
    if (!el('selection-card').hidden) {
      const card = el('selection-card').getBoundingClientRect();
      rectangles.push({ x: card.x - origin.left, y: card.y - origin.top, w: card.width, h: card.height });
    }
    return rectangles;
  };
  function render(current: View) {
    view = current; clearError();
    const title = current.selected?.properties.name ?? current.path.at(-1)?.properties.name ?? '臺灣';
    el('location-title').textContent = title;
    document.title = `${title}｜${options.pageTitle ?? '臺灣行政區地圖'}`;
    const levelLabels = { county: '縣市', town: '鄉鎮市區', village: '村里', detail: '村里' };
    el('level-badge').textContent = levelLabels[current.level];
    el('region-count').textContent = current.level === 'detail'
      ? `代碼 ${current.selected!.properties.code}`
      : `${current.data.features.length} 個${levelLabels[current.level]}${current.level === 'village' ? '範圍' : ''}`;
    el('back-button').hidden = current.level === 'county';
    const previous = current.path.length > 1 ? current.path.at(-2)!.properties.name : '全臺';
    el('back-label').textContent = `返回${previous}`;
    const crumbs = el('breadcrumbs'); crumbs.replaceChildren();
    const names = ['全臺', ...current.path.map((f) => f.properties.name)];
    for (const [i, name] of names.entries()) {
      if (i) { const separator = document.createElement('span'); separator.className = 'breadcrumb-divider'; separator.textContent = '›'; crumbs.append(separator); }
      if (i < names.length - 1) {
        const button = document.createElement('button'); button.textContent = name;
        button.addEventListener('click', () => options.onNavigate(i)); crumbs.append(button);
      } else { const span = document.createElement('span'); span.textContent = name; span.setAttribute('aria-current', 'location'); crumbs.append(span); }
    }
    el('hint-text').textContent = current.level === 'county' ? '點選縣市，探索下一層行政區'
      : current.level === 'town' ? '點選行政區查看村里 · 灰色縣市可直接切換'
      : current.level === 'village' ? '點選村里查看範圍 · 灰色區域可直接切換' : '點選灰色區域切換，或返回上一層';
    const selected = current.selected;
    el('selection-card').hidden = !selected || options.showSelectionCard === false;
    if (selected) {
      el('selection-swatch').style.background = getColor(selected);
      el('selection-path').textContent = `${selected.properties.countyName} › ${selected.properties.townName}`;
      el('selection-name').textContent = selected.properties.name;
      el('selection-description').textContent = selected.properties.unassigned
        ? `官方未編定村里範圍 · ${selected.properties.code}`
        : `村里代碼 ${selected.properties.code}${selected.properties.note ? ` · ${selected.properties.note}` : ''}`;
    }
    const extra = el('selection-extra');
    extra.replaceChildren();
    options.renderSelectionDetails?.(selected, extra);
    el<HTMLInputElement>('region-search').value = '';
    renderList(); announce(`目前顯示${title}，${el('region-count').textContent}`);
  }

  function renderList() {
    if (!view) return;
    const actualLevel = view.level === 'detail' ? 'village' : view.level;
    el('list-title').textContent = { county: '選擇縣市', town: '選擇鄉鎮市區', village: '選擇村里' }[actualLevel];
    const normalize = (value: string) => value.replaceAll('台', '臺').toLowerCase();
    const query = normalize(el<HTMLInputElement>('region-search').value.trim());
    const custom = options.customList?.(view, query, el('region-list'));
    if (custom) {
      el('list-title').textContent = custom.title;
      el('list-summary').textContent = custom.summary;
      return;
    }
    const matches = view.data.features.filter((f) => normalize(`${f.properties.name} ${f.properties.code}`).includes(query));
    const visible = options.sortRegions?.(matches) ?? matches;
    el('list-summary').textContent = `${visible.length} / ${view.data.features.length} 個範圍`;
    const list = el('region-list'); list.replaceChildren();
    for (const region of visible) {
      const p = region.properties;
      const button = document.createElement('button'); button.className = 'region-option'; button.dataset.code = p.code;
      button.setAttribute('aria-label', `${p.name}${p.unassigned ? ` ${p.code}` : ''}`);
      button.setAttribute('aria-pressed', String(view.selected?.id === region.id));
      const swatch = document.createElement('span'); swatch.className = 'region-swatch'; swatch.style.background = getColor(region); swatch.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span'); name.className = 'region-option-name'; name.textContent = p.name;
      const meta = document.createElement('span'); meta.className = 'region-option-meta';
      meta.textContent = options.rowMeta?.(region) ?? (p.childCount !== undefined ? `${p.childCount} ${actualLevel === 'county' ? '鄉鎮市區' : '村里'}` : p.unassigned ? p.code.slice(-3) : '');
      const arrow = document.createElement('span'); arrow.className = 'region-option-arrow'; arrow.textContent = '›'; arrow.setAttribute('aria-hidden', 'true');
      button.append(swatch, name, meta, arrow);
      button.addEventListener('click', () => { options.onChoose(region); if (innerWidth <= 760) toggleList(false); });
      list.append(button);
    }
    if (!visible.length) { const empty = document.createElement('p'); empty.className = 'empty-list'; empty.textContent = '找不到符合的區域，請試試名稱或行政區代碼。'; list.append(empty); }
    list.scrollTop = 0;
  }

  function toggleList(open = el('region-panel').hidden) {
    el('region-panel').hidden = !open;
    el('list-toggle').setAttribute('aria-expanded', String(open));
    if (open) el('region-search').focus();
    options.onPanelChange();
  }


  function renderManifest(manifest: BoundaryManifest) {
      const content = el('source-content'); content.replaceChildren();
      for (const source of manifest.sources) {
        const row = document.createElement('div'); row.className = 'source-row';
        const link = document.createElement('a'); link.href = source.datasetUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = `${source.title} ↗`;
        const detail = document.createElement('p'); detail.textContent = `發布檔案：${source.releaseFile}\n入口詮釋資料更新：${source.metadataUpdated}`; detail.style.whiteSpace = 'pre-line';
        row.append(link, detail); content.append(row);
      }
      const totals = document.createElement('p'); totals.className = 'source-footnote';
      totals.textContent = `${manifest.counts.county} 縣市 · ${manifest.counts.town} 鄉鎮市區 · ${manifest.counts.village.toLocaleString()} 村里圖形（含 ${manifest.unassignedCount} 個未編定範圍）。${manifest.notes[0]}`;
      content.append(totals);

  }
  function showManifestError() { el('source-content').textContent = '資料版本資訊暫時無法載入，重新整理頁面後可再試。'; }

  el('list-toggle').addEventListener('click', () => toggleList());
  el('list-close').addEventListener('click', () => toggleList(false));
  el('back-button').addEventListener('click', () => options.onBack());
  el('home-button').addEventListener('click', () => options.onHome());
  el('region-search').addEventListener('input', renderList);
  el('retry-button').addEventListener('click', () => retry?.());
  el('error-close').addEventListener('click', () => { clearError(); });
  const sourceDialog = el<HTMLDialogElement>('source-dialog');
  el('source-button').addEventListener('click', () => sourceDialog.showModal());
  el('source-close').addEventListener('click', () => sourceDialog.close());
  sourceDialog.addEventListener('click', (event) => {
    const rect = sourceDialog.getBoundingClientRect();
    if (event.target === sourceDialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) sourceDialog.close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || sourceDialog.open) return;
    if (!el('region-panel').hidden) toggleList(false);
    else options.onBack();
  }, { signal: lifetime.signal });

  return {
    root,
    viewExtra: el('view-extra'),
    uiContainer: root.querySelector<HTMLElement>('.map-ui')!,
    sourceContent: el('source-content'),
    mapContainer, render, setBusy, showError, showInitializationError, setBasemapStatus,
    refreshList: renderList,
    addMobileContent,
    showTooltip, hideTooltip, getPadding, getLabelObstacles,
    renderManifest, showManifestError,
    markMapReady: () => { mapContainer.dataset.ready = 'true'; },
    destroy: () => { lifetime.abort(); panelResize.disconnect(); if (sheetFrame) cancelAnimationFrame(sheetFrame); root.style.removeProperty('--info-visible-height'); root.replaceChildren(); },
  };
}
