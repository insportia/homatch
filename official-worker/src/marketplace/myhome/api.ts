// Acquisition primitives copied from the live-verified standalone MyHome worker.
import { URL } from 'node:url';
import {buildSearchUrl,deduplicate,type Criteria} from './worker.js';
import {normalizeListing} from './next-data.js';
export const endpoints = {
  list:'https://api-statements.tnet.ge/v1/statements',
  count:'https://api-statements.tnet.ge/v1/statements/count',
  locations:'https://api-locations.tnet.ge/v2/cities',
  filters:'https://api-statements.tnet.ge/v1/statements/statement-parameters'
};
export type Listing = ReturnType<typeof normalizeListing>;
export type HttpRecord = {url:string;status:number|null;error?:string};
export class AcquisitionError extends Error {
  status:number|null;
  url:string;
  constructor(url:string,status:number|null,message:string) {super(`${url}: ${message}`);this.url=url;this.status=status;}
}
export async function publicJson(url:string,locale='ka',fetcher:typeof fetch=fetch) {
  let response:Response;
  try {
    response = await fetcher(url,{method:'GET',signal:AbortSignal.timeout(20000),
      headers:{Accept:'application/json','X-Website-Key':'myhome',locale}});
  } catch(error) {
    const e=error as Error & {cause?:{code?:string}};
    throw new AcquisitionError(url,null,`${e.message}${e.cause?.code ? ` (${e.cause.code})` : ''}`);
  }
  if(!response.ok) throw new AcquisitionError(url,response.status,`HTTP ${response.status}; request stopped`);
  const text=await response.text();
  let payload;
  try {payload=JSON.parse(text);} catch {throw new AcquisitionError(url,response.status,'Response is not JSON');}
  return {url,status:response.status,payload};
}
export function apiUrl(criteria:Criteria,page=1,kind:'list'|'count'='list') {
  const search=new URL(buildSearchUrl(criteria,page));
  const url=new URL(endpoints[kind]);
  // Frontend module 85571 filters only empty values. All supported values here
  // are scalar strings, serialized exactly by module 17800 getQueryString.
  url.search=search.search;
  return url.href;
}
export function parseListEnvelope(payload:any): Listing[] {
  if(payload?.result !== true || !Array.isArray(payload?.data?.data)) throw new Error('Invalid list response envelope');
  return deduplicate(payload.data.data.map(normalizeListing));
}
export function parsePagination(payload:any,requestedPage:number) {
  if(payload?.result !== true || !payload.data || typeof payload.data !== 'object') throw new Error('Invalid count response envelope');
  const {page,last_page,total}=payload.data;
  if(![page,last_page,total].every(Number.isSafeInteger) || page !== requestedPage || last_page < 0 || total < 0
    || (total > 0 && last_page < page) || (total === 0 && last_page > 1)) throw new Error('Invalid or incomplete count metadata');
  return {page,last_page,total};
}
export function validateSearchListings(listings:Listing[],criteria:Criteria) {
  const query=new URL(buildSearchUrl(criteria)).searchParams;
  for(const listing of listings) {
    const raw=listing.raw_source_data;
    for(const [filter,key] of [['deal_types','deal_type_id'],['real_estate_types','real_estate_type_id'],['cities','city_id'],['districts','district_id'],['urbans','urban_id'],['area_types','area_type_id']]) {
      const expected=query.get(filter);
      if(expected !== null && String(raw[key]) !== expected) throw new Error(`Listing ${listing.source_id} does not match ${filter}`);
    }
    for(const [value,low,high,key] of [[listing.price,criteria.minPrice,criteria.maxPrice,'price'],[listing.area_m2,criteria.minArea,criteria.maxArea,'area']]) {
      if((low !== undefined || high !== undefined) && (typeof value !== 'number' || low !== undefined && value < Number(low) || high !== undefined && value > Number(high))) throw new Error(`Listing ${listing.source_id} does not match ${key} range`);
    }
  }
}
export function resolveLocation(criteria:Criteria,payload:any):Criteria {
  if(!Array.isArray(payload?.data)) throw new Error('Invalid location dictionary');
  const names = (item:any) => [item.display_name,item.display_name_in,item.slug,
    ...Object.values(item.translations ?? {}).flatMap((translation:any)=>[translation.display_name,translation.display_name_in])];
  const match=(items:any[],value:string|undefined,id:number|undefined,label:string)=>{
    const matches=items.filter(item=>id !== undefined ? item.id === id : value && names(item).some(x=>typeof x==='string' && x.toLowerCase()===value.toLowerCase()));
    if(matches.length !== 1) throw new Error(`Unknown or ambiguous ${label}`);
    return matches[0];
  };
  if(!criteria.city && criteria.cityId === undefined) {
    if(criteria.district || criteria.districtId !== undefined || criteria.urbanId !== undefined) throw new Error('City required for location resolution');
    return criteria;
  }
  // Supplied mappings are aliases; they still must exist in the live dictionary.
  const knownCity=criteria.city && ['tbilisi','თბილისი'].includes(criteria.city.toLowerCase()) ? 1 : undefined;
  if(knownCity !== undefined && criteria.cityId !== undefined && knownCity !== criteria.cityId) throw new Error('Conflicting city name and ID');
  const city=match(payload.data,criteria.city,criteria.cityId ?? knownCity,'city');
  let districtId=criteria.districtId,urbanId=criteria.urbanId;
  if(criteria.district) {
    const name=criteria.district.toLowerCase();
    if(['krtsanisi','krwanisi','კრწანისი'].includes(name) && city.id === 1) {
      if(districtId !== undefined && districtId !== 6 || urbanId !== undefined && urbanId !== 65) throw new Error('Conflicting Krtsanisi IDs');
      districtId=6;urbanId=65;
    } else {
      const districts=(city.districts ?? []).filter((d:any)=>names(d).some((v:any)=>typeof v==='string' && v.toLowerCase()===name));
      const urbans=(city.districts ?? []).flatMap((d:any)=>(d.urbans ?? []).map((u:any)=>({...u,parent_id:d.id}))).filter((u:any)=>names(u).some((v:any)=>typeof v==='string' && v.toLowerCase()===name));
      if(districts.length+urbans.length !== 1) throw new Error('Unknown or ambiguous district/urban');
      const resolvedDistrict=districts[0]?.id ?? urbans[0].parent_id;
      const resolvedUrban=urbans[0]?.id;
      if(districtId !== undefined && districtId !== resolvedDistrict || urbanId !== undefined && resolvedUrban !== undefined && urbanId !== resolvedUrban) throw new Error('Conflicting district/urban IDs');
      districtId=resolvedDistrict;urbanId=resolvedUrban ?? urbanId;
    }
  }
  if(districtId !== undefined) match(city.districts ?? [],undefined,districtId,'district');
  if(urbanId !== undefined) {
    const parents=(city.districts ?? []).filter((d:any)=>(d.urbans ?? []).some((u:any)=>u.id === urbanId));
    if(parents.length !== 1 || districtId !== undefined && parents[0].id !== districtId) throw new Error('Urban not in selected district');
    districtId=parents[0].id;
  }
  // Numeric resolution lets the existing query builder support other live cities.
  return {...criteria,city:undefined,district:undefined,cityId:city.id,districtId,urbanId};
}
