// HOMATCH FOR EXPATS — turning a handful of answers into a plan.
//
// WHAT A TEMPLATE IS ALLOWED TO SAY
//
// A template says DO THIS, WHEN, and AFTER WHAT. It does not say what the
// law requires, what a fee is, or how long an authority takes. Those are
// claims about Georgia, they change, and they live in sourced topics with
// provenance attached. A template points at a topic by key; it never
// embeds the topic's content.
//
// The distinction is the whole safety property. "Register your address"
// is a task and will still be a task next year. "You have 10 days to
// register your address" is a legal deadline, and if it moves, a hard-coded
// copy of it in this file becomes a wrong date sitting in somebody's
// calendar with a reminder attached. So `defaultDueOffsetDays` below is
// explicitly a PLANNING SUGGESTION and is labelled as one everywhere it
// surfaces — `deadlineBasis` on the generated task carries whether the date
// came from us or from law, and the UI is required to render the difference.
//
// WHY APPLICABILITY IS A PREDICATE AND NOT A TAG LIST
//
// A tag list ("shown to: FAMILY, BUY") cannot express "only if they are
// bringing a car" or "only if they do not already own property here", and
// every product that starts with tags ends up with a tag called
// `SPECIAL_CASE_7`. A predicate over the profile is directly testable and
// says what it means.
//
// WHY AN EMPTY PROFILE STILL PRODUCES A PLAN
//
// Somebody who has told us nothing is the commonest visitor. Every
// predicate is written so that UNKNOWN includes the task rather than
// excluding it, except where including it would be actively wrong (a
// residence-renewal task for somebody who has not arrived). The result is
// a sensible generic plan that narrows as they answer things, which is the
// behaviour §40 asks for: progressive, never an upfront questionnaire.

import type { ExpatIntent, ExpatProfile } from '../types.ts';

/* ── Stages ───────────────────────────────────────────────────────────── */

/**
 * When in the move a task belongs.
 *
 * Ordered, and the order is the plan's spine. RENEWALS sits last and is not
 * a point in time at all — it is the recurring tail that makes the product
 * worth keeping after the move is over (§99).
 */
export const PLAN_STAGES = [
  'PREPARE',
  'ARRIVAL',
  'FIRST_WEEK',
  'FIRST_30',
  'FIRST_90',
  'SETTLE',
  'LONG_TERM',
  'RENEWALS',
] as const;
export type PlanStage = (typeof PLAN_STAGES)[number];

/**
 * Days from arrival that each stage centres on.
 *
 * Negative for everything before the plane lands. These position a task on
 * the timeline when nothing better is known; a task with its own
 * `defaultDueOffsetDays` overrides it.
 */
const STAGE_OFFSET_DAYS: Record<PlanStage, number> = {
  PREPARE: -45,
  ARRIVAL: 0,
  FIRST_WEEK: 5,
  FIRST_30: 21,
  FIRST_90: 60,
  SETTLE: 120,
  LONG_TERM: 240,
  RENEWALS: 330,
};

/* ── Categories ───────────────────────────────────────────────────────── */

export const TASK_CATEGORIES = [
  'DOCUMENTS',
  'RESIDENCY',
  'HOUSING',
  'BANKING',
  'HEALTHCARE',
  'INSURANCE',
  'CONNECTIVITY',
  'TRANSPORT',
  'TAX',
  'FAMILY',
  'PETS',
  'PROPERTY',
  'BUSINESS',
  'UTILITIES',
] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

/* ── The template ─────────────────────────────────────────────────────── */

export interface TaskTemplate {
  /** Stable key. Appears in the database and in URLs; never renamed. */
  key: string;
  category: TaskCategory;
  stage: PlanStage;
  titleKey: string;
  /** Why this matters, in one sentence. */
  whyKey: string;
  /**
   * Keys of templates that must be done first.
   *
   * Real ordering only. §43 forbids invented dependencies, so each one
   * here is a case where the second task physically cannot be attempted
   * until the first is finished — a notary will not certify a translation
   * of a document you do not yet hold.
   */
  dependsOn: readonly string[];
  /**
   * Days relative to arrival. Overrides the stage's default when set.
   * A PLANNING suggestion, never presented as a legal deadline.
   */
  defaultDueOffsetDays?: number;
  /** The sourced topic that explains how to actually do it. */
  topicKey: string | null;
  /**
   * A Homatch product this task hands off to, when one genuinely applies.
   * Rendered as a deep link. Null for the great majority.
   */
  handoff: TaskHandoff | null;
  /** Should this task exist for this person? */
  applies: (p: ExpatProfile) => boolean;
  /** Recurs every N months once done. Drives the RENEWALS tail. */
  recursEveryMonths?: number;
}

export const TASK_HANDOFFS = ['VERIFY', 'MORTGAGE', 'INVESTMENT', 'CONTRACTS', 'PROPERTY'] as const;
export type TaskHandoff = (typeof TASK_HANDOFFS)[number];

/* ── Predicate helpers, written so that unknown means "show it" ───────── */

const wants = (p: ExpatProfile, ...intents: ExpatIntent[]): boolean =>
  p.intents.length === 0 || intents.some((i) => p.intents.includes(i));

/** True unless we have been told there are no children. */
const maybeChildren = (p: ExpatProfile): boolean =>
  p.childrenCount === null ? p.household !== 'ALONE' && p.household !== 'COUPLE' : p.childrenCount > 0;

/** True unless we have been told there is no pet. */
const maybePets = (p: ExpatProfile): boolean => p.pets !== false;

/** True unless we have been told they already own here. */
const notYetAnOwner = (p: ExpatProfile): boolean => p.alreadyOwnsProperty !== true;

/** True for somebody who is physically relocating, not investing remotely. */
const isRelocating = (p: ExpatProfile): boolean => {
  if (p.intents.length === 0) return true;
  return p.intents.some((i) => i === 'MOVE' || i === 'LIVE' || i === 'FAMILY' || i === 'STUDY' || i === 'RETIRE');
};

const isBuying = (p: ExpatProfile): boolean =>
  wants(p, 'BUY', 'INVEST') || p.housingPlan === 'BUY';

const always = (): boolean => true;

/* ── The templates ────────────────────────────────────────────────────── */

/**
 * The plan catalogue.
 *
 * Deliberately modest. A hundred tasks would look impressive on this screen
 * and be abandoned in week two; these are the things that actually have to
 * happen, each one pointing at content that explains it. Expansion is a
 * content exercise, not a code one.
 */
export const TASK_TEMPLATES: readonly TaskTemplate[] = [
  /* PREPARE ─────────────────────────────────────────────────────────── */
  {
    key: 'check-entry-conditions',
    category: 'DOCUMENTS',
    stage: 'PREPARE',
    titleKey: 'expat_task_check_entry_title',
    whyKey: 'expat_task_check_entry_why',
    dependsOn: [],
    defaultDueOffsetDays: -60,
    topicKey: 'entry-and-stay',
    handoff: null,
    applies: always,
  },
  {
    key: 'gather-personal-documents',
    category: 'DOCUMENTS',
    stage: 'PREPARE',
    titleKey: 'expat_task_gather_docs_title',
    whyKey: 'expat_task_gather_docs_why',
    dependsOn: [],
    defaultDueOffsetDays: -45,
    topicKey: 'documents-and-legalisation',
    handoff: null,
    applies: always,
  },
  {
    key: 'apostille-documents',
    category: 'DOCUMENTS',
    stage: 'PREPARE',
    titleKey: 'expat_task_apostille_title',
    whyKey: 'expat_task_apostille_why',
    // You cannot legalise a document you have not collected.
    dependsOn: ['gather-personal-documents'],
    defaultDueOffsetDays: -30,
    topicKey: 'documents-and-legalisation',
    handoff: null,
    applies: (p) => isRelocating(p) || maybeChildren(p),
  },
  {
    key: 'travel-health-cover',
    category: 'INSURANCE',
    stage: 'PREPARE',
    titleKey: 'expat_task_travel_cover_title',
    whyKey: 'expat_task_travel_cover_why',
    dependsOn: [],
    defaultDueOffsetDays: -14,
    topicKey: 'healthcare-and-insurance',
    handoff: null,
    applies: isRelocating,
  },
  {
    key: 'pet-import-paperwork',
    category: 'PETS',
    stage: 'PREPARE',
    titleKey: 'expat_task_pet_title',
    whyKey: 'expat_task_pet_why',
    dependsOn: [],
    defaultDueOffsetDays: -40,
    topicKey: null,
    handoff: null,
    applies: (p) => isRelocating(p) && maybePets(p),
  },
  {
    key: 'book-temporary-housing',
    category: 'HOUSING',
    stage: 'PREPARE',
    titleKey: 'expat_task_temp_housing_title',
    whyKey: 'expat_task_temp_housing_why',
    dependsOn: [],
    defaultDueOffsetDays: -21,
    topicKey: null,
    handoff: null,
    applies: isRelocating,
  },
  {
    key: 'shortlist-districts',
    category: 'HOUSING',
    stage: 'PREPARE',
    titleKey: 'expat_task_shortlist_districts_title',
    whyKey: 'expat_task_shortlist_districts_why',
    dependsOn: [],
    defaultDueOffsetDays: -20,
    topicKey: null,
    handoff: null,
    applies: always,
  },
  {
    key: 'estimate-monthly-budget',
    category: 'BANKING',
    stage: 'PREPARE',
    titleKey: 'expat_task_budget_title',
    whyKey: 'expat_task_budget_why',
    dependsOn: [],
    defaultDueOffsetDays: -25,
    topicKey: 'cost-of-living',
    handoff: null,
    applies: isRelocating,
  },

  /* ARRIVAL ─────────────────────────────────────────────────────────── */
  {
    key: 'keep-entry-record',
    category: 'DOCUMENTS',
    stage: 'ARRIVAL',
    titleKey: 'expat_task_entry_record_title',
    whyKey: 'expat_task_entry_record_why',
    dependsOn: [],
    defaultDueOffsetDays: 0,
    topicKey: 'entry-and-stay',
    handoff: null,
    applies: isRelocating,
  },
  {
    key: 'get-sim',
    category: 'CONNECTIVITY',
    stage: 'ARRIVAL',
    titleKey: 'expat_task_sim_title',
    whyKey: 'expat_task_sim_why',
    dependsOn: [],
    defaultDueOffsetDays: 1,
    topicKey: null,
    handoff: null,
    applies: isRelocating,
  },

  /* FIRST WEEK ──────────────────────────────────────────────────────── */
  {
    key: 'open-bank-account',
    category: 'BANKING',
    stage: 'FIRST_WEEK',
    titleKey: 'expat_task_bank_title',
    whyKey: 'expat_task_bank_why',
    // A bank will ask for the passport and, in practice, a local number.
    dependsOn: ['get-sim'],
    defaultDueOffsetDays: 5,
    topicKey: 'opening-a-bank-account',
    handoff: null,
    applies: always,
  },
  {
    key: 'view-long-term-housing',
    category: 'HOUSING',
    stage: 'FIRST_WEEK',
    titleKey: 'expat_task_view_housing_title',
    whyKey: 'expat_task_view_housing_why',
    dependsOn: ['shortlist-districts'],
    defaultDueOffsetDays: 7,
    topicKey: null,
    handoff: 'PROPERTY',
    applies: (p) => isRelocating(p) && p.housingPlan !== 'ALREADY_OWN',
  },

  /* FIRST 30 ────────────────────────────────────────────────────────── */
  {
    key: 'sign-lease',
    category: 'HOUSING',
    stage: 'FIRST_30',
    titleKey: 'expat_task_lease_title',
    whyKey: 'expat_task_lease_why',
    dependsOn: ['view-long-term-housing'],
    defaultDueOffsetDays: 20,
    topicKey: null,
    handoff: 'CONTRACTS',
    applies: (p) =>
      isRelocating(p) && (p.housingPlan === 'RENT' || p.housingPlan === null || p.housingPlan === 'UNDECIDED'),
  },
  {
    key: 'transfer-utilities',
    category: 'UTILITIES',
    stage: 'FIRST_30',
    titleKey: 'expat_task_utilities_title',
    whyKey: 'expat_task_utilities_why',
    dependsOn: ['sign-lease'],
    defaultDueOffsetDays: 25,
    topicKey: null,
    handoff: null,
    applies: isRelocating,
  },
  {
    key: 'register-address',
    category: 'RESIDENCY',
    stage: 'FIRST_30',
    titleKey: 'expat_task_register_address_title',
    whyKey: 'expat_task_register_address_why',
    // An address cannot be registered before there is one.
    dependsOn: ['sign-lease'],
    defaultDueOffsetDays: 28,
    topicKey: 'residence-permits',
    handoff: null,
    applies: isRelocating,
  },
  {
    key: 'arrange-health-cover',
    category: 'HEALTHCARE',
    stage: 'FIRST_30',
    titleKey: 'expat_task_health_cover_title',
    whyKey: 'expat_task_health_cover_why',
    dependsOn: [],
    defaultDueOffsetDays: 30,
    topicKey: 'healthcare-and-insurance',
    handoff: null,
    applies: isRelocating,
  },
  {
    key: 'enrol-children',
    category: 'FAMILY',
    stage: 'FIRST_30',
    titleKey: 'expat_task_enrol_children_title',
    whyKey: 'expat_task_enrol_children_why',
    dependsOn: ['apostille-documents'],
    defaultDueOffsetDays: 14,
    topicKey: null,
    handoff: null,
    applies: (p) => isRelocating(p) && maybeChildren(p),
  },

  /* FIRST 90 ────────────────────────────────────────────────────────── */
  {
    key: 'assess-residence-route',
    category: 'RESIDENCY',
    stage: 'FIRST_90',
    titleKey: 'expat_task_residence_route_title',
    whyKey: 'expat_task_residence_route_why',
    dependsOn: ['check-entry-conditions'],
    defaultDueOffsetDays: 45,
    topicKey: 'residence-permits',
    handoff: null,
    applies: (p) => isRelocating(p) || p.intendedStayMonths === null || p.intendedStayMonths > 12,
  },
  {
    key: 'submit-residence-application',
    category: 'RESIDENCY',
    stage: 'FIRST_90',
    titleKey: 'expat_task_residence_apply_title',
    whyKey: 'expat_task_residence_apply_why',
    // Translated and legalised documents are what the application consists of.
    dependsOn: ['assess-residence-route', 'apostille-documents'],
    defaultDueOffsetDays: 70,
    topicKey: 'residence-permits',
    handoff: null,
    applies: (p) => p.intendedStayMonths === null || p.intendedStayMonths > 12,
  },
  {
    key: 'review-tax-position',
    category: 'TAX',
    stage: 'FIRST_90',
    titleKey: 'expat_task_tax_title',
    whyKey: 'expat_task_tax_why',
    dependsOn: [],
    defaultDueOffsetDays: 80,
    topicKey: 'tax-residency',
    handoff: null,
    applies: (p) => p.workStatus !== 'NOT_WORKING',
  },

  /* BUYING AND INVESTING ────────────────────────────────────────────── */
  {
    key: 'understand-market',
    category: 'PROPERTY',
    stage: 'PREPARE',
    titleKey: 'expat_task_understand_market_title',
    whyKey: 'expat_task_understand_market_why',
    dependsOn: [],
    defaultDueOffsetDays: -30,
    topicKey: 'buying-property',
    handoff: null,
    applies: isBuying,
  },
  {
    key: 'verify-property',
    category: 'PROPERTY',
    stage: 'FIRST_30',
    titleKey: 'expat_task_verify_title',
    whyKey: 'expat_task_verify_why',
    dependsOn: [],
    defaultDueOffsetDays: 15,
    topicKey: 'buying-property',
    handoff: 'VERIFY',
    applies: (p) => isBuying(p) && notYetAnOwner(p),
  },
  {
    key: 'analyse-investment',
    category: 'PROPERTY',
    stage: 'FIRST_30',
    titleKey: 'expat_task_analyse_title',
    whyKey: 'expat_task_analyse_why',
    dependsOn: [],
    defaultDueOffsetDays: 18,
    topicKey: null,
    handoff: 'INVESTMENT',
    applies: (p) => wants(p, 'INVEST'),
  },
  {
    key: 'arrange-financing',
    category: 'PROPERTY',
    stage: 'FIRST_30',
    titleKey: 'expat_task_financing_title',
    whyKey: 'expat_task_financing_why',
    dependsOn: ['open-bank-account'],
    defaultDueOffsetDays: 22,
    topicKey: null,
    handoff: 'MORTGAGE',
    applies: (p) => isBuying(p) && notYetAnOwner(p),
  },
  {
    key: 'review-purchase-contract',
    category: 'PROPERTY',
    stage: 'FIRST_90',
    titleKey: 'expat_task_purchase_contract_title',
    whyKey: 'expat_task_purchase_contract_why',
    dependsOn: ['verify-property'],
    defaultDueOffsetDays: 40,
    topicKey: 'buying-property',
    handoff: 'CONTRACTS',
    applies: (p) => isBuying(p) && notYetAnOwner(p),
  },
  {
    key: 'insure-property',
    category: 'INSURANCE',
    stage: 'SETTLE',
    titleKey: 'expat_task_insure_property_title',
    whyKey: 'expat_task_insure_property_why',
    dependsOn: [],
    defaultDueOffsetDays: 120,
    topicKey: null,
    handoff: null,
    applies: (p) => isBuying(p) || p.alreadyOwnsProperty === true,
    recursEveryMonths: 12,
  },

  /* BUSINESS ────────────────────────────────────────────────────────── */
  {
    key: 'register-business',
    category: 'BUSINESS',
    stage: 'FIRST_90',
    titleKey: 'expat_task_register_business_title',
    whyKey: 'expat_task_register_business_why',
    dependsOn: ['open-bank-account'],
    defaultDueOffsetDays: 60,
    topicKey: null,
    handoff: null,
    applies: (p) => wants(p, 'BUSINESS') || p.workStatus === 'BUSINESS_OWNER',
  },

  /* TRANSPORT ───────────────────────────────────────────────────────── */
  {
    key: 'sort-driving',
    category: 'TRANSPORT',
    stage: 'FIRST_90',
    titleKey: 'expat_task_driving_title',
    whyKey: 'expat_task_driving_why',
    dependsOn: [],
    defaultDueOffsetDays: 75,
    topicKey: null,
    handoff: null,
    applies: (p) => isRelocating(p) && p.hasVehicle !== false,
  },

  /* RENEWALS ────────────────────────────────────────────────────────── */
  {
    key: 'renew-residence',
    category: 'RESIDENCY',
    stage: 'RENEWALS',
    titleKey: 'expat_task_renew_residence_title',
    whyKey: 'expat_task_renew_residence_why',
    dependsOn: ['submit-residence-application'],
    topicKey: 'residence-permits',
    handoff: null,
    applies: (p) => p.intendedStayMonths === null || p.intendedStayMonths > 12,
    recursEveryMonths: 12,
  },
  {
    key: 'renew-health-cover',
    category: 'INSURANCE',
    stage: 'RENEWALS',
    titleKey: 'expat_task_renew_health_title',
    whyKey: 'expat_task_renew_health_why',
    dependsOn: ['arrange-health-cover'],
    topicKey: 'healthcare-and-insurance',
    handoff: null,
    applies: isRelocating,
    recursEveryMonths: 12,
  },
] as const;

const BY_KEY: ReadonlyMap<string, TaskTemplate> = new Map(
  TASK_TEMPLATES.map((t) => [t.key, t]),
);

export function templateByKey(key: string): TaskTemplate | null {
  return BY_KEY.get(key) ?? null;
}

/* ── Generation ───────────────────────────────────────────────────────── */

/**
 * Where a task's date came from.
 *
 * The distinction §45 insists on: a date we suggested is not a date the law
 * imposes, and a reminder that says "your legal deadline" about our own
 * suggestion is the product lying to somebody about their immigration
 * status. Nothing generated by this engine is ever `OFFICIAL` — only a task
 * whose date was taken from a sourced legal topic may be, and that is set
 * by the caller that read the topic.
 */
export const DEADLINE_BASES = ['SUGGESTED', 'OFFICIAL', 'USER'] as const;
export type DeadlineBasis = (typeof DEADLINE_BASES)[number];

export interface GeneratedTask {
  templateKey: string;
  category: TaskCategory;
  stage: PlanStage;
  titleKey: string;
  whyKey: string;
  topicKey: string | null;
  handoff: TaskHandoff | null;
  dependsOn: readonly string[];
  /** ISO date, or null when we have no arrival date to hang it on. */
  recommendedDate: string | null;
  deadlineBasis: DeadlineBasis;
  recursEveryMonths: number | null;
  /** Position within the whole plan, for stable ordering. */
  order: number;
}

const iso = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * The plan for this person.
 *
 * Deterministic: the same profile produces the same plan, in the same
 * order, every time. Nothing here consults a model, and nothing here
 * consults the clock except through `arrivalDate`, which is the person's
 * own answer.
 *
 * With no arrival date every task still appears, in stage order, with no
 * recommended date. A plan without dates is still a plan, and asking for a
 * date before showing anything would be the upfront questionnaire §40
 * rules out.
 */
export function roadmapFor(profile: ExpatProfile): GeneratedTask[] {
  const arrival = profile.arrivalDate ? Date.parse(profile.arrivalDate) : NaN;
  const haveArrival = Number.isFinite(arrival);

  const selected = TASK_TEMPLATES.filter((t) => t.applies(profile));
  const selectedKeys = new Set(selected.map((t) => t.key));

  return selected
    .map((t, index) => {
      const offset = t.defaultDueOffsetDays ?? STAGE_OFFSET_DAYS[t.stage];
      return {
        templateKey: t.key,
        category: t.category,
        stage: t.stage,
        titleKey: t.titleKey,
        whyKey: t.whyKey,
        topicKey: t.topicKey,
        handoff: t.handoff,
        // A dependency on a task this person will not do is not a
        // dependency. Keeping it would leave the plan permanently blocked
        // on something that is never going to appear.
        dependsOn: t.dependsOn.filter((k) => selectedKeys.has(k)),
        recommendedDate: haveArrival ? iso(new Date(arrival + offset * 86_400_000)) : null,
        deadlineBasis: 'SUGGESTED' as DeadlineBasis,
        recursEveryMonths: t.recursEveryMonths ?? null,
        order: index,
      };
    })
    .sort((a, b) => {
      const s = PLAN_STAGES.indexOf(a.stage) - PLAN_STAGES.indexOf(b.stage);
      if (s !== 0) return s;
      if (a.recommendedDate && b.recommendedDate && a.recommendedDate !== b.recommendedDate) {
        return a.recommendedDate < b.recommendedDate ? -1 : 1;
      }
      return a.order - b.order;
    })
    .map((t, i) => ({ ...t, order: i }));
}

/**
 * Every template key the plan depends on but does not contain.
 *
 * Should always be empty — `roadmapFor` strips unmet dependencies — so this
 * exists for the test that proves it, and as a guard if a future template
 * misspells a key. A dangling dependency would silently block a task
 * forever, which is a failure nobody would report because the task simply
 * never becomes actionable.
 */
export function danglingDependencies(tasks: readonly GeneratedTask[]): string[] {
  const present = new Set(tasks.map((t) => t.templateKey));
  const missing = new Set<string>();
  for (const t of tasks) for (const d of t.dependsOn) if (!present.has(d)) missing.add(d);
  return [...missing];
}

/**
 * Templates whose dependencies form a cycle.
 *
 * A cycle would mean two tasks each waiting for the other, neither ever
 * unblocked. Checked over the whole catalogue by the test suite rather than
 * at runtime, because it is a property of the file, not of a user.
 */
export function dependencyCycles(templates: readonly TaskTemplate[] = TASK_TEMPLATES): string[][] {
  const graph = new Map(templates.map((t) => [t.key, t.dependsOn]));
  const cycles: string[][] = [];
  const state = new Map<string, 'OPEN' | 'DONE'>();
  const stack: string[] = [];

  const walk = (key: string): void => {
    const s = state.get(key);
    if (s === 'DONE') return;
    if (s === 'OPEN') {
      cycles.push([...stack.slice(stack.indexOf(key)), key]);
      return;
    }
    state.set(key, 'OPEN');
    stack.push(key);
    for (const next of graph.get(key) ?? []) if (graph.has(next)) walk(next);
    stack.pop();
    state.set(key, 'DONE');
  };

  for (const t of templates) walk(t.key);
  return cycles;
}
