---
description: Release readiness and deployment-truth checklist
---

1. `npm run homatch:release:plan` — tier (TARGETED / COMPONENT_FULL /
   REPO_FULL), components, suites, deploy targets and the production proof
   owed, with every reason. The PR's `PR Checks` run is the one validation
   (it records the validated tree); don't re-run suites locally or after
   merge when that evidence exists. See docs/claude/RELEASE.md.
2. `npm run homatch:scope` — confirm the domain list matches intent and the
   Railway verdict (worker untouched → RAILWAY DEPLOYMENT NOT REQUIRED).
3. `npm run homatch:deploy:scope` — the owed edge-function set for the diff;
   remember the hand-deploy-only pair is excluded by design.
4. After merge, the deploy run's `Release path` job says `FAST|VALIDATE`
   with its evidence. FAST runs no validation job; VALIDATE runs the same
   component plan in parallel before deploying. Then verify
   refs/deployed/* advanced (fresh
   `git fetch origin '+refs/deployed/*:refs/deployed/*'`) and that the edge
   artifact proof reported PROVEN_EXACT. Green steps and green CLIs are not
   proof; see `docs/claude/KNOWN_RISKS.md`.
5. Migrations ship separately: `npm run deploy:status` against the ledger.
6. Merge: when `Validate PR` is green and merging is authorized, merge. If
   this session cannot merge, report READY_FOR_EXTERNAL_MERGE and stop — no
   polling loops waiting for someone else's merge.
