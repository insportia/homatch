-- GOOGLE BECOMES PRIORITY 1 FOR SPEECH RECOGNITION, ON EVIDENCE.
--
-- The route was registered fail-closed in August, switched on once without a
-- proof and switched straight back off, and stayed off through every failure
-- described below. It is enabled now because a real recognition completed
-- against the deployed worker:
--
--   GET /health/speech-selftest on homatch-official-worker
--   region eu, model chirp_3, language ka-GE, LINEAR16 16kHz
--   234,240 bytes of Georgian over the real WebSocket, on a real HMAC grant
--
--   expected: გამარჯობა, მე მარიამი ვარ, Homatch-ის AI ასისტენტი. რით შემიძლია დაგეხმაროთ?
--   returned: გამარჯობა, მე მარიამი ვარ, ჰომაჩის AI ასისტენტი, რით შემიძლია დაგეხმაროთ?
--
-- Word overlap 0.82; the only real divergence is the brand name, which the
-- recogniser transliterated into Georgian script, which is what a Georgian
-- recogniser should do with an English word said aloud.
--
-- WHAT HAD TO BE TRUE FIRST, NONE OF WHICH THE HEALTH CHECK COULD SEE
--
--   * the region was `global`, which is not an endpoint and cannot serve Chirp;
--   * the client was v1 -- the package root exports v1.SpeechClient -- being
--     handed v2 requests, which google-gax silently dropped;
--   * `streamingRecognize` on the v2 client is a v1 wrapper the package patches
--     onto the prototype, which sent a config with no recognizer and treated
--     every request object as raw audio;
--   * and the gateway closed the stream on end-of-turn, discarding the final
--     transcript Google only flushes after the input half-closes.
--
-- Through all four, /health reported speech.available: true, because that flag
-- only ever meant a credential had parsed. It now refuses a region that cannot
-- serve the model, and the proof lives in an endpoint anybody can re-run.
--
-- WHAT IS NOT PROVEN
--
-- Interim results are effectively one, arriving 5.8s into a 6.2s utterance.
-- Georgian text while the speaker is still talking is NOT delivered by chirp_3
-- in this configuration, and the product should not promise it. The final
-- arrives 1.35s after speech ends, which is what the turn actually waits on.
--
-- Scribe stays enabled at priority 5 and serves any turn this route cannot,
-- which is logged as google_stt_unavailable rather than passed over in
-- silence. Cartesia stays at 50, untouched.
update comm_provider_routes
   set enabled     = true,
       kill_switch = false,
       config      = config
         || jsonb_build_object(
              'verified_at', now(),
              'verified_by', 'GET /health/speech-selftest',
              'verified_transcript_overlap', 0.82,
              'interim_caveat', 'chirp_3 returned a single interim at 5.8s of a 6.2s utterance; do not promise live partial text'
            ),
       updated_at  = now()
 where role = 'STT' and provider = 'GOOGLE';
