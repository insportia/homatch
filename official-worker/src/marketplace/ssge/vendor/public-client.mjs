import {searchRequest,countRequest,detailRequest,publicRequest,ENDPOINTS} from './ssge-contract.mjs';
import {requestJson} from './http.mjs';
import {PublicSession} from './public-session.mjs';
export class SsgePublicClient {
 constructor({locations,http={},session,publicContext={}}={}){this.locations=locations;this.http=http;this.publicContext=publicContext;for(const [k,v]of Object.entries(publicContext))if(!(['Origin','Referer'].includes(k)&&v===(k==='Origin'?'https://home.ss.ge':'https://home.ss.ge/')))throw new Error('Unproven public request context');this.session=session??new PublicSession({fetchImpl:http.fetchImpl,onBootstrap:http.onBootstrap});}
 async request(request){
  request={...request,options:{...request.options,headers:{...request.options.headers,...this.publicContext}}};
  try{return await requestJson(await this.session.authorize(request),this.http);}
  catch(error){if(error.status!==401)throw error;return requestJson(await this.session.authorize(request,{refresh:true}),this.http);}
 }
 searchOnce(criteria,page=1){return this.request(searchRequest(criteria,this.locations,page));}
 count(criteria){return this.request(countRequest(criteria,this.locations));}
 detail(id){return this.request(detailRequest(id));}
 locationChain(){return this.request(publicRequest(ENDPOINTS.locations));}
}
