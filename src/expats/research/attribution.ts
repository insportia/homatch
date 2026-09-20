// HOMATCH FOR EXPATS — the funnel, with its stages kept apart.
//
// §55 ends with four words that are the whole point of this file: never
// treat a click as a conversion. It sounds obvious. It is also the single
// most common way a partnership funnel comes to report numbers nobody can
// bill against, because "outbound clicks" is the easiest number to collect
// and "the customer actually hired them" is the hardest.
//
// So the stages are an ordered enum, an event can only ever record the
// stage it genuinely observed, and there is no function anywhere that
// promotes one stage to another. A CONVERTED row can only exist because
// something outside this product confirmed it, and today nothing does —
// which is the correct state for a marketplace that has not been built
// (§56).
//
// WHAT IS DELIBERATELY NOT RECORDED
//
// No URL the person went on to visit, no referrer, no page-level path, no
// dwell time. A provider needs to know that Homatch sent them an enquiry;
// it does not need a trace of a foreigner's browsing while they worked out
// whether they needed a lawyer. §78 applies to this file as much as to the
// profile.

/**
 * The funnel, in order. The index IS the ordering; nothing else defines it.
 */
export const FUNNEL_STAGES = [
  /** The provider's card was rendered where the person could see it. */
  'VIEW',
  /** They opened the provider — expanded the card, opened the detail. */
  'CLICK',
  /**
   * They took an action that only makes sense if they mean to make contact:
   * revealed a phone number, opened WhatsApp, opened the website, asked for
   * directions. Intent, not contact — we cannot see whether they called.
   */
  'CONTACT_INTENT',
  /** They submitted an enquiry THROUGH Homatch. The first fact we own. */
  'LEAD_SUBMITTED',
  /** The provider confirmed an appointment. Requires provider integration. */
  'BOOKED',
  /** Confirmed work and fee. Requires a settlement process that does not exist. */
  'CONVERTED',
] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

/**
 * Stages Homatch can observe from inside the product today.
 *
 * The two beyond it are in the enum because the schema should not need a
 * migration the day a partnership starts, and are listed here so that no
 * dashboard can quietly begin reporting them as though they were measured.
 */
export const OBSERVABLE_STAGES: readonly FunnelStage[] = [
  'VIEW',
  'CLICK',
  'CONTACT_INTENT',
  'LEAD_SUBMITTED',
];

export function isObservable(stage: FunnelStage): boolean {
  return OBSERVABLE_STAGES.includes(stage);
}

/** The specific thing the person did. Several map to one stage. */
export const OUTBOUND_ACTIONS = [
  'PROVIDER_VIEWED',
  'PROVIDER_OPENED',
  'WEBSITE_OPENED',
  'PHONE_REVEALED',
  'EMAIL_REVEALED',
  'WHATSAPP_OPENED',
  'DIRECTIONS_OPENED',
  'ENQUIRY_SUBMITTED',
] as const;
export type OutboundAction = (typeof OUTBOUND_ACTIONS)[number];

/**
 * Which stage an action evidences.
 *
 * One direction only. There is no inverse function, because a stage does
 * not imply any particular action and a lookup in that direction would
 * invite code that fabricates one.
 */
const ACTION_STAGE: Record<OutboundAction, FunnelStage> = {
  PROVIDER_VIEWED: 'VIEW',
  PROVIDER_OPENED: 'CLICK',
  WEBSITE_OPENED: 'CONTACT_INTENT',
  PHONE_REVEALED: 'CONTACT_INTENT',
  EMAIL_REVEALED: 'CONTACT_INTENT',
  WHATSAPP_OPENED: 'CONTACT_INTENT',
  DIRECTIONS_OPENED: 'CONTACT_INTENT',
  ENQUIRY_SUBMITTED: 'LEAD_SUBMITTED',
};

export function stageOf(action: OutboundAction): FunnelStage {
  return ACTION_STAGE[action];
}

export interface OutboundEvent {
  action: OutboundAction;
  stage: FunnelStage;
  providerId: string;
  /** The research run this provider was surfaced by, when it was one. */
  researchId: string | null;
  /**
   * Whether the placement was paid. Recorded so paid and organic traffic
   * can be told apart in reporting — and never read by the ranking code,
   * which does not receive it (see reputation.ts, RankingInputs).
   */
  sponsored: boolean;
  occurredAt: string;
}

/**
 * Build an event.
 *
 * `stage` is derived, never supplied. A caller that could pass its own
 * stage is a caller that can record a click as a conversion, which is the
 * one thing §55 asks us to make impossible rather than merely discouraged.
 */
export function outboundEvent(input: {
  action: OutboundAction;
  providerId: string;
  researchId?: string | null;
  sponsored?: boolean;
  occurredAt?: string;
}): OutboundEvent {
  return {
    action: input.action,
    stage: stageOf(input.action),
    providerId: input.providerId,
    researchId: input.researchId ?? null,
    sponsored: input.sponsored ?? false,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
  };
}

export interface FunnelCounts {
  byStage: Record<FunnelStage, number>;
  /** Distinct providers touched at each stage. Events double-count. */
  providersByStage: Record<FunnelStage, number>;
}

/**
 * Count a set of events.
 *
 * Each event counts at ITS OWN stage and nowhere else. A funnel that
 * back-fills — counting a LEAD_SUBMITTED as also a VIEW and a CLICK —
 * produces monotonically decreasing columns that look like a funnel and
 * are partly fabricated, since Homatch may never have observed the view.
 * The columns here can therefore be non-monotonic, and that is correct:
 * it means somebody arrived deeper in than we saw them enter.
 */
export function countFunnel(events: readonly OutboundEvent[]): FunnelCounts {
  const byStage = Object.fromEntries(FUNNEL_STAGES.map((s) => [s, 0])) as Record<
    FunnelStage,
    number
  >;
  const providers = Object.fromEntries(
    FUNNEL_STAGES.map((s) => [s, new Set<string>()]),
  ) as Record<FunnelStage, Set<string>>;

  for (const e of events) {
    byStage[e.stage] += 1;
    providers[e.stage].add(e.providerId);
  }

  return {
    byStage,
    providersByStage: Object.fromEntries(
      FUNNEL_STAGES.map((s) => [s, providers[s].size]),
    ) as Record<FunnelStage, number>,
  };
}
