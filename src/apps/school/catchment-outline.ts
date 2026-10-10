import type { Region, RegionOutline } from '../../map-core/types';

/** Keep only boundary segments that are not shared by two catchment regions. */
export function createCatchmentOutline(regions: readonly Region[]): RegionOutline {
  const owners = new Map<string, Set<number>>();
  const rings: { coordinates: number[][]; edges: string[] }[] = [];

  for (const [featureIndex, region] of regions.entries()) {
    const polygons = region.geometry.type === 'Polygon'
      ? [region.geometry.coordinates]
      : region.geometry.coordinates;
    for (const polygon of polygons) for (const coordinates of polygon) {
      const edges: string[] = [];
      for (let index = 1; index < coordinates.length; index++) {
        const previous = coordinates[index - 1].join(',');
        const current = coordinates[index].join(',');
        const key = previous < current ? `${previous}|${current}` : `${current}|${previous}`;
        edges.push(key);
        const features = owners.get(key) ?? new Set<number>();
        features.add(featureIndex);
        owners.set(key, features);
      }
      rings.push({ coordinates, edges });
    }
  }

  const lines: number[][][] = [];
  for (const { coordinates, edges } of rings) {
    const exterior = edges.map(edge => owners.get(edge)?.size === 1);
    if (exterior.every(Boolean)) {
      lines.push(coordinates);
      continue;
    }
    const edgeCount = exterior.length;
    const start = exterior.findIndex((isExterior, index) =>
      isExterior && !exterior[(index + edgeCount - 1) % edgeCount]);
    if (start < 0) continue;

    let line: number[][] = [];
    for (let step = 0; step < edgeCount; step++) {
      const index = (start + step) % edgeCount;
      if (!exterior[index]) {
        if (line.length > 1) lines.push(line);
        line = [];
        continue;
      }
      if (!line.length) line.push(coordinates[index]);
      line.push(coordinates[index + 1]);
    }
    if (line.length > 1) lines.push(line);
  }

  return {
    type: 'FeatureCollection',
    features: lines.length ? [{
      type: 'Feature',
      properties: { code: 'catchment-outline' },
      geometry: { type: 'MultiLineString', coordinates: lines },
    }] : [],
  };
}
