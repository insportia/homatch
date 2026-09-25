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
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'};
const json=(d:any,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...CORS,'Content-Type':'application/json'}});
const DEMAND=new Set(['BUY','RENT','INVEST','RELOCATE_BUY','RELOCATE_RENT']);
/* Three tries. Enough to cross a provider blip, few enough that a signal
   nothing can classify stops consuming budget. */
const MAX_ATTEMPTS=3;

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
  const {batchSize=300,market='GE'}=await req.json().catch(()=>({}));
  const {data:signals,error}=await db.from('raw_signals').select(`id,original_text,language,platform,classification_attempts,research_direction,author_is_agency,source:source_registry!source_id(country_code,language)`).eq('classification_status','PENDING').lt('classification_attempts',MAX_ATTEMPTS).order('classification_attempts',{ascending:true}).order('discovered_at',{ascending:true}).limit(Math.min(500,batchSize));
  if(error)throw error;if(!signals?.length)return json({success:true,processed:0,classified:0,filteredOut:0,deterministicFiltered:0,errors:0});
  const key=Deno.env.get('OPENAI_API_KEY')!;if(!key)return json({error:'OPENAI_API_KEY missing'},500);
  let retried=0;let classified=0,filteredOut=0,deterministicFiltered=0,errors=0,totalCostUsd=0,modelOmitted=0;
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
   * UNKNOWN also goes to the model. The reader is deliberately conservative
   * and most forum posts are neither an offer nor a request; deciding here
   * that UNKNOWN means "not a lead" would throw away exactly the nuanced
   * cases the model is better at.
   */
  for(const s of signals){
    const direction=String((s as any).research_direction||'');
    const agencyVoice=(s as any).author_is_agency===true;
    if(direction==='SUPPLY'||agencyVoice){
      const why=agencyVoice
        ?'the reader judged this an agency speaking, not a principal'
        :'the reader judged this an offer, not a request';
      await db.from('intent_profiles').delete().eq('signal_id',s.id);
      await db.from('raw_signals').update({classification_status:'FILTERED_OUT',intent_type:'PROPERTY_AD',intent_json:{intentType:'PROPERTY_AD',reason:'deterministic_direction',detail:why,researchDirection:direction||null,agencyVoice}}).eq('id',s.id);
      filteredOut++;deterministicFiltered++;
    } else if(isSupplyAd(String(s.original_text||''))){
      await db.from('intent_profiles').delete().eq('signal_id',s.id);
      await db.from('raw_signals').update({classification_status:'FILTERED_OUT',intent_type:'PROPERTY_AD',intent_json:{intentType:'PROPERTY_AD',reason:'deterministic_supply_filter'}}).eq('id',s.id);
      filteredOut++;deterministicFiltered++;
    } else aiSignals.push(s);
  }
  for(let i=0;i<aiSignals.length;i+=20){const chunk=aiSignals.slice(i,i+20);try{
    const prompt=`You are Homatch's strict multilingual real-estate DEMAND classifier. Keep ONLY posts where the AUTHOR is actively seeking real estate: wants to BUY, RENT/LEASE, INVEST IN, or relocate and acquire/rent property. Reject all SUPPLY: owner/agent/developer offers, listings, advertisements, 'for rent', 'for sale', property cards, prices+features+contact details, broker inventories, developer promotions. Reject news, jobs, utilities, proxy posts and unrelated content. Property may be any real-estate type: apartment, house, villa, land, plot, agricultural land, office, retail, warehouse, hotel, commercial space, development site, building, studio, penthouse, townhouse or other. Return JSON {"results":[...]} one per id with {"id":string,"intentType":"BUY|RENT|INVEST|RELOCATE_BUY|RELOCATE_RENT|SELLER|AGENT_AD|PROPERTY_AD|SPAM|NOISE|UNKNOWN","country":string|null,"region":string|null,"city":string|null,"district":string|null,"neighborhoods":string[]|null,"transactionType":"SALE|RENT|INVESTMENT"|null,"propertyTypes":string[]|null,"bedroomsMin":number|null,"bedroomsMax":number|null,"areaMin":number|null,"areaMax":number|null,"budgetMin":number|null,"budgetMax":number|null,"currency":string|null,"timeline":string|null,"relocationIntent":boolean,"investmentIntent":boolean,"language":string|null,"intentConfidence":number,"specificityScore":number,"actionabilityScore":number,"translatedText":string|null}. If unclear whether the author is seeking or offering, choose UNKNOWN, never BUY/RENT.`;
    const input=chunk.map((s:any)=>({id:s.id,text:String(s.original_text||'').slice(0,2500),language:s.language||null,platform:s.platform}));
    const r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-4o-mini',temperature:0,response_format:{type:'json_object'},messages:[{role:'system',content:prompt},{role:'user',content:JSON.stringify(input)}]})});
    if(!r.ok)throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0,300)}`);const raw=await r.json();const u=raw.usage||{};totalCostUsd+=(Number(u.prompt_tokens||0)*0.15+Number(u.completion_tokens||0)*0.6)/1_000_000;
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
    for(const s of chunk){const x:any=byId.get(s.id);if(!x){await db.from('intent_profiles').delete().eq('signal_id',s.id);await db.from('raw_signals').update({classification_status:'FILTERED_OUT',intent_type:null,intent_json:{intentType:null,reason:'model_omitted_from_batch',detail:'the batch parsed and returned verdicts for other ids in it, and none for this one',verdictsReturned:byId.size,idsSent:chunk.length}}).eq('id',s.id);modelOmitted++;filteredOut++;continue}const isDemand=DEMAND.has(String(x.intentType||'').toUpperCase())&&Number(x.intentConfidence||0)>=0.35;if(!isDemand){await db.from('intent_profiles').delete().eq('signal_id',s.id);await db.from('raw_signals').update({classification_status:'FILTERED_OUT',intent_type:x.intentType||null,intent_json:x}).eq('id',s.id);filteredOut++;continue}const source=Array.isArray(s.source)?s.source[0]:s.source;await db.from('intent_profiles').delete().eq('signal_id',s.id);const {error:ins}=await db.from('intent_profiles').insert({signal_id:s.id,intent_type:x.intentType,country:x.country||source?.country_code||market,region:x.region||null,city:x.city||null,district:x.district||null,neighborhoods:x.neighborhoods||null,transaction_type:x.transactionType||null,property_types:x.propertyTypes||null,bedrooms_min:x.bedroomsMin||null,bedrooms_max:x.bedroomsMax||null,area_min:x.areaMin||null,area_max:x.areaMax||null,budget_min:x.budgetMin||null,budget_max:x.budgetMax||null,currency:x.currency||null,timeline:x.timeline||null,relocation_intent:!!x.relocationIntent,investment_intent:!!x.investmentIntent,language:x.language||s.language||source?.language||null,intent_confidence:Number(x.intentConfidence||0),specificity_score:Number(x.specificityScore||0),actionability_score:Number(x.actionabilityScore||0),original_text:s.original_text,translated_text:x.translatedText||null,ai_model:'gpt-4o-mini',ai_cost_usd:Math.max(0.00001,totalCostUsd/Math.max(1,aiSignals.length))});if(ins){await db.from('raw_signals').update({classification_status:'ERROR',classification_error_kind:'WRITE_FAILED',classification_attempts:(s as any).classification_attempts+1,classification_last_error:String(ins.message||ins).slice(0,300)}).eq('id',s.id);errors++;}else{await db.from('raw_signals').update({classification_status:'CLASSIFIED',intent_type:x.intentType,intent_json:x}).eq('id',s.id);classified++;}}
  }catch(e){console.error('classification chunk',e);const why=String((e as any)?.message||e).slice(0,300);for(const s of chunk){const tried=((s as any).classification_attempts||0)+1;const exhausted=tried>=MAX_ATTEMPTS;await db.from('raw_signals').update({classification_status:exhausted?'ERROR':'PENDING',classification_error_kind:exhausted?'ATTEMPTS_EXHAUSTED':'BATCH_FAILED',classification_attempts:tried,classification_last_error:why}).eq('id',s.id);if(exhausted)errors++;else retried++;}}}
  if(totalCostUsd>0)await db.from('cost_events').insert({provider:'OPENAI',operation_type:'CLASSIFY_SIGNALS_V2',market,units:aiSignals.length,cost_usd:totalCostUsd,success:errors<Math.max(1,aiSignals.length),cache_hit:false});
  return json({success:true,processed:signals.length,classified,filteredOut,deterministicFiltered,modelOmitted,errors,retried,totalCostUsd});
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
