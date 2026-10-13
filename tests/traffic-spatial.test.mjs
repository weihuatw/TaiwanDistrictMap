import test from 'node:test';
import assert from 'node:assert/strict';
import { addressRegions, assignRegions } from '../scripts/traffic/spatial.mjs';
const county = { code: '65000', name: '新北市' };
const taipei = { code: '63000', name: '臺北市' };
const zhonghe = { code: '65000030', name: '中和區', countyCode: county.code };
const xindian = { code: '65000060', name: '新店區', countyCode: county.code };
const village = { code: '65000030088', townCode: zhonghe.code, countyCode: county.code };
const address = location => addressRegions(location, [county, taipei], [zhonghe, xindian]);
const assign = (location, extra = {}) => assignRegions({ coordinates: [121.481404, 25.009385], address: address(location), villageHits: [village], townHits: [], countyHits: [], ...extra });
test('real Xindian address with corrupted Zhonghe coordinate keeps upper totals without a false village or point', () => {
  const r = assign('新北市新店區民權路 / 新北市新店區建國路');
  assert.equal(r.countyCode, county.code); assert.equal(r.townCode, xindian.code);
  assert.equal(r.villageCode, null); assert.equal(r.coordinates, null);
  assert.equal(r.coordinateConflict, true); assert.equal(r.spatialVillageCode, village.code);
});
test('cross-county conflict with only a county prefix does not invent an address town', () => {
  const r = assign('台北市某道路');
  assert.equal(r.countyCode, taipei.code); assert.equal(r.townCode, null);
  assert.equal(r.villageCode, null); assert.equal(r.coordinates, null); assert.equal(r.countyMismatch, true);
});
test('conflicts also reject points with town/county-only spatial hits', () => {
  assert.equal(assign('新北市新店區溪州路', { villageHits: [], townHits: [zhonghe] }).coordinates, null);
  assert.equal(assign('臺北市道路', { villageHits: [], countyHits: [county] }).coordinates, null);
});
test('consistent coordinates and addresses keep village and point', () => {
  const r = assign('新北市中和區員山路');
  assert.equal(r.villageCode, village.code); assert.deepEqual(r.coordinates, [121.481404, 25.009385]); assert.equal(r.coordinateConflict, false);
});
test('border hits can be disambiguated by exact address town; ambiguity remains unassigned', () => {
  const other = { code: '65000060001', townCode: xindian.code, countyCode: county.code };
  const r = assign('新北市新店區道路', { villageHits: [village, other] });
  assert.equal(r.villageCode, other.code); assert.equal(r.coordinateConflict, false);
  assert.equal(assign('不明道路', { villageHits: [village, other] }).villageCode, null);
});
test('absent or unrecognizable address does not guess; invalid coordinates preserve exact upper address', () => {
  assert.equal(assign('不明道路').villageCode, village.code);
  const r = assign('新北市新店區道路', { coordinates: null, villageHits: [] });
  assert.equal(r.townCode, xindian.code); assert.equal(r.villageCode, null); assert.equal(r.coordinateConflict, false);
  assert.equal(address('新北市新店道路').town, null);
});
