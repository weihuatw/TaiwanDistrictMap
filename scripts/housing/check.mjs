import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root=path.resolve('public/data/housing');
const read=(name)=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const fail=(message)=>{console.error(`housing:check: ${message}`);process.exitCode=1;};
if(!fs.existsSync(path.join(root,'manifest.json'))){fail('missing public/data/housing/manifest.json');process.exit();}
const manifest=read('manifest.json');
if(manifest.schemaVersion!==1||JSON.stringify(manifest.periods)!==JSON.stringify(['2024','2025']))fail('invalid manifest versions/periods');
const boundaries=JSON.parse(fs.readFileSync('public/data/counties.geojson','utf8')).features;
let countyChecks=0,townChecks=0,transactionRows=0,totalBytes=0,maxShard=0;
let gzipBytes=0;
for(const year of manifest.periods)for(const group of manifest.groups){
  const national=read(`summary/${year}/${group}/national.json`);
  if(national.summary.code!=='TW'||national.summary.eligibleCount<0)fail(`bad ${year}/${group} national summary`);
  const county=read(`summary/${year}/${group}/counties.json`);
  if(county.year!==Number(year)||county.group!==group)fail(`bad ${year}/${group} county header`);
  const total=Object.values(county.records).reduce((n,r)=>n+r.eligibleCount,0);
  if(total!==national.summary.eligibleCount)fail(`${year}/${group} county sample total ${total} != national ${national.summary.eligibleCount}`);
  for(const feature of boundaries){const record=county.records[feature.properties.code];if(record){countyChecks++;if(!Number.isFinite(record.eligibleCount)||record.eligibleCount>record.residentialCount)fail(`invalid county ${record.code}`);}}
  for(const feature of boundaries){
    const file=path.join('summary',year,group,'towns',`${feature.properties.code}.json`);
    if(!fs.existsSync(path.join(root,file)))continue;
    const towns=read(file);let sum=0;
    for(const [code,r] of Object.entries(towns.records)){if(code!==r.code||r.eligibleCount>r.residentialCount)fail(`invalid town ${code}`);sum+=r.eligibleCount;townChecks++;}
    const countyCount=county.records[feature.properties.code]?.eligibleCount??0;
    const unresolved=countyCount-sum;
    if(unresolved<0)fail(`${year}/${group}/${feature.properties.code}: towns ${sum} exceed county ${countyCount}`);
    const unresolvedRows=manifest.counts?.outcomes?.town_unresolved??0;
    if(unresolved>unresolvedRows)fail(`${year}/${group}/${feature.properties.code}: unmatched county count ${unresolved} exceeds source unresolved count ${unresolvedRows}`);
  }
}
const yearDirs=fs.readdirSync(path.join(root,'transactions'));
for(const year of yearDirs){for(const town of fs.readdirSync(path.join(root,'transactions',year))){
  const dir=path.join(root,'transactions',year,town),index=JSON.parse(fs.readFileSync(path.join(dir,'index.json'),'utf8'));
  let count=0;
  for(const item of index.pages){const file=path.join(dir,item.file);const bytes=fs.statSync(file).size;maxShard=Math.max(maxShard,bytes);const payload=zlib.gunzipSync(fs.readFileSync(file));totalBytes+=payload.byteLength;gzipBytes+=bytes;const records=JSON.parse(payload).records;if(records.length!==item.count)fail(`shard size mismatch ${year}/${town}/${item.file}`);count+=records.length;transactionRows+=records.length;}
  if(count!==index.count)fail(`index count mismatch ${year}/${town}`);
}}
if(maxShard>250_000)fail(`compressed transaction shard exceeds 250 KB (${maxShard})`);
if(process.exitCode){console.error('Housing data check failed.');process.exit();}
console.log(`Housing data OK: ${countyChecks} county records, ${townChecks} town records, ${transactionRows.toLocaleString()} transaction rows, ${(totalBytes/1024/1024).toFixed(1)} MB JSON / ${(gzipBytes/1024/1024).toFixed(1)} MB gzip across shards; largest ${(maxShard/1024).toFixed(0)} KB.`);
