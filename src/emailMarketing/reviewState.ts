// EMAIL CAMPAIGN REVIEW STATE — one vocabulary for the server gate and the Email Studio UI.
//
// The database keeps its historical status values (REVIEW_REQUIRED, RUNNING, COMPLETED) next to
// the review states added for Email Studio (migration 20261127120000). The UI speaks one set of
// phases; this file is the only translation, so a label can never disagree with the gate.
//
// THE GATE (owner brief §10): an email campaign is dispatched only when it is APPROVED,
// SCHEDULED or already RUNNING/PAUSED from an approved send, AND the content it was approved
// with is the content it has now (approved_content_hash === content_hash; the hash is kept by a
// database trigger over subject, preview, HTML, text, sender, reply-to, audience and language).
// A legacy simulated campaign never sends. This is enforced in outreach-send and jobs-worker;
// the UI only mirrors it.

export type EmailPhase =
  | 'DRAFT' | 'READY_FOR_REVIEW' | 'UNDER_REVIEW' | 'CHANGES_REQUESTED' | 'APPROVED' | 'REJECTED'
  | 'SCHEDULED' | 'SENDING' | 'SENT' | 'PARTIALLY_SENT' | 'FAILED' | 'PAUSED' | 'CANCELLED';

const PHASE_OF: Record<string, EmailPhase> = {
  DRAFT: 'DRAFT', READY: 'DRAFT',
  READY_FOR_REVIEW: 'READY_FOR_REVIEW', UNDER_REVIEW: 'UNDER_REVIEW', REVIEW_REQUIRED: 'UNDER_REVIEW',
  CHANGES_REQUESTED: 'CHANGES_REQUESTED', APPROVED: 'APPROVED', REJECTED: 'REJECTED',
  SCHEDULED: 'SCHEDULED', RUNNING: 'SENDING', COMPLETED: 'SENT', PARTIALLY_SENT: 'PARTIALLY_SENT',
  FAILED: 'FAILED', PAUSED: 'PAUSED', COMPLIANCE_PAUSED: 'PAUSED', CANCELLED: 'CANCELLED',
};

export function emailPhase(status: string | null | undefined): EmailPhase {
  return PHASE_OF[String(status ?? '').toUpperCase()] ?? 'DRAFT';
}

/** Content can be edited (an edit of a submitted/approved campaign returns it to DRAFT). */
export function isEditable(status: string | null | undefined): boolean {
  return ['DRAFT', 'READY_FOR_REVIEW', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'SCHEDULED']
    .includes(emailPhase(status));
}

/** Material edits of these phases drop the approval (mirrors the database guard). */
export function editDropsApproval(status: string | null | undefined): boolean {
  return ['READY_FOR_REVIEW', 'UNDER_REVIEW', 'APPROVED', 'SCHEDULED'].includes(emailPhase(status));
}

/** Where a campaign opens: a draft in the editor (on the step it needs), anything else in its details. */
export function campaignPath(c: { id: string; status: string | null | undefined }): string {
  const p = emailPhase(c.status);
  if (p === 'DRAFT' || p === 'CHANGES_REQUESTED' || p === 'REJECTED') return `/outreach/email/campaigns/${c.id}?step=design`;
  if (p === 'READY_FOR_REVIEW' || p === 'UNDER_REVIEW') return `/outreach/email/campaigns/${c.id}?step=review`;
  return `/outreach/email/campaigns/${c.id}/overview`;
}

export interface GateInput {
  status: string | null;
  content_hash: string | null;
  approved_content_hash: string | null;
  send_eligibility?: string | null;
  risk_level?: string | null;
}

export type GateReason =
  | 'LEGACY_MOCK' | 'NOT_APPROVED' | 'APPROVAL_STALE' | 'BLOCKED' | 'FINISHED';

export function emailSendGate(c: GateInput): { ok: true } | { ok: false; reason: GateReason } {
  if (c.send_eligibility === 'LEGACY_MOCK') return { ok: false, reason: 'LEGACY_MOCK' };
  if (String(c.risk_level ?? '').toUpperCase() === 'BLOCKED') return { ok: false, reason: 'BLOCKED' };
  const phase = emailPhase(c.status);
  if (phase === 'SENT' || phase === 'CANCELLED') return { ok: false, reason: 'FINISHED' };
  if (!['APPROVED', 'SCHEDULED', 'SENDING', 'PAUSED', 'PARTIALLY_SENT'].includes(phase)) return { ok: false, reason: 'NOT_APPROVED' };
  if (!c.approved_content_hash) return { ok: false, reason: 'NOT_APPROVED' };
  if (!c.content_hash || c.content_hash !== c.approved_content_hash) return { ok: false, reason: 'APPROVAL_STALE' };
  return { ok: true };
}
