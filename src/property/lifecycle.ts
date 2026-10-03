// WHAT AN OWNER IS TOLD ABOUT ONE PROPERTY'S LIFECYCLE.
//
// Pure, and in its own module for the reason gallery.ts and rules.ts are: a .tsx
// cannot be imported by a test. The STATE is never computed here — freshness is the
// database's answer (my_property_lifecycle, computed with the server clock), so the
// browser can neither extend a listing nor expire one. This module only decides
// which words and which actions go with the answer it was given.
//
// TWO DIMENSIONS THAT ARE NEVER MERGED
//
//   freshness   the OWNER's confirmation: ACTIVE / EXPIRING_SOON / EXPIRED.
//   source      for an imported property, the SOURCE listing's health. A property
//               can be ACTIVE here while its source is gone, or EXPIRED here while
//               its source is fine. Renewing in HOMATCH never claims the source was
//               updated, and the source never renews HOMATCH.

export type FreshnessState = 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED';
export type SourceStatus =
  | 'AVAILABLE' | 'TEMPORARILY_UNREACHABLE' | 'LISTING_NOT_FOUND'
  | 'MEDIA_UNAVAILABLE' | 'SOURCE_CHANGED' | 'UNKNOWN';

/** One row of my_property_lifecycle, as PostgREST returns it. */
export interface PropertyLifecycle {
  property_id: string;
  freshness_state: FreshnessState;
  anchor_at: string;
  expires_at: string;
  days_left: number;
  owner_confirmed_at: string | null;
  archived: boolean;
  matching_paused_by_freshness: boolean;
  discovery_eligible: boolean;
  source_status: SourceStatus | null;
  source_checked_at: string | null;
  imported_at: string | null;
  server_now: string;
}

export type Tone = 'ok' | 'attention' | 'blocked';

/** The owner-status line: always an icon AND words, never colour alone. */
export interface StatusView {
  tone: Tone;
  /** i18n key of the short label ("აქტიური"). */
  label: string;
  /** i18n key of the explanation. */
  body: string;
  /** Show the free renewal as the primary action. */
  renew: boolean;
}

export function freshnessView(state: FreshnessState | null | undefined): StatusView | null {
  switch (state) {
    case 'ACTIVE':
      return { tone: 'ok', label: 'pow_state_active', body: 'pow_state_active_body', renew: false };
    case 'EXPIRING_SOON':
      return { tone: 'attention', label: 'pow_state_expiring', body: 'pow_state_expiring_body', renew: true };
    case 'EXPIRED':
      return { tone: 'blocked', label: 'pow_state_expired', body: 'pow_state_expired_body', renew: true };
    default:
      return null;
  }
}

/**
 * The source line for an imported property, or null when there is nothing true and
 * useful to say. UNKNOWN and AVAILABLE say nothing: "we have not checked" is not a
 * problem to put in front of an owner, and "fine" needs no banner.
 */
export function sourceView(status: SourceStatus | null | undefined, imported: boolean): StatusView | null {
  if (!imported) return null;
  switch (status) {
    case 'LISTING_NOT_FOUND':
      return { tone: 'attention', label: 'pow_source_problem', body: 'pow_source_not_found', renew: false };
    case 'MEDIA_UNAVAILABLE':
      return { tone: 'attention', label: 'pow_source_problem', body: 'pow_source_media_unavailable', renew: false };
    case 'SOURCE_CHANGED':
      return { tone: 'attention', label: 'pow_source_problem', body: 'pow_source_changed', renew: false };
    case 'TEMPORARILY_UNREACHABLE':
      return { tone: 'attention', label: 'pow_source_problem', body: 'pow_source_unreachable', renew: false };
    default:
      return null;
  }
}

/**
 * Why a photo is not showing, in the most precise words we can justify. The browser
 * only knows "it did not load"; the server's source status, when it has one, says
 * more. Never a technical code.
 */
export function mediaUnavailableReason(status: SourceStatus | null | undefined): string {
  if (status === 'LISTING_NOT_FOUND') return 'pow_source_not_found';
  if (status === 'MEDIA_UNAVAILABLE') return 'pow_source_media_unavailable';
  if (status === 'SOURCE_CHANGED') return 'pow_source_changed';
  return 'pow_media_unavailable_body';
}

/** Only safe http(s) links are ever clickable. */
export function safeExternalUrl(value: string | null | undefined): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Does this property need the owner's attention? (My Property card marker.) */
export function needsAttention(life: Pick<PropertyLifecycle, 'freshness_state' | 'source_status'> | null | undefined,
  imported: boolean, mediaFailed: boolean): boolean {
  if (!life) return mediaFailed;
  if (life.freshness_state !== 'ACTIVE') return true;
  if (mediaFailed) return true;
  return sourceView(life.source_status, imported) !== null;
}
