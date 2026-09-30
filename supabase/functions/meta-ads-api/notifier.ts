// META ADS — THE NOTIFICATION ROUTER. Conditions from a monitoring cycle go in;
// canonical events, their history and — only when a transition matters — one
// notification come out, through the ONE HOMATCH pipeline:
//
//   meta_events (state, fingerprints) → notify() → notify_emit (in-app,
//   dedupe) → push-send (preferences, quiet hours, subscriptions) → and, for
//   CRITICAL, sendNotificationEmail (Resend, logged).
//
// AI is asked for words only when a notification is actually going out, the
// event is IMPORTANT or worse, and no summary exists for this exact evidence
// fingerprint in this language. A stable campaign costs nothing here.

import { notify } from '../_shared/notify.ts';
import { sendNotificationEmail, renderNotificationEmail } from '../_shared/notifyEmail.ts';
import { callLlm, llmAvailable } from '../_shared/comm/llm.ts';
import { estimatedProviderCost } from '../_shared/providerCost.ts';
import {
  EVENT_META, DEFAULT_PREFERENCES, eventKey, evidenceFingerprint, transition, route, scrubPii,
  type Condition, type EventState, type Preferences, type Severity, type Transition,
} from '../../../src/lib/metaAds/events.ts';
import { renderEvent, normLocale, RTL, EMAIL_CTA, EMAIL_WHY, EMAIL_ANALYSIS, EMAIL_NEXT, EMAIL_FOOTER, t6, type Locale } from '../../../src/lib/metaAds/messages.ts';

type Sb = any;

const APP_URL = 'https://www.homatch.live';

export interface Recipient { userId: string; locale: Locale; prefs: Preferences; hasPush: boolean; hasEmail: boolean }

export async function recipientFor(sb: Sb, userId: string): Promise<Recipient> {
  const [{ data: u }, { data: p }, { data: subs }] = await Promise.all([
    sb.from('users').select('email,language,preferred_language').eq('id', userId).maybeSingle(),
    sb.from('notification_preferences').select('categories,push_enabled,email_enabled').eq('user_id', userId).maybeSingle(),
    sb.from('push_subscriptions').select('id').eq('user_id', userId).is('revoked_at', null).limit(1),
  ]);
  const cat = (p?.categories ?? {}) as Record<string, boolean>;
  const flag = (k: string, d: boolean) => (typeof cat[k] === 'boolean' ? cat[k] : d);
  return {
    userId,
    locale: normLocale(u?.preferred_language ?? u?.language),
    prefs: {
      push: p?.push_enabled !== false,
      email: p?.email_enabled !== false,
      performance: flag('meta_performance', DEFAULT_PREFERENCES.performance),
      leads: flag('meta_leads', DEFAULT_PREFERENCES.leads),
      billing: flag('meta_billing', DEFAULT_PREFERENCES.billing),
      dailyBrief: flag('meta_daily_brief', DEFAULT_PREFERENCES.dailyBrief),
      weeklyBrief: flag('meta_weekly_brief', DEFAULT_PREFERENCES.weeklyBrief),
    },
    hasPush: (subs ?? []).length > 0,
    hasEmail: /@/.test(String(u?.email ?? '')),
  };
}

const toState = (r: any): EventState => ({
  key: r.key, state: r.state, severity: r.severity, evidenceFingerprint: r.evidence_fingerprint,
  firstSeenAt: r.first_seen_at, lastSeenAt: r.last_seen_at, lastNotifiedAt: r.last_notified_at,
  missingCycles: r.missing_cycles, reminders: r.reminders,
});

export interface CycleStats { conditions: number; notifications: number; aiCalls: number; emails: number; pushEligible: number }

/**
 * One monitoring cycle for one campaign (or one user scope when campaign is
 * null). `scopeTypes` are the stateful event types this cycle evaluated, so
 * an OPEN event of those types that was not seen again can resolve; events of
 * other types are left alone.
 */
export async function processConditions(sb: Sb, campaign: { id: string; user_id: string; name?: string | null } | null,
  userId: string, conditions: Condition[], scopeTypes: string[], opts: { aiEnabled: boolean; now?: string } = { aiEnabled: true }): Promise<CycleStats> {
  const now = opts.now ?? new Date().toISOString();
  const stats: CycleStats = { conditions: conditions.length, notifications: 0, aiCalls: 0, emails: 0, pushEligible: 0 };
  const byKey = new Map(conditions.map((c) => [eventKey(campaign?.id ?? null, c), c]));
  const q = sb.from('meta_events').select('*').eq('user_id', userId);
  const { data: rows } = campaign ? await q.eq('campaign_id', campaign.id) : await q.is('campaign_id', null);
  const existing = new Map<string, any>((rows ?? []).map((r: any) => [r.key, r]));
  const keys = new Set<string>([...byKey.keys(),
    ...(rows ?? []).filter((r: any) => r.state === 'OPEN' && scopeTypes.includes(r.type) && EVENT_META[r.type as keyof typeof EVENT_META]?.stateful).map((r: any) => r.key)]);
  let recipient: Recipient | null = null;

  for (const key of keys) {
    const c = byKey.get(key) ?? null;
    const prevRow = existing.get(key) ?? null;
    const r = transition(prevRow ? toState(prevRow) : null, c, key, now);
    if (!r) continue;
    // Stateless one-shot events never resolve: they happened.
    if (r.transition === 'RESOLVED' && prevRow && !EVENT_META[prevRow.type as keyof typeof EVENT_META]?.stateful) continue;
    const type = (c?.type ?? prevRow?.type) as keyof typeof EVENT_META;
    const row = {
      key, user_id: userId, campaign_id: campaign?.id ?? null, type, category: EVENT_META[type].category,
      severity: r.next.severity, action_required: c?.actionRequired ?? prevRow?.action_required ?? false,
      state: r.next.state, evidence_fingerprint: r.next.evidenceFingerprint,
      evidence: c?.evidence ?? prevRow?.evidence ?? {}, facts: c?.facts ?? prevRow?.facts ?? {},
      deep_link: c?.deepLink ?? prevRow?.deep_link ?? null,
      first_seen_at: r.next.firstSeenAt, last_seen_at: r.next.lastSeenAt, last_notified_at: r.next.lastNotifiedAt,
      missing_cycles: r.next.missingCycles, reminders: r.next.reminders,
      resolved_at: r.next.state === 'RESOLVED' ? (prevRow?.resolved_at ?? now) : null,
    };
    const { data: saved, error } = await sb.from('meta_events').upsert(row, { onConflict: 'key' }).select('id').single();
    if (error) throw error;
    if (!r.notify) continue;

    recipient ??= await recipientFor(sb, userId);
    const channels = route(type, row.severity as Severity, r.transition, recipient.prefs, { hasPush: recipient.hasPush, hasEmail: recipient.hasEmail });
    if (channels.length === 0) continue;
    const historyKey = r.transition === 'REMINDER' ? `${row.evidence_fingerprint}:r${row.reminders}` : row.evidence_fingerprint;
    const { error: hErr } = await sb.from('meta_event_notifications').insert({
      event_id: saved.id, user_id: userId, transition: r.transition === 'OPEN' || r.transition === 'ESCALATED' || r.transition === 'UPDATED' || r.transition === 'RESOLVED' || r.transition === 'REMINDER' ? r.transition : 'UPDATED',
      severity: row.severity, evidence_fingerprint: historyKey, channels,
    });
    if (hErr) { if (String(hErr.message).includes('duplicate')) continue; throw hErr; }

    const params = { campaign: scrubPii(String(campaign?.name ?? '')), ...paramsOf(row.facts, recipient.locale) };
    const words = renderEvent(type, r.transition, recipient.locale, params);
    let analysis: string | null = null;
    let summaryId: string | null = null;
    if (r.mayUseAi && opts.aiEnabled && row.severity !== 'INFO' && channels.includes('EMAIL')) {
      const s = await aiSummary(sb, { purpose: 'EVENT', fingerprint: `${type}:${row.evidence_fingerprint}`, locale: recipient.locale, userId, campaignId: campaign?.id ?? null,
        trigger: `${type}:${r.transition}`, facts: { type, transition: r.transition, severity: row.severity, evidence: row.evidence, facts: row.facts } });
      if (s) { analysis = s.text; summaryId = s.id; stats.aiCalls += s.generated ? 1 : 0; }
    }
    const notificationId = await notify(sb, {
      userId, type: type.startsWith('GUARD') || type === 'EXTERNAL_MODIFICATION' ? 'META_GUARD' : type === 'NEW_RECOMMENDATION' ? 'META_RECOMMENDATION'
        : type === 'SERVICE_BALANCE_LOW' ? 'META_ADS_BALANCE' : 'META_CAMPAIGN_STATUS',
      title: scrubPii(words.title), body: scrubPii(words.body),
      // Push-routed events interrupt by severity; in-app-only ones never push.
      priority: !channels.includes('PUSH') ? 'LOW' : row.severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
      deepLink: row.deep_link, entityType: campaign ? 'META_CAMPAIGN' : null, entityId: campaign?.id ?? null,
      dedupeKey: `meta_evt:${saved.id}:${r.transition}:${historyKey}`,
      metadata: { kind: 'META_EVENT', eventType: type, transition: r.transition, severity: row.severity, category: row.category,
        pref: `meta_${EVENT_META[type].preference}`, eventId: saved.id },
    });
    await sb.from('meta_event_notifications').update({ notification_id: notificationId, ai_summary_id: summaryId })
      .eq('event_id', saved.id).eq('evidence_fingerprint', historyKey).eq('transition', r.transition);
    stats.notifications += 1;
    if (channels.includes('PUSH')) stats.pushEligible += 1;
    if (channels.includes('EMAIL')) {
      const i = recipient.locale;
      const content = renderNotificationEmail({
        rtl: RTL[i], lang: i, title: scrubPii(words.title), body: scrubPii(words.body),
        whyLabel: t6(EMAIL_WHY, i), why: words.why, analysisLabel: t6(EMAIL_ANALYSIS, i), analysis: analysis ? scrubPii(analysis) : null,
        nextLabel: t6(EMAIL_NEXT, i), next: words.action, ctaLabel: t6(EMAIL_CTA, i),
        ctaUrl: `${APP_URL}${row.deep_link ?? '/outreach/meta'}`, footer: t6(EMAIL_FOOTER, i),
      });
      const e = await sendNotificationEmail(sb, { userId, notificationId, eventKey: key, content });
      if (e.status === 'SENT') stats.emails += 1;
    }
  }
  return stats;
}

function paramsOf(facts: Record<string, unknown>, locale: Locale): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  if (typeof facts.change === 'number') out.pct = Math.round(Math.abs(facts.change) * 100);
  if (typeof facts.shortfallMinor === 'number') {
    out.amount = new Intl.NumberFormat(locale, { style: 'currency', currency: String(facts.currency ?? 'USD') }).format(Number(facts.shortfallMinor) / 100);
  }
  if (typeof facts.n === 'number') out.n = facts.n;
  if (typeof facts.of === 'number') out.of = facts.of;
  if (typeof facts.what === 'string') out.what = facts.what;
  return out;
}

/* ── AI: words from structured evidence, cached by evidence fingerprint ── */

const AI_SYSTEM = `You write short, calm notes for HOMATCH customers about their Meta ad campaigns.
Use ONLY the facts in the JSON you are given. Never add a number, cause, audience, placement,
statistic or recommendation that is not in the facts. If a fact is uncertain, say so plainly.
No lead names, phone numbers or emails. Two sentences, at most 60 words, in the requested language.`;

export async function aiSummary(sb: Sb, o: {
  purpose: 'EVENT' | 'CAMPAIGN_SUMMARY' | 'BRIEF'; fingerprint: string; locale: Locale; userId: string | null; campaignId: string | null;
  trigger: string; facts: unknown;
}): Promise<{ id: string; text: string; generated: boolean } | null> {
  const { data: cached } = await sb.from('meta_ai_summaries').select('id,text')
    .eq('purpose', o.purpose).eq('fingerprint', o.fingerprint).eq('locale', o.locale).maybeSingle();
  if (cached) return { id: cached.id, text: cached.text, generated: false };
  if (!llmAvailable()) return null;
  const res = await callLlm({ system: AI_SYSTEM, user: JSON.stringify({ language: o.locale, facts: o.facts }), maxOutputTokens: 200, reasoningEffort: 'minimal', timeoutMs: 20000 } as any);
  if (!res.ok || !res.text) return null;
  const text = scrubPii(String(res.text).trim()).slice(0, 600);
  const inCost = await estimatedProviderCost(sb, { provider: 'OPENAI', unit: 'INPUT_TOKEN', units: res.inputTokens, model: res.model });
  const outCost = await estimatedProviderCost(sb, { provider: 'OPENAI', unit: 'OUTPUT_TOKEN', units: res.outputTokens, model: res.model });
  const raw = inCost != null && outCost != null ? inCost + outCost : null;
  let landed: number | null = null;
  if (raw != null) {
    const { data } = await sb.rpc('billing_landed_cogs_cents', { p_raw_provider_cents: 0, p_ai_cents: raw * 100, p_enrichment_cents: 0, p_infra_cents: 0 });
    landed = Number.isFinite(Number(data)) ? Number(data) / 100 : null;
  }
  const { data: row, error } = await sb.from('meta_ai_summaries').insert({
    fingerprint: o.fingerprint, locale: o.locale, purpose: o.purpose, user_id: o.userId, campaign_id: o.campaignId,
    trigger_reason: o.trigger, text, model: res.model, input_tokens: res.inputTokens, output_tokens: res.outputTokens,
    raw_cost_usd: raw, landed_cost_usd: landed,
  }).select('id').single();
  await sb.from('cost_events').insert({
    provider: 'OPENAI', operation_type: `meta_ads_${o.purpose.toLowerCase()}_summary`, source: 'meta-ads-api',
    units: res.inputTokens + res.outputTokens, cost_usd: raw ?? 0, success: true, cache_hit: false,
    pricing_state: raw == null ? 'UNPRICED' : 'ESTIMATED',
  });
  if (error) {
    // A concurrent cycle cached the same evidence first: use theirs.
    const { data: again } = await sb.from('meta_ai_summaries').select('id,text').eq('purpose', o.purpose).eq('fingerprint', o.fingerprint).eq('locale', o.locale).maybeSingle();
    return again ? { id: again.id, text: again.text, generated: true } : null;
  }
  return { id: row.id, text, generated: true };
}

export type { Transition };
