import type { CrimeSnapshot } from '../../data/crime';
import type { Rect, View } from '../../map-core/types';
import type { createMapShell } from '../../ui/map-shell';
import { categoryLabel, categoryLabels, colors, cuts, format, labels, metrics, unit, value, type Filter, type Metric } from './theme';

export function createCrimePanel(shell: ReturnType<typeof createMapShell>, onChange: (f: Filter) => void) {
  const abort = new AbortController(); let current: Filter;
  shell.root.classList.add('crime-page'); shell.mapContainer.setAttribute('aria-label', '臺灣刑事統計互動地圖');
  shell.viewExtra.innerHTML = `<div class="crime-controls">
    <label>統計範圍<select data-ui="crime-scope"><option value="official">全般刑案／嫌疑犯（縣市）</option><option value="regional">收錄 8 案類（縣市／鄉鎮）</option></select></label>
    <label>年份<select data-ui="crime-year"><option>2024</option><option>2025</option><option>2026</option></select></label>
    <label>統計期間<select data-ui="crime-period"><option value="available">全年／最新期間</option><option value="half">1–6 月（同期）</option></select></label>
    <label>案類<select data-ui="crime-category"></select></label><label>地圖指標<select data-ui="crime-metric"></select></label>
    </div><section class="crime-summary" aria-live="polite"><p class="crime-label"></p><strong class="crime-value">載入中…</strong><p class="crime-date"></p><dl></dl><p class="crime-coverage"></p><p class="crime-note"></p><p class="crime-denominator"></p><p class="crime-warning"></p></section>`;
  const selects = Object.fromEntries(['scope', 'year', 'period', 'category', 'metric'].map(k => [k, shell.viewExtra.querySelector<HTMLSelectElement>(`[data-ui=crime-${k}]`)!]));
  function options(select: HTMLSelectElement, items: [string, string][]) { select.replaceChildren(); for (const [v, text] of items) { const option = document.createElement('option'); option.value = v; option.textContent = text; select.append(option); } }
  function setFilter(f: Filter, categories?: string[]) {
    current = f;
    if (categories) options(selects.category, categories.map(k => [k, categoryLabel({ ...f, category: k })]));
    options(selects.metric, metrics.filter(m => f.scope === 'official' || m === 'cases' || m === 'rate').map(m => [m, labels[m]]));
    for (const k of ['scope', 'year', 'period', 'category', 'metric'] as const) selects[k].value = String(f[k]);
  }
  for (const [k, select] of Object.entries(selects)) select.addEventListener('change', () => {
    const f = { ...current, [k]: k === 'year' ? Number(select.value) : select.value } as Filter;
    if (k === 'scope') { f.category = 'total'; if (f.scope === 'regional' && (f.metric === 'suspects' || f.metric === 'offenderRate')) f.metric = 'rate'; }
    onChange(f);
  }, { signal: abort.signal });
  const legend = document.createElement('section'); legend.className = 'crime-legend'; legend.setAttribute('aria-label', '刑事統計色階圖例'); shell.uiContainer.append(legend); shell.addMobileContent(legend);
  for (const [title, url] of [['警政署部分案類發生資料', 'https://data.gov.tw/dataset/14200'], ['內政部刑案發生件數', 'https://data.gov.tw/dataset/9603'], ['內政部嫌疑犯人數', 'https://data.gov.tw/dataset/9604'], ['戶政司人口資料', 'https://www.ris.gov.tw/rs-opendata/api/Main/docs/v1'], ['刑案統計口徑變更說明', 'https://www.stat.gov.tw/News_NoticeCalendar_Content_temp.aspx?MetaI_D=69&n=3724&year=2024']]) {
    const row = document.createElement('div'), link = document.createElement('a'); row.className = 'source-row'; link.textContent = title + ' ↗'; link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; row.append(link); shell.sourceContent.append(row);
  }
  function render(view: View, f: Filter, data: CrimeSnapshot) {
    setFilter(f, data.categories);
    const region = view.selected ?? view.path.at(-1), record = data.records[region?.properties.code ?? 'TW'];
    const text = (name: string, content: string) => { shell.viewExtra.querySelector(`.crime-${name}`)!.textContent = content; };
    text('label', `${region?.properties.name ?? '全臺'} · ${categoryLabel(f)} · ${labels[f.metric]}`);
    text('value', format(value(record, f), f.metric)); text('date', `${f.year} 年 1–${data.endMonth} 月${data.complete ? '（全年）' : '（尚非全年；未換算成年率）'}`);
    const dl = shell.viewExtra.querySelector('dl')!; dl.replaceChildren();
    for (const m of metrics.filter(m => f.scope === 'official' || m === 'cases' || m === 'rate')) { const row = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = labels[m]; dd.textContent = format(value(record, { ...f, metric: m }), m); row.append(dt, dd); dl.append(row); }
    const missing = record?.unassigned[f.category] ?? 0;
    text('coverage', f.scope === 'regional' ? view.level === 'town' && view.selected ? '此數字只含來源明列在本鄉鎮的案件。' : `鄉鎮未對照 ${missing.toLocaleString('zh-TW')} 件，保留於上層合計，不分攤。${!region ? `其中縣市未對照 ${(record?.unassigned['county:' + f.category] ?? 0).toLocaleString('zh-TW')} 件。` : ''}` : !region ? `全臺包含署所屬機關；其中 ${(record?.unassigned['cases:' + f.category] ?? 0).toLocaleString('zh-TW')} 件及 ${(record?.unassigned['suspects:' + f.category] ?? 0).toLocaleString('zh-TW')} 嫌疑犯未分配到縣市。` : '按縣市警察機關受（處）理統計，僅提供縣市數字。');
    text('note', f.scope === 'regional' ? `每季初步統計；收錄 ${data.categories.filter(k => k !== 'total').map(k => categoryLabels[k]).join('、')}。合計只代表這 8 案類，未涵蓋所有刑案。` : '警方嫌疑犯統計不代表法院定罪人數，亦不代表當地居民犯罪人數；跨案／跨期不宣稱為去重個人數。');
    text('denominator', `人口分母：${data.populationLabel}。案件發生率＝件數 ÷ 人口 × 十萬${f.scope === 'official' ? '；犯罪人口率＝嫌疑犯人數 ÷ 人口 × 十萬' : ''}。戶籍人口作為比較基準，不代表居民個人風險。`);
    text('warning', f.year === 2024 ? '2024 年刑案系統整合曾造成資料缺漏，9 月起案件計數方式變更；與其他年度的差異不能全部解讀為犯罪增減。' : f.scope === 'regional' ? '此資料為初步數，可能與官方修訂後年度統計不同。' : '當年資料為已公布統計，後續可能修訂。2024 年統計口徑不同，跨年比較需留意。');
    const title = document.createElement('strong'); title.textContent = `${categoryLabel(f)} · ${labels[f.metric]}（${unit(f.metric)}）`;
    const scale = document.createElement('div'); scale.className = 'crime-scale'; const boundaries = cuts(f, view.level === 'detail' ? 'town' : view.level);
    const ranges = [`大於 0 至未滿 ${boundaries[0]}`, ...boundaries.slice(0, -1).map((x, i) => `${x} 至未滿 ${boundaries[i + 1]}`), `${boundaries.at(-1)} 以上`];
    ranges.forEach((range, i) => { const span = document.createElement('span'), swatch = document.createElement('i'); swatch.style.backgroundColor = colors[i]; span.append(swatch, document.createTextNode(range)); scale.append(span); });
    const note = document.createElement('p'); note.textContent = '0：白色 · 無資料：灰色／斜紋 · 同指標跨年固定級距'; legend.replaceChildren(title, scale, note);
  }
  return { render, setFilter, setBusy(busy: boolean) { Object.values(selects).forEach(s => { s.disabled = busy; }); }, obstacles(): Rect[] { if (innerWidth <= 760) return []; const r = legend.getBoundingClientRect(), origin = shell.mapContainer.getBoundingClientRect(); return [{ x: r.x - origin.x, y: r.y - origin.y, w: r.width, h: r.height }]; }, destroy() { abort.abort(); legend.remove(); shell.root.classList.remove('crime-page'); } };
}
