import type { IndigenousRecord } from '../../data/indigenous';
import type { RegionLevel } from '../../map-core/types';
export type Metric='population'|'share'; export type Tribe='all'|string;
export interface SupportedTribe {id:string;label:string}
export const parseMetric=(q:string):Metric=>new URLSearchParams(q).get('metric')==='share'?'share':'population';
export const parseTribe=(q:string,supported:string[]):Tribe=>{const t=new URLSearchParams(q).get('tribe')??'all';return t==='all'||supported.includes(t)?t:'all'};
export function value(r:IndigenousRecord|null,metric:Metric,tribe:Tribe):number|null{if(!r)return null;const n=tribe==='all'?r.indigenous:r.tribes[tribe];if(n==null)return null;return metric==='population'?n:r.totalPopulation===0?null:n/r.totalPopulation*100}
export function tribeBreakdown(r:IndigenousRecord|null,tribes:SupportedTribe[]){return[...tribes.map(item=>({id:item.id,label:item.label,count:r?.tribes[item.id]??null})),{id:'undeclared',label:'尚未申報族別（非族群）',count:r?.undeclared??null}]}
export const colors=['#edf6fa','#d2e9f1','#a5d2e1','#74b5cc','#4492b0','#256f94','#174b70'];
export const cuts=(metric:Metric,level:RegionLevel)=>metric==='share'?[.1,1,5,10,25,50]:level==='county'?[100,1000,5000,10000,30000,100000]:level==='town'?[10,100,500,1000,5000,10000]:[5,20,50,100,300,1000];
export const legendLabels=(metric:Metric,level:RegionLevel)=>{const c=cuts(metric,level);return metric==='share'?['0%','大於 0、未滿 0.1%','0.1–1%','1–5%','5–10%','10–25%','25–50%','50% 以上']:['0 人',`大於 0、未滿 ${c[0]}`,...c.slice(0,-1).map((x,i)=>`${x} 至未滿 ${c[i+1]}`),`${c.at(-1)} 以上`]};
export const color=(r:IndigenousRecord|null,metric:Metric,tribe:Tribe,level:RegionLevel)=>{const n=value(r,metric,tribe);return n==null?'#d6ddd9':n===0?'#f8fbfc':colors[cuts(metric,level).filter(c=>n>=c).length]};
export const format=(n:number|null,metric:Metric)=>n==null?'無資料':metric==='population'?`${Math.round(n).toLocaleString('zh-TW')} 人`:n>0&&n<.01?'<0.01%':`${n.toLocaleString('zh-TW',{maximumFractionDigits:2})}%`;
