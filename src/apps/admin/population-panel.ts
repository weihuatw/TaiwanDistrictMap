import type { PopulationRepository } from '../../data/population';
import type { RegionLevel, View } from '../../map-core/types';

export function populationTarget(view: Pick<View, 'selected' | 'path'>) {
  const region = view.selected ?? view.path.at(-1);
  return region ? {
    name: region.properties.name,
    level: region.properties.level as RegionLevel | 'national',
    code: region.properties.code,
    unassigned: region.properties.unassigned,
  } : { name: '全臺', level: 'national' as const, code: 'TW', unassigned: false };
}

/** Keep one disclosure element alive so its open state survives navigation. */
export function createPopulationPanel(container: HTMLElement, repository: PopulationRepository, onResize: () => void) {
  container.innerHTML = `
    <details class="population-panel" open>
      <summary><span data-population-title>戶籍人口</span><strong data-population-total>載入中…</strong></summary>
      <div class="population-body" aria-live="polite" aria-atomic="true">
        <p data-population-status>載入戶籍人口…</p>
        <div data-population-content hidden>
          <dl class="population-metrics">
            <div><dt>男性</dt><dd data-population-male></dd></div>
            <div><dt>女性</dt><dd data-population-female></dd></div>
            <div><dt>戶數</dt><dd data-population-households></dd></div>
          </dl>
          <p class="population-attribution" data-population-date></p>
          <a class="population-source" href="https://data.gov.tw/dataset/77132" target="_blank" rel="noopener noreferrer">內政部戶政司資料 ↗</a>
        </div>
      </div>
    </details>`;
  const find = (selector: string) => container.querySelector<HTMLElement>(selector)!;
  const disclosure = container.querySelector<HTMLDetailsElement>('details')!;
  const title = find('[data-population-title]');
  const total = find('[data-population-total]');
  const status = find('[data-population-status]');
  const content = find('[data-population-content]');
  const lifetime = new AbortController();
  let sequence = 0;
  disclosure.addEventListener('toggle', onResize, { signal: lifetime.signal });

  function render(view: View) {
    const target = populationTarget(view);
    const token = ++sequence;
    title.textContent = `${target.name}人口`;
    total.textContent = '載入中…';
    status.textContent = '載入戶籍人口…';
    status.hidden = false;
    content.hidden = true;
    if (target.unassigned) {
      total.textContent = '無資料';
      status.textContent = '未編定範圍沒有村里戶籍統計';
      return;
    }
    const load = () => {
      if (lifetime.signal.aborted || token !== sequence) return;
      total.textContent = '載入中…';
      status.textContent = '載入戶籍人口…';
      const request = target.level === 'national' ? repository.getNational()
        : target.level === 'county' ? repository.getCounty(target.code)
        : target.level === 'town' ? repository.getTown(target.code)
        : repository.getVillage(target.code);
      void request.then(result => {
        if (lifetime.signal.aborted || token !== sequence) return;
        if (!result.record) {
          total.textContent = '無資料';
          status.textContent = '此區域沒有可對應的戶籍人口資料';
          return;
        }
        const record = result.record;
        const format = (number: number, unit: string) => `${number.toLocaleString('zh-TW')} ${unit}`;
        total.textContent = format(record.population, '人');
        find('[data-population-male]').textContent = format(record.male, '人');
        find('[data-population-female]').textContent = format(record.female, '人');
        find('[data-population-households]').textContent = format(record.households, '戶');
        find('[data-population-date]').textContent = `${result.label} · 戶籍人口`;
        content.hidden = false;
        status.hidden = true;
        onResize();
      }).catch(() => {
        if (lifetime.signal.aborted || token !== sequence) return;
        total.textContent = '暫無法載入';
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'population-retry';
        retry.textContent = '重試';
        retry.addEventListener('click', load, { signal: lifetime.signal });
        status.replaceChildren(document.createTextNode('戶籍人口資料暫時無法載入。 '), retry);
      });
    };
    load();
  }

  return { render, destroy: () => { sequence++; lifetime.abort(); container.replaceChildren(); } };
}
