import test from 'node:test';
import assert from 'node:assert/strict';
import { IndigenousRepository } from '../src/data/indigenous.ts';
import { color, cuts, format, legendLabels, parseMetric, parseTribe, tribeBreakdown, value } from '../src/apps/indigenous/theme.ts';
const meta={schemaVersion:1,period:'2026-08',sourceMonth:'11508',label:'民國115年8月底',supportedTribes:[{id:'siraya',label:'西拉雅族',sourceLabel:'西拉雅族'}],source:{title:'ODRP018',catalogUrl:'https://data.gov.tw/dataset/77052'},files:{}};
const rec={code:'09007010001',name:'莒光里',totalPopulation:1000,indigenous:10,male:4,female:6,undeclared:1,tribes:{siraya:9}};
const json=data=>Response.json(data);
test('indigenous values use total registered population as denominator and handle zero or missing',()=>{
 assert.equal(value(rec,'population','all'),10);assert.equal(value(rec,'population','siraya'),9);assert.ok(Math.abs(value(rec,'share','siraya')-.9)<1e-10);assert.equal(value({...rec,totalPopulation:0},'share','all'),null);
 assert.equal(format(.009,'share'),'<0.01%');assert.equal(format(0,'share'),'0%');assert.equal(value(null,'population','all'),null);
 assert.equal(parseMetric('metric=invalid'),'population');assert.equal(parseMetric('metric=share'),'share');assert.equal(parseTribe('tribe=bad',['siraya']),'all');assert.equal(parseTribe('tribe=siraya',['siraya']),'siraya');
 assert.deepEqual(cuts('population','village'),[5,20,50,100,300,1000]);assert.equal(legendLabels('population','village').length,8);assert.equal(legendLabels('share','village').length,8);assert.match(legendLabels('population','village').at(-1),/1000 以上/);assert.equal(color({...rec,indigenous:0,male:0,female:0,undeclared:0,tribes:{siraya:0}},'population','all','village'),'#f8fbfc');
});
test('tribe breakdown preserves zero counts and lists undeclared identity separately',()=>{
 const tribes=[{id:'siraya',label:'西拉雅族'},{id:'amis',label:'阿美族'}];
 const rows=tribeBreakdown({...rec,tribes:{siraya:9,amis:0}},tribes);
 assert.deepEqual(rows,[{id:'siraya',label:'西拉雅族',count:9},{id:'amis',label:'阿美族',count:0},{id:'undeclared',label:'尚未申報族別（非族群）',count:1}]);
 assert.equal(tribeBreakdown(null,tribes).every(row=>row.count===null),true);
});
test('repository validates an entire shard before publishing and shares concurrent loads',async()=>{
 let calls=0;const repo=new IndigenousRepository('/data/indigenous/');
 const fetcher=globalThis.fetch;globalThis.fetch=async url=>{calls++;if(url==='/data/indigenous/manifest.json')return json({period:'2026-08',files:'2026-08/manifest.json'});if(url.endsWith('/2026-08/manifest.json'))return json(meta);return json({schemaVersion:1,period:'2026-08',level:'village',parentCode:'09007010',records:{[rec.code]:rec}})};
 try{await Promise.all([repo.loadRegions('village','09007010'),repo.loadRegions('village','09007010')]);assert.equal(repo.get(rec.code).indigenous,10);assert.equal(calls,3)}finally{globalThis.fetch=fetcher}
});
test('repository rejects malformed tribe sums and can retry after failure',async()=>{
 let bad=true;const repo=new IndigenousRepository('/data/indigenous/');const fetcher=globalThis.fetch;globalThis.fetch=async url=>{if(url==='/data/indigenous/manifest.json')return json({period:'2026-08',files:'2026-08/manifest.json'});if(url.endsWith('/2026-08/manifest.json'))return json(meta);return json({schemaVersion:1,period:'2026-08',level:'village',parentCode:'09007010',records:{[rec.code]:bad?{...rec,tribes:{siraya:8}}:rec}})};
 try{await assert.rejects(repo.loadRegions('village','09007010'),/驗證失敗/);assert.equal(repo.get(rec.code),null);bad=false;await repo.loadRegions('village','09007010');assert.equal(repo.get(rec.code).indigenous,10)}finally{globalThis.fetch=fetcher}
});
