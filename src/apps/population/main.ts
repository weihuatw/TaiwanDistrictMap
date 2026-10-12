import './style.css';
import type { HashRouter, Route } from '../../routing/hash-router';
import { PopulationRepository, type PopulationManifest, type PopulationRecord } from '../../data/population';
import { AnnualPopulationRepository, type AnnualPopulationManifest, type AnnualPopulationRecord } from '../../data/population-annual';
import { BoundaryRepository } from '../../map-core/boundaries';
import { createMap } from '../../map-core/create-map';
import { RegionNavigator } from '../../map-core/navigation';
import { createRegionLayer } from '../../map-core/region-layer';
import type { Camera, Region, View } from '../../map-core/types';
import { createMapShell } from '../../ui/map-shell';
import { createPopulationMapPanel } from './panel';
import { DEFAULT_ANNUAL_YEAR, formatValue, isAnnualMetric, metricPath, metricLabels, metricValue, parseMetric, parsePopulationYear, recordColor, type PopulationMetric } from './theme';

const YEAR_DWELL_MS = 2_000;
const YEAR_COLOR_TRANSITION_MS = 400;
const yearColorTransitionDuration = () => matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : YEAR_COLOR_TRANSITION_MS;

export function startPopulationApp(root: HTMLElement, routing?: HashRouter) {
  const base = import.meta.env.BASE_URL;
  const boundaries = new BoundaryRepository(`${base}data/`), population = new PopulationRepository(`${base}data/population/`);
  const annual = new AnnualPopulationRepository(`${base}data/population/annual/`);
  let metric = parseMetric(routing?.current.query ?? ''), requestedMetric = metric;
  let year = parsePopulationYear(routing?.current.query ?? '') ?? DEFAULT_ANNUAL_YEAR, requestedYear = year;
  let availableYears: number[] = [];
  let annualManifest: AnnualPopulationManifest | undefined, annualNational: AnnualPopulationRecord | undefined;
  let metricRestore: { ids: string; camera?: Camera; data: View['data']; search: string } | undefined;
  let manifest: PopulationManifest, national: PopulationRecord | null = null, alive = true;
  let layer: ReturnType<typeof createRegionLayer> | undefined, basemap: ReturnType<typeof createMap> | undefined;
  let playbackState: 'idle' | 'preparing' | 'playing' = 'idle';
  let playbackRun = 0, playbackTimer: number | undefined;
  const value = (region: Region) => metricValue(region.properties.unassigned ? null : population.get(region.properties.code), metric, region.properties.unassigned ? null : annual.get(region.properties.code, year));
  const getColor = (region: Region) => recordColor(region.properties.unassigned ? null : population.get(region.properties.code), metric, region.properties.level, region.properties.unassigned ? null : annual.get(region.properties.code, year));
  const idsFor = (view: View) => [...view.path.map(region => region.properties.code), ...(view.level === 'town' && view.selected ? [view.selected.properties.code] : [])];
  const routeFor = (view: View): Route => ({ theme: 'population', ids: idsFor(view),
    query: new URLSearchParams({ metric, year: String(year) }).toString() });
  const shell = createMapShell(root, {
    routing, getCamera: () => layer?.ready && navigator.current ? layer.camera() : undefined, brandTitle: '人口地圖', pageTitle: '臺灣人口地圖', getColor, showSelectionCard: false,
    loadingText: '載入人口統計與行政區…', errorText: '人口或行政區資料載入失敗，請重試。',
    sourceIntro: '戶籍人口、戶數、性別、年齡及出生死亡登記來自內政部戶政司；密度採官方年底人口與土地面積。行政區界來自國土測繪中心；戶籍人口不代表實際居住人口。',
    rowMeta: region => formatValue(value(region), metric),
    sortRegions: regions => [...regions].sort((a, b) => (value(b) ?? -Infinity) - (value(a) ?? -Infinity) || a.properties.code.localeCompare(b.properties.code)),
    formatTooltip: hit => `${hit.parentIndex !== undefined ? '切換至 ' : ''}${hit.region.properties.name}${hit.parentIndex === undefined ? ` · ${metricLabels[metric]} ${formatValue(value(hit.region), metric)}` : ''}`,
    onChoose: chooseRegion,
    onBack: () => { cancelMetricChange(); if (metric === 'density' && navigator.current?.selected) navigator.selectTown(null); else navigator.back(); },
    onHome: () => { cancelMetricChange(); navigator.home(); },
    onNavigate: index => { cancelMetricChange(); if (metric === 'density' && navigator.current?.selected && index === navigator.stack.length - 1) navigator.selectTown(null); else navigator.goTo(index); },
    onPanelChange: () => layer?.scheduleLabels(),
  });
  const panel = createPopulationMapPanel(shell, population, annual, changeMetric, changeYear, togglePlayback, metric, year);
  const navigator = new RegionNavigator(async file => {
    const level = file === 'counties.geojson' ? 'county' : file.startsWith('towns/') ? 'town' : 'village';
    const parent = file.match(/\/([0-9]+)\.geojson$/)?.[1];
    const loadMetric = requestedMetric, loadYear = requestedYear;
    const annualLoading = isAnnualMetric(loadMetric) ? (async () => {
      const years = await annual.availableYears();
      const selectedYear = years.includes(loadYear) ? loadYear : years[0];
      const [annualMeta, annualTotal] = await Promise.all([annual.manifest(selectedYear), annual.getNational(selectedYear)]);
      await annual.loadRegions(level, parent, selectedYear);
      return { years, year: selectedYear, manifest: annualMeta, national: annualTotal };
    })() : null;
    const [geometry, meta, total, yearData] = await Promise.all([
      boundaries.load(file), population.manifest(), population.getNational(), annualLoading, population.loadRegions(level, parent),
    ]);
    if (yearData && loadMetric === requestedMetric && loadYear === requestedYear) {
      availableYears = yearData.years; requestedYear = yearData.year;
      annualManifest = yearData.manifest; annualNational = yearData.national;
      panel.setYears(availableYears, requestedYear);
    }
    manifest = meta; national = total.record; return geometry;
  }, (view, restore = false) => {
    metric = requestedMetric; year = requestedYear;
    const route = routeFor(view), camera = routing?.consumeRouteCamera(route);
    if (camera) view.camera = camera;
    const savedMetricView = metricRestore?.ids === route.ids.join('/') ? metricRestore : undefined;
    if (!camera && savedMetricView?.camera) view.camera = savedMetricView.camera;
    metricRestore = undefined;
    routing?.commit(route); shell.render(view);
    if (savedMetricView?.data === view.data) {
      shell.root.querySelector<HTMLInputElement>('#region-search')!.value = savedMetricView.search;
      shell.refreshList();
    }
    panel.render(view, metric, year, availableYears, manifest, national, annualManifest, annualNational);
    if (annualManifest) panel.showAnnualSources(annualManifest);
    // Metric/year updates keep the existing camera. Replaying a saved camera
    // through easeTo would interrupt the map and postpone the color change.
    layer?.render(view, navigator.context, restore && !savedMetricView, undefined, undefined, Boolean(savedMetricView));
  }, busy => { shell.setBusy(busy); if (busy) { panel.setMetric(requestedMetric); panel.setYear(requestedYear); } panel.setBusy(busy || !navigator.current); layer?.setBusy(busy); if (!busy) layer?.cancelPreview(); },
  (error, retry) => {
    stopPlayback(); layer?.cancelColorTransition(); requestedMetric = metric; requestedYear = year; metricRestore = undefined;
    panel.setMetric(metric); panel.setYear(year); shell.showError(error, retry);
  }, region => layer?.previewRegion(region));
  function stopPlayback() {
    playbackRun++;
    if (playbackTimer !== undefined) window.clearTimeout(playbackTimer);
    playbackTimer = undefined; playbackState = 'idle';
    if (alive) panel.setPlaybackState('idle');
  }
  function cancelMetricChange() {
    stopPlayback(); layer?.cancelColorTransition(); requestedMetric = metric; requestedYear = year; metricRestore = undefined;
  }
  function chooseRegion(region: Region) {
    if (!layer?.ready || !navigator.current) return;
    cancelMetricChange();
    if (metric === 'density' && navigator.current.level === 'town') {
      navigator.current.camera = layer.camera(); navigator.selectTown(region);
    } else void navigator.enter(region, layer.camera());
  }
  function changeMetric(next: PopulationMetric) {
    const view = navigator.current;
    if (!view || !alive || next === metric) return;
    stopPlayback(); layer?.cancelColorTransition();
    const ids = metricPath(idsFor(view), next);
    metricRestore = { ids: ids.join('/'), camera: layer?.ready ? layer.camera() : undefined, data: view.data,
      search: shell.root.querySelector<HTMLInputElement>('#region-search')!.value };
    requestedMetric = next; requestedYear = year; shell.hideTooltip();
    void navigator.restorePath(ids, next === 'density');
  }
  async function changeYear(next: number, options: { fromPlayback?: boolean; transition?: boolean } = {}): Promise<boolean> {
    const view = navigator.current;
    if (!view || !alive || !isAnnualMetric(metric) || !availableYears.includes(next)) return false;
    if (next === year) return true;
    if (!options.fromPlayback) stopPlayback();
    if (options.transition === false) layer?.cancelColorTransition();
    else layer?.transitionNextRender(yearColorTransitionDuration());
    const ids = metricPath(idsFor(view), metric);
    metricRestore = { ids: ids.join('/'), camera: layer?.ready ? layer.camera() : undefined, data: view.data,
      search: shell.root.querySelector<HTMLInputElement>('#region-search')!.value };
    requestedMetric = metric; requestedYear = next; shell.hideTooltip();
    await navigator.restorePath(ids, metric === 'density');
    return alive && year === next;
  }
  async function prefetchPlaybackData(run: number) {
    const years = [...availableYears].sort((a, b) => a - b);
    const ids = navigator.current ? idsFor(navigator.current) : [];
    const countyCode = ids[0], townCode = ids[1];
    await Promise.all(years.flatMap(asyncYear => [
      annual.manifest(asyncYear), annual.getNational(asyncYear), annual.loadRegions('county', undefined, asyncYear),
      ...(countyCode ? [annual.loadRegions('town', countyCode, asyncYear)] : []),
      ...(townCode ? [annual.loadRegions('village', townCode, asyncYear)] : []),
    ]));
    return run === playbackRun && alive;
  }
  function schedulePlaybackAdvance(run: number) {
    playbackTimer = window.setTimeout(async () => {
      playbackTimer = undefined;
      if (run !== playbackRun || playbackState !== 'playing' || !alive) return;
      const index = availableYears.slice().sort((a, b) => a - b).indexOf(year);
      const next = availableYears.slice().sort((a, b) => a - b)[index + 1];
      if (next === undefined) { stopPlayback(); return; }
      const changed = await changeYear(next, { fromPlayback: true });
      if (!changed || run !== playbackRun || playbackState !== 'playing') {
        if (run === playbackRun) stopPlayback();
        return;
      }
      playbackTimer = window.setTimeout(() => {
        playbackTimer = undefined;
        if (run !== playbackRun || playbackState !== 'playing') return;
        if (next === availableYears.slice().sort((a, b) => a - b).at(-1)) stopPlayback();
        else schedulePlaybackAdvance(run);
      }, yearColorTransitionDuration() + (next === availableYears.slice().sort((a, b) => a - b).at(-1) ? YEAR_DWELL_MS : 0));
    }, YEAR_DWELL_MS);
  }
  async function togglePlayback() {
    if (playbackState !== 'idle') { stopPlayback(); return; }
    if (!alive || !isAnnualMetric(metric) || availableYears.length < 2) return;
    const run = ++playbackRun;
    playbackState = 'preparing'; panel.setPlaybackState(playbackState);
    try {
      const ready = await prefetchPlaybackData(run);
      if (!ready || run !== playbackRun || !alive) return;
      const years = availableYears.slice().sort((a, b) => a - b);
      if (year === years.at(-1)) {
        const reset = await changeYear(years[0], { fromPlayback: true, transition: false });
        if (!reset || run !== playbackRun || !alive) { if (run === playbackRun) stopPlayback(); return; }
      }
      playbackState = 'playing'; panel.setPlaybackState(playbackState);
      schedulePlaybackAdvance(run);
    } catch (error) {
      if (run !== playbackRun || !alive) return;
      stopPlayback(); shell.showError(error, () => { void togglePlayback(); });
    }
  }
  function restoreRoute(route: Route) {
    stopPlayback(); layer?.cancelColorTransition();
    metricRestore = undefined;
    const historyRestore = Boolean(navigator.current && routing?.isHistoryNavigation);
    requestedMetric = !historyRestore ? parseMetric(route.query) : metric;
    requestedYear = historyRestore && !new URLSearchParams(route.query).has('year')
      ? year : parsePopulationYear(route.query) ?? DEFAULT_ANNUAL_YEAR;
    return navigator.restorePath(metricPath(route.ids, requestedMetric), requestedMetric === 'density');
  }
  try {
    basemap = createMap({ container: shell.mapContainer, apiKey: import.meta.env.VITE_TOMTOM_API_KEY, style: 'monoLight', onStatus: shell.setBasemapStatus });
    layer = createRegionLayer(basemap.map, {
      getColor, isMissing: region => value(region) == null, fillOpacity: .65, hoverOpacity: .65, selectedOpacity: .65,
      outlineColor: '#718c9c', emphasisColor: '#174b70', getPadding: shell.getPadding,
      getLabelObstacles: () => [...shell.getLabelObstacles(), ...panel.obstacles()],
      duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 720,
      onReady: shell.markMapReady, onHover: shell.showTooltip, onHoverEnd: shell.hideTooltip,
      onSelect: hit => {
        if (!layer?.ready || !navigator.current) return;
        if (hit.parentIndex !== undefined) { cancelMetricChange(); void navigator.switchTo(hit.region, hit.parentIndex); }
        else chooseRegion(hit.region);
      },
    });
    if (routing) void restoreRoute(routing.current); else void navigator.start();
  } catch { shell.showInitializationError(() => location.reload()); }
  void Promise.all([boundaries.manifest(), population.manifest()]).then(([geometry, stats]) => {
    if (alive) { shell.renderManifest(geometry); panel.showSources(stats); if (annualManifest) panel.showAnnualSources(annualManifest); }
  }).catch(() => { if (alive) shell.showManifestError(); });
  return { restoreRoute, destroy() {
    if (!alive) return;
    stopPlayback(); alive = false; navigator.destroy(); panel.destroy(); layer?.destroy(); basemap?.destroy(); shell.destroy();
  } };
}
