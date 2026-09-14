-- BACKFILL. Applied to production on 2026-09-14 with no file in this
-- directory; this is the statement recorded for version 20260914130207,
-- reproduced as it ran.
--
-- Google realtime Georgian speech recognition, registered and switched off.
--
-- WHY A ROW FOR SOMETHING THAT DOES NOT RUN YET
--
-- The owner has chosen Google as the Georgian STT. Google supports Georgian
-- (ka-GE) on chirp, chirp_2 and chirp_3, and chirp_3 supports
-- StreamingRecognize -- verified from Google's own current documentation, not
-- assumed. Two things are missing and both are visible here rather than in
-- somebody's memory:
--
--   1. no credential. There is no Google service account on this project.
--   2. no transport. StreamingRecognize is gRPC. The browser talks to a Deno
--      edge function over HTTP, and neither speaks gRPC, so realtime Google
--      recognition needs either a gRPC-capable worker or the REST
--      :recognize endpoint used in chunks, which is not the same thing.
--
-- So the row exists, disabled, with its kill switch raised. A disabled route
-- with a stated reason is a gap an operator can see on the Failover screen.
-- A missing row is a gap nobody discovers until they ask why Georgian still
-- goes through Scribe.
--
-- ElevenLabs Scribe keeps carrying STT in the meantime. It works, it is
-- measured, and replacing a working path with an unverifiable one would be
-- the opposite of what the rest of this workstream has been about.
--
-- Note for anyone reading this after the fact: both blockers were answered
-- later the same day, and NOT the way this comment guessed. See
-- 20260914184530_google_stt_enabled_first_for_georgian.sql.

insert into public.comm_provider_routes
  (role, provider, priority, enabled, kill_switch, credential_env_names, config)
values (
  'STT', 'GOOGLE', 1, false, true,
  array['GOOGLE_SPEECH_CREDENTIALS_JSON','GOOGLE_SPEECH_PROJECT_ID','GOOGLE_SPEECH_REGION'],
  jsonb_build_object(
    'model', 'chirp_3',
    'language', 'ka-GE',
    'transport', 'grpc_streaming_recognize',
    'note', 'Georgian is supported on chirp/chirp_2/chirp_3 and chirp_3 supports StreamingRecognize. Blocked on a service-account credential and on a gRPC-capable transport; the edge runtime speaks HTTP.'
  )
)
-- Deliberately does not touch enabled or kill_switch on conflict: a re-run
-- must never be able to switch a route on.
on conflict (role, provider) do update
  set priority = excluded.priority,
      credential_env_names = excluded.credential_env_names,
      config = excluded.config;
