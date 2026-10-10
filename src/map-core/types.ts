import type { Feature, FeatureCollection, MultiLineString, MultiPolygon, Polygon } from 'geojson';

export type RegionLevel = 'county' | 'town' | 'village';
export type ViewLevel = RegionLevel | 'detail';
export interface RegionProperties {
  code: string; name: string; countyCode: string; countyName: string;
  townCode?: string; townName?: string; level: RegionLevel; unassigned: boolean;
  color: string; note: string; label: [number, number]; bounds: number[];
  focusBounds: number[]; childCount?: number;
}
export type Region = Feature<Polygon | MultiPolygon, RegionProperties>;
export type Regions = FeatureCollection<Polygon | MultiPolygon, RegionProperties>;
export type RegionOutline = FeatureCollection<MultiLineString, { code: string }>;
export interface Camera { center: [number, number]; zoom: number; bearing: number; pitch: number }
export interface View { level: ViewLevel; path: Region[]; data: Regions; camera: Camera | null; selected: Region | null }
export interface ContextRegion { region: Region; parentIndex: number }
export interface RegionHit { region: Region; source: 'regions' | 'context'; parentIndex?: number }
export interface Rect { x: number; y: number; w: number; h: number }
export interface Padding { top: number; right: number; bottom: number; left: number }
export type RegionColor = (region: Region) => string;
export interface Release { level: string; title: string; datasetUrl: string; releaseFile: string; metadataUpdated: string }
export interface BoundaryManifest { counts: { county: number; town: number; village: number }; unassignedCount: number; sources: Release[]; notes: string[] }
