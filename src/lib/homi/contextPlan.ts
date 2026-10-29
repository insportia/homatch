/*
 * HOMI TURN BUDGET: what one model turn is allowed to carry and spend.
 *
 * HOMI chat is unlimited in every plan (owner, 2026-10-29), so the cost of a
 * turn has to come down without the person ever seeing a quota. Most of that
 * cost was INPUT: every turn, light ones included, carried up to ~34k
 * characters of internal data, 15k of page context and 24k of history,
 * whether the question needed any of it or not.
 *
 * This module decides, in code and before anything is fetched:
 *   - which internal sections the turn actually needs (none on a generic
 *     turn), and how large each may be;
 *   - how much page context and history the tier carries;
 *   - how far the web may go (calls and search context size);
 *   - whether the model accepts a reasoning setting at all.
 *
 * And it holds the abuse safeguard: a burst rate, an hourly and a very high
 * daily ceiling, and a repeated-message heuristic. It is NOT a plan quota and
 * nothing here depends on the plan.
 *
 * Pure and runtime-neutral: the edge function and node:test import it.
 */

import { normaliseTurn } from './router.ts';
import type { TurnPolicy } from './webPolicy.ts';

export type HomiTier = 'LIGHT' | 'FULL';
export type InternalSection = 'verifications' | 'properties' | 'matches' | 'myGeorgia';

/* The person refers to their own research. */
const REF_REPORT = /(report|verify|verification|my check|ანგარიშ|ვერიფ|შემოწმებ|отч[её]т|верифи|проверк|rapor|doğrulama|تقرير|التحقق|דוח|בדיקה)/u;
/* The person refers to their own property, listing, matches or interested people. */
const REF_MINE = /(my (flat|apartment|house|home|property|properties|listing|listings|ad)|my matches|\bmatch(es)?\b|interested (people|buyers|tenants)|ჩემი (ბინ|სახლ|ქონ|განცხად)|ჩემს (ბინ|სახლ|ქონ|განცხად)|დამთხვევ|დაინტერესებ|мо[яюей] (квартир|дом|недвижим|объявлен)|совпаден|заинтересован|(evim|dairem|ilanım|mülküm)|eşleşme|شقتي|منزلي|عقاري|إعلاني|تطابق|הדירה שלי|הבית שלי|הנכס שלי|המודעה שלי|התאמ)/u;
/* The person refers to their relocation plan (My Georgia). */
const REF_GEORGIA = /(my georgia|moving|relocat|visa|residence|residency|expat|ჩემი საქართველო|გადმოსვლ|გადმოსახლ|ვიზ|ბინადრ|ემიგრ|переезд|переех|виз[аы]|внж|вид на жительство|экспат|taşın|vize|oturma izni|الانتقال|تأشيرة|الإقامة|מעבר|ויזה|תושבות|רילוקיישן)/u;

const SERVICE_SECTIONS: Partial<Record<string, InternalSection[]>> = {
  VERIFY: ['verifications'],
  FIND_BUYERS_TENANTS: ['properties', 'matches'],
  META_ADS: ['properties'],
  FOR_EXPATS: ['myGeorgia'],
};

const SURFACE_SECTIONS: Partial<Record<string, InternalSection[]>> = {
  'my-georgia': ['myGeorgia'],
};

/** Per-section character budgets (whole entries are dropped to fit). */
export const SECTION_BUDGET: Readonly<Record<HomiTier, Readonly<Record<InternalSection, number>>>> = Object.freeze({
  LIGHT: Object.freeze({ verifications: 3000, properties: 3000, matches: 2500, myGeorgia: 2000 }),
  FULL: Object.freeze({ verifications: 6000, properties: 6000, matches: 5000, myGeorgia: 3000 }),
});

/** Page context, history characters and history messages per tier. */
export const TIER_BUDGET: Readonly<Record<HomiTier, { pageContextChars: number; historyChars: number; historyMessages: number; messageChars: number }>> = Object.freeze({
  LIGHT: { pageContextChars: 4000, historyChars: 8000, historyMessages: 12, messageChars: 4000 },
  FULL: { pageContextChars: 12000, historyChars: 20000, historyMessages: 24, messageChars: 12000 },
});

export interface ContextPlanInput {
  tier: HomiTier;
  /** The service the turn policy found in the question (webPolicy.detectService). */
  service: string | null;
  surface?: string | null;
}

/** Which internal sections this turn may fetch. Empty for a generic turn. */
export function planInternalSections(text: string, opts: ContextPlanInput): InternalSection[] {
  const n = normaliseTurn(text);
  const out = new Set<InternalSection>();
  for (const s of SERVICE_SECTIONS[opts.service ?? ''] ?? []) out.add(s);
  for (const s of SURFACE_SECTIONS[opts.surface ?? ''] ?? []) out.add(s);
  if (REF_REPORT.test(n)) out.add('verifications');
  if (REF_MINE.test(n)) { out.add('properties'); out.add('matches'); }
  if (REF_GEORGIA.test(n)) out.add('myGeorgia');
  /* A full (research-shaped) turn about a decision may lean on a report the
     person already has; it is small and it is theirs. */
  if (opts.tier === 'FULL' && out.size === 0 && ['MORTGAGE', 'CONTRACT_INTELLIGENCE', 'INVESTMENT'].includes(opts.service ?? '')) {
    out.add('verifications');
  }
  return [...out];
}

/** Trim every section to its budget by dropping whole entries, so the JSON stays valid. */
export function internalDataForPrompt(data: Partial<Record<InternalSection, unknown[]>>, tier: HomiTier): string {
  const out: Record<string, unknown[]> = {};
  for (const [key, rows] of Object.entries(data)) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const budget = SECTION_BUDGET[tier][key as InternalSection] ?? 2000;
    const kept: unknown[] = [];
    for (const row of rows) {
      kept.push(row);
      if (JSON.stringify(kept).length > budget) { kept.pop(); break; }
    }
    if (kept.length) out[key] = kept;
  }
  return JSON.stringify(out);
}

/* ── Web ──────────────────────────────────────────────────────────────── */

export interface WebBudget { maxToolCalls: number; contextSize: 'low' | 'medium' }

/**
 * How far an open web turn may go. Low context and two calls by default; a
 * company or developer background check, an explicit "check online" and the
 * paid property analysis keep the deeper budget.
 */
export function webBudget(tier: HomiTier, policy: Pick<TurnPolicy, 'reason'>): WebBudget {
  if (policy.reason === 'COMPANY_CHECK' || policy.reason === 'EXPLICIT_WEB' || policy.reason === 'PROPERTY_ANALYSIS') {
    return { maxToolCalls: tier === 'LIGHT' ? 2 : 4, contextSize: 'medium' };
  }
  return { maxToolCalls: tier === 'LIGHT' ? 1 : 2, contextSize: 'low' };
}

/** Reasoning models take `reasoning.effort`; a chat model rejects the field. */
export function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o\d)/i.test(model.trim());
}

/* ── Abuse safeguard (not a quota) ──────────────────────────────────── */

export interface AbuseLimits { perMinute: number; perHour: number; perDay: number; repeatRun: number }

/**
 * The only refusal unlimited HOMI has (chat, and the investment consultant): a
 * gentle "slow down", never a count, a plan, a reset time or an upgrade.
 */
export const HOMI_SLOW_DOWN: Readonly<Record<'ka' | 'en' | 'ru' | 'tr' | 'ar' | 'he', string>> = Object.freeze({
  en: "That's a lot of messages very quickly. Give me a minute and try again.",
  ka: 'ძალიან ბევრი შეტყობინება ძალიან სწრაფად. ერთი წუთით მოიცადე და თავიდან სცადე.',
  ru: 'Слишком много сообщений за короткое время. Подожди минуту и попробуй снова.',
  tr: 'Çok kısa sürede çok fazla mesaj. Bir dakika bekleyip tekrar dene.',
  ar: 'رسائل كثيرة جدًا في وقت قصير. انتظر دقيقة ثم حاول مجددًا.',
  he: 'יותר מדי הודעות בזמן קצר. חכה דקה ונסה שוב.',
});

/** The admin_settings keys of the safeguard, shared by every unlimited HOMI surface. */
export const ABUSE_SETTING_KEYS = Object.freeze({
  perMinute: 'homi_abuse_burst_per_minute',
  perHour: 'homi_abuse_hourly_ceiling',
  perDay: 'homi_abuse_daily_ceiling',
});

/** Owner defaults; each is an admin_settings value (homi_abuse_*). Far above a person typing. */
export const DEFAULT_ABUSE_LIMITS: AbuseLimits = Object.freeze({ perMinute: 20, perHour: 300, perDay: 2000, repeatRun: 6 });

export type AbuseVerdict = 'OK' | 'BURST' | 'SUSTAINED' | 'REPEATING';

/** The same text sent again and again, back to back: a script, not a person. */
export function repeatedRun(userTexts: string[]): number {
  if (!userTexts.length) return 0;
  const last = normaliseTurn(userTexts[userTexts.length - 1]);
  if (!last) return 0;
  let run = 0;
  for (let i = userTexts.length - 1; i >= 0; i--) {
    if (normaliseTurn(userTexts[i]) !== last) break;
    run++;
  }
  return run;
}

export function abuseVerdict(
  counts: { minute: number; hour: number; day: number; repeat: number },
  limits: AbuseLimits = DEFAULT_ABUSE_LIMITS,
): AbuseVerdict {
  if (counts.minute >= limits.perMinute) return 'BURST';
  if (counts.repeat >= limits.repeatRun) return 'REPEATING';
  if (counts.hour >= limits.perHour || counts.day >= limits.perDay) return 'SUSTAINED';
  return 'OK';
}

/** Read limits from settings values, falling back per field to the defaults. */
export function abuseLimitsFrom(v: Partial<Record<keyof AbuseLimits, unknown>>): AbuseLimits {
  const pos = (x: unknown, d: number) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? Math.floor(n) : d; };
  return {
    perMinute: pos(v.perMinute, DEFAULT_ABUSE_LIMITS.perMinute),
    perHour: pos(v.perHour, DEFAULT_ABUSE_LIMITS.perHour),
    perDay: pos(v.perDay, DEFAULT_ABUSE_LIMITS.perDay),
    repeatRun: pos(v.repeatRun, DEFAULT_ABUSE_LIMITS.repeatRun),
  };
}
