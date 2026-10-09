import type { Rect, View, RegionHit } from '../../map-core/types';
import type { createMapShell } from '../../ui/map-shell';
import type { IncomeRepository } from './data';
import type { IncomeManifest, IncomeRecord } from './types';
import { COLORS, LABELS, compareIncome, formatWan } from './theme';

type Shell = ReturnType<typeof createMapShell>;
export function createIncomePanel(shell: Shell, income: IncomeRepository) {
  shell.root.classList.add('income-page');
  const badge = document.createElement('p'); badge.className = 'income-year';
  badge.innerHTML = '<span>2024 所得年度</span><span class="preliminary-badge">初步核定</span>';
  shell.root.querySelector('.heading-row')!.before(badge);
  const summary = document.createElement('section'); summary.className = 'income-summary'; summary.setAttribute('aria-label', '所得統計');
  summary.innerHTML = '<p class="income-metric-label">每申報戶平均年綜合所得</p><div class="income-value-row"><strong id="income-value">—</strong><span id="income-unit">萬元／年</span></div><p id="income-description" class="income-description">正在載入官方統計…</p><div class="income-facts"><div><span>納稅申報戶</span><strong id="income-units">—</strong></div><div id="median-fact" hidden><span>中位數</span><strong id="income-median">—</strong></div></div><p id="income-comparison" class="income-comparison" hidden></p><p id="income-origin" class="income-origin"></p>';
  shell.viewExtra.append(summary);
  const legend = document.createElement('section'); legend.className = 'income-legend'; legend.setAttribute('aria-label', '所得色階圖例');
  legend.innerHTML = '<div class="income-legend-heading"><strong>平均年綜合所得</strong><span>萬元／戶</span></div><div class="income-legend-scale"></div><p class="income-legend-note">全國統一級距 · 深色代表較高所得</p><div class="income-legend-key"><span class="missing-swatch"></span><span>斜紋：無可對應資料</span><span class="context-swatch"></span><span>灰色：可切換地區</span></div><p class="income-data-note">2024稅務統計，非個人薪資或可支配所得。</p><a class="income-app-link" href="#/admin">行政區瀏覽 ↗</a>';
  const scale = legend.querySelector('.income-legend-scale')!;
  for (const [i, label] of LABELS.entries()) {
    const item = document.createElement('div'); item.className = 'income-legend-item';
    const swatch = document.createElement('span'); swatch.style.background = COLORS[i];
    const text = document.createElement('span'); text.textContent = label;
    item.append(swatch, text); scale.append(item);
  }
  shell.uiContainer.append(legend);
  shell.addMobileContent(legend);
  const element = (id: string) => summary.querySelector<HTMLElement>(`#${id}`)!;
  let manifest: IncomeManifest | null = null;

  function render(view: View, meta: IncomeManifest) {
    manifest = meta;
    const region = view.selected ?? view.path.at(-1);
    const r = region ? income.get(region.properties.code) : null;
    const mean = region ? r?.meanK ?? null : meta.national.meanK;
    const units = region ? r?.taxUnits ?? null : meta.national.taxUnits;
    element('income-value').textContent = mean === null ? '無資料' : formatWan(mean);
    element('income-value').classList.toggle('is-missing', mean === null);
    element('income-unit').hidden = mean === null;
    element('income-units').textContent = units === null ? '—' : `${units.toLocaleString('zh-TW')} 戶`;
    element('income-description').textContent = region ? (mean === null ? (r?.taxUnits === 0 ? '官方統計為0戶，無可計算的平均所得。' : '2024所得資料未能對應此界線，未作分攤。') : `${region.properties.name}的申報戶統計`) : '全臺22縣市，以申報戶數加權計算';
    element('median-fact').hidden = mean === null || r?.medianK == null;
    element('income-median').textContent = r?.medianK == null ? '—' : `${formatWan(r.medianK)} 萬`;
    element('income-origin').textContent = r ? originLabel(r) : region ? '現行界線與所得年度不同；詳見資料來源。' : '官方縣市所得總額 ÷ 納稅戶數';
    const parent = view.path.length > 1 ? view.path.at(-2) : null;
    const reference = parent ? income.get(parent.properties.code)?.meanK : meta.national.meanK;
    const difference = compareIncome(mean, reference);
    const comparison = element('income-comparison'); comparison.hidden = !region || difference === null;
    if (region && difference !== null) comparison.textContent = `較${parent?.properties.name ?? '全臺22縣市平均'} ${difference >= 0 ? '+' : ''}${difference.toFixed(1)}%`;
  }
  function tooltip(hit: RegionHit) {
    const r = income.get(hit.region.properties.code);
    const amount = r?.meanK == null ? '無可對應所得資料' : `平均 ${formatWan(r.meanK)} 萬元／戶／年`;
    return `${hit.parentIndex !== undefined ? '切換至 ' : ''}${hit.region.properties.name}\n${amount}`;
  }
  function showSources(meta: IncomeManifest) {
    const section = document.createElement('div'); section.className = 'source-row income-source';
    const link = document.createElement('a'); link.href = meta.catalogUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = '財政部2024所得初步核定統計 ↗';
    const text = document.createElement('p');
    const fraction = meta.coverage.mappedTaxUnits / meta.coverage.totalTaxUnits * 100;
    text.textContent = `發布：${meta.publishedAt}。縣市採表6-1總額／戶數，區及村里採表165；不混用「總所得」或「所得淨額」。\n已對應 ${meta.counts.village.toLocaleString()} 個村里；目前界線有 ${meta.coverage.missingNamedBoundaries} 個具名村里未對應，另有 ${meta.coverage.unassignedBoundaries} 個未編定範圍。對應村里涵蓋22縣市申報戶的 ${fraction.toFixed(2)}%。\n所得年度為2024，界線使用現有官方發布版本；拆分、合併及未定位的「其他」統計未任意分配給現行界線。其他統計仍保留在上層總額中。\n金額呈現至0.1萬元；色階上界不含，下界包含，以呈現金額分級。\n本統計不含免稅、分離課稅與非課稅所得，不等同個人薪資或可支配所得。`;
    text.style.whiteSpace = 'pre-line';
    const audit = document.createElement('a'); audit.href = `${import.meta.env.BASE_URL}data/income/2024/join-report.json`; audit.target = '_blank'; audit.rel = 'noopener noreferrer'; audit.className = 'income-audit-link'; audit.textContent = '行政區對照與加總核對紀錄 ↗';
    section.append(link, text, audit); shell.sourceContent.append(section);
  }
  function obstacles(): Rect[] {
    if (innerWidth <= 760) return [];
    const origin = shell.mapContainer.getBoundingClientRect(); const rect = legend.getBoundingClientRect();
    return [{ x: rect.x - origin.x - 6, y: rect.y - origin.y - 6, w: rect.width + 12, h: rect.height + 12 }];
  }
  return { render, tooltip, showSources, obstacles, get manifest() { return manifest; } };
}

function originLabel(r: IncomeRecord) {
  if (r.origin === 'official-county-total') return '官方縣市所得總額 ÷ 納稅戶數';
  if (r.origin === 'official-town-summary') return '官方行政區合計 · 非各里的簡單平均';
  if (r.origin === 'village-weighted') return '村里所得總額與戶數加權彙整';
  return `官方村里統計 · 代碼 ${r.code}`;
}
