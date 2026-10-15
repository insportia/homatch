import {operationAllowed,type OperationKind} from '../lifecycle.ts';
import {PortalFailure} from './http.ts';
export type ManagedOperation={id:string;user_id:string;listing_id:string;portal_id:string;kind:OperationKind;desired_revision:number;payload:Record<string,unknown>;payload_hash:string;external_id:string|null;lease_token:string;confirmed_at:string|null;idempotency_key:string};
export type CanonicalImage={assetId:string;name:string;mime:string;bytes:Uint8Array};
export type RemoteObservation={externalId:string;externalUrl:string;remoteState:string;readbackHash?:string;verified:boolean};
export type ServerAuthorization={authenticated:boolean;expiresAt:number;accountId:string};
export interface SecretProvider {read(reference:string):Promise<string|null>}
/** Trusted reviewed server code, never a customer-provided endpoint or script. */
export interface AuthorizedBinding {
 portalId:string;documentationUrl:string;authorizationEvidence:string;idempotentCreate:boolean;
 verifiedOperations:Record<string,{verified:boolean;evidence:string;paidPromotion?:boolean;meaning?:string}>;
 authorize(secret:string,signal:AbortSignal):Promise<ServerAuthorization>;
 validate(listing:Record<string,unknown>,kind:OperationKind):{valid:boolean;errors:string[]};
 map(listing:Record<string,unknown>):unknown;
 execute(operation:ManagedOperation,payload:unknown,photos:CanonicalImage[],auth:ServerAuthorization,signal:AbortSignal):Promise<{externalId:string;externalUrl:string}>;
 readback(operation:ManagedOperation,externalId:string,auth:ServerAuthorization,signal:AbortSignal):Promise<RemoteObservation>;
}
export class ManagedPortalAdapter {
 readonly transport='MANAGED_HTTP';
 readonly id:string;readonly domains:readonly string[];private binding?:AuthorizedBinding;private secrets?:SecretProvider;private reference?:string;
 constructor(id:string,domains:readonly string[],binding?:AuthorizedBinding,secrets?:SecretProvider,reference?:string){
  if(binding&&(binding.portalId!==id||!binding.documentationUrl.startsWith('https://')||!binding.authorizationEvidence))throw new PortalFailure('PORTAL_BINDING_INVALID');
  this.id=id;this.domains=domains;this.binding=binding;this.secrets=secrets;this.reference=reference;
 }
 get verifiedOperations(){return this.binding?.verifiedOperations||{};}
 get authorizationEvidence(){return this.binding?.authorizationEvidence||'';}
 supports(kind:string){return !!this.binding&&operationAllowed(kind,this)&&(kind!=='PUBLISH'||this.binding.idempotentCreate);}
 diagnostics(){return {portalId:this.id,transport:this.transport,status:'BLOCKED',code:this.binding?'SERVER_AUTHORIZATION_NOT_VERIFIED':'PORTAL_API_APPROVAL_REQUIRED',configured:!!this.binding,documentationUrl:this.binding?.documentationUrl||null,supportedOperations:Object.keys(this.verifiedOperations).filter(k=>this.supports(k))};}
 async authorize(signal:AbortSignal){
  if(!this.binding||!this.secrets||!this.reference)throw new PortalFailure('PORTAL_API_APPROVAL_REQUIRED');
  const secret=await this.secrets.read(this.reference);if(!secret)throw new PortalFailure('PORTAL_CREDENTIAL_REQUIRED');
  const auth=await this.binding.authorize(secret,signal);
  if(!auth.authenticated||!auth.accountId||!Number.isFinite(auth.expiresAt)||auth.expiresAt<=Date.now())throw new PortalFailure('AUTH_REQUIRED');
  return auth;
 }
 prepare(op:ManagedOperation,auth:ServerAuthorization){
  if(op.portal_id!==this.id||!this.supports(op.kind)||!this.binding)throw new PortalFailure('CAPABILITY_UNVERIFIED');
  if(['PUBLISH','DELETE','REFRESH'].includes(op.kind)&&!op.confirmed_at)throw new PortalFailure('EXPLICIT_CONFIRMATION_REQUIRED');
  if(auth.expiresAt<=Date.now())throw new PortalFailure('AUTH_REQUIRED');
  if(op.kind==='PUBLISH'&&op.external_id)throw new PortalFailure('RECONCILIATION_REQUIRED');
  if(!['PUBLISH','CREATE'].includes(op.kind)&&!op.external_id)throw new PortalFailure('REMOTE_REFERENCE_REQUIRED');
  if(['CHECK_STATUS','RECONCILE'].includes(op.kind))return null;
  if(!this.binding.validate(op.payload,op.kind).valid)throw new PortalFailure('LISTING_INVALID');
  return this.binding.map(op.payload);
 }
 async execute(op:ManagedOperation,payload:unknown,photos:CanonicalImage[],auth:ServerAuthorization,signal:AbortSignal){
  if(!this.binding)throw new PortalFailure('CAPABILITY_UNVERIFIED');
  return this.binding.execute(op,payload,photos,auth,signal);
 }
 async readback(op:ManagedOperation,id:string,auth:ServerAuthorization,signal:AbortSignal){
  if(!this.binding||!this.supports(op.kind))throw new PortalFailure('CAPABILITY_UNVERIFIED');
  return this.binding.readback(op,id,auth,signal);
 }
}
export const createMyHomeServerAdapter=(binding?:AuthorizedBinding,secrets?:SecretProvider,ref?:string)=>new ManagedPortalAdapter('myhome',['myhome.ge'],binding,secrets,ref);
export const createSsgeServerAdapter=(binding?:AuthorizedBinding,secrets?:SecretProvider,ref?:string)=>new ManagedPortalAdapter('ssge',['ss.ge'],binding,secrets,ref);
/** Missing API approval is not substituted with an internal endpoint or browser session. */
export const managedAdapters=[createMyHomeServerAdapter(),createSsgeServerAdapter()];
export const environmentSecrets=(read:(key:string)=>string|undefined):SecretProvider=>({read:async ref=>{
 if(!/^HOMATCH_PUBLISHING_(MYHOME|SSGE)_CREDENTIAL$/.test(ref))throw new PortalFailure('SECRET_REFERENCE_DENIED');
 return read(ref)||null;
}});
