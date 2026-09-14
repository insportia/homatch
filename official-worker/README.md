# homatch-official-worker

The Verify research worker: one local Playwright Chromium per job, the bundled
Buster human-assist extension loaded into every job, and human CAPTCHA
interaction over screenshot + coordinate action against the exact live page.

## Canonical startup — the only supported path

```
Railway (deploy.startCommand MUST be empty)
  └─ Dockerfile  CMD ["/bin/sh","/app/docker-entrypoint.sh"]
       ├─ container_started / env_surface        (always logged)
       ├─ Xvfb :99 -screen 0 1440x1000x24        (output visible, never /dev/null)
       ├─ bounded readiness wait → xvfb_ready | xvfb_unavailable
       └─ exec node --import tsx src/index.ts    ← Node is PID 1's successor
```

`exec` matters: it is what lets SIGTERM/SIGINT reach Node, so
`installProcessCleanup()` can close Chromium and delete the throwaway profile
directories on shutdown.

### Rules this service has been broken by before

1. **Never set a Railway dashboard Start Command.** A dashboard override takes
   precedence over the image `CMD`. One shadowed this service for its entire
   life (`node scripts/apply-live-browser-patch.mjs --run`, which rewrote
   `src/index.ts` at boot), and a later one (`node scripts/start-production.mjs`)
   crash-looped every container with `Cannot find module` once that file was
   removed from the source. If the dashboard shows a Start Command, clear it.
2. **Never wrap the app in `xvfb-run`.** Its default `ERRORFILE` is
   `/dev/null`, so every `xauth`/`Xvfb` diagnostic is discarded, and it
   installs no TERM/INT trap — a signal sent to it never reaches Node.
3. **Nothing in `scripts/` may be on the startup path**, and no script may
   mutate `src/`. `test/startupIntegrity.test.mjs` enforces both.

## Health

- `GET /health` — reports `browserRuntime: "local-playwright-chromium"`.
- `GET /health/browser` — bounded REAL Chromium smoke test (persistent context,
  bundled extension, service-worker confirmation, page + JS, full teardown).
  Returns sanitized booleans only; never a credential, cookie or profile path.
- `GET /health/browserless` — deprecated alias that runs the same LOCAL check
  and never contacts Browserless.

## Human-assist (Buster)

The bundled Manifest V3 extension in `extensions/human-assist/` is REQUIRED and
tracked. It is configured per job from the environment
(`HUMAN_ASSIST_SPEECH_API_KEY`, `HUMAN_ASSIST_SPEECH_SERVICE`) straight into the
extension's own `chrome.storage.local`; the credential never reaches a log, a
job document, an HTTP response or git. `humanAssistReady` is only true once the
extension's service worker really registered *and* that configuration was read
back successfully.

This worker implements no automated CAPTCHA solving. A human completes any
challenge in the preserved page.

## Georgian speech recognition (`/speech/stream`)

Google's realtime recognition is `StreamingRecognize` — a bidirectional gRPC
stream. Supabase edge functions are Deno over HTTP and a browser is a browser;
neither speaks gRPC, and the REST `:recognize` endpoint is a request-per-chunk
shape nobody should call realtime. So the stream terminates here, and AI TALK's
browser reaches it over a WebSocket carrying the same PCM16 frames it already
captures for its other transcribers.

- **Model** `chirp_3` — the family that both lists Georgian and supports
  streaming. **Language** `ka-GE`, sent as one code: asking for detection
  across several costs accuracy on the one that matters.
- **Credentials** `GOOGLE_SPEECH_CREDENTIALS_JSON`, `GOOGLE_SPEECH_PROJECT_ID`,
  `GOOGLE_SPEECH_REGION`. They never leave this process.
- **This image runs as two Railway services and only one holds them.**
  `GET /health` reports `speech.available` and, when it is false, why. Deployed
  is not the same as able, and the edge function asks before routing anything
  here.

### The grant

AI TALK's visitors are anonymous, so there is no user token to check. The edge
function signs `sessionId.expiryMs` with `WORKER_TOKEN` — which this worker and
that function already share and neither gives to a browser — and the browser
carries only the signature. No database round trip in front of somebody's first
word, no new secret, and a copied grant is worthless within minutes.

Both halves are written in different languages on different machines, so
`test/speechGrant.test.mjs` mints one the way the edge function does, verifies
it the way this worker does, and reads the edge function's source to check the
shape has not drifted.

### Stream lifetime

Google ends a stream at five minutes. This one replaces itself before that,
holding and replaying audio across the swap so a restart is not a swallowed
word. A permission or quota error is reported once and the socket given up: a
recogniser that silently retries looks exactly like one that works.

## Commands

```
npm start          # tsx src/index.ts   (identical to what the container execs)
npm test           # type-check the test build, then run the full suite
npm run test:build # tsc -p tsconfig.test.json
```
