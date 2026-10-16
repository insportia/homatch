/*
 * LEADS CRM — the pure rules behind the page.
 *
 * Statuses, what counts as a due follow-up, where an action navigates, how an activity
 * event is described, and the CSV export. No React, no Supabase, no `@/` imports, so the
 * suites in src/crm/__tests__ load this file directly.
 *
 * THE EXPORT CARRIES ONLY WHAT THE LIST SHOWS.
 *
 * An unlock may entitle the owner to a phone or email in the conversation, but the CRM
 * list never carries one, and the CSV is built from an explicit column allowlist rather
 * than by spreading a row — so a contact field added to a row later still cannot reach a
 * file that leaves the product.
 */

import type { CrmStatus } from './nextStep.ts';

export const CRM_STATUSES: readonly CrmStatus[] = [
  'UNLOCKED',
  'CONTACTED',
  'DELIVERED',
  'REPLIED',
  'INTERESTED',
  'VIEWING_SCHEDULED',
  'CLOSED',
  'NOT_INTERESTED',
] as const;

export function isCrmStatus(value: unknown): value is CrmStatus {
  return typeof value === 'string' && (CRM_STATUSES as readonly string[]).includes(value);
}

export function statusLabelKey(status: string): string {
  return isCrmStatus(status) ? `crm_status_${status}` : 'crm_status_unknown';
}

export type CrmTone = 'confirmed' | 'attention' | 'risk' | 'quiet';

/** Pill tone: green only for an outcome the owner recorded, gold for "wants you". */
export function statusTone(status: string): CrmTone {
  switch (status) {
    case 'REPLIED':
    case 'INTERESTED':
    case 'VIEWING_SCHEDULED':
      return 'attention';
    case 'CLOSED':
      return 'confirmed';
    default:
      return 'quiet';
  }
}

export function isFollowUpDue(followUpAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!followUpAt) return false;
  const at = Date.parse(followUpAt);
  return Number.isFinite(at) && at <= now;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The `?entry=` deep link, accepted only when it is a UUID. */
export function parseEntryParam(value: string | null | undefined): string | null {
  const v = String(value ?? '').trim();
  return UUID.test(v) ? v.toLowerCase() : null;
}

export function conversationHref(conversationId: string): string {
  return `/chat?conversation=${encodeURIComponent(conversationId)}`;
}

/**
 * Email Studio for one or more entries. The property is passed only when every
 * selected entry is about the same property — guessing one would draft the wrong offer.
 */
export function emailStudioHref(
  entries: ReadonlyArray<{ entryId: string; propertyId: string | null }>,
): string | null {
  const ids = [...new Set(entries.map((e) => e.entryId).filter(Boolean))];
  if (ids.length === 0) return null;
  const properties = [...new Set(entries.map((e) => e.propertyId ?? ''))];
  const params = new URLSearchParams();
  if (properties.length === 1 && properties[0]) params.set('property', properties[0]);
  params.set('entries', ids.join(','));
  return `/email-studio?${params.toString().replace(/%2C/gi, ',')}`;
}

/* ────────────────────────────────────────────────────────────────────────
 * Activity events
 * ──────────────────────────────────────────────────────────────────────── */

export const KNOWN_EVENT_KINDS = [
  'UNLOCKED',
  'CONVERSATION_OPENED',
  'STATUS_CHANGED',
  'NOTE_ADDED',
  'FOLLOW_UP_SCHEDULED',
  'FOLLOW_UP_CLEARED',
  'EMAIL_SENT',
  'EMAIL_DELIVERED',
  'EMAIL_BOUNCED',
  'EMAIL_OPENED',
  'EMAIL_CLICKED',
] as const;

export interface CrmEventLike {
  kind: string;
  detail?: Record<string, unknown> | null;
}

export interface EventDescription {
  /** Translation key for the line. */
  key: string;
  /** Variables for that key. Status values are already label keys (`*Key`). */
  vars: Record<string, string>;
  /** True when the system (not the owner) made the change. */
  automatic: boolean;
  /** When the event carries a timestamp of its own (a scheduled follow-up). */
  at: string | null;
}

/** "EMAIL_SOMETHING_NEW" → "email something new", for kinds this build has no key for. */
export function humanizeKind(kind: string): string {
  return String(kind ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function describeEvent(event: CrmEventLike): EventDescription {
  const kind = String(event.kind ?? '').toUpperCase();
  const detail = (event.detail && typeof event.detail === 'object' ? event.detail : {}) as Record<string, unknown>;
  const automatic = detail.by === 'SYSTEM';
  if (kind === 'STATUS_CHANGED') {
    return {
      key: 'crm_event_STATUS_CHANGED',
      vars: {
        fromKey: statusLabelKey(String(detail.from ?? '')),
        toKey: statusLabelKey(String(detail.to ?? '')),
      },
      automatic,
      at: null,
    };
  }
  if (kind === 'FOLLOW_UP_SCHEDULED') {
    return { key: 'crm_event_FOLLOW_UP_SCHEDULED', vars: {}, automatic, at: typeof detail.at === 'string' ? detail.at : null };
  }
  if ((KNOWN_EVENT_KINDS as readonly string[]).includes(kind)) {
    return { key: `crm_event_${kind}`, vars: {}, automatic, at: null };
  }
  return { key: 'crm_event_generic', vars: { kind: humanizeKind(kind) }, automatic, at: null };
}

/* ────────────────────────────────────────────────────────────────────────
 * CSV export
 * ──────────────────────────────────────────────────────────────────────── */

export interface CrmCsvRow {
  displayName?: string | null;
  status?: string | null;
  propertyTitle?: string | null;
  homatchId?: number | string | null;
  lastActivityAt?: string | null;
  followUpAt?: string | null;
}

export interface CrmCsvOptions {
  headers: {
    name: string;
    status: string;
    property: string;
    homatchId: string;
    lastActivity: string;
    followUp: string;
  };
  statusLabel: (status: string) => string;
  formatDate: (iso: string) => string;
  /** Shown when a member chose not to show a name. */
  anonymous: string;
}

/** The only columns that can ever leave in a CSV. Phone and email are not among them. */
export const CRM_CSV_COLUMNS = ['name', 'status', 'property', 'homatchId', 'lastActivity', 'followUp'] as const;

/** Quotes a cell and defuses spreadsheet formulas (=, +, -, @, tab, CR at the start). */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function buildCrmCsv(rows: ReadonlyArray<CrmCsvRow>, opts: CrmCsvOptions): string {
  const h = opts.headers;
  const lines = [[h.name, h.status, h.property, h.homatchId, h.lastActivity, h.followUp].map(csvCell).join(',')];
  for (const row of rows) {
    const cells = [
      row.displayName ? row.displayName : opts.anonymous,
      row.status ? opts.statusLabel(row.status) : '',
      row.propertyTitle ?? '',
      row.homatchId === null || row.homatchId === undefined ? '' : String(row.homatchId),
      row.lastActivityAt ? opts.formatDate(row.lastActivityAt) : '',
      row.followUpAt ? opts.formatDate(row.followUpAt) : '',
    ];
    lines.push(cells.map(csvCell).join(','));
  }
  /* BOM so spreadsheet apps read Georgian, Arabic and Hebrew as UTF-8. */
  return `﻿${lines.join('\r\n')}\r\n`;
}

/* ────────────────────────────────────────────────────────────────────────
 * Follow-up input
 * ──────────────────────────────────────────────────────────────────────── */

/** `<input type="datetime-local">` value (local time) → ISO, or null when unusable. */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** ISO → `<input type="datetime-local">` value in the browser's local time. */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
