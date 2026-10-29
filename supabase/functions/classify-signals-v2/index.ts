// HOMATCH — signal classification, and the failure that was not a failure.
//
// WHAT WAS WRONG HERE, MEASURED RATHER THAN GUESSED
//
// Production held 510 ERROR against 119 CLASSIFIED, which reads as a broken
// pipeline. The ERROR rows are not spread over time the way individual
// content judgements would be -- around 85% of them arrived in seven single
// minutes, each spanning dozens of unrelated sources:
//
//   2026-08-28 22:30   111 errors across 31 distinct sources
//   2026-08-28 21:45    83 errors across 57 distinct sources
//
// That is the shape of the catch at the bottom of this file. One OpenAI call
// threw, and every signal in the chunk -- up to 300, from sources with
// nothing in common -- was written ERROR.
//
// And ERROR was TERMINAL, because the selector below reads only PENDING. A
// network timeout permanently discarded hundreds of signals that had never
// been read. Nothing retried them and nothing could.
//
// So a batch failure now returns its signals to PENDING with the attempt
// counted, and only an exhausted count is terminal. The three causes are
// recorded separately -- BATCH_FAILED is the provider, MODEL_OMITTED is the
// model declining to say anything, WRITE_FAILED is ours -- because one word
// for three different things is what made this invisible for a month.
//
// The OTHER half of that 510 is not fixable here: 139 signals came from
// r/Riyadh and r/opensooqsd, and 83 from r/CheatProctoredTests and
// r/GeorgiaRealEstateExam -- the US state's licensing exam, registered by a
// retired discovery sweep for "Georgia real estate". Those are posts about
// passing an AWS certification, correctly producing no property intent. They
// are a SOURCE SELECTION defect, and source_lifecycle keeps them out.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { recordUsageCost, tokenUsage } from '../_shared/providerCost.ts';
import { loadDiscoverySettings } from '../_shared/discoverySettings.ts';
import { recordCommunitySupply } from '../_shared/communitySupply.ts';
import { extractCommunityListing } from '../../../src/research-core/discovery/community-listing.ts';
import { safeWebUrl } from '../../../src/research-core/discovery/source-link.ts';
import { CLASSIFIER_VERSION, DEMAND_LABELS, discoveryLabelFor, reusableVerdict, routeFor } from '../../../src/research-core/discovery/signal-taxonomy.ts';
import { RULES_MODEL, ruleSignalVerdict } from '../../../src/research-core/discovery/signalRules.ts';
import { AI_SWITCHES, aiSwitchOn, selectForModel, SIGNALS_AI_MAX_ITEMS_PER_TICK } from '../../../src/research-core/findBuyers/aiPolicy.ts';
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'};
const json=(d:any,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...CORS,'Content-Type':'application/json'}});
const DEMAND=new Set(['BUY','RENT','INVEST','RELOCATE_BUY','RELOCATE_RENT']);
/* Three tries. Enough to cross a provider blip, few enough that a signal
   nothing can classify stops consuming budget. */
const MAX_ATTEMPTS=3;
/* An ambiguous signal filtered out because the model switch was off: never a reusable verdict. */
const AMBIGUOUS_AI_OFF='rules_ambiguous_ai_off';

Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:CORS});
 const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 const db=createClient(Deno.env.get('SUPABASE_URL')!,serviceKey);

 /*
  * AN UNAUTHENTICATED ENDPOINT THAT SPENDS MONEY.
  *
  * This function is deployed --no-verify-jwt, which is right: it is a worker
  * tick with no customer and no user JWT. But it had no check of its own
  * either, so anybody who knew the URL could call it, and every call reads a
  * batch of up to 500 signals and pays OpenAI for them. The cost lands in
  * cost_events as ours.
  *
  * Same token shape as every other tick here -- supply_discovery_token,
  * demand_discovery_token, revalidation_worker_token -- read from
  * admin_settings, never from a file. A caller holding the service key is
  * also accepted, which is how the in-cluster workers reach it.
  */
 const presented=req.headers.get('x-cron-token')||'';
 const authorization=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
 if(authorization!==serviceKey){
   const {data:tokenRow}=await db.from('admin_settings').select('value').eq('key','classify_signals_token').maybeSingle();
   const expected=String(tokenRow?.value??'').replace(/^"|"$/g,'');
   if(!expected||presented!==expected)return json({error:'Forbidden'},403);
 }

 try{
  const {batchSize=300,market='GE',source=null,mode=null,after:afterRaw=null,dryRun:dryRunRaw=false}=await req.json().catch(()=>({}));
  /* One id per tick: the correlation every OpenAI call of this run is recorded under. */
  const costRunId=`classify-v2:${market}:${crypto.randomUUID()}`;
  /*
   * PHASE 2 BACKFILL: listing posts filtered out of demand before community
   * supply existed. Deterministic, no model call, no spend; idempotent by
   * (source_id, external_id). Already-classified rows keep their verdict.
   */
  if(mode==='community-supply-backfill'){
    /* Oldest first with a cursor, so repeated calls walk the whole backlog
       instead of re-reading the newest 500. dryRun reads and extracts but
       writes nothing (the readiness report runs it that way). */
    const after=typeof afterRaw==='string'&&!Number.isNaN(Date.parse(afterRaw))?afterRaw:null;
    const dryRun=dryRunRaw===true;
    let query=db.from('raw_signals').select('id,original_text,language,platform,author_is_agency,content_fingerprint,source_id,external_id,source_url,published_at,discovered_at,source:source_registry!source_id(country_code,language,city)')
      .eq('classification_status','FILTERED_OUT').eq('research_direction','SUPPLY').in('platform',['TELEGRAM','FORUM']);
    if(after)query=query.gt('discovered_at',after);
    const {data:rows,error:readError}=await query.order('discovered_at',{ascending:true}).order('id',{ascending:true}).limit(Math.min(500,Number(batchSize)||200));
    if(readError)throw readError;
    let recorded=0,unstructured=0,failed=0,wouldRecord=0;
    for(const row of rows??[]){
      if(dryRun){if(safeWebUrl((row as any).source_url)&&extractCommunityListing(String((row as any).original_text??''),{sourceCity:(Array.isArray((row as any).source)?(row as any).source[0]:(row as any).source)?.city??null}))wouldRecord++;else unstructured++;continue;}
      try{if(await recordCommunitySupply(db,row as any))recorded++;else unstructured++;}catch(e){failed++;console.error('backfill failed',(row as any).id,e instanceof Error?e.message:String(e));}
    }
    const last=(rows??[]).at(-1) as any;
    return json({success:true,mode,dryRun,read:(rows??[]).length,recorded,wouldRecord,unstructured,failed,modelCalls:0,
      nextCursor:(rows??[]).length===Math.min(500,Number(batchSize)||200)&&last?last.discovered_at:null});
  }
  /* The five-minute schedule does nothing until classifier_schedule_enabled
     is on: every call it makes spends model tokens. */
  if(source==='cron'){
    const discovery=await loadDiscoverySettings(db);
    if(!discovery.classifierScheduleEnabled)return json({success:true,skipped:'CLASSIFIER_SCHEDULE_DISABLED',processed:0});
  }
  const {data:signals,error}=await db.from('raw_signals').select(`id,original_text,language,platform,classification_attempts,research_direction,author_is_agency,content_fingerprint,source_id,external_id,source_url,published_at,source:source_registry!source_id(country_code,language,city)`).eq('classification_status','PENDING').lt('classification_attempts',MAX_ATTEMPTS).order('classification_attempts',{ascending:true}).order('discovered_at',{ascending:true}).limit(Math.min(500,batchSize));
  if(error)throw error;if(!signals?.length)return json({success:true,processed:0,classified:0,filteredOut:0,deterministicFiltered:0,errors:0});
  let retried=0;let supplyObservations=0,supplyErrors=0;let classified=0,filteredOut=0,deterministicFiltered=0,errors=0,totalCostUsd=0,modelOmitted=0,cacheHits=0;
  /* Every verdict carries the nine-label taxonomy and the classifier version
     that produced it (research-core/discovery/signal-taxonomy.ts). */
  const labels:Record<string,number>={};
  const tag=(v:any,input:{intentType?:string|null;transactionType?:string|null;confidence?:number|null;agencyVoice?:boolean|null;direction?:string|null})=>{const discoveryLabel=discoveryLabelFor(input);labels[discoveryLabel]=(labels[discoveryLabel]||0)+1;return {...v,discoveryLabel,route:routeFor(discoveryLabel),classifierVersion:CLASSIFIER_VERSION};};
  const aiSignals:any[]=[];
  /*
   * THE DETERMINISTIC VERDICT IS ALREADY ON THE ROW. USE IT.
   *
   * demand-discovery runs classifyDirection() when it reads a post and
   * stores research_direction and author_is_agency. This function used to
   * ignore both and form its own opinion with isSupplyAd() -- two
   * deterministic judgements about the same question, neither aware of the
   * other, and the richer one discarded.
   *
   * Two reasons to use it. A post the reader already knows is SUPPLY, or is
   * an agency advertising, is not a buyer lead and should not cost a model
   * call to find that out. And the reader's verdict carries the matched
   * phrases, so the reason a signal was dropped is a phrase somebody can
   * read rather than "deterministic_supply_filter".
   *
   * NULL IS NOT FALSE, on either field. Every signal collected before these
   * columns existed has them null, and those still go to the model -- the
   * question was never asked of them, and refusing them here would silently
   * retire 868 rows nobody re-examined.
   *
   * UNKNOWN is not decided here either: it goes on to the six-language rules
   * below (RULES FIRST), and only what they cannot decide may reach the model.
   */
  for(const s of signals){
    const direction=String((s as any).research_direction||'');
    const agencyVoice=(s as any).author_is_agency===true;
    if(direction==='SUPPLY'||agencyVoice){
      const why=agencyVoice
        ?'the reader judged this an agency speaking, not a principal'
        :'the reader judged this an offer, not a request';
      await db.from('intent_profiles').delete().eq('signal_id',s.id);
      await db.from('raw_signals').update({classification_status:'FILTERED_OUT',intent_type:'PROPERTY_AD',intent_json:tag({intentType:'PROPERTY_AD',reason:'deterministic_direction',detail:why,researchDirection:direction||null,agencyVoice},{intentType:'PROPERTY_AD',agencyVoice,direction})}).eq('id',s.id);
      filteredOut++;deterministicFiltered++;
      /* PHASE 2: not demand, but it may be SUPPLY. A listing becomes a supply observation. */
      if(direction==='SUPPLY'){try{if(await recordCommunitySupply(db,s as any))supplyObservations++;}catch(e){supplyErrors++;console.error('community supply failed',s.id,e instanceof Error?e.message:String(e));}}
    } else if(isSupplyAd(String(s.original_text||''))){
      await db.from('intent_profiles').delete().eq('signal_id',s.id);
      await db.from('raw_signals').update({classification_status:'FILTERED_OUT',intent_type:'PROPERTY_AD',intent_json:tag({intentType:'PROPERTY_AD',reason:'deterministic_supply_filter'},{intentType:'PROPERTY_AD',direction:'SUPPLY'})}).eq('id',s.id);
      try{if(await recordCommunitySupply(db,s as any))supplyObservations++;}catch(e){supplyErrors++;console.error('community supply failed',s.id,e instanceof Error?e.message:String(e));}
      filteredOut++;deterministicFiltered++;
    } else aiSignals.push(s);
  }

  /*
   * THE SAME WORDS ARE NOT PAID FOR TWICE.
   *
   * Telegram posts are cross-posted between channels and forum posts are
   * re-read; the content fingerprint is identical. A verdict this classifier
   * version already gave for the same text is reused -- the profile copied,
   * the model not called. A verdict from an older version is never reused:
   * a prompt or taxonomy change must re-read, not inherit.
   */
  const fingerprints=[...new Set(aiSignals.map((s:any)=>s.content_fingerprint).filter(Boolean))];
  const donors=new Map<string,any>();
  if(fingerprints.length){
    const {data:prior}=await db.from('raw_signals').select('id,content_fingerprint,classification_status,intent_type,intent_json').in('content_fingerprint',fingerprints).in('classification_status',['CLASSIFIED','FILTERED_OUT']).limit(500);
    for(const row of (prior||[]) as any[]){if(reusableVerdict(row.intent_json)&&row.intent_json?.reason!==AMBIGUOUS_AI_OFF&&!donors.has(row.content_fingerprint))donors.set(row.content_fingerprint,row);}
  }
  const toModel:any[]=[];
  for(const s of aiSignals){
    const donor=s.content_fingerprint?donors.get(s.content_fingerprint):null;
    if(!donor||donor.id===s.id){toModel.push(s);continue;}
    const verdict={...donor.intent_json,cacheHitFrom:donor.id};
    labels[verdict.discoveryLabel]=(labels[verdict.discoveryLabel]||0)+1;
    await db.from('intent_profiles').delete().eq('signal_id',s.id);
    if(donor.classification_status==='CLASSIFIED'){
      const {data:profile}=await db.from('intent_profiles').select('*').eq('signal_id',donor.id).maybeSingle();
      if(!profile){toModel.push(s);continue;}
      const {id:_id,created_at:_c,signal_id:_s,...copy}=profile as any;
      /* The model was not called for this row: its own AI cost is zero, and
         the cost_events line below records the cache hit. */
      const {error:ins}=await db.from('intent_profiles').insert({...copy,signal_id:s.id,original_text:s.original_text,ai_cost_usd:0,classifier_version:CLASSIFIER_VERSION});
      if(ins){toModel.push(s);continue;}
      await db.from('raw_signals').update({classification_status:'CLASSIFIED',intent_type:donor.intent_type,intent_json:verdict}).eq('id',s.id);
      classified++;
    }else{
      await db.from('raw_signals').update({classification_status:'FILTERED_OUT',intent_type:donor.intent_type,intent_json:verdict}).eq('id',s.id);
      filteredOut++;
    }
    cacheHits++;
  }
  aiSignals.length=0;aiSignals.push(...toModel);
  /*
   * RULES FIRST, THE MODEL ONLY FOR WHAT THEY CANNOT DECIDE (owner, 2026-10-29).
   *
   * Every signal still undecided is read by the six-language rules
   * (research-core/discovery/signalRules.ts: demandClassifier + readConstraints +
   * interpret.ts). A confident seeker becomes an intent profile written by code
   * (ai_model 'rules', $0); a confident offer, agency, job or off-topic post is
   * FILTERED_OUT with the rule evidence. Only what the rules mark AMBIGUOUS may
   * reach the model, and only when admin_settings.classify_signals_ai_ambiguous
   * is true (missing or unreadable = OFF), at most SIGNALS_AI_MAX_ITEMS_PER_TICK
   * per tick; the rest of an over-cap tick stays PENDING for the next one. With
   * the switch OFF an ambiguous signal is FILTERED_OUT under its own reason
   * (rules_ambiguous_ai_off), never promoted to demand and never reused as a
   * cached verdict, so an admin can return it to PENDING after switching on.
   */
  const {data:aiSwitchRow}=await db.from('admin_settings').select('value').eq('key',AI_SWITCHES.SIGNALS_AMBIGUOUS).maybeSingle();
  const aiAmbiguousEnabled=aiSwitchOn(aiSwitchRow?.value);
  const ambiguousSignals:any[]=[];let ruleClassified=0,ruleFiltered=0,ambiguousUnresolved=0,ambiguousDeferred=0;
  for(const s of aiSignals){
    const rv=ruleSignalVerdict(String(s.original_text||''));
    const agencyVoice=(s as any).author_is_agency===true;const direction=(s as any).research_direction||null;
    if(rv.decision==='AMBIGUOUS'){ambiguousSignals.push(s);continue;}
    await db.from('intent_profiles').delete().eq('signal_id',s.id);
    if(rv.decision==='NOT_DEMAND'){
      await db.from('raw_signals').update({classification_status:'FILTERED_OUT',intent_type:rv.intentType,intent_json:tag({intentType:rv.intentType,transactionType:rv.transactionType,intentConfidence:rv.confidence,reason:'deterministic_rules',evidence:rv.evidence,rulesVersion:rv.version},{intentType:rv.intentType,transactionType:rv.transactionType,confidence:rv.confidence,agencyVoice,direction})}).eq('id',s.id);
      filteredOut++;deterministicFiltered++;ruleFiltered++;
      if(rv.intentType==='PROPERTY_AD'){try{if(await recordCommunitySupply(db,s as any))supplyObservations++;}catch(e){supplyErrors++;console.error('community supply failed',s.id,e instanceof Error?e.message:String(e));}}
      continue;
    }
    const p=rv.profile;
    const verdict=tag({...p,reason:'deterministic_rules',evidence:rv.evidence,rulesVersion:rv.version},{intentType:p.intentType,transactionType:p.transactionType,confidence:p.intentConfidence,agencyVoice,direction});
    if(!DEMAND_LABELS.has(verdict.discoveryLabel)){await db.from('raw_signals').update({classification_status:'FILTERED_OUT',intent_type:p.intentType,intent_json:verdict}).eq('id',s.id);filteredOut++;deterministicFiltered++;ruleFiltered++;continue;}
    const source=Array.isArray(s.source)?s.source[0]:s.source;
    const {error:ins}=await db.from('intent_profiles').insert({signal_id:s.id,intent_type:p.intentType,country:source?.country_code||market,region:null,city:p.city,district:p.district,neighborhoods:p.neighborhoods,transaction_type:p.transactionType,property_types:p.propertyTypes,bedrooms_min:p.bedroomsMin,bedrooms_max:p.bedroomsMax,area_min:p.areaMin,area_max:p.areaMax,budget_min:p.budgetMin,budget_max:p.budgetMax,currency:p.currency,timeline:null,relocation_intent:false,investment_intent:false,language:p.language||s.language||source?.language||null,intent_confidence:p.intentConfidence,specificity_score:p.specificityScore,actionability_score:p.actionabilityScore,original_text:s.original_text,translated_text:null,ai_model:RULES_MODEL,classifier_version:CLASSIFIER_VERSION,ai_cost_usd:0});
    if(ins){await db.from('raw_signals').update({classification_status:'ERROR',classification_error_kind:'WRITE_FAILED',classification_attempts:(s as any).classification_attempts+1,classification_last_error:String(ins.message||ins).slice(0,300)}).eq('id',s.id);errors++;}
    else{await db.from('raw_signals').update({classification_status:'CLASSIFIED',intent_type:p.intentType,intent_json:verdict}).eq('id',s.id);classified++;ruleClassified++;}
  }
  const toAi=selectForModel(ambiguousSignals,{enabled:aiAmbiguousEnabled,ambiguous:()=>true,cap:SIGNALS_AI_MAX_ITEMS_PER_TICK,maxCap:SIGNALS_AI_MAX_ITEMS_PER_TICK});
  const sentToAi=new Set(toAi.map((s:any)=>s.id));
  for(const s of ambiguousSignals){
    if(sentToAi.has(s.id))continue;
    if(aiAmbiguousEnabled){ambiguousDeferred++;continue;}
    const rv=ruleSignalVerdict(String(s.original_text||''));
    await db.from('intent_profiles').delete().eq('signal_id',s.id);
    await db.from('raw_signals').update({classification_status:'FILTERED_OUT',intent_type:'UNKNOWN',intent_json:tag({intentType:'UNKNOWN',reason:AMBIGUOUS_AI_OFF,evidence:rv.evidence,rulesVersion:rv.version},{intentType:'UNKNOWN',agencyVoice:(s as any).author_is_agency===true,direction:(s as any).research_direction||null})}).eq('id',s.id);
    filteredOut++;ambiguousUnresolved++;
  }
  aiSignals.length=0;aiSignals.push(...toAi);
  const key=aiSignals.length?Deno.env.get('OPENAI_API_KEY')!:'';if(aiSignals.length&&!key)return json({error:'OPENAI_API_KEY missing'},500);
  for(let i=0;i<aiSignals.length;i+=20){const chunk=aiSignals.slice(i,i+20);try{
    const prompt=`You are Homatch's strict multilingual real-estate DEMAND classifier. Keep ONLY posts where the AUTHOR is actively seeking real estate: wants to BUY, RENT/LEASE, INVEST IN, or relocate and acquire/rent property. Reject all SUPPLY: owner/agent/developer offers, listings, advertisements, 'for rent', 'for sale', property cards, prices+features+contact details, broker inventories, developer promotions. Reject news, jobs, utilities, proxy posts and unrelated content. Property may be any real-estate type: apartment, house, villa, land, plot, agricultural land, office, retail, warehouse, hotel, commercial space, development site, building, studio, penthouse, townhouse or other. Return JSON {"results":[...]} one per id with {"id":string,"intentType":"BUY|RENT|INVEST|RELOCATE_BUY|RELOCATE_RENT|SELLER|AGENT_AD|DEVELOPER|PROPERTY_AD|DISCUSSION|SPAM|NOISE|UNKNOWN","country":string|null,"region":string|null,"city":string|null,"district":string|null,"neighborhoods":string[]|null,"transactionType":"SALE|RENT|INVESTMENT"|null,"propertyTypes":string[]|null,"bedroomsMin":number|null,"bedroomsMax":number|null,"areaMin":number|null,"areaMax":number|null,"budgetMin":number|null,"budgetMax":number|null,"currency":string|null,"timeline":string|null,"relocationIntent":boolean,"investmentIntent":boolean,"language":string|null,"intentConfidence":number,"specificityScore":number,"actionabilityScore":number,"translatedText":string|null}. Use DEVELOPER for a developer promoting a project, DISCUSSION for real-estate talk with no transaction (questions about prices, law, areas), AGENT_AD for any agent or agency speaking. Judge the message text only. If unclear whether the author is seeking or offering, choose UNKNOWN, never BUY/RENT.`;
    const input=chunk.map((s:any)=>({id:s.id,text:String(s.original_text||'').slice(0,2500),language:s.language||null,platform:s.platform}));
    const r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-4o-mini',temperature:0,response_format:{type:'json_object'},messages:[{role:'system',content:prompt},{role:'user',content:JSON.stringify(input)}]})});
    if(!r.ok)throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0,300)}`);const raw=await r.json();
    /* Provider cost (Finance V2.1): one cost_events row per OpenAI call, priced from the
       price book on the usage OpenAI reported (none → UNPRICED, never assumed). Awaited, not
       deferred: this is a worker tick, and the priced figure feeds intent_profiles.ai_cost_usd. */
    const recorded=await recordUsageCost(db as any,{provider:'OPENAI',operation:'CLASSIFY_SIGNALS_V2',service:'shared_platform',model:'gpt-4o-mini',correlationId:costRunId,idempotencyKey:`CLASSIFY_SIGNALS_V2:${costRunId}:${raw?.id??crypto.randomUUID()}`,tokens:tokenUsage(raw)});
    totalCostUsd+=Number(recorded?.cost_usd??0);
    /*
     * TWO DIFFERENT SILENCES, WHICH USED TO BE ONE.
     *
     * A batch that came back truncated or unparseable tells us NOTHING about
     * any id in it. A batch that parsed cleanly and returned verdicts for
     * some ids but not others has told us something about the ones it left
     * out: this prompt asks for one verdict per id and says that when it is
     * unclear whether the author is seeking or offering, the answer is
     * UNKNOWN and never BUY/RENT. So an omission cannot be a demand verdict.
     *
     * Both were recorded as ERROR/MODEL_OMITTED, which is terminal -- the
     * selector only takes PENDING -- so the rows were stranded, and the
     * truncation case was never retried even though it was recoverable.
     * Production, 2026-09-25: 44 signals sent, 5 verdicts returned, 39 rows
     * dead with ~480 completion tokens spent, i.e. no truncation at all.
     *
     * Truncation now throws into the existing retry path. A clean omission is
     * recorded as FILTERED_OUT under its own reason, never merged with a
     * verdict the model actually gave, so it stays countable and auditable.
     */
    const finishReason=String(raw.choices?.[0]?.finish_reason||'');
    let parsed:any=null;try{parsed=JSON.parse(raw.choices?.[0]?.message?.content||'')}catch{parsed=null}
    if(parsed===null||finishReason==='length')throw new Error(finishReason==='length'?'the batch response was truncated at the token limit':'the batch response was not parseable JSON');
    const byId=new Map((parsed.results||[]).map((x:any)=>[x.id,x]));
    for(const s of chunk){const x:any=byId.get(s.id);if(!x){await db.from('intent_profiles').delete().eq('signal_id',s.id);await db.from('raw_signals').update({classification_status:'FILTERED_OUT',intent_type:null,intent_json:tag({intentType:null,reason:'model_omitted_from_batch',detail:'the batch parsed and returned verdicts for other ids in it, and none for this one',verdictsReturned:byId.size,idsSent:chunk.length},{intentType:'UNKNOWN'})}).eq('id',s.id);modelOmitted++;filteredOut++;continue}const verdict=tag(x,{intentType:x.intentType,transactionType:x.transactionType,confidence:Number(x.intentConfidence||0),agencyVoice:(s as any).author_is_agency===true,direction:(s as any).research_direction});const isDemand=DEMAND.has(String(x.intentType||'').toUpperCase())&&DEMAND_LABELS.has(verdict.discoveryLabel);if(!isDemand){await db.from('intent_profiles').delete().eq('signal_id',s.id);await db.from('raw_signals').update({classification_status:'FILTERED_OUT',intent_type:x.intentType||null,intent_json:verdict}).eq('id',s.id);filteredOut++;continue}const source=Array.isArray(s.source)?s.source[0]:s.source;await db.from('intent_profiles').delete().eq('signal_id',s.id);const {error:ins}=await db.from('intent_profiles').insert({signal_id:s.id,intent_type:x.intentType,country:x.country||source?.country_code||market,region:x.region||null,city:x.city||null,district:x.district||null,neighborhoods:x.neighborhoods||null,transaction_type:x.transactionType||null,property_types:x.propertyTypes||null,bedrooms_min:x.bedroomsMin||null,bedrooms_max:x.bedroomsMax||null,area_min:x.areaMin||null,area_max:x.areaMax||null,budget_min:x.budgetMin||null,budget_max:x.budgetMax||null,currency:x.currency||null,timeline:x.timeline||null,relocation_intent:!!x.relocationIntent,investment_intent:!!x.investmentIntent,language:x.language||s.language||source?.language||null,intent_confidence:Number(x.intentConfidence||0),specificity_score:Number(x.specificityScore||0),actionability_score:Number(x.actionabilityScore||0),original_text:s.original_text,translated_text:x.translatedText||null,ai_model:'gpt-4o-mini',classifier_version:CLASSIFIER_VERSION,ai_cost_usd:Math.max(0.00001,totalCostUsd/Math.max(1,aiSignals.length))});if(ins){await db.from('raw_signals').update({classification_status:'ERROR',classification_error_kind:'WRITE_FAILED',classification_attempts:(s as any).classification_attempts+1,classification_last_error:String(ins.message||ins).slice(0,300)}).eq('id',s.id);errors++;}else{await db.from('raw_signals').update({classification_status:'CLASSIFIED',intent_type:x.intentType,intent_json:verdict}).eq('id',s.id);classified++;}}
  }catch(e){console.error('classification chunk',e);const why=String((e as any)?.message||e).slice(0,300);for(const s of chunk){const tried=((s as any).classification_attempts||0)+1;const exhausted=tried>=MAX_ATTEMPTS;await db.from('raw_signals').update({classification_status:exhausted?'ERROR':'PENDING',classification_error_kind:exhausted?'ATTEMPTS_EXHAUSTED':'BATCH_FAILED',classification_attempts:tried,classification_last_error:why}).eq('id',s.id);if(exhausted)errors++;else retried++;}}}
  if(cacheHits>0)await db.from('cost_events').insert({provider:'OPENAI',operation_type:'CLASSIFY_SIGNALS_V2',market,units:cacheHits,cost_usd:0,success:true,cache_hit:true});
  /*
   * AN AGENCY SPEAKING GOES TO BROKER REVIEW, NOT NOWHERE.
   *
   * BROKER_AGENCY verdicts are kept out of matching above. Each one becomes a
   * Broker Review item (one per signal) carrying what the post itself
   * published -- platform, source, public author identity, city, language,
   * publication date, confidence -- so an admin can record the firm in broker
   * intelligence. Never demand, never a match.
   */
  let brokerReviewQueued=0;
  const batchIds=signals.map((s:any)=>s.id);
  if(batchIds.length){
    const {data:agencyRows}=await db.from('raw_signals').select('id,platform,source_url,author_public_name,author_public_url,language,published_at,intent_json').in('id',batchIds).eq('intent_json->>discoveryLabel','BROKER_AGENCY');
    const items=((agencyRows||[]) as any[]).map((r)=>({signal_id:r.id,platform:r.platform??null,source_url:r.source_url??null,author_public_name:r.author_public_name??null,author_public_url:r.author_public_url??null,city:r.intent_json?.city??null,language:r.language??r.intent_json?.language??null,published_at:r.published_at??null,confidence:Number.isFinite(Number(r.intent_json?.intentConfidence))?Number(r.intent_json.intentConfidence):null}));
    if(items.length){
      const {error:queueError}=await db.from('broker_review_items').upsert(items,{onConflict:'signal_id',ignoreDuplicates:true});
      if(!queueError)brokerReviewQueued=items.length;
    }
  }
  return json({success:true,processed:signals.length,classified,filteredOut,deterministicFiltered,modelOmitted,cacheHits,errors,retried,totalCostUsd,classifierVersion:CLASSIFIER_VERSION,labels,brokerReviewQueued,supplyObservations,supplyErrors,ruleClassified,ruleFiltered,ambiguousUnresolved,ambiguousDeferred,aiAmbiguousEnabled,sentToModel:aiSignals.length});
 }catch(e){return json({error:e instanceof Error?e.message:String(e)},500)}
});

function isSupplyAd(t:string){
 const x=t.toLowerCase();
 const demandWords=/looking for|seeking|need to (buy|rent)|want to (buy|rent)|interested in buying|ищу|куплю|хочу купить|сниму|ვეძებ|ვიყიდი|ვიქირავებ|arıyorum|satın almak istiyorum|kiralamak istiyorum|أبحث عن|أريد شراء|أريد استئجار|מחפש|רוצה לקנות|רוצה לשכור/i.test(x);
 if(demandWords)return false;
 const supply=/\b(apartment|house|villa|land|office|commercial|studio|penthouse)\s+for\s+(rent|sale)\b|\bfor\s+(rent|sale)\b|\bavailable\s+for\s+(rent|sale)\b|იყიდება|ქირავდება|сда[её]тся|прода[её]тся|kiralık|satılık|للإيجار|للبيع|להשכרה|למכירה/i.test(x);
 const listingStructure=(/\d{2,6}\s*(usd|\$|gel|₾|eur|€|try|₺)/i.test(x)||/\d+(?:\.\d+)?\s*(sq\.?\s*m|m²|sqm|კვ\.?\s?მ)/i.test(x))&&(/@\w+|\+?\d[\d\s()-]{7,}/.test(t)||/deposit|commission|floor|bed|bath|parking|balcony|elevator|furnished/i.test(x));
 return supply||listingStructure;
}
