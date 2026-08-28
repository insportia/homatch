import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
};

const APIFY_BASE='https://api.apify.com/v2/acts';
const FB_ACTOR='lofomachines~facebook-groups-posts-search-scraper';
const TG_ACTOR='lofomachines~telegram-keyword-search-scraper';

Deno.serve(async (req:Request)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:CORS});
  try{
    const auth=req.headers.get('Authorization')??'';
    const supabaseUrl=Deno.env.get('SUPABASE_URL')!;
    const anon=Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const apifyToken=Deno.env.get('APIFY_API_TOKEN')!;
    if(!apifyToken) return json({error:'APIFY_API_TOKEN not configured'},500);

    const {propertyId,maxPerPlatform=30}=await req.json().catch(()=>({}));
    if(!propertyId) return json({error:'propertyId required'},400);

    const admin=createClient(supabaseUrl,serviceKey);
    const bearer=auth.replace(/^Bearer\s+/i,'');
    const isInternal=bearer===serviceKey;
    let homatchUserId:string|null=null;

    if(!isInternal){
      const userClient=createClient(supabaseUrl,anon,{global:{headers:{Authorization:auth}}});
      const {data:{user}}=await userClient.auth.getUser();
      if(!user) return json({error:'Unauthorized'},401);
      const {data:homatchUser}=await admin.from('users').select('id').eq('auth_id',user.id).maybeSingle();
      if(!homatchUser) return json({error:'Homatch user not found'},403);
      homatchUserId=homatchUser.id;
    }

    const {data:prop}=await admin.from('properties')
      .select('id,user_id,title,transaction_type,property_type,property_facts(city,district,country,bedrooms,total_price,currency)')
      .eq('id',propertyId).maybeSingle();
    if(!prop) return json({error:'Property not found'},404);
    if(!isInternal && prop.user_id!==homatchUserId) return json({error:'Property not found'},404);

    const facts=Array.isArray(prop.property_facts)?prop.property_facts[0]:prop.property_facts;
    const city=facts?.city||'Tbilisi';
    const district=facts?.district||'';
    const keywords=buildBuyerIntentQueries(city,district);
    const limit=Math.max(10,Math.min(50,Number(maxPerPlatform)||30));

    const settled=await Promise.all([
      safeActor('facebook',()=>runActor(apifyToken,FB_ACTOR,{keywords:keywords.slice(0,10),maxPosts:limit,countryCode:'ge'})),
      safeActor('telegram',()=>runActor(apifyToken,TG_ACTOR,{mode:'keyword',keywords:keywords.slice(0,10),afterDate:'30 days',countryCode:'ge',maxResultsPerKeyword:limit})),
    ]);

    const fb=itemsFrom(settled,'facebook');
    const tg=itemsFrom(settled,'telegram');
    const errors=settled.filter(x=>x.error).map(x=>({name:x.name,error:x.error}));

    const fbSource=await ensureSource(admin,'FACEBOOK','FACEBOOK_GROUP','APIFY_DISCOVERY_FACEBOOK','Facebook public groups discovery','https://www.facebook.com/groups/');
    const tgSource=await ensureSource(admin,'TELEGRAM','TELEGRAM_GROUP','APIFY_DISCOVERY_TELEGRAM','Telegram public discovery','https://t.me/');

    const fbStats=await saveItems(admin,fb,'FACEBOOK',fbSource,(x:any)=>({
      externalId:String(x.post_url||x.facebookUrl||x.id||''),
      sourceUrl:String(x.post_url||x.facebookUrl||x.url||''),
      text:String(x.text||x.message||x.post_text||''),
      authorName:String(x.author_name||x.authorName||x.user?.name||''),
      authorUrl:String(x.author_url||x.authorUrl||''),
      publishedAt:x.date||x.time||x.publishedAt||null,
    }));

    const tgStats=await saveItems(admin,tg,'TELEGRAM',tgSource,(x:any)=>({
      externalId:String(x.id||x.message_id||x.messageId||x.source_url||x.url||''),
      sourceUrl:String(x.source_url||x.post_url||x.messageUrl||x.url||''),
      text:String(x.text||x.message||x.content||''),
      authorName:String(x.source_name||x.author||x.channel_name||x.channelTitle||''),
      authorUrl:String(x.source_url||x.channelUrl||''),
      publishedAt:x.date||x.published_at||x.publishedAt||null,
    }));

    await admin.from('cost_events').insert([
      {provider:'APIFY',operation_type:'DISCOVER_FACEBOOK',source:'keyword-discovery',market:'GE',units:fb.length,cost_usd:0,success:!errors.some(x=>x.name==='facebook'),cache_hit:false,property_id:propertyId},
      {provider:'APIFY',operation_type:'DISCOVER_TELEGRAM',source:'keyword-discovery',market:'GE',units:tg.length,cost_usd:0,success:!errors.some(x=>x.name==='telegram'),cache_hit:false,property_id:propertyId},
    ]);

    return json({success:true,internal:isInternal,keywords,facebook:{found:fb.length,...fbStats},telegram:{found:tg.length,...tgStats},actorErrors:errors});
  }catch(e){
    console.error('apify-discover',e);
    return json({error:e instanceof Error?e.message:String(e)},500);
  }
});

function buildBuyerIntentQueries(city:string,district:string){
  const loc=[district,city].filter(Boolean).join(' ');
  return [
    `looking to buy apartment ${city}`,
    `looking for apartment ${city}`,
    `want to buy property ${city}`,
    `ищу квартиру ${city}`,
    `куплю квартиру ${city}`,
    `хочу купить квартиру ${loc}`,
    `ვეძებ ბინას ${city}`,
    `ვიყიდი ბინას ${city}`,
    `${city} daire satın almak istiyorum`,
    `أبحث عن شقة للشراء في ${city}`,
  ];
}

async function safeActor(name:string,fn:()=>Promise<any[]>){
  try{return {name,items:await fn(),error:null}}catch(e){
    const error=e instanceof Error?e.message:String(e);
    console.error('Apify actor failed',name,error);
    return {name,items:[],error};
  }
}
function itemsFrom(results:any[],name:string){return results.find(x=>x.name===name)?.items||[]}

async function runActor(token:string,actor:string,input:any){
  const r=await fetch(`${APIFY_BASE}/${actor}/run-sync-get-dataset-items?timeout=100&memory=512`,{
    method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify(input),signal:AbortSignal.timeout(105000)
  });
  if(!r.ok) throw new Error(`Apify ${actor} failed ${r.status}: ${(await r.text()).slice(0,700)}`);
  const data=await r.json();
  return Array.isArray(data)?data:[];
}

async function ensureSource(admin:any,platform:string,sourceType:string,externalId:string,name:string,url:string){
  const {data:existing}=await admin.from('source_registry').select('id').eq('external_id',externalId).maybeSingle();
  if(existing?.id) return existing.id;
  const {data,error}=await admin.from('source_registry').insert({platform,source_type:sourceType,external_id:externalId,name,url,country_code:'GE',language:null,active:true,priority:80,quality_score:7,provider:'APIFY'}).select('id').single();
  if(error) throw error;
  return data.id;
}

async function saveItems(admin:any,items:any[],platform:string,sourceId:string,map:(x:any)=>any){
  let inserted=0,skipped=0,filtered=0;
  for(const item of items){
    const m=map(item); const text=(m.text||'').trim();
    if(text.length<20){filtered++;continue;}
    const fp=await fingerprint(text);
    const {error}=await admin.from('raw_signals').insert({source_id:sourceId,platform,external_id:m.externalId||m.sourceUrl||fp,source_url:m.sourceUrl||null,author_public_name:m.authorName||null,author_public_url:m.authorUrl||null,original_text:text,language:null,published_at:m.publishedAt||null,content_fingerprint:fp,provider:'APIFY',classification_status:'PENDING',mock_mode:false});
    if(error?.code==='23505') skipped++; else if(error){console.error('raw_signal insert',error);skipped++;} else inserted++;
  }
  return {inserted,skipped,filtered};
}

async function fingerprint(text:string){
  const bytes=new TextEncoder().encode(text.toLowerCase().replace(/\s+/g,' ').trim().slice(0,300));
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,32);
}
function json(data:any,status=200){return new Response(JSON.stringify(data),{status,headers:{...CORS,'Content-Type':'application/json'}})}
