import ky, { type AfterResponseHook } from 'ky';
import { createParser } from 'eventsource-parser';

export interface SSEOptions {
  onData:(data:string)=>void;
  onEvent?:(event:unknown)=>void;
  /**
   * The non-text fields of a single-shot JSON response.
   *
   * A streamed answer arrives as text and nothing else, but a function that
   * replies in one JSON body can also say things ABOUT the answer — which
   * conversation it belongs to, for instance. That was being parsed and then
   * dropped. Only fires for the JSON branch, so every caller must treat it as
   * optional rather than as something that always arrives.
   */
  onMeta?:(payload:Record<string, unknown>)=>void;
  onCompleted?:(error?:Error)=>void;
  onAborted?:()=>void;
}
export function createSSEHook(options:SSEOptions):AfterResponseHook{return async(request,_opts,response)=>{if(!response.ok)return;let done=false;const finish=(err?:Error)=>{if(!done){done=true;options.onCompleted?.(err)}};const contentType=response.headers.get('content-type')??'';if(contentType.includes('application/json')){try{const payload=await response.clone().json() as {text?:string;sources?:Array<{title?:string;label?:string;url?:string;status?:string}>;internalSummary?:Record<string,number>};options.onMeta?.(payload as Record<string, unknown>);if(payload?.text){let text=payload.text;const sources=(payload.sources??[]).filter(s=>s?.url).map(s=>({label:s.label||s.title||s.url||'Source',url:s.url,status:s.status||'FOUND_ONLINE'}));if(sources.length){const report={entityName:'Research result',entityType:'PUBLIC_WEB_RESEARCH',confidence:Math.min(95,55+sources.length*5),summary:'Homatch searched internal data first and then public web sources.',sources,homatchData:payload.internalSummary??{},publicFindings:{riskFlags:[]},warnings:[],actions:[]};text+=`\n\n[[RESEARCH_JSON:${JSON.stringify(report)}]]`;}options.onData(JSON.stringify({candidates:[{content:{parts:[{text}]}}]}));}finish();}catch(err){finish(err as Error)}return response;}if(!response.body){finish();return response;}const reader=response.body.getReader();const decoder=new TextDecoder('utf8');const parser=createParser({onEvent:(event)=>{if(!event.data)return;options.onEvent?.(event);for(const chunk of event.data.split('\n'))options.onData(chunk);}});const read=():void=>{reader.read().then(({done:streamDone,value})=>{if(streamDone){finish();return;}parser.feed(decoder.decode(value,{stream:true}));read();}).catch((err)=>{if(request.signal.aborted){options.onAborted?.();return;}finish(err as Error);});};read();return response;};}
export interface StreamRequestOptions {functionUrl:string;requestBody:unknown;supabaseAnonKey:string;accessToken?:string;onData:(data:string)=>void;onMeta?:(payload:Record<string, unknown>)=>void;onComplete:()=>void;onError:(error:Error)=>void;signal?:AbortSignal;}
export async function sendStreamRequest(options:StreamRequestOptions):Promise<void>{const{functionUrl,requestBody,supabaseAnonKey,accessToken,onData,onMeta,onComplete,onError,signal}=options;const sseHook=createSSEHook({onData,onMeta,onCompleted:(err)=>(err?onError(err):onComplete()),onAborted:()=>console.log('Stream aborted')});try{await ky.post(functionUrl,{json:requestBody,headers:{...(accessToken?{Authorization:`Bearer ${accessToken}`}:{ }),apikey:supabaseAnonKey,'Content-Type':'application/json'},timeout:90_000,signal,hooks:{afterResponse:[sseHook]}});}catch(err){if(!signal?.aborted)onError(err as Error);}}
