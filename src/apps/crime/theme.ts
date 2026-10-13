import type { CrimeRecord, CrimeScope, CrimePeriod } from '../../data/crime';
import type { RegionLevel } from '../../map-core/types';
export const metrics = ['cases', 'rate', 'suspects', 'offenderRate'] as const;
export type Metric = typeof metrics[number];
export interface Filter { year: number; scope: CrimeScope; period: CrimePeriod; category: string; metric: Metric }
export const labels: Record<Metric, string> = { cases: '案件發生件數', rate: '案件發生率', suspects: '嫌疑犯人數', offenderRate: '犯罪人口率（嫌疑犯）' };
export const categoryLabels: Record<string, string> = { total: '全般刑案', theft: '竊盜', fraud: '詐欺背信', injury: '傷害', publicDanger: '公共危險', drugs: '毒品', robberySnatching: '強盜搶奪', sexualOffense: '妨害性自主', homeTheft: '住宅竊盜', carTheft: '汽車竊盜', motorcycleTheft: '機車竊盜', robbery: '強盜', snatching: '搶奪', sexualAssault: '強制性交', organized: '組織犯罪防制條例' };
export function parseFilter(query: string): Filter {
  const q = new URLSearchParams(query), scope = q.get('scope') === 'regional' ? 'regional' : 'official';
  let metric = metrics.includes(q.get('metric') as Metric) ? q.get('metric') as Metric : 'rate';
  if (scope === 'regional' && (metric === 'suspects' || metric === 'offenderRate')) metric = 'rate';
  return { year: [2024, 2025, 2026].includes(Number(q.get('year'))) ? Number(q.get('year')) : 2026, scope, period: q.get('period') === 'half' ? 'half' : 'available', category: q.get('category') ?? 'total', metric };
}
export const filterQuery = (f: Filter) => new URLSearchParams({ year: String(f.year), scope: f.scope, period: f.period, category: f.category, metric: f.metric }).toString();
export const categoryLabel = (f: Filter) => f.category === 'total' && f.scope === 'regional' ? '收錄 8 案類合計' : categoryLabels[f.category] ?? f.category;
export const isRate = (m: Metric) => m === 'rate' || m === 'offenderRate';
export function value(r: CrimeRecord | null | undefined, f: Filter): number | null {
  if (!r) return null;
  const n = (f.metric === 'suspects' || f.metric === 'offenderRate' ? r.suspects : r.cases)?.[f.category];
  return n === undefined ? null : isRate(f.metric) ? n / r.population * 100000 : n;
}
export const unit = (m: Metric) => m === 'rate' ? '件／十萬人' : m === 'offenderRate' ? '人／十萬人' : m === 'suspects' ? '人' : '件';
export const format = (n: number | null, m: Metric) => n === null ? '無資料' : `${n.toLocaleString('zh-TW', { maximumFractionDigits: isRate(m) ? 1 : 0 })} ${unit(m)}`;
export const colors = ['#fff4dc', '#fee2a8', '#fec474', '#f99a4a', '#e96c33', '#cd422b', '#932a2d'];
export function cuts(f: Filter, level: RegionLevel): number[] {
  const rare = ['robbery', 'snatching', 'sexualAssault', 'organized', 'robberySnatching', 'sexualOffense'].includes(f.category);
  const vehicleOrHome = ['homeTheft', 'carTheft', 'motorcycleTheft'].includes(f.category);
  if (isRate(f.metric)) {
    if (rare) return [.1, .5, 1, 2, 5, 10];
    if (vehicleOrHome) return [1, 3, 5, 10, 20, 40];
    if (f.category === 'total' && f.scope === 'official') return [300, 600, 1000, 1500, 2000, 3000];
    if (f.category === 'fraud') return [25, 50, 100, 250, 500, 1000];
    return [10, 25, 50, 100, 200, 400];
  }
  if (rare) return level === 'county' ? [1, 5, 10, 20, 50, 100] : [1, 2, 3, 5, 10, 20];
  if (vehicleOrHome) return level === 'county' ? [10, 50, 100, 300, 500, 1000] : [1, 5, 10, 20, 50, 100];
  return level === 'county' ? [100, 500, 2000, 5000, 10000, 30000] : [5, 20, 50, 100, 300, 1000];
}
export const color = (r: CrimeRecord | null | undefined, f: Filter, level: RegionLevel) => { const n = value(r, f); return n === null ? '#d6ddd9' : n === 0 ? '#f8fbfc' : colors[cuts(f, level).filter(c => n >= c).length]; };
