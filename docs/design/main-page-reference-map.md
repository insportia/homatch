# Main Page — reference → implementation map

The supplied reference image is the source of truth for COMPOSITION.
The Homatch codebase is the source of truth for CONTENT and FUNCTION.

Written before the second visual pass, and implemented from — not improvised
around. Region numbers follow the agreed page chronology, which extends the
reference where the reference had no equivalent region (06–08, 11).

Page grid: `--page` = `max-width: 1440px`, gutters `20px / 32px / 40px`.
Editorial reading columns are narrower than the page (`max-w-[46rem]` for
section intros, `max-w-[34rem]` inside two-column splits).

| # | Reference region | Component | Width | Height | Background | Image behaviour | Typography | CTA | Mobile |
|---|---|---|---|---|---|---|---|---|---|
| 01 | Header bar | `PublicHeader` | full, inner `--page` | 72 / 88px | cream, no border until scrolled | — | logo lockup; nav 14px/ink-soft | ghost Sign in + navy Get started | logo + burger; panel below |
| 02 | Hero split | `HeroSection` + `SceneMedia` | copy 44% / media 56% (media bleeds to viewport edge) | `min-h: clamp(560px, 72vh, 760px)` | cream; media panel | `object-cover`, `object-position: 62% 50%`, rounded bottom-inner 4rem, cream dissolve on inner edge, scrim under pull-quote | eyebrow 11px/.2em gold; h1 `clamp(2.5rem,4.6vw,4.25rem)`; body 16px | navy pill + quiet text-link | media becomes a band under the copy, `object-position: 58% 44%`, 300px tall, rounded bottom 2.5rem |
| 03 | (extends reference) | `PrimaryIntentSection` | `--page` | auto | cream | none | 12px numeral, 24px title | whole module is the control | stacked, hairline between |
| 04 | Homatch AI panel | `AISection` + `HomatchAsk` | full bleed, inner `--page` | auto | **navy** | none | h2 32px on cream ink | navy input on light surface, gold chips | same, tighter |
| 05 | 4 feature cards | `CapabilitiesSection` | `--page` | auto | cream | one editorial figure in the dominant block | dominant 28px + 3 hairline rows | text links | dominant then rows |
| 06 | (extends reference) | `VerificationSection` | full bleed, inner `--page` | auto | warm stone | `detail` scene, 4:5 on desktop | numbered 3-step | navy pill | image first, then steps |
| 07 | (extends reference) | `ProcessSection` | `--page` | auto | cream | none | 5 numbered nodes on a hairline rail | — | vertical rail |
| 08 | (extends reference) | `ResultPreviewSection` | full bleed, inner `--page` | auto | **navy** | none | two illustrative result panels, explicitly labelled | text link | stacked |
| 09 | 3 small cards | `ProfessionalToolsSection` | `--page` | auto | cream | none | hairline rows, 18px titles | row is the control | stacked rows |
| 10 | MORE THAN A PLATFORM | `PlatformStorySection` | `--page` | auto | cream | none | h2 + gold rule + 4 beliefs | outline pill | stacked |
| 11 | (extends reference) | `ClosingCTASection` | full bleed | `clamp(360px, 46vh, 520px)` | `city` scene + navy scrim | `object-cover`, `object-position: 50% 60%` | h2 `clamp(2rem,3.4vw,3rem)` centred | gold pill + quiet outline | same, shorter |
| 12 | Footer | `SiteFooter` | `--page` | auto | cream, hairline top | — | 12px | — | stacked columns |

## Visual rhythm

`cream → cream(hero media) → cream → NAVY → cream → STONE+image → cream → NAVY → cream → cream → IMAGE → cream`

## Card discipline

A bordered surface is used only where it contains a genuine object or
interaction: the AI console, the illustrative result panels, and the
dashboard's data groups. Section intros, capability rows, process nodes,
professional-tool rows and the platform story carry no card — they are
separated by hairlines, background changes and whitespace.

## Dashboard

| Region | Component | Notes |
|---|---|---|
| Rail | `HomatchShell` | unchanged structurally; quieter active state |
| Topbar | `HomatchShell` | greeting-scale search that opens `/ai` |
| Greeting + counts | `DashboardPage` | one grouped surface: headline, sub, and the four counts inline — not four separate cards |
| Primary actions | `DashboardPage` | four large actions in one bordered group split by hairlines |
| Workspace | `DashboardPage` | Matches + Properties in one surface; AI console beside |
| Secondary | `DashboardPage` | Verifications, Mortgage, Activity as one three-up surface |
