-- AI TALK SPEAKS THROUGH CARTESIA, AND ONLY CARTESIA.
--
-- The ElevenLabs path worked, in the sense that it returned 200 and produced
-- Georgian. On a real phone it produced a high-frequency whine at phrase
-- joins, intermittent distortion, and an audible inconsistency between one
-- phrase and the next. The owner listened to a recording of a live call and
-- called it unacceptable, which is the only test of a voice that counts.
--
-- WHAT CHANGES HERE, AND WHAT CHANGES IN CODE
--
-- This row is the decision. The code enforces that AI TALK uses the highest
-- priority enabled TTS route and NOTHING underneath it: there is no longer a
-- ladder from one provider to another, because a fallback between providers
-- is a fallback between voices, and an assistant that changes voice mid-call
-- is worse than one that pauses.
--
-- So swapping the provider back, or to a third one later, is this UPDATE plus
-- an approved voice row. It is not a deploy.
--
-- WHY ELEVENLABS IS DISABLED RATHER THAN DELETED
--
-- Because it is not only AI TALK's. The voice library, the audition harness
-- and the admin Voice AI screens all still speak to it, and the account still
-- holds a cloned Georgian voice somebody paid for. Deleting the row would
-- break those to tidy up this one. Disabled and priority-demoted says what
-- was decided; deleted would destroy the record of it.
--
-- Scribe stays exactly where it is: it is the STT fallback and has nothing to
-- do with which voice speaks.

-- Cartesia first, and the only rung AI TALK can reach.
update comm_provider_routes
   set priority    = 1,
       enabled     = true,
       kill_switch = false,
       config      = coalesce(config, '{}'::jsonb) || jsonb_build_object(
         'model', 'sonic-3',
         'streaming', 'sse',
         'container', 'raw',
         'encoding', 'pcm_s16le',
         'note', 'AI TALK streams /tts/sse as raw PCM at the browser''s own AudioContext rate, so nothing is resampled. The model ladder inside the provider stays; there is no ladder between providers.'
       ),
       updated_at  = now()
 where role = 'TTS' and provider = 'CARTESIA';

-- ElevenLabs is no longer reachable from AI TALK.
update comm_provider_routes
   set priority    = 50,
       enabled     = false,
       kill_switch = true,
       config      = coalesce(config, '{}'::jsonb) || jsonb_build_object(
         'disabled_for', 'AI_TALK',
         'disabled_on', '2026-09-15',
         'reason', 'Audible artefacts on a real device: whine at phrase joins, intermittent distortion, inconsistent quality between phrases. Replaced by Cartesia on AI TALK. Other surfaces that talk to ElevenLabs are unaffected by this row.'
       ),
       updated_at  = now()
 where role = 'TTS' and provider = 'ELEVENLABS';

-- The approved Georgian voice, on the provider that now speaks it.
--
-- Fail-closed is unchanged: no approved row for a language means AI TALK does
-- not speak that language rather than reaching for the nearest voice it can
-- find. An English speaker reading Georgian letters is exactly the failure
-- this table was created to prevent.
insert into public.voice_language_defaults (provider, language, voice_id, model_id, send_language)
values ('CARTESIA', 'ka', '0bfbea6c-2f8f-4f86-b411-aa2316561e36', 'sonic-3', true)
on conflict (provider, language) do update
  set voice_id      = excluded.voice_id,
      model_id      = excluded.model_id,
      send_language = excluded.send_language,
      approved_at   = now();

-- Mariam is retired from AI TALK. The row is kept, unreferenced, because it
-- records which voice was approved and when, and because the audition harness
-- still reads this table for every provider.
update public.voice_language_defaults
   set settings_locked = true
 where provider = 'ELEVENLABS' and language = 'ka';

-- THE OTHER FIVE LANGUAGES, APPROVED ON MEASURED EVIDENCE.
--
-- AI TALK is multilingual: a visitor starts talking and the recogniser decides
-- which of the candidate languages it heard. That is worth nothing if the
-- voice then refuses to say it, and fail-closed means exactly that — a
-- language with no approved row does not get spoken.
--
-- One voice covers all six. That is not an assumption from a capability list:
-- each line below was synthesised through the deployed streaming path with
-- this voice id and sonic-3, carrying a price and a Tbilisi district, because
-- numbers, currency and place names are where a mismatched voice falls apart
-- first. Measured on 2026-09-15, first audio byte and audio produced:
--
--   ka  154ms   0.076 s/char        en  149ms   0.058 s/char
--   ru  166ms   0.063 s/char        tr  159ms   0.070 s/char
--   ar  162ms   0.081 s/char        he  675ms   0.074 s/char
--
-- The seconds-per-character figures matter as much as the latencies: a
-- provider that gives up mid-sentence still answers 200, and it shows up as
-- almost no audio for a long sentence. These are consistent across all six.
--
-- WHAT THIS DOES NOT ESTABLISH
--
-- Whether it SOUNDS native. Nothing automated can tell you that — it is the
-- exact failure that made the previous provider unusable for Georgian while
-- every check passed — which is why the audition harness exists and why a
-- person listens. These rows say the pipeline carries each language and
-- returns plausible speech. Revoking one is a delete, and costs no deploy.
insert into public.voice_language_defaults (provider, language, voice_id, model_id, send_language)
select 'CARTESIA', lang, '0bfbea6c-2f8f-4f86-b411-aa2316561e36', 'sonic-3', true
  from unnest(array['en', 'ru', 'tr', 'ar', 'he']) as lang
on conflict (provider, language) do update
  set voice_id      = excluded.voice_id,
      model_id      = excluded.model_id,
      send_language = excluded.send_language,
      approved_at   = now();
