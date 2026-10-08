import assert from 'node:assert/strict';
import test from 'node:test';
import { schoolKey } from '../scripts/school/national.mjs';
import { resolveVillageLinks } from '../scripts/school/village-links.mjs';
const towns=[
  {name:'汐止區',countyName:'新北市',countyCode:'65000'},
  {name:'南港區',countyName:'臺北市',countyCode:'63000'},
  {name:'安南區',countyName:'臺南市',countyCode:'67000'},
  {name:'南區',countyName:'臺南市',countyCode:'67000'},
];
const village=(code,name,townCode,townName,countyCode)=>({code,name,townCode,townName,countyCode});
const villages=[village('1','白雲里','65000110','汐止區','65000'),village('2','九如里','63000090','南港區','63000'),village('3','中研里','63000090','南港區','63000'),village('4','幸福里','67000060','安南區','67000')];
test('School names keep 立德 and use the longest administrative prefix, including combined departments',()=>{
  const features=towns.map(t=>({properties:{...t,name:t.name}}));
  assert.equal(schoolKey('臺南市安南區安順國民小學',features),schoolKey('市立安順國小',features));
  assert.equal(schoolKey('臺南市安南區南興國民小學',features),schoolKey('市立安南區南興國小',features));
  assert.equal(schoolKey('臺南市立立德國民中學',features),schoolKey('立德國中',features));
  assert.equal(schoolKey('市立金寧國(中)小',features),schoolKey('金寧中小學(國小部)',features));
});
test('Official catchment clauses resolve cross-county villages and preserve shared partial links',()=>{
  const r=resolveVillageLinks({text:'白雲里（1-9鄰）；臺北市南港區九如里、中研里（共同學區）',countyCode:'65000',townName:'汐止區'},villages,towns);
  assert.deepEqual(r.links.map(v=>v.code),['1','2','3']);assert.equal(r.links[0].partial,true);assert.equal(r.links[2].shared,true);assert.deepEqual(r.unresolved,[]);
});
test('Full township scope uses the published administrative scope and abbreviated village names are opt-in',()=>{
  const full=resolveVillageLinks({text:'汐止區全區各里',countyCode:'65000',townName:'汐止區'},villages,towns);
  assert.deepEqual(full.links.map(v=>v.code),['1']);
  assert.equal(resolveVillageLinks({text:'白雲',countyCode:'65000',townName:'汐止區'},villages,towns).links.length,0);
  assert.equal(resolveVillageLinks({text:'白雲（1-9鄰）',countyCode:'65000',townName:'汐止區',omitVillageSuffix:true},villages,towns).links[0].partial,true);
});
test('New Taipei junior catchments expand all village names before 等里, including road-split neighborhoods',()=>{
  const names=['德安','小城','吉祥','玫瑰','明城','達觀','雙城','日興','香坡'];
  const t=[{name:'新店區',countyName:'新北市',countyCode:'65000'}];
  const v=names.map((name,i)=>village(String(i),name+'里','65000060','新店區','65000'));
  const result=resolveVillageLinks({text:'德安(18-28鄰，車子路以南)、小城、吉祥、玫瑰、明城、達觀、雙城、日興、香坡等里',countyCode:'65000',townName:'新店區',omitVillageSuffix:true},v,t);
  assert.deepEqual(result.links.map(v=>v.name),names.map(n=>n+'里'));
  assert.equal(result.links[0].partial,true);assert.equal(result.links[8].partial,false);assert.deepEqual(result.unresolved,[]);
});
test('A partner school district in a shared-school note does not change the next village scope',()=>{
  const t=[{name:'土城區',countyName:'新北市',countyCode:'65000'},{name:'板橋區',countyName:'新北市',countyCode:'65000'}];
  const v=[village('a','貨饒里','65000130','土城區','65000'),village('b','學府里','65000130','土城區','65000')];
  const r=resolveVillageLinks({text:'貨饒里【樂利、板橋區信義國小自由學區】；學府里（6-9、13鄰）【樂利、廣福國小自由學區】',countyCode:'65000',townName:'土城區'},v,t);
  assert.deepEqual(r.links.map(v=>v.name),['貨饒里','學府里']);assert.deepEqual(r.unresolved,[]);
});
test('The longer 安南區 scope takes precedence over the embedded 南區 name',()=>{
  const v=[village('a','安西里','67000060','安南區','67000'),village('b','安西里','67000030','南區','67000')];
  const r=resolveVillageLinks({text:'安南區：安西里1-2鄰',countyCode:'67000',townName:'南區'},v,towns);
  assert.deepEqual(r.links.map(v=>v.code),['a']);assert.equal(r.links[0].partial,true);assert.deepEqual(r.unresolved,[]);
});
test('Abbreviated neighborhood ranges and a shared-village prefix apply to the named village',()=>{
  const v=[village('a','信義里','68000020','中壢區','68000'),village('b','仁美里','68000020','中壢區','68000')];
  const t=[{name:'中壢區',countyName:'桃園市',countyCode:'68000'}];
  const r=resolveVillageLinks({text:'信義，◎仁美（22-23、26）',countyCode:'68000',townName:'中壢區',omitVillageSuffix:true},v,t);
  assert.equal(r.links[0].shared,false);assert.equal(r.links[1].shared,true);assert.equal(r.links[1].partial,true);
});
