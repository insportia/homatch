-- BACKFILL, AND A CORRECTION. Applied to production on 2026-09-14 with no file
-- in this directory. The filename matches the name recorded in
-- supabase_migrations.schema_migrations for version 20260914184530 so that the
-- migration tooling and this directory agree -- but read the next paragraph,
-- because the file does NOT do everything its recorded name says.
--
-- WHAT RAN, AND WHAT WAS TAKEN BACK
--
-- As applied, this statement did two separable things: it corrected the
-- route's credential contract, and it set enabled = true. The enable was
-- premature -- the route was switched on before a real StreamingRecognize
-- recognition had ever been proven -- and it was reverted within the hour by
-- the owner's instruction. Production is fail-closed again.
--
-- So this file keeps the correction and drops the enable. Re-running it on a
-- fresh database must reproduce production as it stands, and production stands
-- with Google registered, described accurately, and switched off. A migration
-- that silently re-enables an unproven paid route the next time somebody
-- rebuilds from scratch is exactly the sort of thing that is discovered by a
-- surprise bill.
--
-- WHY THE CREDENTIAL CONTRACT WAS WRONG
--
-- The row was registered in 20260914130207 with the note "blocked on a
-- service-account credential and on a gRPC-capable transport; the edge runtime
-- speaks HTTP". Both halves are now answered, and neither was answered the way
-- that note assumed:
--
--   * The transport is not in the edge runtime at all. A browser cannot speak
--     gRPC and neither can Deno Deploy, so StreamingRecognize terminates on
--     the Node worker that was already deployed, and the browser reaches it
--     over a WebSocket. Nothing new was built to hold it.
--
--   * The service account therefore lives on the worker, not here. That is
--     what makes credential_env_names wrong as written: the router reads it
--     with hasSecret() inside the EDGE function, where those three names are
--     absent and always will be. Left as it was, the route could be enabled
--     and would still refuse itself, reporting a missing credential that is
--     not missing -- it is simply on another machine.
--
-- What the edge function actually needs to route a session to Google is
-- WORKER_TOKEN, because it mints the HMAC grant the worker verifies. That is a
-- real dependency: without it there is no way to authorise the socket. So the
-- column names the secret THIS runtime must hold, and the Google names are
-- recorded in config beside the machine that holds them, so an operator
-- debugging a dead route still learns where to look.
--
-- The worker's own /health is the second half of the check and stays in code:
-- only asking it can tell whether the instance actually parsed a credential.
-- Enabled-and-unhealthy falls through to Scribe and logs google_stt_unavailable
-- rather than failing the turn.

update comm_provider_routes
   set credential_env_names = array['WORKER_TOKEN'],
       config = jsonb_build_object(
         'model',            'chirp_3',
         'language',         'ka-GE',
         'transport',        'grpc_streaming_recognize',
         'terminates_on',    'homatch-official-worker',
         'socket_path',      '/speech/stream',
         'worker_env_names', jsonb_build_array(
           'GOOGLE_SPEECH_CREDENTIALS_JSON',
           'GOOGLE_SPEECH_PROJECT_ID',
           'GOOGLE_SPEECH_REGION'
         ),
         'note', 'Realtime Georgian over StreamingRecognize. The edge function mints a short-lived HMAC grant; the worker holds the service account and opens the gRPC stream. Scribe remains priority 5 and serves the turn whenever this route is down, which is logged rather than silent.'
       ),
       updated_at = now()
 where role = 'STT' and provider = 'GOOGLE';
