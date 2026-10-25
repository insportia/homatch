-- Terms & Privacy acceptance at registration, version-aware.
--
-- WHAT THIS RECORDS
--
-- One row per (account, policy, version) the account accepted: Terms of
-- Service, and acknowledgment of the Privacy Policy. The timestamp is the
-- server's, the account is auth.uid() — neither is taken from the client.
-- Marketing consent is NOT part of this and never will be: it is optional and
-- lives elsewhere.
--
-- HOW AN ACCEPTANCE GETS IN
--
--   email/password  supabase.auth.signUp carries
--                   user_metadata.policy_acceptance = {terms, privacy, accepted}.
--                   The AFTER INSERT trigger on auth.users records it only if
--                   both versions are the CURRENT ones. A signup without it (an
--                   old client, a direct API call) creates an auth user with no
--                   acceptance, and that account is held at the acceptance
--                   screen by policy_acceptance_status() until it accepts.
--   Google / OAuth  the provider creates the auth user before HOMATCH can ask,
--                   so acceptance is completed after the callback through
--                   accept_current_policies(), before normal platform use.
--
-- RE-ACCEPTANCE
--
-- legal_policy_versions holds the current version of each policy. Publishing
-- a new version is an UPDATE of that row. Accounts created on or after
-- effective_at must accept it; accounts created before it are asked again
-- only when reaccept_existing is true (a material change). This migration
-- seeds reaccept_existing = false, so deploying it does not stop every
-- existing customer at a screen: flipping it is the owner's decision.
--
-- WHY THE TRIGGER SWALLOWS ITS OWN ERRORS
--
-- It runs inside Supabase Auth's signup transaction. 20260905222421 is what a
-- failing auth.users trigger does to signup (every signup 500s). A failure to
-- record the acceptance must leave the account unaccepted — which the status
-- function then enforces — rather than take signup down.

create table if not exists public.legal_policy_versions (
  policy             text primary key check (policy in ('terms', 'privacy')),
  version            text not null check (length(version) between 1 and 32),
  effective_at       timestamptz not null default now(),
  requires_acceptance boolean not null default true,
  reaccept_existing  boolean not null default false,
  updated_at         timestamptz not null default now()
);

insert into public.legal_policy_versions (policy, version)
values ('terms', '2026-10-25'), ('privacy', '2026-10-25')
on conflict (policy) do nothing;

alter table public.legal_policy_versions enable row level security;
revoke all on public.legal_policy_versions from anon, authenticated;
grant select on public.legal_policy_versions to anon, authenticated;
drop policy if exists legal_policy_versions_read on public.legal_policy_versions;
create policy legal_policy_versions_read on public.legal_policy_versions
  for select to anon, authenticated using (true);

create table if not exists public.policy_acceptances (
  id          bigint generated always as identity primary key,
  auth_id     uuid not null references auth.users (id) on delete cascade,
  policy      text not null check (policy in ('terms', 'privacy')),
  version     text not null,
  source      text not null check (source in ('email_signup', 'oauth_signup', 'onboarding', 'reacceptance')),
  accepted_at timestamptz not null default now(),
  unique (auth_id, policy, version)
);

create index if not exists policy_acceptances_auth_idx on public.policy_acceptances (auth_id);

alter table public.policy_acceptances enable row level security;
-- Read your own record; nobody writes except through the functions below.
revoke all on public.policy_acceptances from anon, authenticated;
grant select on public.policy_acceptances to authenticated;
drop policy if exists policy_acceptances_read_own on public.policy_acceptances;
create policy policy_acceptances_read_own on public.policy_acceptances
  for select to authenticated using (auth_id = auth.uid());

-- ── Status: does this account still owe an acceptance? ─────────────────────
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
        where a.auth_id = v_uid and a.policy = v.policy and a.version = v.version);

  return jsonb_build_object(
    'required', cardinality(v_missing) > 0,
    'missing',  to_jsonb(v_missing),
    'versions', coalesce((select jsonb_object_agg(v.policy, v.version)
                            from public.legal_policy_versions v
                           where v.requires_acceptance), '{}'::jsonb));
end;
$function$;

-- ── Accept: the only write path for a signed-in account ────────────────────
create or replace function public.accept_current_policies(p_versions jsonb, p_source text)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_row record;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if p_source is null or p_source not in ('oauth_signup', 'onboarding', 'reacceptance') then
    raise exception 'INVALID_SOURCE' using errcode = '22023';
  end if;

  -- The client must name the versions it showed. A stale page accepting a
  -- policy it never displayed is refused, not silently upgraded.
  for v_row in select policy, version from public.legal_policy_versions where requires_acceptance loop
    if (p_versions ->> v_row.policy) is distinct from v_row.version then
      raise exception 'POLICY_VERSION_MISMATCH' using errcode = '22023',
        detail = format('%s: expected %s', v_row.policy, v_row.version);
    end if;
  end loop;

  insert into public.policy_acceptances (auth_id, policy, version, source)
  select v_uid, v.policy, v.version, p_source
    from public.legal_policy_versions v
   where v.requires_acceptance
  on conflict (auth_id, policy, version) do nothing;

  return public.policy_acceptance_status();
end;
$function$;

-- ── Email signup: record what the signup form accepted ─────────────────────
create or replace function public.record_signup_policy_acceptance()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_pa jsonb := new.raw_user_meta_data -> 'policy_acceptance';
begin
  if v_pa is null or jsonb_typeof(v_pa) <> 'object' or (v_pa ->> 'accepted') is distinct from 'true' then
    return new;
  end if;
  if exists (select 1 from public.legal_policy_versions v
              where v.requires_acceptance and (v_pa ->> v.policy) is distinct from v.version) then
    return new;
  end if;

  insert into public.policy_acceptances (auth_id, policy, version, source, accepted_at)
  select new.id, v.policy, v.version, 'email_signup', coalesce(new.created_at, now())
    from public.legal_policy_versions v
   where v.requires_acceptance
  on conflict (auth_id, policy, version) do nothing;
  return new;
exception when others then
  raise warning 'record_signup_policy_acceptance: %', sqlerrm;
  return new;
end;
$function$;

drop trigger if exists trg_record_signup_policy_acceptance on auth.users;
create trigger trg_record_signup_policy_acceptance
  after insert on auth.users
  for each row execute function public.record_signup_policy_acceptance();

-- Supabase's default privileges grant EXECUTE to anon/authenticated by name;
-- revoking from PUBLIC alone leaves those in place (see functionGrants test).
revoke all on function public.policy_acceptance_status() from public, anon, authenticated, service_role;
revoke all on function public.accept_current_policies(jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.record_signup_policy_acceptance() from public, anon, authenticated, service_role;
grant execute on function public.policy_acceptance_status() to authenticated, service_role;
grant execute on function public.accept_current_policies(jsonb, text) to authenticated, service_role;
