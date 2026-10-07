/** Geographic helpers shared by the data pipeline and browser. */
export function positions(geometry) {
  const points = [];
  function visit(value) {
    if (typeof value[0] === 'number') points.push(value);
    else for (const child of value) visit(child);
  }
  visit(geometry.coordinates);
  return points;
}

export function boundsOf(points) {
  if (!points.length) throw new Error('Cannot calculate empty bounds');
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    bbox[0] = Math.min(bbox[0], x); bbox[1] = Math.min(bbox[1], y);
    bbox[2] = Math.max(bbox[2], x); bbox[3] = Math.max(bbox[3], y);
  }
  return bbox;
}

export const geometryBounds = (geometry) => boundsOf(positions(geometry));

export function focusBounds(geometry) {
  const all = positions(geometry);
  const nearby = all.filter(([lon, lat]) => lon >= 117.8 && lon <= 122.2 && lat >= 21.5 && lat <= 26.5);
  return boundsOf(nearby.length ? nearby : all);
}

export const PALETTE = ['#58b99d', '#efb44f', '#78a7e3', '#dd8590', '#a49ad4', '#a8bf62', '#68bec9', '#df9f6a', '#c38cb8', '#98b69b'];

/** Greedy coloring of the shared-edge graph, deterministic for fixed input. */
export function colorRegions(features) {
  const neighbors = features.map(() => new Set());
  const owners = new Map();
  for (const [i, feature] of features.entries()) {
    const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const polygon of polygons) for (const ring of polygon) {
      for (let k = 1; k < ring.length; k++) {
        const a = ring[k - 1].join(','); const b = ring[k].join(',');
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        const previous = owners.get(key);
        if (previous !== undefined && previous !== i) {
          neighbors[i].add(previous); neighbors[previous].add(i);
        } else owners.set(key, i);
      }
    }
  }
  const colors = new Map();
  const order = features.map((_, i) => i).sort((a, b) => neighbors[b].size - neighbors[a].size || a - b);
  for (const i of order) {
    const used = new Set([...neighbors[i]].map((n) => colors.get(n)));
    let candidate = i % PALETTE.length;
    for (let k = 0; k < PALETTE.length; k++) {
      if (!used.has(candidate)) break;
      candidate = (candidate + 1) % PALETTE.length;
    }
    colors.set(i, candidate);
    features[i].properties.color = PALETTE[candidate];
  }
}

export function dataPath(level, parentCode = '') {
  if (level === 'county') return 'counties.geojson';
  if (level === 'town' && /^\d{5}$/.test(parentCode)) return `towns/${parentCode}.geojson`;
  if (level === 'village' && /^\d{8}$/.test(parentCode)) return `villages/${parentCode}.geojson`;
  throw new Error('Invalid administrative level or parent code');
}
