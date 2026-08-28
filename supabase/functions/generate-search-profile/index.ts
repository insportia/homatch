import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'};
const LANGS=['en','ru','ka','tr','ar','he'];
const json=(d:any,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...CORS,'Content-Type':'application/json'}});

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:CORS});
  try{
    const url=Deno.env.get('SUPABASE_URL')!;
    const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiKey=Deno.env.get('OPENAI_API_KEY')!;
    const auth=req.headers.get('authorization')??'';
    const {propertyId}=await req.json();
    if(!propertyId) return json({error:'propertyId required'},400);
    const admin=createClient(url,serviceKey);
    const bearer=auth.replace(/^Bearer\s+/i,'');
    const internal=bearer===serviceKey;
    if(!internal) return json({error:'Internal call required'},403);

    const {data:p,error}=await admin.from('properties').select(`id,user_id,title,transaction_type,property_type,facts:property_facts!property_id(city,district,neighborhood,country,country_code,total_price,price_per_sqm,currency,area,rooms,bedrooms,bathrooms,floor,total_floors,description,original_description,features,new_build,parking,balcony,terrace,yard,furnished,view)`).eq('id',propertyId).maybeSingle();
    if(error||!p) return json({error:'Property not found'},404);
    const f=Array.isArray(p.facts)?p.facts[0]:p.facts;
    const payload={title:p.title,transaction:p.transaction_type,propertyType:p.property_type,...f};

    let profile:any=null;
    if(openaiKey){
      const prompt=`You build real-estate demand search strategies. Analyze the supplied property. The property can be ANY real-estate type: apartment, house, villa, land, office, commercial, hotel, warehouse, development site, studio, townhouse or other. Transaction can be sale, rent or investment. Search for the OPPOSITE-SIDE demand: if the listing is SALE find buyers/investors; if RENT find renters/tenants; if investment opportunity find investors. Use location, price, size, features and especially description semantics. Do not assume apartment. Return strict JSON only: {"summary":string,"demandIntent":string,"propertyConcepts":string[],"buyerPersonas":string[],"queries":{"en":string[],"ru":string[],"ka":string[],"tr":string[],"ar":string[],"he":string[]}}. Produce 6-10 useful queries per language. Mix direct intent phrases, broader semantic phrases, and public-source discovery queries such as site:facebook.com/groups, site:t.me, site:instagram.com, site:threads.net, site:vk.com, site:reddit.com. Avoid exact over-restriction; AI filtering happens later.`;
      const r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${openaiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-4o-mini',temperature:0.2,response_format:{type:'json_object'},messages:[{role:'system',content:prompt},{role:'user',content:JSON.stringify(payload)}]})});
      if(r.ok){ const j=await r.json(); try{profile=JSON.parse(j.choices?.[0]?.message?.content||'{}')}catch{} }
    }
    if(!profile?.queries) profile=fallbackProfile(p,f);
    for(const l of LANGS) if(!Array.isArray(profile.queries?.[l])) profile.queries[l]=[];

    await admin.from('search_profiles').upsert({property_id:p.id,user_id:p.user_id,transaction_type:p.transaction_type,property_type:p.property_type,country:f?.country_code||f?.country,city:f?.city,district:f?.district,min_price:f?.total_price?Number(f.total_price)*0.7:null,max_price:f?.total_price?Number(f.total_price)*1.3:null,currency:f?.currency,min_area:f?.area?Number(f.area)*0.7:null,max_area:f?.area?Number(f.area)*1.3:null,min_bedrooms:f?.bedrooms?Math.max(0,Number(f.bedrooms)-1):null,max_bedrooms:f?.bedrooms?Number(f.bedrooms)+1:null,keywords:[...(profile.propertyConcepts||[]),...(profile.buyerPersonas||[])].slice(0,40),ai_summary:profile.summary||profile.demandIntent||null},{onConflict:'property_id'});
    return json({success:true,profile});
  }catch(e){return json({error:e instanceof Error?e.message:String(e)},500)}
});

function fallbackProfile(p:any,f:any){
  const city=f?.city||''; const district=f?.district||''; const type=String(p.property_type||'property').toLowerCase();
  const sale=p.transaction_type==='SALE'||p.transaction_type==='INVESTMENT';
  const en=sale?[`looking to buy ${type} ${city}`,`want ${type} ${city}`,`real estate investor ${city} ${type}`,`property wanted ${district} ${city}`,`site:facebook.com/groups ${city} ${type} wanted`,`site:t.me ${city} ${type} buy`,`site:reddit.com ${city} real estate ${type}`]:[`looking to rent ${type} ${city}`,`need ${type} for rent ${city}`,`tenant looking ${city} ${type}`,`site:facebook.com/groups ${city} ${type} rent wanted`,`site:t.me ${city} rent ${type}`];
  return {summary:`${p.transaction_type} ${p.property_type} demand in ${city}`,demandIntent:sale?'BUY_OR_INVEST':'RENT',propertyConcepts:[type,city,district].filter(Boolean),buyerPersonas:sale?['buyer','investor']:['renter','tenant'],queries:{en,ru:[`ищу ${type} ${city}`,sale?`хочу купить недвижимость ${city}`:`хочу снять недвижимость ${city}`],ka:[sale?`ვეძებ უძრავ ქონებას ${city}`:`ვეძებ გასაქირავებელ უძრავ ქონებას ${city}`],tr:[sale?`${city} gayrimenkul satın almak istiyorum`:`${city} kiralık gayrimenkul arıyorum`],ar:[sale?`أبحث عن عقار للشراء في ${city}`:`أبحث عن عقار للإيجار في ${city}`],he:[sale?`מחפש נכס לקנייה ב${city}`:`מחפש נכס להשכרה ב${city}`]}};
}
