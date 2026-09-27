-- Homatch — one canonical intent signal, whatever surface produced it.
--
-- WHY THIS EXISTS. `ai_chat_leads` already holds 28 rows of extracted requirements from
-- one page. It is real and it works, and it cannot say which SIDE the person is on,
-- whether they were speaking about THEMSELVES, how firmly they meant it, which PROPERTY
-- they meant, or whether they were saying yes or no. Build a second one of those for the
-- live chat and a third for private messages and the product ends up with five models of
-- the same fact that disagree.
--
-- So: one row shape, many sources. Each source contributes a REFERENCE to its own event.
--
-- IT DOES NOT COPY WHAT PEOPLE WROTE
--
-- There is no body column here and there will not be one. Copying private messages into a
-- matching table would put somebody's words in a second place with different access rules
-- and no way to honour a deletion — and a match explanation built from a quoted private
-- sentence is a leak wearing a rationale's clothes. The row points at
-- (source_surface, source_event_id); whoever may read the original may read the original.
--
-- THE THREE DISTINCTIONS THAT MAKE IT SAFE
--
--   ATTRIBUTION. "My brother is looking for a flat" is not the author looking for a flat.
--   Only SELF may become that person's own demand; everything else is market intelligence
--   at most, and never a claim about the speaker.
--
--   SCOPE. "I'm not interested in this one any more" ends one relationship. It does not
--   end the search. A statement made about a property must not be promoted into a rule
--   about every property.
--
--   CONFIDENCE IS NOT STRENGTH. We can be certain somebody said "I'd prefer Vake" and
--   that preference is still PREFERRED. One is how well we read them; the other is how
--   firmly they meant it. Conflating them turns a confident reading of a soft preference
--   into a hard filter that silently hides the right flat.

create table if not exists public.intent_signals (
  id uuid primary key default gen_random_uuid(),

  /* ── who ──────────────────────────────────────────────────────────────
   * Resolved server-side from the row that owns the source event. A client
   * never sends this: the RLS policies below let somebody read their own
   * signals and write none at all.
   */
  actor_user_id uuid not null references public.users(id) on delete cascade,

  /* ── where it came from ───────────────────────────────────────────────
   * The surface and the id of the event on it. Together they are the
   * IDENTITY of the signal, which is what makes reprocessing the same
   * message harmless — see the unique index below.
   */
  source_surface text not null check (source_surface in (
    'LIVE_CHAT', 'PRIVATE_MESSAGE', 'VIEWING_REQUEST', 'SEARCH_PLAN', 'AI_CHAT'
  )),
  source_event_id uuid not null,
  source_at timestamptz not null,

  /* ── what kind of thing was said ──────────────────────────────────── */
  side text not null check (side in (
    /* looking for something */            'DEMAND',
    /* offering something */               'SUPPLY',
    /* about one specific property */      'PROPERTY_INTEREST'
  )),
  /* Saying no is as informative as saying yes, and must not be stored as absence. */
  polarity text not null default 'POSITIVE' check (polarity in ('POSITIVE', 'NEGATIVE')),

  /*
   * WHOSE INTENT IT IS. The single most dangerous field here: a third-party sentence
   * promoted to SELF tells an owner that somebody is personally interested when they
   * were talking about their brother.
   */
  attribution text not null check (attribution in (
    'SELF', 'THIRD_PARTY', 'QUOTED', 'UNKNOWN'
  )),

  /* Did they say it, or did we deduce it? Kept apart so an inference can never be
     mistaken for a statement later. */
  explicit boolean not null default false,
  /* How well we read them. NOT how firmly they meant it — see `strength`. */
  confidence numeric not null default 0 check (confidence >= 0 and confidence <= 1),

  /*
   * HOW WIDE. PROPERTY is about one property; SEARCH refines a named requirement;
   * GENERAL is a statement about what this person wants overall.
   */
  scope text not null check (scope in ('PROPERTY', 'SEARCH', 'GENERAL')),

  /* ── what it is about ─────────────────────────────────────────────────
   * References, not copies. Null where the scope does not name one.
   */
  property_id   uuid references public.properties(id) on delete cascade,
  intent_profile_id uuid references public.intent_profiles(id) on delete set null,
  conversation_id   uuid references public.conversations(id) on delete set null,

  /*
   * THE CONSTRAINTS THEMSELVES, in the shape the matcher already reads. Deliberately the
   * same vocabulary as intent_profiles so nothing has to be translated on the way into
   * assessMatch(): city, district, property types, budget, bedrooms, area.
   */
  constraints jsonb not null default '{}'::jsonb
    check (jsonb_typeof(constraints) = 'object'),
  /*
   * REQUIRED / PREFERRED / FLEXIBLE per dimension, as a map. A dimension absent from
   * here is REQUIRED, which is what the matcher already assumes.
   */
  strength jsonb not null default '{}'::jsonb
    check (jsonb_typeof(strength) = 'object'),

  /* ── effective state ──────────────────────────────────────────────────
   * People change their minds. The later statement supersedes the earlier one and the
   * earlier one STAYS — provenance is not a thing to delete because it stopped being
   * current. Matching reads only rows where superseded_by is null.
   */
  superseded_by uuid references public.intent_signals(id) on delete set null,
  /*
   * A source message that was edited or deleted must not leave a strong intent standing.
   * Withdrawn rather than removed: the row records that it happened and when.
   */
  withdrawn_at timestamptz,
  withdrawn_reason text check (withdrawn_reason in (
    'SOURCE_EDITED', 'SOURCE_DELETED', 'USER_REPLACED', 'SUPERSEDED'
  )),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.intent_signals is
  'One canonical intent signal per meaningful interaction, whatever surface produced it. References its source event; never copies the text.';

/*
 * IDENTITY IS THE SOURCE EVENT.
 *
 * Reprocessing a message — a worker retry, a realtime frame delivered twice, a backfill —
 * finds the row it already wrote instead of adding a second. This is the whole of
 * idempotency for this layer and it is a database guarantee rather than a check the
 * caller remembers to do.
 *
 * `side` is in the key because one sentence can legitimately say two things: "I'm selling
 * mine and looking for something bigger" is a SUPPLY and a DEMAND from one message.
 */
create unique index if not exists intent_signals_source_key
  on public.intent_signals (source_surface, source_event_id, side);

/* What the matcher asks for: this person's current, self-stated, positive intent. */
create index if not exists intent_signals_effective_idx
  on public.intent_signals (actor_user_id, side, source_at desc)
  where superseded_by is null and withdrawn_at is null
    and attribution = 'SELF' and polarity = 'POSITIVE';

/* And what a property surface asks: who has said something about this one. */
create index if not exists intent_signals_property_idx
  on public.intent_signals (property_id, source_at desc)
  where property_id is not null and superseded_by is null and withdrawn_at is null;

alter table public.intent_signals enable row level security;

/*
 * A PERSON MAY READ WHAT WAS UNDERSTOOD ABOUT THEM, AND CHANGE NOTHING.
 *
 * Read, because §29 of the requirement is right: an invisible permanent requirement that
 * a customer cannot see or correct is a trap. Write, never — the actor is resolved from
 * the row that owns the source event, and a customer who could insert here could forge
 * somebody else's demand, or their own interest in a stranger's property.
 *
 * Everything that writes is a service-role worker. Nobody else has a policy at all.
 */
drop policy if exists intent_signals_read_own on public.intent_signals;
create policy intent_signals_read_own on public.intent_signals
  for select using (actor_user_id = get_user_id());

drop trigger if exists trg_intent_signals_updated_at on public.intent_signals;
create trigger trg_intent_signals_updated_at
  before update on public.intent_signals
  for each row execute function public.update_updated_at();
