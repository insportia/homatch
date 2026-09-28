# PROTECTED SURFACES

These surfaces have standing protection. "Protected" means: functional fixes,
accessibility, responsiveness, and factual corrections are welcome; redesigns,
identity changes, and architecture swaps require an explicit instruction that
names the surface.

## VERIFY (`/verify/:id`, `src/verify/`, research edge functions)

The deterministic verification product: report parsing/validation/synthesis in
`src/verify/intelligence/`, rendered by `src/pages/VerifyPage.tsx` and
`ContractResultPage`. Do not redesign it, change its behavior, or alter its
intelligence architecture without explicit instruction. Its outputs are
customer-facing claims about real property; correctness beats style.

## PUBLIC HOMEPAGE (black/gold identity)

The live homatch.live visual identity is the canonical baseline: dark hero
atmosphere, gold accents, the AI TALK panel presentation, the storytelling
section rhythm (dark/light alternation), `src/components/home/sections/*`.
Navigation, a11y, RTL, responsive, and factual-copy fixes are allowed and
expected. A visual replacement is not. `.hm-public` (white entry-page tokens)
is scoped to product entry pages only — never apply it to `HomePage`.

## ADMIN (global shell)

One Admin app under `/admin/*` behind the existing protected global shell.
Extend it; never build a second admin surface or a parallel shell.

## OWNER (property management)

Full dark-navy product design (`src/pages/property/`,
`src/components/property/`). Keep the established contract; no light-theme
bleed-through.

## DISCOVERY (Matches / Find Property)

Dark discovery contract (`src/components/matching/`, `FindPropertyPage`,
`ActiveSearchPage`). Match presentation language is deterministic and tested —
see `tests/matrix/matchPresentation.test.mjs`.

## Cross-surface rule

Themes never propagate across surfaces. A change to one surface's tokens,
layout primitives, or shells must not leak into another; the matrix tests
guard several of these seams — run `npm run homatch:scope` to see which
surfaces a diff touches.

## Terminology and claims (all surfaces)

- Match = დამთხვევა / plural დამთხვევები. Never შესატყვისი.
- Tenant = მოიჯარე. City spelled თბილისი.
- Never claim a "confirmed buyer"; the honest term is a "potentially
  interested person". External signals are never presented as HOMATCH users.
- Languages: KA/EN/RU/AR/HE/TR; AR and HE are RTL. UI language, campaign
  search language, and detected source language are three different things.
