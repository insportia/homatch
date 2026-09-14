-- HOMATCH Voice AI — the Georgian audition.
--
-- WHY THIS EXISTS
--
-- The owner listened to the Georgian output and heard an English speaker
-- reading Georgian letters. He is right, and the provider's own metadata says
-- why: every stock voice on this account is labelled `language: en` with an
-- american, british or australian accent. A multilingual MODEL renders those
-- speakers saying Georgian words; it does not give them a Georgian mouth.
--
-- The voice that was chosen as the Georgian default was chosen by me, on the
-- widest language list in the catalogue, which is a fact about the model's
-- reach and says nothing at all about how the speaker sounds. That is the
-- mistake this table exists to stop being repeated: a voice is approved for a
-- language when a person who speaks that language has LISTENED to it, and
-- never because a number looked good.
--
-- WHAT IS STORED
--
-- One row per generated sample: which voice, which model, which settings,
-- which sentence, how long it took, and where the audio is. No transcript of
-- anybody's conversation -- these are fixed test sentences written for the
-- purpose. The audio lives in a private bucket only an admin can read.
--
-- Samples are disposable. Nothing downstream reads them; they exist so an
-- owner can listen, compare, and record a decision.

create table if not exists public.voice_audition_samples (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  provider text not null default 'ELEVENLABS',
  voice_id text not null,
  voice_name text,
  model_id text not null,
  -- Whether language_code was sent, and which. Both matter: the same voice
  -- and model sound different when the model is told the language.
  language text,
  sent_language boolean not null default false,
  -- Exactly what was sent, so a sample can be reproduced rather than
  -- remembered.
  settings jsonb not null default '{}'::jsonb,
  sentence_key text not null,
  sentence text not null,
  storage_path text,
  mime text,
  bytes integer,
  latency_ms integer,
  ok boolean not null default true,
  error_code text,
  provider_status integer,
  -- The provider's own message, bounded. A bare 401 cannot tell a revoked key
  -- from a voice this plan may not use, and those need different actions.
  error_detail text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists voice_audition_samples_batch
  on public.voice_audition_samples (batch_id, voice_id, sentence_key);
create index if not exists voice_audition_samples_recent
  on public.voice_audition_samples (created_at desc);

alter table public.voice_audition_samples enable row level security;

-- Operator material. A customer has no business reading it, and nobody but an
-- admin writes it. Identity via users.auth_id, matching admin_settings and
-- every other admin policy in this schema.
drop policy if exists voice_audition_admin on public.voice_audition_samples;
create policy voice_audition_admin on public.voice_audition_samples
  for all to authenticated
  using (exists (select 1 from public.users u
                  where u.auth_id = (select auth.uid()) and u.is_admin = true))
  with check (exists (select 1 from public.users u
                       where u.auth_id = (select auth.uid()) and u.is_admin = true));

grant select, insert, update, delete on public.voice_audition_samples to authenticated;

-- ── Where the audio lives ───────────────────────────────────────────────────
--
-- Private. These are generated samples, not public assets, and a bucket that
-- is public by default is how a "temporary" test artefact becomes an
-- indexable URL. Admins read them through signed links the edge function
-- mints; nothing else can read them at all.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('voice-auditions', 'voice-auditions', false, 5242880,
        array['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/webm'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists voice_auditions_admin_read on storage.objects;
create policy voice_auditions_admin_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'voice-auditions'
    and exists (select 1 from public.users u
                 where u.auth_id = (select auth.uid()) and u.is_admin = true)
  );

-- Writes come from the edge function under the service role, which bypasses
-- RLS. No client-side write policy is created, deliberately: nothing in a
-- browser should be able to put a file in this bucket.
