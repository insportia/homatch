// META ADS — THE MONITORING CYCLE. Runs inside the 15-minute maintenance pass
// and is DETERMINISTIC: no model is called and nobody is notified unless a
// canonical event actually changes state (notifier.ts decides that, and only
// then may a model write the words for a meaningful IMPORTANT/CRITICAL one).
//
//   sync (engine.ts) → read the managed state → Guard → insights when due →
//   analysis → recommendations → health → detect → canonical events.
//
// A stable campaign ends the cycle with zero AI calls and zero notifications.

import { detect } from '../../../src/lib/metaAds/detect.ts';
import { buildBrief, type BriefCampaign, type Condition, type EventType } from '../../../src/lib/metaAds/events.ts';
import { resultOf } from '../../../src/lib/metaAds/kpi.ts';
import { BRIEF_LINES, BRIEF_TITLE, EMAIL_CTA, EMAIL_FOOTER, EMAIL_NEXT, EMAIL_WHY, EMAIL_ANALYSIS, RTL, t6, type Locale } from '../../../src/lib/metaAds/messages.ts';
import { scrubPii } from '../../../src/lib/metaAds/events.ts';
import type { GuardDecision, ExternalAction } from '../../../src/lib/metaAds/guard.ts';
import { classifyStatusChange, statusChangeEvent, HOMATCH_COMMAND_OPS, COMMAND_ECHO_MINUTES } from '../../../src/lib/metaAds/statusChange.ts';
import { notify } from '../_shared/notify.ts';
import { renderNotificationEmail, sendNotificationEmail } from '../_shared/notifyEmail.ts';
import { graphAll, type MetaMode } from '../_shared/metaAds.ts';
import { ingestLead } from '../_shared/metaLeads.ts';
import { userToken, type MetaSettings } from './engine.ts';
import { readManagedState, isAccessError } from './lifecycle.ts';
import { guardCampaign, scanDuplicates } from './guardSync.ts';
import { insightsDue, syncInsights } from './insightsSync.ts';
import { allowance, type Pressure } from '../../../src/lib/metaAds/rateLimit.ts';
import { analyzeCampaign, persistRecommendations, scoreAppliedRecommendations } from './intelligence.ts';
import { processConditions, recipientFor, type CycleStats } from './notifier.ts';

type Sb = any;

const LIVE = ['SUBMITTED', 'META_REVIEW', 'ACTIVE', 'PAUSED'];
/** Stateful types a full campaign cycle evaluates — an OPEN one not seen again may resolve. */
const CAMPAIGN_SCOPE: EventType[] = [
  'PERFORMANCE_DETERIORATED', 'PERFORMANCE_IMPROVED', 'LEAD_QUALITY_CHANGED', 'CREATIVE_FATIGUE',
  'PLACEMENT_FINDING', 'AUDIENCE_FINDING', 'CAMPAIGN_REJECTED', 'CAMPAIGN_RESTRICTED', 'DATA_HEALTH', 'CONTROL_ACCESS_LOST',
];
const USER_SCOPE: EventType[] = ['GUARD_SUSPENDED', 'SERVICE_BALANCE_LOW'];
const DUPLICATE_SCAN_HOURS = 6;
const link = (id: string, tab?: string) => `/outreach/meta/campaigns/${id}${tab ? `?tab=${tab}` : ''}`;

export interface MonitorReport extends CycleStats {
  leadsBackfilled: number;
  campaigns: number; guardIncidents: number; protective: number; insightRows: number; recommendations: number; duplicateScans: number; errors: number;
}

export const emptyMonitorReport = (): MonitorReport => ({
  leadsBackfilled: 0, campaigns: 0, guardIncidents: 0, protective: 0, insightRows: 0, recommendations: 0, duplicateScans: 0, errors: 0,
  conditions: 0, notifications: 0, aiCalls: 0, emails: 0, pushEligible: 0,
});

function add(r: MonitorReport, s: CycleStats) {
  r.conditions += s.conditions; r.notifications += s.notifications; r.aiCalls += s.aiCalls; r.emails += s.emails; r.pushEligible += s.pushEligible;
}

/** A Guard decision, as the customer-facing canonical event it implies. */
export function guardCondition(c: { id: string }, d: { action: ExternalAction; decision: GuardDecision; incidentId: string; items?: Array<{ field: string }> }): Condition | null {
  const lvl = d.decision.level;
  if (lvl === 'REVIEW_REQUIRED' || lvl === 'NONE') return null; // an admin looks first — no alarm on a maybe
  if (lvl === 'STRIKE') {
    return { type: 'GUARD_STRIKE', subject: `incident:${d.incidentId}`, occurrence: d.incidentId, severity: 'CRITICAL', actionRequired: true,
      evidence: { action: d.action, strikes: d.decision.strikesAfter }, facts: { n: d.decision.strikesAfter }, deepLink: link(c.id, 'integrity') };
  }
  if (lvl === 'WARNING') {
    return { type: 'GUARD_WARNING', subject: `incident:${d.incidentId}`, occurrence: d.incidentId, severity: 'IMPORTANT',
      evidence: { action: d.action }, deepLink: link(c.id, 'integrity') };
  }
  /* A pause or resume outside HOMATCH is told once, by the status change the
     same reconciliation saw (statusChange.ts); the incident is still kept. */
  if ((d.action === 'MANUAL_PAUSE' || d.action === 'MANUAL_RESUME') && d.decision.action !== 'PAUSE_CAMPAIGN') return null;
  const fields = new Set((d.items ?? []).map((i) => i.field));
  const type = d.action === 'MATERIAL_EDIT' && (fields.has('daily_budget') || fields.has('lifetime_budget')) ? 'CAMPAIGN_BUDGET_CHANGED_OUTSIDE'
    : d.action === 'MATERIAL_EDIT' && (fields.has('end_time') || fields.has('start_time')) ? 'CAMPAIGN_SCHEDULE_CHANGED_OUTSIDE'
      : 'EXTERNAL_MODIFICATION';
  return { type, subject: `incident:${d.incidentId}`, occurrence: d.incidentId,
    severity: d.decision.action === 'PAUSE_CAMPAIGN' || type !== 'EXTERNAL_MODIFICATION' ? 'IMPORTANT' : 'INFO', evidence: { action: d.action }, deepLink: link(c.id, 'integrity') };
}

/** One campaign, one deterministic cycle. `c` is the row as it is AFTER syncCampaign. */
export async function monitorCampaign(sb: Sb, c: any, settings: MetaSettings, mode: MetaMode, report: MonitorReport, now = Date.now(), pressure: Pressure = 'NORMAL') {
  report.campaigns += 1;
  const conditions: Condition[] = [];
  const real = mode === 'REAL' && c.external_campaign_id && !String(c.external_campaign_id).startsWith('mock_');
  let connectionOk = !c.last_error || c.last_error?.key !== 'meta_err_reconnect';
  const token = real ? await userToken(sb, c.user_id) : null;
  if (real && !token) connectionOk = false;

  // 1. Guard: the exact managed state against the approved configuration.
  if (real && token && LIVE.includes(c.status)) {
    try {
      const current = await readManagedState(token, c, { sb, userId: c.user_id, campaignId: c.id });
      const g = await guardCampaign(sb, c, current, token, settings.guardPolicy, settings.guardEnabled, async (d) => {
        const cond = guardCondition(c, d);
        if (cond) conditions.push(cond);
      });
      report.guardIncidents += g.incidents; report.protective += g.protective;
    } catch (err) {
      if (isAccessError(err)) connectionOk = false; else report.errors += 1;
    }
  }

  // 2. Insights: normalized daily + breakdown rows, at most every 30 minutes.
  // Insights only while Meta reports room for them (rateLimit.allowance); status never waits on this.
  /* Under capacity pressure the optional analytics give way first (rateLimit.allowance):
     ELEVATED → half the cadence and no heavy breakdowns; HIGH and above → no insights at all. */
  const room = allowance(pressure, new Date(now).getUTCMinutes());
  if (real && token && connectionOk && room.insights && insightsDue(c, false, room.insightsSlowdown, now)) {
    try { report.insightRows += (await syncInsights(sb, c, token, { breakdowns: room.breakdowns })).rows; } catch (err) {
      if (isAccessError(err)) connectionOk = false; else report.errors += 1;
    }
    // Lead reconciliation on the same cadence: a lead the webhook missed is backfilled.
    if (connectionOk && settings.leadSyncEnabled && c.goal === 'LEADS_ON_META') {
      try { report.leadsBackfilled += await backfillLeads(sb, c, token); } catch { report.errors += 1; }
    }
  }

  // 3. Analysis from stored evidence (database only), recommendations, health.
  const a = await analyzeCampaign(sb, c, settings.analysisParams, now);
  const recs = await persistRecommendations(sb, c, a.recommendations);
  report.recommendations += recs.filter((r: any) => r.isNew).length;
  await scoreAppliedRecommendations(sb, c, a);
  const patch: Record<string, unknown> = { health: a.health };
  if (a.factsKey !== c.summary_facts_key) {
    // The deterministic summary; words are rendered per locale at read time.
    patch.summary = { facts: a.facts, evidence: a.evidence };
    patch.summary_facts_key = a.factsKey;
    patch.summary_at = new Date(now).toISOString();
  }
  await sb.from('meta_campaigns').update(patch).eq('id', c.id);

  conditions.push(...detect({
    id: c.id, goal: c.goal, status: c.status, currency: a.currency, lastError: c.last_error ?? null,
    current: a.current, previous: a.previous, outcomesCurrent: a.outcomes.current, outcomesPrevious: a.outcomes.previous,
    leadsCurrent: a.outcomes.current.leads ?? 0, leadsPrevious: a.outcomes.previous.leads ?? 0,
    health: a.health, recommendations: recs, creativeClasses: a.creativeClasses,
    placementLeader: a.leaders.placement, audienceLeader: a.leaders.audience, connectionOk,
  }));

  // 4. Canonical events → (only on a real transition) one notification.
  add(report, await processConditions(sb, c, c.user_id, conditions, CAMPAIGN_SCOPE, { aiEnabled: settings.aiSummaryEnabled }));
}

/**
 * Leads Meta holds for this campaign's ads in the last 3 days that HOMATCH
 * does not: ingested through the same idempotent path as the webhook
 * (external_lead_id is unique), so a lead is never stored twice.
 */
async function backfillLeads(sb: Sb, c: any, token: string): Promise<number> {
  const { data: ads } = await sb.from('meta_ad_entities').select('external_id').eq('campaign_id', c.id).eq('kind', 'AD').limit(50);
  const since = Math.floor((Date.now() - 3 * 86_400_000) / 1000);
  const filter = encodeURIComponent(JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: since }]));
  let added = 0;
  for (const ad of ads ?? []) {
    const leads = await graphAll(`/${ad.external_id}/leads?fields=id,created_time,ad_id,form_id&filtering=${filter}&limit=100`, { token } as any, 3);
    if (!leads.length) continue;
    const ids = leads.map((l: any) => String(l.id));
    const { data: have } = await sb.from('meta_leads').select('external_lead_id').in('external_lead_id', ids);
    const known = new Set((have ?? []).map((h: any) => String(h.external_lead_id)));
    for (const l of leads) {
      if (known.has(String(l.id))) continue;
      const r = await ingestLead(sb, { leadgen_id: String(l.id), ad_id: String(l.ad_id ?? ad.external_id), form_id: l.form_id ? String(l.form_id) : undefined,
        page_id: c.page_external_id ?? undefined, created_time: l.created_time ? Math.floor(Date.parse(l.created_time) / 1000) : undefined });
      if (r.inserted) added += 1;
    }
  }
  return added;
}

/** One-shot lifecycle event (launch, launch failure, stop) through the same router. */
export async function lifecycleEvent(sb: Sb, c: any, type: 'CAMPAIGN_LIFECYCLE' | 'LAUNCH_FAILED' | 'CAMPAIGN_STOPPED', what: string, occurrence: string, settings: MetaSettings) {
  const severity = type === 'LAUNCH_FAILED' ? 'IMPORTANT' : 'INFO';
  return processConditions(sb, c, c.user_id, [{
    type, subject: 'campaign', occurrence, severity, actionRequired: type === 'LAUNCH_FAILED',
    evidence: { what }, facts: { what }, deepLink: link(c.id),
  }], [], { aiEnabled: settings.aiSummaryEnabled });
}

/**
 * A status change seen at reconciliation, told once. `before` is the status
 * HOMATCH held before this sync; `c` is the row after it. The same status on
 * the next pass is not a change, so nothing repeats (and the event key
 * carries the transition and sync time, so a replay cannot double it).
 */
export async function statusChangeNotice(sb: Sb, c: any, before: string, settings: MetaSettings, now = Date.now()) {
  const since = new Date(now - COMMAND_ECHO_MINUTES * 60_000).toISOString();
  const { data: ops, error: opsErr } = await sb.from('meta_operations').select('op').eq('campaign_id', c.id).in('op', HOMATCH_COMMAND_OPS).gte('requested_at', since).limit(1);
  const endAt = Date.parse(c.plan?.requestedStartAt ?? c.launched_at ?? '') + Number(c.duration_days ?? 0) * 86_400_000;
  const change = classifyStatusChange(before, c.status, { homatchCommandRecently: opsErr ? null : (ops ?? []).length > 0, endTimePassed: Number.isFinite(endAt) && now > endAt });
  const ev = statusChangeEvent(change);
  if (!change || !ev) return { conditions: 0, notifications: 0, aiCalls: 0, emails: 0, pushEligible: 0, change };
  const stats = await processConditions(sb, c, c.user_id, [{
    type: ev.type, subject: 'campaign', occurrence: `${change.from}>${change.to}@${c.last_synced_at ?? now}`,
    severity: ev.severity, evidence: { from: change.from, to: change.to, provenance: change.provenance },
    facts: { state: change.to, what: change.to }, deepLink: link(c.id),
  }], [], { aiEnabled: settings.aiSummaryEnabled });
  return { ...stats, change };
}

/**
 * Account-level state: Guard suspension (per ad account) and a service
 * balance too small for a campaign waiting on it. Stateful, so each resolves
 * by itself once the condition is gone.
 */
export async function monitorUser(sb: Sb, userId: string, settings: MetaSettings, report: MonitorReport) {
  const conditions: Condition[] = [];
  const { data: accounts } = await sb.from('meta_guard_accounts').select('ad_account_external_id,status,active_strikes').eq('user_id', userId);
  for (const acc of accounts ?? []) {
    if (acc.status === 'SUSPENDED') {
      conditions.push({ type: 'GUARD_SUSPENDED', subject: `account:${acc.ad_account_external_id}`, severity: 'CRITICAL', actionRequired: true,
        evidence: { status: 'SUSPENDED' }, facts: { n: acc.active_strikes, of: settings.guardPolicy.maxStrikes }, deepLink: '/outreach/meta?tab=integrity' });
    }
  }
  const { data: waiting } = await sb.from('meta_campaigns').select('id,preflight,currency').eq('user_id', userId).eq('status', 'PAYMENT_REQUIRED').limit(5);
  const short = (waiting ?? []).map((w: any) => Number(w.preflight?.funding?.shortfallCents ?? 0)).filter((n: number) => n > 0);
  if (short.length) {
    conditions.push({ type: 'SERVICE_BALANCE_LOW', subject: 'balance', severity: 'IMPORTANT', actionRequired: true,
      evidence: { short: true }, facts: { shortfallMinor: Math.max(...short), currency: waiting![0].currency ?? 'USD' }, deepLink: '/outreach/meta?tab=overview' });
  }
  add(report, await processConditions(sb, null, userId, conditions, USER_SCOPE, { aiEnabled: false }));
}

/**
 * Duplicate scans are Graph reads over a whole ad account, so they run at
 * most every DUPLICATE_SCAN_HOURS per account.
 */
export async function maybeScanDuplicates(sb: Sb, userId: string, account: string, settings: MetaSettings, report: MonitorReport, now = Date.now()) {
  if (!settings.guardEnabled) return;
  const { data: row } = await sb.from('meta_guard_accounts').select('last_duplicate_scan_at').eq('user_id', userId).eq('ad_account_external_id', account).maybeSingle();
  if (row?.last_duplicate_scan_at && now - Date.parse(row.last_duplicate_scan_at) < DUPLICATE_SCAN_HOURS * 3_600_000) return;
  await sb.from('meta_guard_accounts').upsert({ user_id: userId, ad_account_external_id: account, last_duplicate_scan_at: new Date(now).toISOString() },
    { onConflict: 'user_id,ad_account_external_id' });
  const token = await userToken(sb, userId);
  if (!token) return;
  const byCampaign = new Map<string, { c: any; conds: Condition[] }>();
  try {
    const r = await scanDuplicates(sb, token, userId, account, settings.guardPolicy, async (d) => {
      const cond = guardCondition(d.campaign, d);
      if (!cond) return;
      const e = byCampaign.get(d.campaign.id) ?? { c: d.campaign, conds: [] };
      e.conds.push(cond); byCampaign.set(d.campaign.id, e);
    });
    report.duplicateScans += 1; report.guardIncidents += r.incidents;
  } catch { report.errors += 1; }
  for (const { c, conds } of byCampaign.values()) {
    add(report, await processConditions(sb, c, userId, conds, [], { aiEnabled: settings.aiSummaryEnabled }));
  }
}

/* ── BRIEFS ─────────────────────────────────────────────────────────────
   One aggregated message instead of many small ones. Sent at 08:00 in the
   customer's own time zone: DAILY (opt-in) every day, WEEKLY (default on)
   on Mondays. One row per (user, period, period key) — never twice. */

const BRIEF_HOUR = 8;

function localParts(now: number, tz: string) {
  try {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false, weekday: 'short' });
    const p = Object.fromEntries(f.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, weekday: String(p.weekday) };
  } catch { return localParts(now, 'Asia/Tbilisi'); }
}

export function briefDue(now: number, tz: string, prefs: { dailyBrief: boolean; weeklyBrief: boolean }): Array<{ period: 'DAILY' | 'WEEKLY'; key: string; days: number }> {
  const l = localParts(now, tz);
  if (l.hour !== BRIEF_HOUR) return [];
  const out: Array<{ period: 'DAILY' | 'WEEKLY'; key: string; days: number }> = [];
  if (prefs.dailyBrief) out.push({ period: 'DAILY', key: l.date, days: 1 });
  if (prefs.weeklyBrief && l.weekday === 'Mon') out.push({ period: 'WEEKLY', key: `W:${l.date}`, days: 7 });
  return out;
}

const money = (minor: number | null, currency: string, locale: Locale) => (minor == null ? '—'
  : new Intl.NumberFormat(locale, { style: 'currency', currency }).format(minor / 100));

export async function runBriefs(sb: Sb, report: { briefs: number; briefEmails: number }, now = Date.now()) {
  const since = new Date(now - 8 * 86_400_000).toISOString();
  const { data: rows } = await sb.from('meta_campaigns').select('user_id').not('launched_at', 'is', null)
    .or(`status.in.(SUBMITTED,META_REVIEW,ACTIVE,PAUSED),ended_at.gte.${since}`).limit(2000);
  const users: string[] = [...new Set<string>((rows ?? []).map((r: any) => String(r.user_id)))];
  for (const userId of users) {
    const recipient = await recipientFor(sb, userId);
    const { data: pref } = await sb.from('notification_preferences').select('timezone').eq('user_id', userId).maybeSingle();
    const due = briefDue(now, String(pref?.timezone || 'Asia/Tbilisi'), recipient.prefs);
    for (const d of due) {
      const { data: prior } = await sb.from('meta_briefs').select('id').eq('user_id', userId).eq('period', d.period).eq('period_key', d.key).maybeSingle();
      if (prior) continue;
      const content = await briefContent(sb, userId, d.period, d.key, d.days, now);
      if (!content.worthSending) continue; // nothing ran, nothing to say
      const { data: saved, error } = await sb.from('meta_briefs').insert({
        user_id: userId, period: d.period, period_key: d.key, fingerprint: content.fingerprint, content,
      }).select('id').single();
      if (error) continue; // a concurrent pass already sent it
      const i = recipient.locale;
      const lines = briefLines(content, i);
      const title = t6(BRIEF_TITLE[d.period], i);
      const channels = ['IN_APP', ...(recipient.hasPush && recipient.prefs.push ? ['PUSH'] : [])];
      const notificationId = await notify(sb, {
        userId, type: 'META_CAMPAIGN_STATUS', title, body: scrubPii(lines.join(' · ')), priority: 'NORMAL',
        deepLink: '/outreach/meta?tab=overview', dedupeKey: `meta_brief:${userId}:${d.period}:${d.key}`,
        metadata: { kind: 'META_BRIEF', period: d.period, category: 'CAMPAIGN', pref: d.period === 'DAILY' ? 'meta_daily_brief' : 'meta_weekly_brief' },
      });
      let emailed = false;
      if (d.period === 'WEEKLY' && recipient.hasEmail && recipient.prefs.email) {
        const e = await sendNotificationEmail(sb, { userId, notificationId, eventKey: `brief:${d.key}`, content: renderNotificationEmail({
          rtl: RTL[i], lang: i, title, body: lines[0] ?? '', whyLabel: t6(EMAIL_WHY, i), why: lines.slice(1).join('\n'),
          analysisLabel: t6(EMAIL_ANALYSIS, i), analysis: null, nextLabel: t6(EMAIL_NEXT, i), next: null,
          ctaLabel: t6(EMAIL_CTA, i), ctaUrl: 'https://www.homatch.live/outreach/meta?tab=overview', footer: t6(EMAIL_FOOTER, i),
        }) });
        emailed = e.status === 'SENT';
      }
      if (emailed) channels.push('EMAIL');
      await sb.from('meta_briefs').update({ notification_id: notificationId, channels }).eq('id', saved.id);
      report.briefs += 1; if (emailed) report.briefEmails += 1;
    }
  }
}

export function briefLines(content: ReturnType<typeof buildBrief>, i: Locale): string[] {
  const lines = [t6(BRIEF_LINES.active, i, { n: content.activeCampaigns })];
  for (const t of content.totals) {
    lines.push(t6(BRIEF_LINES.spend, i, { spend: money(t.spendMinor, t.currency, i), results: t.results, cpr: money(t.costPerResultMinor, t.currency, i) }));
    if (t.leads > 0) lines.push(t6(BRIEF_LINES.leads, i, { leads: t.leads, qualified: t.qualified }));
  }
  if (content.attention.length) lines.push(t6(BRIEF_LINES.attention, i, { names: content.attention.map((a) => scrubPii(a.name)).join(', ') }));
  if (content.openRecommendations) lines.push(t6(BRIEF_LINES.recommendations, i, { n: content.openRecommendations }));
  if (content.resolvedIssues) lines.push(t6(BRIEF_LINES.resolved, i, { n: content.resolvedIssues }));
  return lines;
}

async function briefContent(sb: Sb, userId: string, period: 'DAILY' | 'WEEKLY', key: string, days: number, now: number) {
  const until = new Date(now).toISOString().slice(0, 10);
  const since = new Date(now - days * 86_400_000).toISOString().slice(0, 10);
  const prevSince = new Date(now - 2 * days * 86_400_000).toISOString().slice(0, 10);
  const { data: camps } = await sb.from('meta_campaigns').select('id,name,status,goal,currency,health').eq('user_id', userId).not('launched_at', 'is', null);
  const list: BriefCampaign[] = [];
  for (const c of camps ?? []) {
    const { data: ins } = await sb.from('meta_insights').select('day,spend_minor,impressions,clicks,link_clicks,landing_page_views,leads,messages,registrations,post_engagements,currency')
      .eq('campaign_id', c.id).eq('level', 'campaign').eq('breakdown', 'none').gte('day', prevSince).lt('day', until);
    const win = (a: string, b: string) => (ins ?? []).filter((r: any) => r.day >= a && r.day < b);
    const tot = (rs: any[]) => rs.reduce((t, r) => ({
      currency: c.currency, spendMinor: t.spendMinor + Number(r.spend_minor), impressions: t.impressions + Number(r.impressions), reach: null,
      clicks: t.clicks + Number(r.clicks), linkClicks: t.linkClicks + Number(r.link_clicks), landingPageViews: t.landingPageViews + Number(r.landing_page_views),
      leads: t.leads + Number(r.leads), messages: t.messages + Number(r.messages), registrations: t.registrations + Number(r.registrations),
      postEngagements: t.postEngagements + Number(r.post_engagements),
    }), { currency: c.currency, spendMinor: 0, impressions: 0, reach: null, clicks: 0, linkClicks: 0, landingPageViews: 0, leads: 0, messages: 0, registrations: 0, postEngagements: 0 });
    const cur = win(since, until); const prev = win(prevSince, since);
    const tc = tot(cur); const tp = tot(prev);
    const { data: leads } = await sb.from('meta_leads').select('status').eq('campaign_id', c.id).gte('received_at', `${since}T00:00:00Z`).lt('received_at', `${until}T00:00:00Z`);
    const qualified = (leads ?? []).filter((l: any) => ['QUALIFIED', 'VIEWING', 'NEGOTIATING', 'WON'].includes(l.status)).length;
    const attention = Object.values(c.health ?? {}).some((h: any) => h?.state === 'ACTION_RECOMMENDED');
    if (cur.length === 0 && !LIVE.includes(c.status)) continue;
    list.push({
      id: c.id, name: String(c.name ?? ''), status: c.status, currency: c.currency,
      spendMinor: tc.spendMinor, results: resultOf(c.goal, tc as any), leads: (leads ?? []).length, qualified,
      prevSpendMinor: prev.length ? tp.spendMinor : null, prevResults: prev.length ? resultOf(c.goal, tp as any) : null, attention,
    });
  }
  const { count: open } = await sb.from('meta_recommendations').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'OPEN').eq('actionable', true);
  const { count: resolved } = await sb.from('meta_events').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('state', 'RESOLVED')
    .gte('resolved_at', new Date(now - days * 86_400_000).toISOString());
  return buildBrief(period, key, list, open ?? 0, resolved ?? 0);
}

