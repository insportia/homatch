-- THE OTHER HALF OF THE PRODUCT, PERSISTED.
--
-- `matches` has always been property -> demand: a seller's property on one side and
-- an intent_profile on the other, which answers FIND BUYERS. Nothing persisted the
-- reverse, so FIND PROPERTY had nowhere to put an answer:
--
--   matches         property_id  x intent_profile_id   "who wants this flat"
--   supply_matches  observation  x intent_profile_id   "which flat fits this person"
--
-- Both are produced by the SAME assessMatch() in research-core, so the two directions
-- cannot disagree about a pair. What differs is only which side was fixed while the
-- other was iterated, and therefore which table the answer lands in.
--
-- WHY NOT JUST ADD COLUMNS TO campaign_supply_references
--
-- Because that table answers a different question and answering two would make it
-- lie about both. It records WHICH observations a campaign touched and whether it
-- discovered or reused them -- provenance and cost accounting, one row per
-- campaign/observation. A compatibility verdict is per DEMAND: the same observation
-- is an excellent match for one buyer and a poor one for the next, and there is no
-- single score to write on a row keyed by campaign.
--
-- WHAT THE COLUMNS ARE FOR
--
-- Every verdict this stores has to be explainable to the customer it is shown to, so
-- the full dimension trace is persisted rather than just the number. A score with no
-- reasons is exactly the kind of opaque relevance this product is supposed to be an
-- alternative to -- and `match_reasons` on the existing table proved the point: it is
-- read straight onto the Matches screen.
--
-- THE FOUR BUCKETS ARE SEPARATE COLUMNS, not one blob, because they mean different
-- things and get queried differently. "Show me matches that missed a stated
-- preference" is a real operator question; "show me matches with something in the
-- jsonb" is not.

create table if not exists supply_matches (
  id uuid primary key default gen_random_uuid(),

  /*
   * The DEMAND side. intent_profile_id is the person; signal_id is the evidence they
   * came from, carried so a match survives re-classification.
   *
   * BOTH, and that is deliberate. run-matching-v2 learned this expensively:
   * intent_profile_id does NOT survive re-classification -- classify-signals-v2
   * deletes the profile and inserts a fresh row -- so a dedup guard keyed on it saw
   * nothing and one forum post was sold twice. The uniqueness below is keyed on the
   * SIGNAL for that reason.
   */
  intent_profile_id uuid references intent_profiles(id) on delete cascade,
  signal_id uuid not null references raw_signals(id) on delete cascade,

  /* The SUPPLY side: a row in the global intelligence store. */
  observation_id uuid not null references supply_observations(id) on delete cascade,

  /* Which campaign asked. Null for a standing active-search subscription. */
  campaign_id uuid references matching_campaigns(id) on delete set null,

  /*
   * The verdict, as assessMatch() returned it. INCOMPATIBLE rows are NOT normally
   * written -- there is no product reason to store every pair that failed -- but the
   * column permits it so an operator investigating "why was this not shown" can have
   * a run persist its refusals deliberately.
   */
  compatibility text not null
    check (compatibility in ('COMPATIBLE', 'INSUFFICIENT_INFORMATION', 'INCOMPATIBLE')),

  /* 0..1. Meaningful ONLY when compatibility is COMPATIBLE, and the check says so. */
  match_score numeric not null default 0
    check (match_score >= 0 and match_score <= 1),
  constraint supply_matches_score_requires_compatibility
    check (compatibility = 'COMPATIBLE' or match_score = 0),

  /* Who the two parties are, and what kind of deal. Null when a row did not say. */
  demand_role text check (demand_role in ('BUYER', 'TENANT', 'GUEST', 'INVESTOR')),
  supply_role text check (supply_role in ('SELLER', 'LANDLORD', 'DEVELOPER', 'AGENCY', 'BROKER')),
  deal_kind text check (deal_kind in
    ('SALE', 'RENT', 'SHORT_STAY', 'COMMERCIAL', 'LAND', 'INVESTMENT')),

  /*
   * The four buckets, kept apart. A hard conflict, a missed preference, an explicit
   * "I do not mind" and an unrecorded field are four different situations, and a
   * product that stored them in one list could not tell a customer which it was.
   */
  agreed text[] not null default '{}',
  conflicted text[] not null default '{}',
  preference_misses text[] not null default '{}',
  unknown_dimensions text[] not null default '{}',
  flexible_dimensions text[] not null default '{}',

  /* The sentence a customer reads. Never a score, never jargon. */
  rationale text not null default '',
  /* The full per-dimension trace: verdict, strength and reason for each. */
  dimensions jsonb not null default '[]'::jsonb,

  /*
   * The publication-age ceiling that was in force, and where its number came from.
   * A match is only as current as the listing behind it, and "we showed this under a
   * 90-day ASSUMED ceiling" is the difference between an explainable decision and a
   * mystery once the ceilings are calibrated.
   */
  listing_age_days integer,
  listing_age_basis text check (listing_age_basis in ('ASSUMED', 'CONFIGURED', 'MEASURED')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

/*
 * ONE PERSON, ONE MATCH PER LISTING -- KEYED ON THE SIGNAL, NOT THE PROFILE.
 *
 * The exact lesson run-matching-v2 paid for on 2026-09-26: forum.ge post 14328580,
 * one buyer, one post, ended up with two matches on the same property because the
 * guard was keyed on intent_profile_id and re-classification had issued a new one.
 * The customer was invited to buy the same person twice.
 */
create unique index if not exists supply_matches_signal_observation_key
  on supply_matches (signal_id, observation_id);

/* The two read paths: a campaign's results, and one person's results. */
create index if not exists supply_matches_campaign_score_idx
  on supply_matches (campaign_id, match_score desc)
  where compatibility = 'COMPATIBLE';

create index if not exists supply_matches_signal_idx
  on supply_matches (signal_id);

create index if not exists supply_matches_observation_idx
  on supply_matches (observation_id);

comment on table supply_matches is
  'FIND PROPERTY: which supply fits a given demand. The mirror of `matches`, produced '
  'by the same assessMatch() in research-core so the two directions cannot disagree '
  'about a pair. Uniqueness is keyed on signal_id because intent_profile_id does not '
  'survive re-classification.';

/*
 * RLS ON, and no policy for anonymous or authenticated callers.
 *
 * Matching output is produced by service-role workers and read back through edge
 * functions that check the caller themselves -- the same posture supply_observations
 * already has. A permissive policy here would expose every demand signal in the
 * store to any signed-in user.
 */
alter table supply_matches enable row level security;

revoke all on table supply_matches from anon, authenticated;
grant select, insert, update on table supply_matches to service_role;
