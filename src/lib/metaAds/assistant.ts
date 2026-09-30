// HOMATCH NOW — the campaign assistant's four answers, from stored facts only.
// Pure: what HOMATCH is watching, what it has found, what it is doing, and
// what (if anything) the customer should do next. Every answer maps to work
// the code actually performs:
//   MONITOR   status-sync cron (every minute; paused every 5th), maintenance
//             cron (insights, Guard drift, analysis every 15 minutes)
//   ANALYZE   analysis.ts health / evidence / recommendations
//   RECOMMEND recommendations apply only when the customer confirms
//   AUTO-ACT  Campaign Guard only: pausing a duplicate or a campaign changed
//             materially outside HOMATCH. Nothing else acts on its own.
// No autopilot claim: `meta_ads_autopilot_enabled` is off and unused.

export type AssistantPhase = 'REVIEW' | 'WAITING_DATA' | 'DELIVERING' | 'PAUSED' | 'ENDED' | 'REJECTED' | 'NOT_LAUNCHED';

export interface AssistantInput {
  status: string;
  hasDelivery: boolean;
  openRecommendations: number;
  actionableRecommendations: number;
  /** Open Guard incidents or events that need the customer. */
  needsAttention: number;
  /** The latest change seen outside HOMATCH (event type + when), if recent. */
  lastExternal: { type: string; at: string } | null;
  lastSyncedAt: string | null;
}

export interface AssistantAnswers {
  phase: AssistantPhase;
  watched: boolean;
  watching: string;   // i18n keys
  found: string;
  foundVars?: Record<string, string | number>;
  doing: string;
  next: string;
  nextTab: 'optimization' | 'integrity' | 'overview' | null;
}

export const EXTERNAL_EVENT_TYPES = [
  'CAMPAIGN_PAUSED_OUTSIDE', 'CAMPAIGN_RESUMED_OUTSIDE', 'CAMPAIGN_STATUS_CHANGED',
  'EXTERNAL_MODIFICATION', 'BUDGET_CHANGED_OUTSIDE', 'SCHEDULE_CHANGED_OUTSIDE',
];
/** An outside change stays "news" on the panel for this long. */
export const EXTERNAL_RECENT_HOURS = 48;

export function phaseOf(status: string, hasDelivery: boolean): AssistantPhase {
  if (['SUBMITTED', 'META_REVIEW', 'LAUNCHING'].includes(status)) return 'REVIEW';
  if (status === 'ACTIVE') return hasDelivery ? 'DELIVERING' : 'WAITING_DATA';
  if (status === 'PAUSED') return 'PAUSED';
  if (status === 'REJECTED') return 'REJECTED';
  if (['COMPLETED', 'ARCHIVED', 'ENDED', 'FAILED'].includes(status)) return 'ENDED';
  return 'NOT_LAUNCHED';
}

export function assistantAnswers(a: AssistantInput): AssistantAnswers {
  const phase = phaseOf(a.status, a.hasDelivery);
  const watched = ['REVIEW', 'WAITING_DATA', 'DELIVERING', 'PAUSED'].includes(phase);
  const watching = phase === 'PAUSED' ? 'mm_as_watch_paused' : watched ? 'mm_as_watch_live' : 'mm_as_watch_none';

  // Found: attention first, then an outside change, then the phase's fact.
  let found: string; let foundVars: Record<string, string | number> | undefined;
  if (a.needsAttention > 0) { found = 'mm_as_found_attention'; foundVars = { n: a.needsAttention }; }
  else if (a.lastExternal) {
    found = a.lastExternal.type === 'CAMPAIGN_PAUSED_OUTSIDE' ? 'mm_as_found_paused_outside'
      : a.lastExternal.type === 'CAMPAIGN_RESUMED_OUTSIDE' ? 'mm_as_found_resumed_outside'
        : a.lastExternal.type === 'CAMPAIGN_STATUS_CHANGED' ? 'mm_as_found_status_changed' : 'mm_as_found_changed_outside';
  }
  else if (phase === 'DELIVERING' && a.openRecommendations > 0) { found = 'mm_as_found_recs'; foundVars = { n: a.openRecommendations }; }
  else found = `mm_as_found_${phase}`;

  const doing = `mm_as_doing_${phase}`;

  let next: string; let nextTab: AssistantAnswers['nextTab'] = null;
  if (a.needsAttention > 0) { next = 'mm_as_next_attention'; nextTab = 'integrity'; }
  else if (phase === 'DELIVERING' && a.actionableRecommendations > 0) { next = 'mm_as_next_review_rec'; nextTab = 'optimization'; }
  else next = `mm_as_next_${phase}`;

  return { phase, watched, watching, found, foundVars, doing, next, nextTab };
}

/** The latest outside change within the recent window, from campaign events. */
export function lastExternalChange(events: Array<{ type: string; last_seen_at: string }>, nowMs: number) {
  const since = nowMs - EXTERNAL_RECENT_HOURS * 3_600_000;
  const hit = events
    .filter((e) => EXTERNAL_EVENT_TYPES.includes(e.type) && Date.parse(e.last_seen_at) >= since)
    .sort((x, y) => Date.parse(y.last_seen_at) - Date.parse(x.last_seen_at))[0];
  return hit ? { type: hit.type, at: hit.last_seen_at } : null;
}
