// THE PUBLISHING BROWSER WORKER — shared contract.
//
// One adapter per portal drives the portal's REAL UI in Chromium through the
// HOMATCH account's session, the way a person would: navigate, choose, type,
// upload, check, submit. Adapters are deterministic: known controls found by the
// labels / names recorded during the owner's MCP exploration, each required to
// match exactly ONE visible control — a missing or ambiguous control stops the
// operation with a code instead of guessing. No CAPTCHA, MFA or anti-bot control
// is ever bypassed: those stop the operation for a person.

import type { Page } from 'playwright';

export const OP_KINDS = ['CREATE', 'STATUS', 'UPDATE', 'PRICE', 'DESCRIPTION', 'PHOTOS', 'PAUSE', 'REACTIVATE', 'DELETE', 'CHECK_SESSION'] as const;
export type OpKind = typeof OP_KINDS[number];
export type Level = 'NOT_EXPLORED' | 'FIXTURE_TESTED' | 'LIVE_NAVIGATION_VERIFIED' | 'LIVE_OPERATION_VERIFIED';

export interface CentralCopy { title: string; description: string; footer: string; contactPhone: string | null }
export interface TaskListing {
  version: number; propertyType: string; dealType: string; price: number | null; currency: string;
  area: number | null; rooms: number | null; bedrooms: number | null; bathrooms: number | null; floor: number | null; totalFloors: number | null;
  condition: string; city: string; district: string; street: string; streetNumber: string; amenities: string[]; title: string; ownerName: string;
}
/** One claimed operation, as publishing-worker's claim returns it. */
export interface Task {
  id: string; leaseToken: string; kind: OpKind; portalId: string; attempt: number;
  /** The operation had already pressed the portal's publish button in an earlier attempt. */
  submitAlreadyStarted: boolean;
  session: { cookies: any[]; origins: any[] } | null;
  account: { contactPhone: string | null; liveSubmitApproved: boolean };
  portal: { createUrl: string; domains: string[]; maxPhotos: number | null };
  listing?: TaskListing;
  copies?: Partial<Record<'ka' | 'en' | 'ru', CentralCopy>>;
  photos?: Array<{ id: string; url: string }>;
  publication?: { externalId: string | null; externalUrl: string | null; status: string };
}
export interface Photo { name: string; mimeType: string; buffer: Buffer }

export type Outcome = 'SUCCEEDED' | 'PREPARED' | 'FAILED' | 'BLOCKED' | 'RECONCILIATION_REQUIRED';
export interface OpResult {
  outcome: Outcome;
  error?: string;
  retryable?: boolean;
  result?: { externalUrl?: string; externalId?: string; state?: 'LIVE' | 'GONE' | 'UNKNOWN'; fields?: string[] };
}

export interface OpContext {
  page: Page;
  task: Task;
  photos: Photo[];
  /** Record progress (and extend the lease). */
  stage(name: string): Promise<void>;
  screenshot(stage: string): Promise<void>;
  /** The one-way door before the final publish click. False: never click. */
  markSubmitting(): Promise<boolean>;
  /** Human pacing between actions (not detection evasion — just not instant). */
  pause(ms?: number): Promise<void>;
}

export interface PortalAdapter {
  id: string;
  capabilities: Record<OpKind, Level>;
  /** Is the HOMATCH account signed in? Must look at the real page. */
  checkSession(page: Page, task: Task): Promise<'VALID' | 'AUTH_REQUIRED' | 'UNKNOWN'>;
  run(kind: OpKind, ctx: OpContext): Promise<OpResult>;
}

/** A stop with a reason. `retryable` only for transient conditions (timeouts, portal errors). */
export class StopError extends Error {
  constructor(public code: string, public retryable = false, public outcome: Outcome = 'BLOCKED') { super(code); }
}
export const blocked = (code: string) => new StopError(code, false, 'BLOCKED');
