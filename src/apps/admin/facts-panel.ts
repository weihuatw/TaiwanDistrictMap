import type { View } from '../../map-core/types';
import type { IncomeRepository } from '../income/data';
import { formatWan } from '../income/theme';
import type { HousingRepository } from '../housing/data';
import { formatPrice, groupName } from '../housing/theme';
import type { HousingGroup, HousingSummary } from '../housing/types';
import type { PoliticsRepository } from '../politics/data';
import { recordLabel, recordParty, winners } from '../politics/theme';
import type { ElectionRecord, PoliticalManifest, PoliticalMode, PoliticalPart, PoliticalRecord } from '../politics/types';
import type { SchoolRepository } from '../school/data';
import type { School, SchoolManifest } from '../school/types';
import { populationTarget } from './population-panel';

type FactTarget = ReturnType<typeof populationTarget> & { townCode: string | null };
type FactCard = { element: HTMLDetailsElement; summary: HTMLElement; body: HTMLElement };
type FactData = { income: IncomeRepository; housing: HousingRepository; school: SchoolRepository; politics: PoliticsRepository };
const MODES: PoliticalMode[] = ['officials', 'mayor', 'president'];
const HOUSING_YEAR = 2025;
const HOUSING_GROUP: HousingGroup = 'standard';

function targetFor(view: View): FactTarget {
  const region = view.selected ?? view.path.at(-1);
  const target = populationTarget(view);
  return { ...target, townCode: region?.properties.townCode ?? (target.level === 'town' ? target.code : null) };
}

function makeCard(container: HTMLElement, title: string, onResize: () => void): FactCard {
  const element = document.createElement('details');
  element.className = 'admin-fact-panel';
  const summary = document.createElement('summary');
  const label = document.createElement('span'); label.className = 'admin-fact-title'; label.textContent = title;
  const value = document.createElement('strong'); value.className = 'admin-fact-summary'; value.textContent = '載入中…';
  summary.append(label, value);
  const body = document.createElement('div'); body.className = 'admin-fact-body'; body.setAttribute('aria-live', 'polite'); body.setAttribute('aria-atomic', 'true');
  element.append(summary, body); container.append(element);
  element.addEventListener('toggle', onResize);
  return { element, summary: value, body };
}

function text(tag: 'p' | 'strong' | 'span' | 'small' | 'h3' | 'li', value: string, className?: string) {
  const node = document.createElement(tag); node.textContent = value;
  if (className) node.className = className;
  return node;
}

function sourceLink(url: string, label: string) {
  const link = document.createElement('a');
  if (/^https?:\/\//.test(url)) { link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
  link.textContent = `${label} ↗`; link.className = 'admin-fact-source';
  return link;
}

function metrics(rows: [string, string][]) {
  const list = document.createElement('dl'); list.className = 'admin-fact-metrics';
  for (const [label, value] of rows) {
    const item = document.createElement('div'); const term = document.createElement('dt'); const detail = document.createElement('dd');
    term.textContent = label; detail.textContent = value; item.append(term, detail); list.append(item);
  }
  return list;
}

function boundaryFile(target: FactTarget) {
  if (target.level === 'national' || target.level === 'county') return 'counties.geojson';
  if (target.level === 'town') return `towns/${target.code.slice(0, 5)}.geojson`;
  return `villages/${target.code.slice(0, 8)}.geojson`;
}

function sourceForIncome(origin: string) {
  if (origin === 'official-county-total') return '官方縣市所得總額與戶數';
  if (origin === 'official-town-summary') return '官方鄉鎮市區合計';
  if (origin === 'village-weighted') return '依村里所得與戶數加權彙整';
  return '官方村里統計';
}

function electionParty(record: PoliticalRecord | null) {
  if (!record) return '無資料';
  if (!('candidates' in record)) return recordLabel(record);
  if (record.partialReason) return '部分票數';
  const best = winners(record.candidates);
  return best.length > 1 ? '最高票並列' : best.length ? best[0].party : '無有效票';
}

function electionTitle(record: ElectionRecord, mode: PoliticalMode) {
  if (mode === 'president') return '2024 總統副總統選舉';
  if (record.electionId === 'chiayi-2022') return '2022 嘉義市長重行選舉';
  if (record.electionId === 'municipal-2022') return '2022 直轄市長選舉';
  return '2022 縣市長選舉';
}

/** Adds compact, independently collapsible topic facts to the administrative explorer. */
export function createAdminFactsPanel(container: HTMLElement, repositories: FactData, onResize: () => void) {
  const incomeCard = makeCard(container, '所得', onResize);
  const schoolCard = makeCard(container, '學區', onResize);
  const housingCard = makeCard(container, '房價', onResize);
  const politicsCard = makeCard(container, '政黨', onResize);
  const lifetime = new AbortController();
  let sequence = 0;
  let alive = true;

  const current = (token: number) => alive && token === sequence;
  function loading(card: FactCard) {
    card.summary.textContent = '載入中…';
    card.body.replaceChildren(text('p', '正在載入資料…'));
    onResize();
  }
  function unavailable(card: FactCard, message: string) {
    card.summary.textContent = '暫無資料';
    card.body.replaceChildren(text('p', message));
    onResize();
  }
  function failed(card: FactCard, action: () => Promise<void>) {
    card.summary.textContent = '載入失敗';
    const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'population-retry'; retry.textContent = '重試';
    retry.addEventListener('click', () => { void action(); }, { signal: lifetime.signal });
    card.body.replaceChildren(text('p', '資料暫時無法載入。'), retry);
    onResize();
  }

  async function renderIncome(target: FactTarget, token: number) {
    const load = async (): Promise<void> => {
      if (!current(token)) return;
      loading(incomeCard);
      if (target.unassigned) { unavailable(incomeCard, '未編定範圍沒有可對應的所得統計。'); return; }
      try {
        const [manifest] = await Promise.all([repositories.income.manifest(), repositories.income.load(boundaryFile(target))]);
        if (!current(token)) return;
        const record = target.level === 'national' ? null : repositories.income.get(target.code);
        const mean = target.level === 'national' ? manifest.national.meanK : record?.meanK ?? null;
        const taxUnits = target.level === 'national' ? manifest.national.taxUnits : record?.taxUnits ?? null;
        incomeCard.summary.textContent = mean == null ? (taxUnits === 0 ? '0 戶申報' : '無對應資料') : `${formatWan(mean)} 萬／戶／年`;
        const rows: [string, string][] = [
          ['所得年度', `${manifest.year} 年（${manifest.statusLabel}）`],
          ['每申報戶平均年綜合所得', mean == null ? '無可計算平均' : `${formatWan(mean)} 萬元`],
          ['納稅申報戶', taxUnits == null ? '無資料' : `${taxUnits.toLocaleString('zh-TW')} 戶`],
        ];
        if (record?.medianK != null) rows.push(['中位數', `${formatWan(record.medianK)} 萬元／申報戶`]);
        if (target.level !== 'national' && !record) rows.push(['資料狀態', '此行政區未能對應官方統計']);
        cardContent(incomeCard, [
          text('p', target.level === 'national' ? '全臺縣市以申報戶數加權計算。' : `${target.name}的申報戶統計。`),
          metrics(rows),
          text('p', record ? sourceForIncome(record.origin) : '官方縣市所得總額除以納稅戶數。', 'admin-fact-note'),
          text('p', '本數字是每申報戶年綜合所得，不是個人薪資或可支配所得。', 'admin-fact-note'),
          sourceLink(manifest.catalogUrl, '財政部所得統計來源'),
        ]);
      } catch { if (current(token)) failed(incomeCard, load); }
    };
    await load();
  }

  async function renderSchool(target: FactTarget, token: number) {
    schoolCard.element.hidden = target.level !== 'village' || target.unassigned;
    if (target.level !== 'village' || target.unassigned) return;
    const load = async (): Promise<void> => {
      if (!current(token)) return;
      loading(schoolCard);
      try {
        const [schools, manifest] = await Promise.all([repositories.school.schoolsForVillage(target.code), repositories.school.manifest()]);
        if (!current(token)) return;
        const elementary = schools.filter(school => school.level === 'elementary').length;
        const junior = schools.filter(school => school.level === 'junior').length;
        schoolCard.summary.textContent = schools.length ? `國小 ${elementary} 校 · 國中 ${junior} 校` : '目前沒有已對照的學區';
        const content: HTMLElement[] = [
          text('p', `${target.name}目前已對照到的官方學區學校。跨鄉鎮市區共同學區也會列入。`),
        ];
        if (!schools.length) content.push(text('p', '目前未找到已對照至此里界的學區學校。學區資料收錄範圍不完整，不能據此判定沒有學區。', 'admin-fact-note'));
        const list = document.createElement('ul'); list.className = 'admin-school-list';
        for (const school of schools) list.append(schoolListItem(school, manifest, target.code));
        if (schools.length) content.push(list);
        content.push(text('p', '里界填色表示有部分或全部鄰屬於該校，不代表整里所有住戶皆屬學區。各校學年度以來源為準。', 'admin-fact-note'));
        cardContent(schoolCard, content);
      } catch { if (current(token)) failed(schoolCard, load); }
    };
    await load();
  }

  async function renderHousing(target: FactTarget, token: number) {
    const load = async (): Promise<void> => {
      if (!current(token)) return;
      loading(housingCard);
      if (target.unassigned) { unavailable(housingCard, '未編定範圍沒有可對應的房價統計。'); return; }
      try {
        const manifestPromise = repositories.housing.manifest();
        let summary: HousingSummary | null;
        let villageReference = false;
        if (target.level === 'national') {
          summary = await repositories.housing.getNational(HOUSING_YEAR, HOUSING_GROUP);
        } else {
          const countyScope = target.level === 'county';
          const lookupCode = target.level === 'village' ? target.townCode : target.code;
          if (!lookupCode) throw new Error('Missing housing summary code');
          const file = countyScope ? 'counties.geojson' : `towns/${lookupCode.slice(0, 5)}.geojson`;
          await repositories.housing.load(file, HOUSING_YEAR, HOUSING_GROUP);
          summary = repositories.housing.get(HOUSING_YEAR, HOUSING_GROUP, lookupCode);
          villageReference = target.level === 'village';
        }
        const manifest = await manifestPromise;
        if (!current(token)) return;
        const label = villageReference ? '所屬鄉鎮參考' : target.level === 'national' ? '全臺統計' : target.level === 'county' ? '縣市統計' : '鄉鎮市區統計';
        const price = summary?.status === 'insufficient' || summary?.status === 'no_samples' ? null : summary?.medianWanPing ?? null;
        housingCard.summary.textContent = summary ? formatPrice(price) : '無可對應資料';
        const content: HTMLElement[] = [text('p', `${label} · ${HOUSING_YEAR} 年 · ${groupName(HOUSING_GROUP)}`)];
        if (villageReference) content.push(text('p', '目前成交資料以鄉鎮市區彙整，這是所屬鄉鎮的參考統計，並非該里成交價格。', 'admin-fact-note'));
        if (!summary) {
          content.push(text('p', '此範圍沒有可對應的住宅成交統計。', 'admin-fact-note'));
        } else {
          content.push(metrics([
            ['可比單價中位數', formatPrice(price)],
            ['有效樣本', `${summary.eligibleCount.toLocaleString('zh-TW')} 筆`],
            ['住宅案件', `${summary.residentialCount.toLocaleString('zh-TW')} 筆`],
            ['全部交易案件', `${summary.transactionCount.toLocaleString('zh-TW')} 筆`],
            ['P25–P75', `${formatPrice(summary.p25TwdM2 == null ? null : summary.p25TwdM2 * 400 / 121 / 10000)} 至 ${formatPrice(summary.p75TwdM2 == null ? null : summary.p75TwdM2 * 400 / 121 / 10000)}`],
            ['無法拆分車位', `${summary.parkingUnknownCount.toLocaleString('zh-TW')} 筆`],
            ['其他未納入單價', `${summary.excludedCount.toLocaleString('zh-TW')} 筆`],
          ]));
          if (summary.status === 'low_sample') content.push(text('p', '有效樣本偏少，價格僅供參考。', 'admin-fact-note'));
        }
        content.push(text('p', '成交統計不代表區內所有住宅行情。', 'admin-fact-note'), sourceLink(manifest.catalogUrl, '內政部實價登錄批次資料'));
        cardContent(housingCard, content);
      } catch { if (current(token)) failed(housingCard, load); }
    };
    await load();
  }

  async function renderPolitics(target: FactTarget, token: number) {
    const load = async (): Promise<void> => {
      if (!current(token)) return;
      loading(politicsCard);
      if (target.unassigned) { unavailable(politicsCard, '未編定範圍沒有可對應的政黨資料。'); return; }
      try {
        const file = boundaryFile(target);
        const [manifest, parts] = await Promise.all([
          repositories.politics.manifest(), Promise.all(MODES.map(mode => repositories.politics.load(mode, file))),
        ]) as [PoliticalManifest, PoliticalPart[]];
        if (!current(token)) return;
        const byMode = new Map<PoliticalMode, Record<string, PoliticalRecord>>();
        MODES.forEach((mode, index) => byMode.set(mode, parts[index].records));
        if (target.level === 'national') renderNationalPolitics(politicsCard, byMode, manifest);
        else renderRegionalPolitics(politicsCard, target, byMode, manifest);
        onResize();
      } catch { if (current(token)) failed(politicsCard, load); }
    };
    await load();
  }

  function render(view: View) {
    const token = ++sequence;
    const target = targetFor(view);
    void renderIncome(target, token);
    void renderSchool(target, token);
    void renderHousing(target, token);
    void renderPolitics(target, token);
  }

  function cardContent(card: FactCard, children: HTMLElement[]) { card.body.replaceChildren(...children); onResize(); }

  return {
    render,
    destroy() { alive = false; sequence++; lifetime.abort(); incomeCard.element.remove(); schoolCard.element.remove(); housingCard.element.remove(); politicsCard.element.remove(); },
  };
}

function schoolListItem(school: School, manifest: SchoolManifest, villageCode: string) {
  const item = document.createElement('li'); item.className = 'admin-school-item';
  const heading = document.createElement('div'); heading.className = 'admin-school-heading';
  heading.append(text('strong', school.level === 'elementary' ? '國小' : '國中'), text('span', school.name));
  item.append(heading);
  const catchment = school.catchment!;
  item.append(text('p', catchment.year == null ? '學年度未註明' : `${catchment.year} 學年度`, 'admin-fact-note'));
  const relation = catchment.villages.find(village => village.code === villageCode);
  if (relation?.partial || relation?.shared) {
    const notes = [relation.partial ? '部分鄰' : '', relation.shared ? '共同學區' : ''].filter(Boolean);
    item.append(text('p', notes.join(' · '), 'admin-school-flags'));
  }
  if (catchment.text) item.append(text('p', `公告原文：${catchment.text}`, 'admin-fact-note'));
  if (catchment.notes) item.append(text('p', `備註：${catchment.notes}`, 'admin-fact-note'));
  const sourceIds = catchment.sourceIds?.length ? catchment.sourceIds : [catchment.sourceId];
  for (const sourceId of sourceIds) {
    const source = manifest.sources.find(item => item.id === sourceId);
    if (source?.datasetUrl) item.append(sourceLink(source.datasetUrl, source.title));
  }
  return item;
}

function renderNationalPolitics(card: FactCard, byMode: Map<PoliticalMode, Record<string, PoliticalRecord>>, manifest: PoliticalManifest) {
  card.summary.textContent = '縣市首長黨籍 · 2022／2024 得票政黨分布';
  const content: HTMLElement[] = [text('p', `名錄與選舉資料快照：${manifest.snapshot}。各縣市／選舉分開統計，不合併成單一全臺勝選政黨。`)];
  const labels: Record<PoliticalMode, string> = { officials: '各縣市首長黨籍', mayor: '2022 縣市長選舉', president: '2024 總統副總統選舉' };
  for (const mode of MODES) {
    const counts = new Map<string, number>(); let missing = 0;
    for (const record of Object.values(byMode.get(mode) ?? {})) {
      const party = recordParty(record);
      if (party) counts.set(party, (counts.get(party) ?? 0) + 1); else missing++;
    }
    const section = document.createElement('section'); section.className = 'admin-party-section'; section.append(text('h3', labels[mode]));
    const list = document.createElement('ul');
    for (const [party, count] of [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hant'))) list.append(text('li', `${party} · ${count} 個縣市`));
    section.append(list);
    if (missing) section.append(text('p', `${missing} 個縣市為待查、並列或無法對應資料。`, 'admin-fact-note'));
    content.push(section);
  }
  content.push(sourceLink('https://db.cec.gov.tw/ElecTable', '中選會正式選舉資料'));
  card.body.replaceChildren(...content);
}

function renderRegionalPolitics(card: FactCard, target: FactTarget, byMode: Map<PoliticalMode, Record<string, PoliticalRecord>>, manifest: PoliticalManifest) {
  const get = (mode: PoliticalMode) => byMode.get(mode)?.[target.code] ?? null;
  const official = get('officials');
  const mayor = get('mayor');
  const president = get('president');
  const shortOfficial = official && !('candidates' in official) ? recordLabel(official) : '無名錄資料';
  const mayorShort = electionParty(mayor);
  const presidentShort = electionParty(president);
  card.summary.textContent = target.level === 'county'
    ? `首長 ${shortOfficial} · 2022 ${mayorShort} · 2024 ${presidentShort}`
    : target.level === 'town'
      ? `2022 ${mayorShort} · 2024 ${presidentShort}`
      : `村里長 ${shortOfficial} · 2022 ${mayorShort} · 2024 ${presidentShort}`;
  const content: HTMLElement[] = [text('p', `資料快照：${manifest.snapshot}。黨籍名錄與歷史候選人推薦政黨分開呈現。`)];
  content.push(renderOfficial(official));
  content.push(renderElection(mayor, 'mayor'));
  content.push(renderElection(president, 'president'));
  content.push(sourceLink('https://db.cec.gov.tw/ElecTable', '中選會正式選舉資料'));
  card.body.replaceChildren(...content);
}

function renderOfficial(record: PoliticalRecord | null) {
  const section = document.createElement('section'); section.className = 'admin-party-section'; section.append(text('h3', '本屆政黨名錄'));
  if (!record || 'candidates' in record) { section.append(text('p', '無可對應的現任名錄資料。')); return section; }
  section.append(text('p', `${record.role}：${record.name ?? '待查證'} · 黨籍：${record.party ?? recordLabel(record)}`, 'admin-party-headline'));
  section.append(text('p', `查核／取得：${record.verifiedAt} · 狀態：${record.status}`, 'admin-fact-note'));
  if (record.note) section.append(text('p', record.note, 'admin-fact-note'));
  if (record.registryParty !== undefined) section.append(text('p', `內政部原名錄：${record.registryParty ?? '未載'}（已依補充來源更新）`, 'admin-fact-note'));
  if (record.sourceUrl) section.append(sourceLink(record.sourceUrl, '名錄來源'));
  if (record.officeSourceUrl) section.append(sourceLink(record.officeSourceUrl, '現職查核來源'));
  return section;
}

function renderElection(record: PoliticalRecord | null, mode: PoliticalMode) {
  const section = document.createElement('section'); section.className = 'admin-party-section';
  if (!record || !('candidates' in record)) { section.append(text('h3', mode === 'president' ? '2024 總統副總統選舉' : '2022 縣市長選舉')); section.append(text('p', '無可對應的選舉資料。')); return section; }
  section.append(text('h3', electionTitle(record, mode)));
  const leaders = winners(record.candidates);
  section.append(text('p', leaders.length ? `最高票：${leaders.map(candidate => `${candidate.name}（${candidate.party}）`).join('、')}` : '沒有有效票。', 'admin-party-headline'));
  if (record.partialReason) section.append(text('p', `${record.partialReason}；不得據此判定全里最高票。`, 'admin-fact-note'));
  section.append(text('p', `投票日：${record.date} · 有效票 ${record.validVotes.toLocaleString('zh-TW')} · 無效票 ${record.invalidVotes.toLocaleString('zh-TW')} · 選舉人 ${record.electors.toLocaleString('zh-TW')}`, 'admin-fact-note'));
  const list = document.createElement('ol'); list.className = 'admin-candidate-list';
  for (const candidate of [...record.candidates].sort((a, b) => b.votes - a.votes || a.number - b.number)) {
    const rate = record.validVotes ? ` · ${(candidate.votes / record.validVotes * 100).toFixed(2)}%` : '';
    list.append(text('li', `${candidate.name} · ${candidate.party} · ${candidate.votes.toLocaleString('zh-TW')} 票${rate}`));
  }
  section.append(list);
  return section;
}
