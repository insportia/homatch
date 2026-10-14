import { supabase } from '@/db/supabase';
export async function publishingApi(url:string,body?:unknown,signal?:AbortSignal) {
 const {data,error}=await supabase.functions.invoke('publishing-engine',{body:{url,body},signal});
 if(error||data?.code){
  let code=data?.code;
  if(!code&&error?.context instanceof Response){try{code=(await error.context.clone().json()).code;}catch{/* A transport failure has no structured response. */}}
  throw new Error(typeof code==='string'&&/^[A-Z_]{1,80}$/.test(code)?code:'PUBLISHING_REQUEST_FAILED');
 }return data;
}
export function browserCommand(command:unknown,timeoutMs=8000):Promise<any> {
 return new Promise((resolve,reject)=>{
  const requestId=crypto.randomUUID();let timer:ReturnType<typeof setTimeout>;
  const receive=(event:MessageEvent)=>{if(event.source!==window||event.origin!==location.origin||event.data?.source!=='HOMATCH_CONNECTOR'||event.data.requestId!==requestId)return;
   clearTimeout(timer);window.removeEventListener('message',receive);event.data.response?.ok?resolve(event.data.response):reject(new Error(event.data.response?.code||'EXTENSION_REQUIRED'));};
  timer=setTimeout(()=>{window.removeEventListener('message',receive);reject(new Error('EXTENSION_REQUIRED'));},timeoutMs);
  window.addEventListener('message',receive);window.postMessage({source:'HOMATCH_UI',requestId,command},location.origin);
 });
}
export async function connectPortal(portalId:string) {
 const hello=await publishingApi('/v2/browser',{type:'HELLO'});await browserCommand(hello.command);
 const authorized=await publishingApi('/v2/browser',{type:'CONNECT_PORTAL',portalId});return browserCommand(authorized.command);
}
export async function inspectPortal(portalId:string,tabId:number) {
 const authorized=await publishingApi('/v2/browser',{type:'EXECUTE',portalId,tabId,action:'checkAuthentication'});
 const response=await browserCommand(authorized.command);return publishingApi('/v2/connection',{portalId,result:response.result});
}
export async function processPortal(portalId:string,tabId:number,confirm:(kind:string)=>boolean) {
 const claimed=await publishingApi('/v2/claim',{portalId,tabId});if(!claimed.operation)return false;
 let response:any;
 try {
  if(['DELETE','REFRESH'].includes(claimed.operation.kind)&&!confirm(claimed.operation.kind))throw new Error('EXPLICIT_CONFIRMATION_REQUIRED');
  response=await browserCommand(claimed.command,120000);
  if(claimed.operation.kind==='PUBLISH'&&response.result?.status==='READY_FOR_REVIEW'){
   if(!confirm('PUBLISH'))throw new Error('EXPLICIT_CONFIRMATION_REQUIRED');
   response=await browserCommand({...claimed.command,phase:'CONFIRM',approval:true,reviewToken:response.result.reviewToken},120000);
  }
 }catch(error){response={result:{verified:false,code:error instanceof Error?error.message:'REMOTE_UNVERIFIED'}};}
 await publishingApi('/v2/complete',{operationId:claimed.operation.id,leaseToken:claimed.operation.lease_token,result:response.result});return true;
}
