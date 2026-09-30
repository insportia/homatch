-- WORKSTREAM B — FINAL HARDENING
--
--   1. The Meta Ads maintenance token moves from admin_settings (a table an
--      admin can read) into Supabase Vault. The edge function checks a
--      presented token through a service-role-only RPC; the value is never
--      returned by anything.
--   2. The Meta Ads ledger refuses a debit (RESERVE / HOMATCH_FEE) the
--      balance cannot cover, under a per-user lock — two concurrent launches
--      can no longer both pass the edge function's read-then-write check.
--   3. Forum discovery gets its own schedule switch, so forums can run on a
--      schedule while Telegram (which needs credentials) stays off.
--   4. The Admin Discovery overview counts current demand by the freshness
--      policy, not by hard-coded day counts.
--   5. A paid directory period that ended is swept to EXPIRED, and the owner is
--      told (and warned three days before).
--   6. A finished Find Clients search tells its owner.
--   7. Lead states follow a transition table; a rejected match or a deleted
--      property cannot be moved.
--   8. Admin broker detail includes the owner's suspension history.
--   9. The public broker directory no longer exposes whole listing rows
--      (review notes, verification notes, owner) through a table policy: the
--      view reads through a definer function that returns the public columns.
--
-- Idempotent throughout; append-only (no earlier migration is edited).

-- ── 1. MAINTENANCE TOKEN → VAULT ─────────────────────────────────────────

do $$
declare
  v_token text;
begin
  if to_regproc('vault.create_secret') is null then
    raise notice 'vault is not installed; maintenance token left in place';
    return;
  end if;
  if exists (select 1 from vault.secrets where name = 'meta_ads_maintenance_token') then
    return;
  end if;
  select value #>> '{}' into v_token from public.admin_settings where key = 'meta_ads_maintenance_token';
  if v_token is null or length(v_token) < 16 then
    v_token := encode(extensions.gen_random_bytes(24), 'hex');
  end if;
  perform vault.create_secret(v_token, 'meta_ads_maintenance_token',
    'x-cron-token for the meta-ads-api maintenance pass (pg_cron → edge function)');
end $$;

/* True when the presented token is the maintenance token. Service role only:
   it answers yes/no and never returns the value. */
create or replace function public.meta_ads_maintenance_token_ok(p_token text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_expected text;
begin
  if p_token is null or length(p_token) < 16 then return false; end if;
  select decrypted_secret into v_expected from vault.decrypted_secrets
   where name = 'meta_ads_maintenance_token' limit 1;
  return v_expected is not null and v_expected = p_token;
end $$;
revoke all on function public.meta_ads_maintenance_token_ok(text) from public, anon, authenticated;
grant execute on function public.meta_ads_maintenance_token_ok(text) to service_role;

do $$
begin
  if to_regproc('vault.create_secret') is null then return; end if;
  if exists (select 1 from cron.job where jobname = 'homatch-meta-ads-maintenance') then
    perform cron.unschedule('homatch-meta-ads-maintenance');
  end if;
  perform cron.schedule(
    'homatch-meta-ads-maintenance',
    '*/15 * * * *',
    $cron$
    select net.http_post(
      url := 'https://ptxajsjhobhvsfhmutjn.supabase.co/functions/v1/meta-ads-api',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'x-cron-token', (select decrypted_secret from vault.decrypted_secrets where name = 'meta_ads_maintenance_token' limit 1)),
      body := '{"action":"maintenance"}'::jsonb,
      timeout_milliseconds := 55000
    );
    $cron$
  );
  delete from public.admin_settings where key = 'meta_ads_maintenance_token';
end $$;

-- ── 2. LEDGER: NO DEBIT BEYOND THE BALANCE ───────────────────────────────

create or replace function public.meta_ads_ledger_balance_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_balance numeric;
begin
  if new.amount_cents >= 0 or new.entry_type not in ('RESERVE', 'HOMATCH_FEE') then
    return new;
  end if;
  /* One debit at a time per customer. The lock is held until the inserting
     transaction ends, and the balance below is read after it is taken. */
  perform pg_advisory_xact_lock(hashtextextended('meta_ads_ledger:' || new.user_id::text, 0));
  /* A replay of a debit already written is the unique key's to refuse
     (reported as a duplicate), not a balance question. */
  if new.idempotency_key is not null
     and exists (select 1 from public.meta_ads_ledger where idempotency_key = new.idempotency_key) then
    return new;
  end if;
  select coalesce(sum(amount_cents), 0) into v_balance
    from public.meta_ads_ledger where user_id = new.user_id and currency = new.currency;
  if v_balance + new.amount_cents < 0 then
    raise exception 'INSUFFICIENT_FUNDS';
  end if;
  return new;
end $$;
revoke all on function public.meta_ads_ledger_balance_guard() from public, anon, authenticated;

drop trigger if exists trg_meta_ads_ledger_balance_guard on public.meta_ads_ledger;
create trigger trg_meta_ads_ledger_balance_guard
  before insert on public.meta_ads_ledger
  for each row execute function public.meta_ads_ledger_balance_guard();

-- ── 3. FORUM SCHEDULE, DECOUPLED FROM TELEGRAM ───────────────────────────

insert into public.admin_settings (key, value) values ('forum_schedule_enabled', 'false'::jsonb)
on conflict (key) do nothing;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'homatch-forum-discovery') then
    perform cron.unschedule('homatch-forum-discovery');
  end if;
  perform cron.schedule(
    'homatch-forum-discovery',
    '17 * * * *',
    $cron$
    select net.http_post(
      url := 'https://ptxajsjhobhvsfhmutjn.supabase.co/functions/v1/demand-discovery',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'x-cron-token', (select value #>> '{}' from public.admin_settings where key = 'demand_discovery_token')),
      body := '{"source":"cron","maxThreads":3}'::jsonb,
      timeout_milliseconds := 55000
    )
    where (select value #>> '{}' from public.admin_settings where key = 'forum_discovery_enabled') = 'true' and (select value #>> '{}' from public.admin_settings where key = 'forum_schedule_enabled') = 'true';
    $cron$
  );
end $$;

-- ── 4. ADMIN DISCOVERY OVERVIEW: CURRENT DEMAND BY POLICY ────────────────

create or replace function public.admin_discovery_overview()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_policy jsonb := coalesce((select value from public.admin_settings where key = 'discovery_freshness_policy'), '{}'::jsonb);
  v_strong int := coalesce(nullif(v_policy->>'strongestDays', '')::int, 7);
  v_fresh int := coalesce(nullif(v_policy->>'veryFreshDays', '')::int, 14);
  v_active int := coalesce(nullif(v_policy->>'activeMaxDays', '')::int, 30);
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'settings', (
      select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
        from public.admin_settings
       where key in (
         'discovery_freshness_policy', 'telegram_discovery_enabled', 'telegram_integration_mode',
         'telegram_source_auto_enable', 'telegram_source_min_relevance',
         'discovery_background_refresh_enabled', 'forum_discovery_enabled', 'forum_schedule_enabled',
         'classifier_schedule_enabled',
         'campaign_source_discovery_enabled', 'campaign_min_credits', 'campaign_default_credits',
         'campaign_max_credits', 'campaign_discovery_minutes', 'discovery_job_max_attempts',
         'discovery_job_lease_seconds')
         and key not like '%token%'),
    'telegram_health', (
      select to_jsonb(h) - 'id'
        from public.provider_health h where h.provider = 'TELEGRAM' limit 1),
    'targets', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select lifecycle, readability, discovery_enabled, count(*)::int as targets,
               coalesce(sum(items_read), 0)::int as items_read,
               coalesce(sum(demand_found), 0)::int as demand_found,
               max(last_checked_at) as last_checked_at
          from public.community_targets where platform = 'TELEGRAM'
         group by 1, 2, 3 order by 4 desc) t),
    'queue', (
      select coalesce(jsonb_agg(q), '[]'::jsonb) from (
        select coalesce(provider, 'NONE') as provider, status, count(*)::int as jobs,
               max(coalesce(finished_at, processed_at, created_at)) as last_activity
          from public.discovery_query_queue group by 1, 2 order by 1, 2) q),
    'labels_7d', (
      select coalesce(jsonb_agg(l), '[]'::jsonb) from (
        select coalesce(intent_json->>'discoveryLabel', 'UNLABELLED') as label, count(*)::int as signals
          from public.raw_signals where discovered_at > now() - interval '7 days'
         group by 1 order by 2 desc) l),
    'pending_classification', (
      select count(*)::int from public.raw_signals where classification_status = 'PENDING'),
    /* The policy's own windows: strongest, very fresh, and the active maximum.
       Keys stay d7/d14/d30 for the screen; `windows` says what they measured. */
    'current_demand', jsonb_build_object(
      'd7',  (select count(*)::int from public.raw_signals where classification_status = 'CLASSIFIED' and published_at > now() - make_interval(days => v_strong) and published_at <= now() + interval '1 day'),
      'd14', (select count(*)::int from public.raw_signals where classification_status = 'CLASSIFIED' and published_at > now() - make_interval(days => v_fresh) and published_at <= now() + interval '1 day'),
      'd30', (select count(*)::int from public.raw_signals where classification_status = 'CLASSIFIED' and published_at > now() - make_interval(days => v_active) and published_at <= now() + interval '1 day'),
      'windows', jsonb_build_object('d7', v_strong, 'd14', v_fresh, 'd30', v_active)),
    'jobs', (
      select coalesce(jsonb_agg(j), '[]'::jsonb) from (
        select mj.id, mj.property_id, mj.status::text as status, mj.progress, mj.current_step,
               mj.fresh_matches_created, mj.failure_reason, mj.started_at, mj.completed_at,
               mj.discovery_deadline_at,
               (mj.billing_grant->>'authorizedMaxCredits')::numeric as budget_credits,
               (select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb) from (
                  select status, count(*)::int as n from public.discovery_query_queue
                   where matching_job_id = mj.id group by 1) s) as source_jobs
          from public.matching_jobs mj
         order by mj.created_at desc limit 25) j)
  );
end;
$function$;
revoke all on function public.admin_discovery_overview() from public, anon;
grant execute on function public.admin_discovery_overview() to authenticated;

-- ── 5. DIRECTORY PERIOD EXPIRY ───────────────────────────────────────────

create or replace function public.broker_directory_expiry_sweep()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_row record;
  v_expired int := 0;
  v_warned int := 0;
begin
  /* Ended periods: ACTIVE → EXPIRED. The public view already hid them the
     moment paid_until passed; this makes the status say so. Purchases and
     the listing itself are untouched — renewing restores it. */
  for v_row in
    update public.broker_directory_listings l
       set status = 'EXPIRED', updated_at = now()
     where l.status = 'ACTIVE' and l.paid_until is not null and l.paid_until <= now()
    returning l.id, l.owner_user_id, l.display_name, l.paid_until
  loop
    v_expired := v_expired + 1;
    perform public.notify_emit(u.id, 'BROKER_APPLICATION'::public.notification_type,
      'Your directory listing has expired',
      'Renew it from your broker desk to appear in the public directory again.',
      'NORMAL', '/broker', 'broker_directory_listings', v_row.id,
      'broker-listing-expired:' || v_row.id::text || ':' || to_char(v_row.paid_until, 'YYYYMMDD'))
      from public.users u where u.auth_id = v_row.owner_user_id;
  end loop;

  /* Three days' notice, once per period. */
  for v_row in
    select l.id, l.owner_user_id, l.paid_until from public.broker_directory_listings l
     where l.status = 'ACTIVE' and l.paid_until > now() and l.paid_until <= now() + interval '3 days'
  loop
    perform public.notify_emit(u.id, 'BROKER_APPLICATION'::public.notification_type,
      'Your directory listing ends soon',
      'It ends on ' || to_char(v_row.paid_until, 'YYYY-MM-DD') || '. Renew from your broker desk to stay listed.',
      'NORMAL', '/broker', 'broker_directory_listings', v_row.id,
      'broker-listing-expiring:' || v_row.id::text || ':' || to_char(v_row.paid_until, 'YYYYMMDD'))
      from public.users u where u.auth_id = v_row.owner_user_id;
    v_warned := v_warned + 1;
  end loop;

  return jsonb_build_object('expired', v_expired, 'warned', v_warned);
end $$;
revoke all on function public.broker_directory_expiry_sweep() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'homatch-broker-directory-expiry') then
    perform cron.unschedule('homatch-broker-directory-expiry');
  end if;
  perform cron.schedule('homatch-broker-directory-expiry', '7 * * * *',
    $cron$ select public.broker_directory_expiry_sweep(); $cron$);
end $$;

-- ── 6. A FINISHED SEARCH TELLS ITS OWNER ─────────────────────────────────

create or replace function public.matching_jobs_notify_finished()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_new int := coalesce(new.fresh_matches_created, new.matches_created, 0);
begin
  if new.status::text = old.status::text or new.user_id is null then return new; end if;
  if new.status::text not in ('completed', 'partially_completed', 'budget_reached', 'failed') then return new; end if;
  begin
    if new.status::text = 'failed' then
      perform public.notify_emit(new.user_id, 'CAMPAIGN_NEEDS_REVIEW'::public.notification_type,
        'Your client search could not finish',
        'Open the property to see what happened; you can start the search again from there.',
        'NORMAL', '/property/' || new.property_id::text || '/matches', 'matching_jobs', new.id,
        'matching-job-finished:' || new.id::text);
    else
      perform public.notify_emit(new.user_id, 'CAMPAIGN_COMPLETED'::public.notification_type,
        case when v_new = 1 then 'Your client search finished: 1 new match'
             else 'Your client search finished: ' || v_new || ' new matches' end,
        case when v_new = 0 then 'No new current demand was found this time.'
             else 'Open the property to review them.' end,
        'NORMAL', '/property/' || new.property_id::text || '/matches', 'matching_jobs', new.id,
        'matching-job-finished:' || new.id::text);
    end if;
  exception when others then
    /* A notification must never fail the job's own state change. */
    raise warning 'matching_jobs_notify_finished: %', sqlerrm;
  end;
  return new;
end $$;
revoke all on function public.matching_jobs_notify_finished() from public, anon, authenticated;

drop trigger if exists trg_matching_jobs_notify_finished on public.matching_jobs;
create trigger trg_matching_jobs_notify_finished
  after update of status on public.matching_jobs
  for each row execute function public.matching_jobs_notify_finished();

-- ── 7. LEAD STATES FOLLOW A TRANSITION TABLE ─────────────────────────────

create or replace function public.set_match_lead_state(p_match_id uuid, p_state text)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_user uuid := public.auth_user_id();
  v_owner uuid;
  v_current text;
  v_status text;
  v_deleted boolean;
  v_allowed text[];
begin
  if v_user is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_state not in ('NEW', 'REVIEWED', 'CONTACTED', 'IN_PROGRESS', 'WON', 'CLOSED') then raise exception 'INVALID_STATE'; end if;
  if public.is_user_suspended(v_user) then raise exception 'ACCOUNT_SUSPENDED'; end if;
  select p.user_id, m.lead_state, m.status::text, coalesce(p.is_deleted, false)
    into v_owner, v_current, v_status, v_deleted
    from public.matches m join public.properties p on p.id = m.property_id
   where m.id = p_match_id
   for update of m;
  if v_owner is null then raise exception 'MATCH_NOT_FOUND'; end if;
  if v_owner <> v_user then raise exception 'NOT_YOUR_PROPERTY'; end if;
  if v_status = 'REJECTED' or v_deleted then raise exception 'MATCH_CLOSED'; end if;
  if p_state = v_current then return p_state; end if;
  v_allowed := case v_current
    when 'NEW'         then array['REVIEWED', 'CONTACTED', 'IN_PROGRESS', 'CLOSED']
    when 'REVIEWED'    then array['NEW', 'CONTACTED', 'IN_PROGRESS', 'CLOSED']
    when 'CONTACTED'   then array['REVIEWED', 'IN_PROGRESS', 'WON', 'CLOSED']
    when 'IN_PROGRESS' then array['CONTACTED', 'WON', 'CLOSED']
    when 'WON'         then array['CLOSED']
    when 'CLOSED'      then array['REVIEWED']
    else array[]::text[] end;
  if not (p_state = any(v_allowed)) then raise exception 'INVALID_TRANSITION'; end if;
  if p_state in ('CONTACTED', 'IN_PROGRESS', 'WON')
     and not exists (select 1 from public.match_unlocks u where u.match_id = p_match_id) then
    raise exception 'UNLOCK_REQUIRED';
  end if;
  update public.matches set lead_state = p_state, lead_state_changed_at = now() where id = p_match_id;
  return p_state;
end $$;
revoke all on function public.set_match_lead_state(uuid, text) from public, anon;
grant execute on function public.set_match_lead_state(uuid, text) to authenticated;

-- ── 8. ADMIN BROKER DETAIL: THE OWNER'S SUSPENSION HISTORY TOO ───────────

create or replace function public.admin_broker_detail(p_listing_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_row public.broker_directory_listings%rowtype;
  v_user_id uuid;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  select * into v_row from public.broker_directory_listings where id = p_listing_id;
  if not found then raise exception 'LISTING_NOT_FOUND'; end if;
  select u.id into v_user_id from public.users u where u.auth_id = v_row.owner_user_id;
  return jsonb_build_object(
    'listing', to_jsonb(v_row),
    'user', (select jsonb_build_object('id', u.id, 'email', u.email, 'full_name', u.full_name, 'account_type', u.account_type,
                                      'suspended_at', u.suspended_at, 'suspension_reason', u.suspension_reason, 'created_at', u.created_at)
               from public.users u where u.id = v_user_id),
    'documents', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'path', d.storage_path, 'created_at', d.created_at)), '[]'::jsonb)
                    from public.broker_verification_documents d where d.listing_id = p_listing_id),
    'properties', (select count(*) from public.properties p where p.user_id = v_user_id and not p.is_deleted),
    'purchases', (select coalesce(jsonb_agg(jsonb_build_object('credits', b.credits, 'period_start', b.period_start, 'period_end', b.period_end)), '[]'::jsonb)
                    from public.broker_listing_purchases b where b.listing_id = p_listing_id),
    'audit', (select coalesce(jsonb_agg(jsonb_build_object('action', a.action, 'created_at', a.created_at, 'metadata', a.metadata) order by a.created_at desc), '[]'::jsonb)
                from public.admin_audit_log a
               where (a.entity_type = 'broker_directory_listings' and a.entity_id = p_listing_id::text)
                  or (v_user_id is not null and a.entity_type = 'users' and a.entity_id = v_user_id::text))
  );
end $$;
revoke all on function public.admin_broker_detail(uuid) from public, anon;
grant execute on function public.admin_broker_detail(uuid) to authenticated;

-- ── 9. THE PUBLIC DIRECTORY EXPOSES ONLY PUBLIC COLUMNS ──────────────────
--
-- The table policy broker_directory_current_is_public let any signed-in user
-- read WHOLE rows of current listings — review notes, verification notes and
-- the owner's id included. The view is the only public surface; it now reads
-- through a definer function that returns exactly the public columns, and
-- the table policy is dropped. Owners still read their own row
-- (broker_directory_owner_reads); admins go through admin RPCs.

create or replace function public.broker_directory_public_rows()
returns table (
  id uuid, broker_id uuid, display_name text, role text, country_code text, cities text[], languages text[],
  contact_phone text, contact_email text, website text, paid_until timestamptz, about text, contact_person text,
  logo_url text, property_types text[], deal_kinds text[], districts text[], experience_years integer,
  whatsapp text, telegram text, segments text[], verified boolean
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select
    l.id, l.broker_id, l.display_name, l.role, l.country_code, l.cities, l.languages,
    l.contact_phone, l.contact_email, l.website, l.paid_until, l.about, l.contact_person,
    l.logo_url, l.property_types, l.deal_kinds, l.districts, l.experience_years,
    l.whatsapp, l.telegram, l.segments,
    (l.verification_state = 'VERIFIED') as verified
  from public.broker_directory_listings l
  where l.status = 'ACTIVE' and l.paid_until is not null and l.paid_until > now()
$$;
revoke all on function public.broker_directory_public_rows() from public;
grant execute on function public.broker_directory_public_rows() to anon, authenticated;

create or replace view public.broker_directory_public
with (security_invoker = true) as
select * from public.broker_directory_public_rows();
grant select on public.broker_directory_public to anon, authenticated;

drop policy if exists broker_directory_current_is_public on public.broker_directory_listings;
