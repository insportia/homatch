import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'};
const json=(d:any,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...CORS,'Content-Type':'application/json'}});
const APIFY='https://api.apify.com/v2/acts';

Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:CORS});
 const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,db=createClient(url,key);
 try{
  const auth=req.headers.get('authorization')||''; if(auth.replace(/^Bearer\s+/i,'')!==key)return json({error:'Internal only'},403);
  const {propertyId,maxWebQueries=90,maxFacebookGroups=2500}=await req.json(); if(!propertyId)return json({error:'propertyId required'},400);
  const {data:p}=await db.from('properties').select(`id,transaction_type,property_type,title,facts:property_facts!property_id(country,country_code,city,district,neighborhood,description,original_description)`).eq('id',propertyId).maybeSingle(); if(!p)return json({error:'Property not found'},404);
  const f=Array.isArray(p.facts)?p.facts[0]:p.facts; const country=String(f?.country_code||f?.country||'GE').toUpperCase(); const city=String(f?.city||'Tbilisi'); const district=String(f?.district||'');
  const roots=rootsFor(String(p.transaction_type||''),String(p.property_type||'PROPERTY'),city,district);
  const siteQueries=buildSiteQueries(roots).slice(0,Math.min(120,Math.max(30,Number(maxWebQueries)||90)));
  const serp=await runDataForSeo(siteQueries,country);
  let inserted=0,duplicates=0; const platforms:Record<string,number>={};
  for(const r of serp.results){const c=classify(r.url);if(!c)continue;const u=canonical(r.url,c.platform);if(!u)continue;const ok=await saveSource(db,c.platform,c.type,u,r.title||u,country,'DATAFORSEO_DISCOVERY');if(ok){inserted++;platforms[c.platform]=(platforms[c.platform]||0)+1}else duplicates++;}

  let fbFound=0,fbInserted=0,fbError:string|null=null;
  try{
   const token=Deno.env.get('APIFY_API_TOKEN')!; if(token){
    const kws=[...new Set(roots.map(x=>x.replace(/^site:\S+\s+/,'').trim()))].slice(0,40);
    const per=Math.max(10,Math.min(500,Math.ceil(Number(maxFacebookGroups||2500)/Math.max(1,kws.length))));
    const items=await runActor(token,'scraper-engine~facebook-groups-search-scraper',{startUrls:kws,maxItems:per,proxyConfiguration:{useApifyProxy:false}},165000);
    fbFound=items.length;
    for(const x of items){const u=canonical(x.url||x.groupUrl||'','FACEBOOK');if(!u)continue;const ok=await saveSource(db,'FACEBOOK','FACEBOOK_GROUP',u,x.name||x.groupName||u,country,'APIFY_GROUP_DISCOVERY');if(ok)fbInserted++;}
   }
  }catch(e){fbError=e instanceof Error?e.message:String(e)}
  await db.from('cost_events').insert([{provider:'DATAFORSEO',operation_type:'SOURCE_DISCOVERY_MASSIVE',source:`public-web results=${serp.results.length} inserted=${inserted}`,market:country,units:siteQueries.length,cost_usd:serp.cost,success:true,cache_hit:false,property_id:propertyId},{provider:'APIFY',operation_type:'FACEBOOK_GROUP_DISCOVERY',source:fbError?`error:${fbError.slice(0,180)}`:`found=${fbFound} inserted=${fbInserted}`,market:country,units:fbFound,cost_usd:0,success:!fbError,cache_hit:false,property_id:propertyId}]);
  return json({success:true,roots:roots.length,webQueries:siteQueries.length,webResults:serp.results.length,sourcesInserted:inserted,duplicates,platforms,facebook:{found:fbFound,inserted:fbInserted,error:fbError}});
 }catch(e){return json({error:e instanceof Error?e.message:String(e)},500)}
});

function rootsFor(tx:string,pt:string,city:string,district:string){
 const type=pt.toLowerCase(),loc=[district,city].filter(Boolean).join(' '); const buy=tx==='RENT'?'rent':'buy';
 const a=[`looking for ${type} ${loc}`,`want to ${buy} ${type} ${loc}`,`need ${type} ${loc}`,`real estate buyers ${city}`,`property investors ${city}`,`expats ${city} real estate`,`property wanted ${city}`,`housing wanted ${city}`,`relocating to ${city}`,
  `ищу ${type} ${loc}`,`хочу купить недвижимость ${city}`,`сниму недвижимость ${city}`,`инвесторы недвижимость ${city}`,`русские ${city} недвижимость`,`недвижимость нужна ${city}`,`переезд ${city} квартира`,
  `ვეძებ უძრავ ქონებას ${city}`,`ვიყიდი ${type} ${city}`,`ვიქირავებ ${type} ${city}`,`ინვესტორი უძრავი ქონება ${city}`,`ბინა მინდა ${city}`,
  `${city} gayrimenkul arıyorum`,`${city} ev almak istiyorum`,`${city} kiralık arıyorum`,`${city} yatırım gayrimenkul`,`${city} taşınmak ev arıyorum`,
  `أبحث عن عقار ${city}`,`أريد شراء عقار ${city}`,`أريد استئجار عقار ${city}`,`مستثمر عقاري ${city}`,`الانتقال إلى ${city} سكن`,
  `מחפש נדלן ${city}`,`רוצה לקנות דירה ${city}`,`רוצה לשכור דירה ${city}`,`השקעות נדלן ${city}`,`עובר ל${city} מחפש דירה`,
  `${city} apartments`,`${city} property`,`${city} real estate`,`${city} expats`,`${city} investors`,`${city} relocation`,`${city} rent`,`${city} buy property`,`${city} property wanted`,`${city} housing group`]; return [...new Set(a.map(x=>x.replace(/\s+/g,' ').trim()))];
}
function buildSiteQueries(r:string[]){const sites=['site:facebook.com/groups','site:t.me','site:vk.com','site:reddit.com/r','site:threads.net','site:instagram.com','site:quora.com'];const out:string[]=[];for(const q of r)for(const s of sites)out.push(`${s} ${q}`);return out}
async function runDataForSeo(qs:string[],country:string){const login=Deno.env.get('DATAFORSEO_LOGIN')!,pass=Deno.env.get('DATAFORSEO_PASSWORD')!;const all:any[]=[];let cost=0;for(let i=0;i<qs.length;i+=20){const tasks=qs.slice(i,i+20).map(keyword=>({keyword,language_code:'en',location_code:country==='GE'?21831:undefined,device:'desktop'}));const r=await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/advanced',{method:'POST',headers:{Authorization:`Basic ${btoa(`${login}:${pass}`)}`,'Content-Type':'application/json'},body:JSON.stringify(tasks)});if(!r.ok)throw new Error(`DataForSEO ${r.status}`);const d=await r.json();for(const t of d.tasks||[]){cost+=Number(t.cost||0);for(const x of t.result?.[0]?.items||[])if(x.type==='organic'&&x.url)all.push({url:x.url,title:x.title||''})}}return{results:all,cost}}
async function runActor(token:string,actor:string,input:any,timeout=120000){const r=await fetch(`${APIFY}/${actor}/run-sync-get-dataset-items?timeout=${Math.floor(timeout/1000)-5}&memory=512`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(timeout)});if(!r.ok)throw new Error(`${actor} ${r.status}: ${(await r.text()).slice(0,300)}`);const d=await r.json();return Array.isArray(d)?d:[]}
function classify(u:string){try{const h=new URL(u).hostname.replace(/^www\./,'');if(h.includes('facebook.com')&&u.includes('/groups/'))return{platform:'FACEBOOK',type:'FACEBOOK_GROUP'};if(h==='t.me'||h.endsWith('.t.me'))return{platform:'TELEGRAM',type:'TELEGRAM_GROUP'};if(h.includes('vk.com'))return{platform:'VK',type:'VK_COMMUNITY'};if(h.includes('reddit.com'))return{platform:'FORUM',type:'FORUM'};if(h.includes('instagram.com'))return{platform:'INSTAGRAM',type:'INSTAGRAM_PROFILE'};if(h.includes('threads.net'))return{platform:'OTHER',type:'WEBSITE'};if(h.includes('quora.com'))return{platform:'FORUM',type:'FORUM'};return null}catch{return null}}
function canonical(u:string,p:string){try{const x=new URL(u);x.search='';x.hash='';if(p==='FACEBOOK'){const m=x.pathname.match(/\/groups\/([^/]+)/);return m?`https://www.facebook.com/groups/${m[1]}/`:null}if(p==='TELEGRAM'){const seg=x.pathname.split('/').filter(Boolean);return seg[0]?`https://t.me/${seg[0]}`:null}if(p==='VK')return `https://vk.com/${x.pathname.split('/').filter(Boolean)[0]||''}`;if(p==='FORUM'&&x.hostname.includes('reddit.com')){const m=x.pathname.match(/\/r\/([^/]+)/);return m?`https://www.reddit.com/r/${m[1]}/`:null}return `${x.origin}${x.pathname}`.replace(/\/$/,'')}catch{return null}}
async function saveSource(db:any,platform:string,type:string,url:string,name:string,country:string,provider:string){const {data:e}=await db.from('source_registry').select('id').eq('url',url).maybeSingle();if(e?.id)return false;const {error}=await db.from('source_registry').insert({platform,source_type:type,url,external_id:url,name:String(name).slice(0,240),country_code:country,active:true,priority:70,quality_score:6,provider});return !error}
