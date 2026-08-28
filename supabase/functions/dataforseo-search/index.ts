import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'};
const json=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...CORS,'Content-Type':'application/json'}});

serve(async(req)=>{
 if(req.method==='OPTIONS') return new Response('ok',{headers:CORS});
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
 try{
  const body=await req.json(); const {queryPackId,dryRun=false,propertyId}=body;
  let queries:string[]=Array.isArray(body.queries)?body.queries.filter((x:any)=>typeof x==='string'&&x.trim()).slice(0,20):[];
  let language=String(body.language||'en'),country=String(body.country||'GE').toUpperCase(),sourceLabel='property-driven'; let pack:any=null;
  if(queryPackId){const {data,error}=await db.from('query_packs').select('*').eq('id',queryPackId).maybeSingle();if(error||!data)return json({error:'QueryPack not found'},404);if(!data.active)return json({error:'QueryPack inactive'},400);pack=data;queries=Array.isArray(data.queries)?data.queries:[];language=data.language||language;country=data.country||country;sourceLabel=`query_pack:${queryPackId}`}
  if(!queries.length)return json({error:'No queries supplied'},400);
  const login=Deno.env.get('DATAFORSEO_LOGIN')||'',password=Deno.env.get('DATAFORSEO_PASSWORD')||'';if(!login||!password)return json({error:'DataForSEO not configured'},500);
  if(dryRun)return json({status:'CONFIGURED',queryCount:queries.length,language,country,dryRun:true});
  const tasks=queries.map(keyword=>({keyword,language_code:language,location_code:country==='GE'?21831:undefined,device:'desktop'}));
  const r=await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/advanced',{method:'POST',headers:{Authorization:`Basic ${btoa(`${login}:${password}`)}`,'Content-Type':'application/json'},body:JSON.stringify(tasks)});
  if(!r.ok)throw new Error(`DataForSEO ${r.status}: ${(await r.text()).slice(0,500)}`);const raw=await r.json();const results:any[]=[];
  for(const task of raw.tasks||[])for(const item of task.result?.[0]?.items||[])if(item.type==='organic')results.push({title:item.title||'',url:item.url||'',snippet:item.description||'',publishedAt:item.timestamp||null});
  const cost=(raw.tasks||[]).reduce((n:number,t:any)=>n+Number(t.cost||0),0);const sourceKey=`GOOGLE_SEARCH_${country}_${language}`;
  const {data:existing}=await db.from('source_registry').select('id').eq('external_id',sourceKey).maybeSingle();let sourceId=existing?.id||null;if(!sourceId){const {data:n}=await db.from('source_registry').insert({platform:'GOOGLE',source_type:'SEARCH_RESULT',external_id:sourceKey,name:`Google Search ${country}/${language}`,url:'https://google.com',country_code:country,language,provider:'DATAFORSEO',active:true,priority:80,quality_score:7}).select('id').maybeSingle();sourceId=n?.id||null}
  let inserted=0,skipped=0;for(const x of results){if(!x.title&&!x.snippet){skipped++;continue}const text=`${x.title}\n${x.snippet}`.trim(),fp=await fingerprint(text);const {error}=await db.from('raw_signals').insert({source_id:sourceId,platform:'GOOGLE',external_id:x.url||fp,source_url:x.url||null,original_text:text,language,published_at:x.publishedAt,content_fingerprint:fp,provider:'DATAFORSEO',classification_status:'PENDING',mock_mode:false});if(error)skipped++;else inserted++}
  await db.from('cost_events').insert({provider:'DATAFORSEO',operation_type:'SERP_SEARCH',source:sourceLabel,market:country,units:queries.length,cost_usd:cost,success:true,cache_hit:false,property_id:propertyId||null});if(pack)await db.from('query_packs').update({last_run_at:new Date().toISOString()}).eq('id',queryPackId);
  return json({success:true,status:'CONFIGURED',language,country,queryCount:queries.length,resultsFound:results.length,signalsInserted:inserted,signalsSkipped:skipped,costUsd:cost,provider:'DATAFORSEO'});
 }catch(e){return json({error:e instanceof Error?e.message:String(e)},500)}
});
async function fingerprint(t:string){const b=new TextEncoder().encode(t.toLowerCase().replace(/\s+/g,' ').trim().slice(0,200));const h=await crypto.subtle.digest('SHA-256',b);return Array.from(new Uint8Array(h)).slice(0,8).map(x=>x.toString(16).padStart(2,'0')).join('')}
