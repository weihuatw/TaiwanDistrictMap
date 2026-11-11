import { Marker, type Map } from 'maplibre-gl';

export interface Sanction {
  date: string;
  schoolName: string;
  document: string;
  basis: string;
  violation: string;
  subject: string;
  disposition: string;
}

export interface SanctionSchool {
  id: string;
  county: string;
  name: string;
  town: string | null;
  townName: string;
  address: string;
  status: string;
  positionStatus: 'official' | 'missing' | 'outside-town';
  position: [number, number] | null;
  sourceUrl: string;
  sanctions: Sanction[];
}

export interface SanctionSummary {
  schools: number;
  records: number;
  positioned: number;
  retrievedAt: string;
}

export interface SanctionIndex {
  schemaVersion: 1;
  sourceUrl: string;
  counties: Record<string, SanctionSummary>;
  schools: Array<Pick<SanctionSchool, 'id' | 'county' | 'name' | 'position'> & { count: number }>;
}

export interface SanctionDetails {
  county: string;
  schools: SanctionSchool[];
  records: number;
  positioned: number;
  retrievedAt: string;
}

const count = (n: number) => Number.isSafeInteger(n) && n >= 0;
const position = (p: [number, number] | null) => p === null || (Array.isArray(p) && p.length === 2
  && p.every(Number.isFinite) && p[0] >= 118 && p[0] <= 123 && p[1] >= 21 && p[1] <= 27);
const officialUrl = (url: string) => typeof url === 'string'
  && url === 'https://ap.ece.moe.edu.tw/webecems/punishSearch.aspx';

export function validSanctionIndex(d: SanctionIndex) {
  return d.schemaVersion === 1 && Object.keys(d.counties).length === 22 && Array.isArray(d.schools)
    && Object.values(d.counties).every(s => count(s.schools) && count(s.records)
      && count(s.positioned) && typeof s.retrievedAt === 'string')
    && d.schools.every(s => typeof s.id === 'string' && typeof s.name === 'string'
      && !!d.counties[s.county] && count(s.count) && s.count > 0 && position(s.position));
}

export function validSanctionDetails(d: SanctionDetails, county: string) {
  return d.county === county && Array.isArray(d.schools)
    && d.schools.every(s => typeof s.id === 'string' && s.county === county
      && typeof s.name === 'string' && typeof s.townName === 'string' && typeof s.address === 'string'
      && typeof s.status === 'string' && ['official', 'missing', 'outside-town'].includes(s.positionStatus) && position(s.position) && officialUrl(s.sourceUrl)
      && Array.isArray(s.sanctions) && s.sanctions.length > 0
      && s.sanctions.every(r => [r.date, r.schoolName, r.document, r.basis, r.violation, r.subject, r.disposition]
        .every(value => typeof value === 'string')))
    && d.records === d.schools.reduce((sum, s) => sum + s.sanctions.length, 0);
}

export function createSanctionMarkers(map: Map, choose: (id: string, county: string) => void) {
  let markers: Marker[] = [];
  let previous = '';
  return {
    render(data: SanctionIndex, county: string | undefined, visible: boolean, selectedId?: string) {
      const key = `${county ?? 'TW'}:${visible}:${selectedId ?? ''}`;
      if (key === previous) return;
      previous = key;
      markers.forEach(marker => marker.remove());
      markers = [];
      if (!visible) return;
      for (const school of data.schools) {
        if (!school.position || (county && school.county !== county)) continue;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `child-sanction-marker${school.id === selectedId ? ' selected' : ''}`;
        button.setAttribute('aria-pressed', String(school.id === selectedId));
        button.textContent = String(school.count);
        button.title = `${school.name} · ${school.count} 筆裁罰紀錄`;
        button.setAttribute('aria-label', button.title);
        button.addEventListener('click', event => {
          event.stopPropagation();
          choose(school.id, school.county);
        });
        button.addEventListener('dblclick', event => event.stopPropagation());
        markers.push(new Marker({ element: button }).setLngLat(school.position).addTo(map));
      }
    },
    destroy() { markers.forEach(marker => marker.remove()); },
  };
}
