import {managedAdapters,type ManagedPortalAdapter} from './adapters.ts';
import {processManagedPortal,supabaseManagedQueue} from './worker.ts';
/** Hosted by the EXISTING JWT-protected publishing function. No customer-triggered execution. */
export async function handleManagedTick(req:Request,ctx:{expectedToken:string|undefined;createAdmin:()=>any;adapters?:ManagedPortalAdapter[]}){
 const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 if(req.method!=='POST'||req.headers.has('origin'))return reply({code:'WORKER_REQUEST_DENIED'},403);
 if(!ctx.expectedToken||!/^[A-Za-z0-9_-]{32,256}$/.test(ctx.expectedToken))return reply({code:'MANAGED_WORKER_DISABLED'},503);
 const supplied=req.headers.get('x-publishing-worker-token')||'';
 if(!/^[A-Za-z0-9_-]{32,256}$/.test(supplied)||!req.headers.get('authorization')?.startsWith('Bearer '))return reply({code:'WORKER_AUTH_REQUIRED'},403);
 const digest=async(s:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
 const [expected,actual]=await Promise.all([digest(ctx.expectedToken),digest(supplied)]);let difference=0;
 for(let i=0;i<expected.length;i++)difference|=expected[i]^actual[i];
 if(difference!==0)return reply({code:'WORKER_AUTH_REQUIRED'},403);
 try{
  if(Number(req.headers.get('content-length'))>1024)return reply({code:'PAYLOAD_TOO_LARGE'},413);
  const reader=req.body?.getReader();let text='',bytes=0;
  if(reader){try{for(;;){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.length;if(bytes>1024)return reply({code:'PAYLOAD_TOO_LARGE'},413);text+=new TextDecoder().decode(chunk.value);}}finally{await reader.cancel();}}
  const payload=JSON.parse(text);
  if(!payload||payload.url!=='/v2/worker/tick'||Object.keys(payload).some(k=>!['url','body'].includes(k))||payload.body&&Object.keys(payload.body).length)return reply({code:'COMMAND_NOT_ALLOWED'},403);
  const admin=ctx.createAdmin(),queue=supabaseManagedQueue(admin),signal=AbortSignal.timeout(90000);
  const scheduled=await admin.rpc('publishing_engine_schedule_managed',{p_limit:100});if(scheduled.error)throw Error('QUEUE_REQUEST_FAILED');
  const results=[];
  for(const adapter of ctx.adapters||managedAdapters){try{results.push(await processManagedPortal(queue,adapter,signal));}catch{results.push({portalId:adapter.id,status:'FAILED',code:'MANAGED_WORKER_FAILED'});}}
  return reply({execution:'MANAGED_HTTP',results});
 }catch{return reply({code:'MANAGED_WORKER_FAILED'},500);}
}
