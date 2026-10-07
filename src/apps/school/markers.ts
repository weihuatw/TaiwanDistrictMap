import { Marker, type Map, type GeoJSONSource } from 'maplibre-gl';
import type { Region } from '../../map-core/types';
import { emptyRegions, levelName, type School } from './types';

export function createSchoolMarkers(map: Map, onChoose: (school: School) => void) {
  let markers: Marker[] = [];
  let town: Region | undefined;
  function outline() {
    if (!map.isStyleLoaded()) return;
    const data = town ? { type: 'FeatureCollection' as const, features: [town] } : emptyRegions();
    const source = map.getSource('school-town') as GeoJSONSource | undefined;
    if (source) source.setData(data);
    else {
      map.addSource('school-town', { type: 'geojson', data });
      map.addLayer({ id: 'school-town-outline', type: 'line', source: 'school-town', paint: {
        'line-color': '#5c8276', 'line-width': 1.5, 'line-opacity': .75, 'line-dasharray': [3, 2],
      } });
    }
  }
  map.on('load', outline);
  return {
    render(schools: School[], selected: School | null, currentTown?: Region) {
      town = currentTown; outline();
      markers.forEach(m => m.remove()); markers = [];
      for (const school of schools) {
        if (!school.position) continue;
        const element = document.createElement('button');
        element.className = `school-marker ${school.level}${selected?.id === school.id ? ' selected' : ''}`;
        element.dataset.schoolId = school.id;
        element.type = 'button';
        element.setAttribute('aria-label', `${school.name}（${levelName(school.level)}）${school.catchment ? '，查看學區' : '，學區尚未收錄'}`);
        element.setAttribute('aria-pressed', String(selected?.id === school.id));
        const badge = document.createElement('span'); badge.className = 'school-marker-badge'; badge.textContent = school.level === 'elementary' ? '小' : '中';
        const label = document.createElement('span'); label.className = 'school-marker-name'; label.textContent = school.name;
        element.append(badge, label);
        element.addEventListener('click', event => { event.stopPropagation(); onChoose(school); });
        element.addEventListener('dblclick', event => event.stopPropagation());
        // Separate the two departments of a combined elementary/junior school.
        const colocated = schools.some(s => s.id !== school.id && s.position?.join(',') === school.position?.join(','));
        const offset: [number, number] = colocated ? [school.level === 'elementary' ? -18 : 18, 0] : [0, 0];
        markers.push(new Marker({ element, anchor: 'center', offset }).setLngLat(school.position).addTo(map));
      }
    },
    setBusy(busy: boolean) {
      markers.forEach(marker => { (marker.getElement() as HTMLButtonElement).disabled = busy; });
    },
    destroy() {
      map.off('load', outline); markers.forEach(m => m.remove()); markers = [];
      if (map.getLayer('school-town-outline')) map.removeLayer('school-town-outline');
      if (map.getSource('school-town')) map.removeSource('school-town');
    },
  };
}
