-- Task #69: eliminate the 269 "multiple_permissive_policies" advisor findings
-- across 29 tables.
--
-- ROOT CAUSE (confirmed by reading pg_policies.roles for every flagged table):
-- almost every policy on these tables was created with no explicit `TO` role
-- list, which defaults to `public` — i.e. the policy is evaluated for EVERY
-- Postgres role, including four roles the application never authenticates
-- as at all: `authenticator` (PostgREST's connection role before it SETs ROLE
-- to anon/authenticated/service_role), `dashboard_user` (Supabase Studio's
-- SQL editor), `cli_login_postgres` (the Supabase CLI), and
-- `supabase_privileged_role`. A service-role-only policy (qual checks
-- auth.role() = 'service_role') or an admin-only policy (qual checks
-- is_admin()) still gets planned and evaluated for all of those roles too,
-- which is exactly what the "multiple permissive policies" lint flags as
-- wasted per-row work. This migration scopes every such policy to the role(s)
-- it actually targets — a pure planner-time restriction, not a behavior
-- change: none of those four internal roles are ever used to query these
-- tables through the app, so removing them from consideration changes
-- nothing a real request can observe.
--
-- Separately, several tables accumulated a genuine DUPLICATE policy pair at
-- some point — an old `public`-scoped policy left in place after a newer,
-- correctly-scoped replacement with the identical predicate was added
-- (confirmed by comparing `qual`/`with_check` text, and for the
-- is_admin()-vs-inline-EXISTS pairs, by reading is_admin()'s own definition
-- and confirming it is exactly that EXISTS clause). Those duplicates are
-- dropped outright rather than just re-scoped, since keeping two policies
-- that do the same check for the same role/action is pure waste.
--
-- What is intentionally NOT touched here: a handful of tables legitimately
-- need two distinct permissive policies for the same role+action because
-- they serve two different audiences with different predicates (e.g.
-- "owner reads their own campaigns" OR "admin reads all campaigns" —
-- ai_chat_leads, community_directory admin+public-read, cost_events,
-- outreach_campaigns/contact_lists/contacts/sends, property_community_
-- recommendations, provider_health, research_products/providers/purchases,
-- social_posts, system_health_log, matches' two different ownership
-- predicates). Collapsing those into one merged predicate would require
-- splitting each table's admin "FOR ALL" policy into separate FOR
-- INSERT/UPDATE/DELETE policies (Postgres has no "ALL except SELECT"), which
-- is real structural surgery per table with real risk of an admin
-- write-permission regression if a predicate is transcribed wrong — not
-- justified by a pure performance lint. Those are scoped to their correct
-- role (eliminating their anon/internal-role findings, the large majority of
-- the 269) but left as two policies for that role, which is the documented,
-- accepted residual — see the accompanying report.

-- ── admin_audit_log ──────────────────────────────────────────────────────────
alter policy admin_audit_log_service_all on public.admin_audit_log to service_role;
drop policy if exists admins_read_admin_audit_log on public.admin_audit_log; -- duplicate of admin_audit_log_admin_read (is_admin() IS that EXISTS clause)
alter policy admin_audit_log_admin_read on public.admin_audit_log to authenticated;

-- ── admin_settings ───────────────────────────────────────────────────────────
alter policy "Service manages settings" on public.admin_settings to service_role;
drop policy if exists "Admins read settings" on public.admin_settings; -- subset of admin_settings_admin_only (FOR ALL, same predicate)
drop policy if exists "Admins write settings" on public.admin_settings; -- subset of admin_settings_admin_only (FOR ALL, same predicate)
alter policy admin_settings_admin_only on public.admin_settings to authenticated;

-- ── ai_chat_leads ────────────────────────────────────────────────────────────
alter policy admins_manage_ai_chat_leads on public.ai_chat_leads to authenticated;
alter policy users_read_own_ai_chat_leads on public.ai_chat_leads to authenticated;

-- ── community_directory ──────────────────────────────────────────────────────
alter policy admins_manage_community_directory on public.community_directory to authenticated;
alter policy public_read_active_communities on public.community_directory to anon, authenticated; -- genuinely public browse (qual: is_active = true, no auth check)

-- ── cost_events ──────────────────────────────────────────────────────────────
drop policy if exists "Service inserts cost events" on public.cost_events; -- subset of service_all_cost_events (already TO service_role, FOR ALL)
drop policy if exists cost_events_admin_read on public.cost_events; -- duplicate of "Admins can view cost events" (identical predicate)
alter policy "Admins can view cost events" on public.cost_events to authenticated;

-- ── credit_accounts ──────────────────────────────────────────────────────────
drop policy if exists "Service manages credit accounts" on public.credit_accounts; -- duplicate of service_all_credits (already TO service_role)
drop policy if exists "Users view own credit account" on public.credit_accounts; -- duplicate of user_read_own_credits (already TO authenticated)

-- ── credit_ledger ────────────────────────────────────────────────────────────
drop policy if exists "Service inserts ledger entries" on public.credit_ledger; -- subset of service_all_ledger (already TO service_role, FOR ALL)
drop policy if exists "Users view own ledger" on public.credit_ledger; -- duplicate of user_read_own_ledger (already TO authenticated)

-- ── credit_reservations ──────────────────────────────────────────────────────
alter policy credit_reservations_service_all on public.credit_reservations to service_role;
alter policy credit_reservations_read_own on public.credit_reservations to authenticated; -- qual already merges (user_id = auth_user_id() OR is_admin())

-- ── intent_profiles ──────────────────────────────────────────────────────────
alter policy "Service manages intent profiles" on public.intent_profiles to service_role;
alter policy "Admins read intent profiles" on public.intent_profiles to authenticated;

-- ── live_chat_messages ───────────────────────────────────────────────────────
-- (also closes a real over-exposure, not just a perf item: these were
-- `public`-scoped, meaning the anon key could read/insert live chat rows —
-- the insert policy's own predicate requires auth_user_id(), which is never
-- satisfiable as anon, so this is a role-scoping correction, not a feature
-- change for any real anon caller.)
alter policy live_chat_messages_service_all on public.live_chat_messages to service_role;
alter policy live_chat_messages_insert on public.live_chat_messages to authenticated;
alter policy live_chat_messages_select on public.live_chat_messages to authenticated;
alter policy live_chat_messages_update on public.live_chat_messages to authenticated;

-- ── live_chat_profiles ───────────────────────────────────────────────────────
alter policy live_chat_profiles_service_all on public.live_chat_profiles to service_role;
alter policy live_chat_profiles_insert_own on public.live_chat_profiles to authenticated;
alter policy live_chat_profiles_read_all on public.live_chat_profiles to authenticated; -- qual already excludes anon (auth.uid() IS NOT NULL) OR service_role
alter policy live_chat_profiles_update_own_or_admin on public.live_chat_profiles to authenticated;

-- ── live_chat_reports ────────────────────────────────────────────────────────
alter policy live_chat_reports_service_all on public.live_chat_reports to service_role;
alter policy live_chat_reports_insert_own on public.live_chat_reports to authenticated;
alter policy live_chat_reports_select on public.live_chat_reports to authenticated;
alter policy live_chat_reports_admin_update on public.live_chat_reports to authenticated;

-- ── match_unlocks ────────────────────────────────────────────────────────────
drop policy if exists "Service manages unlocks" on public.match_unlocks; -- duplicate of service_all_unlocks (already TO service_role)
drop policy if exists "Users view own unlocks" on public.match_unlocks; -- duplicate of user_read_own_unlocks (already TO authenticated)

-- ── matches ──────────────────────────────────────────────────────────────────
drop policy if exists "Service manages matches" on public.matches; -- duplicate of service_all_matches (already TO service_role)
-- "Users view own matches" (buyer/searcher side: matches.user_id) and
-- user_read_own_matches (property-owner side: property_id ownership) check
-- DIFFERENT columns for different audiences — not duplicates, just scope the
-- stray public-role one down.
alter policy "Users view own matches" on public.matches to authenticated;

-- ── message_receipts ─────────────────────────────────────────────────────────
-- Already correctly TO authenticated throughout — the finding here is pure
-- duplication: each pair below has byte-identical qual/with_check.
drop policy if exists receipt_insert_self on public.message_receipts; -- exact duplicate of receipt_insert
drop policy if exists receipt_select_participant on public.message_receipts; -- subset of receipt_select's OR clause
drop policy if exists receipt_update_self on public.message_receipts; -- exact duplicate of receipt_update

-- ── outreach_campaigns / outreach_contact_lists / outreach_contacts / outreach_sends ──
alter policy owners_manage_outreach_campaigns on public.outreach_campaigns to authenticated;
alter policy admins_read_outreach_campaigns on public.outreach_campaigns to authenticated;
alter policy owners_manage_outreach_contact_lists on public.outreach_contact_lists to authenticated;
alter policy admins_read_outreach_contact_lists on public.outreach_contact_lists to authenticated;
alter policy owners_manage_outreach_contacts on public.outreach_contacts to authenticated;
alter policy admins_read_outreach_contacts on public.outreach_contacts to authenticated;
alter policy admins_manage_outreach_sends on public.outreach_sends to authenticated;
alter policy owners_read_outreach_sends on public.outreach_sends to authenticated;

-- ── payments ─────────────────────────────────────────────────────────────────
drop policy if exists "Service manages payments" on public.payments; -- duplicate of service_all_payments (already TO service_role)
drop policy if exists "Users view own payments" on public.payments; -- duplicate of user_read_own_payments (already TO authenticated)

-- ── property_community_recommendations ──────────────────────────────────────
alter policy owners_insert_community_recommendations on public.property_community_recommendations to authenticated;
alter policy admins_read_community_recommendations on public.property_community_recommendations to authenticated;

-- ── provider_health ──────────────────────────────────────────────────────────
alter policy "Service manages provider health" on public.provider_health to service_role;
drop policy if exists "Admins view provider health" on public.provider_health; -- subset of provider_health_admin_only (FOR ALL, same predicate)
alter policy provider_health_admin_only on public.provider_health to authenticated;

-- ── raw_signals ──────────────────────────────────────────────────────────────
alter policy "Service manages signals" on public.raw_signals to service_role;
alter policy "Admins read signals" on public.raw_signals to authenticated;

-- ── research_cache ───────────────────────────────────────────────────────────
alter policy research_cache_service_all on public.research_cache to service_role;
alter policy research_cache_admin_read on public.research_cache to authenticated;

-- ── research_products ────────────────────────────────────────────────────────
alter policy research_products_admin_write on public.research_products to authenticated;
alter policy research_products_service_all on public.research_products to service_role;
alter policy research_products_read_enabled on public.research_products to anon, authenticated; -- public catalog read (enabled = true OR is_admin())

-- ── research_providers ───────────────────────────────────────────────────────
alter policy research_providers_admin_only on public.research_providers to authenticated;
alter policy research_providers_service_all on public.research_providers to service_role;

-- ── research_purchases ───────────────────────────────────────────────────────
alter policy research_purchases_service_all on public.research_purchases to service_role;
alter policy research_purchases_read_own on public.research_purchases to authenticated; -- qual already merges (user_id = auth_user_id() OR is_admin())

-- ── social_posts ─────────────────────────────────────────────────────────────
alter policy owners_manage_social_posts on public.social_posts to authenticated;
alter policy admins_read_social_posts on public.social_posts to authenticated;

-- ── system_health_log ────────────────────────────────────────────────────────
alter policy "Service manages health log" on public.system_health_log to service_role;
alter policy "Admins read health log" on public.system_health_log to authenticated;
