const normalize = s => (s ?? '').normalize('NFKC').replace(/\s/g,'').replaceAll('台','臺');
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

/** Resolve names only when the official text and administrative context identify one village. */
export function resolveVillageLinks({text, countyCode, townName, omitVillageSuffix=false, shared=false, partial=false}, villages, towns) {
  text=normalize(text);
  // Administrative names inside lists of partner schools describe the school, not subsequent villages.
  const scopeText=text.replace(/【[^】]*】/g,m=>' '.repeat(m.length)).replace(/\([^)]*(?:國小|國中|高中|中學|學校|自由學區|共同學區)[^)]*\)/g,m=>' '.repeat(m.length));
  const counties=[...new Map(towns.map(t=>[t.countyCode,t.countyName])).entries()];
  const countyNames=new Map(counties.map(([code,name])=>[normalize(name),code]));
  const allowed=new Set([countyCode,...counties.filter(([,name])=>text.includes(normalize(name))).map(([code])=>code)]);
  const available=villages.filter(v=>allowed.has(v.countyCode));
  const names=[...new Set(available.map(v=>normalize(v.name)))];
  const alternatives=[...new Set(names.flatMap(n=>omitVillageSuffix?[n,n.slice(0,-1)]:[n]))].sort((a,b)=>b.length-a.length);
  const declarations=[];
  for(const t of towns){
    const forms=[normalize(t.name),normalize(t.name).slice(0,-1)+':',normalize(t.name).slice(0,-1)+'：'];
    for(const form of forms){let index=scopeText.indexOf(form);while(index>=0){declarations.push({index,length:form.length,kind:'town',town:t.name,county:t.countyCode});index=scopeText.indexOf(form,index+form.length);}}
  }
  // Keep the longest administrative name: 南區 inside 安南區 is not another declaration.
  const nested=new Set(declarations.filter(d=>declarations.some(other=>other!==d&&other.index<=d.index&&other.index+other.length>=d.index+d.length&&other.length>d.length)));
  for(let i=declarations.length-1;i>=0;i--)if(nested.has(declarations[i]))declarations.splice(i,1);
  for(const [name,code] of countyNames){let index=scopeText.indexOf(name);while(index>=0){declarations.push({index,kind:'county',county:code});index=scopeText.indexOf(name,index+name.length);}}
  const uniqueTownCounty=new Map();
  for(const t of towns){const codes=uniqueTownCounty.get(t.name)??new Set();codes.add(t.countyCode);uniqueTownCounty.set(t.name,codes);}
  declarations.sort((a,b)=>a.index-b.index||Number(a.kind==='town')-Number(b.kind==='town'));
  const links=[];const unresolved=[];
  function add(v,p=partial,s=shared){
    const old=links.find(l=>l.code===v.code);
    if(old){old.partial&&=p;old.shared||=s;}else links.push({code:v.code,name:v.name,townCode:v.townCode,townName:v.townName,partial:p,shared:s});
  }
  // Whole-county/town clauses are accepted only when explicitly present in the published scope.
  const fullCounty=/全縣/.test(text)||/全市/.test(text)&&countyNames.has(towns.find(t=>t.countyCode===countyCode)?.countyName)&&towns.find(t=>t.countyCode===countyCode)?.countyName.endsWith('市');
  const fullTown=/全鄉|全鎮|全區轄區|全區各里|全區各村|全區$|全市$|[鄉鎮市區]全部/.test(text);
  if(fullCounty||fullTown){
    for(const v of available.filter(v=>v.countyCode===countyCode&&(fullCounty||v.townName===townName)))add(v,false,shared||/自由|共同/.test(text));
  }
  if(!alternatives.length)return {links,unresolved};
  const regex=new RegExp(`(?:^|(?<=[^\\p{L}])|(?<=[區鄉鎮市]))(${alternatives.map(escape).join('|')})(?=$|[^\\p{L}]|與|屬|為|全部|全里|等里|各鄰|不含|及)`,'gu');
  const mentions=[...text.matchAll(regex)];
  for(let i=0;i<mentions.length;i++){
    const m=mentions[i];let county=countyCode,town=townName;
    for(const d of declarations){
      if(d.index>m.index)break;
      if(d.kind==='county'){county=d.county;town=null;}
      else if(d.county===county||uniqueTownCounty.get(d.town)?.size===1&&!towns.some(t=>t.countyCode===county&&t.name===d.town)){county=d.county;town=d.town;}
    }
    let candidates=available.filter(v=>v.countyCode===county&&(normalize(v.name)===m[1]||omitVillageSuffix&&normalize(v.name).slice(0,-1)===m[1]));
    const local=candidates.filter(v=>v.townName===town);if(local.length)candidates=local;
    if(candidates.length!==1){unresolved.push({name:m[1],countyCode:county,townName:town});continue;}
    const before=text.slice(0,m.index);const tail=text.slice(m.index+m[0].length,mentions[i+1]?.index??text.length);
    add(candidates[0],partial||(/鄰|路|街|號|自然村|不含|以[東西南北]/.test(tail)&&!/^\(全(?:里|村)?\)/.test(tail))||omitVillageSuffix&&/^\([^)]*\d/.test(tail),shared||/共同學區|自由學區|同為自由/.test(tail)||before.endsWith('◎')||/以下共同學區[^。]*$/.test(before));
  }
  return {links,unresolved};
}
