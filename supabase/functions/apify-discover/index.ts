import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'};
const APIFY_BASE='https://api.apify.com/v2/acts';
const FB_ACTOR='lofomachines~facebook-groups-posts-search-scraper';
const TG_ACTOR='lofomachines~telegram-keyword-search-scraper';
const THREADS_ACTOR='bovi~threads-posts-scraper';
const json=(d:any,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...CORS,'Content-Type':'application/json'}});

Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS') return new Response('ok',{headers:CORS});
 try{
  const auth=req.headers.get('authorization')??'';
  const url=Deno.env.get('SUPABASE_URL')!, anon=Deno.env.get('SUPABASE_ANON_KEY')!, serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, token=Deno.env.get('APIFY_API_TOKEN')!;
  if(!token) return json({error:'APIFY_API_TOKEN not configured'},500);
  const body=await req.json().catch(()=>({})); const {propertyId,maxPerPlatform=25}=body;
  if(!propertyId) return json({error:'propertyId required'},400);
  const admin=createClient(url,serviceKey); const internal=auth.replace(/^Bearer\s+/i,'')===serviceKey; let uid:string|null=null;
  if(!internal){const uc=createClient(url,anon,{global:{headers:{Authorization:auth}}});const {data:{user}}=await uc.auth.getUser();if(!user)return json({error:'Unauthorized'},401);const {data:u}=await admin.from('users').select('id').eq('auth_id',user.id).maybeSingle();uid=u?.id||null;}
  const {data:p}=await admin.from('properties').select(`id,user_id,title,transaction_type,property_type,facts:property_facts!property_id(city,district,country_code,country,description,original_description)`).eq('id',propertyId).maybeSingle();
  if(!p||(!internal&&p.user_id!==uid)) return json({error:'Property not found'},404);
  const f=Array.isArray(p.facts)?p.facts[0]:p.facts;
  const supplied=Array.isArray(body.queries)?body.queries.filter((x:any)=>typeof x==='string'&&x.trim()):[];
  const keywords=[...new Set((supplied.length?supplied:fallbackQueries(p,f)).map((x:string)=>x.replace(/^site:\S+\s+/,'').trim()).filter(Boolean))].slice(0,18);
  const limit=Math.max(10,Math.min(40,Number(maxPerPlatform)||25));

  const jobs:any[]=[
   safe('facebook',()=>runActor(token,FB_ACTOR,{keywords:keywords.slice(0,10),maxPosts:limit,countryCode:String(f?.country_code||'ge').toLowerCase()})),
   safe('telegram',()=>runActor(token,TG_ACTOR,{mode:'keyword',keywords:keywords.slice(0,10),afterDate:'60 days',countryCode:String(f?.country_code||'ge').toLowerCase(),maxResultsPerKeyword:limit})),
   ...keywords.slice(0,4).map((keyword:string,i:number)=>safe(`threads_${i}`,()=>runActor(token,THREADS_ACTOR,{keyword})))
  ];
  const settled=await Promise.all(jobs);
  const fb=items(settled,'facebook'),tg=items(settled,'telegram'),threads=dedupe(settled.filter(x=>x.name.startsWith('threads_')).flatMap(x=>x.items||[]));
  const errors=settled.filter(x=>x.error).map(x=>({name:x.name,error:x.error}));
  const country=String(f?.country_code||'GE').toUpperCase();
  const fbSrc=await ensureSource(admin,'FACEBOOK','FACEBOOK_GROUP','APIFY_DISCOVERY_FACEBOOK','Facebook public group discovery','https://facebook.com/groups/',country);
  const tgSrc=await ensureSource(admin,'TELEGRAM','TELEGRAM_GROUP','APIFY_DISCOVERY_TELEGRAM','Telegram public discovery','https://t.me/',country);
  const thSrc=await ensureSource(admin,'OTHER','WEBSITE','APIFY_DISCOVERY_THREADS','Threads public discovery','https://threads.net/',country);
  const fs=await save(admin,fb,'FACEBOOK',fbSrc,(x:any)=>({id:x.post_url||x.facebookUrl||x.id,url:x.post_url||x.facebookUrl||x.url,text:x.text||x.message||x.post_text,author:x.author_name||x.authorName||x.user?.name,authorUrl:x.author_url||x.authorUrl,date:x.date||x.time||x.publishedAt}));
  const ts=await save(admin,tg,'TELEGRAM',tgSrc,(x:any)=>({id:x.id||x.message_id||x.messageId||x.source_url||x.url,url:x.source_url||x.post_url||x.messageUrl||x.url,text:x.text||x.message||x.content,author:x.source_name||x.author||x.channel_name||x.channelTitle,authorUrl:x.source_url||x.channelUrl,date:x.date||x.published_at||x.publishedAt}));
  const hs=await save(admin,threads,'OTHER',thSrc,(x:any)=>({id:x.post_id||x.id||x.code||x.url,url:x.post_url||x.url,text:x.text||x.caption||x.description,author:x.author_username||x.username,authorUrl:x.author_username?`https://threads.net/@${x.author_username}`:null,date:x.taken_at||x.timestamp||x.postedAt}));
  await admin.from('cost_events').insert([
   {provider:'APIFY',operation_type:'DISCOVER_FACEBOOK',source:'property-driven',market:country,units:fb.length,cost_usd:0,success:!errors.some(x=>x.name==='facebook'),cache_hit:false,property_id:propertyId},
   {provider:'APIFY',operation_type:'DISCOVER_TELEGRAM',source:'property-driven',market:country,units:tg.length,cost_usd:0,success:!errors.some(x=>x.name==='telegram'),cache_hit:false,property_id:propertyId},
   {provider:'APIFY',operation_type:'DISCOVER_THREADS',source:'property-driven',market:country,units:threads.length,cost_usd:0,success:!errors.some(x=>x.name.startsWith('threads_')),cache_hit:false,property_id:propertyId}
  ]);
  return json({success:true,keywords,facebook:{found:fb.length,...fs},telegram:{found:tg.length,...ts},threads:{found:threads.length,...hs},actorErrors:errors});
 }catch(e){return json({error:e instanceof Error?e.message:String(e)},500)}
});

function fallbackQueries(p:any,f:any){const city=f?.city||'';const type=String(p.property_type||'property').toLowerCase();const demand=p.transaction_type==='RENT'?'rent':'buy';return [`looking to ${demand} ${type} ${city}`,`need ${type} ${city}`,`ищу недвижимость ${city}`,`ვეძებ უძრავ ქონებას ${city}`,`${city} gayrimenkul arıyorum`,`أبحث عن عقار في ${city}`]}
async function safe(name:string,fn:()=>Promise<any[]>){try{return{name,items:await fn(),error:null}}catch(e){return{name,items:[],error:e instanceof Error?e.message:String(e)}}}
function items(r:any[],n:string){return r.find(x=>x.name===n)?.items||[]}
function dedupe(a:any[]){const s=new Set();return a.filter(x=>{const k=String(x.url||x.post_url||x.id||JSON.stringify(x).slice(0,150));if(s.has(k))return false;s.add(k);return true})}
async function runActor(token:string,actor:string,input:any){const r=await fetch(`${APIFY_BASE}/${actor}/run-sync-get-dataset-items?timeout=100&memory=512`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify(input),signal:AbortSignal.timeout(105000)});if(!r.ok)throw new Error(`${actor} ${r.status}: ${(await r.text()).slice(0,400)}`);const d=await r.json();return Array.isArray(d)?d:[]}
async function ensureSource(db:any,platform:string,type:string,ext:string,name:string,url:string,country:string){const {data:e}=await db.from('source_registry').select('id').eq('external_id',ext).maybeSingle();if(e?.id)return e.id;const {data,error}=await db.from('source_registry').insert({platform,source_type:type,external_id:ext,name,url,country_code:country,active:true,priority:80,quality_score:7,provider:'APIFY'}).select('id').single();if(error)throw error;return data.id}
async function save(db:any,arr:any[],platform:string,sourceId:string,map:(x:any)=>any){let inserted=0,skipped=0,filtered=0;for(const x of arr){const m=map(x),text=String(m.text||'').trim();if(text.length<20){filtered++;continue}const fp=await fingerprint(text);const {error}=await db.from('raw_signals').insert({source_id:sourceId,platform,external_id:String(m.id||m.url||fp),source_url:m.url||null,author_public_name:m.author||null,author_public_url:m.authorUrl||null,original_text:text,published_at:m.date||null,content_fingerprint:fp,provider:'APIFY',classification_status:'PENDING',mock_mode:false});if(error)skipped++;else inserted++}return{inserted,skipped,filtered}}
async function fingerprint(t:string){const b=new TextEncoder().encode(t.toLowerCase().replace(/\s+/g,' ').trim().slice(0,300));const h=await crypto.subtle.digest('SHA-256',b);return Array.from(new Uint8Array(h)).map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,32)}
