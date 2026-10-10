import type { RegionLevel, View } from '../../map-core/types';
import type { PoliticalMode, PoliticalRecord, Candidate } from './types';
export const MISSING_COLOR = '#b6b9c0';
export const TIE_COLOR = '#9b80b6';
const WHITE = '#ffffff';
const DARK_LABEL_TEXT = '#17363a';
const PARTY_LABEL_BACKGROUNDS: Record<string, string> = {
  '中國國民黨': '#376bb3',
  '民主進步黨': '#407c55',
  '台灣民眾黨': '#51aeb4',
};
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

export function recordLabelStyle(record: PoliticalRecord | null, colors: Record<string, string>) {
  if (recordMissing(record)) return null;
  if (record && 'candidates' in record && winners(record.candidates).length > 1) {
    return { backgroundColor: '#795f95', textColor: WHITE };
  }
  const party = recordParty(record) ?? '';
  if (party.startsWith('無黨籍')) return { backgroundColor: '#e4e7eb', textColor: DARK_LABEL_TEXT };
  const backgroundColor = PARTY_LABEL_BACKGROUNDS[party] ?? colors[party] ?? '#a493b0';
  return { backgroundColor, textColor: labelTextColor(backgroundColor) };
}

function labelTextColor(background: string) {
  return contrastRatio(background, WHITE) >= contrastRatio(background, DARK_LABEL_TEXT) ? WHITE : DARK_LABEL_TEXT;
}

function contrastRatio(a: string, b: string) {
  const first = relativeLuminance(a), second = relativeLuminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function relativeLuminance(color: string) {
  const channels = [1, 3, 5].map(start => Number.parseInt(color.slice(start, start + 2), 16) / 255);
  const [red, green, blue] = channels.map(channel => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}
