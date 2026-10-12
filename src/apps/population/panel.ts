import type { PopulationManifest, PopulationRecord, PopulationRepository } from '../../data/population';
import type { AnnualPopulationManifest, AnnualPopulationRecord, AnnualPopulationRepository } from '../../data/population-annual';
import type { Rect, RegionLevel, View } from '../../map-core/types';
import type { createMapShell } from '../../ui/map-shell';
import { populationTarget } from '../admin/population-panel';
import { isAnnualMetric, isNaturalMetric, metricColors, formatValue, legendLabels, metricDescription, metricLabels, metrics, metricValue, unit, type PopulationMetric } from './theme';

export function createPopulationMapPanel(shell: ReturnType<typeof createMapShell>, repository: PopulationRepository, annualRepository: AnnualPopulationRepository,
  onMetricChange: (metric: PopulationMetric) => void, onYearChange: (year: number) => void, onPlaybackToggle: () => void,
  initialMetric: PopulationMetric, initialYear: number) {
  const lifetime = new AbortController();
  shell.root.classList.add('population-page');
  shell.mapContainer.setAttribute('aria-label', '臺灣戶籍人口互動地圖');
  shell.viewExtra.innerHTML = `
    <div class="population-map-control"><label for="population-metric">地圖指標</label>
      <select id="population-metric">${[['人口概況', metrics.slice(0, 2)], ['年齡與性別', metrics.slice(2, 5)], ['年度統計', metrics.slice(5)]].map(([label, group]) => `<optgroup label="${label}">${(group as PopulationMetric[]).map(metric => `<option value="${metric}">${metricLabels[metric]}</option>`).join('')}</optgroup>`).join('')}</select>
    </div>
    <div class="population-map-control population-map-year-control" hidden>
      <div class="population-map-year-heading"><label for="population-year">統計年份</label><output for="population-year" id="population-year-label"></output></div>
      <input id="population-year" type="range" min="0" max="0" step="1" value="0" aria-label="年度統計年份">
      <div class="population-map-year-footer"><div class="population-map-year-endpoints" aria-hidden="true"><span class="population-year-oldest"></span><span class="population-year-newest"></span></div>
        <button id="population-play" type="button" aria-label="從最早年份開始播放" aria-pressed="false" disabled>播放</button>
      </div>
    </div>
    <section class="population-map-summary" aria-label="目前地區人口統計" aria-live="polite">
      <p class="population-map-metric-label"></p><strong class="population-map-value">載入中…</strong>
      <p class="population-map-date"></p><p class="population-map-description"></p>
      <dl class="population-map-facts"></dl>
      <p class="population-map-note">戶籍人口不代表常住人口。未編定範圍沒有村里統計。</p>
    </section>`;
  const find = (selector: string) => shell.viewExtra.querySelector<HTMLElement>(selector)!;
  const select = shell.viewExtra.querySelector<HTMLSelectElement>('select')!;
  const yearControl = shell.viewExtra.querySelector<HTMLElement>('.population-map-year-control')!;
  const yearSlider = shell.viewExtra.querySelector<HTMLInputElement>('#population-year')!;
  const yearLabel = shell.viewExtra.querySelector<HTMLOutputElement>('#population-year-label')!;
  const playButton = shell.viewExtra.querySelector<HTMLButtonElement>('#population-play')!;
  const oldestYear = shell.viewExtra.querySelector<HTMLElement>('.population-year-oldest')!;
  const newestYear = shell.viewExtra.querySelector<HTMLElement>('.population-year-newest')!;
  let yearsAscending: number[] = [];
  let metricIsAnnual = isAnnualMetric(initialMetric);
  let isBusy = false;
  let playbackState: 'idle' | 'preparing' | 'playing' = 'idle';
  select.value = initialMetric;
  select.addEventListener('change', () => onMetricChange(select.value as PopulationMetric), { signal: lifetime.signal });
  yearSlider.addEventListener('input', () => updateYearLabel(yearSlider.valueAsNumber), { signal: lifetime.signal });
  yearSlider.addEventListener('change', () => {
    const selectedYear = yearsAscending[yearSlider.valueAsNumber];
    if (selectedYear != null) onYearChange(selectedYear);
  }, { signal: lifetime.signal });
  playButton.addEventListener('click', onPlaybackToggle, { signal: lifetime.signal });
  const legend = document.createElement('section'); legend.className = 'population-map-legend';
  legend.setAttribute('aria-label', '人口指標色階圖例');
  shell.uiContainer.append(legend); shell.addMobileContent(legend);

  function render(view: View, metric: PopulationMetric, year: number, availableYears: number[], manifest: PopulationManifest, national: PopulationRecord | null, annualManifest?: AnnualPopulationManifest, annualNational?: AnnualPopulationRecord) {
    const target = populationTarget(view);
    const record = target.unassigned ? null : target.level === 'national' ? national : repository.get(target.code);
    const annual = target.unassigned ? null : target.level === 'national' ? annualNational ?? null : annualRepository.get(target.code, year);
    select.value = metric;
    metricIsAnnual = isAnnualMetric(metric);
    yearControl.hidden = !metricIsAnnual;
    if (availableYears.length && yearsAscending.join(',') !== [...availableYears].sort((a, b) => a - b).join(',')) {
      setYears(availableYears, year);
    } else setYear(year);
    updatePlaybackControl();
    find('.population-map-metric-label').textContent = `${target.name} · ${metricLabels[metric]}`;
    find('.population-map-value').textContent = formatValue(metricValue(record, metric, annual), metric);
    find('.population-map-date').textContent = isAnnualMetric(metric) ? `${year} 年${metric === 'density' ? '底' : '度'} · 戶籍統計` : `${manifest.label} · 戶籍統計`;
    find('.population-map-description').textContent = metricDescription(metric);
    const facts = find('.population-map-facts'); facts.replaceChildren();
    const rows: [string, string][] = [];
    if (isAnnualMetric(metric) && annual) {
      rows.push(['年底人口', formatValue(annual.endPopulation, 'population')]);
      if (annual.areaKm2 != null) rows.push(['官方土地面積', `${annual.areaKm2.toLocaleString('zh-TW', { maximumFractionDigits: 4 })} km²`]);
      rows.push(...(['births', 'birthRate', 'deaths', 'deathRate', 'naturalIncrease', 'naturalRate'] as PopulationMetric[])
        .map(item => [metricLabels[item], formatValue(metricValue(null, item, annual), item)] as [string, string]));
    } else if (!isAnnualMetric(metric) && record) {
      rows.push(
        ['總人口', formatValue(record.population, 'population')], ['戶數', formatValue(record.households, 'households')],
        ['男性', formatValue(record.male, 'population')], ['女性', formatValue(record.female, 'population')],
        ['65 歲以上', `${record.age65plus.toLocaleString('zh-TW')} 人 · ${formatValue(metricValue(record, 'elderly'), 'elderly')}`],
        ['0–14 歲', `${record.age0to14.toLocaleString('zh-TW')} 人 · ${formatValue(metricValue(record, 'young'), 'young')}`],
      );
    }
    for (const [label, value] of rows) {
      const row = document.createElement('div'), term = document.createElement('dt'), detail = document.createElement('dd');
      term.textContent = label; detail.textContent = value; row.append(term, detail); facts.append(row);
    }
    const noteText = find('.population-map-note');
    noteText.textContent = metric === 'density' ? '官方密度僅提供到鄉鎮市區，不能繼續下鑽村里。戶籍人口不代表常住人口。'
      : isAnnualMetric(metric) && annual && (annual.monthsCovered !== 12 || annual.meanPopulation == null)
      ? `此村里代碼有 ${annual.monthsCovered}／12 個月紀錄；缺完整月份或年底人口時不推估、不分攤舊村里數字。上層仍納入官方全部登記。`
      : isAnnualMetric(metric) ? '粗出生率不是總生育率。自然增減不含遷徙。未編定範圍無資料。'
      : '戶籍人口不代表常住人口。未編定範圍沒有村里統計。';
    if (isAnnualMetric(metric) && annual && metricValue(null, metric, annual) == null) find('.population-map-value').textContent = '資料不完整';
    const level: RegionLevel = view.level === 'detail' ? 'village' : view.level;
    legend.replaceChildren();
    const title = document.createElement('strong'); title.textContent = `${metricLabels[metric]} · ${unit(metric)}`;
    const scale = document.createElement('div'); scale.className = 'population-map-scale';
    for (const [index, label] of legendLabels(metric, level).entries()) {
      const item = document.createElement('span'), swatch = document.createElement('i'), text = document.createElement('span');
      swatch.style.backgroundColor = metricColors(metric)[index]; swatch.setAttribute('aria-hidden', 'true'); text.textContent = label;
      item.append(swatch, text); scale.append(item);
    }
    const note = document.createElement('p');
    note.textContent = `${isNaturalMetric(metric) ? '紅色：自然減少；綠色：自然增加；淺色：接近零。' : '深色代表較高數值。'}${['population', 'households', 'births', 'deaths', 'naturalIncrease'].includes(metric) ? '同層固定級距。' : '全國各層相同級距。'}斜紋：${isAnnualMetric(metric) ? '無資料或年度不完整' : '無資料'}；灰色：可切換地區。`;
    legend.append(title, scale, note);
  }
  function showSources(manifest: PopulationManifest) {
    const row = document.createElement('div'); row.className = 'source-row';
    const link = document.createElement('a'); link.href = manifest.source.catalogUrl; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.textContent = `${manifest.source.title} ↗`;
    const detail = document.createElement('p'); detail.textContent = `${manifest.label}。年齡分組由官方單一年齡人口彙整，比例以同範圍總人口為分母。`;
    row.append(link, detail); shell.sourceContent.append(row);
  }
  function showAnnualSources(manifest: AnnualPopulationManifest) {
    shell.sourceContent.querySelectorAll('[data-population-annual]').forEach(row => row.remove());
    for (const source of manifest.sources) {
      const row = document.createElement('div'); row.className = 'source-row'; row.dataset.populationAnnual = '';
      const link = document.createElement('a'); link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.textContent = `${manifest.year} · ${source.title} ↗`;
      const detail = document.createElement('p');
      detail.textContent = source.title.includes('土地面積')
        ? '年底人口 ÷ 官方土地面積；縣市與全臺先加總再相除。僅提供到鄉鎮，不估算村里面積。'
        : source.title.includes('ODRP013') || source.title.includes('年底戶籍')
          ? `${manifest.year - 1} 與 ${manifest.year} 年底戶籍人口平均，作為粗出生／死亡率與自然增減率的分母，單位 ‰。`
          : '全年十二個月出生、死亡登記合計，依登記月份統計。村里缺全年紀錄時不補零、不分攤。';
      row.append(link, detail); shell.sourceContent.append(row);
    }
  }
  function updateYearLabel(index: number) {
    const year = yearsAscending[index];
    yearLabel.value = year == null ? '' : `${year} 年`;
    yearSlider.setAttribute('aria-valuetext', year == null ? '' : `${year} 年`);
  }
  function setMetric(metric: PopulationMetric) {
    select.value = metric; metricIsAnnual = isAnnualMetric(metric); yearControl.hidden = !metricIsAnnual;
    updatePlaybackControl();
  }
  function setYears(years: number[], year: number) {
    yearsAscending = [...years].sort((a, b) => a - b);
    yearSlider.min = '0'; yearSlider.max = String(Math.max(0, yearsAscending.length - 1));
    oldestYear.textContent = yearsAscending[0]?.toString() ?? '';
    newestYear.textContent = yearsAscending.at(-1)?.toString() ?? '';
    setYear(year); updatePlaybackControl();
  }
  function setYear(year: number) {
    const index = yearsAscending.indexOf(year);
    if (index >= 0) yearSlider.value = String(index);
    updateYearLabel(yearSlider.valueAsNumber);
  }
  function setPlaybackState(state: 'idle' | 'preparing' | 'playing') {
    playbackState = state;
    playButton.textContent = state === 'preparing' ? '載入中…' : state === 'playing' ? '暫停' : '播放';
    playButton.setAttribute('aria-label', state === 'idle' ? '播放年度統計' : state === 'preparing' ? '取消年度播放' : '暫停年度播放');
    playButton.setAttribute('aria-pressed', String(state !== 'idle'));
    playButton.dataset.state = state;
    updatePlaybackControl();
  }
  function updatePlaybackControl() {
    playButton.disabled = !metricIsAnnual || yearsAscending.length < 2 || (isBusy && playbackState === 'idle');
  }
  return { render, showSources, showAnnualSources, setMetric, setYears, setYear, setPlaybackState,
    setBusy(busy: boolean) { isBusy = busy; select.disabled = busy; yearSlider.disabled = busy; updatePlaybackControl(); },
    obstacles(): Rect[] {
      if (innerWidth <= 760) return [];
      const rect = legend.getBoundingClientRect(), origin = shell.mapContainer.getBoundingClientRect();
      return [{ x: rect.x - origin.x, y: rect.y - origin.y, w: rect.width, h: rect.height }];
    },
    destroy() { lifetime.abort(); legend.remove(); shell.root.classList.remove('population-page'); },
  };
}
