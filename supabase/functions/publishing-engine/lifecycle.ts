/** Operation state is independent of canonical desired state and observed portal state. */
export const OPERATION_ACTIONS = {
  CREATE: 'fillListing', PUBLISH: 'publishAfterConfirmation', EDIT: 'editListing',
  UPDATE_PHOTOS: 'updatePhotos', HIDE: 'hideListing', PAUSE: 'pauseListing',
  RESUME: 'resumeListing', REFRESH: 'refreshListing', DELETE: 'deleteListing',
  CHECK_STATUS: 'checkStatus', RECONCILE: 'reconcile',
} as const;
export type OperationKind = keyof typeof OPERATION_ACTIONS;
export const MUTATIONS = ['PUBLISH','EDIT','UPDATE_PHOTOS','HIDE','PAUSE','RESUME','REFRESH','DELETE'];
export const TERMINAL = ['SUCCEEDED','SUPERSEDED','CANCELLED'];
export type OperationState = 'QUEUED'|'RUNNING'|'SUCCEEDED'|'FAILED'|'AUTH_REQUIRED'|'ACTION_REQUIRED'|'RECONCILIATION_REQUIRED'|'SUPERSEDED'|'CANCELLED';
export function operationAllowed(kind: string, portal: any): boolean {
  if (!Object.prototype.hasOwnProperty.call(OPERATION_ACTIONS,kind)) return false;
  const proof = portal?.verifiedOperations?.[kind];
  return proof?.verified === true && typeof proof.evidence === 'string' && proof.evidence.length > 0 && !proof.paidPromotion && !portal?.maintenance;
}
export function validateDraft(listing: any) {
  const errors: {field: string; code: string}[] = [];
  if (!listing || typeof listing !== 'object' || Array.isArray(listing)) return {valid:false,errors:[{field:'listing',code:'INVALID'}]};
  for (const key of ['price','area','rooms','bedrooms','floor','totalFloors']) if (listing[key] != null && (!Number.isFinite(listing[key]) || (key !== 'floor' && listing[key] < 0))) errors.push({field:key,code:'INVALID_NUMBER'});
  if (listing.floor != null && listing.totalFloors != null && listing.floor > listing.totalFloors) errors.push({field:'floor',code:'EXCEEDS_TOTAL_FLOORS'});
  if ((listing.photos?.length || 0) > 50) errors.push({field:'photos',code:'CANONICAL_MEDIA_LIMIT'});
  return {valid:errors.length===0,errors};
}
export function validatePublication(listing: any, portal: any, kind: string = 'PUBLISH') {
  const result=validateDraft(listing); const errors=[...result.errors];
  if (!Object.prototype.hasOwnProperty.call(OPERATION_ACTIONS,kind)) errors.push({field:'operation',code:'UNSUPPORTED_OPERATION'});
  if (['PUBLISH','CREATE'].includes(kind)) {
    for (const field of portal?.requirements?.required || []) {
      const value=field.split('.').reduce((v: any,k: string)=>v?.[k],listing);
      if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) errors.push({field,code:'REQUIRED_FOR_PORTAL'});
    }
    for(const field of ['price','area']) if (!(listing?.[field] > 0)) errors.push({field,code:'POSITIVE_REQUIRED'});
    for(const [field,values] of Object.entries(portal?.requirements?.allowedValues||{}))if(Array.isArray(values)&&!values.includes(listing?.[field]))errors.push({field,code:'PORTAL_VALUE_UNSUPPORTED'});
    for(const field of portal?.requirements?.unsupportedFields||[])if(listing?.[field]!=null&&listing[field]!=='')errors.push({field,code:'PORTAL_FIELD_UNSUPPORTED'});
    if (portal?.requirements?.maxPhotos != null && (listing.photos?.length||0) > portal.requirements.maxPhotos) errors.push({field:'photos',code:'PORTAL_PHOTO_LIMIT'});
  }
  return {valid:errors.length===0,errors};
}
export function normalizeDraft(raw: any, normalize: (x: any)=>any) {
  const listing=normalize(raw || {});
  return {...listing,title:typeof raw?.title==='string'?raw.title.trim().slice(0,180):'',district:typeof raw?.district==='string'?raw.district.trim().slice(0,160):'',
    amenities:Array.isArray(raw?.amenities)?raw.amenities.filter((x: unknown)=>typeof x==='string').slice(0,30):[],
    description:Object.fromEntries(['ka','en','ru','tr','ar','he'].map(lang=>[lang,typeof raw?.description?.[lang]==='string'?raw.description[lang].trim().slice(0,10000):listing.description?.[lang]||'']))};
}
export function verifyRemoteResult(operation: any, result: any, portal: any): boolean {
  if (result?.verified !== true || result?.operationId !== operation.id || result?.revision !== operation.desired_revision || result?.payloadHash !== operation.payload_hash) return false;
  if (!operationAllowed(operation.kind,portal)) return false;
  if (!result.externalId || (operation.external_id && operation.external_id !== result.externalId)) return false;
  try {const u=new URL(result.externalUrl);if(u.protocol!=='https:'||u.username||u.password||u.port||!(portal.domains||[]).some((d:string)=>u.hostname===d||u.hostname.endsWith('.'+d)))return false;}catch{return false;}
  if(['EDIT','PUBLISH','UPDATE_PHOTOS'].includes(operation.kind))return result.readbackHash===operation.payload_hash&&['PUBLISHED','PAUSED','HIDDEN'].includes(result.remoteState);
  if(operation.kind==='RECONCILE'&&result.remoteState!=='DELETED'&&result.readbackHash!==operation.payload_hash)return false;
  const states:Record<string,string[]>={HIDE:['HIDDEN'],PAUSE:['PAUSED'],RESUME:['PUBLISHED'],DELETE:['DELETED'],REFRESH:['PUBLISHED'],CHECK_STATUS:['PUBLISHED','PAUSED','HIDDEN','DELETED'],RECONCILE:['PUBLISHED','PAUSED','HIDDEN','DELETED']};
  return states[operation.kind]?.includes(result.remoteState)===true;
}
export function retryDelay(attempt: number) { return Math.min(3600,30 * 2 ** Math.max(0,attempt-1)); }
