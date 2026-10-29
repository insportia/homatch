// EMAIL MARKETING PAUSE GATE — the pure decisions behind "hidden and closed while off,
// nothing lost" (owner, 2026-10-29; service key `email_marketing`, fail closed;
// migration 20261207140000). Kept free of Deno and network imports so Node tests run
// the real code.

/** email-marketing actions that stay open while the service is off: the admin's read-only
    provider usage snapshot (Resend GET /usage, which transactional monitoring also uses). */
export const EMAIL_MARKETING_OPEN_WHILE_OFF: ReadonlySet<string> = new Set(['usage_refresh']);

/** Does this email-marketing request need the service ON? (cron actions are decided apart.) */
export function emailMarketingActionGated(action: string): boolean {
  return !EMAIL_MARKETING_OPEN_WHILE_OFF.has(action);
}

/**
 * Which outreach-send `studio_*` actions belong to Email Marketing. Every Email Studio action
 * does (render, review, generate, test, send). The CRM lead-draft helper writes chat, WhatsApp,
 * Telegram and SMS messages too; only its EMAIL channel is Email Marketing.
 */
export function studioActionNeedsEmailMarketing(body: Record<string, unknown>): boolean {
  const action = String(body.action ?? '');
  if (action === 'studio_lead_draft') return String(body.channel ?? '').toUpperCase() === 'EMAIL';
  return action.startsWith('studio_');
}

/** A sender's refusal because the campaign's service is paused (Service Control Center). */
export function isServiceDisabledReply(body: unknown): boolean {
  return Boolean(body) && typeof body === 'object' && (body as { code?: unknown }).code === 'SERVICE_DISABLED';
}

interface UpdateChain {
  from: (table: string) => {
    update: (row: Record<string, unknown>) => { eq: (c: string, v: unknown) => { eq: (c: string, v: unknown) => PromiseLike<unknown> } };
  };
}

/**
 * Undo a jobs-worker claim the sender refused because the service is paused. The work is
 * preserved, never failed: a campaign the claim moved SCHEDULED → RUNNING goes back to
 * SCHEDULED (its time kept), and one that was already RUNNING is left exactly as it was.
 * Both continue on the first tick after the service is back on.
 */
export async function rearmPausedCampaign(sb: UpdateChain, campaignId: string, wasRunning: boolean, now = new Date()): Promise<'KEPT_RUNNING' | 'RESCHEDULED'> {
  if (wasRunning) return 'KEPT_RUNNING';
  await sb.from('outreach_campaigns')
    .update({ status: 'SCHEDULED', last_send_error: 'SERVICE_DISABLED', updated_at: now.toISOString() })
    .eq('id', campaignId).eq('status', 'RUNNING');
  return 'RESCHEDULED';
}
