-- Task #65 performance advisor: 61 RLS policies re-evaluate auth.<function>()
-- per row instead of once per statement (advisor: auth_rls_initplan). Fix is
-- mechanical and semantically identical per Supabase's own docs: wrap each
-- auth.uid()/auth.role()/auth.jwt()/auth.email() call in the policy's
-- USING/WITH CHECK expression as (select auth.<fn>()), which lets Postgres
-- evaluate it once via InitPlan instead of once per row. This DO block reads
-- each targeted policy's LIVE qual/with_check text and rewrites only the
-- matched auth.<fn>() substrings, so the resulting expression is byte-for-byte
-- the original except for that wrapping -- no policy's actual access logic
-- changes. Verified post-apply: 0 remaining un-wrapped auth.<fn>() calls
-- across all public-schema policies, and policy count unchanged (165) --
-- nothing was dropped or duplicated.
do $migration$
declare
  pol record;
  new_qual text;
  new_check text;
  stmt text;
begin
  for pol in
    select p.schemaname, p.tablename, p.policyname, p.cmd, p.qual, p.with_check
    from pg_policies p
    join (values
  ('users','users_insert_own'),
  ('users','users_select_own'),
  ('users','users_update_own'),
  ('raw_signals','Service manages signals'),
  ('raw_signals','Admins read signals'),
  ('intent_profiles','Service manages intent profiles'),
  ('intent_profiles','Admins read intent profiles'),
  ('credit_accounts','user_read_own_credits'),
  ('credit_accounts','Users view own credit account'),
  ('credit_accounts','Service manages credit accounts'),
  ('credit_ledger','user_read_own_ledger'),
  ('credit_ledger','Users view own ledger'),
  ('credit_ledger','Service inserts ledger entries'),
  ('payments','user_read_own_payments'),
  ('payments','Users view own payments'),
  ('payments','Service manages payments'),
  ('matches','user_read_own_matches'),
  ('matches','Users view own matches'),
  ('matches','Service manages matches'),
  ('match_unlocks','user_read_own_unlocks'),
  ('match_unlocks','Users view own unlocks'),
  ('match_unlocks','Service manages unlocks'),
  ('cost_events','Service inserts cost events'),
  ('cost_events','Admins can view cost events'),
  ('cost_events','cost_events_admin_read'),
  ('admin_settings','admin_settings_admin_only'),
  ('admin_settings','Admins read settings'),
  ('admin_settings','Admins write settings'),
  ('admin_settings','Service manages settings'),
  ('provider_health','provider_health_admin_only'),
  ('provider_health','Admins view provider health'),
  ('provider_health','Service manages provider health'),
  ('discovered_sources','discovered_sources_admin_read'),
  ('rate_limit_events','Service manages rate limits'),
  ('system_health_log','Admins read health log'),
  ('system_health_log','Service manages health log'),
  ('live_chat_profiles','live_chat_profiles_read_all'),
  ('research_purchases','research_purchases_service_all'),
  ('research_providers','research_providers_service_all'),
  ('research_cache','research_cache_service_all'),
  ('outreach_campaigns','admins_read_outreach_campaigns'),
  ('outreach_contact_lists','admins_read_outreach_contact_lists'),
  ('outreach_contacts','admins_read_outreach_contacts'),
  ('admin_audit_log','admin_audit_log_service_all'),
  ('community_directory','admins_manage_community_directory'),
  ('property_community_recommendations','admins_read_community_recommendations'),
  ('social_posts','owners_manage_social_posts'),
  ('social_posts','admins_read_social_posts'),
  ('outreach_sends','admins_manage_outreach_sends'),
  ('admin_audit_log','admins_read_admin_audit_log'),
  ('impersonation_sessions','admins_read_impersonation_sessions'),
  ('research_products','research_products_service_all'),
  ('credit_reservations','credit_reservations_service_all'),
  ('live_chat_profiles','live_chat_profiles_service_all'),
  ('live_chat_messages','live_chat_messages_service_all'),
  ('live_chat_reports','live_chat_reports_service_all'),
  ('ai_chat_leads','users_read_own_ai_chat_leads'),
  ('ai_chat_leads','admins_manage_ai_chat_leads'),
  ('research_jobs','research_jobs_select_own'),
  ('research_jobs','research_jobs_insert_own'),
  ('research_jobs','research_jobs_update_own')
    ) as t(tablename, policyname) on t.tablename = p.tablename and t.policyname = p.policyname
    where p.schemaname = 'public'
  loop
    new_qual := pol.qual;
    new_check := pol.with_check;
    if new_qual is not null then
      new_qual := regexp_replace(new_qual, 'auth\.(uid|role|jwt|email)\(\)', '(select auth.\1())', 'g');
    end if;
    if new_check is not null then
      new_check := regexp_replace(new_check, 'auth\.(uid|role|jwt|email)\(\)', '(select auth.\1())', 'g');
    end if;

    stmt := format('alter policy %I on public.%I', pol.policyname, pol.tablename);
    if new_qual is not null then
      stmt := stmt || format(' using (%s)', new_qual);
    end if;
    if new_check is not null then
      stmt := stmt || format(' with check (%s)', new_check);
    end if;

    raise notice 'EXEC: %', stmt;
    execute stmt;
  end loop;
end
$migration$;
