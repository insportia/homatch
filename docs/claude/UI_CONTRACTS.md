# UI CONTRACTS

Per-surface design contracts. PROTECTED_SURFACES.md says what may change;
this file says what each surface looks like and which primitives it uses.

## Shells

- Public pages: `PublicHeader` + public chrome. Header: desktop nav at `xl`
  (gap-3, labels 13px; 2xl relaxes to gap-4/text-sm, full logo + tagline),
  burger + slide-down panel below `xl`, `HeaderSpacer` h-[8.5rem]/9.5/5.5rem.
  One navigation source: `src/site/publicNav.ts`; header labels read
  Site-Studio overrides via `sf('nav_<key>', fallback)`.
- Authenticated customer pages: the customer `AppLayout`.
- `/admin/*`: the global Admin shell.

## Layout primitives

- Page measure: `hm-measure mx-auto w-full max-w-[var(--hm-measure,90rem)]
  px-5 sm:px-8 lg:px-10` (public pages).
- `.hm-public` white token scope = product ENTRY pages only.
- Global CSS sets `overflow-wrap:break-word`: short labels in squeezed flex
  items (language chips, nav) need `whitespace-nowrap` or they break
  mid-word ("K/A").
- Flex items clip content without box overlap — when checking for overlap,
  compare `scrollWidth` against the box, not boxes against each other.

## Surface palettes

- HOMEPAGE + public marketing: black/gold storytelling (see
  PROTECTED_SURFACES.md).
- OWNER + DISCOVERY (My Properties / Property Detail / Matches / Find
  Property): MIXED system since 2026-09-29 by explicit mandate — the
  `.hm-owner` / `.hm-discovery` scopes carry the customer light tokens,
  each page draws its own navy structural band (PageHero / identity
  strip), and the working surfaces are crisp white. Verify, Contracts and
  Investment (`.hm-invest`) made the same move earlier the same day. The
  only remaining dark instrument-panel scope is `.hm-workspace` (Expats
  bands). Guarded by tests/matrix/surfaceScopes.test.mjs and
  legacyPaleGuard.test.mjs.
- VERIFY: report-first, deterministic content; no decorative rework.
- Entry pages (`/for-buyers`, `/for-owners`, product entry): `.hm-public`
  white scope.

## Motion and QA

- Below-fold sections mount inside `Reveal`; full-page layout screenshots
  need `reducedMotion:'reduce'` in the browser context or everything below
  the hero is blank.
- Visual QA baseline: 1440/1280/1024 (ka, ru) and 320/360/390/430 (ka),
  plus 390 in ar/he including the open mobile menu.

## i18n

- Single bundle `src/i18n/translations.ts` (en complete; ka/ru/tr/ar/he
  overrides). Extend via the idempotent `scripts/*-i18n-apply.mjs` pattern,
  never hand-splicing. Placeholders are `{{var}}` and must survive every
  locale (`tests/matrix/placeholderParity.test.mjs`).
- Keep `scripts/public-site-i18n-data.mjs` in sync with bundle changes to
  public-site keys.
