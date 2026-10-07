import type { Camera, Region, Regions } from '../../map-core/types';

export type SchoolLevel = 'elementary' | 'junior';
export interface CatchmentVillage { code: string; name: string; townCode: string; townName: string; partial: boolean; shared: boolean }
export interface School {
  id: string; code: string | null; name: string; level: SchoolLevel;
  countyCode: string; countyName: string; townCode: string; townName: string;
  position: [number, number] | null; positionSource: string | null; positionObjectId: number | null;
  catchment: { year: number; sourceId: string; villages: CatchmentVillage[] } | null;
}
export interface SchoolManifest {
  sources: { id: string; title: string; provider: string; datasetUrl: string; release: string; downloadedAt: string; sha256: string }[];
  counts: { schools: number; elementary: number; junior: number; withCatchment: number };
  catchmentCounties: string[]; catchmentYear: number; notes: string[]; unmatchedSchools: number; unmatchedVillages: number;
}
export interface SchoolView {
  level: 'county' | 'town' | 'school'; path: Region[]; data: Regions;
  schools: School[]; selected: School | null; catchment: Regions;
  camera: Camera | null; overviewCamera: Camera | null;
}
export const emptyRegions = (): Regions => ({ type: 'FeatureCollection', features: [] });
export const levelName = (level: SchoolLevel) => level === 'elementary' ? '國小' : '國中';
export const schoolColor = (level: SchoolLevel) => level === 'elementary' ? '#18816a' : '#526bb2';
