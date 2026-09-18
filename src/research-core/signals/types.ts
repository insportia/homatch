// HOMATCH RESEARCH CORE — one post, one comment, one listing.
//
// This is the canonical shape a discovered piece of public content takes
// while it is inside the core. It is NOT a new database model: it is the
// in-memory form of a `raw_signals` row, which already exists and already
// carries source_url, author_public_name, author_public_url, original_text,
// language, published_at, discovered_at, last_seen_at, content_fingerprint
// and classification_status. bridge/signal.ts maps between the two, and
// `raw_signals` stays the durable record.
//
// WHAT IT DELIBERATELY DOES NOT CARRY
//
// No email address, no phone number, no private profile data, no inferred
// identity. A public post's visible author handle is public; a phone number
// somebody typed into a comment is still personal data that Homatch has an
// existing unlock/consent path for, and this layer is not it. Nothing here
// tries to work out who somebody "really is", and nothing merges an identity
// across platforms — two accounts with the same display name are two
// accounts.
//
// PARENT CONTEXT IS PART OF THE EVIDENCE
//
// The most valuable buyer signal in a housing group is usually a comment
// under somebody else's listing. Read alone it says "is this still
// available?" and means nothing; read with its parent it is a person asking
// about a specific 2BR in Vake. So a comment carries its parent's URL and an
// excerpt, and a signal that lost its parent is weaker, not equal.

import type { ResearchDirection } from '../core/types.ts';
import type { ResearchLanguage } from '../discovery/lexicon.ts';

/** Matches the existing `signal_platform` enum in the database. */
export type SignalPlatform =
  | 'GOOGLE'
  | 'BING'
  | 'FACEBOOK'
  | 'TELEGRAM'
  | 'INSTAGRAM'
  | 'VK'
  | 'FORUM'
  | 'WEBSITE'
  | 'OTHER';

export type ContentType =
  | 'POST'
  | 'COMMENT'
  | 'REPLY'
  | 'LISTING'
  | 'PROFILE'
  | 'REEL'
  | 'ARTICLE';

/**
 * How we were able to read it.
 *
 * Recorded per signal rather than per source because a source's access class
 * can change between scans — a group goes private, a session expires — and
 * the evidence should say how THIS item was obtained, not how the source was
 * classified at some point.
 */
export type AccessClass =
  /** Fetched with no credentials at all. */
  | 'PUBLIC'
  /** Served to an authenticated session that an operator connected. */
  | 'AUTHENTICATED'
  /** Read from Homatch's own first-party data, with consent. */
  | 'FIRST_PARTY';

export interface SignalAuthor {
  /** The handle or display name as publicly shown. Never a resolved identity. */
  publicName: string | null;
  /** The public profile URL, when the platform shows one. */
  publicUrl: string | null;
}

export interface SignalLocationHints {
  countryCode: string | null;
  city: string | null;
  district: string | null;
  /** Free-text place mentions we did not resolve. Kept as written. */
  mentions: string[];
}

export interface SignalRequirementHints {
  bedrooms: number | null;
  areaSqm: number | null;
  /** As written, with its currency. Never converted; see core/types Money. */
  budgetAmount: number | null;
  budgetCurrency: string | null;
}

export interface PublicSignal {
  /** Deterministic: the same content from the same place is the same signal. */
  id: string;
  platform: SignalPlatform;
  contentType: ContentType;

  /** The source it came from — a group, a page, a site. */
  sourceUrl: string;
  /** The exact post or comment, when the platform exposes a direct link. */
  contentUrl: string | null;
  /** For a comment: the post it sits under. */
  parentUrl: string | null;
  /** A short excerpt of the parent, so the comment can be read in context. */
  parentExcerpt: string | null;

  author: SignalAuthor;

  /** The text as written. Never translated in place; see `translatedText`. */
  originalText: string;
  /** A translation, when one was made. The original always survives. */
  translatedText: string | null;
  language: ResearchLanguage | null;

  /**
   * When the SOURCE says it was posted. Null when unreadable — never the
   * crawl time. See discovery/freshness.ts.
   */
  publishedAt: string | null;
  /** When we first saw it. */
  discoveredAt: string;
  /** When we last saw it, so a re-scan updates rather than duplicates. */
  lastSeenAt: string;

  /** Normalized content hash, for dedupe across scans and across sources. */
  contentFingerprint: string;

  /** What the deterministic classifier decided. */
  direction: ResearchDirection;
  directionConfidence: number;

  locationHints: SignalLocationHints;
  requirementHints: SignalRequirementHints;

  accessClass: AccessClass;
}

/**
 * A signal that survived a job's filter, with the reasons it did.
 *
 * The reasons are kept because a result nobody can explain is a result
 * nobody can trust — and because the admin area has to be able to answer
 * "why was this source selected, and why did this item qualify?".
 */
export interface ScoredSignal {
  signal: PublicSignal;
  /** 0..1 overall. A weighted blend of the components below. */
  score: number;
  components: {
    /** How well it matches what the job asked for. */
    relevance: number;
    /** How firmly the author committed. */
    intentStrength: number;
    /** How recent, within the job's window. */
    freshness: number;
    /** How much the source is worth, from its track record. */
    sourceProductivity: number;
    /** Whether the parent context was available for a comment. */
    contextCompleteness: number;
  };
  /** Human-readable, operator-facing. Not customer copy. */
  reasons: string[];
}
