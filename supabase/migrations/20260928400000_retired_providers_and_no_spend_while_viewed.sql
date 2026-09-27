-- TWO SMALL CORRECTIONS THAT MAKE TWO CLAIMS TRUE.
--
-- 1. DataForSEO is retired. Its research_providers row still said enabled = true and
--    health_status = ACTIVE. Nothing executes on that flag any more — every code path to
--    the API is gone — but a row that says ACTIVE is a claim an operator reads, and the
--    claim was false. Apify was already disabled and killed; both are now stated the same
--    way. Historical spend, notes and cost events are untouched.
--
-- 2. Nobody spends a customer's credits while an administrator is viewing as them.
--    The read-only impersonation layer (20260928230000) blocks writes made WITH the
--    viewing session's token. A paid edge function writes to the ledger with the service
--    role, where that token is not in scope — so a debit is refused here instead, by who
--    it is FOR: while an open, unexpired viewing session exists for an account, no debit
--    and no reservation may be written for that account. Top-ups and refunds (positive
--    amounts) are unaffected, so a payment that lands during a support session still
--    credits the customer.

update public.research_providers
   set enabled = false,
       kill_switch = true,
       health_status = 'LOCKED',
       notes = 'RETIRED 2026-09-28. No code path can reach this provider. Historical records are kept.',
       updated_at = now()
 where provider_code in ('DATAFORSEO', 'APIFY')
   and (enabled is distinct from false or kill_switch is distinct from true
        or health_status is distinct from 'LOCKED');

create or replace function public.account_is_being_viewed(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.impersonation_sessions i
     where i.target_user_id = p_user_id
       and i.ended_at is null
       and coalesce(i.expires_at, i.started_at + interval '1 hour') > now()
  )
$$;

revoke all on function public.account_is_being_viewed(uuid) from public, anon, authenticated;
grant execute on function public.account_is_being_viewed(uuid) to service_role;

create or replace function public.homatch_refuse_spend_while_viewed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'credit_ledger' and coalesce(new.amount, 0) >= 0 then
    return new;
  end if;
  if public.account_is_being_viewed(new.user_id) then
    raise exception 'READ_ONLY_IMPERSONATION: no spend on % while an administrator is viewing this account',
      tg_table_name using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public.homatch_refuse_spend_while_viewed() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['credit_ledger', 'credit_reservations', 'usage_reservations'] loop
    continue when to_regclass('public.' || t) is null;
    execute format('drop trigger if exists trg_refuse_spend_while_viewed on public.%I', t);
    execute format(
      'create trigger trg_refuse_spend_while_viewed before insert on public.%I '
      'for each row execute function public.homatch_refuse_spend_while_viewed()', t);
  end loop;
end $$;
