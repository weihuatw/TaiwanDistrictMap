import {gzipSync} from 'node:zlib';
import test from 'node:test';
import assert from 'node:assert/strict';
import {TrafficRepository,validEvent} from '../src/data/traffic.ts';
import {value,color,parseMetric,parseYear,eventsForView} from '../src/apps/traffic/theme.ts';
import {parseRoute,transferTheme} from '../src/routing/hash-router.ts';
const rec={code:'63000010002',name:'莊敬里',accidents:10,injuries:14,deaths:1,located:10,villageAssigned:10,population:2000};
const index={schemaVersion:1,years:[{year:2026,months:[1,2,3,4,5,6,7,8],complete:false,populationLabel:'2026 年 8 月戶籍人口'}]};
const meta={...index.years[0],schemaVersion:1,rateScale:100000,sourceUrls:['https://data.gov.tw/dataset/13139'],totals:{...rec,code:'TW'}};
const e=['2026-1',121.5,25,'20260101','120000','A2',0,1,'63000010',rec.code,'臺北市松山區'];
test('traffic rates use event counts per 100,000 population and preserve missing denominators',()=>{
 assert.equal(value(rec,'accidents'),10);assert.equal(value(rec,'injuries'),14);assert.equal(value(rec,'deaths'),1);assert.equal(value(rec,'rate'),500);
 assert.equal(value({...rec,population:0},'rate'),null);assert.equal(value({...rec,population:null},'rate'),null);assert.equal(value(null,'accidents'),null);
 assert.equal(color({...rec,accidents:0},'accidents','village'),'#f8fbfc');assert.equal(parseMetric('metric=bad'),'accidents');assert.equal(parseYear('year=2035',[2026,2025,2024]),2026);
 const r=parseRoute('#/traffic/63000/63000010/63000010002?year=2024&metric=rate');assert.equal(r.theme,'traffic');assert.deepEqual(transferTheme(r,'population').ids,r.ids);
});
test('event points are absent nationally, complete within a county, and narrowed at town and village levels',()=>{
 const otherTown={properties:{code:'63000020'}},town={properties:{code:'63000010'}},county={properties:{code:'63000'}},village={properties:{code:rec.code}};
 const rows=[e,[...e.slice(0,8),'63000020','63000020001','other'],[...e.slice(0,9),'63000010003','neighbor'],[...e.slice(0,9),null,'unmapped']];
 assert.equal(eventsForView(rows,{level:'county',path:[],selected:null}).length,0);
 assert.equal(eventsForView(rows,{level:'town',path:[county],selected:null}).length,4);
 assert.equal(eventsForView(rows,{level:'village',path:[county,town],selected:null}).length,3);
 assert.equal(eventsForView(rows,{level:'village',path:[county,otherTown],selected:null}).length,1);
 assert.deepEqual(eventsForView(rows,{level:'detail',path:[county,town,village],selected:village}),[e]);
});
test('repository shares requests, validates complete shards before publishing, retries failures, and isolates years',async()=>{
 let bad=true,calls=0;const fetcher=async url=>{calls++;if(url.endsWith('/manifest.json'))return Response.json(url==='/traffic/manifest.json'?index:meta);return Response.json({schemaVersion:1,year:2026,level:'village',parentCode:'63000010',records:{[rec.code]:rec,'63000010003':{...rec,code:'63000010003',injuries:bad?-1:0}}})};
 const repo=new TrafficRepository('/traffic/',fetcher);
 await assert.rejects(repo.loadRegions('village','63000010',2026),/驗證/);assert.equal(repo.get(rec.code,2026),null);
 bad=false;const before=calls;await Promise.all([repo.loadRegions('village','63000010',2026),repo.loadRegions('village','63000010',2026)]);assert.equal(calls-before,1);assert.equal(repo.get(rec.code,2026).accidents,10);assert.equal(repo.get(rec.code,2024),null);
 await assert.rejects(repo.manifest(2035),/尚無/);await assert.rejects(repo.events('../x',2026),/無效/);
});
test('event shards reject wrong years, malformed coordinates and cross-county IDs, then allow retry',async()=>{
 assert.ok(validEvent(e,2026,'63000'));assert.equal(validEvent([...e.slice(0,1),0,...e.slice(2)],2026,'63000'),false);assert.equal(validEvent(e,2025,'63000'),false);assert.equal(validEvent(e,2026,'64000'),false);
 let bad=true;const repo=new TrafficRepository('/traffic/',async()=>new Response(gzipSync(JSON.stringify({schemaVersion:1,year:2026,countyCode:'63000',events:bad?[e,e]:[e]}))));await assert.rejects(repo.events('63000',2026),/驗證/);bad=false;assert.deepEqual(await repo.events('63000',2026),[e]);
});
test('event downloads handle both raw gzip and HTTP automatically decompressed JSON',async()=>{
 const shard={schemaVersion:1,year:2026,countyCode:'63000',events:[e]};
 for(const response of [()=>new Response(gzipSync(JSON.stringify(shard))),()=>Response.json(shard)]){const repo=new TrafficRepository('/traffic/',async()=>response());assert.deepEqual(await repo.events('63000',2026),[e])}
});
