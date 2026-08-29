create or replace function public.atomic_external_match_unlock(p_user_id uuid, p_match_id uuid)
returns table(unlock_id uuid, ledger_entry_id uuid, credits_charged numeric, balance_after numeric, already_unlocked boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_price numeric; v_balance numeric; v_before numeric; v_ledger uuid; v_unlock uuid; v_signal_id uuid;
  v_signal_text text; v_source_url text; v_profile_url text; v_intent jsonb;
begin
  if p_user_id is null or p_match_id is null then raise exception 'INVALID_ARGUMENT'; end if;
  select mu.id,mu.ledger_entry_id,mu.credits_charged into v_unlock,v_ledger,v_price from public.match_unlocks mu where mu.user_id=p_user_id and mu.match_id=p_match_id;
  if v_unlock is not null then
    select ca.balance into v_balance from public.credit_accounts ca where ca.user_id=p_user_id;
    return query select v_unlock,v_ledger,v_price,coalesce(v_balance,0),true; return;
  end if;
  select m.unlock_price_credits,m.signal_id into v_price,v_signal_id from public.matches m where m.id=p_match_id for update;
  if not found then raise exception 'MATCH_NOT_FOUND'; end if;
  if v_signal_id is null then raise exception 'EXTERNAL_SIGNAL_REQUIRED'; end if;
  select rs.original_text,rs.source_url,coalesce(rs.profile_url,rs.author_public_url),rs.intent_json into v_signal_text,v_source_url,v_profile_url,v_intent from public.raw_signals rs where rs.id=v_signal_id;
  if not found then raise exception 'SIGNAL_NOT_FOUND'; end if;
  select ca.balance into v_before from public.credit_accounts ca where ca.user_id=p_user_id for update;
  if not found then raise exception 'CREDIT_ACCOUNT_NOT_FOUND'; end if;
  if v_before < v_price then raise exception 'INSUFFICIENT_CREDITS'; end if;
  v_balance:=v_before-v_price;
  update public.credit_accounts set balance=v_balance,updated_at=now() where user_id=p_user_id;
  insert into public.credit_ledger(user_id,amount,balance_before,balance_after,type,reference) values(p_user_id,-v_price,v_before,v_balance,'MATCH_UNLOCK','external-match:'||p_match_id::text) returning id into v_ledger;
  insert into public.match_unlocks(match_id,user_id,credits_charged,ledger_entry_id,full_signal_text,full_source_url,full_profile_url,full_intent_json) values(p_match_id,p_user_id,v_price,v_ledger,v_signal_text,v_source_url,v_profile_url,v_intent) returning id into v_unlock;
  update public.matches set status='UNLOCKED',updated_at=now() where id=p_match_id;
  return query select v_unlock,v_ledger,v_price,v_balance,false;
end; $$;
revoke all on function public.atomic_external_match_unlock(uuid,uuid) from public,anon,authenticated;
grant execute on function public.atomic_external_match_unlock(uuid,uuid) to service_role;
