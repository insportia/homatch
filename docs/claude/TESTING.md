# TESTING

## Tiers

1. **Iteration** — `npm run homatch:check`
   (tsgo typecheck + i18n:check/keys + affected unit tests via
   `homatch:test:affected --run`). Fast; scoped to the diff's domains.
2. **Release truth** — `npm run homatch:check:full`
   (typecheck, lint, i18n:all, full unit run, browser acceptance matrix,
   studio, a11y). This — not the affected subset — decides readiness.
3. **Deploy-time** — the pipeline's own gates in
   `.github/workflows/deploy.yml`: scope accounting (owed == attempted) and
   exact eszip artifact proof. A green CLI deploy is NOT proof; the artifact
   check is.

## Suites

- `npm test` → `scripts/run-tests.mjs`: every `*.test.mjs` under `src`,
  `tests/matrix`, `tests/browser` (non-browser pair), `tests/developer`,
  `supabase/functions` (~372 files / ~5,970 tests).
- `tests/matrix/` — source-level guards (37+ files): they parse sources with
  regexes; when an implementation legitimately changes shape, fix the test's
  premise, don't weaken its assertion.
- `npm run test:matrix` → `scripts/run-full-matrix.mjs`: builds the harness
  itself (a stale `dist/` produces false passes), then runs the mobile
  acceptance set at 4 widths × 6 locales.
- `npm run test:studio`, `test:a11y`, `test:push`, `test:pwa`, browser
  suites: need the harness build + Chromium.

## Harness environment

- Chromium: `PLAYWRIGHT_CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
  (pre-installed; never `playwright install`).
- `.env.harness` points the build at the stub project; `npm run
  build:harness`; servers on ports 4331/4337/….
- Layout screenshots: create contexts with `reducedMotion:'reduce'` or
  `Reveal` keeps below-fold sections invisible.
- Measurement gotcha: flex-shrunk buttons clip text without box overlap —
  compare `scrollWidth` vs the box.

## Tooling self-tests

`tests/matrix/claudeTooling.test.mjs` covers the engineering-layer scripts
(domain classification, deploy-mode parsing, migration hygiene, generated-map
determinism, Railway canonical-worker guard). It runs inside `npm test`.
