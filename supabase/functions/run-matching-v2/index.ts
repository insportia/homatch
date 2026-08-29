import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'};
const json=(d:any,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...CORS,'Content-Type':'application/json'}});
const DEMAND=new Set(['BUY','RENT','INVEST','RELOCATE_BUY','RELOCATE_RENT']);

Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS') return new Response('ok',{headers:CORS});
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
 try{
  const {propertyId,campaignId,intentProfileBatchSize=500}=await req.json();
  const {data:p}=await db.from('properties').select(`id,user_id,title,transaction_type,property_type,matching_status,facts:property_facts!property_id(country,country_code,city,district,neighborhood,total_price,currency,area,rooms,bedrooms,description,original_description,features)`).eq('id',propertyId).maybeSingle();
  if(!p) return json({error:'Property not found'},404);
  const f=Array.isArray(p.facts)?p.facts[0]:p.facts;
  const {data:profiles,error}=await db.from('intent_profiles').select(`id,signal_id,intent_type,country,city,district,neighborhoods,transaction_type,property_types,bedrooms_min,bedrooms_max,area_min,area_max,budget_min,budget_max,currency,language,intent_confidence,specificity_score,actionability_score,original_text,translated_text,ai_cost_usd,signal:raw_signals!signal_id(id,property_id,platform,published_at,source_url,classification_status,intent_type,original_text,source:source_registry!source_id(quality_score))`).order('created_at',{ascending:false}).limit(intentProfileBatchSize);
  if(error) throw error;
  let created=0,skipped=0,rejectedSupply=0,rejectedOtherProperty=0,best=0; const buckets:any={'20-49':0,'50-79':0,'80-100':0};
  for(const ip of profiles||[]){
    const signal=Array.isArray(ip.signal)?ip.signal[0]:ip.signal;
    if(!signal||signal.property_id!==p.id){skipped++;rejectedOtherProperty++;continue;}
    const currentIntent=String(signal?.intent_type||ip.intent_type||'').toUpperCase();
    const text=String(signal?.original_text||ip.original_text||ip.translated_text||'');
    if(signal?.classification_status!=='CLASSIFIED'||Number(ip.intent_confidence||0)<0.65||!DEMAND.has(String(ip.intent_type||'').toUpperCase())||!DEMAND.has(currentIntent)||isSupplyAd(text)){
      skipped++; if(isSupplyAd(text)) rejectedSupply++; continue;
    }
    const {data:exists}=await db.from('matches').select('id').eq('property_id',p.id).eq('intent_profile_id',ip.id).maybeSingle();
    if(exists){skipped++;continue;}
    const r=score(p,f,ip); if(r.score<20){skipped++;continue;}
    const cogs=Math.max(0.05,Number(ip.ai_cost_usd||0.05));
    const multiplier=r.score>=80?10:r.score>=50?3:1;
    const price=Math.max(0.1,Math.ceil(cogs*multiplier*100)/100);
    const strength=r.score>=90?'EXCEPTIONAL':r.score>=80?'VERY_STRONG':r.score>=65?'STRONG':r.score>=50?'GOOD':'POTENTIAL';
    const published=signal?.published_at?new Date(signal.published_at):null;
    const recency=published?formatRecency((Date.now()-published.getTime())/3600000):null;
    const {error:ins}=await db.from('matches').insert({property_id:p.id,user_id:p.user_id,campaign_id:campaignId||null,signal_id:ip.signal_id,intent_profile_id:ip.id,match_score:r.score,intent_confidence:Number(ip.intent_confidence||0),signal_strength:strength,match_reasons:r.reasons,mismatch_reasons:r.mismatches,unlock_price_credits:price,estimated_cogs_usd:cogs,pricing_multiplier:multiplier,status:'NEW',mock_mode:false,preview_platform:signal?.platform||null,preview_language:ip.language||null,preview_city:ip.city||null,preview_budget_min:ip.budget_min||null,preview_budget_max:ip.budget_max||null,preview_currency:ip.currency||null,preview_bedrooms:ip.bedrooms_min||null,preview_excerpt:redact(text),preview_recency:recency});
    if(!ins){created++;best=Math.max(best,r.score);buckets[r.score>=80?'80-100':r.score>=50?'50-79':'20-49']++;}
  }
  await db.from('properties').update({matchability_score:best||null}).eq('id',p.id);
  return json({success:true,matchesCreated:created,matchesSkipped:skipped,rejectedSupply,rejectedOtherProperty,bestScore:best,buckets});
 }catch(e){return json({error:e instanceof Error?e.message:String(e)},500)}
});

function isSupplyAd(t:string){
 const x=t.toLowerCase();
 const supplyPhrases=[/\b(apartment|house|villa|land|office|commercial|studio|penthouse)\s+for\s+(rent|sale)\b/i,/\bfor\s+(rent|sale)\b/i,/\bavailable\s+for\s+(rent|sale)\b/i,/\bიყიდება\b/i,/\bქირავდება\b/i,/\bсда[её]тся\b/i,/\bпрода[её]тся\b/i,/\bkiralık\b/i,/\bsatılık\b/i,/للإيجار|للبيع/i,/להשכרה|למכירה/i];
 const listingSignals=(/\b\d{2,5}\s*(usd|\$|gel|₾|eur|€|try|₺)\b/i.test(x)||/\b\d+(?:\.\d+)?\s*(sq\.?\s*m|m²|sqm|კვ\.?\s?მ)/i.test(x))&&(/@\w+|\+?\d[\d\s()-]{7,}/.test(t)||/deposit|commission|floor|bed|bath|parking|balcony/i.test(x));
 const demandWords=/looking for|seeking|need to (buy|rent)|want to (buy|rent)|interested in buying|ищу|куплю|хочу купить|сниму|ვეძებ|ვიყიდი|ვიქირავებ|arıyorum|satın almak istiyorum|kiralamak istiyorum|أبحث عن|أريد شراء|أريد استئجار|מחפש|רוצה לקנות|רוצה לשכור/i.test(x);
 return !demandWords&&(supplyPhrases.some(r=>r.test(x))||listingSignals);
}
function score(p:any,f:any,ip:any){
 let s=0; const reasons:string[]=[]; const mismatches:string[]=[];
 const propTxn=norm(p.transaction_type), intTxn=norm(ip.transaction_type); const txnKnown=!!propTxn&&!!intTxn, txnMatch=!txnKnown||propTxn===intTxn;
 if(!txnKnown){s+=12;reasons.push('Transaction intent partially known')} else if(txnMatch){s+=25;reasons.push('Transaction intent matches')} else mismatches.push('Transaction differs');
 const pc=norm(f?.country_code||f?.country),ic=norm(ip.country); if(!pc||!ic){s+=5}else if(pc===ic||aliasCountry(pc)===aliasCountry(ic)){s+=10;reasons.push('Country matches')}else mismatches.push('Country differs');
 const city=similar(f?.city,ip.city); if(city===1){s+=10;reasons.push('City matches')}else if(city===0.5){s+=5;reasons.push('Location broadly compatible')}else if(ip.city&&f?.city)mismatches.push('City differs'); else s+=4;
 const dist=[ip.district,...(ip.neighborhoods||[])].filter(Boolean); const dm=dist.some((x:string)=>similar(f?.district||f?.neighborhood,x)>=0.5); if(dm){s+=5;reasons.push('District/neighborhood matches')}else if(!dist.length)s+=2;
 const pt=norm(p.property_type), its=(ip.property_types||[]).map(norm); const typeKnown=pt&&its.length; const typeMatch=!typeKnown||its.some((x:string)=>typeCompatible(pt,x)); if(!typeKnown){s+=8}else if(typeMatch){s+=20;reasons.push('Property type matches')}else mismatches.push('Property type differs');
 const price=Number(f?.total_price||0),bmin=Number(ip.budget_min||0),bmax=Number(ip.budget_max||0); if(!price||(!bmin&&!bmax)){s+=7}else if((!bmin||price>=bmin*0.8)&&(!bmax||price<=bmax*1.2)){s+=15;reasons.push('Budget compatible')}else if(bmax&&price<=bmax*1.5){s+=7;reasons.push('Budget near range')}else mismatches.push('Budget differs');
 const area=Number(f?.area||0),amin=Number(ip.area_min||0),amax=Number(ip.area_max||0); if(!area||(!amin&&!amax)){s+=2}else if((!amin||area>=amin*0.75)&&(!amax||area<=amax*1.25)){s+=5;reasons.push('Area compatible')}
 const propText=[p.title,f?.description,f?.original_description,...(f?.features||[])].filter(Boolean).join(' '); const intentText=[ip.original_text,ip.translated_text].filter(Boolean).join(' '); const overlap=semanticOverlap(propText,intentText); s+=Math.round(overlap*10); if(overlap>=0.3) reasons.push('Description/needs overlap');
 s+=Math.round(Math.min(1,Number(ip.intent_confidence||0))*5); let final=Math.max(0,Math.min(100,Math.round(s))); if(txnKnown&&!txnMatch) final=Math.min(final,49); if(typeKnown&&!typeMatch) final=Math.min(final,49); return {score:final,reasons,mismatches};
}
function norm(v:any){return String(v||'').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'_')}
function similar(a:any,b:any){const x=norm(a),y=norm(b);if(!x||!y)return 0;if(x===y||x.includes(y)||y.includes(x))return 1;return 0}
function aliasCountry(x:string){const m:any={georgia:'ge',საქართველო:'ge',грузия:'ge',turkey:'tr',türkiye:'tr'};return m[x]||x}
function typeCompatible(a:string,b:string){if(a===b)return true;const groups=[['commercial','office','retail','warehouse','hotel'],['house','villa','townhouse'],['apartment','studio','penthouse']];return groups.some(g=>g.includes(a)&&g.includes(b))}
function semanticOverlap(a:string,b:string){const stop=new Set(['property','real','estate','for','the','and','with','this','that','იყიდება','ქირავდება','продажа','аренда']);const A=new Set(norm(a).split('_').filter(x=>x.length>3&&!stop.has(x)));const B=new Set(norm(b).split('_').filter(x=>x.length>3&&!stop.has(x)));if(!A.size||!B.size)return 0;let n=0;for(const x of A)if(B.has(x))n++;return Math.min(1,n/Math.max(3,Math.min(A.size,B.size)))}
function redact(t:string){const clean=t.replace(/https?:\/\/\S+/g,'[link]').replace(/@[\w.-]+/g,'[profile]').replace(/\+?\d[\d\s()-]{6,}/g,'[contact]');return clean.slice(0,120)+(clean.length>120?'…':'')}
function formatRecency(h:number){if(h<1)return `${Math.max(1,Math.round(h*60))}m ago`;if(h<24)return `${Math.round(h)}h ago`;return `${Math.round(h/24)}d ago`}
