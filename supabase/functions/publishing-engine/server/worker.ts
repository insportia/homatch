import {verifyRemoteResult} from '../lifecycle.ts';
import {ManagedPortalAdapter,type ManagedOperation,type CanonicalImage,type ServerAuthorization} from './adapters.ts';
import {PortalFailure} from './http.ts';
export interface ManagedQueue {
 authorize(adapter:ManagedPortalAdapter,auth:ServerAuthorization):Promise<void>;
 claim(portalId:string,kinds:string[]):Promise<ManagedOperation|null>;
 photos(operation:ManagedOperation):Promise<CanonicalImage[]>;
 checkpoint(operation:ManagedOperation,remote:{externalId:string;externalUrl:string}):Promise<void>;
 finish(operation:ManagedOperation,verified:boolean,result:unknown,code:string|null):Promise<void>;
 bill():Promise<void>;
}
function safeRemote(adapter:ManagedPortalAdapter,id:string,url:string){
 if(typeof id!=='string'||!id||id.length>200)return false;
 try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&adapter.domains.some(d=>u.hostname===d||u.hostname.endsWith('.'+d));}catch{return false;}
}
/** Server-only consumer of the existing queue. No client reports, browser fallback, or raw response logging. */
export async function processManagedPortal(queue:ManagedQueue,adapter:ManagedPortalAdapter,signal=AbortSignal.timeout(240000)){
 const kinds=Object.keys(adapter.verifiedOperations).filter(k=>adapter.supports(k));
 if(!kinds.length)return {status:'BLOCKED',code:'PORTAL_API_APPROVAL_REQUIRED',portalId:adapter.id};
 let auth:ServerAuthorization;
 try{auth=await adapter.authorize(signal);await queue.authorize(adapter,auth);}catch(e){return {status:'BLOCKED',code:e instanceof PortalFailure?e.code:'AUTH_REQUIRED',portalId:adapter.id};}
 const op=await queue.claim(adapter.id,kinds);if(!op)return {status:'IDLE',portalId:adapter.id};
 let dispatched=false,awaitingReadback=false;
 try{
  const payload=adapter.prepare(op,auth);
  const reading=['CHECK_STATUS','RECONCILE'].includes(op.kind);
  const photos=['PUBLISH','UPDATE_PHOTOS','EDIT'].includes(op.kind)?await queue.photos(op):[];
  dispatched=!reading;
  const remote=reading?{externalId:op.external_id!,externalUrl:''}:await adapter.execute(op,payload,photos,auth,signal);
  if(!reading){awaitingReadback=true;if(!safeRemote(adapter,remote.externalId,remote.externalUrl))throw new PortalFailure('REMOTE_UNVERIFIED',true);await queue.checkpoint(op,remote);}
  const observed=await adapter.readback(op,remote.externalId,auth,signal);
  if(observed.externalId!==remote.externalId)throw new PortalFailure('REMOTE_UNVERIFIED',dispatched);
  const result={externalId:observed.externalId,externalUrl:observed.externalUrl,remoteState:observed.remoteState,readbackHash:observed.readbackHash,verified:observed.verified,operationId:op.id,revision:op.desired_revision,payloadHash:op.payload_hash};
  const verified=verifyRemoteResult(op,result,adapter);
  await queue.finish(op,verified,verified?result:{},verified?null:'REMOTE_UNVERIFIED');
  if(verified){try{await queue.bill();}catch{return {status:'VERIFIED',billingPending:true,operationId:op.id,portalId:adapter.id};}}
  return {status:verified?'VERIFIED':'RECONCILIATION_REQUIRED',operationId:op.id,portalId:adapter.id};
 }catch(error){
  const known=error instanceof PortalFailure?error:null;
  const code=awaitingReadback?'REMOTE_UNVERIFIED':known&&!known.mayHaveWritten?known.code:dispatched?'REMOTE_UNVERIFIED':known?.code||'PORTAL_TEMPORARILY_UNAVAILABLE';
  await queue.finish(op,false,{},code);
  return {status:'UNVERIFIED',code,operationId:op.id,portalId:adapter.id};
 }
}
export function supabaseManagedQueue(admin:any):ManagedQueue{
 const rpc=async(name:string,args:unknown)=>{const {data,error}=await admin.rpc(name,args);if(error)throw new PortalFailure('QUEUE_REQUEST_FAILED');return data;};
 return {
  authorize:async(adapter,auth)=>{await rpc('publishing_engine_authorize_managed',{p_portal:adapter.id,p_account:auth.accountId,p_expires:new Date(auth.expiresAt).toISOString(),p_evidence:adapter.authorizationEvidence,p_capabilities:adapter.verifiedOperations});},
  claim:async(portal,kinds)=>(await rpc('publishing_engine_claim_managed',{p_portal:portal,p_verified_kinds:kinds}))?.[0]||null,
  photos:async op=>{
   const items=op.payload.photos;if(items==null)return [];if(!Array.isArray(items)||items.length>50)throw new PortalFailure('INVALID_PHOTOS');
   const images:CanonicalImage[]=[];let total=0;
   for(const p of items){
    if(!p||typeof p.assetId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(p.assetId))throw new PortalFailure('INVALID_ASSET');
    const {data,error}=await admin.storage.from('publishing-engine-photos').download(op.user_id+'/'+p.assetId);
    if(error||!data||data.size>8000000)throw new PortalFailure('OWNED_PHOTO_REQUIRED');
    const bytes=new Uint8Array(await data.arrayBuffer());total+=bytes.length;
    if(total>24000000||bytes.length<12)throw new PortalFailure('INVALID_PHOTOS');
    const mime=bytes[0]===255&&bytes[1]===216?'image/jpeg':[137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n)?'image/png':String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP'?'image/webp':null;
    if(!mime||mime!==data.type)throw new PortalFailure('INVALID_PHOTO');
    images.push({assetId:p.assetId,name:String(p.name||'photo').replace(/[^\p{L}\p{N}._-]/gu,'').slice(0,100),mime,bytes});
   }return images;
  },
  checkpoint:async(op,remote)=>{await rpc('publishing_engine_checkpoint_managed',{p_operation:op.id,p_lease:op.lease_token,p_external:remote.externalId,p_url:remote.externalUrl});},
  finish:async(op,verified,result,code)=>{await rpc('publishing_engine_finish_managed',{p_operation:op.id,p_lease:op.lease_token,p_verified:verified,p_result:result,p_error:code});},
  bill:async()=>{await rpc('publishing_engine_bill_due',{p_limit:10});},
 };
}
