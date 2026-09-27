// WHICH SURFACES MAY BE MIGRATED, AND WHICH MAY NOT BE TOUCHED.
//
// 151 routes: 21 public, 62 customer, 45 admin, 23 developer. A design migration
// across that many screens is not a task, it is a way to break a working product — so
// this file exists to make the decision explicit BEFORE anything is rewritten, and to
// make "we migrated the wrong screen" a test failure rather than a discovery.
//
// FOUR STATUSES, AND ONLY TWO OF THEM ARE PERMISSION
//
//   PROTECTED               must not change. The main dashboard, Verify, and the
//                           admin shell. Named here so a migration wave cannot sweep
//                           them up, and asserted by a test.
//   APPROVED_CURRENT_DESIGN already built to the approved product model. Left alone
//                           because it is already right, not because it is finished.
//   LEGACY_DESIGN           predates the approved model. May be migrated.
//   NEEDS_MIGRATION         actively inconsistent enough to hurt. Migrate first.
//
// Anything not in this file is UNCLASSIFIED, which is not a status — it is a gap, and
// surfaceAudit.test.mjs fails on it. That is the point: a route added without a
// decision about its design is a route that will be migrated by accident or missed
// entirely.
//
// WHAT "CUSTOMER-CRITICAL" MEANS HERE
//
// A separate axis from design status, because it drives a different thing: the
// mobile/RTL matrix. Four widths across six locales is 24 renders per surface, so the
// matrix covers the surfaces where a layout failure costs money or trust, not all 83.
//
// The four that qualify unconditionally: where money changes hands, where a customer
// states what they want, where they read what we found, and the shell that carries
// every one of them.
//
// INVESTMENT IS THE BENCHMARK, NOT A LICENCE
//
// /investment is the approved visual and product model. It is a reference for LEGACY
// surfaces and explicitly NOT permission to restyle a PROTECTED one.

export type DesignStatus =
  | 'PROTECTED'
  | 'APPROVED_CURRENT_DESIGN'
  | 'LEGACY_DESIGN'
  | 'NEEDS_MIGRATION';

export interface SurfaceRecord {
  path: string;
  name: string;
  status: DesignStatus;
  /**
   * Whether a layout failure here costs money or trust.
   *
   * Drives the mobile/RTL matrix, not the migration order. A surface can be
   * customer-critical and already approved (nothing to migrate, still measured every
   * run) or legacy and not critical (migrate eventually, measure at 320 only).
   */
  customerCritical: boolean;
  /** Why it has this status. Never "TODO" and never blank. */
  note: string;
}

export const SURFACES: readonly SurfaceRecord[] = [
  /* ── PROTECTED ─────────────────────────────────────────────────────────── */
  {
    path: '/dashboard',
    name: 'Dashboard',
    status: 'PROTECTED',
    customerCritical: true,
    note: 'MAIN DASHBOARD. Explicitly protected: not to be changed by any migration '
      + 'wave. Measured in the mobile matrix because it must keep working, never '
      + 'restyled.',
  },
  {
    path: '/verify',
    name: 'Verification Center',
    status: 'PROTECTED',
    customerCritical: true,
    note: 'VERIFY is frozen: product behaviour, UI and intelligence all unchanged. The '
      + 'stable contract the rest of the system is allowed to depend on.',
  },
  {
    path: '/verify/history',
    name: 'Verification History',
    status: 'PROTECTED',
    customerCritical: false,
    note: 'Part of the frozen Verify product. Not customer-critical for the mobile '
      + 'matrix because it is a list of past cases rather than a surface where a '
      + 'decision or a payment happens -- the case detail is where both occur.',
  },
  {
    path: '/verify/:id',
    name: 'Verification Case',
    status: 'PROTECTED',
    customerCritical: true,
    note: 'Part of the frozen Verify product, and where a customer reads a paid result.',
  },

  /* ── APPROVED CURRENT DESIGN ────────────────────────────────────────────── */
  {
    path: '/investment',
    name: 'Investment Intelligence',
    status: 'APPROVED_CURRENT_DESIGN',
    customerCritical: true,
    note: 'THE BENCHMARK. The approved visual and product model that legacy customer '
      + 'surfaces are migrated TOWARDS. Being the reference does not make it a licence '
      + 'to restyle anything protected.',
  },
  {
    path: '/for-expats/georgia',
    name: 'For Expats',
    status: 'APPROVED_CURRENT_DESIGN',
    customerCritical: true,
    note: 'Built to the approved model, and the one product written for people who will '
      + 'read it in Arabic and Hebrew -- so it stays in the RTL matrix permanently.',
  },
  {
    path: '/mortgage',
    name: 'Mortgage',
    status: 'APPROVED_CURRENT_DESIGN',
    customerCritical: true,
    note: 'Built to the approved model. States a price to a customer, so a layout '
      + 'failure here is a trust failure.',
  },
  {
    path: '/pricing',
    name: 'Pricing',
    status: 'APPROVED_CURRENT_DESIGN',
    customerCritical: true,
    note: 'Where a customer decides to pay. Long Russian plan names and Georgian '
      + 'feature rows are the overflow risk.',
  },

  /* ── NEEDS MIGRATION ───────────────────────────────────────────────────── */
  {
    path: '/property/:id/matches',
    name: 'Property Matches',
    status: 'APPROVED_CURRENT_DESIGN',
    customerCritical: true,
    note: 'THE ONLY SCREEN WHERE MONEY CHANGES HANDS, and the result card has now been rebuilt around relevance rather than around a lock. LockedMatchCard is MatchCard; why-this-matches leads it (match_reasons was stored since matching was built and rendered only inside the post-unlock dialog, so the explanation of relevance sat behind the paywall); mismatch_reasons is shown, having been stored and rendered nowhere at all; then the comparison, the evidence, provenance quietly, then the action. forSale = !included && !opened is derived once and every padlock, blur and price keys off it, which is strictly stronger than the two included-ternaries it replaced -- those still showed a padlock on an already-opened match. The server-side redaction underneath is unchanged and still proven by tests/matrix/unlockBoundary. SCOPE, stated plainly: the RESULT CARD is the approved design. The campaign controls above the list keep their existing treatment, and Expand Search is deliberately untouched because it is a genuine PAYG continuation rather than a second sale of an included result.',  },
  {
    path: '/active-search',
    name: 'Active Search',
    status: 'NEEDS_MIGRATION',
    customerCritical: false,
    note: 'DEFERRED 2026-09-26 and hidden behind FEATURES.activeSearchUi. It asked a '
      + 'customer to understand and switch on an abstract mode before anything would '
      + 'happen; buyer and tenant discovery is contextual to a property now. The route '
      + 'still exists and redirects to the owner workspace so old bookmarks land '
      + 'somewhere true, and the page component is kept on disk because this is a '
      + 'deferral rather than a deletion. NOT customer-critical any more, and '
      + 'deliberately OUT of the mobile matrix: what renders there is a redirect, and a '
      + 'redirect must never be counted as coverage of the screen it replaced. Still '
      + 'NEEDS_MIGRATION because returning it means redesigning it. The engine beneath '
      + 'it never stopped -- active_search_subscriptions is the table find-property '
      + 'reads to return a customer their own matches.',
  },
  {
    path: '/ai',
    name: 'AI Assistant',
    status: 'NEEDS_MIGRATION',
    customerCritical: true,
    note: 'Homatch AI is the planner that turns a described need into a structured '
      + 'search plan. Needs the mobile-first composer: keyboard-safe, safe-area aware, '
      + 'multiline, RTL, no layout jump and no fake AI state.',
  },

  /* ── LEGACY DESIGN ─────────────────────────────────────────────────────── */
  {
    path: '/property/:id',
    name: 'Property Detail',
    status: 'LEGACY_DESIGN',
    customerCritical: true,
    note: 'Predates the approved model. Customer-critical because it is what a match '
      + 'links to -- a broken layout here breaks the destination of every result '
      + 'the product produces.',
  },
  {
    path: '/credits',
    name: 'Credits',
    status: 'LEGACY_DESIGN',
    customerCritical: true,
    note: 'Predates the approved model. Shows a balance in the currency the product '
      + 'charges in, so it is measured every run.',
  },
  {
    path: '/property/add',
    name: 'Add Property',
    status: 'LEGACY_DESIGN',
    customerCritical: true,
    note: 'Predates the approved model. The seller intake, and the start of every '
      + 'FIND BUYERS campaign.',
  },
  {
    path: '/activity',
    name: 'Activity',
    status: 'LEGACY_DESIGN',
    customerCritical: false,
    note: 'Predates the approved model. A log rather than a decision surface: useful '
      + 'for understanding what happened, never the place a customer chooses '
      + 'anything, so it is not in the mobile matrix.',
  },
  {
    path: '/notifications',
    name: 'Notifications',
    status: 'LEGACY_DESIGN',
    customerCritical: false,
    note: 'Predates the approved model. A notification list, so its migration is a '
      + 'styling pass rather than a product change -- nothing here is a decision '
      + 'surface.',
  },
  {
    path: '/profile',
    name: 'Profile',
    status: 'LEGACY_DESIGN',
    customerCritical: false,
    note: 'Predates the approved model. Account settings rather than product, so it '
      + 'carries no intent, no money and no results -- migrated late, and nothing '
      + 'depends on it being migrated first.',
  },
  {
    path: '/viewings',
    name: 'Viewings',
    status: 'LEGACY_DESIGN',
    customerCritical: false,
    note: 'Predates the approved model. A scheduling list; its migration is a styling '
      + 'pass, and no result or payment is presented on it.',
  },
  {
    path: '/',
    name: 'Home',
    status: 'APPROVED_CURRENT_DESIGN',
    customerCritical: true,
    note: 'The first thing anybody sees, in six languages. Rebuilt 2026-09 on its own '
      + 'public scope (.hm-public), with every control routed to a finished page -- see '
      + 'docs/PUBLIC_ROUTE_MAP.md. Still customer-critical: a home page regression breaks '
      + 'every entry point at once.',
  },
  {
    path: '/for-buyers',
    name: 'For buyers and tenants',
    status: 'APPROVED_CURRENT_DESIGN',
    customerCritical: false,
    note: 'The public front door of Find Property, which is authenticated. Exists so the '
      + 'navigation never sends a visitor with no account to a login bounce.',
  },
  {
    path: '/for-owners',
    name: 'For owners',
    status: 'APPROVED_CURRENT_DESIGN',
    customerCritical: false,
    note: 'The public front door of the owner workspace (/property), which is '
      + 'authenticated. Sign-up from here returns to /property/add.',
  },
  {
    path: '/property',
    name: 'My Properties',
    status: 'APPROVED_CURRENT_DESIGN',
    customerCritical: true,
    note: 'Built new, because the audit found no route answered "what have I got?". The '
      + 'product could create a property four ways and show one at /property/:id, so an '
      + 'owner with six listings had six bookmarks and adding a property was a one-way '
      + 'trip. Cards rather than a table: the functional reference is a listing manager '
      + 'and those are tables because they were designed for a desk, but a property is a '
      + 'photograph, a price and a place, and at 320px a table is a horizontal scroll '
      + 'with the actions off-screen. Customer-critical: this is where a listing is '
      + 'paused, archived and deleted, and a mis-hit destructive action is not '
      + 'recoverable by the customer.',
  },
  {
    path: '/property/create',
    name: 'Create Listing',
    status: 'APPROVED_CURRENT_DESIGN',
    customerCritical: true,
    note: 'THE ONE SCREEN WHERE SOMEBODY TYPES A PROPERTY. It rendered plain AppLayout on '
      + 'the root light palette, so an owner stepped from the dark navy chooser at '
      + '/property/add into a light form mid-flow -- the only light screen in the owner '
      + 'product. It now wears OWNER_SURFACE like the portfolio, the chooser and Edit '
      + 'Property, its step card is an hm-owner-panel, and its select lists carry the '
      + 'owner scope into their portal so an opened dropdown is not a light fragment. '
      + 'The form logic is unchanged, the contact phone included. Measured at four '
      + 'widths in six locales; it passes because its inputs are full-width and its '
      + 'labels are short, so a long Georgian label is still the thing to watch.',
  },
  {
    path: '/property/import',
    name: 'Import Property',
    status: 'APPROVED_CURRENT_DESIGN',
    customerCritical: true,
    note: 'The other half of Owner Add, and it had the same defect as /property/create: '
      + 'plain AppLayout, so the import step and its review were light inside the dark '
      + 'owner flow. Now on OWNER_SURFACE with owner panels; the extraction pipeline, '
      + 'the review form and the required contact phone are unchanged. Customer-critical '
      + 'because the review step is where extracted facts are confirmed before a '
      + 'listing exists, and a clipped field there is a wrong fact saved.',
  },
  {
    path: '/property/:id/edit',
    name: 'Edit Property',
    status: 'APPROVED_CURRENT_DESIGN',
    customerCritical: true,
    note: 'Built new alongside My Properties. property_facts has forty columns, so this '
      + 'is five collapsible sections rather than one scroll -- basics and price open on '
      + 'arrival because they are what changes, the rest closed, and the deep-linked one '
      + 'open regardless so the portfolio menu can land on Photos. Price per square '
      + 'metre is derived and displayed and has no field, because a third number is a '
      + 'way to contradict the other two. An imported property says in words that '
      + 'editing changes the Homatch copy and not the source page, and its provenance '
      + 'fields are read-only rather than hidden. Customer-critical because it is where '
      + 'price and address visibility are set.',
  },
  {
    path: '/find-property',
    name: 'Find Property',
    status: 'APPROVED_CURRENT_DESIGN',
    customerCritical: true,
    note: 'Built new. The audit found that the "I want to find a property" card on the '
      + 'dashboard navigated to /ai with a prompt -- it handed the customer to the chat '
      + 'assistant and hoped -- and that the find-property edge function, which returns '
      + 'a customer their own results, was called by nothing at all. So there was no '
      + 'legacy design to migrate and nothing was overwritten. Customer-critical '
      + 'because the plan step is where REQUIRED, PREFERRED and FLEXIBLE are shown and '
      + 'corrected: a width that clips a strength control turns "would prefer Vake" '
      + 'into "must be Vake" and silently narrows somebody\'s search.',
  },
  {
    path: '/brokers',
    name: 'Brokers',
    status: 'APPROVED_CURRENT_DESIGN',
    customerCritical: true,
    note: 'THIS WAS CLASSIFIED APPROVED AND WAS NOT. The first build rendered shadcn Card '
      + 'and Badge on the root palette in a 672px column, had no search or filter, and '
      + 'ended in "get in touch" with nothing to get in touch through -- by this file\'s '
      + 'own definitions that is NEEDS_MIGRATION, and the broker audit '
      + '(docs/BROKER_PRODUCT.md) recorded it as such. Rebuilt on PRODUCT_SURFACE '
      + '(.hm-product, its own product ground, not the shell\'s .hm-customer): '
      + 'market/language/type filters over the columns broker_directory_public exposes, '
      + 'contact actions only as the listing supplies them, a dignified empty state, and '
      + 'a real application through broker_directory_apply, which can only create a '
      + 'PENDING_REVIEW row. Still reads the paid view and never broker_intelligence. '
      + 'Customer-critical because its whole purpose is a claim a customer would act on '
      + '-- whether a firm is listed with Homatch or merely observed -- and a layout that '
      + 'truncates the observed label into the listed one costs exactly that trust.',
  },
  {
    path: '/outreach',
    name: 'Communications',
    status: 'LEGACY_DESIGN',
    customerCritical: false,
    note: 'The Communications hub and its ~35 sub-routes are one coherent legacy area. '
      + 'Represented by its root here rather than enumerated: they share a shell, so '
      + 'they migrate as one wave or not at all, and listing 35 near-identical records '
      + 'would make this file a directory rather than a decision.',
  },
];

/** Every surface the mobile/RTL matrix must cover at four widths and six locales. */
export function customerCriticalPaths(): string[] {
  return SURFACES.filter((s) => s.customerCritical).map((s) => s.path);
}

/** Surfaces a migration wave is permitted to touch. */
export function migratablePaths(): string[] {
  return SURFACES
    .filter((s) => s.status === 'LEGACY_DESIGN' || s.status === 'NEEDS_MIGRATION')
    .map((s) => s.path);
}

/** Surfaces no wave may touch, whatever else it is doing. */
export function protectedPaths(): string[] {
  return SURFACES.filter((s) => s.status === 'PROTECTED').map((s) => s.path);
}

export function statusOf(path: string): DesignStatus | null {
  return SURFACES.find((s) => s.path === path)?.status ?? null;
}
