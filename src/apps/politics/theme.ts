import type { RegionLevel, View } from '../../map-core/types';
import type { PoliticalMode, PoliticalRecord, Candidate } from './types';
export const MISSING_COLOR = '#b6b9c0';
export const TIE_COLOR = '#9b80b6';
export function availableModes(level: RegionLevel): PoliticalMode[] {
  if (level === 'county') return ['officials', 'mayor', 'president'];
  if (level === 'town') return ['mayor', 'president'];
  return ['officials', 'mayor', 'president'];
}
export function defaultMode(level: View['level']): PoliticalMode { return level === 'town' ? 'mayor' : 'officials'; }
export function modeForLevel(level: RegionLevel, preferred: PoliticalMode | null, saved?: PoliticalMode): PoliticalMode {
  const available = availableModes(level);
  if (preferred && available.includes(preferred)) return preferred;
  if (saved && available.includes(saved)) return saved;
  return defaultMode(level);
}
export function winners(candidates: Candidate[]) {
  const highest = Math.max(...candidates.map(c => c.votes));
  return highest > 0 ? candidates.filter(c => c.votes === highest) : [];
}
export function recordParty(record: PoliticalRecord | null): string | null {
  if (!record) return null;
  if ('candidates' in record) {
    if (record.partialReason) return null;
    const best = winners(record.candidates);
    return best.length === 1 ? best[0].party : null;
  }
  return record.name ? record.party : null;
}
export function recordMissing(record: PoliticalRecord | null) {
  return !record || ('candidates' in record ? !!record.partialReason || winners(record.candidates).length === 0 : !record.name || !record.party);
}
export function recordLabel(record: PoliticalRecord | null) {
  if (!record) return '無可對應資料';
  if ('candidates' in record) {
    if (record.partialReason) return '部分票數合併列示';
    const best = winners(record.candidates);
    return best.length > 1 ? '最高票並列' : best.length ? best[0].party : '無有效票';
  }
  return record.party ?? (record.status === 'conflicting-roster' ? '名錄待查證' : '黨籍未載');
}
export function recordColor(record: PoliticalRecord | null, colors: Record<string, string>) {
  if (recordMissing(record)) return MISSING_COLOR;
  if (record && 'candidates' in record && winners(record.candidates).length > 1) return TIE_COLOR;
  return colors[recordParty(record) ?? ''] ?? '#a493b0';
}
