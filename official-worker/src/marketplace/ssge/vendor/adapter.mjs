import {paginate} from './pagination.mjs';
import {SsgePublicClient} from './public-client.mjs';
import {parseCount,parseSearch} from './search-response.mjs';
import {normalizeList,normalizeDetail} from './normalize.mjs';
import {validateCriteria} from './validation.mjs';
export class SsgeAdapter {
 constructor(options={}){this.client=options.client??new SsgePublicClient(options);}
 async *search(criteria,{onPage=()=>{},...options}={}) {
  const count=parseCount(await this.client.count(criteria));
  const urls=new Map();
  for await(const result of paginate(async page=>{
   const parsed=parseSearch(await this.client.searchOnce(criteria,page),count);
   await onPage({page,...parsed});return parsed;
  },options)) {
   const items=[],excluded=[];
   for(const entry of result.items) {
    let normalized;
    try{normalized=normalizeList(entry.raw,{provenance:{endpoint:'/v1/RealEstate/LegendSearch',page:result.page}});if(!normalized.exactUrl)throw new Error('Missing individual detailUrl');}
    catch(error){excluded.push({sourceListingId:entry.sourceListingId,reason:error.message});continue;}
    const compliance=validateCriteria(normalized,criteria,this.client.locations);
    if(!compliance.passed){excluded.push({sourceListingId:entry.sourceListingId,reason:'Source criteria mismatch',failures:compliance.failures});continue;}
    const previous=urls.get(normalized.exactUrl);
    if(previous&&previous!==normalized.sourceListingId)throw new Error('Different source IDs cannot share a listing URL');
    urls.set(normalized.exactUrl,normalized.sourceListingId);items.push(normalized);
   }
   yield {...result,items,excluded,count};
  }
 }
 async detail(id){const detail=normalizeDetail(await this.client.detail(id),{provenance:{endpoint:'/v1/RealEstate/details'}});if(detail.sourceListingId!==String(id))throw new Error(`Detail identity mismatch: requested ${id}, received ${detail.sourceListingId}`);return detail;}
}
export function translateCriteria(criteria,provenMappings) {
  const result={};
  for(const [key,value] of Object.entries(criteria)) {
    if(value===undefined||value===null) continue;
    if(!Object.hasOwn(provenMappings,key)) throw new Error(`Unsupported or unproven criterion: ${key}`);
    result[key]=provenMappings[key](value);
  }
  return result;
}
export function crossCheck(list,detail,fields=['sourceListingId','title','price','currency','area','rooms','city','district','subdistrict','street','exactUrl','images']) {
  const mismatches=[],unavailable=[],matched=[];
  for(const field of fields) {
    if(list[field]==null||detail[field]==null) unavailable.push(field);
    else if(JSON.stringify(list[field])!==JSON.stringify(detail[field])) mismatches.push({field,list:list[field],detail:detail[field]});
    else matched.push(field);
  }
  return {passed:matched.includes('sourceListingId')&&!mismatches.length,matched,unavailable,mismatches};
}
