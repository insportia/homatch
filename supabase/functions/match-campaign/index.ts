// ============================================================
// HOMATCH — match-campaign Edge Function  (Orchestrator v2)
// STANDALONE: all shared modules inlined — no ../\_shared imports.
// Full pipeline: IntentProfile → QueryPacks → DataForSEO (Live)
//   → Apify (FB/TG/IG/VK async) → Normalise → Dedup → Filter
//   → OpenAI classify → Score → Match records
// Tier expansion: auto-advance when usable candidates < target.
// Spend-cap checked before every paid call.
// Job state machine: QUEUED → RUNNING → {COMPLETED|PARTIAL|FAILED}.
// All provider failures = source-level partial, not total failure.
// Schema: production ptxajsjhobhvsfhmutjn (verified 2026-08-29)
// ============================================================

import { createClient, SupabaseClient } from 'jsr:@supabase/supabase-js@2';

// ── INLINE: provider_types ────────────────────────────────────
interface PropertySnapshot {
  id: string; country: string; city?: string|null; district?: string|null;
  transaction_type?: string|null; property_type?: string|null;
  total_price?: number|null; currency?: string|null;
  area?: number|null; bedrooms?: number|null; condition?: string|null;
  new_build?: boolean; parking?: boolean; balcony?: boolean;
  elevator?: boolean; furnished?: boolean;
  campaign_id?: string|null; description?: string|null; amenities?: string[]|null;
}
interface IntentProfile {
  purposeCode: 'BUY'|'RENT'|'INVEST'|'RELOCATE_BUY'|'RELOCATE_RENT';
  market: string; city?: string|null; district?: string|null;
  nearbyAreas: string[]; priceMin?: number|null; priceMax?: number|null;
  currency: string; budgetBand: 'ULTRA_LOW'|'LOW'|'MID'|'HIGH'|'LUXURY';
  area?: number|null; bedroomsTarget?: number|null; propertyType?: string|null;
  condition?: string|null; amenities: string[]; investmentTraits: string[];
  languages: string[]; targetProfiles: string[]; negativeConstraints: string[];
  version: number; createdAt: string;
}
interface SearchQuery { q: string; language?: string; country?: string; tier?: number; }
interface SearchResult {
  title: string; url: string; canonicalUrl: string; snippet: string;
  publishedAt?: string|null; domain?: string; rankPosition?: number;
  tier?: number; queryText?: string; taskId?: string;
}
interface DFSEOTaskStatus { taskId: string; keyword: string; status: string; costUsd: number; payloadHash: string; }
interface SearchProviderResponse {
  results: SearchResult[]; taskStatuses: DFSEOTaskStatus[];
  costUsd: number; provider: string; cacheHit: boolean; mode: string; requestId?: string;
}
interface SocialPost {
  externalId: string; text: string; authorName?: string|null; authorUrl?: string|null;
  publishedAt?: string|null; sourceUrl?: string|null; platform: string;
  isGroupPost?: boolean; replyCount?: number; likeCount?: number;
}
interface ApifyRunMeta {
  runId: string; datasetId?: string|null;
  status: 'RUNNING'|'SUCCEEDED'|'FAILED'|'TIMED-OUT'|'ABORTED';
  computeUnits?: number; costUsd?: number|null; itemCount?: number|null;
  startedAt: string; finishedAt?: string|null;
}
interface SocialCollectRequest {
  platform: 'FACEBOOK'|'TELEGRAM'|'INSTAGRAM'|'VK';
  sourceUrl: string; sourceUrls?: string[]; externalId?: string;
  since?: string; maxItems?: number; existingRunId?: string; jobId?: string;
}
interface SocialCollectResponse {
  posts: SocialPost[]; runMeta: ApifyRunMeta;
  costUsd: number; provider: string; cacheHit: boolean; partial?: boolean;
}
interface AIClassifyRequest {
  text: string; language?: string; hint?: string;
  propertyContext?: { country: string; city?: string|null; transactionType?: string|null; };
}
interface AIIntentResult {
  intentType: string; country?: string|null; region?: string|null;
  city?: string|null; district?: string|null; neighborhoods?: string[]|null;
  transactionType?: string|null; propertyTypes?: string[]|null;
  bedroomsMin?: number|null; bedroomsMax?: number|null;
  areaMin?: number|null; areaMax?: number|null;
  budgetMin?: number|null; budgetMax?: number|null; currency?: string|null;
  timeline?: string|null; relocationIntent: boolean; investmentIntent: boolean;
  language?: string|null; intentConfidence: number; specificityScore: number;
  actionabilityScore: number; contactabilityScore: number; evidenceQualityScore: number;
  translatedText?: string|null; model: string; costUsd: number; promptVersion: string;
}
interface ScorerComponents {
  intent: number; geography: number; budget: number; compatibility: number;
  freshness: number; evidenceQuality: number; contactability: number;
  total: number; label: 'strong'|'good'|'exploratory'|'rejected'; rejectionReason?: string;
}
type SignalStrength = 'POTENTIAL'|'GOOD'|'STRONG'|'VERY_STRONG'|'EXCEPTIONAL';
interface NormalisedSignal {
  externalId: string; platform: string; sourceUrl: string; canonicalUrl: string;
  authorName?: string|null; authorUrl?: string|null; text: string;
  publishedAt?: string|null; fingerprint: string; isMock: boolean;
}
interface FilterResult { pass: boolean; reason?: string; }
interface QueryPack { tier: number; tierReason: string; language: string; queries: string[]; }

// ── INLINE: intent_profile ────────────────────────────────────
const INTENT_PROFILE_VERSION = 2;
const BUDGET_BANDS_USD: Array<{max:number;label:IntentProfile['budgetBand']}> = [
  {max:50_000,label:'ULTRA_LOW'},{max:120_000,label:'LOW'},
  {max:300_000,label:'MID'},{max:700_000,label:'HIGH'},{max:Infinity,label:'LUXURY'},
];
const APPROX_TO_USD: Record<string,number> = {
  USD:1,EUR:1.08,GBP:1.27,GEL:0.37,TRY:0.031,RUB:0.011,AED:0.27,ILS:0.27,
};
function toBandUSD(price:number,currency:string):number{
  return price*(APPROX_TO_USD[(currency??'USD').toUpperCase()]??1);
}
function budgetBand(usd:number):IntentProfile['budgetBand']{
  for(const{max,label}of BUDGET_BANDS_USD)if(usd<=max)return label;
  return 'LUXURY';
}
const NEARBY:Record<string,string[]>={
  tbilisi:['Vake','Saburtalo','Mtatsminda','Isani','Samgori','Gldani','Didi Dighomi','Ortachala','Avlabari','Nadzaladevi','Chugureti'],
  batumi:['Old Batumi','New Boulevard','Sheraton Area','Gonio'],
  kutaisi:['Central Kutaisi','Nikea','Ukimerioni'],
  istanbul:['Kadıköy','Beşiktaş','Şişli','Beyoğlu','Üsküdar','Bakırköy','Levent','Etiler'],
  tel_aviv:['Ramat Aviv','Florentine','Neve Tzedek','Jaffa','North TLV','Givat Shmuel'],
};
function nearbyAreas(city:string|null|undefined):string[]{
  if(!city)return [];
  return NEARBY[city.toLowerCase().replace(/\s+/g,'_')]??[];
}
function investmentTraits(snap:PropertySnapshot):string[]{
  const t:string[]=[];
  if(snap.new_build)t.push('new_build');
  if(snap.furnished)t.push('furnished');
  if(snap.elevator)t.push('elevator');
  if(snap.parking)t.push('parking');
  if(snap.transaction_type==='RENT')t.push('rental_income');
  const b=budgetBand(toBandUSD(snap.total_price??0,snap.currency??'USD'));
  if(b==='MID'||b==='HIGH')t.push('mid_range_investment');
  if(b==='LUXURY')t.push('premium_investment');
  return t;
}
function targetProfiles(snap:PropertySnapshot):string[]{
  const p:string[]=[],txn=snap.transaction_type?.toUpperCase(),beds=snap.bedrooms??0,area=snap.area??0;
  const band=budgetBand(toBandUSD(snap.total_price??0,snap.currency??'USD'));
  if(txn==='SALE'){
    p.push('buyer_end_user');
    if(band==='MID'||band==='HIGH')p.push('investor');
    if(snap.new_build)p.push('investor_new_build');
    p.push('relocating_professional');
    if(beds>=3)p.push('family_buyer');
    if(beds===1||area<60)p.push('single_professional');
  }
  if(txn==='RENT'){
    p.push('long_term_tenant','relocating_professional');
    if(beds>=3)p.push('family_tenant');
    if(snap.furnished)p.push('short_term_renter','expat');
    p.push('corporate_housing');
  }
  if(txn==='INVESTMENT'||snap.new_build)p.push('investor','developer');
  return[...new Set(p)];
}
function negativeConstraints(snap:PropertySnapshot):string[]{
  const n:string[]=[],txn=snap.transaction_type?.toUpperCase();
  if(txn==='SALE')n.push('is_seller','is_agent_ad','is_listing');
  if(txn==='RENT')n.push('is_landlord_post','is_rental_ad');
  n.push('spam','noise','irrelevant_country');
  return n;
}
const MARKET_LANGUAGES:Record<string,string[]>={
  GE:['ka','en','ru'],TR:['tr','en','ar'],IL:['he','en','ar','ru'],AE:['ar','en','ru'],DEFAULT:['en'],
};
function buildIntentProfile(snap:PropertySnapshot):IntentProfile{
  const usd=toBandUSD(snap.total_price??0,snap.currency??'USD');
  const band=budgetBand(usd);
  const tol=0.20;
  const priceMin=snap.total_price?Math.round(snap.total_price*(1-tol)):null;
  const priceMax=snap.total_price?Math.round(snap.total_price*(1+tol)):null;
  const purposeCode=(():IntentProfile['purposeCode']=>{
    const t=snap.transaction_type?.toUpperCase();
    if(t==='SALE')return 'BUY';
    if(t==='RENT')return 'RENT';
    if(t==='INVESTMENT')return 'INVEST';
    return 'BUY';
  })();
  const amenities:string[]=[];
  if(snap.parking)amenities.push('parking');
  if(snap.elevator)amenities.push('elevator');
  if(snap.balcony)amenities.push('balcony');
  if(snap.furnished)amenities.push('furnished');
  if(snap.amenities)amenities.push(...snap.amenities);
  return{
    purposeCode,market:snap.country?.toUpperCase()??'GE',city:snap.city,district:snap.district,
    nearbyAreas:nearbyAreas(snap.city),priceMin,priceMax,currency:snap.currency??'USD',
    budgetBand:band,area:snap.area,bedroomsTarget:snap.bedrooms,propertyType:snap.property_type,
    condition:snap.condition,amenities,investmentTraits:investmentTraits(snap),
    languages:MARKET_LANGUAGES[(snap.country??'GE').toUpperCase()]??MARKET_LANGUAGES.DEFAULT,
    targetProfiles:targetProfiles(snap),negativeConstraints:negativeConstraints(snap),
    version:INTENT_PROFILE_VERSION,createdAt:new Date().toISOString(),
  };
}

// ── INLINE: query_pack_generator ─────────────────────────────
const TBILISI_ALIASES:Record<string,string>={en:'Tbilisi',ka:'თბილისი',ru:'Тбилиси',tr:'Tiflis',ar:'تبليسي',he:'טביליסי'};
const BATUMI_ALIASES:Record<string,string>={en:'Batumi',ka:'ბათუმი',ru:'Батуми',tr:'Batum',ar:'باتومي',he:'בטומי'};
function cityAlias(city:string|null|undefined,lang:string):string{
  if(!city)return '';
  const c=city.toLowerCase();
  if(c.includes('tbilisi')||c.includes('თბილ'))return TBILISI_ALIASES[lang]??city;
  if(c.includes('batumi')||c.includes('ბათუ'))return BATUMI_ALIASES[lang]??city;
  return city;
}
interface PhraseSet{buy:string;rent:string;invest:string;lookingFor:string;budget:string;relocation:string;corporate:string;investor:string;}
const PHRASES:Record<string,PhraseSet>={
  en:{buy:'looking to buy',rent:'looking to rent',invest:'investment property wanted',lookingFor:'looking for apartment',budget:'budget',relocation:'relocating to',corporate:'corporate housing needed',investor:'investor seeking property'},
  ka:{buy:'ვიყიდი',rent:'ვიქირავებ',invest:'საინვესტიციო ბინა',lookingFor:'ვეძებ ბინას',budget:'ბიუჯეტი',relocation:'გადასვლა',corporate:'კორპორატიული საცხოვრებელი',investor:'ინვესტორი ეძებს ბინას'},
  ru:{buy:'куплю квартиру',rent:'сниму квартиру',invest:'инвестиционная недвижимость',lookingFor:'ищу квартиру',budget:'бюджет',relocation:'переезд в',corporate:'корпоративное жильё',investor:'инвестор ищет недвижимость'},
  tr:{buy:'daire satın almak istiyorum',rent:'daire kiralamak istiyorum',invest:'yatırım amaçlı daire',lookingFor:'daire arıyorum',budget:'bütçe',relocation:'taşınmak istiyorum',corporate:'kurumsal konut gerekli',investor:'yatırımcı daire arıyor'},
  ar:{buy:'أبحث عن شقة للشراء',rent:'أبحث عن شقة للإيجار',invest:'عقار استثماري مطلوب',lookingFor:'أبحث عن شقة',budget:'الميزانية',relocation:'الانتقال إلى',corporate:'سكن للشركات مطلوب',investor:'مستثمر يبحث عن عقار'},
  he:{buy:'מחפש דירה לקנייה',rent:'מחפש דירה להשכרה',invest:'נכס להשקעה מבוקש',lookingFor:'מחפש דירה',budget:'תקציב',relocation:'מעבר ל',corporate:'דיור עסקי נדרש',investor:'משקיע מחפש נכס'},
};
const PLATFORM_SCOPES:Record<string,string>={facebook:'site:facebook.com',telegram:'site:t.me',vk:'site:vk.com',forum:'site:forum.ge OR site:myhome.ge OR site:ss.ge'};
function bedroomsPhrase(lang:string,n:number):string{
  const m:Record<string,string>={en:`${n} bedroom`,ka:`${n}-ოთახიანი`,ru:`${n}-комнатная`,tr:`${n}+1`,ar:`${n} غرف نوم`,he:`${n} חדרים`};
  return m[lang]??`${n}BR`;
}
function budgetPhraseQP(lang:string,min:number|null,max:number|null,currency:string):string{
  if(!min&&!max)return '';
  const cur=currency?.toUpperCase()==='GEL'?'GEL':'$';
  const mn=min?`${cur}${Math.round(min/1000)}k`:'';
  const mx=max?`${cur}${Math.round(max/1000)}k`:'';
  const range=mn&&mx?`${mn}-${mx}`:mn||mx;
  return`${PHRASES[lang]?.budget??'budget'} ${range}`;
}
function ddQueries(queries:string[]):string[]{
  const seen=new Set<string>();
  return queries.filter(q=>{const k=q.toLowerCase().trim();if(seen.has(k))return false;seen.add(k);return true;});
}
function generateQueryPacks(profile:IntentProfile):QueryPack[]{
  const packs:QueryPack[]=[],langs=profile.languages.length?profile.languages:['en'];
  const isBuy=profile.purposeCode==='BUY',isRent=profile.purposeCode==='RENT',isInvest=profile.purposeCode==='INVEST';
  for(const lang of langs){
    const ph=PHRASES[lang]??PHRASES.en;
    const city=cityAlias(profile.city,lang),dist=profile.district??'';
    const beds=profile.bedroomsTarget,bedsStr=beds?bedroomsPhrase(lang,beds):'';
    const budgetStr=budgetPhraseQP(lang,profile.priceMin,profile.priceMax,profile.currency);
    const intentPhrase=isBuy?ph.buy:isRent?ph.rent:ph.invest;
    const t1:string[]=[];
    t1.push([intentPhrase,city,bedsStr,budgetStr].filter(Boolean).join(' '));
    if(dist)t1.push([intentPhrase,dist,city,bedsStr].filter(Boolean).join(' '));
    t1.push([ph.lookingFor,bedsStr,city,PLATFORM_SCOPES.facebook].filter(Boolean).join(' '));
    t1.push([ph.lookingFor,bedsStr,city,PLATFORM_SCOPES.telegram].filter(Boolean).join(' '));
    if(budgetStr)t1.push([ph.lookingFor,city,budgetStr].filter(Boolean).join(' '));
    packs.push({tier:1,tierReason:'Exact: city + intent + beds + budget',language:lang,queries:ddQueries(t1)});
    const t2:string[]=[];
    for(const area of profile.nearbyAreas.slice(0,3))t2.push([intentPhrase,area,bedsStr].filter(Boolean).join(' '));
    const altCity=lang==='en'?cityAlias(profile.city,'ru'):cityAlias(profile.city,'en');
    if(altCity&&altCity!==city)t2.push([intentPhrase,altCity,bedsStr,budgetStr].filter(Boolean).join(' '));
    const extMin=profile.priceMin?Math.round(profile.priceMin*0.8):null;
    const extMax=profile.priceMax?Math.round(profile.priceMax*1.3):null;
    const extBudget=budgetPhraseQP(lang,extMin,extMax,profile.currency);
    if(extBudget&&extBudget!==budgetStr)t2.push([intentPhrase,city,extBudget].filter(Boolean).join(' '));
    if(lang==='ru')t2.push([ph.lookingFor,city,PLATFORM_SCOPES.vk].filter(Boolean).join(' '));
    packs.push({tier:2,tierReason:'Nearby districts + transliterations + ±30% budget',language:lang,queries:ddQueries(t2)});
    const t3:string[]=[];
    t3.push([intentPhrase,city].join(' '));
    if(lang==='en')t3.push(`need apartment ${city}`);
    if(beds&&beds>1){t3.push([intentPhrase,bedroomsPhrase(lang,beds-1),city].filter(Boolean).join(' '));t3.push([intentPhrase,bedroomsPhrase(lang,beds+1),city].filter(Boolean).join(' '));}
    t3.push([ph.lookingFor,city,PLATFORM_SCOPES.forum].filter(Boolean).join(' '));
    packs.push({tier:3,tierReason:'Relax bedrooms+district; keep purpose+city',language:lang,queries:ddQueries(t3)});
    const t4:string[]=[];
    if(isBuy||isInvest){
      t4.push([ph.investor,city].join(' '));
      t4.push([ph.relocation,city,intentPhrase].filter(Boolean).join(' '));
      if(lang==='en'){t4.push(`investor buying property ${city}`);t4.push(`expat looking for apartment ${city}`);t4.push(`foreigner buying ${bedsStr} ${city}`.trim());}
    }
    if(isRent){
      t4.push([ph.corporate,city].join(' '));
      t4.push([ph.relocation,city].join(' '));
      if(lang==='en'){t4.push(`expat renting apartment ${city}`);t4.push(`company accommodation ${city}`);t4.push(`digital nomad apartment ${city}`);}
    }
    if(lang==='en')t4.push(`site:linkedin.com ${city} real estate ${isBuy?'buyer':'tenant'}`);
    packs.push({tier:4,tierReason:'Investor/relocation/corporate/expat demand profiles',language:lang,queries:ddQueries(t4)});
  }
  return packs;
}
function shouldAdvanceTier(currentTier:number,usable:number,targetMin:number):boolean{
  return currentTier<4&&usable<targetMin;
}

// ── INLINE: dataforseo_v2 ─────────────────────────────────────
const LOCATION_CODES:Record<string,number>={GE:21831,TR:2792,IL:2376,AE:2784,RU:2643,US:2840,DEFAULT:21831};
function dfseoLocationCode(country:string|undefined):number{
  return LOCATION_CODES[(country??'GE').toUpperCase()]??LOCATION_CODES.DEFAULT;
}
const STRIP_PARAMS=new Set(['utm_source','utm_medium','utm_campaign','utm_content','utm_term','fbclid','gclid','ref','referrer','_ga','mc_cid','mc_eid']);
function canonicalUrlDFSEO(raw:string):string{
  try{const u=new URL(raw);for(const p of STRIP_PARAMS)u.searchParams.delete(p);u.hash='';return`${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${u.pathname}${u.search}`;}
  catch{return raw.toLowerCase().trim();}
}
function getEnv(k:string):string{return Deno.env.get(k)??'';}
class DataForSEOProvider{
  name='DATAFORSEO';
  private login=getEnv('DATAFORSEO_LOGIN');
  private password=getEnv('DATAFORSEO_PASSWORD');
  isConfigured():boolean{return!!(this.login&&this.password);}
  private auth():string{return`Basic ${btoa(`${this.login}:${this.password}`)}` ;}
  async validateCredentials():Promise<{ok:boolean;error?:string}>{
    if(!this.isConfigured())return{ok:false,error:'NOT_CONFIGURED'};
    // Skip the /appendices/user_data ping (returns 404 on some plans).
    // Instead do a minimal live SERP call with a 1-result depth; a 200 with
    // tasks array confirms valid credentials; non-2xx means bad creds.
    try{
      const probe=[{keyword:'test',language_code:'en',location_code:2840,device:'desktop',depth:1,tag:'cred_probe'}];
      const r=await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/advanced',
        {method:'POST',headers:{Authorization:this.auth(),'Content-Type':'application/json'},
         body:JSON.stringify(probe),signal:AbortSignal.timeout(10_000)});
      if(r.ok){const j=await r.json().catch(()=>({}));
        if(Array.isArray(j.tasks)&&j.tasks.length>0)return{ok:true};
        return{ok:false,error:`Unexpected response: ${JSON.stringify(j).slice(0,120)}`};}
      const b=await r.text().catch(()=>'');return{ok:false,error:`HTTP ${r.status}: ${b.slice(0,100)}`};}
    catch(e:unknown){return{ok:false,error:e instanceof Error?e.message:String(e)};}
  }
  async searchLive(queries:SearchQuery[]):Promise<SearchProviderResponse>{
    if(!this.isConfigured())throw new Error('DataForSEO not configured — credentials missing');
    const payloads=queries.map((q,i)=>({keyword:q.q,language_code:q.language??'en',location_code:dfseoLocationCode(q.country),device:'desktop',depth:10,tag:`live:${i}`}));
    const r=await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/advanced',{method:'POST',headers:{Authorization:this.auth(),'Content-Type':'application/json'},body:JSON.stringify(payloads),signal:AbortSignal.timeout(60_000)});
    if(!r.ok){const b=await r.text().catch(()=>'');throw new Error(`DFSEO HTTP ${r.status}: ${b.slice(0,200)}`);}
    const json=await r.json();const results:SearchResult[]=[];let totalCost=0;const taskStatuses:DFSEOTaskStatus[]=[];
    for(let ti=0;ti<(json.tasks??[]).length;ti++){
      const task=json.tasks[ti];
      const taskCode:number=task.status_code??0;
      const taskMsg:string=task.status_message??'';
      const taskCost:number=task.cost??0;totalCost+=taskCost;const q=queries[ti];
      // Task-level failure: status_code outside 20000-20099 range means the task failed
      if(taskCode<20000||taskCode>20099){
        taskStatuses.push({taskId:task.id??'',keyword:q?.q??'',status:'failed',statusCode:taskCode,statusMessage:taskMsg,costUsd:taskCost,payloadHash:''});
        continue;
      }
      taskStatuses.push({taskId:task.id??'',keyword:q?.q??'',status:'ready',statusCode:taskCode,statusMessage:taskMsg,costUsd:taskCost,payloadHash:''});
      for(const item of task.result?.[0]?.items??[]){
        if(item.type!=='organic')continue;const raw=item.url??'';
        results.push({title:item.title??'',url:raw,canonicalUrl:canonicalUrlDFSEO(raw),snippet:item.description??'',domain:item.domain??'',rankPosition:item.rank_absolute??0,publishedAt:item.timestamp??null,tier:q?.tier??1,queryText:q?.q??'',taskId:task.id});
      }
    }
    const failed=taskStatuses.filter(t=>t.status==='failed');
    if(failed.length>0&&results.length===0)throw new Error(`All ${failed.length} DFSEO tasks failed. First: ${failed[0].statusCode} ${failed[0].statusMessage}`);
    return{results,taskStatuses,costUsd:totalCost,provider:'DATAFORSEO',cacheHit:false,mode:'live',requestId:json.tasks?.[0]?.id};
  }
  // mock() removed from production bundle — never fabricate search results
}

// ── INLINE: apify_v2 ──────────────────────────────────────────
const APIFY_POLL_INTERVAL_MS=8_000,APIFY_MAX_POLLS=15,APIFY_FETCH_TIMEOUT_MS=30_000;
function buildFBInput(req:SocialCollectRequest):Record<string,unknown>{
  const urls=req.sourceUrls?.length?req.sourceUrls.map(u=>({url:u})):[{url:req.sourceUrl}];
  return{startUrls:urls,maxPosts:req.maxItems??100,commentsMode:'RANKED_THREADED',proxy:{useApifyProxy:true,apifyProxyGroups:['RESIDENTIAL']}};
}
function buildTGInput(req:SocialCollectRequest):Record<string,unknown>{
  const urls=req.sourceUrls?.length?req.sourceUrls:[req.sourceUrl];
  return{channelUrls:urls,maxMessages:req.maxItems??200,includeReplies:true,proxy:{useApifyProxy:true}};
}
function buildIGInput(req:SocialCollectRequest):Record<string,unknown>{
  const urls=req.sourceUrls?.length?req.sourceUrls:[req.sourceUrl];
  return{directUrls:urls,resultsType:'posts',resultsLimit:req.maxItems??50,scrapePostsUntilDate:req.since??null,proxy:{useApifyProxy:true,apifyProxyGroups:['RESIDENTIAL']}};
}
function buildVKInput(req:SocialCollectRequest):Record<string,unknown>{
  const urls=req.sourceUrls?.length?req.sourceUrls:[req.sourceUrl];
  return{startUrls:urls.map(u=>({url:u})),maxPosts:req.maxItems??100,includeComments:true,proxy:{useApifyProxy:true}};
}
function buildActorInput(req:SocialCollectRequest):Record<string,unknown>{
  switch(req.platform){case'FACEBOOK':return buildFBInput(req);case'TELEGRAM':return buildTGInput(req);case'INSTAGRAM':return buildIGInput(req);case'VK':return buildVKInput(req);default:return{};}
}
// deno-lint-ignore no-explicit-any
function normItem(item:Record<string,any>,platform:string):SocialPost{
  switch(platform){
    case'FACEBOOK':return{externalId:String(item.postId??item.id??Math.random()),text:String(item.text??item.message??item.story??item.postText??''),authorName:String(item.authorName??(item.user as Record<string,unknown>)?.name??''),authorUrl:String(item.authorUrl??(item.user as Record<string,unknown>)?.url??''),publishedAt:String(item.time??item.date??item.created_at??''),sourceUrl:String(item.url??item.postUrl??''),platform,isGroupPost:!!(item.groupId??item.groupUrl),likeCount:Number(item.likes?.summary?.total_count??item.likesCount??0),replyCount:Number(item.commentCount??item.comments?.summary?.total_count??0)};
    case'TELEGRAM':return{externalId:String(item.id??item.messageId??Math.random()),text:String(item.text??item.message??''),authorName:String((item.sender as Record<string,unknown>)?.name??item.from??''),authorUrl:String((item.sender as Record<string,unknown>)?.url??''),publishedAt:String(item.date??item.timestamp??''),sourceUrl:String(item.url??''),platform,isGroupPost:!!(item.isGroupMessage??item.chatType==='group'),replyCount:Number(item.replyCount??0)};
    case'INSTAGRAM':return{externalId:String(item.id??item.shortCode??Math.random()),text:String(item.caption??item.text??''),authorName:String(item.ownerUsername??item.username??''),authorUrl:String(item.ownerUrl??`https://instagram.com/${item.ownerUsername??''}`),publishedAt:String(item.timestamp??item.takenAt??''),sourceUrl:String(item.url??item.displayUrl??''),platform,likeCount:Number(item.likesCount??0),replyCount:Number(item.commentsCount??0)};
    case'VK':return{externalId:String(item.id??item.post_id??Math.random()),text:String(item.text??item.body??''),authorName:String(item.authorName??item.from_name??''),authorUrl:String(item.authorUrl??item.from_url??''),publishedAt:String(item.date??item.time??''),sourceUrl:String(item.url??item.postUrl??''),platform,likeCount:Number(item.likes_count??item.likesCount??0),replyCount:Number(item.comments_count??item.commentsCount??0)};
    default:return{externalId:String(item.id??Math.random()),text:String(item.text??''),platform};
  }
}
class ApifyProvider{
  name='APIFY';
  private token=getEnv('APIFY_API_TOKEN');
  isConfigured():boolean{return!!this.token;}
  private actorId(platform:string):string{
    const m:Record<string,string>={FACEBOOK:getEnv('APIFY_FACEBOOK_ACTOR_ID'),TELEGRAM:getEnv('APIFY_TELEGRAM_ACTOR_ID'),INSTAGRAM:getEnv('APIFY_INSTAGRAM_ACTOR_ID'),VK:getEnv('APIFY_VK_ACTOR_ID')};
    return m[platform]??'';
  }
  async startRun(req:SocialCollectRequest):Promise<ApifyRunMeta>{
    const actorId=this.actorId(req.platform);
    if(!actorId)throw new Error(`No Actor ID configured for ${req.platform}`);
    const r=await fetch(`https://api.apify.com/v2/acts/${actorId}/runs?token=${this.token}&memory=256`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(buildActorInput(req)),signal:AbortSignal.timeout(15_000)});
    if(!r.ok){const b=await r.text().catch(()=>'');throw new Error(`Apify start run failed (${req.platform}): ${r.status} ${b.slice(0,200)}`);}
    const j=await r.json();const d=j.data??j;
    return{runId:d.id,datasetId:d.defaultDatasetId??null,status:(d.status as ApifyRunMeta['status'])?? 'RUNNING',startedAt:d.startedAt??new Date().toISOString()};
  }
  async pollRun(runId:string):Promise<ApifyRunMeta>{
    const r=await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${this.token}`,{signal:AbortSignal.timeout(10_000)});
    if(!r.ok)throw new Error(`Apify poll failed: ${r.status}`);
    const j=await r.json();const d=j.data??j;
    return{runId:d.id,datasetId:d.defaultDatasetId??null,status:(d.status as ApifyRunMeta['status'])?? 'RUNNING',computeUnits:d.stats?.computeUnits,costUsd:d.usageTotalUsd??null,itemCount:d.stats?.itemCount??null,startedAt:d.startedAt??'',finishedAt:d.finishedAt??null};
  }
  async fetchDataset(datasetId:string,maxItems=500):Promise<SocialPost[]>{
    const r=await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${this.token}&limit=${maxItems}&format=json`,{signal:AbortSignal.timeout(APIFY_FETCH_TIMEOUT_MS)});
    if(!r.ok)throw new Error(`Apify dataset fetch failed: ${r.status}`);
    // deno-lint-ignore no-explicit-any
    const items:Record<string,any>[]=await r.json();
    return items.map(item=>normItem(item,'UNKNOWN'));
  }
  async collect(req:SocialCollectRequest):Promise<SocialCollectResponse>{
    if(!this.isConfigured())throw new Error(`Apify token not configured`);
    const actor=this.actorId(req.platform);
    if(!actor)throw new Error(`APIFY_${req.platform}_ACTOR_ID not configured — platform unavailable`);
    let runMeta:ApifyRunMeta;
    const TERMINAL=new Set(['SUCCEEDED','FAILED','TIMED-OUT','ABORTED']);
    if(req.existingRunId){runMeta=await this.pollRun(req.existingRunId);}
    else{runMeta=await this.startRun(req);}
    let polls=0;
    while(!TERMINAL.has(runMeta.status)&&polls<APIFY_MAX_POLLS){
      await new Promise(r=>setTimeout(r,APIFY_POLL_INTERVAL_MS));
      runMeta=await this.pollRun(runMeta.runId);polls++;
    }
    if(!TERMINAL.has(runMeta.status))return{posts:[],runMeta,costUsd:runMeta.costUsd??0,provider:'APIFY',cacheHit:false,partial:true};
    if(runMeta.status==='FAILED'||runMeta.status==='TIMED-OUT'||runMeta.status==='ABORTED')return{posts:[],runMeta,costUsd:runMeta.costUsd??0,provider:'APIFY',cacheHit:false};
    if(!runMeta.datasetId)return{posts:[],runMeta,costUsd:runMeta.costUsd??0,provider:'APIFY',cacheHit:false};
    const items=await this.fetchDataset(runMeta.datasetId,req.maxItems??500);
    const posts=items.map((item:SocialPost)=>({...item,platform:req.platform}));
    return{posts,runMeta:{...runMeta,itemCount:posts.length},costUsd:runMeta.costUsd??0,provider:'APIFY',cacheHit:false};
  }
  // mock() removed — Apify must use real actors or emit APIFY_PLATFORM_NOT_CONFIGURED
}

// ── INLINE: openai_classifier ─────────────────────────────────
const CLASSIFIER_PROMPT_VERSION='v2.1';
const CLASSIFIER_SYSTEM_PROMPT=`You are a multilingual real-estate intent classifier for the Georgian (Tbilisi), Turkish, Israeli, UAE, and Russian markets.

Given a text snippet (Georgian, English, Russian, Turkish, Arabic, or Hebrew), determine the poster's intent.

DEMAND intents (keep): BUY  RENT  INVEST  RELOCATE_BUY  RELOCATE_RENT
SUPPLY/NOISE intents (reject): SELLER  AGENT_AD  PROPERTY_AD  SPAM  NOISE  UNKNOWN

Return ONLY valid JSON — no markdown, no explanation, nothing outside the JSON object.

Schema (all fields required; use null for unknown):
{"intentType":"BUY|RENT|INVEST|RELOCATE_BUY|RELOCATE_RENT|SELLER|AGENT_AD|PROPERTY_AD|SPAM|NOISE|UNKNOWN","country":null,"region":null,"city":null,"district":null,"neighborhoods":null,"transactionType":"SALE|RENT|INVESTMENT"|null,"propertyTypes":null,"bedroomsMin":null,"bedroomsMax":null,"areaMin":null,"areaMax":null,"budgetMin":null,"budgetMax":null,"currency":null,"timeline":null,"relocationIntent":false,"investmentIntent":false,"language":null,"intentConfidence":0.0,"specificityScore":0.0,"actionabilityScore":0.0,"contactabilityScore":0.0,"evidenceQualityScore":0.0,"translatedText":null}

Rules: Never invent location, budget, contact details not present in text. PROPERTY_AD = listing property for sale/rent. AGENT_AD = agent offering services. propertyTypes values: APARTMENT HOUSE VILLA COMMERCIAL LAND OFFICE PENTHOUSE STUDIO TOWNHOUSE OTHER. translatedText: English translation only if original not English, else null.`;
const CLASSIFIER_DEMAND_TYPES=new Set(['BUY','RENT','INVEST','RELOCATE_BUY','RELOCATE_RENT','SELLER','AGENT_AD','PROPERTY_AD','SPAM','NOISE','UNKNOWN']);
// deno-lint-ignore no-explicit-any
function validateClassifierSchema(obj:any):boolean{return typeof obj==='object'&&!!obj&&CLASSIFIER_DEMAND_TYPES.has(obj.intentType)&&typeof obj.intentConfidence==='number'&&typeof obj.specificityScore==='number';}
function defaultIntentResult(model:string,costUsd:number):AIIntentResult{
  return{intentType:'UNKNOWN',country:null,region:null,city:null,district:null,neighborhoods:null,transactionType:null,propertyTypes:null,bedroomsMin:null,bedroomsMax:null,areaMin:null,areaMax:null,budgetMin:null,budgetMax:null,currency:null,timeline:null,relocationIntent:false,investmentIntent:false,language:null,intentConfidence:0,specificityScore:0,actionabilityScore:0,contactabilityScore:0,evidenceQualityScore:0,translatedText:null,model,costUsd,promptVersion:CLASSIFIER_PROMPT_VERSION};
}
class OpenAIClassifier{
  name='OPENAI';
  private apiKey=getEnv('OPENAI_API_KEY');
  isConfigured():boolean{return!!this.apiKey;}
  async classify(req:AIClassifyRequest):Promise<AIIntentResult>{
    if(!this.isConfigured())throw new Error('OpenAI API key not configured — classifier unavailable');
    const userContent=req.propertyContext?`[Property context: ${req.propertyContext.country}, ${req.propertyContext.city??'city unknown'}, ${req.propertyContext.transactionType??'txn unknown'}]\n\n${req.text}`:req.text;
    let rawJson='',parsed:AIIntentResult|null=null,totalTokens=0;
    for(let attempt=0;attempt<2;attempt++){
      const r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${this.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-4o-mini',temperature:0,max_tokens:600,messages:[{role:'system',content:CLASSIFIER_SYSTEM_PROMPT},{role:'user',content:userContent.slice(0,2000)}]}),signal:AbortSignal.timeout(20_000)});
      if(!r.ok){const b=await r.text().catch(()=>'');throw new Error(`OpenAI classify failed: ${r.status} ${b.slice(0,100)}`);}
      const json=await r.json();totalTokens+=json.usage?.total_tokens??200;rawJson=json.choices?.[0]?.message?.content??'{}';
      try{const obj=JSON.parse(rawJson);if(validateClassifierSchema(obj)){parsed=obj;break;}}catch{/*retry*/}
    }
    const costUsd=(totalTokens/1_000_000)*0.30;
    if(!parsed){console.error(`[classifier] malformed JSON: ${rawJson.slice(0,100)}`);return defaultIntentResult('gpt-4o-mini',costUsd);}
    return{intentType:parsed.intentType??'UNKNOWN',country:parsed.country??null,region:parsed.region??null,city:parsed.city??null,district:parsed.district??null,neighborhoods:Array.isArray(parsed.neighborhoods)?parsed.neighborhoods:null,transactionType:parsed.transactionType??null,propertyTypes:Array.isArray(parsed.propertyTypes)?parsed.propertyTypes:null,bedroomsMin:parsed.bedroomsMin??null,bedroomsMax:parsed.bedroomsMax??null,areaMin:parsed.areaMin??null,areaMax:parsed.areaMax??null,budgetMin:parsed.budgetMin??null,budgetMax:parsed.budgetMax??null,currency:parsed.currency??null,timeline:parsed.timeline??null,relocationIntent:parsed.relocationIntent??false,investmentIntent:parsed.investmentIntent??false,language:parsed.language??req.language??null,intentConfidence:Number(parsed.intentConfidence??0),specificityScore:Number(parsed.specificityScore??0),actionabilityScore:Number(parsed.actionabilityScore??0),contactabilityScore:Number(parsed.contactabilityScore??0),evidenceQualityScore:Number(parsed.evidenceQualityScore??0.5),translatedText:parsed.translatedText??null,model:'gpt-4o-mini',costUsd,promptVersion:CLASSIFIER_PROMPT_VERSION};
  }
  // mock() removed — OpenAI must be configured; missing key is a hard failure
}

// ── INLINE: scorer ────────────────────────────────────────────
const SCORER_WEIGHTS={intent:25,geography:20,budget:15,compatibility:15,freshness:10,evidence:10,contactability:5};
const SCORER_DEMAND_TYPES=new Set(['BUY','RENT','INVEST','RELOCATE_BUY','RELOCATE_RENT']);
function hardRejectionReason(property:PropertySnapshot,intent:AIIntentResult):string|null{
  if(!SCORER_DEMAND_TYPES.has(intent.intentType))return`supply_or_noise:${intent.intentType}`;
  if(intent.intentConfidence<0.25)return`low_confidence:${intent.intentConfidence.toFixed(2)}`;
  const pc=(property.country??'GE').toUpperCase(),ic=(intent.country??'').toUpperCase();
  if(ic&&ic!==pc)return`country_mismatch:property=${pc},intent=${ic}`;
  const pt=property.transaction_type?.toUpperCase(),it=intent.transactionType?.toUpperCase();
  if(pt&&it){const saleR=new Set(['SALE','BUY','INVESTMENT','INVEST']),rentR=new Set(['RENT']);
    if(saleR.has(pt)&&rentR.has(it))return`txn_mismatch:property=SALE,intent=RENT`;
    if(rentR.has(pt)&&saleR.has(it))return`txn_mismatch:property=RENT,intent=SALE`;}
  return null;
}
function scoreIntent_s(intent:AIIntentResult):number{return Math.round(SCORER_WEIGHTS.intent*intent.intentConfidence);}
function scoreGeography_s(property:PropertySnapshot,intent:AIIntentResult):number{
  const pc=property.city?.toLowerCase(),ic=intent.city?.toLowerCase();
  if(!pc||!ic)return Math.round(SCORER_WEIGHTS.geography*0.4);
  if(pc!==ic)return 0;
  const pd=property.district?.toLowerCase(),id=intent.district?.toLowerCase();
  if(pd&&id){if(pd===id)return SCORER_WEIGHTS.geography;
    if((intent.neighborhoods??[]).some(n=>n.toLowerCase()===pd))return Math.round(SCORER_WEIGHTS.geography*0.85);
    return Math.round(SCORER_WEIGHTS.geography*0.6);}
  return Math.round(SCORER_WEIGHTS.geography*0.8);
}
function scoreBudget_s(property:PropertySnapshot,intent:AIIntentResult):number{
  const price=property.total_price,bMin=intent.budgetMin,bMax=intent.budgetMax;
  if(!price||(!bMin&&!bMax))return Math.round(SCORER_WEIGHTS.budget*0.5);
  if((!bMin||price>=bMin*0.90)&&(!bMax||price<=bMax*1.10))return SCORER_WEIGHTS.budget;
  if(bMax&&price<=bMax*1.25)return Math.round(SCORER_WEIGHTS.budget*0.5);
  return 0;
}
function scoreCompat_s(property:PropertySnapshot,intent:AIIntentResult):number{
  let s=0,max=SCORER_WEIGHTS.compatibility;
  const pt=property.property_type?.toUpperCase(),its=(intent.propertyTypes??[]).map(t=>t.toUpperCase());
  if(!pt||!its.length)s+=2;else if(its.includes(pt))s+=5;
  const beds=property.bedrooms,bMin=intent.bedroomsMin,bMax=intent.bedroomsMax;
  if(!beds||(!bMin&&!bMax))s+=2;else if((!bMin||beds>=bMin)&&(!bMax||beds<=bMax))s+=5;
  const area=property.area,aMin=intent.areaMin,aMax=intent.areaMax;
  if(area&&(aMin||aMax)){if((!aMin||area>=aMin*0.85)&&(!aMax||area<=aMax*1.15))s+=3;}else s+=1;
  if(property.parking)s+=0.5;if(property.elevator)s+=0.5;if(property.balcony)s+=0.5;if(property.furnished&&intent.investmentIntent)s+=0.5;
  return Math.min(max,Math.round(s));
}
function scoreFreshness_s(publishedAt:string|null|undefined):number{
  if(!publishedAt)return Math.round(SCORER_WEIGHTS.freshness*0.4);
  const h=(Date.now()-new Date(publishedAt).getTime())/3_600_000;
  if(h<1)return SCORER_WEIGHTS.freshness;if(h<6)return Math.round(SCORER_WEIGHTS.freshness*0.9);if(h<24)return Math.round(SCORER_WEIGHTS.freshness*0.75);if(h<72)return Math.round(SCORER_WEIGHTS.freshness*0.55);if(h<168)return Math.round(SCORER_WEIGHTS.freshness*0.35);if(h<720)return Math.round(SCORER_WEIGHTS.freshness*0.15);return 0;
}
function scoreEvidence_s(intent:AIIntentResult,srcQ:number):number{
  return Math.min(SCORER_WEIGHTS.evidence,Math.round(intent.specificityScore*SCORER_WEIGHTS.evidence*0.30+intent.actionabilityScore*SCORER_WEIGHTS.evidence*0.30+(intent.evidenceQualityScore??0.5)*SCORER_WEIGHTS.evidence*0.25+(srcQ/10)*SCORER_WEIGHTS.evidence*0.15));
}
function scoreContact_s(intent:AIIntentResult):number{return Math.min(SCORER_WEIGHTS.contactability,Math.round(SCORER_WEIGHTS.contactability*(intent.contactabilityScore??0)));}
function signalStrengthFromScore(total:number):SignalStrength{if(total>=85)return'EXCEPTIONAL';if(total>=70)return'VERY_STRONG';if(total>=55)return'STRONG';if(total>=35)return'GOOD';return'POTENTIAL';}
function scoreLabelFromTotal(total:number):ScorerComponents['label']{if(total>=65)return'strong';if(total>=40)return'good';return'exploratory';}
function calculateUnlockPrice(strength:SignalStrength,components:ScorerComponents):number{
  const base:Record<SignalStrength,number>={POTENTIAL:0.5,GOOD:1.0,STRONG:1.8,VERY_STRONG:3.0,EXCEPTIONAL:5.0};
  let p=base[strength];p*=0.7+0.3*(components.total/100);p*=0.8+0.2*(components.contactability/SCORER_WEIGHTS.contactability);p*=0.9+0.1*(components.evidenceQuality/SCORER_WEIGHTS.evidence);
  return Math.max(0.5,Math.round(p*100)/100);
}
function scoreCandidate(params:{property:PropertySnapshot;intent:AIIntentResult;publishedAt?:string|null;sourceQuality?:number;}):ScorerComponents{
  const{property,intent,publishedAt,sourceQuality=5}=params;
  const rej=hardRejectionReason(property,intent);
  if(rej)return{intent:0,geography:0,budget:0,compatibility:0,freshness:0,evidenceQuality:0,contactability:0,total:0,label:'rejected',rejectionReason:rej};
  const i_s=scoreIntent_s(intent),g_s=scoreGeography_s(property,intent),b_s=scoreBudget_s(property,intent),c_s=scoreCompat_s(property,intent),f_s=scoreFreshness_s(publishedAt),e_s=scoreEvidence_s(intent,sourceQuality),ct_s=scoreContact_s(intent);
  const total=Math.min(100,i_s+g_s+b_s+c_s+f_s+e_s+ct_s);
  return{intent:i_s,geography:g_s,budget:b_s,compatibility:c_s,freshness:f_s,evidenceQuality:e_s,contactability:ct_s,total,label:scoreLabelFromTotal(total)};
}

// ── INLINE: normaliser ────────────────────────────────────────
const SUPPLY_PATTERNS=[/\bfor sale\b.*(\bcontact\b|\bcall\b)/i,/\breal estate agent\b/i,/\bproperty listed\b/i,/\bcall now\b/i,/\bwww\.\S+\.(ge|com|net)/i,/\bclick here\b/i,/\bcontact us\b/i,/продам (квартиру|дом|офис)/i,/агентство недвижимости/i,/звоните \+/i,/сдаю квартиру/i,/ვყიდი ბინას/i,/ვაქირავებ ბინას/i,/\bsatılık daire\b/i,/\bkiralık daire\b/i,/\bemlak ofisi\b/i,/\bللبيع\b.*\bاتصل\b/i,/\bمكتب عقارات\b/i,/\bלמכירה\b.*\bצור קשר\b/i,/\bסוכנות נדל"ן\b/i];
const BUYER_SIGNALS=[/\b(looking for|searching for|want to buy|want to rent|need a flat|need an apartment|seeking|looking to buy|looking to rent)\b/i,/\b(ищу|куплю|сниму|хочу купить|ищем квартиру|хотим купить)\b/i,/\b(ვეძებ|ვიყიდი|გვინდა|ვიქირავებ)\b/i,/\b(arıyorum|satın almak|kiralamak istiyorum|daire arıyorum)\b/i,/\b(أبحث عن|أريد شراء|أريد استئجار|نبحث عن)\b/i,/\b(מחפש|אני מחפש|רוצה לקנות|מחפשת דירה)\b/i];
function cheapFilter(text:string):FilterResult{
  if(!text||text.trim().length<20)return{pass:false,reason:'too_short'};
  if(/^https?:\/\/\S+$/.test(text.trim()))return{pass:false,reason:'url_only'};
  if(text.split(/\s+/).length<5)return{pass:false,reason:'too_few_words'};
  const hasSupply=SUPPLY_PATTERNS.some(p=>p.test(text)),hasBuyer=BUYER_SIGNALS.some(p=>p.test(text));
  if(hasSupply&&!hasBuyer)return{pass:false,reason:'supply_ad'};
  return{pass:true};
}
// Maps common full country names (as returned by OpenAI) → ISO-2 codes
const COUNTRY_NAME_TO_ISO:Record<string,string>={
  'GEORGIA':'GE','TURKEY':'TR','ISRAEL':'IL','UAE':'AE','UNITED ARAB EMIRATES':'AE',
  'RUSSIA':'RU','RUSSIAN FEDERATION':'RU','UNITED STATES':'US','USA':'US',
  'GERMANY':'DE','FRANCE':'FR','SPAIN':'ES','ITALY':'IT','UNITED KINGDOM':'GB','UK':'GB',
  'ARMENIA':'AM','AZERBAIJAN':'AZ','KAZAKHSTAN':'KZ','UKRAINE':'UA','POLAND':'PL',
};
function normaliseCountryToISO(raw:string):string{
  const upper=raw.toUpperCase().trim();
  if(upper.length===2)return upper; // already ISO-2
  return COUNTRY_NAME_TO_ISO[upper]??upper;
}

const NORM_DEMAND_TYPES=new Set(['BUY','RENT','INVEST','RELOCATE_BUY','RELOCATE_RENT']);
function postAIFilter(intent:AIIntentResult,property:{country:string;transaction_type?:string|null},recencyDays:number,maxRecencyDays=90):FilterResult{
  if(!NORM_DEMAND_TYPES.has(intent.intentType))return{pass:false,reason:`non_demand:${intent.intentType}`};
  if(intent.intentConfidence<0.25)return{pass:false,reason:`low_confidence:${intent.intentConfidence.toFixed(2)}`};
  // Normalise country to ISO-2 before comparing — OpenAI may return full names
  const ic=normaliseCountryToISO(intent.country??'').toUpperCase();
  const pc=property.country.toUpperCase();
  if(ic&&ic!==pc)return{pass:false,reason:`country_mismatch:${ic}!=${pc}`};
  if(recencyDays>maxRecencyDays)return{pass:false,reason:`stale:${recencyDays}d`};
  return{pass:true};
}
const TRACKING_PARAMS_NORM=new Set(['utm_source','utm_medium','utm_campaign','utm_content','utm_term','fbclid','gclid','ref','referrer','_ga','mc_cid','mc_eid','igshid']);
function canonicalUrlNorm(raw:string):string{
  try{const u=new URL(raw);for(const p of TRACKING_PARAMS_NORM)u.searchParams.delete(p);u.hash='';return`${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${u.pathname}${u.search}`;}
  catch{return raw.toLowerCase().trim();}
}
async function contentFingerprint(text:string):Promise<string>{
  const n=text.toLowerCase().replace(/\s+/g,' ').trim().slice(0,300);
  const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(n));
  return Array.from(new Uint8Array(buf)).slice(0,12).map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function dedupHash(intent:AIIntentResult,sourceUrl:string):Promise<string>{
  const key=[(intent.city??'').toLowerCase(),(intent.transactionType??'').toLowerCase(),intent.bedroomsMin??'',intent.budgetMin??'',intent.budgetMax??'',(intent.currency??'').toLowerCase(),canonicalUrlNorm(sourceUrl)].join('|');
  const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));
  return Array.from(new Uint8Array(buf)).slice(0,10).map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function normalisePost(post:SocialPost,isMock:boolean):Promise<NormalisedSignal>{
  const text=post.text.trim();
  return{externalId:post.externalId,platform:post.platform,sourceUrl:post.sourceUrl??'',canonicalUrl:canonicalUrlNorm(post.sourceUrl??post.authorUrl??''),authorName:post.authorName??null,authorUrl:post.authorUrl??null,text,publishedAt:post.publishedAt??null,fingerprint:await contentFingerprint(text),isMock};
}
async function normaliseSearchResult(result:SearchResult,isMock:boolean):Promise<NormalisedSignal>{
  const text=`${result.title}\n${result.snippet}`.trim();
  return{externalId:result.canonicalUrl,platform:'GOOGLE',sourceUrl:result.url,canonicalUrl:result.canonicalUrl,authorName:null,authorUrl:null,text,publishedAt:result.publishedAt??null,fingerprint:await contentFingerprint(text),isMock};
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── CONFIG ────────────────────────────────────────────────────
const TARGET_MIN_CANDIDATES = 5;   // advance tier if below
const MAX_CANDIDATES_PER_JOB = 50; // stop collecting when reached
const MAX_TIERS = 4;
const SOCIAL_SOURCES_PER_PLATFORM = 3; // max sources to collect per platform per tier

// ── SPEND CAP ─────────────────────────────────────────────────

async function isProviderAllowed(
  sb: SupabaseClient,
  provider: string,
): Promise<boolean> {
  const monthStart = new Date();
  monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

  const [settingsRes, costsRes] = await Promise.all([
    sb.from('admin_settings').select('key, value').like('key', 'spend_cap_%'),
    sb.from('cost_events').select('provider, cost_usd')
      .gte('timestamp', monthStart.toISOString()),
  ]);

  const caps: Record<string, number> = {};
  for (const s of settingsRes.data ?? []) {
    caps[s.key.replace('spend_cap_', '')] = Number(s.value);
  }

  const spent: Record<string, number> = {};
  for (const c of costsRes.data ?? []) {
    const k = String(c.provider).toLowerCase();
    spent[k] = (spent[k] ?? 0) + Number(c.cost_usd ?? 0);
  }

  const globalSpent = Object.values(spent).reduce((a, b) => a + b, 0);
  if (globalSpent >= (caps['global'] ?? 999_999)) return false;

  const provKey = provider.toLowerCase().replace('_mock', '');
  if ((spent[provKey] ?? 0) >= (caps[provKey] ?? 999_999)) return false;
  return true;
}

// ── JOB STATE ─────────────────────────────────────────────────

async function updateJob(
  sb: SupabaseClient,
  jobId: string,
  patch: Record<string, unknown>,
) {
  await sb.from('matching_jobs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', jobId);
}

async function emitEvent(
  sb: SupabaseClient,
  jobId: string,
  step: string,
  message: string,
  meta?: Record<string, unknown>,
) {
  await sb.from('matching_job_events').insert({
    job_id:     jobId,
    event_type: step,
    payload:    { message, ...(meta ?? {}) },
  });
}

// ── COST EVENT ────────────────────────────────────────────────

async function logCost(
  sb: SupabaseClient,
  provider: string,
  operation: string,
  costUsd: number,
  success: boolean,
  extra?: Record<string, unknown>,
) {
  // cost_events real cols: provider, operation_type, cost_usd, success, cache_hit,
  // job_id (added by migration), property_id, signal_id, source, market, request_id,
  // units. No timestamp col — DB default.
  const { job_id: jobId_, ...rest } = extra ?? {};
  await sb.from('cost_events').insert({
    provider,
    operation_type: operation,
    cost_usd:       costUsd,
    success,
    cache_hit:      false,
    ...(jobId_ ? { job_id: jobId_ } : {}),
    ...rest,
  });
}

// ── SOURCE REGISTRY SEED ──────────────────────────────────────
// Ensures well-known Georgian/international property demand sources are seeded.
// Safe to call repeatedly — upserts by unique(platform, external_id).

async function ensureSocialSources(
  sb: SupabaseClient,
  market: string,
): Promise<void> {
  const SOURCES: Array<{
    platform: string; source_type: string; external_id: string;
    name: string; url: string; country_code: string; language: string;
    quality_score: number;
  }> = [
    // Georgia — Facebook
    { platform:'FACEBOOK', source_type:'FACEBOOK_GROUP', external_id:'groups/tbilisi.realestate',
      name:'Tbilisi Real Estate Group', url:'https://www.facebook.com/groups/tbilisi.realestate',
      country_code:'GE', language:'en', quality_score: 7 },
    { platform:'FACEBOOK', source_type:'FACEBOOK_GROUP', external_id:'groups/tbilisiqiroba',
      name:'Tbilisi Qiroba (Georgian)', url:'https://www.facebook.com/groups/tbilisiqiroba',
      country_code:'GE', language:'ka', quality_score: 8 },
    { platform:'FACEBOOK', source_type:'FACEBOOK_GROUP', external_id:'groups/tbilisi.rent.buy',
      name:'Tbilisi Rent & Buy (RU)', url:'https://www.facebook.com/groups/tbilisi.rent.buy',
      country_code:'GE', language:'ru', quality_score: 7 },
    // Georgia — Telegram
    { platform:'TELEGRAM', source_type:'TELEGRAM_GROUP', external_id:'tbilisiapartments',
      name:'Tbilisi Apartments (TG)', url:'https://t.me/tbilisiapartments',
      country_code:'GE', language:'en', quality_score: 7 },
    { platform:'TELEGRAM', source_type:'TELEGRAM_GROUP', external_id:'tbilisikvartiri',
      name:'Тбилиси Квартиры (RU)', url:'https://t.me/tbilisikvartiri',
      country_code:'GE', language:'ru', quality_score: 7 },
    { platform:'TELEGRAM', source_type:'TELEGRAM_GROUP', external_id:'tbilisi_real_estate',
      name:'Tbilisi Real Estate TG', url:'https://t.me/tbilisi_real_estate',
      country_code:'GE', language:'en', quality_score: 6 },
    // Georgia — VK (Russian diaspora buyers)
    { platform:'VK', source_type:'VK_COMMUNITY', external_id:'tbilisi_community',
      name:'Тбилиси ВКонтакте', url:'https://vk.com/tbilisi_community',
      country_code:'GE', language:'ru', quality_score: 5 },
    // Instagram hashtags (Georgian RE demand)
    { platform:'INSTAGRAM', source_type:'INSTAGRAM_PROFILE', external_id:'tbilisihousing',
      name:'#tbilisihousing', url:'https://www.instagram.com/explore/tags/tbilisihousing/',
      country_code:'GE', language:'en', quality_score: 4 },
  ];

  const marketSources = SOURCES.filter(s => s.country_code === market.toUpperCase());
  for (const s of marketSources) {
    await sb.from('source_registry').upsert({
      ...s, active: true, provider: 'APIFY',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'platform,external_id', ignoreDuplicates: true });
  }
}

// ── MAIN HANDLER ──────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let jobId = '';

  try {
    const body = await req.json().catch(() => ({}));
    const {
      propertyId,
      campaignId,
      jobId: existingJobId,
      dryRun = false,
      validateOnly = false,
      targetMin = TARGET_MIN_CANDIDATES,
    } = body;

    if (!propertyId && !validateOnly) return json({ error: 'propertyId required' }, 400);

    // ── 1. Validate credentials ───────────────────────────
    if (validateOnly) {
      const dfseo  = new DataForSEOProvider();
      const dfseoV = await dfseo.validateCredentials().catch(e => ({ ok: false, error: String(e) }));
      const apify  = new ApifyProvider();
      const openai = new OpenAIClassifier();
      return json({
        dataforseo: { status: dfseo.isConfigured() ? (dfseoV.ok ? 'LIVE' : 'FAILED') : 'NOT_CONFIGURED', ...dfseoV },
        apify:      { status: apify.isConfigured()  ? 'LIVE' : 'NOT_CONFIGURED' },
        openai:     { status: openai.isConfigured() ? 'LIVE' : 'NOT_CONFIGURED' },
      });
    }

    // ── 2. Load property + facts (separate queries — avoids join issues) ─
    const { data: propRow, error: propErr } = await sb
      .from('properties')
      .select('id, transaction_type, property_type, matching_status, user_id')
      .eq('id', propertyId)
      .eq('is_deleted', false)
      .maybeSingle();

    if (propErr || !propRow) return json({ error: 'Property not found' }, 404);

    const { data: factsRow } = await sb
      .from('property_facts')
      .select('city, district, country, total_price, currency, area, bedrooms, condition, new_build, parking, balcony, elevator, furnished, features')
      .eq('property_id', propertyId)
      .maybeSingle();

    const snap: PropertySnapshot = {
      id:               propRow.id,
      country:          factsRow?.country ?? 'GE',
      city:             factsRow?.city ?? null,
      district:         factsRow?.district ?? null,
      transaction_type: propRow.transaction_type,
      property_type:    propRow.property_type,
      total_price:      factsRow?.total_price ? Number(factsRow.total_price) : null,
      currency:         factsRow?.currency ?? 'USD',
      area:             factsRow?.area ? Number(factsRow.area) : null,
      bedrooms:         factsRow?.bedrooms ? Number(factsRow.bedrooms) : null,
      condition:        factsRow?.condition ?? null,
      new_build:        factsRow?.new_build ?? false,
      parking:          factsRow?.parking ?? false,
      balcony:          factsRow?.balcony ?? false,
      elevator:         factsRow?.elevator ?? false,
      furnished:        factsRow?.furnished ?? false,
      amenities:        factsRow?.features ?? null, // DB column is `features`
      campaign_id:      campaignId ?? null,  // resolved later in 2b
    };

    // ── 2b. Resolve user_id + campaign_id ────────────────
    const resolvedUserId: string = propRow.user_id;

    // Look up existing campaign for this property, or use provided campaignId
    let resolvedCampaignId: string = campaignId ?? '';
    if (!resolvedCampaignId) {
      const { data: campRow } = await sb
        .from('matching_campaigns')
        .select('id')
        .eq('property_id', propertyId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (campRow?.id) {
        resolvedCampaignId = campRow.id;
      } else {
        // Auto-create a campaign so the job insert can succeed
        const { data: newCamp, error: campErr } = await sb
          .from('matching_campaigns')
          .insert({
            property_id: propertyId,
            user_id:     resolvedUserId,
            status: 'ACTIVE',
          })
          .select('id')
          .single();
        if (campErr || !newCamp) throw new Error(`Could not create matching_campaign: ${campErr?.message}`);
        resolvedCampaignId = newCamp.id;
      }
    }

    // ── 2c. dryRun — return profile + query packs, no DB writes ──
    if (dryRun) {
      const profile = buildIntentProfile(snap);
      const qPacks  = generateQueryPacks(profile);
      return json({ dryRun: true, intentProfile: profile, queryPackCount: qPacks.length,
        resolvedCampaignId, resolvedUserId });
    }

    // ── 3. Build/resume job ───────────────────────────────
    const idempotencyKey = `${propertyId}:${resolvedCampaignId}:${Date.now()}`;
    if (existingJobId) {
      jobId = existingJobId;
    } else {
      const { data: newJob, error: jobErr } = await sb
        .from('matching_jobs')
        .insert({
          property_id:      propertyId,
          campaign_id:      resolvedCampaignId,
          user_id:          resolvedUserId,
          idempotency_key:  idempotencyKey,
          status: 'queued',
          current_tier:     1,
          provider_results: {},
        })
        .select('id')
        .single();
      if (jobErr || !newJob) throw new Error(`Could not create matching_job: ${jobErr?.message}`);
      jobId = newJob.id;
    }

    // ── 4. Build IntentProfile ────────────────────────────
    await updateJob(sb, jobId, { status: 'searching_sources', started_at: new Date().toISOString() });
    await emitEvent(sb, jobId, 'PROFILE_BUILD', 'Building intent profile from property facts');

    const intentProfile = buildIntentProfile(snap);
    // Store intent_profile_snap — column added in migration
    await updateJob(sb, jobId, { intent_profile_snap: intentProfile });

    // Seed social sources for this market
    await ensureSocialSources(sb, snap.country);

    // ── 5. Provider instances ─────────────────────────────
    const dfseo  = new DataForSEOProvider();
    const apify  = new ApifyProvider();
    const openai = new OpenAIClassifier();

    // Hard-fail if any required provider is missing — no mock fallbacks in production
    if (!dfseo.isConfigured()) {
      await emitEvent(sb, jobId, 'PROVIDER_FATAL', 'DataForSEO credentials not configured');
      await updateJob(sb, jobId, { status: 'failed', failure_reason: 'DATAFORSEO_NOT_CONFIGURED',
        error_message: 'DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD secrets must be set' });
      return new Response(JSON.stringify({ error: 'DATAFORSEO_NOT_CONFIGURED' }), { status: 500, headers: CORS });
    }
    if (!openai.isConfigured()) {
      await emitEvent(sb, jobId, 'PROVIDER_FATAL', 'OpenAI API key not configured');
      await updateJob(sb, jobId, { status: 'failed', failure_reason: 'OPENAI_NOT_CONFIGURED',
        error_message: 'OPENAI_API_KEY secret must be set' });
      return new Response(JSON.stringify({ error: 'OPENAI_NOT_CONFIGURED' }), { status: 500, headers: CORS });
    }
    if (!apify.isConfigured()) {
      await emitEvent(sb, jobId, 'PROVIDER_FATAL', 'Apify token not configured');
      await updateJob(sb, jobId, { status: 'failed', failure_reason: 'APIFY_NOT_CONFIGURED',
        error_message: 'APIFY_TOKEN secret must be set' });
      return new Response(JSON.stringify({ error: 'APIFY_NOT_CONFIGURED' }), { status: 500, headers: CORS });
    }
    const providerStatus = {
      dataforseo: 'LIVE',
      apify:      'LIVE',
      openai:     'LIVE',
    };
    await updateJob(sb, jobId, { provider_results: providerStatus });

    await emitEvent(sb, jobId, 'PROVIDERS_READY', 'Providers initialised', providerStatus);

    // ── 6. Validate DataForSEO creds on first use ─────────
    {
      const credCheck = await dfseo.validateCredentials();
      if (!credCheck.ok) {
        await emitEvent(sb, jobId, 'DATAFORSEO_CRED_FAIL',
          `DataForSEO credential check failed — aborting`, { error: credCheck.error });
        await updateJob(sb, jobId, { status: 'failed', failure_reason: 'DATAFORSEO_CRED_FAIL',
          error_message: credCheck.error?.slice(0, 200) });
        return new Response(JSON.stringify({ error: 'DATAFORSEO_CRED_FAIL', detail: credCheck.error }), { status: 500, headers: CORS });
      }
    }

    // ── 7. Tier expansion loop ────────────────────────────
    let currentTier = 1;
    let totalCandidates = 0;
    const allSignalIds: string[] = [];

    while (currentTier <= MAX_TIERS && totalCandidates < MAX_CANDIDATES_PER_JOB) {
      await emitEvent(sb, jobId, `TIER_${currentTier}_START`,
        `Starting tier ${currentTier} research`, { tier: currentTier });
      await updateJob(sb, jobId, { current_tier: currentTier, tiers_run: currentTier });

      const queryPacks = generateQueryPacks(intentProfile)
        .filter(p => p.tier === currentTier);

      // ── 7a. DataForSEO Standard tasks ──────────────────
      let dfseoSignals = 0;
      if (await isProviderAllowed(sb, 'DATAFORSEO')) {
        try {
          await emitEvent(sb, jobId, 'DFSEO_START',
            `DataForSEO: submitting ${queryPacks.reduce((s, p) => s + p.queries.length, 0)} queries (tier ${currentTier})`);

          const queryPackRows: Array<{ id: string; queries: string[]; language: string }> = [];

          for (const pack of queryPacks) {
            if (!pack.queries.length) continue;

            // Upsert query_pack row
            const qHash = await (async () => {
              const buf = await crypto.subtle.digest('SHA-256',
                new TextEncoder().encode(pack.queries.join('|') + pack.language));
              return Array.from(new Uint8Array(buf)).slice(0, 8)
                .map(b => b.toString(16).padStart(2, '0')).join('');
            })();

            const { data: qp, error: qpErr } = await sb.from('query_packs').upsert({
              job_id:           jobId,
              property_id:      propertyId,
              campaign_id:      resolvedCampaignId,
              country:          snap.country,
              city:             snap.city ?? null,
              district:         snap.district ?? null,
              language:         pack.language,
              transaction:      snap.transaction_type ?? null,
              property_type:    snap.property_type ?? null,
              intent_type:      intentProfile.purposeCode,
              tier:             currentTier,
              expansion_tier:   currentTier,
              tier_reason:      pack.tierReason,
              queries:          pack.queries,
              query_hash:       qHash,
              property_snapshot: snap,
              intent_profile_snap: intentProfile,
              active:           true,
              pack_status:      'running',
              started_at:       new Date().toISOString(),
              priority:         currentTier === 1 ? 10 : 5,
            }, { onConflict: 'job_id,query_hash' })
              .select('id, queries, language')
              .maybeSingle();

            if (qpErr) {
              await emitEvent(sb, jobId, 'QUERY_PACK_ERROR',
                `query_pack upsert failed: ${qpErr.message.slice(0, 100)}`);
            }
            if (qp) queryPackRows.push(qp);
          }

          // Run DataForSEO Live (Standard queue needs polling EF — use Live for this job)
          for (const qp of queryPackRows) {
            const allowed = await isProviderAllowed(sb, 'DATAFORSEO');
            if (!allowed) break;

            const queries = (qp.queries as string[]).map(q => ({
              q,
              language: qp.language,
              country:  snap.country,
              tier:     currentTier,
            }));

            // dfseo is always configured here — hard-fail guard is above
            const response = await dfseo.searchLive(queries).catch(async (e: unknown) => {
              const msg = e instanceof Error ? e.message : String(e);
              await emitEvent(sb, jobId, 'DFSEO_ERROR', `DataForSEO error: ${msg.slice(0,200)}`, { pack_id: qp.id });
              await logCost(sb, 'DATAFORSEO', 'SERP_SEARCH', 0, false, { job_id: jobId });
              await sb.from('query_packs').update({ pack_status: 'failed', completed_at: new Date().toISOString() }).eq('id', qp.id);
              return null;
            });

            if (!response) continue;

            await logCost(sb, response.provider, 'SERP_SEARCH',
              response.costUsd, true, { job_id: jobId });

            // Update query_pack with results count
            await sb.from('query_packs')
              .update({ results_count: response.results.length, pack_status: 'done', completed_at: new Date().toISOString() })
              .eq('id', qp.id);

            // Insert raw_signals (deduplicated by canonical URL)
            for (const result of response.results) {
              const norm = await normaliseSearchResult(result, false);
              const { error: sigErr } = await sb.from('raw_signals').insert({
                job_id:               jobId,
                query_pack_id:        qp.id,
                source_id:            null,
                platform:             'GOOGLE',
                external_id:          norm.canonicalUrl,
                source_url:           norm.sourceUrl,
                original_text:        norm.text,
                title:                result.title,
                snippet_text:         result.snippet,
                domain:               result.domain ?? null,
                rank_position:        result.rankPosition ?? null,
                language:             qp.language,
                published_at:         norm.publishedAt ?? null,
                content_fingerprint:  norm.fingerprint,
                provider:             response.provider,
                tier:                 currentTier,
                query_text:           result.queryText ?? null,
                dataforseo_task_id:   result.taskId ?? null,
                classification_status: 'PENDING',
                mock_mode:            norm.isMock,
              });

              if (!sigErr) dfseoSignals++;
              // Ignore 23505 duplicate — canonical URL already stored
            }
          }

          await emitEvent(sb, jobId, 'DFSEO_DONE',
            `DataForSEO: ${dfseoSignals} signals collected (tier ${currentTier})`,
            { signals: dfseoSignals });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          await emitEvent(sb, jobId, 'DFSEO_FATAL',
            `DataForSEO source-level failure: ${msg.slice(0,100)}`);
        }
      }

      // ── 7b. Apify social collection ─────────────────────
      const platforms = ['FACEBOOK', 'TELEGRAM', 'INSTAGRAM', 'VK'] as const;
      let apifySignals = 0;

      for (const platform of platforms) {
        if (!(await isProviderAllowed(sb, 'APIFY'))) break;
        if (totalCandidates + allSignalIds.length >= MAX_CANDIDATES_PER_JOB) break;

        // Find active sources for this platform+market
        const { data: sources } = await sb.from('source_registry')
          .select('id, url, language, quality_score, external_id')
          .eq('platform', platform)
          .eq('country_code', snap.country)
          .eq('active', true)
          .order('quality_score', { ascending: false })
          .limit(SOCIAL_SOURCES_PER_PLATFORM);

        if (!sources?.length) continue;

        // Check for existing Apify run for this job+platform (idempotent)
        const { data: existingRun } = await sb.from('apify_actor_runs')
          .select('run_id, dataset_id, status, dataset_fetched')
          .eq('job_id', jobId)
          .eq('platform', platform)
          .maybeSingle();

        try {
          // Check actor ID — hard-fail per platform, continue to others
          const actorId = Deno.env.get(`APIFY_${platform}_ACTOR_ID`) ?? '';
          if (!actorId) {
            await emitEvent(sb, jobId, `APIFY_${platform}_SKIP`,
              `APIFY_PLATFORM_NOT_CONFIGURED: APIFY_${platform}_ACTOR_ID not set — skipping`);
            continue;
          }

          const apifyReq = {
            platform,
            sourceUrl:   sources[0].url,
            sourceUrls:  sources.map(s => s.url),
            maxItems:    80,
            existingRunId: (existingRun && existingRun.status !== 'FAILED')
              ? existingRun.run_id : undefined,
            jobId,
          };

          await emitEvent(sb, jobId, `APIFY_${platform}_START`,
            `Apify ${platform}: starting collection from ${sources.length} source(s)`);

          const result = await apify.collect(apifyReq);

          // Persist actor run record (real run_id, dataset_id, actor_id)
          await sb.from('apify_actor_runs').upsert({
            job_id:          jobId,
            query_pack_id:   null,
            platform,
            actor_id:        actorId,
            run_id:          result.runMeta.runId,
            dataset_id:      result.runMeta.datasetId ?? null,
            status:          result.runMeta.status,
            items_returned:  result.posts.length,
            cost_usd:        result.costUsd,
            started_at:      result.runMeta.startedAt,
            finished_at:     result.runMeta.finishedAt ?? null,
            dataset_fetched: !result.partial,
          }, { onConflict: 'run_id' });

          await logCost(sb, result.provider, `COLLECT_${platform}`,
            result.costUsd, result.runMeta.status === 'SUCCEEDED', { job_id: jobId });

          if (result.partial) {
            await emitEvent(sb, jobId, `APIFY_${platform}_PARTIAL`,
              `Apify ${platform} run still in progress — will retry on next job`);
            continue;
          }

          const posts = result.posts;
          const bestSource = sources[0];
          let platformSignals = 0;

          // Normalise + insert raw signals (mock_mode always false here)
          for (const post of posts) {
            const norm = await normalisePost(post, false);
            if (!norm.text || norm.text.length < 20) continue;

            const { error: sigErr } = await sb.from('raw_signals').insert({
              job_id:              jobId,
              source_id:           bestSource.id,
              platform:            platform as string,
              external_id:         norm.externalId,
              source_url:          norm.sourceUrl,
              author_public_name:  norm.authorName ?? null,
              author_public_url:   norm.authorUrl ?? null,
              original_text:       norm.text,
              language:            bestSource.language ?? null,
              published_at:        norm.publishedAt ?? null,
              content_fingerprint: norm.fingerprint,
              provider:            'APIFY',
              tier:                currentTier,
              classification_status: 'PENDING',
              mock_mode:           false,
            });

            if (sigErr) {
              await emitEvent(sb, jobId, 'RAW_SIGNAL_INSERT_ERROR',
                `raw_signals insert failed: ${sigErr.message.slice(0,120)}`, { platform });
            } else {
              platformSignals++;
              apifySignals++;
            }
          }

          await emitEvent(sb, jobId, `APIFY_${platform}_DONE`,
            `Apify ${platform}: ${posts.length} posts → ${platformSignals} signals`,
            { posts: posts.length, signals: platformSignals, run_id: result.runMeta.runId, dataset_id: result.runMeta.datasetId ?? null });

        } catch (e: unknown) {
          // Source-level partial failure — do not destroy other results
          const msg = e instanceof Error ? e.message : String(e);
          await emitEvent(sb, jobId, `APIFY_${platform}_ERROR`,
            `Apify ${platform} source-level failure: ${msg.slice(0,100)}`);
          await logCost(sb, 'APIFY', `COLLECT_${platform}`, 0, false, { job_id: jobId });
        }
      }

      // ── 7c. Update job signal counts (direct SQL — no RPC needed) ─
      const totalNewSignals = dfseoSignals + apifySignals;
      if (totalNewSignals > 0) {
        try {
          const { error: rpcErr } = await sb.rpc('increment_job_signals', {
            p_job_id: jobId,
            p_count:  totalNewSignals,
          });
          if (rpcErr) throw rpcErr;
        } catch {
          // RPC may not exist yet on older deployments — fall back to read-then-write
          const { data: jRow } = await sb.from('matching_jobs')
            .select('signals_collected').eq('id', jobId).maybeSingle();
          await sb.from('matching_jobs').update({
            signals_collected: (Number(jRow?.signals_collected ?? 0)) + totalNewSignals,
            updated_at: new Date().toISOString(),
          }).eq('id', jobId);
        }
      }

      // ── 7d. Classify PENDING signals for this job ──────
      await emitEvent(sb, jobId, 'CLASSIFY_START',
        `Classifying PENDING signals for job ${jobId} (tier ${currentTier})`);

      const { data: pendingSignals } = await sb.from('raw_signals')
        .select('id, original_text, language, platform, published_at, source_id, source_url, mock_mode')
        .eq('job_id', jobId)
        .eq('classification_status', 'PENDING')
        .limit(200);

      let classified = 0;
      let filteredOut = 0;
      let openaiCost = 0;

      for (const signal of pendingSignals ?? []) {
        // Cheap pre-filter
        const cf = cheapFilter(signal.original_text);
        if (!cf.pass) {
          await sb.from('raw_signals')
            .update({ classification_status: 'FILTERED_OUT', rejection_reason: cf.reason })
            .eq('id', signal.id);
          filteredOut++;
          continue;
        }

        // Spend cap for OpenAI
        if (!(await isProviderAllowed(sb, 'OPENAI'))) {
          await emitEvent(sb, jobId, 'OPENAI_CAP', 'OpenAI spend cap reached — stopping classification');
          break;
        }

        let intent;
        try {
          intent = await openai.classify({
            text:     signal.original_text,
            language: signal.language ?? undefined,
            propertyContext: {
              country:         snap.country,
              city:            snap.city,
              transactionType: snap.transaction_type,
            },
          });
          openaiCost += intent.costUsd;
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          await sb.from('raw_signals')
            .update({ classification_status: 'ERROR' })
            .eq('id', signal.id);
          await emitEvent(sb, jobId, 'CLASSIFY_ERROR', `OpenAI error: ${msg.slice(0,100)}`);
          continue;
        }

        // Log OpenAI cost per signal
        if (intent.costUsd > 0) {
          await logCost(sb, 'OPENAI', 'CLASSIFY_SIGNAL', intent.costUsd, true,
            { job_id: jobId, signal_id: signal.id });
        }

        // Post-AI filter
        const publishedAt  = signal.published_at ?? null;
        const recencyDays  = publishedAt
          ? (Date.now() - new Date(publishedAt).getTime()) / 86_400_000
          : 30;
        const paf = postAIFilter(intent, { country: snap.country, transaction_type: snap.transaction_type }, recencyDays);

        if (!paf.pass) {
          await sb.from('raw_signals')
            .update({ classification_status: 'FILTERED_OUT', rejection_reason: paf.reason })
            .eq('id', signal.id);
          filteredOut++;
          continue;
        }

        // Compute dedup hash + score
        const dHash = await dedupHash(intent, (signal as Record<string, unknown>).source_url as string ?? '');
        const { data: srcRow } = await sb.from('source_registry')
          .select('quality_score').eq('id', signal.source_id ?? '').maybeSingle();
        const sourceQuality = Number(srcRow?.quality_score ?? 5);

        const components: ScorerComponents = scoreCandidate({
          property:    snap,
          intent,
          publishedAt: publishedAt ?? undefined,
          sourceQuality,
        });

        if (components.label === 'rejected') {
          await sb.from('raw_signals')
            .update({ classification_status: 'FILTERED_OUT', rejection_reason: components.rejectionReason })
            .eq('id', signal.id);
          filteredOut++;
          continue;
        }

        // Check for semantic near-duplicate by dedup_hash
        const { data: dupProfile } = await sb.from('intent_profiles')
          .select('id').eq('dedup_hash', dHash).maybeSingle();

        if (dupProfile) {
          // Merge evidence link into existing profile — append signal id if not already present
          const { data: existing } = await sb.from('intent_profiles')
            .select('merged_signal_ids').eq('id', dupProfile.id).maybeSingle();
          const current: string[] = (existing?.merged_signal_ids as string[]) ?? [];
          if (!current.includes(signal.id)) {
            await sb.from('intent_profiles').update({
              merged_signal_ids: [...current, signal.id],
            }).eq('id', dupProfile.id);
          }
          await sb.from('raw_signals')
            .update({ classification_status: 'CLASSIFIED' })
            .eq('id', signal.id);
          classified++;
          continue;
        }

        // Insert IntentProfile
        const fingerprint = await contentFingerprint(signal.original_text);
        const { data: profile, error: ipErr } = await sb.from('intent_profiles').insert({
          signal_id:           signal.id,
          job_id:              jobId,
          tier:                currentTier,
          intent_type:         intent.intentType,
          country:             intent.country ?? snap.country,
          region:              intent.region ?? null,
          city:                intent.city ?? null,
          district:            intent.district ?? null,
          neighborhoods:       intent.neighborhoods ?? null,
          transaction_type:    intent.transactionType ?? null,
          property_types:      intent.propertyTypes ?? null,
          bedrooms_min:        intent.bedroomsMin ?? null,
          bedrooms_max:        intent.bedroomsMax ?? null,
          area_min:            intent.areaMin ?? null,
          area_max:            intent.areaMax ?? null,
          budget_min:          intent.budgetMin ?? null,
          budget_max:          intent.budgetMax ?? null,
          currency:            intent.currency ?? null,
          timeline:            intent.timeline ?? null,
          relocation_intent:   intent.relocationIntent,
          investment_intent:   intent.investmentIntent,
          language:            intent.language ?? signal.language ?? null,
          intent_confidence:   intent.intentConfidence,
          specificity_score:   intent.specificityScore,
          actionability_score: intent.actionabilityScore,
          original_text:       signal.original_text,
          translated_text:     intent.translatedText ?? null,
          ai_model:            intent.model,
          ai_cost_usd:         intent.costUsd,
          classifier_version:  intent.promptVersion,
          score_intent:        components.intent,
          score_geo:           components.geography,
          score_budget:        components.budget,
          score_compat:        components.compatibility,
          score_freshness:     components.freshness,
          score_quality:       components.evidenceQuality,
          score_contact:       components.contactability,
          total_score:         components.total,
          score_label:         components.label,
          rejection_reason:    components.rejectionReason ?? null,
          dedup_hash:          dHash,
          mock_mode:           signal.mock_mode ?? false,
          property_id:         propertyId,
          campaign_id:         resolvedCampaignId,
        }).select('id').single();

        if (ipErr) {
          await emitEvent(sb, jobId, 'INTENT_INSERT_ERROR', ipErr.message);
          continue;
        }

        await sb.from('raw_signals')
          .update({ classification_status: 'CLASSIFIED' })
          .eq('id', signal.id);

        if (profile) allSignalIds.push(signal.id);
        classified++;
      }

      if (openaiCost > 0) {
        await logCost(sb, 'OPENAI', 'CLASSIFY_BATCH', openaiCost, true, { job_id: jobId });
      }

      await emitEvent(sb, jobId, 'CLASSIFY_DONE',
        `Classified: ${classified}, filtered: ${filteredOut} (tier ${currentTier})`,
        { classified, filteredOut, openaiCost });

      // ── 7e. Count usable candidates so far ─────────────
      const { count: candidateCount } = await sb.from('intent_profiles')
        .select('id', { count: 'exact', head: true })
        .eq('job_id', jobId)
        .neq('score_label', 'rejected')
        .neq('intent_type', 'UNKNOWN');

      totalCandidates = candidateCount ?? 0;

      await emitEvent(sb, jobId, `TIER_${currentTier}_DONE`,
        `Tier ${currentTier} done. Usable candidates: ${totalCandidates}`,
        { tier: currentTier, candidates: totalCandidates });

      // ── 7f. Tier advancement decision ──────────────────
      if (shouldAdvanceTier(currentTier, totalCandidates, targetMin)) {
        currentTier++;
        await emitEvent(sb, jobId, 'TIER_ADVANCE',
          `Advancing to tier ${currentTier} (candidates ${totalCandidates} < target ${targetMin})`);
      } else {
        break; // target reached
      }
    }

    // ── 8. Create Match records ───────────────────────────
    await emitEvent(sb, jobId, 'MATCH_START',
      `Creating match records for ${totalCandidates} candidates`);

    let matchesCreated = 0;
    let matchesSkipped = 0;

    const { data: profiles } = await sb.from('intent_profiles')
      .select('*')
      .eq('job_id', jobId)
      .neq('score_label', 'rejected')
      .order('total_score', { ascending: false })
      .limit(MAX_CANDIDATES_PER_JOB);

    for (const profile of profiles ?? []) {
      // Skip if match already exists (re-run guard)
      const { data: existing } = await sb.from('matches')
        .select('id').eq('property_id', propertyId)
        .eq('intent_profile_id', profile.id).maybeSingle();
      if (existing) { matchesSkipped++; continue; }

      const totalScore = Number(profile.total_score ?? 0);
      const strength   = signalStrengthFromScore(totalScore);

      // Get source for recency
      const { data: signalRow } = await sb.from('raw_signals')
        .select('published_at').eq('id', profile.signal_id ?? '').maybeSingle();
      const publishedAt = signalRow?.published_at ?? null;

      const unlockPrice = calculateUnlockPrice(strength, {
        intent:         Number(profile.score_intent ?? 0),
        geography:      Number(profile.score_geo ?? 0),
        budget:         Number(profile.score_budget ?? 0),
        compatibility:  Number(profile.score_compat ?? 0),
        freshness:      Number(profile.score_freshness ?? 0),
        evidenceQuality: Number(profile.score_quality ?? 0),
        contactability: Number(profile.score_contact ?? 0),
        total:          totalScore,
        label:          (profile.score_label as 'strong' | 'good' | 'exploratory') ?? 'exploratory',
      });

      const recencyHours = publishedAt
        ? (Date.now() - new Date(publishedAt).getTime()) / 3_600_000
        : 72;

      const previewExcerpt = (profile.original_text ?? profile.translated_text ?? '')
        .slice(0, 80).trim() + '…';

      const bedsStr = profile.bedrooms_min
        ? `${profile.bedrooms_min}${profile.bedrooms_max ? `–${profile.bedrooms_max}` : '+'}`
        : null;

      const { error: matchErr } = await sb.from('matches').insert({
        property_id:          propertyId,
        campaign_id:          resolvedCampaignId,
        user_id:              resolvedUserId,
        signal_id:            profile.signal_id ?? null,
        intent_profile_id:    profile.id,
        job_id:               jobId,
        tier:                 Number(profile.tier ?? 1),
        match_score:          totalScore,
        intent_confidence:    Number(profile.intent_confidence ?? 0),
        signal_strength:      strength,
        match_reasons:        buildMatchReasons(profile),
        mismatch_reasons:     [],
        unlock_price_credits: unlockPrice,
        status:               'NEW',
        mock_mode:            profile.mock_mode ?? false,
        score_intent:         profile.score_intent,
        score_geo:            profile.score_geo,
        score_budget:         profile.score_budget,
        score_compat:         profile.score_compat,
        score_freshness:      profile.score_freshness,
        score_quality:        profile.score_quality,
        score_contact:        profile.score_contact,
        preview_platform:     (platform_for_match(profile)) as string,
        preview_language:     profile.language ?? null,
        preview_city:         profile.city ?? null,
        preview_budget_min:   profile.budget_min ?? null,
        preview_budget_max:   profile.budget_max ?? null,
        preview_currency:     profile.currency ?? null,
        preview_bedrooms:     bedsStr,
        preview_excerpt:      previewExcerpt,
        preview_recency:      formatRecency(recencyHours),
      });

      if (!matchErr) {
        matchesCreated++;
      }
    }

    // ── 9. Zero-result guard ──────────────────────────────
    const jobStatus = matchesCreated === 0 && totalCandidates === 0
      ? (allSignalIds.length > 0 ? 'partially_completed' : 'partially_completed')
      : 'completed';

    // ── 10. Finalise job ──────────────────────────────────
    await updateJob(sb, jobId, {
      status:              jobStatus,
      signals_classified:  totalCandidates,
      candidates_after_filter: totalCandidates,
      matches_created:     matchesCreated,
      completed_at:        new Date().toISOString(),
      progress:            100,
    });

    await emitEvent(sb, jobId, 'JOB_DONE',
      `Job ${jobStatus}: ${matchesCreated} matches from ${totalCandidates} candidates`,
      { matchesCreated, totalCandidates, tiersRun: currentTier, jobStatus });

    // Notify user of strong matches
    if (matchesCreated > 0) {
      await notifyStrongMatches(sb, propertyId, jobId);
    }

    return json({
      success: true,
      jobId,
      jobStatus,
      tiersRun:        currentTier,
      totalCandidates,
      matchesCreated,
      matchesSkipped,
      providerStatus,
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[match-campaign] fatal error:', msg);

    if (jobId) {
      const sb2 = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );
      await sb2.from('matching_jobs').update({
        status: 'failed',
        failure_reason: msg.slice(0, 500),
        completed_at:   new Date().toISOString(),
      }).eq('id', jobId);
      await sb2.from('matching_job_events').insert({
        job_id: jobId, event_type: 'FATAL_ERROR', payload: { message: msg.slice(0, 500) },
      });
    }
    return json({ error: msg.slice(0, 200), jobId }, 500);
  }
});

// ── HELPERS ───────────────────────────────────────────────────

// Map intent_profile platform back to signal_platform enum value
// deno-lint-ignore no-explicit-any
function platform_for_match(profile: any): string {
  const p = String(profile.platform ?? profile.preview_platform ?? 'OTHER').toUpperCase();
  const VALID = new Set(['GOOGLE','BING','FACEBOOK','TELEGRAM','INSTAGRAM','VK','FORUM','WEBSITE','OTHER']);
  return VALID.has(p) ? p : 'OTHER';
}

// deno-lint-ignore no-explicit-any
function buildMatchReasons(profile: any): string[] {
  const r: string[] = [];
  if (Number(profile.score_intent  ?? 0) > 15) r.push(`Strong demand intent (${profile.intent_type})`);
  if (Number(profile.score_geo     ?? 0) > 12) r.push(`City match: ${profile.city}`);
  if (Number(profile.score_budget  ?? 0) > 10) r.push('Budget compatible');
  if (Number(profile.score_compat  ?? 0) > 10) r.push('Property type & size match');
  if (Number(profile.score_freshness ?? 0) > 7) r.push('Recent signal');
  if (profile.relocation_intent) r.push('Relocation intent');
  if (profile.investment_intent) r.push('Investment intent');
  return r;
}

function formatRecency(hours: number): string {
  if (hours < 1)  return `${Math.round(hours * 60)}m ago`;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

async function notifyStrongMatches(
  sb: SupabaseClient,
  propertyId: string,
  jobId: string,
) {
  // Load strong matches
  const { data: strongMatches } = await sb.from('matches')
    .select('id, signal_strength')
    .eq('property_id', propertyId)
    .eq('job_id', jobId)
    .in('signal_strength', ['STRONG','VERY_STRONG','EXCEPTIONAL'])
    .eq('status', 'NEW')
    .limit(5);

  if (!strongMatches?.length) return;

  // Load property owner separately to avoid join permission issues
  const { data: propRow } = await sb.from('properties')
    .select('user_id').eq('id', propertyId).maybeSingle();
  const userId = propRow?.user_id;
  if (!userId) return;

  for (const m of strongMatches) {
    try {
      await sb.from('notifications').insert({
        user_id:     userId,
        type:        'MATCH_AVAILABLE',
        title:       `New ${m.signal_strength} match found`,
        body:        'A strong buyer intent signal matched your property.',
        property_id: propertyId,
        metadata:    { match_id: m.id, signal_strength: m.signal_strength, job_id: jobId },
      });
    } catch { /* notification failure is non-fatal */ }
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
