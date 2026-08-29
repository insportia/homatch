import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'};
const json=(d:any,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...CORS,'Content-Type':'application/json'}});
const DEMAND=new Set(['BUY','RENT','INVEST','RELOCATE_BUY','RELOCATE_RENT']);

Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:CORS});
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
 try{
  const {batchSize=300,market='GE'}=await req.json().catch(()=>({}));
  const {data:signals,error}=await db.from('raw_signals').select(`id,original_text,language,platform,source:source_registry!source_id(country_code,language)`).eq('classification_status','PENDING').order('discovered_at',{ascending:true}).limit(Math.min(500,batchSize));
  if(error)throw error;if(!signals?.length)return json({success:true,processed:0,classified:0,filteredOut:0,deterministicFiltered:0,errors:0});
  const key=Deno.env.get('OPENAI_API_KEY')!;if(!key)return json({error:'OPENAI_API_KEY missing'},500);
  let classified=0,filteredOut=0,deterministicFiltered=0,errors=0,totalCostUsd=0;
  const aiSignals:any[]=[];
  for(const s of signals){
    if(isSupplyAd(String(s.original_text||''))){
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
    let parsed:any={};try{parsed=JSON.parse(raw.choices?.[0]?.message?.content||'{}')}catch{}const byId=new Map((parsed.results||[]).map((x:any)=>[x.id,x]));
    for(const s of chunk){const x:any=byId.get(s.id);if(!x){await db.from('raw_signals').update({classification_status:'ERROR'}).eq('id',s.id);errors++;continue}const isDemand=DEMAND.has(String(x.intentType||'').toUpperCase())&&Number(x.intentConfidence||0)>=0.35;if(!isDemand){await db.from('intent_profiles').delete().eq('signal_id',s.id);await db.from('raw_signals').update({classification_status:'FILTERED_OUT',intent_type:x.intentType||null,intent_json:x}).eq('id',s.id);filteredOut++;continue}const source=Array.isArray(s.source)?s.source[0]:s.source;await db.from('intent_profiles').delete().eq('signal_id',s.id);const {error:ins}=await db.from('intent_profiles').insert({signal_id:s.id,intent_type:x.intentType,country:x.country||source?.country_code||market,region:x.region||null,city:x.city||null,district:x.district||null,neighborhoods:x.neighborhoods||null,transaction_type:x.transactionType||null,property_types:x.propertyTypes||null,bedrooms_min:x.bedroomsMin||null,bedrooms_max:x.bedroomsMax||null,area_min:x.areaMin||null,area_max:x.areaMax||null,budget_min:x.budgetMin||null,budget_max:x.budgetMax||null,currency:x.currency||null,timeline:x.timeline||null,relocation_intent:!!x.relocationIntent,investment_intent:!!x.investmentIntent,language:x.language||s.language||source?.language||null,intent_confidence:Number(x.intentConfidence||0),specificity_score:Number(x.specificityScore||0),actionability_score:Number(x.actionabilityScore||0),original_text:s.original_text,translated_text:x.translatedText||null,ai_model:'gpt-4o-mini',ai_cost_usd:Math.max(0.00001,totalCostUsd/Math.max(1,aiSignals.length))});if(ins){await db.from('raw_signals').update({classification_status:'ERROR'}).eq('id',s.id);errors++;}else{await db.from('raw_signals').update({classification_status:'CLASSIFIED',intent_type:x.intentType,intent_json:x}).eq('id',s.id);classified++;}}
  }catch(e){console.error('classification chunk',e);for(const s of chunk){await db.from('raw_signals').update({classification_status:'ERROR'}).eq('id',s.id);errors++;}}}
  if(totalCostUsd>0)await db.from('cost_events').insert({provider:'OPENAI',operation_type:'CLASSIFY_SIGNALS_V2',market,units:aiSignals.length,cost_usd:totalCostUsd,success:errors<Math.max(1,aiSignals.length),cache_hit:false});
  return json({success:true,processed:signals.length,classified,filteredOut,deterministicFiltered,errors,totalCostUsd});
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
