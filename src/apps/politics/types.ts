import type { RegionLevel } from '../../map-core/types';
export type PoliticalMode = 'officials' | 'mayor' | 'president';
export interface Candidate { id: string; number: number; name: string; sourceName?: string; party: string; votes: number }
export interface ElectionRecord {
  code: string; name: string; level: RegionLevel; countyCode: string; townCode?: string | null;
  cecKey: string; electionId: string; date: string; validVotes: number; invalidVotes: number;
  electors: number; partialReason?: string; candidates: Candidate[];
}
export interface OfficialRecord {
  code: string; name: string | null; level: RegionLevel; countyCode: string; townCode?: string | null;
  role: string; party: string | null; status: 'registry' | 'acting' | 'in-office' | 'conflicting-roster';
  verifiedAt: string; term?: string; sourceUrl: string; officeSourceUrl?: string; registryParty?: string | null;
  note: string;
}
export type PoliticalRecord = ElectionRecord | OfficialRecord;
export interface PoliticalPart {
  schemaVersion: number; mode: PoliticalMode; version: string; level: RegionLevel;
  parentCode: string | null; records: Record<string, PoliticalRecord>;
}
export interface PoliticalManifest {
  schemaVersion: number; snapshot: string; paths: Record<PoliticalMode, string>; colors: Record<string, string>;
  coverage: Record<PoliticalMode, { mappedVillages: number; namedBoundaries: number; partialVillages: number }>;
  officialCounts: { county: number; village: number };
  elections: { id: string; subject: string; theme: string; date: string }[];
  sources: { title: string; url: string }[]; notes: string[];
}
