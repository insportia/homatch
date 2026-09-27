# Public route map

Audit of every destination reachable from the public Homepage (header, mobile
menu, homepage sections, footer), done for the 2026-09 public-site redesign.

- **Navigation source:** `src/site/publicNav.ts` (one list for every public page), rendered by
  `src/components/home/PublicHeader.tsx`.
- **Homepage sections:** `src/components/home/sections/`, running order in `src/site/render/order.ts`.
- **Product entry logic:** `src/site/productEntry.ts`. It decides where a signed-out visitor goes for
  the two authenticated products, and brings them back after sign-up.
- **Guards:** `tests/matrix/publicSite.test.mjs` and `tests/matrix/publicNav.test.mjs`.

## Classification

| Class | Meaning |
|---|---|
| KEEP | Finished public page; linked as is |
| UPDATE | Changed in this workstream (destination, chrome or page) |
| LEGACY | Works, but its design predates the public system; recorded, not rebuilt here |
| MISSING | Was needed and did not exist; created here |
| PROTECTED | Owned elsewhere / must not be modified here; linked only |

## Header and mobile menu

| Item | Destination (signed out → signed in) | Implementation | Change made | Visual | Functional | Class |
|---|---|---|---|---|---|---|
| Logo | `/` | `HomePage` | Real `<Link>` | OK | OK | KEEP |
| Find a property | `/for-buyers` → `/find-property` | `ProductEntryPage` / `FindPropertyPage` (RouteGuard) | Was `/ai`: an anonymous chat, not Find Property. Now a public entry page with sign-up that returns to `/find-property`. | OK | OK | UPDATE |
| Find a buyer or tenant | `/for-owners` → `/property` | `ProductEntryPage` / `MyPropertiesPage` (RouteGuard) | Was `/property/add`, which bounced to login without explanation. Now a public entry page; sign-up returns to `/property/add`. | OK | OK | UPDATE |
| Verify | `/verify` | `VerifyPage` | Link only | Unchanged | OK | PROTECTED |
| Services ▸ How matching works | `/#intelligence` (in-page on `/`) | `IntelligenceLayersSection` | Section rebuilt: two demand sources → match → decision | OK | OK | UPDATE |
| Services ▸ Mortgage | `/mortgage` | `MortgagePage` in `AppLayout` | Signed-out chrome is now the public header and footer | OK (body dark, owned by product) | OK | UPDATE (chrome only) |
| Services ▸ Investment | `/investment` | `InvestmentPage` in `AppLayout` | Same chrome change | OK | OK | UPDATE (chrome only) |
| Services ▸ For expats | `/for-expats/georgia` | `ForExpatsPage` | None; it already used the public header | OK | OK | KEEP |
| More ▸ Brokers | `/brokers` | `BrokersPage` (other workstream) | Added to the navigation. Signed-out chrome now uses the public header (layout-level); page body untouched | OK | OK | PROTECTED (body) |
| More ▸ For developers | `/developers` | `DevelopersPage` (Site Studio sections) | `hm-public` scope; closing panel is the new one | Hero still the dark `dev_hero` | OK | LEGACY |
| More ▸ Partners | `/partners` | `PartnersPage` | `hm-public` scope; inquiry form labels, names, 44px controls, 16px text | Card layout predates the system | OK | LEGACY (a11y fixed) |
| More ▸ About | `/about` | `AboutPage` (Site Studio sections) | `hm-public` scope | Sections predate the system | OK | LEGACY |
| More ▸ Pricing | `/pricing` | `PricingPage` | `hm-public` scope, public header | OK | OK | UPDATE (chrome) |
| Log in | `/auth/login` | `LoginPage` | Label now editable (`cta_login`) | OK | OK | KEEP |
| Create account | `/auth/signup` | `SignupPage` | Label now editable (`cta_signup`) | OK | OK | KEEP |
| Dashboard (signed in) | `/dashboard` | `DashboardPage` | Not changed | n/a | OK | PROTECTED |
| Profile (signed in, menu) | `/profile` | `ProfilePage` | Added to the mobile menu's account area | n/a | OK | KEEP |
| Language | in place | `LanguageSwitcher` / menu `LanguageGrid` | Six-button grid in the menu (no nested dropdown inside the dialog) | OK | OK | UPDATE |
| Install app | browser | `InstallApp` | Mobile menu; on desktop moved to the footer's utility row (the header row did not fit) | OK | OK | UPDATE |

## Homepage sections and their CTAs

Section order: hero, action_launcher, intelligence_layers, verify, contract_intelligence, matching,
mortgage, developers, closing_cta. This matches the relative order production's stored `home` page
already has, because the stored page decides the order.

| Section / CTA | Destination | Change | Visual | Functional | Class |
|---|---|---|---|---|---|
| Hero: Find a property | product entry (see above) | New light hero; `openProduct` picks the destination by auth state | OK | OK | UPDATE |
| Hero: Find a buyer or tenant | product entry | as above | OK | OK | UPDATE |
| Hero: AI Talk | in place | Container only, as a dark stage beside the copy. Voice logic untouched. | OK | Unchanged | PROTECTED |
| Paths: owner card CTA | product entry (`find_client`) | New | OK | OK | UPDATE |
| Paths: buyer card CTA | product entry (`find_property`) | New | OK | OK | UPDATE |
| Paths: Verify / Mortgage / Investment / For expats / Brokers | public pages | New index. All five open without an account. | OK | OK | UPDATE |
| How matching works | none (explanation) | Rebuilt | OK | n/a | UPDATE |
| Verify: cadastral code form | `/verify?code=…` | Moved here from the old launcher. Never goes through sign-up (the old `gated()` sent signed-out visitors to `/auth/signup` although Verify is public). | OK | OK | UPDATE |
| Contracts: Upload a contract | `/contracts`; signed out → sign-up → back to `/contracts` | Was `/verify` or `/auth/signup` (then dashboard) | OK | OK | UPDATE |
| Matching: List a property | product entry (`find_client`) | Restyled; the match card is structure only | OK | OK | UPDATE |
| Money: Mortgage / Investment | `/mortgage`, `/investment` | New two-card section. The old "scenario" panel of fake bars is gone. | OK | OK | UPDATE |
| Professionals: Brokers / Developers / Partners | `/brokers`, `/developers`, `/partners` | New (replaces the developer pipeline diagram) | OK | OK | UPDATE |
| Close: Create account / Open Verify / See pricing | `/auth/signup` (signed in: `/dashboard`), `/verify`, `/pricing` | New contained panel. The credit rate is the one PricingPage states. | OK | OK | UPDATE |
| AI Call Center, Email campaigns, "Homatch AI" regions | n/a | Retired from the homepage and unregistered, so `normalizePage` drops them from stored pages. They are signed-in tools, and every CTA in them was a sign-up bounce for visitors. | n/a | n/a | UPDATE (removed) |

## Footer

| Link | Destination | Class |
|---|---|---|
| Find a property / Find a buyer or tenant | product entry (auth-aware) | UPDATE |
| Verify, Mortgage, Investment, For expats | public pages | KEEP |
| Contract Intelligence | `/contracts` via sign-up with return path | UPDATE |
| Brokers, Developers, Partners, About, Pricing | public pages | UPDATE (Brokers, Pricing added) |
| Privacy, Terms | public pages | KEEP |
| AI Chat, AI Call Center, Email campaigns | removed. Each was an `/auth/signup` bounce. | UPDATE (removed) |

## Counts

| Class | Count |
|---|---|
| KEEP | 7 |
| UPDATE | 25 (8 header/menu, 13 homepage, 4 footer) |
| LEGACY | 3 (About sections, Developers landing hero, Partners layout) |
| MISSING, created here | 2 (`/for-buyers`, `/for-owners`) |
| PROTECTED | 4 (Verify, Brokers page body, AI Talk voice logic, Dashboard) |

**Signed-out authenticated dead ends presented as public destinations: 0.** Every item above opens
one of three things: a public page; a public entry page whose sign-up returns to the product; or,
for Contracts, sign-up with a return path.

## Decisions recorded

- **`/verify` keeps `AppHeader` for signed-out visitors.** `AppLayout` now renders the public
  header and footer for signed-out visitors on its public pages (Mortgage, Investment, Brokers and
  the 404). `/verify` and `/verify/*` are excluded because Verify's UI is protected. Full-height
  screens (`hidePadding`, e.g. `/ai`) are also excluded: they size themselves around a 64px bar and
  cannot fit a footer.
- **`PUBLIC_ROUTES` (src/site/registry.ts)** now lists only routes that are `public: true`.
  Signed-in destinations a site page may still link to are in `SIGNED_IN_ROUTES`. The Site Studio
  link checker accepts both, so the checker behaves the same as before.
- **Desktop navigation starts at 1280px (`xl`).** Below that width the menu sheet is used. The Site
  Studio desktop preview's minimum viewport moved from 1024 to 1280 to match, and the scaled frame
  now takes up its scaled size, so the pane no longer scrolls sideways.
- **Production content.** The stored `home` page has a Georgian override of the hero `body` field
  ("შეამოწმე, შეაფასე, … შეადარე …"). It still renders, because the stored copy is the admin's
  content. It mentions comparing ("შეადარე"), and Homatch has no comparison feature, so an editor
  should review it.
