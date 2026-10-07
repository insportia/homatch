import {parseSource} from './discovery.mjs';
import {listingUrl} from './normalize.mjs';
import {responseHeaders} from './diagnostics.mjs';
export function inspectIndividualPage(html,{candidate,status,finalUrl,headers}={}) {
 const proof={status,url:candidate.exactUrl,finalUrl,responseHeaders:responseHeaders(headers),passed:false};
 if(status!==200)return proof;
 const source=parseSource(html);proof.route=source.page;proof.anonymousSession=source.pageProps.session===null;
 const tags=html.match(/<link\b[^>]*>/gi)??[];
 const canonical=tags.find(tag=>/\brel=["']canonical["']/i.test(tag));
 proof.canonicalUrl=canonical?.match(/\bhref=["']([^"']+)["']/i)?.[1]?.replace(/&amp;/g,'&')??null;
 proof.pagePropKeys=Object.keys(source.pageProps).filter(k=>!['session','credentialsToken'].includes(k));
 // A numeric slug suffix is not a source ID. Require an independent primary
 // property object from the individual page; never accept IDs in related arrays.
 const properties=[];
 function visit(value,pointer,depth=0) {
  if(depth>3||!value||typeof value!=='object'||Array.isArray(value))return;
  if(value.applicationId!=null&&value.title!=null&&value.price&&value.address&&value.realEstateTypeId!=null) {
   properties.push({pointer,applicationId:String(value.applicationId),title:value.title,realEstateTypeId:value.realEstateTypeId});return;
  }
  for(const [key,child]of Object.entries(value))if(!['session','credentialsToken','locations'].includes(key))visit(child,`${pointer}.${key}`,depth+1);
 }
 visit(source.pageProps,'$.pageProps');proof.propertyObjects=properties;
 proof.identityPassed=properties.length===1&&properties[0].applicationId===candidate.sourceListingId&&properties[0].title===candidate.title;
 try {
  const final=listingUrl(finalUrl),canonicalUrl=listingUrl(proof.canonicalUrl);
  proof.passed=proof.anonymousSession&&source.page==='/real-estate/[slug]'&&final===candidate.exactUrl&&canonicalUrl===candidate.exactUrl&&proof.identityPassed;
 }catch(error){proof.error=error.message;}
 return proof;
}
export async function verifyIndividualPage(candidate,{fetchImpl=fetch,signal}={}) {
 const response=await fetchImpl(candidate.exactUrl,{credentials:'omit',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});
 return inspectIndividualPage(response.ok?await response.text():'',{candidate,status:response.status,finalUrl:response.url,headers:response.headers});
}
