import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const cors={
 'Access-Control-Allow-Origin':'*',
 'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
 'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}});
const WORKER_URL='https://homatch-official-worker-production.up.railway.app';

Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});
 if(req.method!=='POST')return json({error:'method_not_allowed'},405);
 const workerToken=Deno.env.get('OFFICIAL_WORKER_TOKEN')||Deno.env.get('WORKER_TOKEN')||'';
 if(!workerToken)return json({error:'official_worker_not_configured'},503);
 let body:any;try{body=await req.json()}catch{return json({error:'invalid_json'},400)}
 const jobId=String(body?.jobId||'').trim();
 if(!/^[0-9a-f-]{36}$/i.test(jobId))return json({error:'invalid_job_id'},400);
 const action=String(body?.action||'screenshot');
 let path=`/research/${encodeURIComponent(jobId)}/screenshot`,method='GET',payload:unknown=undefined;
 if(action==='input'){
   const type=String(body?.type||'');
   if(!['click','type','key','scroll'].includes(type))return json({error:'unsupported_action'},400);
   path=`/research/${encodeURIComponent(jobId)}/action`;method='POST';
   payload=type==='click'?{type,x:Number(body?.x),y:Number(body?.y)}:type==='type'?{type,text:String(body?.text||'').slice(0,500)}:type==='key'?{type,key:String(body?.key||'Enter')}:{type,dy:Number(body?.dy)||0};
 }else if(action==='resume'){
   path=`/research/${encodeURIComponent(jobId)}/resume`;method='POST';payload={humanVerificationCompleted:true};
 }else if(action!=='screenshot')return json({error:'unsupported_action'},400);
 try{
   const r=await fetch(`${WORKER_URL}${path}`,{method,headers:{Authorization:`Bearer ${workerToken}`,'Content-Type':'application/json'},body:payload?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(15000)});
   const text=await r.text();let data:any;try{data=JSON.parse(text)}catch{data={error:text.slice(0,500)}}
   return json(data,r.status);
 }catch(e){return json({error:'official_worker_unreachable',detail:String(e)},502)}
});
