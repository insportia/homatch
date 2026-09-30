-- TELEGRAM COMMUNITIES FOUND BY SOURCE DISCOVERY GET A REGISTRY ENTRY.
--
-- Source discovery registered communities in community_targets only. Their
-- signals therefore carried source_id = null, and revalidate-evidence answers
-- such a row "source is unregistered and has never been audited; not
-- requested" — the evidence stays UNKNOWN for good. community-sync now
-- registers a community once a real read proved it public (sourceDiscovery.ts
-- registerSource); this backfills the ones already read. Idempotent.

-- 1. A registry entry for every READABLE Telegram target without one. An
--    existing entry for the same channel is kept exactly as it is.
insert into public.source_registry
  (platform, external_id, url, source_type, source_family, country_code,
   access_state, access_finding, lifecycle, adapter_id, active, priority_rationale)
select 'TELEGRAM', t.external_id, 'https://t.me/' || t.external_id, 'TELEGRAM_GROUP', 'PUBLIC_COMMUNITY',
       upper(coalesce(nullif(t.market, ''), 'GE')), 'PUBLIC', 'PUBLIC_HTML', 'AUDITED', 'telegram:mtproto', false,
       'Registered by Telegram source discovery after a real read of its recent public messages.'
  from public.community_targets t
 where t.platform::text = 'TELEGRAM'
   and t.source_id is null
   and t.readability = 'READABLE'
   and t.external_id ~ '^[A-Za-z0-9_]{3,64}$'
on conflict (platform, external_id) do nothing;

-- 2. Link each target to its entry.
update public.community_targets t
   set source_id = r.id, source_registry_id = coalesce(t.source_registry_id, r.id)
  from public.source_registry r
 where t.platform::text = 'TELEGRAM'
   and t.source_id is null
   and r.platform::text = 'TELEGRAM'
   and r.external_id = t.external_id;

-- 3. And each signal read from it.
update public.raw_signals s
   set source_id = t.source_id
  from public.community_targets t
 where s.target_id = t.id
   and s.source_id is null
   and t.source_id is not null;
