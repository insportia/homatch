// unlock-external-contact — authenticated external match reveal
import { createClient } from 'jsr:@supabase/supabase-js@2';
const corsHeaders={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'};
const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json'}});
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS') return new Response('ok',{headers:corsHeaders});
 if(req.method!=='POST') return respond({error:'Method not allowed'},405);
 try{
  const authHeader=req.headers.get('Authorization'); if(!authHeader) return respond({error:'Unauthorized'},401);
  const supabase=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const {data:{user},error:authErr}=await supabase.auth.getUser(authHeader.replace(/^Bearer\s+/i,'')); if(authErr||!user) return respond({error:'Unauthorized'},401);
  const {data:actor}=await supabase.from('users').select('id').eq('auth_id',user.id).maybeSingle(); if(!actor) return respond({error:'User not found'},404);
  const {match_id,confirm}=await req.json(); if(!match_id) return respond({error:'match_id required'},400);
  const {data:match}=await supabase.from('matches').select('id,match_score,signal_strength,intent_confidence,unlock_price_credits,status,signal_id,intent_profile_id,preview_platform,preview_language,preview_city,preview_budget_min,preview_budget_max,preview_currency,preview_bedrooms,preview_excerpt,preview_recency').eq('id',match_id).maybeSingle();
  if(!match) return respond({error:'Match not found'},404); if(!match.signal_id) return respond({error:'Internal Homatch users connect via Chat, not contact unlock.'},400);
  const preview={match_score:match.match_score,signal_strength:match.signal_strength,confidence:match.intent_confidence,location:match.preview_city,source:match.preview_platform,language:match.preview_language,budget_min:match.preview_budget_min,budget_max:match.preview_budget_max,budget_currency:match.preview_currency,bedrooms:match.preview_bedrooms,excerpt:match.preview_excerpt,freshness:match.preview_recency,customer_price:match.unlock_price_credits,currency:'credits',already_unlocked:match.status==='UNLOCKED'};
  if(!confirm) return respond({preview});
  const {data:result,error:unlockErr}=await supabase.rpc('atomic_external_match_unlock',{p_user_id:actor.id,p_match_id:match_id}).maybeSingle();
  if(unlockErr){const msg=unlockErr.message||''; if(msg.includes('INSUFFICIENT_CREDITS')) return respond({error:'Insufficient credits',required:match.unlock_price_credits},402); console.error('atomic unlock failed',unlockErr); return respond({error:'Unlock failed. No credits were charged.'},500);}
  const {data:unlock}=await supabase.from('match_unlocks').select('full_signal_text,full_source_url,full_profile_url,full_intent_json').eq('id',result.unlock_id).single();
  return respond({...preview,already_unlocked:result.already_unlocked,credits_charged:result.credits_charged,balance_after:result.balance_after,contact:{source_url:unlock?.full_source_url??null,profile_url:unlock?.full_profile_url??null},full_signal_text:unlock?.full_signal_text??null,full_intent:unlock?.full_intent_json??null});
 }catch(err){console.error(err); return respond({error:'Unexpected unlock error. No credits were charged unless an unlock record was committed.'},500);}
});
