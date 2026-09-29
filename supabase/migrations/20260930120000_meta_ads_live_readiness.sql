-- META ADS — LIVE READINESS.
--
-- What the first real-account launch needs that v1 did not have:
--
--   1. OAuth state gets its own columns. The nonce used to live in
--      meta_connections.last_error, an error column read by Admin; it now has
--      a dedicated, single-use column and a start time. Declined permissions
--      are recorded next to granted ones so the UI can say which is missing.
--   2. Lead forms and WhatsApp numbers are discoverable asset kinds.
--   3. Campaigns record when they were launched and settled — the settlement
--      pass closes the ledger exactly once per campaign.
--   4. Creatives get a description field (Meta's link description), and a
--      description edit sends the creative back through preflight like every
--      other content edit.
--   5. The scheduled maintenance pass: status + spend sync, stuck-launch
--      recovery, failed lead-webhook retry, token expiry.
--
-- Nothing here changes an existing customer's configuration. Goals stay as
-- Admin set them; MESSAGES and WhatsApp remain off until Admin turns them on.

-- 1 ─ connection
alter table public.meta_connections
  add column if not exists oauth_nonce text,
  add column if not exists oauth_started_at timestamptz,
  add column if not exists declined_scopes text[] not null default '{}';

-- The nonce is a single-use secret for the owner's own flow: the owner may
-- read their row (RLS), nobody else can. Clear any nonce left in last_error
-- by the old flow so Admin never displays one.
update public.meta_connections
   set last_error = null
 where last_error ~ '^[0-9a-f-]{36}$';

-- 2 ─ asset kinds
alter table public.meta_assets drop constraint if exists meta_assets_kind_check;
alter table public.meta_assets add constraint meta_assets_kind_check
  check (kind in ('BUSINESS','PAGE','INSTAGRAM','AD_ACCOUNT','PIXEL','LEAD_FORM','WHATSAPP'));

-- 3 ─ campaign lifecycle timestamps (server-owned)
alter table public.meta_campaigns
  add column if not exists launched_at timestamptz,
  add column if not exists settled_at timestamptz;

create or replace function public.meta_campaigns_guard()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.role() = 'service_role' then return new; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'DRAFT' then raise exception 'META_ADS_CLIENT_STATUS'; end if;
    new.external_campaign_id := null; new.external_status := null;
    new.launch_idempotency_key := null; new.spend_cents := 0;
    new.preflight := null; new.results := null; new.plan := null; new.plan_version := null;
    new.launched_at := null; new.settled_at := null;
    return new;
  end if;
  if new.external_campaign_id is distinct from old.external_campaign_id
     or new.external_status is distinct from old.external_status
     or new.launch_idempotency_key is distinct from old.launch_idempotency_key
     or new.spend_cents is distinct from old.spend_cents
     or new.preflight is distinct from old.preflight
     or new.plan is distinct from old.plan
     or new.plan_version is distinct from old.plan_version
     or new.results is distinct from old.results
     or new.launched_at is distinct from old.launched_at
     or new.settled_at is distinct from old.settled_at then
    raise exception 'META_ADS_SERVER_FIELD';
  end if;
  -- Once submitted to Meta, the customer cannot edit the money or the goal
  -- from the browser: changes go through pause / a new campaign.
  if old.status in ('LAUNCHING','SUBMITTED','META_REVIEW','ACTIVE','PAUSED','COMPLETED')
     and (new.daily_budget_cents is distinct from old.daily_budget_cents
          or new.duration_days is distinct from old.duration_days
          or new.goal is distinct from old.goal
          or new.destination is distinct from old.destination) then
    raise exception 'META_ADS_LAUNCHED_LOCKED';
  end if;
  if new.status is distinct from old.status and new.status not in
     ('DRAFT','CONNECTION_REQUIRED','CREATIVE_REQUIRED','AUDIENCE_REQUIRED',
      'PREFLIGHT_REQUIRED','ARCHIVED') then
    raise exception 'META_ADS_CLIENT_STATUS';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.meta_campaigns_guard() from public, anon, authenticated;

-- 4 ─ creative description
alter table public.meta_creatives
  add column if not exists description text not null default '';

create or replace function public.meta_creatives_guard()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.role() = 'service_role' then return new; end if;
  if tg_op = 'INSERT' then
    new.safety_status := 'PENDING'; new.safety := null; new.external_creative_id := null;
    return new;
  end if;
  if new.safety is distinct from old.safety
     or new.external_creative_id is distinct from old.external_creative_id then
    raise exception 'META_ADS_SERVER_FIELD';
  end if;
  if new.headline is distinct from old.headline
     or new.primary_text is distinct from old.primary_text
     or new.description is distinct from old.description
     or new.cta is distinct from old.cta
     or new.media is distinct from old.media
     or new.destination_url is distinct from old.destination_url then
    new.safety_status := 'PENDING';
  elsif new.safety_status is distinct from old.safety_status then
    raise exception 'META_ADS_SERVER_FIELD';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.meta_creatives_guard() from public, anon, authenticated;

-- 5 ─ settings (inserted only when absent; existing values are never changed)
insert into public.admin_settings (key, value) values
  ('meta_ads_maintenance_token', to_jsonb(encode(extensions.gen_random_bytes(24), 'hex'))),
  ('meta_ads_whatsapp_enabled', 'false'::jsonb),
  ('meta_ads_default_countries', '["GE"]'::jsonb)
on conflict (key) do nothing;

-- 6 ─ the scheduled pass
do $$
begin
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
        'x-cron-token', (select value #>> '{}' from public.admin_settings where key = 'meta_ads_maintenance_token')),
      body := '{"action":"maintenance"}'::jsonb,
      timeout_milliseconds := 55000
    );
    $cron$
  );
end $$;
