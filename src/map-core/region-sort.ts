import type { Region } from './types';

export type SortDirection = 'desc' | 'asc';

function tieByCode(a: Region, b: Region) {
  return a.properties.code.localeCompare(b.properties.code);
}

export function sortByName<T>(items: T[], getName: (item: T) => string, direction: SortDirection, tieBreak?: (a: T, b: T) => number): T[] {
  return [...items].sort((a, b) => {
    const left = getName(a).localeCompare(getName(b), 'zh-Hant');
    return (direction === 'desc' ? -left : left) || tieBreak?.(a, b) || 0;
  });
}

export function sortRegionsByName(regions: Region[], direction: SortDirection): Region[] {
  return sortByName(regions, region => region.properties.name, direction, tieByCode);
}

export function sortByValue<T>(items: T[], getValue: (item: T) => number | null | undefined, direction: SortDirection, tieBreak: (a: T, b: T) => number): T[] {
  return [...items].sort((a, b) => {
    const left = getValue(a), right = getValue(b);
    if (left == null) return right == null ? tieBreak(a, b) : 1;
    if (right == null) return -1;
    const difference = direction === 'desc' ? right - left : left - right;
    return difference || tieBreak(a, b);
  });
}

export function sortRegionsByValue(regions: Region[], getValue: (region: Region) => number | null | undefined, direction: SortDirection): Region[] {
  return sortByValue(regions, getValue, direction, tieByCode);
}
