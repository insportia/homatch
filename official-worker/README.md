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

## Speech recognition configuration, as deployed

One documented behaviour, because the alternative was three contradictory
sentences in three reports.

| Setting | Production value | Where it is set |
|---|---|---|
| API | Google Speech-to-Text **v2** (`v2.SpeechClient`, never the package root) | code |
| Recognizer | `projects/<project>/locations/eu/recognizers/_` | `GOOGLE_SPEECH_PROJECT_ID`, `GOOGLE_SPEECH_REGION=eu` |
| Model | `chirp_3` | `GOOGLE_SPEECH_MODEL` (default) |
| Audio | LINEAR16, 16 000 Hz, mono, explicit decoding | code |
| `languageCodes` | **exactly one**: the language the session settled on, sent by the browser as `?language=`; `ka-GE` when none is settled | gateway query + `GOOGLE_SPEECH_LANGUAGE` |
| Automatic detection | **off** (`GOOGLE_SPEECH_MULTILANG=0`) | Railway variable |
| Client hints | `?languages=` is accepted, validated and **ignored by the recogniser** while auto is off; it only bounds what the session will resolve to | gateway |
| Page locale | seeds the session language before anybody has spoken; nothing else | browser |
| Fallback | Scribe (ElevenLabs STT, route priority 5) when this gateway is unavailable — logged as `google_stt_unavailable`, never silent | edge route table |

### What a quiet stream costs, and why the browser sends silence

Measured against this deployment, not inferred. A probe streamed Georgian and
then sent nothing at all — which is exactly what the browser used to do while
the assistant was speaking, because the microphone is gated so the reply is
not transcribed as if the visitor had said it. After roughly nine seconds:

```
code 10  "Stream timed out after receiving no more client requests."
```

Code 10 was not in the retryable set, so the gateway reported `unavailable`
and closed 1011. An ordinary reply is longer than nine seconds, so the
recognition stream was routinely being torn down mid-conversation and the
visitor's next sentence had nothing listening to it. This is the actual reason
a short Georgian acknowledgement after a longer answer "was not heard": not
recognition, which transcribes `კი` correctly every time, but a dead stream.

Two changes, belt and braces:

- The browser sends a tenth of a second of **silence every three seconds while
  gated** (`googleTranscribe.ts`). Microphone audio is still dropped, so echo
  protection is unchanged; silence carries nothing to transcribe and produces
  no interim, no final and no turn. It only keeps the socket open.
- Code 10 is now **retryable**, so a stream that ends because it went quiet is
  reopened rather than ending the conversation.

### Short Georgian utterances, measured

Eleven clips streamed through this gateway, `chirp_3`, `ka-GE`, region `eu`:

| said | length | final | finalised by | ms after speech |
|---|---|---|---|---|
| კი | 0.88s | კი | endpointer | 2119 |
| არა | 0.33s | არა | **half-close only** | 5604 |
| დიახ | 0.79s | დიახ. | endpointer | 2308 |
| კარგი | 0.65s | კარგი | endpointer | 2261 |
| ჰო | 0.51s | **ხო** | endpointer | 1901 |
| არა, მადლობა | 1.76s | არა, მადლობა. | endpointer | 1685 |
| კი, მაინტერესებს | 1.21s | კი, მაინტერესებს. | endpointer | 1348 |
| გასაგებია | 0.79s | გასაგებია. | endpointer | 2537 |
| მაჩვენე | 1.11s | მაჩვენე. | endpointer | 2302 |
| გააგრძელე | 0.88s | გააგრძელე. | endpointer | 2936 |
| გამარჯობა, ვაკეში ბინა მაინტერესებს. | 2.83s | exact | endpointer | 1358 |

Eleven of eleven recognised, eleven of eleven resolved `ka-GE`. One
substitution (`ჰო` → `ხო`). **Recognition is not the problem.** What the table
shows instead is that a final lands 1.3–2.9 seconds after the speaker stops —
long enough to arrive after the next turn has already begun, which is why the
browser now holds such a final rather than discarding it — and that the
shortest clip never endpointed at all and came back only on the half-close.

Interim results are enabled and do work, but they are late and sparse: the
self-test measures one interim at 5797ms on a 7.3-second clip. Utterances
shorter than that finish before an interim is ever due, which is why short
Georgian shows no on-screen text until the final arrives.

Why auto is off: `chirp_3` refuses an explicit list of languages
(`INVALID_ARGUMENT`), and the single code `auto` it does accept is not scoped
to this product's languages. It is scoped to every language Google supports,
and fed short Georgian it returned Korean, Luxembourgish, Hausa and
Lithuanian — transcript and all. Recognition therefore runs on one language
per session, which is deterministic. `/health/speech-languages` re-runs the
measurement that established this.
