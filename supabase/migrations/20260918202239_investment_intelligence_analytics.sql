-- HOMATCH INVESTMENT INTELLIGENCE — analytics events.
--
-- ADDITIVE AND NOTHING ELSE. Five values on an existing enum. No table, no
-- column, no policy, no grant, no data. Investment Intelligence deliberately
-- introduces no schema of its own: the scenario is local working state, the
-- research lane reuses rate_limit_events, and the consultation reuses the AI
-- fair-use path — so the only thing the database has to learn is the names of
-- five events that already have call sites in src/components/investment.
--
-- Each ALTER TYPE ... ADD VALUE is its own statement and none of them is
-- referenced later in this file, which is what Postgres requires: a value
-- added in a transaction cannot be used inside that same transaction.
--
-- src/types/types.ts mirrors public.activity_event_type exactly; the union
-- there was extended in the same change. A value in one and not the other is
-- either a type error TypeScript will catch or a 22P02 at insert time, which
-- is why they move together.
--
-- APPLIED-AND-RECORDED, NOT PENDING. This file's version prefix is the
-- version supabase_migrations.schema_migrations actually holds for it, so
-- the repository and the ledger agree and `db push` will not replay it. That
-- is the convention the two migrations immediately before this one follow;
-- writing a fresh timestamp here instead would be exactly the ledger drift
-- the deploy workflow's own comments are about.

alter type public.activity_event_type add value if not exists 'INVESTMENT_PAGE_OPENED';
alter type public.activity_event_type add value if not exists 'INVESTMENT_CONSULTATION_TURN';
alter type public.activity_event_type add value if not exists 'INVESTMENT_PROPERTY_ATTACHED';
alter type public.activity_event_type add value if not exists 'INVESTMENT_RESEARCH_REQUESTED';
alter type public.activity_event_type add value if not exists 'INVESTMENT_EVIDENCE_APPLIED';
