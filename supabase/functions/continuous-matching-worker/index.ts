import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-cron-token'};
const json=(d:any,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...CORS,'Content-Type':'application/json'}});

Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:CORS});
 const base=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,db=createClient(base,key);
 try{
  const token=req.headers.get('x-cron-token')||'';const {data:setting}=await db.from('admin_settings').select('value').eq('key','continuous_worker_token').maybeSingle();const expected=typeof setting?.value==='string'?setting.value:String(setting?.value||'').replace(/^"|"$/g,'');if(!expected||token!==expected)return json({error:'Forbidden'},403);
  const task=run(db,base,key);
  // @ts-ignore Supabase EdgeRuntime background execution
  EdgeRuntime.waitUntil(task);
  return json({success:true,started:true});
 }catch(e){return json({error:e instanceof Error?e.message:String(e)},500)}
});

async function run(db:any,base:string,key:string){
 const {data:camps}=await db.from('matching_campaigns').select(`id,property_id,status,status_v2,property:properties!property_id(id,matching_status,facts:property_facts!property_id(country,country_code))`).eq('status','ACTIVE');
 for(const c of camps||[]){try{
   const p=Array.isArray(c.property)?c.property[0]:c.property; if(!p||p.matching_status!=='ACTIVE')continue;const f=Array.isArray(p.facts)?p.facts[0]:p.facts;const country=String(f?.country_code||f?.country||'GE').toUpperCase();
   const sixHoursAgo=new Date(Date.now()-6*3600_000).toISOString();
   const {data:lastDiscovery}=await db.from('cost_events').select('id').eq('property_id',c.property_id).eq('operation_type','SOURCE_DISCOVERY_MASSIVE').gte('timestamp',sixHoursAgo).limit(1).maybeSingle();
   if(!lastDiscovery){try{await invoke(base,key,'source-discovery-massive',{propertyId:c.property_id,maxWebQueries:90,maxFacebookGroups:1500},165000)}catch(e){console.error('source discovery',c.property_id,e)}}
   try{await invoke(base,key,'source-monitor-public',{propertyId:c.property_id,country,maxSources:8,postsPerSource:5},165000)}catch(e){console.error('source monitor',c.property_id,e)}
   const {data:lastSocial}=await db.from('cost_events').select('id').eq('property_id',c.property_id).eq('operation_type','DISCOVER_TELEGRAM').gte('timestamp',sixHoursAgo).limit(1).maybeSingle();
   if(!lastSocial){try{await invoke(base,key,'apify-discover',{propertyId:c.property_id,maxPerPlatform:10},120000)}catch(e){console.error('social discovery',c.property_id,e)}}
   try{await invoke(base,key,'classify-signals-v2',{batchSize:500,market:country},120000)}catch(e){console.error('classify',e)}
   try{const m=await invoke(base,key,'run-matching-v2',{propertyId:c.property_id,campaignId:c.id,intentProfileBatchSize:1000},120000);if(Number(m?.matchesCreated||0)>0)await db.from('notifications').insert({user_id:(await db.from('properties').select('user_id').eq('id',c.property_id).single()).data?.user_id,type:'MATCH_FOUND',title:`${m.matchesCreated} new match${Number(m.matchesCreated)===1?'':'es'}`,body:`Best match score ${m.bestScore||0}%`,property_id:c.property_id,metadata:{continuous:true,buckets:m.buckets||{}}})}catch(e){console.error('matching',e)}
  }catch(e){console.error('campaign worker',c.id,e)}}
}
async function invoke(base:string,key:string,fn:string,body:any,timeout:number){const r=await fetch(`${base}/functions/v1/${fn}`,{method:'POST',headers:{Authorization:`Bearer ${key}`,apikey:key,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});const t=await r.text();let d:any={};try{d=JSON.parse(t)}catch{d={raw:t}}if(!r.ok)throw new Error(`${fn} ${r.status}: ${d?.error||t}`);return d}
