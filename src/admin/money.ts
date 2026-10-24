// HOMATCH Admin — how money reads on an admin screen.
//
// Pure, framework-free formatting so every admin tile says the same thing the
// same way, and so tests can hold it (src/admin/__tests__/adminMoney.test.mjs):
//
//   · USD is always "$1,234.56" (four decimals under a dollar, where unit
//     costs live), never a bare number;
//   · a credit amount always carries its unit, and 10 credits = $1
//     (docs/claude/BILLING.md);
//   · an unknown value (null: no data, or a cost nobody priced) is NOT zero.
//     It is returned as null so the screen can say "unknown" out loud.

/** 10 credits = $1. The product invariant; the database setting credits_per_usd defaults to it. */
export const CREDITS_PER_USD = 10;

/** A finite number, or null for null / undefined / '' / NaN. Never coerces "unknown" into 0. */
export function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** "$1,234.56"; amounts under a dollar keep four decimals ("$0.0123"). Null reads as "—". */
export function formatUsd(v: unknown): string {
  const n = toNumber(v);
  if (n === null) return '—';
  const abs = Math.abs(n);
  const digits = abs > 0 && abs < 1 ? 4 : 2;
  const body = abs.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${n < 0 ? '-' : ''}$${body}`;
}

/** US cents (numeric, possibly fractional) as dollars. */
export function centsToUsd(cents: unknown): number | null {
  const n = toNumber(cents);
  return n === null ? null : n / 100;
}

/** Credits as dollars at 10 credits = $1. */
export function creditsToUsd(credits: unknown, creditsPerUsd: number = CREDITS_PER_USD): number | null {
  const n = toNumber(credits);
  if (n === null || !(creditsPerUsd > 0)) return null;
  return n / creditsPerUsd;
}

/** The bare credit number, grouped, up to two decimals. Pair it with the unit label (see formatCredits). */
export function creditNumber(v: unknown): string | null {
  const n = toNumber(v);
  if (n === null) return null;
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/**
 * A credit amount with its unit. `withUnit` is the translated template, e.g.
 * (n) => t('admin_hs_credits_n', { n }); unknown reads as "—", not "0 credits".
 */
export function formatCredits(v: unknown, withUnit: (n: string) => string): string {
  const n = creditNumber(v);
  return n === null ? '—' : withUnit(n);
}

/**
 * Average cost of one model turn: priced cost divided by the PRICED model
 * turns only. Dividing by every turn (deterministic answers, unpriced or
 * cancelled ones) would understate it. Prefers the server's own figure
 * (homi_usage_summary.totals.cost_per_model_turn_usd); null when no turn was
 * priced, which is unknown, not $0.
 */
export function costPerModelTurnUsd(totals: {
  cost_usd?: unknown;
  priced_model_turns?: unknown;
  cost_per_model_turn_usd?: unknown;
} | null | undefined): number | null {
  if (!totals) return null;
  const server = toNumber(totals.cost_per_model_turn_usd);
  if (server !== null) return server;
  const priced = toNumber(totals.priced_model_turns);
  const cost = toNumber(totals.cost_usd);
  if (priced === null || priced <= 0 || cost === null) return null;
  return cost / priced;
}

/** Cost per conversation; null when there were no conversations. */
export function costPerConversationUsd(totals: {
  cost_usd?: unknown;
  conversations?: unknown;
  cost_per_conversation_usd?: unknown;
} | null | undefined): number | null {
  if (!totals) return null;
  const server = toNumber(totals.cost_per_conversation_usd);
  if (server !== null) return server;
  const n = toNumber(totals.conversations);
  const cost = toNumber(totals.cost_usd);
  if (n === null || n <= 0 || cost === null) return null;
  return cost / n;
}

/**
 * A margin as either a known percentage or an explicit UNKNOWN. Unknown COGS
 * (docs/claude/BILLING.md: "never silently zero") arrives as null and must be
 * shown as a warning, never as 0% or a blank.
 */
export type MarginState = { kind: 'unknown' } | { kind: 'known'; pct: number; text: string };

export function marginState(pct: unknown, digits = 1): MarginState {
  const n = toNumber(pct);
  if (n === null) return { kind: 'unknown' };
  return { kind: 'known', pct: n, text: `${n.toFixed(digits)}%` };
}
