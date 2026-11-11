import type { ChildSafetyRecord } from './data.ts';

export type Metric = 'reports' | 'rate' | 'abused';
export const metrics: Record<Metric, string> = {
  reports: '通報件次',
  rate: '每萬名兒少通報件次',
  abused: '受虐兒少人數',
};

const thresholds: Record<Metric, number[]> = {
  reports: [250, 1000, 2500, 5000, 10000],
  rate: [200, 300, 400, 500, 650],
  abused: [25, 100, 250, 500, 1000],
};
const colors = ['#f1e9fa', '#dfc9f1', '#c8a0e4', '#a677cf', '#8550b3', '#592d86'];
export const missingColor = '#d6ddd9';
const zeroColor = '#f8fbfc';

export function readFilter(query: string, years: string[]): { year: string; metric: Metric } {
  const params = new URLSearchParams(query);
  const year = params.get('year');
  const metric = params.get('metric');
  return {
    year: year && years.includes(year) ? year : years[0],
    metric: metric === 'rate' || metric === 'abused' ? metric : 'reports',
  };
}

export function value(record: ChildSafetyRecord | undefined, metric: Metric) {
  if (!record) return null;
  if (metric === 'rate') return record.population > 0 ? record.reports / record.population * 10000 : null;
  return record[metric];
}

export const unit = (metric: Metric) => metric === 'rate' ? '件次／萬名兒少' : metric === 'abused' ? '人' : '件次';
const number = (n: number) => n.toLocaleString('zh-TW', { maximumFractionDigits: 1 });
export const format = (n: number | null, metric: Metric) => n === null ? '無資料' : `${number(n)} ${unit(metric)}`;

export function color(n: number | null, metric: Metric) {
  if (n === null) return missingColor;
  if (n === 0) return zeroColor;
  return colors[thresholds[metric].filter(cut => n >= cut).length];
}

export function legendItems(metric: Metric) {
  const cuts = thresholds[metric];
  return [
    { label: '0', color: zeroColor },
    ...colors.map((swatch, i) => ({
      color: swatch,
      label: i === 0 ? `大於 0 至未滿 ${number(cuts[0])}`
        : i === cuts.length ? `${number(cuts[i - 1])} 以上`
        : `${number(cuts[i - 1])} 至未滿 ${number(cuts[i])}`,
    })),
    { label: '無資料', color: missingColor },
  ];
}
