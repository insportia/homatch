-- TELEGRAM COMMUNITY TARGETS — columns the MTProto sync and source discovery
-- already read and write, which no earlier migration created.
--
-- community-sync selects community_targets.last_message_at for every tick, so
-- in production the first authenticated sync failed before reading anything
-- (PostgREST: column does not exist). Source discovery also writes
-- telegram_peer_id, discovered_via, relevance_score and audited_at.
--
-- Additive and nullable: no existing row, policy or reader changes.

alter table public.community_targets
  add column if not exists last_message_at timestamptz,
  add column if not exists telegram_peer_id text,
  add column if not exists discovered_via text,
  add column if not exists relevance_score numeric,
  add column if not exists audited_at timestamptz;

comment on column public.community_targets.last_message_at is
  'Newest message timestamp seen in this community (sync and audit).';
comment on column public.community_targets.telegram_peer_id is
  'Telegram numeric chat id, as text (it can exceed int4).';
comment on column public.community_targets.discovered_via is
  'How the community was found, e.g. TELEGRAM_SEARCH.';
comment on column public.community_targets.relevance_score is
  'Audit relevance 0..1 from auditSource().';
comment on column public.community_targets.audited_at is
  'When the source audit last ran.';
