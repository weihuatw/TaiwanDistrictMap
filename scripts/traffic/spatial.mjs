// Official address prefixes are used only when county/town names match exactly.
export const normalizeAddress = value => value.normalize('NFKC').replaceAll('台', '臺').replace(/\s/g, '');
export function addressRegions(location, counties, towns) {
  const address = normalizeAddress(location);
  const county = counties.find(c => address.startsWith(normalizeAddress(c.name))) ?? null;
  const town = county && towns.find(t => t.countyCode === county.code && address.startsWith(normalizeAddress(county.name + t.name))) || null;
  return { county, town };
}

export function assignRegions({ coordinates, address, villageHits, townHits, countyHits }) {
  const localHits = address.town ? villageHits.filter(p => p.townCode === address.town.code) : villageHits;
  const village = villageHits.length === 1 ? villageHits[0] : localHits.length === 1 ? localHits[0] : null;
  const spatialTown = village?.townCode ?? (townHits.length === 1 ? townHits[0].code : null);
  const spatialCounty = village?.countyCode ?? (townHits.length === 1 ? townHits[0].countyCode : countyHits.length === 1 ? countyHits[0].code : null);
  const townMismatch = Boolean(address.town && spatialTown && address.town.code !== spatialTown);
  const countyMismatch = Boolean(address.county && spatialCounty && address.county.code !== spatialCounty);
  const coordinateConflict = townMismatch || countyMismatch;
  // A conflicting coordinate cannot establish a village or a trustworthy event point.
  // Keep casualties in the exact address's upper levels; never invent a replacement point.
  return {
    countyCode: coordinateConflict ? address.county.code : spatialCounty ?? address.county?.code ?? null,
    townCode: coordinateConflict ? address.town?.code ?? null : spatialTown ?? address.town?.code ?? null,
    villageCode: coordinateConflict ? null : village?.code ?? null,
    coordinates: coordinateConflict ? null : coordinates,
    coordinateConflict, townMismatch, countyMismatch,
    spatialCountyCode: spatialCounty, spatialTownCode: spatialTown, spatialVillageCode: village?.code ?? null,
    ambiguousVillage: villageHits.length > 1 && !village,
  };
}
