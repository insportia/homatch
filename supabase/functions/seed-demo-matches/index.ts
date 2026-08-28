import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'};
const json=(data:any,status=200)=>new Response(JSON.stringify(data),{status,headers:{...CORS,'Content-Type':'application/json'}});

async function invokeInternal(baseUrl:string,serviceKey:string,fn:string,body:any){
  const res=await fetch(`${baseUrl}/functions/v1/${fn}`,{method:'POST',headers:{Authorization:`Bearer ${serviceKey}`,apikey:serviceKey,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});
  const text=await res.text(); let data:any={}; try{data=JSON.parse(text)}catch{data={raw:text}};
  if(!res.ok) throw new Error(`${fn} failed (${res.status}): ${data?.error??text}`);
  return data;
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:CORS});
  const url=Deno.env.get('SUPABASE_URL')??'';
  const anon=Deno.env.get('SUPABASE_ANON_KEY')??'';
  const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
  const authHeader=req.headers.get('authorization')??'';
  try{
    const userClient=createClient(url,anon,{global:{headers:{Authorization:authHeader}}});
    const {data:{user}}=await userClient.auth.getUser();
    if(!user) return json({error:'Unauthorized'},401);
    const admin=createClient(url,serviceKey);
    const {propertyId}=await req.json();
    if(!propertyId) return json({error:'propertyId is required'},400);
    const {data:dbUser}=await admin.from('users').select('id').eq('auth_id',user.id).maybeSingle();
    if(!dbUser) return json({error:'Homatch user not found'},403);
    const {data:property}=await admin.from('properties').select('id,user_id,transaction_type,property_type,matching_status,facts:property_facts!property_id(city,district,country,total_price,currency,area,bedrooms)').eq('id',propertyId).eq('user_id',dbUser.id).eq('is_deleted',false).maybeSingle();
    if(!property) return json({error:'Property not found'},404);
    const facts=Array.isArray(property.facts)?property.facts[0]:property.facts;
    const city=facts?.city??'Tbilisi'; const country=facts?.country??'GE';

    let {data:campaign}=await admin.from('matching_campaigns').select('id').eq('property_id',propertyId).maybeSingle();
    if(campaign?.id){ await admin.from('matching_campaigns').update({status:'ACTIVE',status_v2:'ACTIVE'}).eq('id',campaign.id); }
    else { const c=await admin.from('matching_campaigns').insert({property_id:propertyId,user_id:dbUser.id,status:'ACTIVE',status_v2:'ACTIVE'}).select('id').single(); if(c.error) throw c.error; campaign=c.data; }
    await admin.from('properties').update({matching_status:'ACTIVE'}).eq('id',propertyId);

    const {data:packs}=await admin.from('query_packs').select('id,language').eq('country',country).eq('city',city).eq('active',true).order('priority',{ascending:false}).limit(12);
    const searchRuns:any[]=[];
    for(const p of packs??[]){
      try{ searchRuns.push({...await invokeInternal(url,serviceKey,'dataforseo-search',{queryPackId:p.id}),language:p.language}); }
      catch(e){ searchRuns.push({language:p.language,error:String(e)}); }
    }

    let apify:any={};
    try{ apify=await invokeInternal(url,serviceKey,'apify-discover',{propertyId,maxPerPlatform:15}); }
    catch(e){ apify={error:String(e)}; }

    const classified=await invokeInternal(url,serviceKey,'classify-signals',{batchSize:100,market:country});
    const matched=await invokeInternal(url,serviceKey,'run-matching',{propertyId,campaignId:campaign.id,intentProfileBatchSize:150});

    const dfsFound=searchRuns.reduce((s,r)=>s+Number(r?.resultsFound??0),0);
    const dfsInserted=searchRuns.reduce((s,r)=>s+Number(r?.signalsInserted??0),0);
    const apifyInserted=Number(apify?.facebook?.inserted??0)+Number(apify?.telegram?.inserted??0);
    await admin.from('activity_events').insert({user_id:dbUser.id,property_id:propertyId,event_type:'MATCHING_STARTED',metadata:{mode:'REAL',query_packs:(packs??[]).length,dataforseo_results:dfsFound,dataforseo_signals:dfsInserted,apify_facebook_found:apify?.facebook?.found??0,apify_telegram_found:apify?.telegram?.found??0,apify_signals:apifyInserted,classified:classified?.classified??0,matches_created:matched?.matchesCreated??0}});

    return json({success:true,real:true,seeded:Number(matched?.matchesCreated??0),campaignId:campaign.id,queryPacksRun:(packs??[]).length,searchResultsFound:dfsFound,dataforseoSignalsInserted:dfsInserted,apify,classified:Number(classified?.classified??0),filteredOut:Number(classified?.filteredOut??0),classificationErrors:Number(classified?.errors??0),matchesCreated:Number(matched?.matchesCreated??0),matchesSkipped:Number(matched?.matchesSkipped??0)});
  }catch(err){console.error('[start-real-matching]',err);return json({error:err instanceof Error?err.message:String(err)},500)}
});
