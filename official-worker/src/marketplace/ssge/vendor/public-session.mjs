import {parseSource,PAGE_URL} from './discovery.mjs';
import {API_BASE} from './ssge-contract.mjs';
import {responseHeaders} from './diagnostics.mjs';
function expiry(token,now) {
 try {const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));if(typeof claims.exp==='number'&&Number.isFinite(claims.exp))return claims.exp*1000;}catch{}
 return now+18e6; // SSR memory cache TTL in the collected _app module.
}
export class PublicSession {
 #token; #expiresAt=0; #pending;
 constructor({fetchImpl=fetch,onBootstrap=()=>{},now=()=>Date.now()}={}){this.fetchImpl=fetchImpl;this.onBootstrap=onBootstrap;this.now=now;}
 async token({refresh=false}={}) {
  if(!refresh&&this.#token&&this.now()+30000<this.#expiresAt)return this.#token;
  if(this.#pending)return this.#pending;
  this.#pending=this.#bootstrap();
  try{return await this.#pending;}finally{this.#pending=undefined;}
 }
 async #bootstrap() {
  // Ordinary public page request. No cookie jar, browser profile, account session,
  // embedded client secret, captured token, or authenticated login is consumed.
  let response;
  try{response=await this.fetchImpl(PAGE_URL,{credentials:'omit',signal:AbortSignal.timeout(30000)});}
  catch(error){await this.onBootstrap({url:PAGE_URL,status:null,phase:'public-bootstrap',error:{message:error.message,cause:error.cause?.message},observedAt:new Date(this.now()).toISOString()});throw error;}
  const info={url:PAGE_URL,status:response.status,responseHeaders:responseHeaders(response.headers),observedAt:new Date(this.now()).toISOString(),mechanism:'fresh-public-page'};
  if(!response.ok){await this.onBootstrap(info);throw Object.assign(new Error(`Public bootstrap HTTP ${response.status}`),{status:response.status});}
  if(response.url&&new URL(response.url).origin!=='https://home.ss.ge'){await this.onBootstrap(info);throw new Error('Public bootstrap redirected outside home.ss.ge');}
  let source;
  try{source=parseSource(await response.text());}catch(error){await this.onBootstrap({...info,error:error.message});throw error;}
  info.buildId=source.buildId;info.anonymousSession=source.pageProps.session===null;
  if(!info.anonymousSession){await this.onBootstrap(info);throw new Error('Public bootstrap did not prove an anonymous session; refusing its credentials');}
  const token=source.pageProps.credentialsToken;
  info.publicTokenPresent=typeof token==='string'&&token.length>0;
  if(!info.publicTokenPresent){await this.onBootstrap(info);throw new Error('Anonymous public page did not issue credentialsToken');}
  this.#expiresAt=expiry(token,this.now());
  if(this.#expiresAt<=this.now()){await this.onBootstrap(info);throw new Error('Public bootstrap issued an expired token');}
  info.expiresAt=new Date(this.#expiresAt).toISOString();
  await this.onBootstrap(info);
  this.#token=token;return token;
 }
 async authorize(request,{refresh=false}={}) {
  if(new URL(request.url).origin!==API_BASE)throw new Error('Public application token is scoped to the discovered gateway');
  return {...request,options:{...request.options,headers:{...request.options?.headers,Authorization:`Bearer ${await this.token({refresh})}`}}};
 }
}
