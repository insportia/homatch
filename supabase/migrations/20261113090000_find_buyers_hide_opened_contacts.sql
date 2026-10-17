-- FIND BUYERS — the owner may also hide the contacts they already opened (owner, 2026-10-17).
--
-- "I cleared the matches but the old internal ones are still there and I cannot get rid of
-- them." Those were the property's UNLOCKED legacy matches, which find_buyers_clear_results
-- (20261112100000) deliberately keeps. This adds the owner's explicit second choice — a
-- separate checkbox in the clear dialog, never the default on the dashboard — that HIDES
-- them too. It deletes nothing and refunds nothing: matches.owner_cleared_at is stamped, the
-- same column every owner read of matches already filters on. The unlock, its payment, the
-- credit ledger, CRM rows and audit stay exactly as they are.
--
-- Only the property's owner (or the service role) may hide: an admin cannot hide another
-- user's contacts. Idempotent: already-hidden rows are left as they are.
--
-- Additive: one new function. Rollback: drop function public.find_buyers_hide_opened_contacts(uuid);
-- un-hiding is `update public.matches set owner_cleared_at = null where ...` for the rows the
-- owner asks back.

create or replace function public.find_buyers_hide_opened_contacts(p_property_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_now timestamptz := now();
  v_hidden integer;
begin
  if not (coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', current_setting('request.jwt.claim.role', true), '') = 'service_role'
          or exists (select 1 from public.properties p where p.id = p_property_id and p.user_id = public.auth_user_id() and coalesce(p.is_deleted, false) = false)) then
    raise exception 'FORBIDDEN';
  end if;
  with u as (
    update public.matches m set owner_cleared_at = v_now
     where m.property_id = p_property_id and m.owner_cleared_at is null and m.status::text = 'UNLOCKED'
    returning m.id)
  select count(*) into v_hidden from u;
  return jsonb_build_object('openedHidden', v_hidden, 'hiddenAt', v_now);
end;
$function$;

revoke all on function public.find_buyers_hide_opened_contacts(uuid) from public, anon;
grant execute on function public.find_buyers_hide_opened_contacts(uuid) to authenticated, service_role;
