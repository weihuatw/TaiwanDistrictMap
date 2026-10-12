import type { PopulationRecord } from '../../data/population';
import type { AnnualPopulationRecord } from '../../data/population-annual';
import type { RegionLevel } from '../../map-core/types';

export const metrics = ['population', 'households', 'elderly', 'young', 'female', 'density', 'births', 'birthRate', 'deaths', 'deathRate', 'naturalIncrease', 'naturalRate'] as const;
export type PopulationMetric = typeof metrics[number];
export const metricLabels: Record<PopulationMetric, string> = {
  population: '人口數', households: '戶數', elderly: '高齡人口比例', young: '幼年人口比例', female: '女性比例', density: '人口密度', births: '年度出生人口', birthRate: '粗出生率',
  deaths: '年度死亡人口', deathRate: '粗死亡率', naturalIncrease: '自然增減人口', naturalRate: '自然增減率',
};
export const COLORS = ['#edf6fa', '#d2e9f1', '#a5d2e1', '#74b5cc', '#4492b0', '#256f94', '#174b70'];
export const isAnnualMetric = (metric: PopulationMetric) => metrics.indexOf(metric) >= 5;
export const DEFAULT_ANNUAL_YEAR = 2025;
export function parsePopulationYear(query: string): number | undefined {
  const value = new URLSearchParams(query).get('year');
  if (!value || !/^20\d{2}$/.test(value)) return undefined;
  const year = Number(value);
  return year >= 2020 && year <= DEFAULT_ANNUAL_YEAR ? year : undefined;
}
export const isNaturalMetric = (metric: PopulationMetric) => metric === 'naturalIncrease' || metric === 'naturalRate';
export const metricColors = (metric: PopulationMetric) => isNaturalMetric(metric)
  ? ['#993d64', '#bd6384', '#dfadbc', '#f2efea', '#afd2cf', '#5baba7', '#217b7c'] : COLORS;
export function metricPath(ids: string[], metric: PopulationMetric) { return metric === 'density' ? ids.slice(0, 2) : ids; }
export const MISSING = '#d6ddd9';
export function parseMetric(query: string): PopulationMetric {
  const value = new URLSearchParams(query).get('metric');
  return metrics.includes(value as PopulationMetric) ? value as PopulationMetric : 'population';
}
export function metricValue(record: PopulationRecord | null, metric: PopulationMetric, annual: AnnualPopulationRecord | null = null): number | null {
  if (isAnnualMetric(metric)) {
    if (!annual) return null;
    if (metric === 'density') return annual.areaKm2 && annual.densityPopulation != null ? annual.densityPopulation / annual.areaKm2 : null;
    if (metric === 'births' || metric === 'deaths' || metric === 'naturalIncrease') return annual[metric];
    const numerator = metric === 'birthRate' ? annual.births : metric === 'deathRate' ? annual.deaths : annual.naturalIncrease;
    return numerator != null && annual.meanPopulation != null && annual.meanPopulation > 0 ? numerator / annual.meanPopulation * 1000 : null;
  }
  if (!record) return null;
  if (metric === 'population' || metric === 'households') return record[metric];
  if (record.population === 0) return null;
  const numerator = metric === 'elderly' ? record.age65plus : metric === 'young' ? record.age0to14 : record.female;
  return Number.isFinite(numerator) ? numerator / record.population * 100 : null;
}
export const unit = (metric: PopulationMetric) => metric === 'density' ? '人／km²' : metric.endsWith('Rate') ? '‰'
  : ['population', 'births', 'deaths', 'naturalIncrease'].includes(metric) ? '人' : metric === 'households' ? '戶' : '%';
export function formatValue(value: number | null, metric: PopulationMetric) {
  return value == null ? '無資料' : `${['population', 'households', 'births', 'deaths', 'naturalIncrease'].includes(metric)
    ? value.toLocaleString('zh-TW') : value.toLocaleString('zh-TW', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${unit(metric)}`;
}
export function thresholds(metric: PopulationMetric, level: RegionLevel): number[] {
  if (metric === 'density') return [100, 500, 1000, 3000, 10000, 20000];
  if (metric === 'birthRate') return [2, 4, 6, 8, 10, 12];
  if (metric === 'deathRate') return [4, 6, 8, 10, 12, 14];
  if (metric === 'naturalRate') return [-10, -5, -1, 1, 5, 10];
  if (metric === 'naturalIncrease') return level === 'county' ? [-10000, -5000, -500, 500, 5000, 10000]
    : level === 'town' ? [-1000, -500, -50, 50, 500, 1000] : [-100, -50, -5, 5, 50, 100];
  if (metric === 'births' || metric === 'deaths') return level === 'county' ? [500, 1000, 3000, 5000, 10000, 20000]
    : level === 'town' ? [20, 50, 100, 300, 1000, 3000] : [5, 10, 20, 40, 80, 120];
  if (metric === 'elderly') return [10, 14, 20, 25, 30, 35];
  if (metric === 'young') return [8, 10, 12, 14, 16, 18];
  if (metric === 'female') return [45, 48, 50, 52, 55, 60];
  const populationCuts = level === 'county' ? [100000, 300000, 500000, 1000000, 2000000, 3000000]
    : level === 'town' ? [1000, 5000, 10000, 30000, 100000, 300000] : [500, 1000, 2000, 4000, 8000, 12000];
  return metric === 'households' ? populationCuts.map(value => Math.round(value / 3)) : populationCuts;
}
export function recordColor(record: PopulationRecord | null, metric: PopulationMetric, level: RegionLevel, annual: AnnualPopulationRecord | null = null) {
  const value = metricValue(record, metric, annual);
  return value == null ? MISSING : metricColors(metric)[thresholds(metric, level).filter(cut => value >= cut).length];
}
export function legendLabels(metric: PopulationMetric, level: RegionLevel) {
  const cuts = thresholds(metric, level);
  const number = (value: number) => value.toLocaleString('zh-TW');
  return [`未滿 ${number(cuts[0])}`, ...cuts.slice(0, -1).map((cut, i) => `${number(cut)}${isNaturalMetric(metric) ? ' 至 ' : '–'}${number(cuts[i + 1])}`), `${number(cuts.at(-1)!)} 以上`];
}
export function metricDescription(metric: PopulationMetric) {
  if (metric === 'density') return '年底戶籍人口 ÷ 官方土地面積；縣市按人口與面積加總。僅提供縣市與鄉鎮。';
  if (metric === 'births' || metric === 'deaths') return `全年十二個月${metric === 'births' ? '出生' : '死亡'}登記人數合計，依登記月份統計。`;
  if (metric === 'naturalIncrease') return '全年出生登記 − 死亡登記；不包含遷入遷出。';
  if (metric.endsWith('Rate')) return `${metric === 'birthRate' ? '出生登記' : metric === 'deathRate' ? '死亡登記' : '（出生登記 − 死亡登記）'} ÷ 年中人口 × 1,000。年中人口＝前、當年年底人口平均。`;
  if (metric === 'elderly') return '65 歲以上人口 ÷ 戶籍人口。';
  if (metric === 'young') return '0–14 歲人口 ÷ 戶籍人口。';
  if (metric === 'female') return '女性人口 ÷ 戶籍人口。';
  return `${metric === 'population' ? '戶籍登記人口' : '戶籍登記戶數'}總量，不代表人口密度。`;
}
