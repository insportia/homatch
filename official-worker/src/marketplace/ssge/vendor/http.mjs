import {sanitizeHttp,responseHeaders} from './diagnostics.mjs';
export async function requestJson(request,{fetchImpl=fetch,retries=3,signal,sleep=ms=>new Promise(r=>setTimeout(r,ms)),onResponse=()=>{}}={}) {
 for(let attempt=0;;attempt++) {
  let response,text;
  try {
   response=await fetchImpl(request.url,{...request.options,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});
   text=await response.text();
  } catch(error) {
   await onResponse(sanitizeHttp({request,error:{message:error.message,cause:error.cause?.message},attempt}));
   if(signal?.aborted||attempt>=retries)throw error;
   await sleep(250*2**attempt);continue;
  }
  await onResponse(sanitizeHttp({request,status:response.status,responseHeaders:responseHeaders(response.headers),transport:response.ssgeTransport??{protocol:'fetch-default-unrecorded'},text,attempt,observedAt:new Date().toISOString()}));
  if(!response.ok) {
   const error=Object.assign(new Error(`SS.ge HTTP ${response.status}`),{status:response.status,transient:response.status===429||response.status>=500});
   if(!error.transient||attempt>=retries)throw error;
   const retryAfter=response.headers?.get('retry-after');
   const delay=retryAfter&&/^\d+$/.test(retryAfter)?Math.min(Number(retryAfter)*1000,30000):250*2**attempt;
   await sleep(delay);continue;
  }
  try{return JSON.parse(text);}catch{throw new Error('SS.ge returned non-JSON response');}
 }
}
