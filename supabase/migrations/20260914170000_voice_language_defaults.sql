-- HOMATCH Voice AI — which voice speaks WHICH LANGUAGE, decided by a person
-- who speaks it.
--
-- WHY ONE GLOBAL DEFAULT WAS ALWAYS GOING TO BE WRONG
--
-- A voice is a recording of a particular human being. A multilingual model can
-- make that human say words in another language; it cannot give them another
-- language's mouth. So a voice that is excellent in English is, in Georgian,
-- an English speaker reading Georgian letters -- which is exactly what the
-- owner heard, and exactly what the provider's own metadata predicted: every
-- stock voice on this account is labelled `language: en` with an american,
-- british or australian accent.
--
-- The previous design had one default voice for everything, and it was chosen
-- on the widest language list in the catalogue. That list is a fact about the
-- MODEL'S reach. Treating it as a fact about the SPEAKER is the whole defect.
--
-- WHAT THIS TABLE IS
--
-- The record of a human decision: for this language, this voice, this model,
-- these settings, approved by this person on this date. A row exists only
-- because somebody listened. There is no default row and nothing writes one
-- automatically -- an unapproved language falls back to the global default and
-- the admin screen says so, which is a worse product and an honest one.

create table if not exists public.voice_language_defaults (
  -- One approved voice per language per provider. Changing it is an update,
  -- so there is never an ambiguous pair.
  language text not null,
  provider text not null default 'ELEVENLABS',
  voice_id text not null,
  voice_name text,
  model_id text,
  -- Whether to declare the language to the model, and with what settings.
  -- Approval is of a COMBINATION; the same voice on a different model is a
  -- different sound and has not been approved.
  send_language boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  -- Which audition sample the approver actually listened to.
  audition_sample_id uuid references public.voice_audition_samples(id) on delete set null,
  notes text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz not null default now(),
  primary key (provider, language)
);

alter table public.voice_language_defaults enable row level security;

-- Customers may read which voice their language speaks with; only an admin
-- decides it. Identity via users.auth_id, matching every other admin policy.
drop policy if exists voice_language_defaults_read on public.voice_language_defaults;
create policy voice_language_defaults_read on public.voice_language_defaults
  for select to authenticated using (true);

drop policy if exists voice_language_defaults_admin on public.voice_language_defaults;
create policy voice_language_defaults_admin on public.voice_language_defaults
  for all to authenticated
  using (exists (select 1 from public.users u
                  where u.auth_id = (select auth.uid()) and u.is_admin = true))
  with check (exists (select 1 from public.users u
                       where u.auth_id = (select auth.uid()) and u.is_admin = true));

grant select on public.voice_language_defaults to authenticated;
grant insert, update, delete on public.voice_language_defaults to authenticated;

comment on table public.voice_language_defaults is
  'The voice approved for one language, by a person who listened to it. Empty '
  'for a language nobody has approved, which is reported rather than guessed at.';
