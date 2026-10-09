import type { View, RegionHit } from '../../map-core/types';
import type { createMapShell } from '../../ui/map-shell';
import type { PoliticsRepository } from './data';
import type { PoliticalManifest, PoliticalMode, PoliticalRecord } from './types';
import { availableModes, recordColor, recordLabel, winners, TIE_COLOR, MISSING_COLOR } from './theme';

type Shell = ReturnType<typeof createMapShell>;
const MODE_LABELS = { officials: '首長／村里長黨籍', mayor: '2022 縣市長得票', president: '2024 總統得票' };
const number = (value: number) => value.toLocaleString('zh-TW');
export function createPoliticsPanel(shell: Shell, repository: PoliticsRepository, onMode: (mode: PoliticalMode) => void) {
  shell.root.classList.add('politics-page');
  const lifetime = new AbortController();
  shell.viewExtra.innerHTML = '<label class="politics-control">顯示資料<select aria-label="政治地圖顯示資料"></select></label><p class="politics-version"></p><div class="politics-legend" aria-label="政黨色彩圖例"></div>';
  shell.infoExtra.innerHTML = '<details class="politics-details" open><summary>政治資料</summary><div class="politics-body" aria-live="polite"></div></details><div class="politics-population"></div>';
  const select = shell.viewExtra.querySelector<HTMLSelectElement>('select')!;
  const version = shell.viewExtra.querySelector<HTMLElement>('.politics-version')!;
  const legend = shell.viewExtra.querySelector<HTMLElement>('.politics-legend')!;
  const body = shell.infoExtra.querySelector<HTMLElement>('.politics-body')!;
  let mode: PoliticalMode = 'officials';
  let meta: PoliticalManifest | undefined;
  select.addEventListener('change', () => onMode(select.value as PoliticalMode), { signal: lifetime.signal });
  shell.infoExtra.querySelector('details')!.addEventListener('toggle', () => shell.root.dispatchEvent(new Event('politicsresize')), { signal: lifetime.signal });
  function line(text: string, className = '') { const p = document.createElement('p'); p.textContent = text; p.className = className; body.append(p); return p; }
  function link(text: string, url: string) { const a = document.createElement('a'); a.textContent = `${text} ↗`; a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; body.append(a); }
  function renderRecord(record: PoliticalRecord | null) {
    if (!record) { line('目前資料無法唯一對應此範圍；未將舊村里資料分攤到現行界線。'); return; }
    if ('candidates' in record) {
      const best = winners(record.candidates);
      if (record.partialReason) line(record.partialReason, 'politics-note');
      const scope = record.partialReason ? '已分列資料' : '此範圍';
      line(best.length ? `${scope}${best.length > 1 ? '最高票並列：' : '最高票：'}${best.map(c => c.name).join('、')}` : `${scope}沒有有效票`, 'politics-headline');
      line(`${record.date} 投票 · ${record.electionId === 'chiayi-2022' ? '嘉義市長重行選舉' : mode === 'president' ? '總統副總統選舉' : '縣市長選舉'}`, 'politics-note');
      const table = document.createElement('table'); table.className = 'politics-votes';
      const caption = document.createElement('caption'); caption.textContent = '候選人得票與參選推薦政黨'; table.append(caption);
      const head = document.createElement('thead'); const header = document.createElement('tr');
      for (const text of ['候選人／政黨', '得票', '得票率']) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = text; header.append(th); }
      head.append(header); table.append(head);
      const tbody = document.createElement('tbody');
      for (const c of [...record.candidates].sort((a, b) => b.votes - a.votes || a.number - b.number)) {
        const tr = document.createElement('tr'); tr.classList.toggle('is-leading', best.includes(c));
        const name = document.createElement('th'); name.scope = 'row'; name.textContent = `${c.number}. ${c.name}`;
        const party = document.createElement('small'); party.textContent = c.party; name.append(party);
        const votes = document.createElement('td'); votes.textContent = number(c.votes);
        const rate = document.createElement('td'); rate.textContent = record.validVotes ? `${(c.votes / record.validVotes * 100).toFixed(2)}%` : '—';
        tr.append(name, votes, rate); tbody.append(tr);
      }
      table.append(tbody); body.append(table);
      line(`有效票 ${number(record.validVotes)} · 無效票 ${number(record.invalidVotes)}`);
      line(`選舉人 ${number(record.electors)} · 投票率 ${record.electors ? ((record.validVotes + record.invalidVotes) / record.electors * 100).toFixed(2) + '%' : '—'}`);
      line(record.partialReason ? '此表僅包含來源分列的票數與選舉人，得票率和投票率皆以這些分列資料計算；完整村里以斜紋呈現。' : '色彩代表此範圍最高票候選人的參選推薦政黨；不是現任黨籍，也不代表在此範圍另有一場選舉。', 'politics-note');
      link('中選會正式選舉資料', 'https://db.cec.gov.tw/ElecTable');
    } else {
      line(record.name ? `${record.role} ${record.name}` : '名錄有多位不同人員，現職待查證', 'politics-headline');
      line(`黨籍：${recordLabel(record)}`);
      line(`名錄查核／取得：${record.verifiedAt}`, 'politics-note');
      line(record.note, 'politics-note');
      if (record.registryParty !== undefined) line(`內政部原名錄：${record.registryParty ?? '未載'}（已依補充來源更新）`, 'politics-note');
      link('人員與黨籍來源', record.sourceUrl);
      if (record.officeSourceUrl) link('現職來源', record.officeSourceUrl);
    }
  }
  function render(view: View, active: PoliticalMode, manifest: PoliticalManifest) {
    mode = active; meta = manifest;
    const allowed = availableModes(view.level === 'detail' ? 'village' : view.level);
    select.replaceChildren(...allowed.map(value => {
      const option = document.createElement('option'); option.value = value;
      option.textContent = value === 'officials'
        ? view.level === 'county' ? '各縣市首長黨籍' : '村里長黨籍'
        : MODE_LABELS[value];
      return option;
    }));
    select.value = mode;
    version.textContent = mode === 'officials' ? `本屆名錄 · ${manifest.snapshot} 取得及補充查核` : mode === 'mayor' ? '2022-11-26 · 嘉義市 2022-12-18' : '2024-01-13 · 總統副總統選舉';
    body.replaceChildren();
    const region = view.selected ?? view.path.at(-1);
    if (mode === 'officials' && !view.selected) {
      const records = view.data.features.map(f => repository.get(mode, f.properties.code));
      const counts = new Map<string, number>();
      for (const record of records) { const party = recordLabel(record); counts.set(party, (counts.get(party) ?? 0) + 1); }
      line(view.level === 'county' ? '各縣市首長黨籍' : `${region?.properties.name ?? ''}村里長黨籍`, 'politics-headline');
      for (const [party, count] of [...counts].sort((a, b) => b[1] - a[1])) line(`${party} · ${count} 個範圍`);
      line('名錄可能延遲更新；代理、補選或多位同列紀錄依來源標示，未能確認者留白並顯示斜紋。', 'politics-note');
      line(`本屆名錄可唯一對照 ${number(manifest.coverage.officials.mappedVillages)}／${number(manifest.coverage.officials.namedBoundaries)} 個具名村里。`, 'politics-note');
    } else if (!view.selected && view.level === 'county' && (mode === 'mayor' || mode === 'president')) {
      const counts = new Map<string, number>();
      for (const feature of view.data.features) {
        const party = recordLabel(repository.get(mode, feature.properties.code));
        counts.set(party, (counts.get(party) ?? 0) + 1);
      }
      line(mode === 'mayor' ? '縣市長選舉・各縣市領先政黨' : '總統選舉・各縣市領先政黨', 'politics-headline');
      for (const [party, count] of [...counts].sort((a, b) => b[1] - a[1])) line(`${party} · ${count} 個縣市`);
      line('地圖依各縣市各自的最高票候選人參選推薦政黨著色；無黨籍候選人分別比較，並列不指定單一政黨。', 'politics-note');
      line('這是各縣市選舉結果分布，不代表全臺單一總票數或全國勝選政黨。', 'politics-note');
      link('中選會正式選舉資料', 'https://db.cec.gov.tw/ElecTable');
    } else if (region) {
      if (view.level === 'town') {
        const official = repository.get('officials', region.properties.code);
        if (official && !('candidates' in official)) {
          line(`現職名錄：${official.role} ${official.name ?? '待查證'} · ${recordLabel(official)}`, 'politics-headline');
          line(official.note, 'politics-note');
          link('首長黨籍來源', official.sourceUrl);
        }
      }
      renderRecord(repository.get(mode, region.properties.code));
    }
    const visible = view.data.features.map(f => repository.get(mode, f.properties.code));
    const parties = [...new Set(visible.map(record => record && 'candidates' in record ? winners(record.candidates).map(c => c.party) : record && record.party ? [record.party] : []).flat())].sort();
    legend.replaceChildren();
    for (const party of parties) {
      const item = document.createElement('span'); const swatch = document.createElement('i'); swatch.style.background = manifest.colors[party] ?? '#a493b0'; item.append(swatch, document.createTextNode(party)); legend.append(item);
    }
    for (const [label, color, className] of [['並列', TIE_COLOR, ''], ['無資料／待查', MISSING_COLOR, 'politics-missing'], ['鄰區可切換', '#c4cbd0', '']] as const) {
      const item = document.createElement('span'); const swatch = document.createElement('i'); swatch.style.backgroundColor = color; swatch.className = className; item.append(swatch, document.createTextNode(label)); legend.append(item);
    }
  }
  function tooltip(hit: RegionHit) {
    if (hit.parentIndex !== undefined) return `切換至 ${hit.region.properties.name}`;
    const record = repository.get(mode, hit.region.properties.code);
    const label = recordLabel(record);
    return `${hit.region.properties.name}\n${record && 'candidates' in record ? record.date + (record.partialReason ? ' · ' : ' 最高票 · ') : ''}${label}${record && !('candidates' in record) && record.name ? '\n' + record.role + ' ' + record.name : ''}`;
  }
  function showSources(manifest: PoliticalManifest) {
    for (const source of manifest.sources) {
      const div = document.createElement('div'); div.className = 'source-row';
      const a = document.createElement('a'); a.href = source.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = `${source.title} ↗`;
      div.append(a); shell.sourceContent.append(div);
    }
    const note = document.createElement('p'); note.className = 'source-footnote'; note.textContent = `取得：${manifest.snapshot}。${manifest.notes.join(' ')} 村里對照：縣市長 ${manifest.coverage.mayor.mappedVillages}、總統 ${manifest.coverage.president.mappedVillages}（其中 ${manifest.coverage.president.partialVillages} 里因部分票數合併列示不判定最高票）、本屆名錄 ${manifest.coverage.officials.mappedVillages}／${manifest.coverage.officials.namedBoundaries}。首長資料含中央社報導的本人／政黨聲明補充，逐筆標示來源。`;
    const audit = document.createElement('a'); audit.href = `${import.meta.env.BASE_URL}data/politics/join-report.json`; audit.target = '_blank'; audit.rel = 'noopener noreferrer'; audit.textContent = '覆蓋率、缺漏與加總核對報告 ↗';
    shell.sourceContent.append(note, audit);
  }
  return { render, tooltip, showSources, setBusy: (busy: boolean) => { select.disabled = busy; }, populationContainer: shell.infoExtra.querySelector<HTMLElement>('.politics-population')!, destroy() { lifetime.abort(); }, getColor(record: PoliticalRecord | null) { return recordColor(record, meta?.colors ?? {}); } };
}
