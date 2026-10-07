import type { RegionLevel } from '../../map-core/types';

export interface IncomeRecord {
  code: string; level: RegionLevel; name: string; countyCode: string; townCode: string | null;
  taxUnits: number; incomeTotalK: number; meanK: number | null; reportedMeanK: number | null;
  medianK: number | null; q1K: number | null; q3K: number | null;
  origin: 'official-county-total' | 'official-town-summary' | 'official-village' | 'village-weighted';
  coverage?: { mappedTaxUnits: number; totalTaxUnits: number; matchedVillages?: number; sourceVillages?: number };
}
export interface IncomePart { year: number; level: RegionLevel; parentCode: string | null; records: Record<string, IncomeRecord> }
export interface IncomeManifest {
  year: number; rocYear: number; status: 'preliminary'; statusLabel: string; publishedAt: string;
  provider: string; catalogUrl: string; downloadUrl: string; archiveSha256: string;
  counts: { county: number; town: number; village: number; sourceVillages: number };
  national: { taxUnits: number; incomeTotalK: number; meanK: number };
  coverage: { mappedTaxUnits: number; totalTaxUnits: number; unmatchedNamedVillages: number; missingNamedBoundaries: number; unassignedBoundaries: number };
  boundarySources: { level: string; releaseFile: string }[];
  notes: string[];
}
