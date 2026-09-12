-- HOMATCH — the AI Communications Hub data model.
--
-- WHAT THIS MIGRATION REFUSES TO DO
--
-- It does not create a second wallet, a second contact database, a second
-- campaign table, a second provider registry or a second job queue. Homatch
-- already has all five and they work:
--
--   credit_accounts / credit_lots / credit_reservations / usage_events
--                                     the wallet. Reached only through
--                                     _shared/billing.ts. Untouched here.
--   outreach_campaigns / outreach_contacts / outreach_contact_lists /
--   outreach_sends                    the campaign and audience model. This
--                                     migration WIDENS them; it replaces none
--                                     of them, and every existing row keeps
--                                     its meaning.
--   finance_provider_registry / finance_provider_prices /
--   finance_provider_cost_events      provider COGS and reconciliation.
--                                     Two rows are added, no structure.
--   background_jobs                   the durable job index. Two new
--                                     product_type values, nothing else.
--
-- Everything below is a concept that has no existing home. Each table carries
-- the reason it had to be new immediately above it. If a reason does not
-- survive review, the table should not survive either.
--
-- WHY IT IS SAFE TO DEPLOY BEFORE THE FRONTEND MERGES
--
-- Every change is additive. New tables nothing reads yet; new columns that are
-- nullable or defaulted; CHECK constraints that are only ever WIDENED, so no
-- value that is legal today becomes illegal. Production's current frontend
-- neither selects nor writes any of it. There is no drop, no rename, no type
-- change and no backfill that rewrites an existing value.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. AGENTS
-- ════════════════════════════════════════════════════════════════════════════
--
-- WHY A TABLE. An AI agent today is outreach_campaigns.call_agent_config — a
-- jsonb blob owned by one campaign. That shape cannot answer any of the
-- questions the product asks: which agents does this user have, which campaigns
-- use this one, how did it perform, and — the one that matters for an audit —
-- what exactly was this agent saying on the day it made that call. An agent is
-- a reusable, versioned, reportable object. call_agent_config stays where it is
-- and keeps working for campaigns that never adopt an agent.

create table if not exists public.comm_agents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,

  name text not null,
  -- What this agent is FOR, in the user's own words. Shown in the list; also
  -- the text the real-estate domain gate classifies before a campaign runs.
  purpose text,
  template_code text not null default 'CUSTOM' check (template_code in (
    'BUYER_QUALIFICATION', 'SELLER_QUALIFICATION', 'PROPERTY_FOLLOWUP',
    'VIEWING_CONFIRMATION', 'COLD_REACTIVATION', 'DEVELOPER_SALES',
    'RENTAL_INQUIRY', 'MORTGAGE_FOLLOWUP', 'INVESTOR_QUALIFICATION', 'CUSTOM'
  )),

  status text not null default 'DRAFT' check (status in (
    'DRAFT', 'READY', 'PAUSED', 'NEEDS_ATTENTION', 'ARCHIVED'
  )),

  -- Which channels this agent may be used on. An agent written for a phone
  -- call is not automatically fit to answer WhatsApp, so the user says so.
  channels text[] not null default array['AI_CALL']::text[],

  -- BCP-47-ish tags, matching src/i18n. First entry is the opening language.
  languages text[] not null default array['ka']::text[],

  -- Behaviour. Deliberately separate columns rather than one blob: the review
  -- screen, the domain classifier and the version diff all read these
  -- individually, and a blob makes each of them guess.
  introduction text,
  primary_goal text,
  business_context text,
  target_audience text,
  tone text not null default 'PROFESSIONAL',
  qualification_questions jsonb not null default '[]'::jsonb,
  knowledge_notes text,
  allowed_actions text[] not null default '{}'::text[],
  forbidden_actions text[] not null default '{}'::text[],
  escalation_instructions text,
  callback_rules text,

  -- Voice. The user picks a voice; which PROVIDER serves it is an admin
  -- concern and is resolved at call time from comm_provider_routes.
  voice_id text,
  voice_label text,

  -- §114. Lawful disclosure that the caller is speaking to an AI assistant.
  -- Defaults on: a deceptive default is not a default we are willing to ship.
  ai_disclosure_enabled boolean not null default true,

  -- Property context this agent may state as fact (§115/§116).
  property_id uuid references public.properties(id) on delete set null,

  current_version int not null default 0,
  last_used_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists comm_agents_owner_idx on public.comm_agents(owner_id, updated_at desc);
create index if not exists comm_agents_status_idx on public.comm_agents(owner_id, status);

-- WHY A SECOND TABLE. §11 requires a live campaign to remain traceable to the
-- exact agent version it used. Editing comm_agents in place destroys that: a
-- transcript from Tuesday would be explained by Thursday's instructions. Each
-- publish freezes a snapshot here, and outreach_campaigns points at the
-- snapshot, not at the mutable agent.
create table if not exists public.comm_agent_versions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.comm_agents(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  version int not null,
  -- The whole agent as it was, including the columns above. Here a blob IS
  -- right: nothing queries inside a frozen snapshot, it is read whole or not
  -- at all, and a column added to comm_agents later must not make old
  -- snapshots unreadable.
  snapshot jsonb not null,
  published_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (agent_id, version)
);

create index if not exists comm_agent_versions_agent_idx on public.comm_agent_versions(agent_id, version desc);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. CHANNEL ACCOUNTS
-- ════════════════════════════════════════════════════════════════════════════
--
-- WHY A TABLE. There is nowhere to record "this is the number Homatch calls
-- from" or "this is the WhatsApp business number this account sends as".
-- finance_provider_registry describes a VENDOR relationship (credentials,
-- prices, caps); it does not describe an identity a customer speaks through.
-- Holding these as env vars stops working the moment a second number exists.
--
-- NO SECRETS LIVE HERE. Only identifiers Meta and the telephony providers
-- already treat as public-ish, plus a boolean saying whether the credential
-- exists in Supabase secrets. §40, §139.
create table if not exists public.comm_channel_accounts (
  id uuid primary key default gen_random_uuid(),
  -- null = a platform-owned shared identity (the Meta test number today).
  -- Non-null = an identity belonging to one customer.
  owner_id uuid references auth.users(id) on delete cascade,

  label text not null,
  channel text not null check (channel in ('WHATSAPP', 'VOICE', 'SMS')),
  provider text not null check (provider in ('META', 'VAPI', 'TWILIO', 'TELNYX', 'CARTESIA', 'MOCK')),

  phone_e164 text,
  country text,
  display_name text,

  -- Meta identifiers. Not secrets: the phone number id and WABA id appear in
  -- every webhook payload Meta sends us.
  provider_account_id text,   -- WABA id for Meta
  provider_number_id text,    -- phone_number_id for Meta

  capabilities text[] not null default '{}'::text[],  -- INBOUND, OUTBOUND, VOICE, TEMPLATE
  status text not null default 'PENDING' check (status in (
    'PENDING', 'CONNECTED', 'ACTION_REQUIRED', 'DISABLED'
  )),
  -- §30/§100. The Meta test number is not a production sender and the product
  -- must never round that up.
  environment text not null default 'TEST' check (environment in ('TEST', 'PRODUCTION')),

  -- Whatever the provider reports and nothing we invented (§33).
  quality_rating text,
  messaging_tier text,
  verification_state text,

  webhook_verified_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  last_error text,

  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists comm_channel_accounts_owner_idx on public.comm_channel_accounts(owner_id, channel);
create unique index if not exists comm_channel_accounts_number_idx
  on public.comm_channel_accounts(provider, provider_number_id)
  where provider_number_id is not null;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. WHATSAPP TEMPLATES
-- ════════════════════════════════════════════════════════════════════════════
--
-- WHY A TABLE. Meta decides whether a business-initiated message may be sent,
-- and it decides per template, per language, and it changes its mind. That
-- approval state is a fact about the outside world that we must store, show,
-- and refuse to send against. outreach_campaigns.html_body is free text; it
-- cannot be "PENDING at Meta".
create table if not exists public.comm_whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  channel_account_id uuid references public.comm_channel_accounts(id) on delete set null,

  name text not null,
  language text not null default 'en',
  category text not null default 'MARKETING' check (category in ('MARKETING', 'UTILITY', 'AUTHENTICATION')),

  header_kind text check (header_kind in ('NONE', 'TEXT', 'IMAGE', 'DOCUMENT', 'VIDEO')),
  header_text text,
  body_text text not null,
  footer_text text,
  buttons jsonb not null default '[]'::jsonb,
  -- {{1}} … {{n}} -> what each one means, and an example for Meta review.
  variables jsonb not null default '[]'::jsonb,

  -- Meta's answer, never ours. A template we generated with AI is DRAFT until
  -- Meta says otherwise (§37).
  status text not null default 'DRAFT' check (status in (
    'DRAFT', 'SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED'
  )),
  provider_template_id text,
  rejection_reason text,
  last_synced_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, name, language)
);

create index if not exists comm_whatsapp_templates_owner_idx on public.comm_whatsapp_templates(owner_id, status);

-- ════════════════════════════════════════════════════════════════════════════
-- 4. CONVERSATIONS AND MESSAGES
-- ════════════════════════════════════════════════════════════════════════════
--
-- WHY NOT ai_conversations / ai_messages. Those are the AI Chat product: one
-- authenticated user talking to Homatch's assistant. There is no contact, no
-- channel, no delivery receipt, no provider message id, no opt-out and no
-- human takeover, because none of those exist in that product. §5 is explicit
-- that AI Chat stays a distinct surface.
--
-- WHY NOT public.conversations. That is person-to-person messaging between two
-- Homatch users (conversation_blocks, conversation_reports, contact shares).
-- A WhatsApp thread has one Homatch user and one outside phone number.
--
-- WHY NOT outreach_sends. A send is one outbound attempt. A conversation is a
-- two-sided thread that outlives any campaign, and inbound messages have no
-- campaign at all. outreach_sends keeps doing its job and now carries a
-- pointer to the thread the send landed in.
create table if not exists public.comm_conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid references public.outreach_contacts(id) on delete set null,
  channel_account_id uuid references public.comm_channel_accounts(id) on delete set null,

  channel text not null check (channel in ('WHATSAPP', 'AI_CALL', 'SMS', 'EMAIL')),
  -- The outside party, as the provider addresses them. Kept denormalised
  -- because an inbound message can arrive before any contact row exists.
  peer_address text not null,
  peer_name text,
  language text,

  -- §36. Exactly one of AI or a human is answering, and the transition is
  -- explicit and recorded. Both replying at once is the failure this column
  -- exists to make impossible.
  mode text not null default 'AI_ACTIVE' check (mode in (
    'AI_ACTIVE', 'HUMAN_ACTIVE', 'PENDING_HANDOFF', 'PAUSED', 'CLOSED'
  )),
  mode_changed_by uuid references auth.users(id) on delete set null,
  mode_changed_at timestamptz,
  mode_change_reason text,

  status text not null default 'OPEN' check (status in ('OPEN', 'ARCHIVED')),
  lead_stage text not null default 'NEW' check (lead_stage in (
    'NEW', 'REACHED', 'ENGAGED', 'QUALIFIED', 'INTERESTED',
    'CALLBACK', 'VIEWING', 'CONVERTED', 'LOST'
  )),
  lead_score smallint check (lead_score between 0 and 100),

  unread_count int not null default 0,
  last_message_at timestamptz,
  last_message_preview text,
  last_inbound_at timestamptz,

  -- Meta's 24-hour customer service window. After it, only an approved
  -- template may be sent, and the send path checks this rather than guessing.
  service_window_expires_at timestamptz,

  assigned_to uuid references auth.users(id) on delete set null,
  campaign_id uuid references public.outreach_campaigns(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One live thread per (owner, channel, peer). The inbox depends on this: two
-- rows for the same number is how an operator ends up answering half a
-- conversation.
create unique index if not exists comm_conversations_thread_idx
  on public.comm_conversations(owner_id, channel, peer_address);
create index if not exists comm_conversations_inbox_idx
  on public.comm_conversations(owner_id, status, last_message_at desc);

create table if not exists public.comm_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.comm_conversations(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,

  direction text not null check (direction in ('INBOUND', 'OUTBOUND')),
  -- Who produced an outbound message. Needed for §122 agent analytics and for
  -- an honest inbox: "the AI said this" is different from "you said this".
  author text not null default 'CONTACT' check (author in ('CONTACT', 'AI', 'HUMAN', 'SYSTEM')),
  author_user_id uuid references auth.users(id) on delete set null,
  agent_version_id uuid references public.comm_agent_versions(id) on delete set null,

  kind text not null default 'TEXT' check (kind in (
    'TEXT', 'TEMPLATE', 'IMAGE', 'DOCUMENT', 'AUDIO', 'VIDEO', 'LOCATION',
    'CONTACT', 'STICKER', 'SYSTEM', 'UNSUPPORTED'
  )),
  body text,
  media_url text,
  media_mime text,
  media_provider_id text,
  -- Voice notes (§118): what the STT heard, kept beside the audio it came from.
  transcript text,

  template_id uuid references public.comm_whatsapp_templates(id) on delete set null,
  template_variables jsonb,

  -- §88. Homatch's own vocabulary, so no component has to know Meta's.
  status text not null default 'QUEUED' check (status in (
    'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'RECEIVED', 'DELETED'
  )),
  -- Kept beside it, never in place of it, so support can see what the
  -- provider actually said.
  provider_status_raw text,
  provider_message_id text,
  error_code text,
  error_message text,

  -- What Homatch charged. Provider COGS goes to finance_provider_cost_events,
  -- exactly once, via the double-count guard that already exists there.
  cost_usd numeric(12,6),

  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists comm_messages_thread_idx on public.comm_messages(conversation_id, created_at desc);
create index if not exists comm_messages_owner_idx on public.comm_messages(owner_id, created_at desc);
-- Status callbacks arrive keyed by the provider's id and nothing else.
create unique index if not exists comm_messages_provider_id_idx
  on public.comm_messages(provider_message_id)
  where provider_message_id is not null;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. WEBHOOK EVENTS
-- ════════════════════════════════════════════════════════════════════════════
--
-- WHY A TABLE. Meta retries. Retells retries. Every provider retries, and a
-- retry that charges a wallet twice or appends a message twice is the single
-- most expensive bug this subsystem can have (§31, §69, §129). Dedup needs a
-- durable unique key, and a unique index is the only place a race actually
-- loses. The raw payload is kept for a bounded window for support, then
-- dropped by the retention sweep (§120).
create table if not exists public.comm_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  -- Provider's own event/message id, or a hash when it supplies none. This
  -- index IS the idempotency guarantee.
  event_key text not null,
  event_type text,
  channel_account_id uuid references public.comm_channel_accounts(id) on delete set null,

  processed_at timestamptz,
  processing_error text,
  attempt smallint not null default 0,
  -- Counts duplicate deliveries so §86 can instrument them instead of
  -- silently swallowing them.
  duplicate_count int not null default 0,

  payload jsonb,
  received_at timestamptz not null default now(),
  purge_after timestamptz not null default (now() + interval '30 days'),
  unique (provider, event_key)
);

create index if not exists comm_webhook_events_purge_idx on public.comm_webhook_events(purge_after);
create index if not exists comm_webhook_events_unprocessed_idx
  on public.comm_webhook_events(provider, received_at desc) where processed_at is null;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. STRUCTURED EXTRACTION
-- ════════════════════════════════════════════════════════════════════════════
--
-- WHY A TABLE. §42 forbids overwriting a high-confidence, user-confirmed fact
-- with a lower-confidence AI guess. That rule cannot be enforced if the guess
-- is written straight onto outreach_contacts, because then there is nothing
-- left to compare it against. Extractions land here with their provenance and
-- confidence; promotion onto the contact is a separate, reconcilable step.
create table if not exists public.comm_extractions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid references public.outreach_contacts(id) on delete cascade,
  conversation_id uuid references public.comm_conversations(id) on delete cascade,
  send_id uuid references public.outreach_sends(id) on delete set null,

  source text not null check (source in ('CALL', 'WHATSAPP', 'AI_TALK', 'CHAT', 'MANUAL')),
  -- DETERMINISTIC beats LLM where both produced an answer (§7).
  method text not null default 'LLM' check (method in ('DETERMINISTIC', 'LLM', 'HUMAN')),
  confidence numeric(4,3) check (confidence between 0 and 1),

  transaction_type text check (transaction_type in ('BUY', 'SELL', 'RENT', 'INVEST', 'UNKNOWN')),
  property_type text,
  locations text[],
  budget_min numeric,
  budget_max numeric,
  currency text,
  bedrooms int,
  timeline text,
  interest_level text check (interest_level in ('HIGH', 'MEDIUM', 'LOW', 'NONE')),
  objection text,
  callback_requested boolean,
  callback_at timestamptz,
  viewing_interest boolean,
  language text,
  summary text,
  next_action text,
  raw jsonb not null default '{}'::jsonb,

  -- Set when these values were copied onto the contact, so the same
  -- extraction is never promoted twice.
  promoted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists comm_extractions_contact_idx on public.comm_extractions(contact_id, created_at desc);
create index if not exists comm_extractions_owner_idx on public.comm_extractions(owner_id, created_at desc);

-- ════════════════════════════════════════════════════════════════════════════
-- 7. TRUST AND RISK
-- ════════════════════════════════════════════════════════════════════════════
--
-- WHY A TABLE. §49 needs a per-account trust tier with limits that an admin
-- can raise and that a customer cannot. public.users has no such column and
-- adding one there would put an anti-abuse control on a table the customer's
-- own profile screen writes to.
create table if not exists public.comm_account_trust (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  tier text not null default 'NEW' check (tier in ('NEW', 'TRUSTED', 'VERIFIED', 'ELEVATED', 'RESTRICTED')),

  -- null = fall back to the global default in admin_settings. A number here is
  -- an admin's deliberate override for this account.
  max_campaign_recipients int,
  max_calls_per_hour int,
  max_messages_per_hour int,
  max_daily_spend_usd numeric(12,2),
  max_concurrent_calls int,

  -- §52. Set by the kill switch. The customer's own API calls cannot clear it;
  -- only an admin review can.
  outbound_frozen boolean not null default false,
  frozen_reason text,
  frozen_at timestamptz,

  complaint_count int not null default 0,
  optout_count int not null default 0,
  notes text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- WHY A TABLE. §50 forbids an opaque score. Every launch decision keeps the
-- signals that produced it, so an admin reviewing a block can see the actual
-- reasons rather than a number, and so a customer told "needs review" can be
-- given a truthful answer.
create table if not exists public.comm_risk_assessments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid references public.outreach_campaigns(id) on delete cascade,
  agent_id uuid references public.comm_agents(id) on delete set null,

  decision text not null check (decision in ('ALLOW', 'REVIEW', 'BLOCK', 'THROTTLE')),
  risk_level text not null check (risk_level in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  -- The real-estate domain gate's own verdict, separate from overall risk: a
  -- perfectly legitimate property campaign from a brand-new account is
  -- ALLOW + MEDIUM, and conflating the two loses that.
  domain_verdict text check (domain_verdict in ('ALLOW', 'REVIEW', 'BLOCK')),
  domain_stage text check (domain_stage in ('RULE', 'KEYWORD', 'CLASSIFIER', 'LLM')),

  -- [{code, weight, detail}] — machine-readable, so the UI renders reasons
  -- rather than prose and tests can assert on them.
  reasons jsonb not null default '[]'::jsonb,
  score int,

  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_decision text check (review_decision in ('APPROVED', 'REJECTED')),
  review_note text,

  created_at timestamptz not null default now()
);

create index if not exists comm_risk_campaign_idx on public.comm_risk_assessments(campaign_id, created_at desc);
create index if not exists comm_risk_pending_idx
  on public.comm_risk_assessments(created_at desc) where reviewed_at is null and decision in ('REVIEW', 'BLOCK');

-- ════════════════════════════════════════════════════════════════════════════
-- 8. AI TALK SESSIONS
-- ════════════════════════════════════════════════════════════════════════════
--
-- WHY A TABLE. §28 requires the public demo's allowance to be enforced on the
-- server. anonymous_sessions already identifies an anonymous visitor, and this
-- table hangs the voice-specific facts off that identity: how many seconds
-- this session has been granted, how many it has used, and whether it is one
-- of too many running at once. A client-side timer is not a billing control.
create table if not exists public.comm_talk_sessions (
  id uuid primary key default gen_random_uuid(),
  anon_session_id uuid references public.anonymous_sessions(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,

  state text not null default 'ACTIVE' check (state in ('ACTIVE', 'ENDED', 'EXPIRED', 'ABORTED')),
  granted_seconds int not null,
  consumed_seconds int not null default 0,
  -- Server clock, not the browser's. The grant expires whether or not the tab
  -- is still open and whether or not it chooses to tell us.
  expires_at timestamptz not null,

  -- Coarse, for rate limiting only. Never joined to a contact, never shown.
  ip_hash text,
  locale text,
  -- What the demo understood, so the hero can show live intelligence (§27).
  -- Anonymous and short-lived: purged by the retention sweep (§29, §132).
  extracted jsonb not null default '{}'::jsonb,
  turns int not null default 0,
  ended_reason text,

  created_at timestamptz not null default now(),
  ended_at timestamptz,
  purge_after timestamptz not null default (now() + interval '7 days')
);

create index if not exists comm_talk_sessions_anon_idx on public.comm_talk_sessions(anon_session_id, created_at desc);
create index if not exists comm_talk_sessions_active_idx on public.comm_talk_sessions(state, expires_at) where state = 'ACTIVE';
create index if not exists comm_talk_sessions_purge_idx on public.comm_talk_sessions(purge_after);

-- ════════════════════════════════════════════════════════════════════════════
-- 9. PROVIDER ROUTING
-- ════════════════════════════════════════════════════════════════════════════
--
-- WHY A TABLE. finance_provider_registry answers "what does this vendor cost
-- and is it switched on". It does not answer "when a Georgian call needs
-- speech-to-text, who gets it first and who gets it if they fail". §21 and
-- §54 need an ordered, per-role, per-country routing decision that an admin
-- edits and that no customer ever sees. Credentials stay in Supabase secrets;
-- this table only names which secret a route expects.
create table if not exists public.comm_provider_routes (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in (
    'ORCHESTRATOR', 'STT', 'TTS', 'LLM', 'TELEPHONY', 'MESSAGING', 'WHATSAPP_CALL'
  )),
  provider text not null,
  -- Lower runs first. Ties broken by created_at, deterministically.
  priority int not null default 100,
  enabled boolean not null default true,
  -- An admin's immediate stop. Separate from `enabled` so turning a provider
  -- off in an incident does not erase the fact that it is normally on.
  kill_switch boolean not null default false,

  -- ISO-3166 alpha-2. Empty = every country.
  country_scope text[] not null default '{}'::text[],
  language_scope text[] not null default '{}'::text[],

  -- Names only. Never a value. Checked for presence, shown as a boolean.
  credential_env_names text[] not null default '{}'::text[],
  config jsonb not null default '{}'::jsonb,

  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  last_latency_ms int,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (role, provider)
);

create index if not exists comm_provider_routes_pick_idx
  on public.comm_provider_routes(role, priority) where enabled and not kill_switch;

-- ════════════════════════════════════════════════════════════════════════════
-- 10. WIDENING WHAT ALREADY EXISTS
-- ════════════════════════════════════════════════════════════════════════════
--
-- Only widening. Every value legal before this migration is legal after it.

-- WhatsApp becomes a campaign type and a send channel.
alter table public.outreach_campaigns drop constraint if exists outreach_campaigns_campaign_type_check;
alter table public.outreach_campaigns add constraint outreach_campaigns_campaign_type_check
  check (campaign_type in ('EMAIL', 'SMS', 'AI_CALL', 'COMMUNITY', 'DIRECT_MATCH', 'MULTI_CHANNEL', 'WHATSAPP'));

-- REVIEW_REQUIRED, APPROVED and COMPLIANCE_PAUSED are the states §16 needs and
-- the old enum could not express. COMPLIANCE_PAUSED is deliberately distinct
-- from PAUSED: a customer may resume the one they caused and may not resume
-- the one the kill switch caused (§52).
alter table public.outreach_campaigns drop constraint if exists outreach_campaigns_status_check;
alter table public.outreach_campaigns add constraint outreach_campaigns_status_check
  check (status in ('DRAFT', 'READY', 'REVIEW_REQUIRED', 'APPROVED', 'SCHEDULED', 'RUNNING',
                    'PAUSED', 'COMPLIANCE_PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED'));

alter table public.outreach_sends drop constraint if exists outreach_sends_channel_check;
alter table public.outreach_sends add constraint outreach_sends_channel_check
  check (channel in ('EMAIL', 'SMS', 'AI_CALL', 'WHATSAPP'));

-- RINGING and CANCELLED complete the call lifecycle (§89); READ is WhatsApp's.
alter table public.outreach_sends drop constraint if exists outreach_sends_status_check;
alter table public.outreach_sends add constraint outreach_sends_status_check
  check (status in ('PENDING', 'QUEUED', 'SENDING', 'DIALING', 'RINGING', 'ANSWERED', 'SENT',
                    'DELIVERED', 'READ', 'COMPLETED', 'FAILED', 'NO_ANSWER', 'BUSY',
                    'CANCELLED', 'BOUNCED', 'OPTED_OUT', 'SUPPRESSED'));

alter table public.outreach_campaigns
  add column if not exists agent_id uuid references public.comm_agents(id) on delete set null,
  add column if not exists agent_version_id uuid references public.comm_agent_versions(id) on delete set null,
  add column if not exists channel_account_id uuid references public.comm_channel_accounts(id) on delete set null,
  add column if not exists template_id uuid references public.comm_whatsapp_templates(id) on delete set null,
  add column if not exists template_variables jsonb,
  add column if not exists timezone text,
  add column if not exists send_window_start smallint check (send_window_start between 0 and 23),
  add column if not exists send_window_end smallint check (send_window_end between 0 and 23),
  add column if not exists send_days smallint[],
  add column if not exists max_attempts smallint not null default 1,
  add column if not exists retry_gap_minutes int not null default 240,
  add column if not exists concurrency smallint not null default 1,
  -- The customer's own ceiling (§111). The admin global cap always wins.
  add column if not exists max_spend_usd numeric(12,2),
  add column if not exists risk_level text,
  add column if not exists compliance_state text,
  add column if not exists paused_reason text,
  add column if not exists launched_at timestamptz;

alter table public.outreach_sends
  add column if not exists conversation_id uuid references public.comm_conversations(id) on delete set null,
  add column if not exists agent_version_id uuid references public.comm_agent_versions(id) on delete set null,
  add column if not exists provider_status_raw text,
  add column if not exists outcome text,
  add column if not exists lead_score smallint check (lead_score between 0 and 100),
  add column if not exists language text,
  -- A recording is private (§73). This is a storage object path, resolved to a
  -- signed URL at read time; recording_url stays for the rows that already
  -- have one.
  add column if not exists recording_path text,
  add column if not exists recording_expires_at timestamptz,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists idempotency_key text;

-- The dispatcher's claim. Two workers cannot both take the same contact (§69).
create unique index if not exists outreach_sends_idempotency_idx
  on public.outreach_sends(idempotency_key) where idempotency_key is not null;
create index if not exists outreach_sends_due_idx
  on public.outreach_sends(campaign_id, next_attempt_at)
  where status in ('PENDING', 'QUEUED');

-- CRM intelligence on the contact. Every column nullable: an imported row that
-- only ever had a phone number stays valid.
alter table public.outreach_contacts
  add column if not exists lead_stage text,
  add column if not exists lead_score smallint check (lead_score between 0 and 100),
  add column if not exists transaction_type text,
  add column if not exists property_type text,
  add column if not exists preferred_locations text[],
  add column if not exists bedrooms int,
  add column if not exists timeline text,
  -- WhatsApp opt-out is its own fact. A contact who stopped WhatsApp has not
  -- necessarily withdrawn consent to be called, and conflating them either
  -- over-blocks or under-blocks.
  add column if not exists whatsapp_opted_out boolean not null default false,
  add column if not exists whatsapp_opted_out_at timestamptz,
  add column if not exists last_contacted_at timestamptz,
  add column if not exists assigned_to uuid references auth.users(id) on delete set null;

create index if not exists outreach_contacts_stage_idx on public.outreach_contacts(owner_id, lead_stage);

-- Consent attestation for an import (§14 step 6). The list already has a
-- terms_consent_id column with nothing to point at.
alter table public.outreach_contact_lists
  add column if not exists consent_attested_at timestamptz,
  add column if not exists consent_attested_by uuid references auth.users(id) on delete set null,
  add column if not exists consent_terms_version text,
  add column if not exists default_country text;

-- background_jobs learns the two new products so communications work is
-- visible in the job centre alongside everything else.
alter table public.background_jobs drop constraint if exists background_jobs_product_type_check;
alter table public.background_jobs add constraint background_jobs_product_type_check
  check (product_type in (
    'VERIFY', 'DOCUMENT_ANALYSIS', 'FIND_CLIENTS', 'MARKET_RESEARCH',
    'LOCATION_RESEARCH', 'CONTRACT_ANALYSIS', 'AI_ENRICHMENT', 'EMAIL_CAMPAIGN',
    'AI_CALL', 'WHATSAPP_CAMPAIGN', 'AI_TALK'
  ));

alter table public.background_jobs drop constraint if exists background_jobs_subject_type_check;
alter table public.background_jobs add constraint background_jobs_subject_type_check
  check (subject_type in (
    'RESEARCH_JOB', 'DOCUMENT', 'MATCHING_JOB', 'DEAL_ROOM', 'PROPERTY', 'CAMPAIGN'
  ));

-- ════════════════════════════════════════════════════════════════════════════
-- 11. ROW LEVEL SECURITY
-- ════════════════════════════════════════════════════════════════════════════
--
-- The rule, applied identically to every table above: a customer reads and
-- writes their own rows and nobody else's; the service role (workers, webhooks,
-- edge functions) bypasses RLS entirely by virtue of being the service role;
-- admins read through is_admin(), the function the rest of the platform already
-- trusts. A frontend filter is not authorisation (§71).

alter table public.comm_agents            enable row level security;
alter table public.comm_agent_versions    enable row level security;
alter table public.comm_channel_accounts  enable row level security;
alter table public.comm_whatsapp_templates enable row level security;
alter table public.comm_conversations     enable row level security;
alter table public.comm_messages          enable row level security;
alter table public.comm_webhook_events    enable row level security;
alter table public.comm_extractions       enable row level security;
alter table public.comm_account_trust     enable row level security;
alter table public.comm_risk_assessments  enable row level security;
alter table public.comm_talk_sessions     enable row level security;
alter table public.comm_provider_routes   enable row level security;

do $$
declare
  t text;
  owner_tables text[] := array[
    'comm_agents', 'comm_agent_versions', 'comm_whatsapp_templates',
    'comm_conversations', 'comm_messages', 'comm_extractions'
  ];
begin
  foreach t in array owner_tables loop
    execute format('drop policy if exists %I on public.%I', t || '_owner_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())',
      t || '_owner_all', t
    );
    execute format('drop policy if exists %I on public.%I', t || '_admin_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_admin())',
      t || '_admin_read', t
    );
  end loop;
end $$;

-- Channel accounts: a customer sees their own, plus the platform-owned shared
-- identities (owner_id is null) they are allowed to send through. They may
-- only WRITE their own.
drop policy if exists comm_channel_accounts_read on public.comm_channel_accounts;
create policy comm_channel_accounts_read on public.comm_channel_accounts
  for select to authenticated using (owner_id = auth.uid() or owner_id is null or public.is_admin());

drop policy if exists comm_channel_accounts_write on public.comm_channel_accounts;
create policy comm_channel_accounts_write on public.comm_channel_accounts
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Trust and risk are read-only to the customer. §54 and §131: they may see
-- that they are "Paused for safety"; they may not edit the fact, and they may
-- not see the thresholds that produced it.
drop policy if exists comm_account_trust_read on public.comm_account_trust;
create policy comm_account_trust_read on public.comm_account_trust
  for select to authenticated using (owner_id = auth.uid() or public.is_admin());

drop policy if exists comm_risk_read on public.comm_risk_assessments;
create policy comm_risk_read on public.comm_risk_assessments
  for select to authenticated using (owner_id = auth.uid() or public.is_admin());

-- Routing is an admin concern and a customer has no reason to see the fallback
-- order (§106). Webhook events and talk sessions are service-role only; there
-- is deliberately no authenticated policy, so RLS denies by default and only
-- an admin can read them.
drop policy if exists comm_provider_routes_admin on public.comm_provider_routes;
create policy comm_provider_routes_admin on public.comm_provider_routes
  for select to authenticated using (public.is_admin());

drop policy if exists comm_webhook_events_admin on public.comm_webhook_events;
create policy comm_webhook_events_admin on public.comm_webhook_events
  for select to authenticated using (public.is_admin());

drop policy if exists comm_talk_sessions_admin on public.comm_talk_sessions;
create policy comm_talk_sessions_admin on public.comm_talk_sessions
  for select to authenticated using (public.is_admin());

-- ════════════════════════════════════════════════════════════════════════════
-- 12. TOUCH TRIGGERS
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.comm_touch_updated_at()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'comm_agents', 'comm_channel_accounts', 'comm_whatsapp_templates',
    'comm_conversations', 'comm_account_trust', 'comm_provider_routes'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.comm_touch_updated_at()',
      t || '_touch', t
    );
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 13. PRODUCTS
-- ════════════════════════════════════════════════════════════════════════════
--
-- AI_CALL and EMAIL_CAMPAIGN are already registered (disabled, no pricing).
-- WHATSAPP and AI_TALK join them on the same terms. They stay DISABLED and
-- pricing stays INACTIVE: this migration registers the products so the wallet
-- can address them, and does not invent a retail price. Pricing is a
-- commercial decision recorded in pricing_versions, not a number a migration
-- makes up.

insert into public.billable_products (
  code, name, enabled, kill_switch, billing_mode, estimate_strategy,
  requires_reservation, pricing_active, pricing_version, sort_order,
  standard_retail_cents, reference_landed_cogs_cents, min_gross_margin_bps,
  min_viable_budget_credits, config
) values
  ('WHATSAPP', 'WhatsApp Messaging', false, false, 'VARIABLE', 'PER_UNIT',
   true, false, 1, 92, 0, 0, 3000, 0,
   jsonb_build_object('scope_note',
     'Registered so the wallet can address WhatsApp usage. Meta charges per conversation, not per message, and the conversation category decides the rate — so a retail price here would be a guess. Set pricing_active once finance_provider_prices carries Meta''s actual per-category rates.')),
  ('AI_TALK', 'AI Talk', false, false, 'VARIABLE', 'PER_UNIT',
   true, false, 1, 93, 0, 0, 3000, 0,
   jsonb_build_object('scope_note',
     'The public homepage demo is free and anonymous and never reaches the wallet — its ceiling is comm_talk_sessions.granted_seconds. This product exists for authenticated paid Talk usage, which is not switched on.'))
on conflict (code) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- 14. DEFAULT ROUTES
-- ════════════════════════════════════════════════════════════════════════════
--
-- Seeded from what the platform actually has credentials for today. Cartesia
-- and Vapi both have a live key in Supabase secrets and both have answered a
-- real request. Meta has a live token against a TEST number. Nothing here
-- claims a capability that has not been observed: the WHATSAPP_CALL role is
-- seeded disabled precisely because it has not.

-- THE TWO ROLES THAT SPEND MONEY ARRIVE KILL-SWITCHED.
--
-- TELEPHONY places PSTN calls and MESSAGING sends WhatsApp. Every other role
-- below is an input to work that has already been authorised. Seeding those
-- two open would mean that the instant this migration lands on a production
-- database, outbound is live — before anyone has approved a price, verified a
-- provider, or placed a single real call.
--
-- So they arrive off. Lifting them is a deliberate admin action taken after
-- the activation gate passes (docs/GO_LIVE_CHECKLIST.md), audited like any
-- other, and reversible from Admin → Providers in one click.
--
-- This is the second of two independent controls, not the only one. The
-- execution gate refuses any send whose customer price cannot be resolved, and
-- production has no active price for either product today. Either one alone
-- stops a call; having both is the point.
--
-- `enabled` stays true while `kill_switch` is true, deliberately: the route is
-- configured and visible, and an incident must never erase the fact that it is
-- normally on.

insert into public.comm_provider_routes (role, provider, priority, enabled, kill_switch, country_scope, credential_env_names, config) values
  ('STT',           'CARTESIA', 10,  true,  false, '{}',      array['CARTESIA_API_KEY'],
      jsonb_build_object('model', 'ink-whisper', 'note', 'Georgian is the release gate; model id is admin-editable and not hardcoded in application logic.')),
  ('TTS',           'CARTESIA', 10,  true,  false, '{}',      array['CARTESIA_API_KEY'],
      jsonb_build_object('model', 'sonic-2')),
  ('ORCHESTRATOR',  'CARTESIA', 10,  true,  false, '{}',      array['CARTESIA_API_KEY'],
      jsonb_build_object('note', 'Browser realtime. The homepage demo needs no telephony leg and must not pay for one.')),
  ('ORCHESTRATOR',  'VAPI',     20,  true,  false, '{}',      array['VAPI_PRIVATE_API_KEY'],
      jsonb_build_object('note', 'Telephony orchestration for outbound PSTN calls.')),
  ('TELEPHONY',     'VAPI',     10,  true,  true,  '{}',      array['VAPI_PRIVATE_API_KEY'],
      jsonb_build_object('note', 'Arrives kill-switched. Lifted by an admin once the activation gate passes.')),
  ('MESSAGING',     'META',     10,  true,  true,  '{}',      array['META_WHATSAPP_ACCESS_TOKEN', 'META_WHATSAPP_PHONE_NUMBER_ID', 'META_WHATSAPP_BUSINESS_ACCOUNT_ID'],
      jsonb_build_object('api_version', 'v21.0', 'note', 'Arrives kill-switched, as TELEPHONY does.')),
  ('WHATSAPP_CALL', 'META',     10,  false, true,  '{}',      array['META_WHATSAPP_ACCESS_TOKEN'],
      jsonb_build_object('note', 'Disabled because this business account has not been observed to support WhatsApp Calling. Enabling it is an admin action taken after Meta confirms, not a default.'))
on conflict (role, provider) do nothing;

-- The Meta test number, recorded as what it is. §100: a test number is not a
-- production sender, and the row says so in a column rather than in a comment
-- nobody reads.
insert into public.comm_channel_accounts (owner_id, label, channel, provider, environment, status, capabilities, metadata)
select null, 'Meta WhatsApp test number', 'WHATSAPP', 'META', 'TEST', 'PENDING',
       array['INBOUND', 'OUTBOUND', 'TEMPLATE'],
       jsonb_build_object('note', 'Identifiers are filled in by the whatsapp-sync function from META_WHATSAPP_PHONE_NUMBER_ID; they are not written into a migration.')
where not exists (
  select 1 from public.comm_channel_accounts where provider = 'META' and owner_id is null
);
