-- MARIAM IS THE VOICE AI TALK SPEAKS WITH.
--
-- The owner chose a new Cartesia voice and named the assistant after it:
-- Mariam, Homatch's AI assistant. This is the voice swap, and it is the only
-- thing that changes. The provider, the model, the streaming shape, the
-- chunking, the barge-in, the cancellation chain, the recognisers, the
-- language switching and the metering are all untouched -- a voice id is a
-- value in this table, which is exactly why replacing one is an UPDATE.
--
-- WHY THIS MIGRATION EXISTS AT ALL, GIVEN IT IS DATA
--
-- Because the table had already drifted from the repository, and silently.
-- 20260915090000 seeded 0bfbea6c-2f8f-4f86-b411-aa2316561e36 for six
-- languages. Production, read on 2026-09-19, held
-- 074bb318-3c55-47d8-98cd-ccdbfb98dc84 across forty-three -- a change made
-- directly against the database and recorded nowhere. Neither id was wrong to
-- run; what was wrong is that a fresh environment built from this repository
-- would have spoken in a voice production abandoned, and nothing in the
-- repository would have said so.
--
-- So the swap is written down. It is the same table, the same columns and the
-- same reader; no second settings system, and an operator can still revoke or
-- replace a voice from the database without a deploy.
--
-- ONE VOICE, EVERY LANGUAGE
--
-- Deliberate, and unchanged from what production already did: every Cartesia
-- row moves together. Language switching is a session/STT/LLM concern and must
-- never become a reason to change WHO is speaking -- an assistant that swaps
-- identity when a visitor switches to Russian mid-sentence is worse than one
-- that pauses. Mariam answers in all of them.
--
-- WHY THE VERSION IS 21:00
--
-- Because production's ledger already holds 20260919120000, 160000, 170000
-- and 180000: superseded spellings of four storage migrations, recorded
-- under both names while the historical drift was repaired. `db push` skips
-- a version the ledger has seen, so a file carrying one would be committed,
-- pushed, and never run -- which for a voice swap means the product keeps
-- speaking in the old voice with nothing to show it was ignored.
--
-- FAIL-CLOSED IS UNCHANGED. A language with no approved row is still a
-- language AI TALK does not speak, rather than one it speaks in the nearest
-- voice it can find.

-- Only rows that exist are moved: this replaces a voice, it does not widen
-- the set of languages the product will speak.
update public.voice_language_defaults
   set voice_id    = '6247621a-5365-4227-8c03-5fd970d59918',
       model_id    = coalesce(model_id, 'sonic-3'),
       approved_at = now()
 where provider = 'CARTESIA'
   and voice_id is distinct from '6247621a-5365-4227-8c03-5fd970d59918';

-- The six AI TALK actually pins its recogniser to, guaranteed present.
--
-- Georgian is the one that matters and the one that has been re-seeded before;
-- the other five are the languages the live recogniser can be pinned to. If a
-- row is missing here the product goes silent in that language, so this is an
-- upsert rather than an assumption that the update above found everything.
insert into public.voice_language_defaults (provider, language, voice_id, model_id, send_language)
select 'CARTESIA', lang, '6247621a-5365-4227-8c03-5fd970d59918', 'sonic-3', true
  from unnest(array['ka', 'en', 'ru', 'tr', 'ar', 'he']) as lang
on conflict (provider, language) do update
  set voice_id      = excluded.voice_id,
      model_id      = excluded.model_id,
      send_language = excluded.send_language,
      approved_at   = now();

-- ElevenLabs is untouched, for the reason 20260915090000 gave: the voice
-- library, the audition harness and the admin screens still read it, and the
-- row records what was approved and when. It is unreachable from AI TALK
-- because its route is disabled, not because its rows were deleted.
