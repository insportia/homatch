-- HOMI answers carry designed parts beside their words: structured blocks
-- (key figures, a callout, a comparison, steps), the service cards the answer
-- pointed to, and the rate-limited service note. They are stored with the
-- answer so a reopened conversation looks the way it did, and so homatch-ai
-- can see which service notes a conversation already showed (at most once
-- per service per conversation).
--
-- Additive and nullable: existing rows and every existing reader are
-- unaffected. homatch-ai writes the column in a separate best-effort update
-- after the message itself is saved, and the app falls back to reading
-- without it, so the order of deploy and migration cannot lose an answer.
-- Row access is unchanged: ai_messages RLS is per row (conversation owner).

alter table public.ai_messages
  add column if not exists meta jsonb;

alter table public.ai_messages
  drop constraint if exists ai_messages_meta_shape;

alter table public.ai_messages
  add constraint ai_messages_meta_shape
  check (meta is null or (jsonb_typeof(meta) = 'object' and pg_column_size(meta) <= 16384));

comment on column public.ai_messages.meta is
  'HOMI answer meta: {blocks, services, pitch}. Validated by src/lib/homi/messageMeta.ts on write and read. Never message text.';
