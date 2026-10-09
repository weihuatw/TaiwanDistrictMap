const normalize = s => (s ?? '').normalize('NFKC').replace(/\s/g,'').replaceAll('台','臺');

/** Resolve names only when the official text and administrative context identify one village. */
export function resolveVillageLinks({text, countyCode, townName, omitVillageSuffix=false, shared=false, partial=false, villageAliases={}}, villages, towns) {
  text=normalize(text);
  // Administrative names inside lists of partner schools describe the school, not subsequent villages.
  const scopeText=text.replace(/【[^】]*(?:國小|國中|高中|中學|學校)[^】]*】/g,m=>' '.repeat(m.length)).replace(/\([^)]*(?:國小|國中|高中|中學|學校|自由學區|共同學區)[^)]*\)/g,m=>' '.repeat(m.length));
  const counties=[...new Map(towns.map(t=>[t.countyCode,t.countyName])).entries()];
  const countyNames=new Map(counties.map(([code,name])=>[normalize(name),code]));
  const allowed=new Set([countyCode,...counties.filter(([,name])=>text.includes(normalize(name))).map(([code])=>code)]);
  const available=villages.filter(v=>allowed.has(v.countyCode));
  const aliases=new Map();
  const explicitAliases=new Set();
  const addAlias=(alias,v)=>{const list=aliases.get(alias)??[];if(!list.some(item=>item.code===v.code))list.push(v);aliases.set(alias,list);};
  for(const v of available){
    const name=normalize(v.name);if(!name)continue;
    const values=new Set([name]);
    if(omitVillageSuffix||/[、，,]/u.test(scopeText))if(/[村里]$/u.test(name))values.add(name.slice(0,-1));
    for(const alias of values)addAlias(alias,v);
  }
  for(const [key,names] of Object.entries(villageAliases)){
    const [aliasCounty,aliasTown,sourceName]=key.split('|');
    if(!aliasCounty||!aliasTown||!sourceName||!Array.isArray(names))continue;
    const destinations=available.filter(v=>v.countyCode===aliasCounty&&v.townName===aliasTown&&names.map(normalize).includes(normalize(v.name)));
    if(!destinations.length)continue;
    const alias=normalize(sourceName);explicitAliases.add(alias);
    for(const v of destinations)addAlias(alias,v);
  }
  const trie={children:new Map(),values:[]};
  for(const alias of aliases.keys()){
    let node=trie;
    for(const char of alias){if(!node.children.has(char))node.children.set(char,{children:new Map(),values:[]});node=node.children.get(char);}
    node.values.push(alias);
  }
  const aliasCache=new Map();
  function aliasesAt(index){
    if(aliasCache.has(index))return aliasCache.get(index);
    const found=[];let node=trie;
    for(let i=index;i<scopeText.length;i++){node=node.children.get(scopeText[i]);if(!node)break;if(node.values.length)found.push(...node.values);}
    found.sort((a,b)=>b.length-a.length);aliasCache.set(index,found);return found;
  }
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
  function contextAt(index){
    let county=countyCode,town=townName;
    for(const d of declarations){
      if(d.index>index)break;
      if(d.kind==='county'){county=d.county;town=null;}
      else if(d.county===county||uniqueTownCounty.get(d.town)?.size===1&&!towns.some(t=>t.countyCode===county&&t.name===d.town)){county=d.county;town=d.town;}
    }
    return {county,town};
  }

  // Match at explicit list boundaries, while also accepting compact source text such as
  // "北勢里北興里" and names whose final 里／村 is omitted. Context still has to resolve uniquely.
  const mentions=[];const matchedEnds=new Set();
  const excludedMentions=new Set();
  const isLetter=char=>Boolean(char&&/[\p{L}]/u.test(char));
  const priorAdminSuffix=/[區鄉鎮市里村]/u;
  const nextMarkers=/^(?:里|村|鄰|等|及|與|為|全里|全村|全部|不含|之|地區|一部分|部分)/u;
  for(let index=0;index<scopeText.length;index++){
    const previous=scopeText[index-1];
    if(index>0&&isLetter(previous)&&!priorAdminSuffix.test(previous)&&!/[除含及與和為]/u.test(previous)&&!matchedEnds.has(index))continue;
    const candidates=aliasesAt(index);
    if(!candidates.length)continue;
    const valid=candidates.filter(alias=>{
      const end=index+alias.length;
      return end===scopeText.length||!isLetter(scopeText[end])||nextMarkers.test(scopeText.slice(end))||aliasesAt(end).length>0;
    });
    if(!valid.length)continue;
    const longest=valid[0].length;
    for(const alias of valid.filter(value=>value.length===longest))mentions.push({index,alias,matchLength:alias.length});
    matchedEnds.add(index+longest);
  }

  // Whole-area clauses only expand the administrative units named by the source.
  const fullTowns=new Map();
  const clauses=scopeText.split(/[。；;\n]/u);
  const wholeArea=/皆為共同學區|全(?:鄉|鎮|市|區)|各(?:里|村)|全部|均為[^。；;]*學區|自由學區/u;
  const townAliases=[...new Set(towns.map(t=>normalize(t.name)))].sort((a,b)=>b.length-a.length);
  function mentionsTown(clause,name){
    let index=clause.indexOf(name);
    while(index>=0){
      const before=clause[index-1],end=index+name.length,next=clause[end];
      const left=index===0||!isLetter(before)||/[區鄉鎮市及與和為]/u.test(before);
      const right=end===clause.length||!isLetter(next)||/^(?:皆為|為|各|全|全部|共同|及|與|和)/u.test(clause.slice(end))||townAliases.some(alias=>clause.startsWith(alias,end));
      if(left&&right)return true;
      index=clause.indexOf(name,index+1);
    }
    return false;
  }
  for(const clause of clauses){
    if(!wholeArea.test(clause))continue;
    for(const t of towns)if(mentionsTown(clause,normalize(t.name)))fullTowns.set(`${t.countyCode}|${t.name}`,t);
  }
  const currentTown=towns.find(t=>t.countyCode===countyCode&&t.name===townName);
  const plainScope=scopeText.split(/[：:]/u).at(-1)?.split(/[。；;]/u)[0]?.trim();
  const plainUnit=plainScope?.split(/[（(]/u)[0]?.replace(/^[^\p{L}\p{N}]+/u,'').replace(/[。；;]+$/u,'').trim();
  const explicitlyNamedTown=towns.find(t=>t.countyCode===countyCode&&normalize(t.name)===plainUnit);
  if(explicitlyNamedTown)fullTowns.set(`${explicitlyNamedTown.countyCode}|${explicitlyNamedTown.name}`,explicitlyNamedTown);
  if(currentTown&&(plainScope===normalize(townName)||plainUnit===normalize(townName)||/全(?:鄉|鎮|市|區)|全區轄區|各(?:里|村)/u.test(scopeText)||/自由學區/u.test(scopeText)&&mentions.length===0))fullTowns.set(`${currentTown.countyCode}|${currentTown.name}`,currentTown);
  const countyFeature=towns.find(t=>t.countyCode===countyCode);
  const countywideEligibility=/設籍本縣.{0,24}(?:皆可|可申請|均可)/u.test(scopeText);
  const fullCounty=/全縣/u.test(scopeText)||/全市/u.test(scopeText)&&countyFeature?.countyName?.endsWith('市')||countywideEligibility;
  if(fullCounty)for(const t of towns.filter(t=>t.countyCode===countyCode))fullTowns.set(`${t.countyCode}|${t.name}`,t);
  const fullCounties=new Set(fullCounty?[countyCode]:[]);
  for(const [code,name] of counties){
    const normalizedName=normalize(name);
    const standalone=scopeText.split(/[。；;]/u).some(clause=>clause.replace(/^[^\p{L}\p{N}]+/u,'').replace(/[。；;]+$/u,'')===normalizedName);
    if(plainUnit===normalizedName||standalone||new RegExp(`(?:自由學區|大學區)[（(]?${normalizedName}[）)]?`,'u').test(scopeText))fullCounties.add(code);
  }
  for(const code of fullCounties)for(const t of towns.filter(t=>t.countyCode===code))fullTowns.set(`${t.countyCode}|${t.name}`,t);

  const excluded=new Set();const partialFullTown=new Set();
  for(const exclusion of scopeText.matchAll(/除(.+?)外|不含([^）)]*)/gu)){
    const excludedText=exclusion[1]??exclusion[2];if(!excludedText)continue;
    const start=exclusion.index+exclusion[0].indexOf(excludedText);
    const inside=mentions.filter(m=>m.index>=start&&m.index<start+excludedText.length);
    for(let i=0;i<inside.length;i++){
      const m=inside[i];const candidates=(aliases.get(m.alias)??[]).filter(v=>v.countyCode===countyCode&&v.townName===townName);
      if(candidates.length!==1)continue;
      const end=m.index+m.matchLength;const nextIndex=inside[i+1]?.index??start+excludedText.length;
      const tail=scopeText.slice(end,nextIndex);
      if(/地區|鄰|路|街|一部分|部分/u.test(tail))partialFullTown.add(candidates[0].code);
      else {excluded.add(candidates[0].code);excludedMentions.add(m.index);}
    }
  }
  for(const t of fullTowns.values())for(const v of available.filter(v=>v.countyCode===t.countyCode&&v.townName===t.name&&!excluded.has(v.code)))add(v,partial||partialFullTown.has(v.code),shared||countywideEligibility||/共同|共享|自由學區/u.test(scopeText));
  if(!aliases.size)return {links,unresolved};

  for(let i=0;i<mentions.length;i++){
    const m=mentions[i];if(excludedMentions.has(m.index))continue;const {county,town}=contextAt(m.index);
    let candidates=(aliases.get(m.alias)??[]).filter(v=>v.countyCode===county);
    const local=candidates.filter(v=>v.townName===town);if(local.length)candidates=local;
    else if(/[里村]$/u.test(m.alias)){
      const sameBase=(aliases.get(m.alias.slice(0,-1))??[]).filter(v=>v.countyCode===county&&v.townName===town);
      if(sameBase.length)candidates=sameBase;
    }
    if(explicitAliases.has(m.alias)&&candidates.length>1){for(const v of candidates)add(v,partial,shared);continue;}
    if(candidates.length!==1){unresolved.push({name:m.alias,countyCode:county,townName:town});continue;}
    const before=text.slice(0,m.index);const end=m.index+m.matchLength;
    const tail=text.slice(end,mentions[i+1]?.index??text.length);
    const shortened=m.alias!==normalize(candidates[0].name);
    const isPartial=/鄰|路|街|號|自然村|不含|以[東西南北]|地區|一部分|部分/u.test(tail)&&!/^\(全(?:里|村)?\)/.test(tail);
    add(candidates[0],partial||isPartial||shortened&&/^\([^)]*\d/.test(tail),shared||/共同學區|自由學區|同為自由/u.test(tail)||before.endsWith('◎')||/以下共同學區[^。]*$/u.test(before));
  }
  return {links,unresolved};
}
