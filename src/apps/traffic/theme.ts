import type {TrafficRecord,TrafficEvent} from '../../data/traffic';
import type {RegionLevel,View} from '../../map-core/types';
export const metrics=['accidents','injuries','deaths','rate'] as const;
export type Metric=typeof metrics[number];
export const labels:Record<Metric,string>={accidents:'交通事故件數',injuries:'交通事故受傷人數',deaths:'交通事故死亡人數（24 小時）',rate:'交通事故發生率'};
export const parseMetric=(q:string):Metric=>{const m=new URLSearchParams(q).get('metric');return metrics.includes(m as Metric)?m as Metric:'accidents'};
export const parseYear=(q:string,years:number[])=>{const y=Number(new URLSearchParams(q).get('year'));return years.includes(y)?y:years[0]};
export function value(r:TrafficRecord|null,m:Metric):number|null {if(!r)return null;return m==='rate'?r.population? r.accidents/r.population*100000:null:r[m]}
export const format=(n:number|null,m:Metric)=>n===null?'無資料':`${n.toLocaleString('zh-TW',{maximumFractionDigits:m==='rate'?1:0})}${m==='accidents'?' 件':m==='rate'?' 件／十萬人':' 人'}`;
export const colors=['#fff4dc','#fee2a8','#fec474','#f99a4a','#e96c33','#cd422b','#932a2d'];
export const cuts=(m:Metric,l:RegionLevel)=>m==='rate'?[100,300,600,1000,2000,3000]:m==='deaths'?(l==='county'?[5,10,30,50,100,200]:l==='town'?[1,2,5,10,20,40]:[1,2,3,5,10,20]):l==='county'?[1000,5000,10000,20000,40000,80000]:l==='town'?[50,200,500,1000,2000,5000]:[5,20,50,100,200,500];
export const color=(r:TrafficRecord|null,m:Metric,l:RegionLevel)=>{const n=value(r,m);return n===null?'#d6ddd9':n===0?'#f8fbfc':colors[cuts(m,l).filter(c=>n>=c).length]};
export function eventsForView(events:TrafficEvent[],view:Pick<View,'level'|'path'|'selected'>,metric:Metric='accidents'){if(!view.path.length)return[];const town=view.path[1]?.properties.code,village=view.selected?.properties.code;return events.filter(e=>(!town||e[8]===town)&&(view.level!=='detail'||e[9]===village)&&(metric!=='deaths'||e[5]==='A1'&&e[6]>0))}
