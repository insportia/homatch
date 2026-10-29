-- Terms and Privacy 2026-10-29: new operator and subscription Terms.
--
-- WHAT CHANGED
--
-- The operator (the contracting party in the Terms and the controller in the
-- Privacy Policy) changed from an individual entrepreneur to
-- შპს „ულტრა ქონექშენ“, identification code 406378511
-- (src/lib/legal/operator.ts). The Terms' fees section now describes monthly
-- GEL plans, the first-use trial, the end of credit sales and cancellation at
-- the end of the billing period.
--
-- WHY reaccept_existing = true
--
-- 20261206100000_policy_acceptance.sql defines re-acceptance: accounts
-- created before effective_at are asked again only when reaccept_existing is
-- true, which it reserves for a material change. A new contracting party and
-- a new data controller are material for both documents, and so is a new
-- pricing model for the Terms. Every existing account is therefore asked once
-- to accept the 2026-10-29 versions (policy_acceptance_status() returns
-- required = true until they do). If the owner decides otherwise, set
-- reaccept_existing = false in a later migration; nothing here forces it.
--
-- HOW IT IS PUBLISHED
--
-- That migration's contract: publishing a new version is an UPDATE of the
-- policy's single row (policy is the primary key). The previous version's
-- acceptances stay in policy_acceptances untouched: history is not rewritten.
--
-- ORDER
--
-- accept_current_policies() refuses a client that names another version, so
-- apply this together with the frontend that carries
-- LEGAL_OPERATOR.versions = 2026-10-29. Between the two, a signup records no
-- acceptance and that account is simply held at the acceptance screen, which
-- the new frontend clears.
--
-- Idempotent: re-running leaves the row as it is once it holds 2026-10-29.

update public.legal_policy_versions
   set version           = '2026-10-29',
       effective_at      = timestamptz '2026-10-29 00:00:00+04',
       requires_acceptance = true,
       reaccept_existing = true,
       updated_at        = now()
 where policy in ('terms', 'privacy')
   and version is distinct from '2026-10-29';

-- A database that never received the 2026-10-25 seed still ends up current.
insert into public.legal_policy_versions (policy, version, effective_at, requires_acceptance, reaccept_existing)
values ('terms', '2026-10-29', timestamptz '2026-10-29 00:00:00+04', true, true),
       ('privacy', '2026-10-29', timestamptz '2026-10-29 00:00:00+04', true, true)
on conflict (policy) do nothing;
