import type { HousingSummary } from './types';

export const BREAKS = [15,25,40,60,80];
export const COLORS = ['#dceee7','#b6dacb','#83bfa9','#559e88','#337d6a','#1e594c'];
export const LABELS = ['<15','15–25','25–40','40–60','60–80','≥80'];
export const MISSING = '#d9dedc';
export function color(summary: HousingSummary | null | undefined) {
  if (!summary || summary.status === 'no_samples' || summary.status === 'insufficient' || summary.medianWanPing == null) return MISSING;
  return COLORS[BREAKS.filter(x => summary.medianWanPing! >= x).length];
}
export function formatPrice(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? '無可比樣本' : `${value.toLocaleString('zh-TW',{minimumFractionDigits:1,maximumFractionDigits:1})} 萬／坪`;
}
export function groupName(group: string) {
  return ({standard:'公寓・華廈・住宅大樓',apartment:'公寓',elevator_low:'華廈',elevator_high:'住宅大樓',house:'透天'})[group] ?? group;
}
