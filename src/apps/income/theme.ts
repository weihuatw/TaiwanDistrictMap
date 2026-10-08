import type { IncomeRecord } from './types';

// Fixed absolute thresholds, in 萬元 per filing household per year.
export const BREAKS = [55, 65, 75, 90, 110, 150];
export const COLORS = ['#dceee7', '#b6dacb', '#96cbb5', '#83bfa9', '#559e88', '#337d6a', '#1e594c'];
export const LABELS = ['未滿55', '55–65', '65–75', '75–90', '90–110', '110–150', '150以上'];
export const FILL_OPACITY = 0.38;
export const MISSING_COLOR = '#b9c1c9';

export function displayedWan(meanK: number | null | undefined): number | null {
  return meanK == null || !Number.isFinite(meanK) ? null : Math.round(meanK) / 10;
}
export function classIndex(meanK: number | null | undefined) {
  const value = displayedWan(meanK);
  return value === null ? null : BREAKS.filter((threshold) => value >= threshold).length;
}
export function recordColor(record: IncomeRecord | null | undefined) {
  const index = classIndex(record?.meanK);
  return index === null ? MISSING_COLOR : COLORS[index];
}
export function formatWan(meanK: number | null | undefined) {
  const value = displayedWan(meanK);
  return value === null ? '無資料' : value.toLocaleString('zh-TW', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
export function compareIncome(mean: number | null | undefined, parentMean: number | null | undefined) {
  if (mean == null || parentMean == null || !Number.isFinite(mean) || !Number.isFinite(parentMean) || parentMean <= 0) return null;
  return (mean / parentMean - 1) * 100;
}
