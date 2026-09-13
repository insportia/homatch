-- Communications — the record that a person said they were allowed to clone
-- the voice they uploaded.
--
-- WHY THIS TABLE EXISTS AT ALL
--
-- Cloning a voice is not like uploading an avatar. The output can say things
-- the speaker never said, in their voice, to people who know them. The only
-- thing standing between that and a product feature is whether the person who
-- uploaded the clip had the right to, and the only honest way to hold that is
-- to ask, record the answer, and refuse to proceed without it.
--
-- So the server will not call the provider's clone endpoint unless a row here
-- was written first, in the same request, by the same account.
--
-- WHAT IS DELIBERATELY NOT STORED
--
-- The audio. The clip is streamed to the provider and never persisted by
-- Homatch: keeping a library of voice samples would create exactly the
-- liability this record exists to bound. What is kept is who confirmed, what
-- they confirmed, when, and which provider voice it produced — the minimum
-- needed to answer "who authorised this voice?" later.

create table if not exists public.comm_voice_consents (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references auth.users(id) on delete cascade,

  -- Named by the customer, and the provider's id once the clone succeeds.
  -- provider_voice_id is nullable because the row is written BEFORE the
  -- provider call: a clone that fails must still leave evidence that consent
  -- was given and an attempt was made.
  voice_name          text not null,
  provider            text not null default 'CARTESIA',
  provider_voice_id   text,

  -- The exact sentence that was agreed to, and its version, so a future
  -- change to the wording cannot be read backwards onto old confirmations.
  consent_text        text not null,
  consent_version     text not null,
  confirmed_at        timestamptz not null default now(),

  -- UPLOAD or RECORD. Kept because "they uploaded a file they had" and "they
  -- recorded themselves" are different provenance claims.
  source              text not null default 'UPLOAD'
                      check (source in ('UPLOAD', 'RECORD')),

  -- Enough to identify the clip without keeping it.
  clip_bytes          integer,
  clip_mime           text,

  status              text not null default 'PENDING'
                      check (status in ('PENDING', 'READY', 'FAILED')),
  failure_reason      text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists comm_voice_consents_owner_idx
  on public.comm_voice_consents (owner_id, created_at desc);

create index if not exists comm_voice_consents_voice_idx
  on public.comm_voice_consents (provider_voice_id)
  where provider_voice_id is not null;

alter table public.comm_voice_consents enable row level security;

-- owner_id is auth.uid(), matching the foreign key above and every other
-- Communications table. The identity split that made outreach_* write-dead is
-- not repeated here.
drop policy if exists comm_voice_consents_owner on public.comm_voice_consents;
create policy comm_voice_consents_owner on public.comm_voice_consents
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists comm_voice_consents_admin_read on public.comm_voice_consents;
create policy comm_voice_consents_admin_read on public.comm_voice_consents
  for select to authenticated
  using (exists (
    select 1 from public.users u
    where u.auth_id = (select auth.uid()) and u.is_admin = true
  ));
