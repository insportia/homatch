---
description: Release readiness and deployment-truth checklist
---

1. `npm run homatch:release:plan` — FULL or TARGETED, with every reason.
   The PR's `PR Checks` run is the one full validation (it records the
   validated tree); don't re-run the full gate locally or after merge when
   that evidence exists. `npm run homatch:check:full` is the same gate
   locally, for diagnosis or when CI cannot run. See docs/claude/RELEASE.md.
2. `npm run homatch:scope` — confirm the domain list matches intent and the
   Railway verdict (worker untouched → RAILWAY DEPLOYMENT NOT REQUIRED).
3. `npm run homatch:deploy:scope` — the owed edge-function set for the diff;
   remember the hand-deploy-only pair is excluded by design.
4. After merge, the deploy run's first step says `RELEASE PATH: FAST|FULL`
   with its evidence. FAST skips only repository suites; then verify
   refs/deployed/* advanced (fresh
   `git fetch origin '+refs/deployed/*:refs/deployed/*'`) and that the edge
   artifact proof reported PROVEN_EXACT. Green steps and green CLIs are not
   proof; see `docs/claude/KNOWN_RISKS.md`.
5. Migrations ship separately: `npm run deploy:status` against the ledger.
