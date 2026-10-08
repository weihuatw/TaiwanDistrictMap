export type HousingGroup = 'standard' | 'apartment' | 'elevator_low' | 'elevator_high' | 'house';
export type PriceBasis = 'no_parking' | 'parking_deducted' | 'parking_included_unknown' | 'invalid';
export interface HousingSummary {
  code: string; transactionCount: number; eligibleCount: number; residentialCount: number;
  medianTwdM2: number | null; p25TwdM2: number | null; p75TwdM2: number | null;
  medianWanPing: number | null; status: 'no_samples' | 'insufficient' | 'low_sample' | 'ok';
  parkingUnknownCount: number; excludedCount: number;
}
export interface HousingTransaction {
  id: string; countyCode: string; townCode: string | null; townName: string;
  tradeDate: string; address: string; target: string; buildingType: string;
  buildingTypeGroup: string | null; mainUse: string; totalPriceTwd: number | null;
  buildingAreaM2: number | null; parkingAreaM2: number | null; parkingPriceTwd: number | null;
  parkingCount: number | null; sourceUnitPriceTwdM2: number | null;
  unitPriceTwdM2: number | null; priceBasis: PriceBasis;
  rooms: number | null; halls: number | null; bathrooms: number | null; floor: string; note: string; addressNormalized: string;
  flags: string[]; eligible: boolean; reasons: string[]; sourceBatch: string;
}
export interface HousingPart<T> { year: number; group: HousingGroup; records: Record<string, T> }
export interface HousingManifest {
  schemaVersion: number; datasetVersion: string; builtAt: string; retrievedAt: string;
  provider: string; catalogUrl: string; license: string; licenseUrl: string;
  periods: string[]; groups: HousingGroup[]; limitations: string[];
  counts: { deduplicatedSaleRows: number; outcomes: Record<string, number>; reasons: Record<string, number>; conflictingSerials: number; inputRowsByBatch: Record<string, number> };
}
