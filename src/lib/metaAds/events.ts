// META ADS — CANONICAL EVENTS AND NOTIFICATION ROUTING. Pure and deterministic.
//
// The 15-minute monitoring cycle calls detect() over structured analysis and
// transition() against each event's stored state. Only a transition that
// matters produces a notification, and only a notification with new evidence
// may ask AI for words (cached by evidence fingerprint). A stable campaign
// therefore runs cycle after cycle with zero AI calls and zero messages.
//
//   condition → key (what) + evidence fingerprint (how bad, bucketed) →
//   OPEN | ESCALATED | UPDATED | UNCHANGED | RESOLVED | REMINDER → route()
//
// Buckets make noise invisible: a cost per result that moves from +31% to
// +34% is the same evidence; +31% → +62% is material.

export type Severity = 'INFO' | 'IMPORTANT' | 'CRITICAL';
export type Category = 'CAMPAIGN' | 'LEADS' | 'BILLING' | 'GUARD' | 'SYSTEM';
export type Channel = 'IN_APP' | 'PUSH' | 'EMAIL';

export type EventType =
  | 'PERFORMANCE_DETERIORATED' | 'PERFORMANCE_IMPROVED' | 'LEAD_QUALITY_CHANGED' | 'CREATIVE_FATIGUE'
  | 'PLACEMENT_FINDING' | 'AUDIENCE_FINDING' | 'NEW_RECOMMENDATION'
  | 'CAMPAIGN_REJECTED' | 'CAMPAIGN_RESTRICTED' | 'CAMPAIGN_STOPPED' | 'LAUNCH_FAILED'
  | 'SERVICE_BALANCE_LOW' | 'EXTERNAL_MODIFICATION' | 'GUARD_WARNING' | 'GUARD_STRIKE' | 'GUARD_SUSPENDED'
  | 'CONTROL_ACCESS_LOST' | 'DATA_HEALTH' | 'CAMPAIGN_LIFECYCLE'
  // Status seen at reconciliation (statusChange.ts) and Guard edits, by kind.
  | 'CAMPAIGN_PAUSED_OUTSIDE' | 'CAMPAIGN_RESUMED_OUTSIDE' | 'CAMPAIGN_ACTIVATED' | 'CAMPAIGN_STATUS_CHANGED'
  | 'CAMPAIGN_BUDGET_CHANGED_OUTSIDE' | 'CAMPAIGN_SCHEDULE_CHANGED_OUTSIDE';

export const EVENT_META: Record<EventType, { category: Category; mandatory?: boolean; stateful: boolean; preference: 'performance' | 'leads' | 'billing' | 'integrity' | 'lifecycle' }> = {
  PERFORMANCE_DETERIORATED: { category: 'CAMPAIGN', stateful: true, preference: 'performance' },
  PERFORMANCE_IMPROVED: { category: 'CAMPAIGN', stateful: true, preference: 'performance' },
  LEAD_QUALITY_CHANGED: { category: 'LEADS', stateful: true, preference: 'leads' },
  CREATIVE_FATIGUE: { category: 'CAMPAIGN', stateful: true, preference: 'performance' },
  PLACEMENT_FINDING: { category: 'CAMPAIGN', stateful: true, preference: 'performance' },
  AUDIENCE_FINDING: { category: 'CAMPAIGN', stateful: true, preference: 'performance' },
  NEW_RECOMMENDATION: { category: 'CAMPAIGN', stateful: false, preference: 'performance' },
  CAMPAIGN_REJECTED: { category: 'CAMPAIGN', stateful: true, preference: 'lifecycle' },
  CAMPAIGN_RESTRICTED: { category: 'CAMPAIGN', stateful: true, preference: 'lifecycle' },
  CAMPAIGN_STOPPED: { category: 'CAMPAIGN', stateful: false, preference: 'lifecycle' },
  LAUNCH_FAILED: { category: 'CAMPAIGN', stateful: false, preference: 'lifecycle' },
  SERVICE_BALANCE_LOW: { category: 'BILLING', stateful: true, preference: 'billing' },
  EXTERNAL_MODIFICATION: { category: 'GUARD', stateful: false, preference: 'integrity' },
  GUARD_WARNING: { category: 'GUARD', mandatory: true, stateful: false, preference: 'integrity' },
  GUARD_STRIKE: { category: 'GUARD', mandatory: true, stateful: false, preference: 'integrity' },
  GUARD_SUSPENDED: { category: 'GUARD', mandatory: true, stateful: true, preference: 'integrity' },
  CONTROL_ACCESS_LOST: { category: 'SYSTEM', mandatory: true, stateful: true, preference: 'integrity' },
  DATA_HEALTH: { category: 'SYSTEM', stateful: true, preference: 'integrity' },
  CAMPAIGN_LIFECYCLE: { category: 'CAMPAIGN', stateful: false, preference: 'lifecycle' },
  CAMPAIGN_PAUSED_OUTSIDE: { category: 'CAMPAIGN', stateful: false, preference: 'lifecycle' },
  CAMPAIGN_RESUMED_OUTSIDE: { category: 'CAMPAIGN', stateful: false, preference: 'lifecycle' },
  CAMPAIGN_ACTIVATED: { category: 'CAMPAIGN', stateful: false, preference: 'lifecycle' },
  CAMPAIGN_STATUS_CHANGED: { category: 'CAMPAIGN', stateful: false, preference: 'lifecycle' },
  CAMPAIGN_BUDGET_CHANGED_OUTSIDE: { category: 'GUARD', stateful: false, preference: 'integrity' },
  CAMPAIGN_SCHEDULE_CHANGED_OUTSIDE: { category: 'GUARD', stateful: false, preference: 'integrity' },
};

const RANK: Record<Severity, number> = { INFO: 0, IMPORTANT: 1, CRITICAL: 2 };

/** A condition the analysis observed this cycle. */
export interface Condition {
  type: EventType;
  /** The object it concerns: 'campaign', 'ad:<id>', 'account:<id>', 'incident:<id>'… */
  subject: string;
  severity: Severity;
  actionRequired?: boolean;
  /** Bucketed evidence — the ONLY thing that decides "materially changed". */
  evidence: Record<string, string | number | boolean | null>;
  /** Unbucketed numbers for the message itself (never part of the fingerprint). */
  facts?: Record<string, string | number | null>;
  /** One-shot conditions (a launch failure, a strike) carry their occurrence id. */
  occurrence?: string;
  deepLink: string;
}

export interface EventState {
  key: string;
  state: 'OPEN' | 'RESOLVED';
  severity: Severity;
  evidenceFingerprint: string;
  firstSeenAt: string;
  lastSeenAt: string;
  lastNotifiedAt: string | null;
  missingCycles: number;
  reminders: number;
}

export interface NotifyPolicy {
  /** Cycles a condition must be absent before it counts as resolved. */
  resolveAfterCycles: number;
  /** An UPDATED (material, same severity) event re-notifies at most this often. */
  minRenotifyHours: number;
  /** An unresolved CRITICAL action-required event may remind this often, this many times. */
  reminderHours: number;
  maxReminders: number;
}

export const DEFAULT_NOTIFY_POLICY: NotifyPolicy = { resolveAfterCycles: 2, minRenotifyHours: 24, reminderHours: 24, maxReminders: 2 };

/* ── FINGERPRINTS ─────────────────────────────────────────────────────── */

function fnv(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const canonical = (o: Record<string, unknown>) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));

/** Deduplication key: WHAT the event is about. Stable across cycles. */
export function eventKey(campaignId: string | null, c: Condition): string {
  return [c.type, campaignId ?? '-', c.subject, c.occurrence ?? ''].join('|');
}

/** Evidence fingerprint: HOW the situation looks, bucketed. */
export function evidenceFingerprint(c: Condition): string {
  return fnv(canonical({ ...c.evidence, severity: c.severity }));
}

/** Change share → a coarse bucket (0, ±25, ±50, ±100, …). */
export function changeBucket(change: number | null): number | null {
  if (change == null || !Number.isFinite(change)) return null;
  const a = Math.abs(change);
  const b = a >= 1 ? 100 : a >= 0.5 ? 50 : a >= 0.25 ? 25 : 0;
  return change < 0 ? -b : b;
}

/* ── LIFECYCLE ────────────────────────────────────────────────────────── */

export type Transition = 'OPEN' | 'ESCALATED' | 'UPDATED' | 'UNCHANGED' | 'RESOLVED' | 'REMINDER' | 'STILL_RESOLVED';

export interface TransitionResult {
  transition: Transition;
  notify: boolean;
  next: EventState;
  /** Whether an AI narrative may be requested for this notification. */
  mayUseAi: boolean;
}

/**
 * One cycle for one key. `c` is the condition seen this cycle, or null when
 * it was not seen. Stateless one-shot conditions open once per occurrence.
 */
export function transition(prev: EventState | null, c: Condition | null, key: string, nowIso: string,
  policy: NotifyPolicy = DEFAULT_NOTIFY_POLICY): TransitionResult | null {
  const now = Date.parse(nowIso);
  if (!prev) {
    if (!c) return null;
    const fp = evidenceFingerprint(c);
    return {
      transition: 'OPEN', notify: true, mayUseAi: c.severity !== 'INFO',
      next: { key, state: 'OPEN', severity: c.severity, evidenceFingerprint: fp, firstSeenAt: nowIso, lastSeenAt: nowIso, lastNotifiedAt: nowIso, missingCycles: 0, reminders: 0 },
    };
  }
  if (!c) {
    if (prev.state === 'RESOLVED') return { transition: 'STILL_RESOLVED', notify: false, mayUseAi: false, next: prev };
    const missing = prev.missingCycles + 1;
    if (missing >= policy.resolveAfterCycles) {
      return { transition: 'RESOLVED', notify: RANK[prev.severity] >= RANK.IMPORTANT, mayUseAi: false,
        next: { ...prev, state: 'RESOLVED', missingCycles: missing, lastNotifiedAt: RANK[prev.severity] >= RANK.IMPORTANT ? nowIso : prev.lastNotifiedAt } };
    }
    return { transition: 'UNCHANGED', notify: false, mayUseAi: false, next: { ...prev, missingCycles: missing } };
  }
  const fp = evidenceFingerprint(c);
  const base = { ...prev, lastSeenAt: nowIso, missingCycles: 0 };
  if (prev.state === 'RESOLVED') {
    return { transition: 'OPEN', notify: true, mayUseAi: c.severity !== 'INFO',
      next: { ...base, state: 'OPEN', severity: c.severity, evidenceFingerprint: fp, firstSeenAt: nowIso, lastNotifiedAt: nowIso, reminders: 0 } };
  }
  if (RANK[c.severity] > RANK[prev.severity]) {
    return { transition: 'ESCALATED', notify: true, mayUseAi: true, next: { ...base, severity: c.severity, evidenceFingerprint: fp, lastNotifiedAt: nowIso } };
  }
  const sinceNotified = prev.lastNotifiedAt ? now - Date.parse(prev.lastNotifiedAt) : Infinity;
  if (fp !== prev.evidenceFingerprint) {
    const due = sinceNotified >= policy.minRenotifyHours * 3600_000 && RANK[c.severity] >= RANK.IMPORTANT;
    return { transition: 'UPDATED', notify: due, mayUseAi: due,
      next: { ...base, severity: c.severity, evidenceFingerprint: fp, lastNotifiedAt: due ? nowIso : prev.lastNotifiedAt } };
  }
  if (c.severity === 'CRITICAL' && c.actionRequired && prev.reminders < policy.maxReminders && sinceNotified >= policy.reminderHours * 3600_000) {
    return { transition: 'REMINDER', notify: true, mayUseAi: false, next: { ...base, lastNotifiedAt: nowIso, reminders: prev.reminders + 1 } };
  }
  return { transition: 'UNCHANGED', notify: false, mayUseAi: false, next: base };
}

/* ── ROUTING ──────────────────────────────────────────────────────────── */

export interface Preferences {
  push: boolean;
  email: boolean;
  performance: boolean;
  leads: boolean;
  billing: boolean;
  dailyBrief: boolean;
  weeklyBrief: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = { push: true, email: true, performance: true, leads: true, billing: true, dailyBrief: false, weeklyBrief: true };

/**
 * INFO → in-app. IMPORTANT → in-app + push. CRITICAL → in-app + push + email.
 * A resolution is gentler than the incident. Mandatory integrity messages
 * (Guard, access loss) ignore the category toggles, never the channel
 * existing: push needs a live subscription, email a verified address.
 */
export function route(type: EventType, severity: Severity, t: Transition, prefs: Preferences,
  reach: { hasPush: boolean; hasEmail: boolean }): Channel[] {
  const meta = EVENT_META[type];
  const categoryOn = meta.mandatory || meta.preference === 'integrity' || meta.preference === 'lifecycle'
    || (meta.preference === 'performance' && prefs.performance)
    || (meta.preference === 'leads' && prefs.leads)
    || (meta.preference === 'billing' && prefs.billing);
  if (!categoryOn) return [];
  const eff: Severity = t === 'RESOLVED' ? (severity === 'CRITICAL' ? 'IMPORTANT' : 'INFO') : severity;
  const out: Channel[] = ['IN_APP'];
  if (RANK[eff] >= RANK.IMPORTANT && reach.hasPush && (prefs.push || meta.mandatory)) out.push('PUSH');
  if (eff === 'CRITICAL' && reach.hasEmail && (prefs.email || meta.mandatory)) out.push('EMAIL');
  return out;
}

/* ── MESSAGE SAFETY ───────────────────────────────────────────────────── */

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/g;

/** Lock-screen / email text never carries a lead's contact details. */
export function scrubPii(text: string): string {
  return String(text ?? '').replace(EMAIL_RE, '•••').replace(PHONE_RE, '•••');
}

/* ── BRIEFS ───────────────────────────────────────────────────────────── */

export interface BriefCampaign {
  id: string; name: string; status: string; currency: string;
  spendMinor: number; results: number; leads: number; qualified: number | null;
  prevSpendMinor: number | null; prevResults: number | null;
  attention: boolean;
}

/** One aggregated brief instead of many small alerts. Totals by currency. */
export function buildBrief(period: 'DAILY' | 'WEEKLY', periodKey: string, campaigns: BriefCampaign[], openRecommendations: number, resolvedIssues: number) {
  const active = campaigns.filter((c) => ['ACTIVE', 'META_REVIEW', 'PAUSED'].includes(c.status));
  const byCurrency: Record<string, { spendMinor: number; results: number; leads: number; qualified: number; prevSpendMinor: number; prevResults: number; hasPrev: boolean }> = {};
  for (const c of campaigns) {
    const t = (byCurrency[c.currency] ??= { spendMinor: 0, results: 0, leads: 0, qualified: 0, prevSpendMinor: 0, prevResults: 0, hasPrev: false });
    t.spendMinor += c.spendMinor; t.results += c.results; t.leads += c.leads; t.qualified += c.qualified ?? 0;
    if (c.prevSpendMinor != null) { t.prevSpendMinor += c.prevSpendMinor; t.prevResults += c.prevResults ?? 0; t.hasPrev = true; }
  }
  const totals = Object.entries(byCurrency).map(([currency, t]) => ({
    currency, spendMinor: t.spendMinor, results: t.results, leads: t.leads, qualified: t.qualified,
    costPerResultMinor: t.results > 0 ? Math.round(t.spendMinor / t.results) : null,
    resultsChange: t.hasPrev && t.prevResults > 0 ? (t.results - t.prevResults) / t.prevResults : null,
  }));
  const attention = campaigns.filter((c) => c.attention).map((c) => ({ id: c.id, name: c.name }));
  const worthSending = campaigns.some((c) => c.spendMinor > 0 || c.results > 0) || attention.length > 0;
  return {
    period, periodKey, activeCampaigns: active.length, totals, attention, openRecommendations, resolvedIssues,
    worthSending,
    fingerprint: fnv(canonical({ period, periodKey, totals: JSON.stringify(totals), attention: attention.map((a) => a.id).join(','), openRecommendations })),
  };
}
