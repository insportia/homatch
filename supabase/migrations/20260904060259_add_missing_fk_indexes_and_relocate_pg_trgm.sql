-- Task #65 security/performance advisor audit.
-- 1) pg_trgm was installed in `public` (advisor: extension_in_public). It has
--    zero trigram indexes and no similarity()/%% usage anywhere in the repo's
--    migrations, so relocating it is functionally a no-op — done for hygiene.
create schema if not exists extensions;
alter extension pg_trgm set schema extensions;

-- 2) 27 foreign keys with no covering index (advisor: unindexed_foreign_keys).
--    Every FK below backs a real, frequently-joined-on relationship (owner_id
--    lookups, campaign->contact_list, ledger reservation chains, admin audit
--    trail lookups) so these are genuine query-plan wins, not speculative.
create index if not exists idx_credit_reservations_product_code on public.credit_reservations (product_code);
create index if not exists idx_credit_reservations_ledger_reserve_id on public.credit_reservations (ledger_reserve_id);
create index if not exists idx_credit_reservations_ledger_capture_id on public.credit_reservations (ledger_capture_id);
create index if not exists idx_credit_reservations_ledger_release_id on public.credit_reservations (ledger_release_id);

create index if not exists idx_impersonation_sessions_target_user_id on public.impersonation_sessions (target_user_id);
create index if not exists idx_impersonation_sessions_audit_log_id on public.impersonation_sessions (audit_log_id);

create index if not exists idx_live_chat_profiles_suspended_by on public.live_chat_profiles (suspended_by);

create index if not exists idx_live_chat_reports_reporter_id on public.live_chat_reports (reporter_id);
create index if not exists idx_live_chat_reports_resolved_by on public.live_chat_reports (resolved_by);

create index if not exists idx_outreach_campaigns_approved_by on public.outreach_campaigns (approved_by);
create index if not exists idx_outreach_campaigns_contact_list_id on public.outreach_campaigns (contact_list_id);
create index if not exists idx_outreach_campaigns_property_id on public.outreach_campaigns (property_id);
create index if not exists idx_outreach_campaigns_owner_id on public.outreach_campaigns (owner_id);

create index if not exists idx_outreach_contact_lists_owner_id on public.outreach_contact_lists (owner_id);

create index if not exists idx_outreach_sends_contact_id on public.outreach_sends (contact_id);

create index if not exists idx_property_community_recommendations_campaign_id on public.property_community_recommendations (campaign_id);
create index if not exists idx_property_community_recommendations_community_id on public.property_community_recommendations (community_id);
create index if not exists idx_property_community_recommendations_owner_id on public.property_community_recommendations (owner_id);

create index if not exists idx_research_cache_created_by_user_id on public.research_cache (created_by_user_id);

create index if not exists idx_research_purchases_payment_id on public.research_purchases (payment_id);
create index if not exists idx_research_purchases_product_code on public.research_purchases (product_code);
create index if not exists idx_research_purchases_reservation_id on public.research_purchases (reservation_id);

create index if not exists idx_social_posts_campaign_id on public.social_posts (campaign_id);
create index if not exists idx_social_posts_community_id on public.social_posts (community_id);
create index if not exists idx_social_posts_owner_id on public.social_posts (owner_id);
create index if not exists idx_social_posts_property_id on public.social_posts (property_id);
create index if not exists idx_social_posts_recommendation_id on public.social_posts (recommendation_id);
