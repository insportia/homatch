// THE CENTRAL ENGINE — HOMATCH publishes through its OWN portal accounts. Pure:
// no Deno or network APIs, so node:test runs it.
//
// An admin registers, per portal, the HOMATCH account (its identity and the
// HOMATCH contact phone every listing it posts carries). A customer clicks
// "Publish to Selected Portals"; routeFor() decides, per portal, where that
// publication starts:
//
//   QUEUED                 an adapter with a VERIFIED, permitted mechanism (API or
//                          browser-assisted) and an account verified against the
//                          real portal will post it. No portal qualifies today.
//   ADMIN_ACTION_REQUIRED  a HOMATCH administrator posts it by hand in the HOMATCH
//                          account, then links the resulting listing URL; the
//                          public-page check (or, where HOMATCH may not fetch,
//                          the admin's attestation) confirms it.
//   AUTH_REQUIRED          the HOMATCH account for that portal is not usable yet
//                          (not registered, session expired); it waits, and is
//                          rerouted the moment an admin registers the account.
//
// THE TWO CONTACT IDENTITIES NEVER TRADE PLACES. A HOMATCH-account copy carries the
// HOMATCH account's phone in the portal's contact field and the owner's name and
// phone ONLY in the footer at the end of the description, once, with consent.
//
// Account status is never "verified" by assertion: CONNECTED / PUBLISHING_AVAILABLE
// come only from an adapter's verifyAccount() against the real account (and the
// database refuses them without a verification timestamp). No adapter has a
// verified mechanism, so testing an account answers CAPABILITY_NOT_SUPPORTED and
// the account stays PUBLISHING_RESTRICTED: registered, posted to by hand.

import { type FooterLang, formatPhone, isE164, ownerFooter, stripFooter, withOwnerFooter } from './contacts.ts';
import { type Listing, type Route, ownerOf } from './domain.ts';
import { hasBrowserCreate } from './automation.ts';
import type { ProviderConfig } from './providers.ts';

export const ACCOUNT_STATUSES = [
  'NOT_CONFIGURED', 'CONNECTED', 'AUTH_REQUIRED', 'SESSION_EXPIRED',
  'PUBLISHING_AVAILABLE', 'PUBLISHING_RESTRICTED', 'TEMPORARILY_UNAVAILABLE', 'UNSUPPORTED',
] as const;
export type AccountStatus = typeof ACCOUNT_STATUSES[number];
export const CONNECTION_METHODS = ['API', 'BROWSER_SESSION', 'MANUAL'] as const;
export type ConnectionMethod = typeof CONNECTION_METHODS[number];

/** One row of public.publishing_accounts. `credential` is ciphertext and never leaves the server. */
export interface AccountRow {
  portal_id: string;
  status: AccountStatus;
  connection_method: ConnectionMethod | null;
  account_label: string | null;
  contact_phone: string | null;
  credential?: unknown;
  credential_set_at: string | null;
  session_expires_at: string | null;
  verified_at: string | null;
  verification_result: string | null;
  last_published_at: string | null;
  failure_count: number;
  last_error: string | null;
  automation_enabled?: boolean;
  live_submit_approved?: boolean;
  live_submit_approved_at?: string | null;
  updated_at: string | null;
}

/** Every column except the credential, which no read path selects. */
export const ACCOUNT_COLUMNS = 'portal_id,status,connection_method,account_label,contact_phone,credential_set_at,session_expires_at,verified_at,verification_result,last_published_at,failure_count,last_error,automation_enabled,live_submit_approved,live_submit_approved_at,updated_at';

/** The account as an admin sees it: no credential, only whether one is stored. */
export function accountView(row: AccountRow | null | undefined, portalId: string) {
  const r = row ?? emptyAccount(portalId);
  const { credential: _secret, ...rest } = r as AccountRow & { credential?: unknown };
  return { ...rest, hasCredential: !!r.credential_set_at };
}

export function emptyAccount(portalId: string): AccountRow {
  return {
    portal_id: portalId, status: 'NOT_CONFIGURED', connection_method: null, account_label: null, contact_phone: null,
    credential_set_at: null, session_expires_at: null, verified_at: null, verification_result: null,
    last_published_at: null, failure_count: 0, last_error: null, automation_enabled: false, live_submit_approved: false, live_submit_approved_at: null, updated_at: null,
  };
}

/** Whether the account's session has run out (when it has one). */
export const sessionExpired = (a: AccountRow, now: Date) => !!a.session_expires_at && Date.parse(a.session_expires_at) <= now.getTime();

/** What an account's status should be after it is registered or edited — never a verified one. */
export function registeredStatus(config: ProviderConfig, a: Pick<AccountRow, 'account_label' | 'contact_phone'>): AccountStatus {
  if (!a.account_label || !a.contact_phone) return 'NOT_CONFIGURED';
  if (config.capabilities.automation === 'BLOCKED') return 'UNSUPPORTED';
  // An automatable portal waits for a successful test against the real account.
  if (config.capabilities.automation === 'API' || config.capabilities.automation === 'BROWSER_ASSISTED') return 'AUTH_REQUIRED';
  return 'PUBLISHING_RESTRICTED';
}

/** Where a new central publication on this portal starts, or why it cannot. */
export function routeFor(config: ProviderConfig, account: AccountRow | null, now: Date): { route: Route } | { error: string } {
  if (!config.enabled) return { error: 'PORTAL_DISABLED' };
  if (config.capabilities.automation === 'BLOCKED' || account?.status === 'UNSUPPORTED') return { error: 'PORTAL_UNSUPPORTED' };
  if (!account || ['NOT_CONFIGURED', 'AUTH_REQUIRED', 'SESSION_EXPIRED'].includes(account.status) || sessionExpired(account, now)) return { route: 'AUTH_REQUIRED' };
  const automatable = config.capabilities.automation === 'API' || config.capabilities.automation === 'BROWSER_ASSISTED';
  if (automatable && account.status === 'PUBLISHING_AVAILABLE' && account.verified_at) return { route: 'QUEUED' };
  // The backend browser worker: a portal with a browser adapter, an account whose
  // captured session the worker verified against the real portal, and the owner's
  // automation switch on.
  if (hasBrowserCreate(config.id) && account.automation_enabled && account.verified_at && ['CONNECTED', 'PUBLISHING_AVAILABLE'].includes(account.status)) return { route: 'QUEUED' };
  return { route: 'ADMIN_ACTION_REQUIRED' };
}

/** An admin's account form → columns to write, or the first reason it is refused. */
export function sanitizeAccountPatch(raw: Record<string, unknown>): { patch: { account_label: string; contact_phone: string; connection_method: ConnectionMethod } } | { error: string } {
  const label = typeof raw.accountLabel === 'string' ? raw.accountLabel.replace(/\s+/g, ' ').trim() : '';
  if (!label || label.length > 120) return { error: 'ACCOUNT_LABEL_REQUIRED' };
  // The identity is a login name or e-mail — never a password-looking secret field.
  if (/password|passwd|pwd\s*[:=]/i.test(label)) return { error: 'ACCOUNT_LABEL_INVALID' };
  const phone = typeof raw.contactPhone === 'string' ? raw.contactPhone.replace(/[\s()-]/g, '') : '';
  if (!isE164(phone)) return { error: 'ACCOUNT_PHONE_INVALID' };
  const method = String(raw.connectionMethod ?? 'MANUAL') as ConnectionMethod;
  if (!(CONNECTION_METHODS as readonly string[]).includes(method)) return { error: 'INVALID_CONNECTION_METHOD' };
  return { patch: { account_label: label, contact_phone: phone, connection_method: method } };
}

/**
 * The copy HOMATCH posts through its account, for one language.
 * `contactPhone` → the portal's contact field (HOMATCH's number).
 * The owner's name and number → the end of the description, once.
 */
export function centralCopy(x: Listing, provider: ProviderConfig, account: Pick<AccountRow, 'contact_phone'>, lang: FooterLang) {
  const owner = ownerOf(x);
  return {
    title: x.title,
    description: withOwnerFooter(stripFooter(x.description[lang]), owner, lang),
    footer: ownerFooter(owner, lang),
    contactPhone: account.contact_phone,
    contactPhoneDisplay: account.contact_phone ? formatPhone(account.contact_phone) : null,
    photos: provider.maxPhotos != null ? x.photos.slice(0, provider.maxPhotos) : x.photos,
  };
}

/** Whether the owner footer can be produced at all — the name and a valid first number. */
export const ownerFooterReady = (x: Listing) => !!ownerFooter(ownerOf(x), 'ka');
