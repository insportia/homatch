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
    status: 'NEEDS_MIGRATION',
    customerCritical: true,
    note: 'THE ONLY SCREEN WHERE MONEY CHANGES HANDS. Still carries the Locked/Unlock '
      + 'mental model for results a campaign already paid for, which double-sells an '
      + 'included match. The redaction underneath is correct and must be preserved; it '
      + 'is the customer-facing hierarchy that needs rebuilding around relevance, '
      + 'compatibility, freshness and why-this-matches.',
  },
  {
    path: '/active-search',
    name: 'Active Search',
    status: 'NEEDS_MIGRATION',
    customerCritical: true,
    note: 'Where a customer states what they want, and the natural home of FIND '
      + 'PROPERTY. Models both sides already but has no composer and no plan view.',
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
    status: 'LEGACY_DESIGN',
    customerCritical: true,
    note: 'The first thing anybody sees, in six languages. Migrated late and carefully: '
      + 'a home page rewrite is the easiest way to break every entry point at once.',
  },
  {
    path: '/brokers',
    name: 'Brokers',
    status: 'APPROVED_CURRENT_DESIGN',
    customerCritical: true,
    note: 'Built new rather than migrated: the Broker audit found NO customer-facing '
      + 'broker surface at all. The only broker code was the developer product\'s '
      + 'BrokerPanel, which distributes inventory to outside brokers and is a '
      + 'different thing in a different product. So there is no legacy design here to '
      + 'preserve and nothing was overwritten. Customer-critical because its whole '
      + 'purpose is a claim a customer would act on -- whether a firm is registered '
      + 'with Homatch or merely observed in the market -- and a layout that truncates '
      + 'the observed label into the registered one costs exactly the trust the page '
      + 'exists to protect.',
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
