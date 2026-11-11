import type { createMapShell } from '../../ui/map-shell';
import { appendTextOption, setExternalLink } from '../../ui/safe-dom';
import { loadChildSafetyData, validDirectory, type ChildSafetyData, type Directory } from './data';
import { validSanctionDetails, type SanctionDetails, type SanctionIndex, type SanctionSchool } from './sanctions';
import { format, legendItems, metrics, unit, value, type Metric } from './theme';

const sanctionUrl = 'https://ap.ece.moe.edu.tw/webecems/punishSearch.aspx';
export type Filter = { year: string; metric: Metric };

function link(label: string, url: string) {
  const anchor = document.createElement('a');
  anchor.textContent = label;
  setExternalLink(anchor, url);
  return anchor;
}

function numberRows(list: HTMLElement, entries: Array<[string, string]>) {
  list.replaceChildren(...entries.map(([label, value]) => {
    const row = document.createElement('div');
    const term = document.createElement('dt');
    const description = document.createElement('dd');
    term.textContent = label;
    description.textContent = value;
    row.append(term, description);
    return row;
  }));
}

export function createChildSafetyPanel(shell: ReturnType<typeof createMapShell>, signal: AbortSignal, change: (filter: Filter) => void, toggleMarkers: (visible: boolean) => void, focusSchool: (school: SanctionSchool | undefined) => void) {
  shell.viewExtra.innerHTML = `
    <div class="child-controls">
      <label>統計年度<select data-ui="child-year" disabled></select></label>
      <label>地圖著色<select data-ui="child-metric" disabled></select></label>
    </div>
    <section class="child-sanctions">
      <label class="child-marker-toggle"><input type="checkbox" data-ui="sanction-markers" checked>顯示官方裁罰園所</label>
      <p data-ui="sanction-summary" role="status"></p>
      <details data-ui="sanction-section"><summary>園所裁罰紀錄</summary>
        <p>地圖標記內為公開裁罰筆數，位置為園址。未定位園所仍可從清單查閱。</p>
        <label>鄉鎮市區<select data-ui="sanction-town"></select></label>
        <label>園所<select data-ui="sanction-school"></select></label>
        <div data-ui="sanction-details">選取縣市或點選地圖標記，即可查看園所裁罰紀錄。</div>
      </details>
    </section>
    <section class="child-summary" aria-live="polite">
      <p data-ui="child-label"></p><strong data-ui="child-value">載入中…</strong>
      <dl data-ui="child-totals"></dl>
      <p>每萬名兒少通報件次以當年 12 月底 0–17 歲戶籍人口為分母。通報可含重複及跨轄案件，呈現的是行政通報量。</p>
      <details><summary>通報分流與指標定義</summary><dl data-ui="child-flow"></dl>
        <p>受虐兒少人數依衛福部定義，指經調查後提供後續保護服務的兒少人數。分流統計涵蓋兩種通報表單。</p>
      </details>
      <details><summary>全國教保違法對待裁罰統計</summary>
        <label>裁罰年度<select data-ui="preschool-year"></select></label>
        <dl data-ui="preschool-totals"></dl>
        <p>單位為受裁罰人數。2023 年 3 月起適用範圍改變，跨期比較須留意。</p>
        <div data-ui="preschool-source"></div>
      </details>
      <details data-ui="child-directory"><summary>幼兒園名錄與裁罰查詢</summary>
        <div data-ui="child-lookup"></div>
        <p data-ui="child-school-status" role="status"></p>
        <label data-ui="child-town-label" hidden>鄉鎮市區<select data-ui="child-town"></select></label>
        <label data-ui="child-school-label" hidden>幼兒園<select data-ui="child-school"></select></label>
        <p data-ui="child-address"></p>
        <div data-ui="child-school-source"></div>
      </details>
    </section>`;
  const el = <T extends HTMLElement = HTMLElement>(key: string) => shell.viewExtra.querySelector<T>(`[data-ui=${key}]`)!;
  const sanctionTown = el<HTMLSelectElement>('sanction-town');
  const sanctionSchool = el<HTMLSelectElement>('sanction-school');
  sanctionTown.disabled = sanctionSchool.disabled = true;
  const sanctionSection = el<HTMLDetailsElement>('sanction-section');
  let sanctionCounty: SanctionDetails | undefined;
  let sanctionIndex: SanctionIndex | undefined;
  let sanctionRequest: AbortController | undefined;
  let desiredSchool: string | undefined;
  const sanctionCache = new Map<string, SanctionDetails>();
  const year = el<HTMLSelectElement>('child-year');
  const metric = el<HTMLSelectElement>('child-metric');
  const preschoolYear = el<HTMLSelectElement>('preschool-year');
  const directory = el<HTMLDetailsElement>('child-directory');
  const town = el<HTMLSelectElement>('child-town');
  const school = el<HTMLSelectElement>('child-school');
  const status = el('child-school-status');
  let data: ChildSafetyData | undefined;
  let county: string | undefined;
  let directoryRequest: AbortController | undefined;
  let schools: Directory | undefined;
  let loadedCounty: string | undefined;
  const cache = new Map<string, Directory>();
  const legend = document.createElement('section');
  legend.className = 'child-legend';
  legend.setAttribute('aria-label', '兒少保護色階圖例');
  shell.uiContainer.append(legend);
  shell.addMobileContent(legend);

  for (const [key, label] of Object.entries(metrics)) appendTextOption(metric, key, label);
  for (const select of [year, metric]) {
    select.addEventListener('change', () => change({ year: year.value, metric: metric.value as Metric }), { signal });
  }
  el('child-lookup').append(link('全國教保資訊網裁罰查詢 ↗', sanctionUrl));
  el('child-school-source').append(link('教育部幼兒園名錄 ↗', 'https://data.gov.tw/dataset/6086'));
  el('preschool-source').append(link('教育部裁罰統計原表 ↗', 'https://crc.sfaa.gov.tw/Uploadfile/Statiscs/80_20260907145217_7155105.pdf'));
  for (const [label, url] of [
    ['衛福部兒少保護通報及受虐人數（3.5.1、3.5.6）', 'https://dep.mohw.gov.tw/DOS/cp-5337-62357-113.html'],
    ['內政部戶政司村里單一年齡人口', 'https://data.gov.tw/dataset/77132'],
    ['官方兒少不當對待查詢與通報專區', 'https://www.gov.tw/News_Content_67_768071'],
  ]) {
    const row = document.createElement('div');
    row.className = 'source-row';
    row.append(link(label + ' ↗', url));
    shell.sourceContent.append(row);
  }

  function renderPreschool() {
    const record = data?.preschool[preschoolYear.value];
    if (!record) return;
    numberRows(el('preschool-totals'), [
      ['受裁罰人數', `${record.total} 人`],
      ...Object.entries(record.categories).map(([label, count]): [string, string] => [label, `${count} 人`]),
    ]);
  }

  function renderSchool() {
    const record = schools?.records.find(item => item.id === school.value);
    el('child-address').textContent = record?.address ?? '';
  }

  function renderTowns() {
    school.replaceChildren();
    appendTextOption(school, '', '選擇幼兒園');
    for (const record of schools?.records.filter(item => item.town === town.value)
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-TW')) ?? []) {
      appendTextOption(school, record.id, record.name);
    }
    el('child-school-label').hidden = !town.value;
    renderSchool();
  }

  function showSchools(result: Directory) {
    schools = result;
    loadedCounty = county;
    status.textContent = `${result.year} 學年度，共 ${result.records.length.toLocaleString('zh-TW')} 所。`;
    town.replaceChildren();
    appendTextOption(town, '', '選擇鄉鎮市區');
    const names = new Map(result.records.map(record => [record.town, record.townName]));
    for (const [code, name] of [...names].sort((a, b) => a[1].localeCompare(b[1], 'zh-TW'))) {
      appendTextOption(town, code, name);
    }
    el('child-town-label').hidden = false;
    renderTowns();
  }

  async function loadSchools() {
    if (!directory.open) return;
    if (!county) {
      status.textContent = '選取地圖上的縣市，即可查詢該縣市的幼兒園。';
      return;
    }
    if (!data || loadedCounty === county || directoryRequest) return;
    const requestedCounty = county;
    const cached = cache.get(requestedCounty);
    if (cached) {
      showSchools(cached);
      return;
    }
    const controller = new AbortController();
    directoryRequest = controller;
    const schoolYear = data.schoolYear;
    status.textContent = '載入幼兒園名錄…';
    try {
      const result = await loadChildSafetyData<Directory>(`schools/${requestedCounty}.json`,
        value => validDirectory(value, requestedCounty, schoolYear), AbortSignal.any([signal, controller.signal]));
      if (signal.aborted || controller.signal.aborted) return;
      cache.set(requestedCounty, result);
      showSchools(result);
    } catch {
      if (signal.aborted || controller.signal.aborted) return;
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = '重試';
      retry.addEventListener('click', () => void loadSchools(), { once: true, signal });
      status.replaceChildren('幼兒園名錄載入失敗。', retry);
    } finally {
      if (directoryRequest === controller) directoryRequest = undefined;
    }
  }

  preschoolYear.addEventListener('change', renderPreschool, { signal });
  directory.addEventListener('toggle', () => void loadSchools(), { signal });
  town.addEventListener('change', renderTowns, { signal });
  school.addEventListener('change', renderSchool, { signal });

  function showSanctionSchool() {
    const record = sanctionCounty?.schools.find(s => s.id === sanctionSchool.value);
    const container = el('sanction-details');
    container.replaceChildren();
    if (!record) return;
    const heading = document.createElement('h3');
    heading.textContent = record.name;
    const address = document.createElement('p');
    address.textContent = `${record.address} · 園所狀態：${record.status}`;
    container.append(heading, address);
    container.append(link('官方裁罰查詢 ↗', record.sourceUrl));
    if (record.position) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = '查看園址';
      button.addEventListener('click', () => focusSchool(record), { signal });
      container.append(button);
    }
    if (!record.position) {
      const note = document.createElement('p');
      note.textContent = record.positionStatus === 'outside-town'
        ? '官方座標與所屬行政區不符，完整裁罰紀錄保留於此。'
        : '官方未提供可核對的園址座標，完整裁罰紀錄保留於此。';
      container.append(note);
    }
    for (const sanction of [...record.sanctions].sort((a, b) => b.date.localeCompare(a.date))) {
      const article = document.createElement('article');
      const title = document.createElement('h4');
      title.textContent = `${sanction.date} · ${sanction.document}`;
      const list = document.createElement('dl');
      numberRows(list, [
        ['處分時園名', sanction.schoolName], ['處分依據', sanction.basis],
        ['違反規定', sanction.violation], ['負責人／行為人', sanction.subject], ['處分內容', sanction.disposition],
      ]);
      article.append(title, list);
      container.append(article);
    }
  }

  function filterSanctionSchools() {
    const previous = desiredSchool ?? sanctionSchool.value;
    sanctionSchool.replaceChildren();
    appendTextOption(sanctionSchool, '', '選擇園所');
    for (const record of sanctionCounty?.schools.filter(s => !sanctionTown.value || s.townName === sanctionTown.value).sort((a, b) => a.name.localeCompare(b.name, 'zh-TW')) ?? []) {
      appendTextOption(sanctionSchool, record.id, `${record.name}（${record.sanctions.length} 筆）`);
    }
    sanctionSchool.value = previous;
    if (!sanctionSchool.value) sanctionSchool.value = '';
    desiredSchool = undefined;
    showSanctionSchool();
  }

  function showSanctionCounty(result: SanctionDetails) {
    sanctionCounty = result;
    sanctionTown.disabled = sanctionSchool.disabled = false;
    sanctionTown.replaceChildren();
    appendTextOption(sanctionTown, '', '全部鄉鎮');
    for (const name of [...new Set(result.schools.map(s => s.townName))].sort((a, b) => a.localeCompare(b, 'zh-TW'))) {
      appendTextOption(sanctionTown, name, name || '行政區未對照');
    }
    filterSanctionSchools();
  }

  async function loadSanctions() {
    if (!county || !sanctionSection.open || sanctionRequest) return;
    if (sanctionCounty?.county === county) {
      if (desiredSchool) {
        sanctionTown.value = '';
        filterSanctionSchools();
      }
      return;
    }
    const cached = sanctionCache.get(county);
    if (cached) { showSanctionCounty(cached); return; }
    const requestedCounty = county;
    const controller = new AbortController();
    sanctionRequest = controller;
    const container = el('sanction-details');
    container.textContent = '載入園所裁罰紀錄…';
    try {
      const result = await loadChildSafetyData<SanctionDetails>(`sanctions/${requestedCounty}.json`,
        d => validSanctionDetails(d, requestedCounty)
          && d.records === sanctionIndex?.counties[requestedCounty]?.records
          && d.schools.length === sanctionIndex?.counties[requestedCounty]?.schools, AbortSignal.any([signal, controller.signal]));
      if (signal.aborted || controller.signal.aborted) return;
      sanctionCache.set(requestedCounty, result);
      showSanctionCounty(result);
    } catch {
      if (signal.aborted || controller.signal.aborted) return;
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = '重試';
      retry.addEventListener('click', () => void loadSanctions(), { once: true, signal });
      container.replaceChildren('裁罰資料載入失敗。', retry);
    } finally {
      if (sanctionRequest === controller) sanctionRequest = undefined;
    }
  }

  el<HTMLInputElement>('sanction-markers').addEventListener('change', event =>
    toggleMarkers((event.target as HTMLInputElement).checked), { signal });
  sanctionTown.addEventListener('change', () => {
    filterSanctionSchools();
    if (!sanctionSchool.value) focusSchool(undefined);
  }, { signal });
  sanctionSchool.addEventListener('change', () => {
    showSanctionSchool();
    const record = sanctionCounty?.schools.find(s => s.id === sanctionSchool.value);
    focusSchool(record);
  }, { signal });
  sanctionSection.addEventListener('toggle', () => void loadSanctions(), { signal });

  return {
    render(next: ChildSafetyData, filter: Filter, countyCode: string | undefined, countyName: string, sanctions: SanctionIndex, selectedSchool?: string, markersVisible = true) {
      el<HTMLInputElement>('sanction-markers').checked = markersVisible;
      sanctionIndex = sanctions;
      if (!data) {
        data = next;
        for (const y of Object.keys(data.years).sort().reverse()) appendTextOption(year, y, `${y} 年`);
        for (const y of Object.keys(data.preschool).sort().reverse()) appendTextOption(preschoolYear, y, `${y} 年`);
        renderPreschool();
      }
      year.value = filter.year;
      metric.value = filter.metric;
      const record = data.years[filter.year][countyCode ?? 'TW'];
      el('child-label').textContent = `${countyName} · ${filter.year} 年 1–12 月 · ${metrics[filter.metric]}`;
      el('child-value').textContent = format(value(record, filter.metric), filter.metric);
      numberRows(el('child-totals'), [
        ...Object.entries(metrics).map(([key, label]): [string, string] => [label, format(value(record, key as Metric), key as Metric)]),
        ['年底 0–17 歲戶籍人口', record ? `${record.population.toLocaleString('zh-TW')} 人` : '無資料'],
      ]);
      numberRows(el('child-flow'), [
        ['社會安全網諮詢通報', format(record?.consultations ?? null, 'reports')],
        ['分流有效案件', format(record?.valid ?? null, 'reports')],
        ['兒少保護服務', format(record?.protection ?? null, 'reports')],
        ['兒少性剝削保護服務', format(record?.exploitation ?? null, 'reports')],
        ['福利服務', format(record?.welfare ?? null, 'reports')],
        ['轉介服務', format(record?.referrals ?? null, 'reports')],
        ['其他情形', format(record?.other ?? null, 'reports')],
      ]);
      const title = document.createElement('strong');
      title.textContent = `${metrics[filter.metric]}（${unit(filter.metric)}）`;
      const scale = document.createElement('div');
      scale.className = 'child-scale';
      for (const item of legendItems(filter.metric)) {
        const entry = document.createElement('span');
        const swatch = document.createElement('i');
        swatch.style.backgroundColor = item.color;
        entry.append(swatch, item.label);
        scale.append(entry);
      }
      legend.replaceChildren(title, scale);
      const summaries = countyCode ? [sanctions.counties[countyCode]] : Object.values(sanctions.counties);
      const totalSchools = summaries.reduce((sum, s) => sum + s.schools, 0);
      const totalRecords = summaries.reduce((sum, s) => sum + s.records, 0);
      const positioned = summaries.reduce((sum, s) => sum + s.positioned, 0);
      const date = summaries.map(s => s.retrievedAt.slice(0, 10)).sort().at(-1);
      el('sanction-summary').textContent = `${countyName} · ${totalSchools} 所園所、${totalRecords} 筆公開裁罰，${positioned} 所可定位。${date} 取得，公告會隨官方公布期限及更正異動。${countyCode ? '' : '選取縣市或點選標記可查看明細。'}`;
      if (county !== countyCode) {
        sanctionRequest?.abort();
        sanctionRequest = undefined;
        sanctionCounty = undefined;
        sanctionTown.disabled = sanctionSchool.disabled = true;
        desiredSchool = undefined;
        sanctionTown.replaceChildren();
        sanctionSchool.replaceChildren();
        el('sanction-details').textContent = countyCode ? '' : '請先選取縣市。';
        directoryRequest?.abort();
        directoryRequest = undefined;
        county = countyCode;
        loadedCounty = undefined;
        schools = undefined;
        town.replaceChildren();
        el('child-town-label').hidden = true;
        status.textContent = '';
        renderTowns();
      }
      if (selectedSchool) {
        desiredSchool = selectedSchool;
        sanctionSection.open = true;
      }
      void loadSchools();
      void loadSanctions();
    },
    setBusy(busy: boolean) { year.disabled = metric.disabled = busy; },
    obstacles() {
      if (matchMedia('(max-width: 760px)').matches) return [];
      const rect = legend.getBoundingClientRect();
      const origin = shell.mapContainer.getBoundingClientRect();
      return [{ x: rect.x - origin.x, y: rect.y - origin.y, w: rect.width, h: rect.height }];
    },
    destroy() { legend.remove(); },
  };
}
