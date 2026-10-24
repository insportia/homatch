import ky, { type AfterResponseHook } from 'ky';
import { createParser } from 'eventsource-parser';

export interface SSEOptions {
  onData:(data:string)=>void;
  onEvent?:(event:unknown)=>void;
  /**
   * The non-text fields of a response.
   *
   * A single-shot JSON reply carries them in its body. A streamed HOMI reply
   * sends them as named events: `meta` (the finished answer's chips, cards,
   * sources and authoritative final text) and `error` (the stream ended
   * without an answer). Both arrive here, with `__event` naming which.
   * Every caller must treat this as optional.
   */
  onMeta?:(payload:Record<string, unknown>)=>void;
  onCompleted?:(error?:Error)=>void;
  onAborted?:()=>void;
}
/* Named events that describe the answer rather than carry its words. */
const META_EVENTS = new Set(['meta', 'error', 'open', 'done']);
export function createSSEHook(options:SSEOptions):AfterResponseHook{return async(request,_opts,response)=>{if(!response.ok)return;let done=false;const finish=(err?:Error)=>{if(!done){done=true;options.onCompleted?.(err)}};const contentType=response.headers.get('content-type')??'';if(contentType.includes('application/json')){try{const payload=await response.clone().json() as {text?:string;sources?:Array<{title?:string;label?:string;url?:string;status?:string}>;internalSummary?:Record<string,number>};options.onMeta?.(payload as Record<string, unknown>);if(payload?.text){/* The sources now reach the UI through onMeta (WebContextLine renders them with the honest webChecked flag). The synthesized RESEARCH_JSON card is gone: it fabricated a confidence figure (55+5/source) that no analysis ever produced, which is exactly the kind of invented metric this product forbids. */options.onData(JSON.stringify({candidates:[{content:{parts:[{text:payload.text}]}}]}));}finish();}catch(err){finish(err as Error)}return response;}if(!response.body){finish();return response;}const reader=response.body.getReader();const decoder=new TextDecoder('utf8');const parser=createParser({onEvent:(event)=>{if(!event.data)return;options.onEvent?.(event);if(event.event&&META_EVENTS.has(event.event)){try{options.onMeta?.({...(JSON.parse(event.data) as Record<string, unknown>),__event:event.event});}catch{/* a malformed meta frame is dropped, never shown */}return;}for(const chunk of event.data.split('\n'))options.onData(chunk);}});const read=():void=>{reader.read().then(({done:streamDone,value})=>{if(streamDone){finish();return;}parser.feed(decoder.decode(value,{stream:true}));read();}).catch((err)=>{if(request.signal.aborted){options.onAborted?.();return;}finish(err as Error);});};read();return response;};}
export interface StreamRequestOptions {functionUrl:string;requestBody:unknown;supabaseAnonKey:string;accessToken?:string;onData:(data:string)=>void;onMeta?:(payload:Record<string, unknown>)=>void;onComplete:()=>void;onError:(error:Error)=>void;signal?:AbortSignal;}
/*
 * A SIGNED-OUT CALLER STILL NEEDS AN AUTHORIZATION HEADER.
 *
 * With no accessToken this used to send `apikey` alone, and Supabase's
 * edge gateway rejects that with 401 before the function is even
 * reached when verify_jwt is on. homatch-ai was written expecting the
 * anon key as its bearer — its own comment says "the anon key is a
 * valid bearer here, so no user means an anonymous caller", and the
 * whole anonymous-session branch underneath it was unreachable from a
 * browser because the header never arrived. The anon key IS a JWT;
 * sending it is what supabase-js itself does.
 *
 * The timeout sits above the function's own 130 s provider bound, so a slow
 * answer ends in the server's own failure path, never in a client abort.
 */
export async function sendStreamRequest(options:StreamRequestOptions):Promise<void>{const{functionUrl,requestBody,supabaseAnonKey,accessToken,onData,onMeta,onComplete,onError,signal}=options;const sseHook=createSSEHook({onData,onMeta,onCompleted:(err)=>(err?onError(err):onComplete()),onAborted:()=>console.log('Stream aborted')});try{await ky.post(functionUrl,{json:requestBody,headers:{Authorization:`Bearer ${accessToken??supabaseAnonKey}`,apikey:supabaseAnonKey,'Content-Type':'application/json',Accept:'text/event-stream, application/json'},timeout:140_000,signal,hooks:{afterResponse:[sseHook]}});}catch(err){if(!signal?.aborted)onError(err as Error);}}
