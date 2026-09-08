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

## Commands

```
npm start          # tsx src/index.ts   (identical to what the container execs)
npm test           # type-check the test build, then run the full suite
npm run test:build # tsc -p tsconfig.test.json
```
