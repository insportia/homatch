// META ADS — WHAT A STATUS CHANGE SEEN AT RECONCILIATION MEANS, AND WHO CAUSED
// IT, as far as the evidence proves. Pure.
//
// Reconciliation compares the status HOMATCH held before a sync with the one
// Meta's answer maps to. HOMATCH's own commands are recorded operations (and
// write their status immediately), so a change with no recent HOMATCH
// operation happened OUTSIDE HOMATCH. Meta does not say who clicked, so the
// words never name a person or a tool beyond that; a transition nothing can
// attribute gets neutral words.
//
//   provenance        when
//   HOMATCH_COMMAND   a HOMATCH pause/resume/end/edit was recorded recently
//   EXTERNAL_CHANGE   paused or resumed with no HOMATCH command (Meta never
//                     switches a campaign off or on by itself)
//   META_LIFECYCLE    Meta approved it (review → active) or its end time passed
//   META_ENFORCEMENT  Meta rejected it
//   UNKNOWN           anything else
export type Provenance = 'HOMATCH_COMMAND' | 'EXTERNAL_CHANGE' | 'META_LIFECYCLE' | 'META_ENFORCEMENT' | 'UNKNOWN';
export type StatusChangeKind = 'ACTIVATED' | 'PAUSED' | 'RESUMED' | 'COMPLETED' | 'REJECTED' | 'OTHER';

export interface StatusChange { kind: StatusChangeKind; provenance: Provenance; from: string; to: string }

/** The operations that mean "HOMATCH did this" (meta_operations.op). */
export const HOMATCH_COMMAND_OPS = ['PAUSE', 'RESUME', 'END', 'PAUSE_AD', 'RESUME_AD', 'EDIT_BUDGET', 'EDIT_DURATION', 'APPLY_RECOMMENDATION'];
/** How long after a HOMATCH command a matching change is still its echo. */
export const COMMAND_ECHO_MINUTES = 30;

const REVIEWING = ['SUBMITTED', 'META_REVIEW', 'LAUNCHING'];

/** `homatchCommandRecently: null` = the operations log could not be read, so nothing is attributed. */
export function classifyStatusChange(from: string, to: string, ctx: { homatchCommandRecently: boolean | null; endTimePassed?: boolean }): StatusChange | null {
  if (!from || !to || from === to) return null;
  const base = { from, to };
  if (ctx.homatchCommandRecently === null && to !== 'REJECTED' && !(to === 'ACTIVE' && REVIEWING.includes(from))) {
    return { ...base, kind: to === 'PAUSED' ? 'PAUSED' : to === 'COMPLETED' ? 'COMPLETED' : to === 'ACTIVE' ? 'RESUMED' : 'OTHER', provenance: 'UNKNOWN' };
  }
  if (to === 'REJECTED') return { ...base, kind: 'REJECTED', provenance: 'META_ENFORCEMENT' };
  if (to === 'PAUSED') return { ...base, kind: 'PAUSED', provenance: ctx.homatchCommandRecently ? 'HOMATCH_COMMAND' : 'EXTERNAL_CHANGE' };
  if (to === 'ACTIVE' && from === 'PAUSED') return { ...base, kind: 'RESUMED', provenance: ctx.homatchCommandRecently ? 'HOMATCH_COMMAND' : 'EXTERNAL_CHANGE' };
  if (to === 'ACTIVE' && REVIEWING.includes(from)) return { ...base, kind: 'ACTIVATED', provenance: 'META_LIFECYCLE' };
  if (to === 'COMPLETED') {
    return { ...base, kind: 'COMPLETED', provenance: ctx.endTimePassed ? 'META_LIFECYCLE' : ctx.homatchCommandRecently ? 'HOMATCH_COMMAND' : 'UNKNOWN' };
  }
  return { ...base, kind: 'OTHER', provenance: ctx.homatchCommandRecently ? 'HOMATCH_COMMAND' : 'UNKNOWN' };
}

/**
 * The customer event a change becomes, or null when nothing should be sent:
 * HOMATCH's own commands are already confirmed on screen, and REJECTED and
 * COMPLETED have their own events (CAMPAIGN_REJECTED, CAMPAIGN_STOPPED).
 */
export function statusChangeEvent(ch: StatusChange | null):
  | null | { type: 'CAMPAIGN_PAUSED_OUTSIDE' | 'CAMPAIGN_RESUMED_OUTSIDE' | 'CAMPAIGN_ACTIVATED' | 'CAMPAIGN_STATUS_CHANGED'; severity: 'INFO' | 'IMPORTANT' } {
  if (!ch || ch.provenance === 'HOMATCH_COMMAND') return null;
  if (ch.kind === 'REJECTED' || ch.kind === 'COMPLETED') return null;
  // Unattributable: neutral words, never "changed outside HOMATCH".
  if (ch.provenance === 'UNKNOWN') return { type: 'CAMPAIGN_STATUS_CHANGED', severity: 'IMPORTANT' };
  if (ch.kind === 'PAUSED') return { type: 'CAMPAIGN_PAUSED_OUTSIDE', severity: 'IMPORTANT' };
  if (ch.kind === 'RESUMED') return { type: 'CAMPAIGN_RESUMED_OUTSIDE', severity: 'IMPORTANT' };
  if (ch.kind === 'ACTIVATED') return { type: 'CAMPAIGN_ACTIVATED', severity: 'IMPORTANT' };
  return { type: 'CAMPAIGN_STATUS_CHANGED', severity: 'INFO' };
}
