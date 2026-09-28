---
description: Guard-railed workflow for any UI-touching change
---

Before editing UI:

1. `npm run homatch:scope` — note which surfaces the diff (will) touch and
   every protected-surface warning printed.
2. Read `docs/claude/PROTECTED_SURFACES.md` and `docs/claude/UI_CONTRACTS.md`
   sections for those surfaces.
3. Make the change inside the surface's existing design language. No
   cross-surface theme propagation. Terminology and i18n rules from
   CLAUDE.md apply to every visible string (all six locales; AR/HE RTL).
4. Validate: `npm run homatch:check`, then the browser suites
   `homatch:test:affected` recommends. For layout screenshots use
   `reducedMotion:'reduce'` and compare `scrollWidth` vs the box for
   overlap — flex clipping doesn't overlap boxes.
