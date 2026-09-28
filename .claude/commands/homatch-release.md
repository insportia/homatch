---
description: Release readiness and deployment-truth checklist
---

1. `npm run homatch:check:full` — the release gate. The affected-test subset
   never substitutes for it.
2. `npm run homatch:scope` — confirm the domain list matches intent and the
   Railway verdict (worker untouched → RAILWAY DEPLOYMENT NOT REQUIRED).
3. `npm run homatch:deploy:scope` — the owed edge-function set for the diff;
   remember the hand-deploy-only pair is excluded by design.
4. After CI: verify refs/deployed/* advanced (fresh
   `git fetch origin '+refs/deployed/*:refs/deployed/*'`) and that the edge
   artifact proof reported PROVEN_EXACT. Green steps and green CLIs are not
   proof; see `docs/claude/KNOWN_RISKS.md`.
5. Migrations ship separately: `npm run deploy:status` against the ledger.
