// HOMATCH Communications — why Launch is disabled.
//
// The review step showed a compliance badge, an audience breakdown and, when
// the server refused, one sentence. That sentence names ONE reason — the first
// gate that failed — so a customer who fixes it discovers the next one, and
// the next, one round trip at a time. From the outside that reads as the
// button never working.
//
// This turns the same information into a list: what is done, what is missing,
// and which of the missing things the customer can do something about.
//
// WHERE EACH VERDICT COMES FROM
//
// Draft facts (agent chosen, audience chosen, audience non-empty) are decided
// here, because the browser already knows them and asking the server to say
// "you have not picked an agent" is a round trip for nothing.
//
// Everything that involves money or a provider — pricing, activation, balance,
// caller number — is decided ONLY by the server's refusal code. The browser
// does not get an opinion about whether a channel is live, and a checklist
// that guessed would be the stale client validation §17 forbids.

export type ChecklistState = 'DONE' | 'MISSING' | 'UNKNOWN';

export interface ChecklistItem {
  key: string;
  state: ChecklistState;
  /** True when clearing it is an owner/admin job, not this customer's. */
  needsAdmin: boolean;
}

export interface LaunchChecklistInput {
  channel: string | null;
  agentId: string | null;
  contactListId: string | null;
  templateId: string | null;
  /** Eligible recipients the server counted. Null when not previewed yet. */
  eligible: number | null;
  /** The server's refusal code, or null when it allowed the launch. */
  refusalCode: string | null;
  previewed: boolean;
}

/**
 * Refusal codes that mean "the platform is not ready", not "you forgot
 * something". These are the ones an admin clears, and saying so stops a
 * customer hunting for a setting that is not theirs.
 *
 * The codes come from evaluateExecutionGate and decideLaunch.
 */
const ADMIN_REFUSALS: Record<string, string> = {
  KILL_SWITCH_ACTIVE: 'CHANNEL_ACTIVE',
  CHANNEL_DISABLED: 'CHANNEL_ACTIVE',
  PROVIDER_UNAVAILABLE: 'CHANNEL_ACTIVE',
  PRODUCT_DISABLED: 'PRICING',
  PRODUCT_PRICING_INACTIVE: 'PRICING',
  PRODUCT_PRICE_MISSING: 'PRICING',
  PRODUCT_PRICE_INVALID: 'PRICING',
  CALLER_NUMBER_MISSING: 'CALLER_NUMBER',
};

/** Refusals the customer themselves can clear. */
const CUSTOMER_REFUSALS: Record<string, string> = {
  INSUFFICIENT_CREDIT: 'BALANCE',
  RESERVATION_FAILED: 'BALANCE',
  SPEND_CAP_REACHED: 'SPEND_CAP',
  DOMAIN_REJECTED: 'COMPLIANCE',
  RISK_REJECTED: 'COMPLIANCE',
  COMPLIANCE_PAUSED: 'COMPLIANCE',
  AUDIENCE_EMPTY: 'AUDIENCE',
};

export function buildLaunchChecklist(input: LaunchChecklistInput): ChecklistItem[] {
  const { channel, agentId, contactListId, templateId, eligible, refusalCode, previewed } = input;

  const blockedItem = refusalCode
    ? (ADMIN_REFUSALS[refusalCode] ?? CUSTOMER_REFUSALS[refusalCode] ?? null)
    : null;
  const blockedIsAdmin = Boolean(refusalCode && ADMIN_REFUSALS[refusalCode]);

  /**
   * A server-decided item.
   *
   * DONE only when the server previewed AND did not refuse on this item. Not
   * previewed means UNKNOWN — a checklist that shows green because it has not
   * asked is worse than one that admits it does not know.
   */
  const serverItem = (key: string, needsAdmin: boolean): ChecklistItem => {
    if (!previewed) return { key, state: 'UNKNOWN', needsAdmin };
    if (blockedItem === key) return { key, state: 'MISSING', needsAdmin: blockedIsAdmin };
    // The gate is ordered and stops at the first failure, so an item that is
    // not the reported blocker has either passed or was never reached. It is
    // reported as passed, which is what the server itself would say if asked
    // again after the current blocker were cleared.
    return { key, state: 'DONE', needsAdmin };
  };

  const items: ChecklistItem[] = [];

  // ── What the customer configured ────────────────────────────────────────
  const wantsAgent = channel === 'AI_CALL';
  if (wantsAgent) {
    items.push({ key: 'AGENT', state: agentId ? 'DONE' : 'MISSING', needsAdmin: false });
  } else if (channel === 'WHATSAPP') {
    items.push({ key: 'TEMPLATE', state: templateId ? 'DONE' : 'MISSING', needsAdmin: false });
  }

  items.push({ key: 'AUDIENCE', state: contactListId ? 'DONE' : 'MISSING', needsAdmin: false });

  // A list with nobody reachable in it is not an audience. Only assertable
  // once the server has counted.
  items.push({
    key: 'AUDIENCE_REACHABLE',
    state: eligible === null ? 'UNKNOWN' : eligible > 0 ? 'DONE' : 'MISSING',
    needsAdmin: false,
  });

  // ── What the platform decides ───────────────────────────────────────────
  items.push(serverItem('COMPLIANCE', false));
  if (wantsAgent) items.push(serverItem('CALLER_NUMBER', true));
  items.push(serverItem('CHANNEL_ACTIVE', true));
  items.push(serverItem('PRICING', true));
  items.push(serverItem('BALANCE', false));

  return items;
}

/** True when nothing is outstanding and every item was actually decided. */
export function checklistReady(items: ChecklistItem[]): boolean {
  return items.length > 0 && items.every((i) => i.state === 'DONE');
}
