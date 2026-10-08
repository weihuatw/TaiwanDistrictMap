import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { HousingRepository } from '../src/apps/housing/data.ts';

const json=(data)=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
const bytes=(data)=>new Response(gzipSync(Buffer.from(JSON.stringify(data))),{status:200,headers:{'content-type':'application/gzip'}});

test('Housing summaries retain the selected year and retry failed requests',async()=>{
  let fail=true,calls=0;
  const repo=new HousingRepository('/data/housing/',async(url)=>{
    calls++;
    if(url==='/data/housing/summary/2025/standard/counties.json'&&fail)return new Response('',{status:503});
    if(url==='/data/housing/summary/2025/standard/counties.json')return json({year:2025,group:'standard',records:{'63000':{code:'63000',eligibleCount:12}}});
    return new Response('',{status:404});
  });
  await assert.rejects(repo.load('counties.geojson',2025,'standard'));
  fail=false;
  await repo.load('counties.geojson',2025,'standard');
  assert.equal(repo.get(2025,'standard','63000').eligibleCount,12);
  assert.equal(calls,2);
});

test('Housing transaction shards are fetched on demand and gunzipped',async()=>{
  const requested=[];
  const repo=new HousingRepository('/data/housing/',async(url)=>{
    requested.push(url);
    if(url.endsWith('/index.json'))return json({year:2025,townCode:'63000010',count:1,pageSize:250,pages:[{file:'part-0000.json.bin',count:1}]});
    return bytes({year:2025,townCode:'63000010',page:0,records:[{tradeDate:'2025-01-02',address:'測試路1號'}]});
  });
  const result=await repo.transactionPage('63000010',2025,0);
  assert.equal(result.total,1);
  assert.equal(result.records[0].address,'測試路1號');
  assert.equal(result.hasNext,false);
  assert.equal(requested.length,2);
  await assert.rejects(repo.transactionPage('../bad',2025,0));
});
