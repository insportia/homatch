-- ============================================================================
-- HOMATCH FOR DEVELOPERS — the sales engine.
--
-- Everything between "somebody is interested" and "the unit is sold and paid
-- for", plus the documents and share links that carry it.
--
-- THE PERSON IS NOT A NEW OBJECT
--
-- dev_leads does not store a name, a phone number or an email address. It
-- points at public.outreach_contacts, which is where Homatch already keeps
-- people: normalised phone numbers, consent_status, unsubscribed,
-- do_not_call, whatsapp_opted_out, suppression and bounce counts. A CRM that
-- invented its own contact row would be a CRM that eventually rings somebody
-- who asked never to be rung, because the opt-out would have been recorded on
-- the other copy. So the lead is the SALES FACTS about a known contact —
-- which project, which stage, whose lead it is, what they want — and nothing
-- about how to reach them.
--
-- WHY STATUS TRANSITIONS ARE FUNCTIONS AND NOT UPDATES
--
-- Reserving a unit writes a reservation, moves the unit out of AVAILABLE,
-- records the unit's history and writes an audit row. Four writes that are
-- one fact. If a client did them as four requests, a dropped connection
-- between the second and the third leaves an apartment that is off the market
-- with nothing recording why. Each of those is one SECURITY DEFINER function,
-- one transaction, permission checked inside.
--
-- WHY THE PUBLIC PAGES ARE FUNCTIONS AND NOT POLICIES
--
-- "This unit is published" and "anon may read the dev_units table" are not
-- the same permission, and writing the first as the second is how an unlisted
-- price ends up in a scraper. Nothing here grants anon a row-level policy on
-- any dev_* table. The public unit page, the project page and the share link
-- are SECURITY DEFINER functions that SELECT the specific publishable columns
-- of a specific published row and return them as json.
-- ============================================================================

-- ── 1. PAYMENT PLANS ───────────────────────────────────────────────────────
--
-- A template ("30% down, 70% on handover") and, once a deal exists, the
-- actual dated schedule derived from it. Milestones are jsonb because the
-- shape genuinely varies by country and by project, and the derived schedule
-- in dev_payment_schedule is relational because that is what gets reconciled
-- against real money.

create table if not exists public.dev_payment_plans (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.dev_workspaces(id) on delete cascade,
  project_id   uuid references public.dev_projects(id) on delete cascade,
  name         text not null,
  description  text,
  -- [{ label, percent | amount, due_offset_days | due_date, milestone }]
  milestones   jsonb not null default '[]'::jsonb,
  is_default   boolean not null default false,
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists dev_payment_plans_ws_idx on public.dev_payment_plans(workspace_id);

-- The column was created in the foundation migration without its reference,
-- because the table it points at did not exist yet.
alter table public.dev_units
  drop constraint if exists dev_units_payment_plan_id_fkey;
alter table public.dev_units
  add constraint dev_units_payment_plan_id_fkey
  foreign key (payment_plan_id) references public.dev_payment_plans(id) on delete set null;

-- ── 2. LEADS ───────────────────────────────────────────────────────────────

create table if not exists public.dev_leads (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.dev_workspaces(id) on delete cascade,
  -- The person. See the header: this is the only place a name or a phone
  -- number lives, and consent lives with it.
  contact_id      uuid not null references public.outreach_contacts(id) on delete cascade,
  project_id      uuid references public.dev_projects(id) on delete set null,
  stage           text not null default 'NEW' check (stage in (
                    'NEW','QUALIFIED','CONTACTED','INTERESTED','VIEWING_SCHEDULED',
                    'VIEWING_COMPLETED','NEGOTIATION','RESERVATION','CONTRACT',
                    'PAYMENT_PENDING','SOLD','LOST')),
  -- Disposition is the outcome of the last CONVERSATION. It is not the stage,
  -- and conflating them is why sales teams end up with a pipeline column
  -- called "no answer".
  disposition     text,
  assigned_to     uuid references public.users(id) on delete set null,
  source          text,
  campaign_id     uuid references public.outreach_campaigns(id) on delete set null,
  budget_min      numeric(14,2),
  budget_max      numeric(14,2),
  currency        text,
  preferences     jsonb not null default '{}'::jsonb,
  score           smallint,
  -- Why the score is what it is. A number with no explanation is a label
  -- applied to a person, which §95 forbids.
  score_factors   jsonb not null default '[]'::jsonb,
  lost_reason     text check (lost_reason is null or lost_reason in (
                    'PRICE','LOCATION','FINANCING','TIMING','COMPETITOR',
                    'UNIT_UNAVAILABLE','NO_RESPONSE','OTHER')),
  lost_note       text,
  next_follow_up_at timestamptz,
  last_activity_at  timestamptz,
  notes           text,
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (workspace_id, contact_id, project_id)
);

create index if not exists dev_leads_ws_stage_idx on public.dev_leads(workspace_id, stage);
create index if not exists dev_leads_assigned_idx on public.dev_leads(assigned_to) where stage <> 'LOST';
create index if not exists dev_leads_followup_idx on public.dev_leads(workspace_id, next_follow_up_at)
  where next_follow_up_at is not null;
create index if not exists dev_leads_contact_idx on public.dev_leads(contact_id);

-- A buyer may want three apartments and an apartment may have six interested
-- buyers. Forcing one lead to one unit is what makes salespeople keep the
-- real answer in a notebook.
create table if not exists public.dev_lead_units (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.dev_workspaces(id) on delete cascade,
  lead_id      uuid not null references public.dev_leads(id) on delete cascade,
  unit_id      uuid not null references public.dev_units(id) on delete cascade,
  interest     text not null default 'INTERESTED'
                 check (interest in ('SUGGESTED','INTERESTED','SHORTLISTED','REJECTED')),
  note         text,
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (lead_id, unit_id)
);

create index if not exists dev_lead_units_unit_idx on public.dev_lead_units(unit_id);
create index if not exists dev_lead_units_ws_idx on public.dev_lead_units(workspace_id);

-- ── 3. THE TIMELINE ────────────────────────────────────────────────────────
--
-- One chronological record per customer, written by every part of the product
-- that touches them — a call placed through the existing AI Calls stack, an
-- email sent through the existing email stack, a note typed by a manager, a
-- document uploaded, a payment confirmed. `provenance` is kept because "who
-- says so" is a different question from "what happened", and a CRM that
-- cannot tell a Meta lead from a typed one cannot report on either.

create table if not exists public.dev_activities (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.dev_workspaces(id) on delete cascade,
  lead_id      uuid references public.dev_leads(id) on delete cascade,
  contact_id   uuid references public.outreach_contacts(id) on delete set null,
  unit_id      uuid references public.dev_units(id) on delete set null,
  deal_id      uuid,
  kind         text not null check (kind in (
                 'NOTE','CALL','WHATSAPP','EMAIL','SMS','MEETING','VIEWING',
                 'OFFER','RESERVATION','DOCUMENT','PAYMENT','STAGE_CHANGE',
                 'ASSIGNMENT','SHARE','TASK','SYSTEM')),
  provenance   text not null default 'MANUAL' check (provenance in (
                 'MANUAL','HOMATCH','AI_CALL','WHATSAPP','EMAIL','META','GOOGLE',
                 'IMPORT','WEBSITE','BROKER','DOCUMENT','PAYMENT','SHARE_LINK')),
  direction    text check (direction is null or direction in ('IN','OUT')),
  title        text not null,
  body         text,
  meta         jsonb not null default '{}'::jsonb,
  actor_id     uuid references public.users(id) on delete set null,
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create index if not exists dev_activities_lead_idx on public.dev_activities(lead_id, occurred_at desc);
create index if not exists dev_activities_ws_idx on public.dev_activities(workspace_id, occurred_at desc);
create index if not exists dev_activities_unit_idx on public.dev_activities(unit_id, occurred_at desc);

create table if not exists public.dev_tasks (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.dev_workspaces(id) on delete cascade,
  lead_id      uuid references public.dev_leads(id) on delete cascade,
  unit_id      uuid references public.dev_units(id) on delete set null,
  deal_id      uuid,
  title        text not null,
  body         text,
  assigned_to  uuid references public.users(id) on delete set null,
  due_at       timestamptz,
  priority     text not null default 'NORMAL' check (priority in ('LOW','NORMAL','HIGH')),
  status       text not null default 'OPEN' check (status in ('OPEN','DONE','CANCELLED')),
  completed_at timestamptz,
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists dev_tasks_assigned_idx on public.dev_tasks(assigned_to, due_at) where status = 'OPEN';
create index if not exists dev_tasks_ws_idx on public.dev_tasks(workspace_id, status);

-- ── 4. VIEWINGS ────────────────────────────────────────────────────────────
--
-- Deliberately not public.viewing_requests. That table is the consumer
-- marketplace flow: a requester asks a property owner for a viewing, and both
-- sides are Homatch accounts. A developer's viewing is an internal calendar
-- entry for a buyer who may not have an account at all, scheduled by a named
-- sales manager against workspace inventory. Same word, different object.

create table if not exists public.dev_viewings (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.dev_workspaces(id) on delete cascade,
  lead_id      uuid not null references public.dev_leads(id) on delete cascade,
  project_id   uuid references public.dev_projects(id) on delete set null,
  unit_id      uuid references public.dev_units(id) on delete set null,
  assigned_to  uuid references public.users(id) on delete set null,
  scheduled_at timestamptz not null,
  duration_min integer not null default 30,
  mode         text not null default 'PHYSICAL' check (mode in ('PHYSICAL','VIRTUAL')),
  status       text not null default 'SCHEDULED'
                 check (status in ('SCHEDULED','CONFIRMED','COMPLETED','CANCELLED','NO_SHOW')),
  disposition  text,
  notes        text,
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists dev_viewings_ws_time_idx on public.dev_viewings(workspace_id, scheduled_at);
create index if not exists dev_viewings_lead_idx on public.dev_viewings(lead_id);
create index if not exists dev_viewings_assigned_idx on public.dev_viewings(assigned_to, scheduled_at)
  where status in ('SCHEDULED','CONFIRMED');

-- ── 5. OFFERS ──────────────────────────────────────────────────────────────

create table if not exists public.dev_offers (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.dev_workspaces(id) on delete cascade,
  lead_id         uuid not null references public.dev_leads(id) on delete cascade,
  unit_id         uuid not null references public.dev_units(id) on delete cascade,
  base_price      numeric(14,2) not null,
  discount_pct    numeric(5,2) not null default 0,
  discount_amount numeric(14,2) not null default 0,
  final_price     numeric(14,2) not null,
  currency        text not null default 'USD',
  deposit_amount  numeric(14,2),
  payment_plan_id uuid references public.dev_payment_plans(id) on delete set null,
  -- The dated instalments this offer actually proposes, resolved from the
  -- plan at the moment it was made. Kept on the offer because a plan template
  -- that is edited next month must not retroactively change what somebody was
  -- offered.
  schedule        jsonb not null default '[]'::jsonb,
  valid_until     date,
  status          text not null default 'DRAFT'
                    check (status in ('DRAFT','SENT','VIEWED','ACCEPTED','DECLINED','EXPIRED','SUPERSEDED')),
  sent_at         timestamptz,
  viewed_at       timestamptz,
  accepted_at     timestamptz,
  notes           text,
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists dev_offers_lead_idx on public.dev_offers(lead_id, created_at desc);
create index if not exists dev_offers_unit_idx on public.dev_offers(unit_id);
create index if not exists dev_offers_ws_idx on public.dev_offers(workspace_id, status);

-- ── 6. RESERVATIONS ────────────────────────────────────────────────────────

create table if not exists public.dev_reservations (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.dev_workspaces(id) on delete cascade,
  unit_id      uuid not null references public.dev_units(id) on delete cascade,
  lead_id      uuid not null references public.dev_leads(id) on delete cascade,
  offer_id     uuid references public.dev_offers(id) on delete set null,
  amount       numeric(14,2),
  currency     text not null default 'USD',
  reserved_at  timestamptz not null default now(),
  expires_at   timestamptz,
  status       text not null default 'ACTIVE'
                 check (status in ('ACTIVE','EXPIRED','CANCELLED','CONVERTED')),
  assigned_to  uuid references public.users(id) on delete set null,
  broker_id    uuid references public.users(id) on delete set null,
  source       text,
  notes        text,
  cancelled_reason text,
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- One live reservation per unit, enforced by the database rather than by
-- whichever screen got there first. This is the constraint that makes two
-- salespeople reserving the same apartment at the same second impossible
-- instead of merely unlikely.
create unique index if not exists dev_reservations_one_active_per_unit
  on public.dev_reservations(unit_id) where status = 'ACTIVE';
create index if not exists dev_reservations_ws_idx on public.dev_reservations(workspace_id, status);
create index if not exists dev_reservations_expiry_idx on public.dev_reservations(expires_at)
  where status = 'ACTIVE';
create index if not exists dev_reservations_lead_idx on public.dev_reservations(lead_id);

-- ── 7. DEALS, SCHEDULE, PAYMENTS ───────────────────────────────────────────

create table if not exists public.dev_deals (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.dev_workspaces(id) on delete cascade,
  unit_id         uuid not null references public.dev_units(id) on delete cascade,
  lead_id         uuid not null references public.dev_leads(id) on delete cascade,
  project_id      uuid references public.dev_projects(id) on delete set null,
  reservation_id  uuid references public.dev_reservations(id) on delete set null,
  offer_id        uuid references public.dev_offers(id) on delete set null,
  assigned_to     uuid references public.users(id) on delete set null,
  broker_id       uuid references public.users(id) on delete set null,
  source          text,
  contract_number text,
  contract_date   date,
  sale_date       date,
  list_price      numeric(14,2),
  discount_amount numeric(14,2) not null default 0,
  sale_price      numeric(14,2) not null,
  currency        text not null default 'USD',
  payment_plan_id uuid references public.dev_payment_plans(id) on delete set null,
  status          text not null default 'CONTRACT_PENDING'
                    check (status in ('CONTRACT_PENDING','CONTRACTED','COMPLETED','CANCELLED')),
  notes           text,
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- A unit can only be sold once. A cancelled deal releases the slot.
create unique index if not exists dev_deals_one_live_per_unit
  on public.dev_deals(unit_id) where status <> 'CANCELLED';
create index if not exists dev_deals_ws_idx on public.dev_deals(workspace_id, status);
create index if not exists dev_deals_project_idx on public.dev_deals(project_id, sale_date);
create index if not exists dev_deals_lead_idx on public.dev_deals(lead_id);

create table if not exists public.dev_payment_schedule (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.dev_workspaces(id) on delete cascade,
  deal_id      uuid not null references public.dev_deals(id) on delete cascade,
  seq          integer not null,
  label        text not null,
  due_date     date,
  amount       numeric(14,2) not null,
  currency     text not null default 'USD',
  -- Derived from confirmed payments by dev_refresh_schedule_status(), never
  -- typed. A schedule row that says PAID because somebody clicked PAID is the
  -- thing this product exists to replace.
  status       text not null default 'PENDING'
                 check (status in ('PENDING','PARTIAL','PAID','OVERDUE')),
  paid_amount  numeric(14,2) not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (deal_id, seq)
);

create index if not exists dev_payment_schedule_due_idx
  on public.dev_payment_schedule(workspace_id, due_date) where status <> 'PAID';

create table if not exists public.dev_payments (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.dev_workspaces(id) on delete cascade,
  deal_id      uuid not null references public.dev_deals(id) on delete cascade,
  schedule_id  uuid references public.dev_payment_schedule(id) on delete set null,
  amount       numeric(14,2) not null check (amount > 0),
  currency     text not null default 'USD',
  paid_at      date not null,
  method       text,
  reference    text,
  document_id  uuid,
  -- RECORDED is somebody's claim. CONFIRMED is a person with the finance
  -- capability saying they have seen the money. Only CONFIRMED counts towards
  -- collected totals anywhere in this product.
  status       text not null default 'RECORDED'
                 check (status in ('RECORDED','CONFIRMED','REJECTED')),
  confirmed_by uuid references public.users(id) on delete set null,
  confirmed_at timestamptz,
  rejected_reason text,
  notes        text,
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists dev_payments_deal_idx on public.dev_payments(deal_id, paid_at);
create index if not exists dev_payments_ws_idx on public.dev_payments(workspace_id, status);

-- ── 8. DOCUMENTS ───────────────────────────────────────────────────────────
--
-- Extraction is stored beside the document and is never applied to a deal or
-- a payment by itself. `extraction` is what a reader THOUGHT the paper said;
-- a row in dev_payments is what a person CONFIRMED it said. The gap between
-- those two is deliberate and is the whole of §38.

create table if not exists public.dev_documents (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.dev_workspaces(id) on delete cascade,
  doc_type       text not null default 'OTHER' check (doc_type in (
                   'CONTRACT','RESERVATION_AGREEMENT','INVOICE','PAYMENT_RECEIPT',
                   'BANK_CONFIRMATION','PAYMENT_SCHEDULE','IDENTITY_DOCUMENT',
                   'BROCHURE','FLOOR_PLAN','PROJECT_DOCUMENT','LEGAL_DOCUMENT','OTHER')),
  title          text not null,
  storage_path   text not null,
  mime           text,
  size_bytes     bigint,
  project_id     uuid references public.dev_projects(id) on delete set null,
  unit_id        uuid references public.dev_units(id) on delete set null,
  deal_id        uuid references public.dev_deals(id) on delete set null,
  lead_id        uuid references public.dev_leads(id) on delete set null,
  reservation_id uuid references public.dev_reservations(id) on delete set null,
  -- PRIVATE: the workspace only. BUYER: also visible in that buyer's room.
  -- PUBLIC: a marketing asset. A contract must never be PUBLIC and the UI
  -- does not offer it.
  visibility     text not null default 'PRIVATE'
                   check (visibility in ('PRIVATE','BUYER','PUBLIC')),
  status         text not null default 'UPLOADED' check (status in (
                   'UPLOADED','ANALYZING','EXTRACTED','CONFIRMED','REJECTED','FAILED')),
  extraction     jsonb,
  extraction_confidence numeric(4,3),
  extraction_error text,
  confirmed_by   uuid references public.users(id) on delete set null,
  confirmed_at   timestamptz,
  uploaded_by    uuid references public.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists dev_documents_ws_idx on public.dev_documents(workspace_id, created_at desc);
create index if not exists dev_documents_deal_idx on public.dev_documents(deal_id);
create index if not exists dev_documents_review_idx on public.dev_documents(workspace_id)
  where status in ('EXTRACTED','ANALYZING');

alter table public.dev_payments drop constraint if exists dev_payments_document_id_fkey;
alter table public.dev_payments add constraint dev_payments_document_id_fkey
  foreign key (document_id) references public.dev_documents(id) on delete set null;

-- ── 9. WALKTHROUGHS ────────────────────────────────────────────────────────
--
-- Homatch does not render 3D. It stores a REFERENCE to a walkthrough that
-- exists somewhere — a tour the developer already owns, a set of 360 scenes
-- they uploaded, or an approved provider — and serves it inside a branded
-- viewer with the unit's facts beside it. `provider` exists so that the
-- product is not married to whichever company is cheapest this year, and
-- `status` exists so that a tour has to be looked at before a buyer sees it.

create table if not exists public.dev_walkthroughs (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.dev_workspaces(id) on delete cascade,
  unit_id      uuid references public.dev_units(id) on delete cascade,
  project_id   uuid references public.dev_projects(id) on delete cascade,
  title        text,
  provider     text not null default 'EMBED' check (provider in ('EMBED','PANORAMA','VIDEO','NATIVE')),
  -- For EMBED/VIDEO: the URL. Validated against an allowlist server-side
  -- before it is ever put in an iframe.
  embed_url    text,
  -- For PANORAMA: [{ id, name, image_url, hotspots: [{to, x, y}] }]
  scenes       jsonb not null default '[]'::jsonb,
  cover_image_url text,
  visibility   text not null default 'PRIVATE'
                 check (visibility in ('PUBLIC','UNLISTED','PRIVATE','BUYER_ONLY')),
  status       text not null default 'DRAFT' check (status in ('DRAFT','READY','PUBLISHED')),
  provider_ref text,
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint dev_walkthroughs_target check (unit_id is not null or project_id is not null)
);

create index if not exists dev_walkthroughs_unit_idx on public.dev_walkthroughs(unit_id);
create index if not exists dev_walkthroughs_ws_idx on public.dev_walkthroughs(workspace_id);

-- ── 10. SHARE LINKS ────────────────────────────────────────────────────────

create table if not exists public.dev_share_links (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.dev_workspaces(id) on delete cascade,
  token        text not null unique,
  target_type  text not null check (target_type in ('UNIT','PROJECT','OFFER','BUYER_ROOM')),
  target_id    uuid not null,
  visibility   text not null default 'UNLISTED' check (visibility in ('PUBLIC','UNLISTED')),
  label        text,
  -- Who it was sent to, when it was sent to somebody in particular. This is
  -- what lets "Anna opened the tour twice" be a fact rather than a guess, and
  -- it is only ever set by the person creating the link.
  lead_id      uuid references public.dev_leads(id) on delete set null,
  contact_id   uuid references public.outreach_contacts(id) on delete set null,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  view_count   integer not null default 0,
  last_viewed_at timestamptz,
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists dev_share_links_target_idx on public.dev_share_links(target_type, target_id);
create index if not exists dev_share_links_ws_idx on public.dev_share_links(workspace_id, created_at desc);
create index if not exists dev_share_links_lead_idx on public.dev_share_links(lead_id);

-- First-party activity on a link the workspace itself created and sent. No
-- cross-site identifier, no fingerprint: visitor_hash is a per-link, per-day
-- hash used only to tell one visit from ten, and it cannot be joined to
-- anything outside this table.
create table if not exists public.dev_share_events (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.dev_workspaces(id) on delete cascade,
  share_link_id uuid not null references public.dev_share_links(id) on delete cascade,
  event         text not null check (event in (
                  'OPENED','UNIT_VIEWED','WALKTHROUGH_OPENED','FLOORPLAN_VIEWED',
                  'PAYMENT_PLAN_VIEWED','BROCHURE_OPENED','PHOTOS_VIEWED',
                  'CTA_CLICKED','VIEWING_REQUESTED','CONTACT_CLICKED')),
  meta          jsonb not null default '{}'::jsonb,
  visitor_hash  text,
  created_at    timestamptz not null default now()
);

create index if not exists dev_share_events_link_idx on public.dev_share_events(share_link_id, created_at desc);
create index if not exists dev_share_events_ws_idx on public.dev_share_events(workspace_id, created_at desc);

-- ── 11. BROKER DISTRIBUTION ────────────────────────────────────────────────

create table if not exists public.dev_broker_invites (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.dev_workspaces(id) on delete cascade,
  project_id      uuid not null references public.dev_projects(id) on delete cascade,
  broker_user_id  uuid references public.users(id) on delete set null,
  broker_contact_id uuid references public.outreach_contacts(id) on delete set null,
  broker_name     text,
  broker_email    text,
  token           text not null unique,
  commission_type text not null default 'PERCENT' check (commission_type in ('PERCENT','FIXED')),
  commission_value numeric(10,2),
  currency        text,
  terms           text,
  -- Explicitly enumerated. A broker sees these units and no others; an empty
  -- array means the whole published inventory of the project.
  unit_ids        uuid[] not null default '{}',
  valid_until     date,
  status          text not null default 'INVITED'
                    check (status in ('INVITED','ACCEPTED','DECLINED','REVOKED','EXPIRED')),
  accepted_at     timestamptz,
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists dev_broker_invites_ws_idx on public.dev_broker_invites(workspace_id, status);
create index if not exists dev_broker_invites_project_idx on public.dev_broker_invites(project_id);

-- ── 12. EXPORT TEMPLATES ───────────────────────────────────────────────────
--
-- A developer's own sales file has its own column order, its own headers and
-- often its own language. This stores that mapping so the export comes out in
-- the shape their management already reads. It stores a MAPPING, never an
-- uploaded workbook: nothing from a customer's spreadsheet is executed,
-- re-emitted or preserved beyond header text.

create table if not exists public.dev_export_templates (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.dev_workspaces(id) on delete cascade,
  name         text not null,
  kind         text not null default 'SALES_LEDGER'
                 check (kind in ('SALES_LEDGER','INVENTORY','PAYMENTS','CRM')),
  -- [{ header: 'Apartment', field: 'unit_number', format: 'text'|'number'|'date'|'currency' }]
  columns      jsonb not null default '[]'::jsonb,
  is_default   boolean not null default false,
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists dev_export_templates_ws_idx on public.dev_export_templates(workspace_id);

-- deal_id references, now that dev_deals exists.
alter table public.dev_activities drop constraint if exists dev_activities_deal_id_fkey;
alter table public.dev_activities add constraint dev_activities_deal_id_fkey
  foreign key (deal_id) references public.dev_deals(id) on delete set null;
alter table public.dev_tasks drop constraint if exists dev_tasks_deal_id_fkey;
alter table public.dev_tasks add constraint dev_tasks_deal_id_fkey
  foreign key (deal_id) references public.dev_deals(id) on delete set null;

-- ── 13. updated_at ─────────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array[
    'dev_payment_plans','dev_leads','dev_tasks','dev_viewings','dev_offers',
    'dev_reservations','dev_deals','dev_payment_schedule','dev_payments',
    'dev_documents','dev_walkthroughs','dev_broker_invites','dev_export_templates'
  ] loop
    execute format('drop trigger if exists %I_updated_at on public.%I', t, t);
    execute format(
      'create trigger %I_updated_at before update on public.%I
       for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- ── 14. ROW LEVEL SECURITY ─────────────────────────────────────────────────
--
-- A sales agent sees the leads that are theirs. Everyone senior to them sees
-- all of it. That single distinction is the reason dev_lead_visible() exists
-- and is asked by every table that hangs off a lead, rather than each of them
-- inventing its own version of the rule.

create or replace function public.dev_lead_visible(p_lead uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1 from public.dev_leads l
    where l.id = p_lead
      and (
        public.dev_can(l.workspace_id, 'crm_all')
        or (public.dev_can(l.workspace_id, 'crm')
            and (l.assigned_to = public.auth_user_id() or l.created_by = public.auth_user_id()))
        or public.dev_can(l.workspace_id, 'finance')
        or public.dev_can(l.workspace_id, 'legal')
      )
  );
$$;

revoke all on function public.dev_lead_visible(uuid) from public;
grant execute on function public.dev_lead_visible(uuid) to authenticated;

alter table public.dev_payment_plans     enable row level security;
alter table public.dev_leads             enable row level security;
alter table public.dev_lead_units        enable row level security;
alter table public.dev_activities        enable row level security;
alter table public.dev_tasks             enable row level security;
alter table public.dev_viewings          enable row level security;
alter table public.dev_offers            enable row level security;
alter table public.dev_reservations      enable row level security;
alter table public.dev_deals             enable row level security;
alter table public.dev_payment_schedule  enable row level security;
alter table public.dev_payments          enable row level security;
alter table public.dev_documents         enable row level security;
alter table public.dev_walkthroughs      enable row level security;
alter table public.dev_share_links       enable row level security;
alter table public.dev_share_events      enable row level security;
alter table public.dev_broker_invites    enable row level security;
alter table public.dev_export_templates  enable row level security;

-- Leads and everything scoped to one lead.
drop policy if exists dev_leads_select on public.dev_leads;
create policy dev_leads_select on public.dev_leads
  for select to authenticated
  using (
    public.is_admin()
    or public.dev_can(workspace_id, 'crm_all')
    or public.dev_can(workspace_id, 'finance')
    or public.dev_can(workspace_id, 'legal')
    or (public.dev_can(workspace_id, 'crm')
        and (assigned_to = public.auth_user_id() or created_by = public.auth_user_id()))
  );

drop policy if exists dev_leads_insert on public.dev_leads;
create policy dev_leads_insert on public.dev_leads
  for insert to authenticated with check (public.dev_can(workspace_id, 'crm'));

drop policy if exists dev_leads_update on public.dev_leads;
create policy dev_leads_update on public.dev_leads
  for update to authenticated
  using (public.dev_can(workspace_id, 'crm_all')
         or (public.dev_can(workspace_id, 'crm') and assigned_to = public.auth_user_id()))
  with check (public.dev_can(workspace_id, 'crm_all')
         or (public.dev_can(workspace_id, 'crm') and assigned_to = public.auth_user_id()));

drop policy if exists dev_leads_delete on public.dev_leads;
create policy dev_leads_delete on public.dev_leads
  for delete to authenticated using (public.dev_can(workspace_id, 'crm_all'));

do $$
declare t text;
begin
  foreach t in array array['dev_lead_units','dev_activities','dev_tasks','dev_viewings','dev_offers'] loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated
       using (public.is_admin()
              or (lead_id is null and public.dev_is_member(workspace_id))
              or public.dev_lead_visible(lead_id))', t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format(
      'create policy %I_write on public.%I for all to authenticated
       using (public.dev_can(workspace_id, ''crm''))
       with check (public.dev_can(workspace_id, ''crm''))', t, t);
  end loop;
end $$;

-- Reservations and deals: readable by any member (a sales floor has to be
-- able to see that a unit is gone), writable only through the RPCs, which
-- check 'sale' themselves. No blanket write policy is granted.
do $$
declare t text;
begin
  foreach t in array array['dev_reservations','dev_deals','dev_payment_schedule'] loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated
       using (public.dev_is_member(workspace_id) or public.is_admin())', t, t);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format(
      'create policy %I_update on public.%I for update to authenticated
       using (public.dev_can(workspace_id, ''sale''))
       with check (public.dev_can(workspace_id, ''sale''))', t, t);
  end loop;
end $$;

-- Money. Recording a payment is a sales-floor act; confirming one is not, and
-- the confirmation RPC checks 'finance' regardless of this policy.
drop policy if exists dev_payments_select on public.dev_payments;
create policy dev_payments_select on public.dev_payments
  for select to authenticated
  using (public.dev_can(workspace_id, 'finance')
         or public.dev_can(workspace_id, 'sale')
         or public.dev_can(workspace_id, 'crm_all')
         or public.is_admin());

drop policy if exists dev_payments_insert on public.dev_payments;
create policy dev_payments_insert on public.dev_payments
  for insert to authenticated
  with check ((public.dev_can(workspace_id, 'finance') or public.dev_can(workspace_id, 'sale'))
              and status = 'RECORDED');

drop policy if exists dev_payments_update on public.dev_payments;
create policy dev_payments_update on public.dev_payments
  for update to authenticated
  using (public.dev_can(workspace_id, 'finance'))
  with check (public.dev_can(workspace_id, 'finance'));

-- Documents.
drop policy if exists dev_documents_select on public.dev_documents;
create policy dev_documents_select on public.dev_documents
  for select to authenticated
  using (public.dev_can(workspace_id, 'documents') or public.is_admin());

drop policy if exists dev_documents_write on public.dev_documents;
create policy dev_documents_write on public.dev_documents
  for all to authenticated
  using (public.dev_can(workspace_id, 'documents'))
  with check (public.dev_can(workspace_id, 'documents'));

-- Inventory-adjacent things.
do $$
declare t text;
begin
  foreach t in array array['dev_payment_plans','dev_walkthroughs'] loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated
       using (public.dev_is_member(workspace_id) or public.is_admin())', t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format(
      'create policy %I_write on public.%I for all to authenticated
       using (public.dev_can(workspace_id, ''inventory''))
       with check (public.dev_can(workspace_id, ''inventory''))', t, t);
  end loop;
end $$;

-- Share links: any member may see them, anyone who can work a lead may make
-- one. Events are written by the public tracking function (SECURITY DEFINER),
-- never by the client, so there is no insert policy at all.
drop policy if exists dev_share_links_select on public.dev_share_links;
create policy dev_share_links_select on public.dev_share_links
  for select to authenticated
  using (public.dev_is_member(workspace_id) or public.is_admin());

drop policy if exists dev_share_links_write on public.dev_share_links;
create policy dev_share_links_write on public.dev_share_links
  for all to authenticated
  using (public.dev_can(workspace_id, 'crm') or public.dev_can(workspace_id, 'inventory'))
  with check (public.dev_can(workspace_id, 'crm') or public.dev_can(workspace_id, 'inventory'));

drop policy if exists dev_share_events_select on public.dev_share_events;
create policy dev_share_events_select on public.dev_share_events
  for select to authenticated
  using (public.dev_is_member(workspace_id) or public.is_admin());

drop policy if exists dev_broker_invites_select on public.dev_broker_invites;
create policy dev_broker_invites_select on public.dev_broker_invites
  for select to authenticated
  using (public.dev_is_member(workspace_id) or broker_user_id = public.auth_user_id() or public.is_admin());

drop policy if exists dev_broker_invites_write on public.dev_broker_invites;
create policy dev_broker_invites_write on public.dev_broker_invites
  for all to authenticated
  using (public.dev_can(workspace_id, 'marketing') or public.dev_can(workspace_id, 'crm_all'))
  with check (public.dev_can(workspace_id, 'marketing') or public.dev_can(workspace_id, 'crm_all'));

drop policy if exists dev_export_templates_select on public.dev_export_templates;
create policy dev_export_templates_select on public.dev_export_templates
  for select to authenticated
  using (public.dev_is_member(workspace_id) or public.is_admin());

drop policy if exists dev_export_templates_write on public.dev_export_templates;
create policy dev_export_templates_write on public.dev_export_templates
  for all to authenticated
  using (public.dev_is_member(workspace_id))
  with check (public.dev_is_member(workspace_id));

-- ── 15. GRANTS ─────────────────────────────────────────────────────────────

grant select, insert, update, delete on
  public.dev_payment_plans, public.dev_leads, public.dev_lead_units,
  public.dev_activities, public.dev_tasks, public.dev_viewings, public.dev_offers,
  public.dev_documents, public.dev_walkthroughs, public.dev_share_links,
  public.dev_broker_invites, public.dev_export_templates
  to authenticated;
grant select, update on public.dev_reservations, public.dev_deals, public.dev_payment_schedule
  to authenticated;
grant select, insert, update on public.dev_payments to authenticated;
grant select on public.dev_share_events to authenticated;
