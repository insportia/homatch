import {URL} from 'node:url';
﻿import { requestSpec,requestJson,type NaprOptions } from './napr-api.js';
import { publicUrl,ApiError } from './api.js';
import {classifyReference,type ReferenceClassification} from './document-references.js';
export type SourceObject=Record<string,unknown>;
export function object(value:unknown):SourceObject{if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiError('malformed');return value as SourceObject;}
// The captured input has no pattern, required, length, or cadastral-format validator.
// Angular's default text-input ngTrim removes surrounding whitespace; do not invent a regex.
export function validateCadastralCode(value:string):string{if(typeof value!=='string'||!value.trim())throw new Error('Provide a nonempty cadastral code');return value.trim();}
export function recordId(value:unknown):string{if((typeof value!=='string'&&typeof value!=='number')||!String(value)||['.','..'].includes(String(value))||/[\s/\\?#\x00-\x1f]/.test(String(value)))throw new Error('Invalid source record identifier');return String(value);}
export function searchRequest(cadastralCode:string,page=1){if(!Number.isInteger(page)||page<1)throw new Error('Invalid page');return requestSpec('/api/search',{page,search:'',regno:'',datefrom:null,dateto:null,person:'',address:'',cadcode:validateCadastralCode(cadastralCode)});}
export function statusRequest(id:unknown){return requestSpec('/api/appstatus/'+encodeURIComponent(recordId(id)));}
export function openRequest(id:unknown,legitimateToken:string){if(typeof legitimateToken!=='string')throw new Error('Invalid continuation');return requestSpec('/api/app/'+encodeURIComponent(recordId(id)),{recaptcha:legitimateToken});}
export function parseSearch(value:unknown){const raw=object(value);if(!Array.isArray(raw.applist))throw new ApiError('malformed');const records=raw.applist.map(value=>{const source=object(value);recordId(source.appID);return source;});for(const key of ['page','lastpage','total'])if(!Number.isInteger(raw[key])||(raw[key] as number)<0)throw new ApiError('malformed');return{records,page:raw.page as number,lastpage:raw.lastpage as number,total:raw.total as number,raw};}
export type SearchResult={source:'my.gov.ge';serviceId:176;cadastralCode:string;records:SourceObject[];pages:SourceObject[];retrievedAt:string;provenance:ReturnType<typeof searchRequest>[]};
export async function search(cadastralCode:string,options:NaprOptions={}):Promise<SearchResult>{const query=validateCadastralCode(cadastralCode);const records:SourceObject[]=[];const pages:SourceObject[]=[];const provenance:ReturnType<typeof searchRequest>[]=[];for(let page=1;;page++){
  const request=searchRequest(query,page);const parsed=parseSearch(await requestJson(request,options));if(parsed.page!==page&&parsed.records.length)throw new ApiError('malformed');provenance.push(request);pages.push(parsed.raw);records.push(...parsed.records);
  if(page>=parsed.lastpage)break;if(!parsed.records.length||page>=10000)throw new Error('Incomplete pagination; refusing to mark all records captured');
}return{source:'my.gov.ge',serviceId:176,cadastralCode:query,records,pages,retrievedAt:new Date().toISOString(),provenance};}
export type CaptchaRequired={state:'CAPTCHA_REQUIRED';cadastralCode:string;recordId:string;continuationContext:{status:unknown;browserUrl:string}};
export type DocumentReference={recordId:string;kind:'edocument'|'status'|'letter';url:string;raw:SourceObject;registrationNumber?:unknown;cadastralCode?:unknown} & Partial<ReferenceClassification>;
export function extractDocuments(raw:SourceObject,id:string):DocumentReference[]{const refs:DocumentReference[]=[];const add=(value:unknown,key:string,kind:DocumentReference['kind'])=>{const item=object(value);if(item.APP_ID!==undefined&&recordId(item.APP_ID)!==id)throw new Error('Source document record association mismatch');if(typeof item[key]==='string'&&item[key]){const url=publicUrl(item[key] as string,'https://naprweb.reestri.gov.ge/_dea/');refs.push({recordId:id,kind,url:url.href,raw:item});}};
  for(const item of (raw.edocuments as unknown[]??[]))add(item,'BLOB_URI','edocument');for(const item of (raw.statuses as unknown[]??[]))add(item,'LINK','status');
  for(const value of (raw.letters as unknown[]??[])){const letter=object(value);for(const entry of [letter,...(letter.answer as unknown[]??[])]){const item=object(entry);if(typeof item.link==='string'&&item.link)refs.push({recordId:id,kind:'letter',url:publicUrl('/api/letter/'+item.link,'https://naprweb.reestri.gov.ge').href,raw:item});}}
  const info=(raw.appinfo as any)?.r_info?.[0];
  return refs.map(ref=>({...ref,...classifyReference(ref),...(info?.REG_NUMBER!==undefined?{registrationNumber:info.REG_NUMBER}:{}),...(info?.CADCODE!==undefined?{cadastralCode:info.CADCODE}:{})}));
}
export function parseRecord(value:unknown,selectedId:string){const raw=object(value);const appinfo=object(raw.appinfo);if(!Array.isArray(appinfo.r_info)||!appinfo.r_info.length)throw new ApiError('malformed');const info=object(appinfo.r_info[0]);if(recordId(info.APP_ID)!==selectedId)throw new Error('Selected record association mismatch');for(const key of ['edocuments','statuses','letters'])if(raw[key]!==undefined&&!Array.isArray(raw[key]))throw new ApiError('malformed');return{state:'RECORD_OPEN' as const,recordId:selectedId,info,documents:extractDocuments(raw,selectedId),raw,retrievedAt:new Date().toISOString()};}
export async function selectRecord(result:SearchResult,id:unknown,options:NaprOptions={}){
 const selectedId=recordId(id);if(!result.records.some(r=>recordId(r.appID)===selectedId))throw new Error('Record is not in this search result');
 const status=object(await requestJson(statusRequest(selectedId),options));if(typeof status.status!=='string'&&typeof status.status!=='number')throw new ApiError('malformed');
 if(['10','15'].includes(String(status.status)))return{state:'CAPTCHA_REQUIRED',cadastralCode:result.cadastralCode,recordId:selectedId,continuationContext:{status:status.status,browserUrl:'https://naprweb.reestri.gov.ge/_dea/#/view/'+encodeURIComponent(selectedId)}} satisfies CaptchaRequired;
 return parseRecord(await requestJson(openRequest(selectedId,''),options),selectedId);
}
const consumedTokens=new Set<string>();
export async function resumeRecord(context:CaptchaRequired,legitimateToken:string,options:NaprOptions={}){
 if(context.state!=='CAPTCHA_REQUIRED'||!['10','15'].includes(String(context.continuationContext.status))||typeof legitimateToken!=='string'||!legitimateToken.trim())throw new Error('Legitimate human CAPTCHA continuation required');
 // In-memory guard only; no token is persisted, logged or returned. Server enforces validity.
 const {createHash}=await import('node:crypto');const fingerprint=createHash('sha256').update(legitimateToken).digest('hex');if(consumedTokens.has(fingerprint))throw new Error('Continuation already consumed');consumedTokens.add(fingerprint);
 return parseRecord(await requestJson(openRequest(context.recordId,legitimateToken),options),recordId(context.recordId));
}



