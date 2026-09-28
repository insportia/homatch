---
description: Guard-railed workflow for schema/migration work
---

1. Schema truth is the repo: `docs/claude/generated/DB_MIGRATIONS.md`, then
   the specific migration SQL. Query production only when live state matters.
2. New migrations: append-only, 14-digit `YYYYMMDDHHMMSS_lower_snake.sql`,
   NO top-level begin/commit (the runner owns the transaction), RLS and
   grants explicit (see `tests/matrix/functionGrants.test.mjs`).
3. Money-adjacent tables: read `docs/claude/BILLING.md` first.
4. Validate locally: `npm run homatch:migrations`, then
   `npm run homatch:test:affected --run`.
5. Remember: pushing to main does NOT apply migrations; production
   application is a deliberate, ordered, separately-verified step
   (`npm run deploy:status`). Never edit an applied migration.
