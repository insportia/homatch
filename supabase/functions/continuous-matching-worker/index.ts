import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-cron-token'};
const json=(d:any,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...CORS,'Content-Type':'application/json'}});
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:CORS});
  const base=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,db=createClient(base,key);
  try{
    const token=req.headers.get('x-cron-token')||'';
    const {data:setting}=await db.from('admin_settings').select('value').eq('key','continuous_worker_token').maybeSingle();
    const expected=typeof setting?.value==='string'?setting.value:String(setting?.value||'').replace(/^\"|\"$/g,'');
    if(!expected||token!==expected)return json({error:'Forbidden'},403);
    EdgeRuntime.waitUntil(run(db,base,key));
    return json({success:true,started:true,paidDiscovery:false});
  }catch(e){return json({error:e instanceof Error?e.message:String(e)},500)}
});
async function run(db:any,base:string,key:string){
  const {data:camps}=await db.from('matching_campaigns').select(`id,property_id,status,status_v2,property:properties!property_id(id,matching_status,facts:property_facts!property_id(country,country_code))`).eq('status','ACTIVE');
  for(const c of camps||[]){
    try{
      const p=Array.isArray(c.property)?c.property[0]:c.property;
      if(!p||p.matching_status!=='ACTIVE')continue;
      const f=Array.isArray(p.facts)?p.facts[0]:p.facts,country=String(f?.country_code||f?.country||'GE').toUpperCase();
      try{await invoke(base,key,'classify-signals-v2',{batchSize:500,market:country},150000)}catch(e){console.error('classify',e)}
      try{await invoke(base,key,'run-matching-v2',{propertyId:c.property_id,campaignId:c.id,intentProfileBatchSize:1500},150000)}catch(e){console.error('match',e)}
    }catch(e){console.error('campaign',e)}
  }
}
async function invoke(base:string,key:string,fn:string,body:any,timeout:number){
  const r=await fetch(`${base}/functions/v1/${fn}`,{method:'POST',headers:{Authorization:`Bearer ${key}`,apikey:key,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});
  const t=await r.text();let d:any={};try{d=JSON.parse(t)}catch{d={raw:t}}if(!r.ok)throw new Error(`${fn} ${r.status}: ${d?.error||t}`);return d;
}
