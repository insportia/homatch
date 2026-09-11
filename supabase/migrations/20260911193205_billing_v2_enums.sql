-- HOMATCH BILLING v2 — part 1 of 4: new ledger event types.
--
-- Postgres will not let a new enum value be USED in the same transaction that
-- adds it, so every ALTER TYPE lives here, alone, and the tables and functions
-- that reference these values are in the following migrations.
--
-- WHAT IS DELIBERATELY *NOT* ADDED
--
-- The mandate's event list names RESERVATION_HOLD, RESERVATION_RELEASE and
-- USAGE_CHARGE. This schema already has SERVICE_RESERVE / SERVICE_RELEASE /
-- SERVICE_CAPTURE carrying exactly those three meanings, written by four
-- shipped RPCs and rendered by CreditsPage's exhaustive
-- Record<LedgerType, ...> map. Adding synonyms would give the ledger two names
-- for one event and break that map. Reuse, do not duplicate.
--
--   RESERVATION_HOLD     == SERVICE_RESERVE    (amount = -reserved)
--   USAGE_CHARGE         == SERVICE_CAPTURE    (amount =  0: the hold already
--                                               moved the money; the settled
--                                               figure lives on the
--                                               reservation and in usage_events)
--   RESERVATION_RELEASE  == SERVICE_RELEASE    (amount = +unused)
--
-- Only genuinely new events are added below.

-- Recurring VIP / Premium credit grant at the start of a billing cycle.
ALTER TYPE public.ledger_type ADD VALUE IF NOT EXISTS 'MEMBERSHIP_GRANT';

-- Marketing credit that cannot be withdrawn or transferred and may expire.
ALTER TYPE public.ledger_type ADD VALUE IF NOT EXISTS 'PROMOTIONAL_GRANT';

-- The once-per-customer wallet-activation bonus. Separate from
-- PROMOTIONAL_GRANT so the activation funnel can be measured on its own
-- without string-matching a reference.
ALTER TYPE public.ledger_type ADD VALUE IF NOT EXISTS 'FIRST_TOPUP_BONUS';

-- A membership/promotional lot reaching its expiry date.
ALTER TYPE public.ledger_type ADD VALUE IF NOT EXISTS 'EXPIRATION';

-- An operator undoing a previous entry. Never an UPDATE or DELETE of the
-- original row: the ledger stays append-only.
ALTER TYPE public.ledger_type ADD VALUE IF NOT EXISTS 'REVERSAL';

-- One-time credit redenomination (1 Credit = $1.00 -> 1 Credit = $0.10).
-- Used exactly once, by 20260911193543. Its own type so the event is never
-- mistaken for a top-up, a bonus or an admin gift in any revenue report.
ALTER TYPE public.ledger_type ADD VALUE IF NOT EXISTS 'REDENOMINATION';
