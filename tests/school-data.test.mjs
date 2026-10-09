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
test('Compact official lists resolve adjacent village names and names with omitted 里／村 suffixes',()=>{
  const t=[{name:'屏東市',countyName:'屏東縣',countyCode:'10013'},{name:'恆春鎮',countyName:'屏東縣',countyCode:'10013'}];
  const v=[village('a','北勢里','10013010','屏東市','10013'),village('b','北興里','10013010','屏東市','10013'),village('c','頭溝里','10013014','恆春鎮','10013'),village('d','四溝里','10013014','恆春鎮','10013')];
  const adjacent=resolveVillageLinks({text:'北勢里北興里1、2鄰',countyCode:'10013',townName:'屏東市'},v,t);
  assert.deepEqual(adjacent.links.map(x=>x.code),['a','b']);
  const omitted=resolveVillageLinks({text:'恆春鎮：頭溝、四溝、山海',countyCode:'10013',townName:'恆春鎮'},v,t);
  assert.deepEqual(omitted.links.map(x=>x.code),['c','d']);
});
test('Explicit whole-town scope expands every village and respects named exclusions',()=>{
  const t=[{name:'頭城鎮',countyName:'宜蘭縣',countyCode:'10002'},{name:'新社區',countyName:'臺中市',countyCode:'66000'}];
  const v=[village('a','大溪里','10002040','頭城鎮','10002'),village('b','龜山里','10002040','頭城鎮','10002'),village('c','新社里','66000090','新社區','66000'),village('d','福興里','66000090','新社區','66000'),village('e','中和里','66000090','新社區','66000')];
  const all=resolveVillageLinks({text:'頭城鎮各里。',countyCode:'10002',townName:'頭城鎮'},v,t);
  assert.deepEqual(all.links.map(x=>x.code),['a','b']);
  const partial=resolveVillageLinks({text:'新社區除福興里及中和里龍安地區外，各里均為學區',countyCode:'66000',townName:'新社區'},v,t);
  assert.deepEqual(partial.links.map(x=>x.code),['c','e']);assert.equal(partial.links[1].partial,true);
  const excluded=resolveVillageLinks({text:'埤頭鄉(不含新庄村)',countyCode:'10007',townName:'埤頭鄉'},[
    village('f','豐崙村','10007030','埤頭鄉','10007'),village('g','新庄村','10007030','埤頭鄉','10007'),village('h','合興村','10007030','埤頭鄉','10007'),
  ],[{name:'埤頭鄉',countyName:'彰化縣',countyCode:'10007'}]);
  assert.deepEqual(excluded.links.map(x=>x.code),['f','h']);
});
test('A town name embedded in another town name does not expand as an additional district',()=>{
  const t=[{name:'大雅區',countyName:'臺中市',countyCode:'66000'},{name:'西屯區',countyName:'臺中市',countyCode:'66000'},{name:'西區',countyName:'臺中市',countyCode:'66000'}];
  const v=[village('a','大雅里','66000010','大雅區','66000'),village('b','西屯里','66000020','西屯區','66000'),village('c','西區里','66000030','西區','66000')];
  const r=resolveVillageLinks({text:'大雅區及西屯區皆為共同學區。',countyCode:'66000',townName:'大雅區'},v,t);
  assert.deepEqual(r.links.map(x=>x.code),['a','b']);
});
test('Town-only scopes can explicitly name a district other than the school location',()=>{
  const t=[{name:'和美鎮',countyName:'彰化縣',countyCode:'10007'},{name:'線西鄉',countyName:'彰化縣',countyCode:'10007'}];
  const v=[village('a','線西村','10007040','線西鄉','10007'),village('b','頂庄村','10007040','線西鄉','10007')];
  const r=resolveVillageLinks({text:'線西鄉',countyCode:'10007',townName:'和美鎮'},v,t);
  assert.deepEqual(r.links.map(x=>x.code),['a','b']);
});
test('A source village suffix variant resolves to the unique local administrative area',()=>{
  const t=[{name:'社頭鄉',countyName:'彰化縣',countyCode:'10007'},{name:'彰化市',countyName:'彰化縣',countyCode:'10007'}];
  const v=[village('a','平和村','10007170','社頭鄉','10007'),village('b','平和里','10007010','彰化市','10007')];
  const r=resolveVillageLinks({text:'平和里、',countyCode:'10007',townName:'社頭鄉'},v,t);
  assert.deepEqual(r.links.map(x=>x.code),['a']);
});
test('Official countywide eligibility and explicit source spelling aliases expand only their scoped areas',()=>{
  const t=[{name:'甲鎮',countyName:'彰化縣',countyCode:'10007'},{name:'乙鄉',countyName:'彰化縣',countyCode:'10007'}];
  const v=[village('a','豊崙村','10007030','甲鎮','10007'),village('b','北美術館里','64000010','鼓山區','64000'),village('c','南美術館里','64000010','鼓山區','64000')];
  const county=resolveVillageLinks({text:'自由學區(彰化縣)',countyCode:'10007',townName:'甲鎮'},v,t);
  assert.deepEqual(county.links.map(x=>x.code),['a']);assert.equal(county.links[0].shared,true);
  const alias=resolveVillageLinks({text:'龍水里',countyCode:'64000',townName:'鼓山區',villageAliases:{'64000|鼓山區|龍水里':['北美術館里','南美術館里']}},v,[{name:'鼓山區',countyName:'高雄市',countyCode:'64000'}]);
  assert.deepEqual(alias.links.map(x=>x.code),['b','c']);assert.deepEqual(alias.unresolved,[]);
});
test('A county-only official source scope maps the complete county',()=>{
  const t=[{name:'甲鎮',countyName:'雲林縣',countyCode:'10009'},{name:'乙鄉',countyName:'雲林縣',countyCode:'10009'}];
  const v=[village('a','東村','10009010','甲鎮','10009'),village('b','西村','10009020','乙鄉','10009')];
  const r=resolveVillageLinks({text:' 雲林縣。 學校型態實驗教育學校。',countyCode:'10009',townName:'甲鎮'},v,t);
  assert.deepEqual(r.links.map(x=>x.code),['a','b']);
  const eligibility=resolveVillageLinks({text:'新埔鎮大學區制，凡設籍本縣之國小畢業生皆可申請入學',countyCode:'10009',townName:'甲鎮'},v,t);
  assert.deepEqual(eligibility.links.map(x=>x.code),['a','b']);assert.ok(eligibility.links.every(x=>x.shared));
  const localFree=resolveVillageLinks({text:'和平區：【自由學區】',countyCode:'66000',townName:'和平區'},[
    village('c','東村','66000010','和平區','66000'),village('d','西村','66000010','和平區','66000'),
  ],[{name:'和平區',countyName:'臺中市',countyCode:'66000'}]);
  assert.deepEqual(localFree.links.map(x=>x.code),['c','d']);assert.ok(localFree.links.every(x=>x.shared));
  const implicitLocalFree=resolveVillageLinks({text:'【自由學區】',countyCode:'66000',townName:'和平區'},[
    village('c','東村','66000010','和平區','66000'),village('d','西村','66000010','和平區','66000'),
  ],[{name:'和平區',countyName:'臺中市',countyCode:'66000'}]);
  assert.deepEqual(implicitLocalFree.links.map(x=>x.code),['c','d']);
});
