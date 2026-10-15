/** Direct HTTP only; provider bindings supply reviewed fixed endpoints. */
export class PortalFailure extends Error {
 code:string; mayHaveWritten:boolean;
 constructor(code:string,mayHaveWritten=false){super(code);this.name='PortalFailure';this.code=code;this.mayHaveWritten=mayHaveWritten;}
}
export class PortalHttp {
 private origin:string;
 constructor(origin:string,allowedOrigins:readonly string[],privateHeaders:()=>Promise<Record<string,string>>,request:typeof fetch=fetch){
  const u=new URL(origin);
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.pathname!=='/'||!allowedOrigins.includes(u.origin))throw new PortalFailure('PORTAL_ORIGIN_DENIED');
  this.origin=u.origin;this.headers=privateHeaders;this.request=request;
 }
 private headers:()=>Promise<Record<string,string>>;
 private request:typeof fetch;
 async send(path:string,method:'GET'|'POST'|'PUT'|'PATCH'|'DELETE',body?:BodyInit,signal?:AbortSignal){
  const u=new URL(path,this.origin);
  if(!path.startsWith('/')||path.startsWith('//')||u.origin!==this.origin||u.username||u.password||u.hash)throw new PortalFailure('PORTAL_ORIGIN_DENIED');
  let response:Response;const writing=method!=='GET';
  const headers=await this.headers();
  try{response=await this.request(u,{method,body,headers,redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});}
  catch{throw new PortalFailure('PORTAL_TRANSPORT_UNCERTAIN',writing);}
  if(response.ok)return response;
  await response.body?.cancel();
  if(response.status===401)throw new PortalFailure('AUTH_REQUIRED');
  if(response.status===403)throw new PortalFailure('PORTAL_ACCESS_DENIED');
  if(response.status===404)throw new PortalFailure('REMOTE_NOT_FOUND',writing);
  if(response.status===429)throw new PortalFailure('RATE_LIMITED',writing);
  if(response.status>=500)throw new PortalFailure('PORTAL_TEMPORARILY_UNAVAILABLE',writing);
  throw new PortalFailure('PORTAL_REQUEST_REJECTED',writing);
 }
}
