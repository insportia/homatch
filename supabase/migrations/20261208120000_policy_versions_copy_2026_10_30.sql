-- Terms and Privacy 2026-10-30: obsolete voice and Stripe statements removed.
--
-- WHAT CHANGED (text only; src/lib/legal/operator.ts, scripts/stab-copy-i18n-data.mjs)
--
--   Terms    "every plan includes HOMI chat (text and voice)" -> "HOMI chat":
--            voice messages were removed from the product. The third-party
--            section no longer names Stripe, and the payment section says
--            payments will be processed by a licensed Georgian bank payment
--            provider once one is connected (no provider is connected today).
--   Privacy  the payment-information section, the sources list and the
--            processors list no longer name Stripe; card payments will be
--            handled by a licensed Georgian bank payment provider once
--            connected, and HOMATCH still never stores full card numbers.
--   Cookies  Stripe's checkout cookies are no longer listed (consent is not
--            asked again: see LEGAL_OPERATOR.cookieConsentVersion).
--
-- The 2026-10-29 edition stays readable word for word at
-- /terms?version=2026-10-29 (and /privacy, /cookies): ARCHIVED_EDITIONS plus
-- the *_e1029 translation keys. Acceptances of 2026-10-29 stay in
-- policy_acceptances untouched.
--
-- MATERIALITY AND RE-ACCEPTANCE
--
-- 20261206100000_policy_acceptance.sql reserves reaccept_existing = true for a
-- material change. This edition is NOT material on its own: it promises less
-- (no voice), names one processor fewer, and adds no processing, purpose or
-- obligation. Nobody who accepted 2026-10-29 should be stopped again.
--
-- But a plain reaccept_existing = false would be wrong here: 2026-10-29 (new
-- operator, new pricing) WAS material and many existing accounts have not
-- accepted it yet. The table holds one row per policy, so flipping the flag
-- would silently release every one of those pending re-acceptances.
--
-- So this migration adds accepted_from_version: an acceptance of any version
-- at or after it satisfies the current row. With reaccept_existing = true and
-- accepted_from_version = '2026-10-29':
--   * an account that accepted 2026-10-29 is NOT asked again;
--   * an account that still owes 2026-10-29 is asked, and accepts 2026-10-30;
--   * a new account accepts 2026-10-30 at signup, as before.
-- Versions are ISO dates, so text comparison orders them. A NULL
-- accepted_from_version keeps the original exact-version rule.
--
-- Additive and backward compatible: a new nullable column and a
-- create-or-replace of policy_acceptance_status() with the same signature and
-- answer shape. accept_current_policies() and the signup trigger are
-- unchanged (they record the current version).
--
-- ORDER: apply together with the frontend carrying
-- LEGAL_OPERATOR.versions = 2026-10-30 (accept_current_policies() refuses a
-- client naming another version; between the two, an account is simply held
-- at the acceptance screen, which the new frontend clears).
--
-- Idempotent.

alter table public.legal_policy_versions
  add column if not exists accepted_from_version text
    check (accepted_from_version is null or length(accepted_from_version) between 1 and 32);

comment on column public.legal_policy_versions.accepted_from_version is
  'When set, an acceptance of any version >= this one (ISO date text) satisfies the current version. NULL: only the current version counts.';

create or replace function public.policy_acceptance_status()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_uid     uuid := auth.uid();
  v_created timestamptz;
  v_missing text[];
begin
  if v_uid is null then
    return jsonb_build_object('required', false, 'missing', '[]'::jsonb, 'versions', '{}'::jsonb);
  end if;

  select u.created_at into v_created from auth.users u where u.id = v_uid;

  select coalesce(array_agg(v.policy order by v.policy), '{}')
    into v_missing
    from public.legal_policy_versions v
   where v.requires_acceptance
     and (v.reaccept_existing or coalesce(v_created, now()) >= v.effective_at)
     and not exists (
       select 1 from public.policy_acceptances a
        where a.auth_id = v_uid and a.policy = v.policy
          and (a.version = v.version
               or (v.accepted_from_version is not null and a.version >= v.accepted_from_version)));

  return jsonb_build_object(
    'required', cardinality(v_missing) > 0,
    'missing',  to_jsonb(v_missing),
    'versions', coalesce((select jsonb_object_agg(v.policy, v.version)
                            from public.legal_policy_versions v
                           where v.requires_acceptance), '{}'::jsonb));
end;
$function$;

revoke all on function public.policy_acceptance_status() from public, anon, authenticated, service_role;
grant execute on function public.policy_acceptance_status() to authenticated, service_role;

update public.legal_policy_versions
   set version               = '2026-10-30',
       effective_at          = timestamptz '2026-10-30 00:00:00+04',
       requires_acceptance   = true,
       reaccept_existing     = true,
       accepted_from_version = '2026-10-29',
       updated_at            = now()
 where policy in ('terms', 'privacy')
   and version is distinct from '2026-10-30';

insert into public.legal_policy_versions (policy, version, effective_at, requires_acceptance, reaccept_existing, accepted_from_version)
values ('terms', '2026-10-30', timestamptz '2026-10-30 00:00:00+04', true, true, '2026-10-29'),
       ('privacy', '2026-10-30', timestamptz '2026-10-30 00:00:00+04', true, true, '2026-10-29')
on conflict (policy) do nothing;
