-- BACKFILL. Applied to production on 2026-09-14 with no file in this
-- directory; this is the statement recorded for version 20260914120015.
--
-- A language profile owns its own opening line. A sentence translated out of
-- English reads as translated, and the first few seconds are where a caller
-- decides whether the system is natural -- which is the whole reason the
-- Georgian work exists.
--
-- settings_locked exists so that an owner-approved voice configuration cannot
-- be quietly re-tuned by a later default.

alter table public.voice_language_defaults
  add column if not exists first_message text,
  add column if not exists settings_locked boolean not null default false;

comment on column public.voice_language_defaults.first_message is
  'What the assistant opens with in this language. A language profile owns its own opening line: a sentence translated out of English reads as translated, and the first few seconds decide whether a caller believes the system is natural.';
