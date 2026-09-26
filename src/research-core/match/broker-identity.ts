// A BROKER WE FOUND IS NOT A BROKER WHO PAID US.
//
// Those are two different records about possibly the same company, and the whole
// point of this module is that they can never be confused for one another — not by
// a query that forgot a filter, not by a renderer that read the wrong field, and
// not by a future function that finds it convenient.
//
// THE TWO THINGS, NAMED ONCE
//
//   BROKER INTELLIGENCE is what discovery learned. An agency's name appeared on a
//   listing, with a phone number and a domain; we recorded it, deduplicated it
//   against the last time it appeared, and it can now take part in matching. It
//   carries provenance (which source, which observation) and freshness (when we
//   last actually saw it). It says nothing whatsoever about a commercial
//   relationship, because there isn't one.
//
//   A DIRECTORY LISTING is a broker who registered with Homatch and is paying to
//   appear in the directory. It has an owning user account and a paid-until date.
//
// The rule the product depends on: EXTERNAL DISCOVERY IS NOT REGISTRATION. A
// discovered broker may be stored, may be deduplicated, may be matched, may be
// shown to a customer as market intelligence — and must never, by any code path,
// become a paid directory listing.
//
// HOW THAT IS ENFORCED RATHER THAN PROMISED
//
// `DirectoryStanding` is only obtainable from `directoryStandingOf()`, and there is
// no overload of it that takes a `BrokerRecord`. To get anything other than
// NOT_LISTED a caller must hold a registration's own status and paid-until — which
// only the directory table and its public view produce, and which discovery cannot
// write because a registration requires an owning account. A renderer that wants to
// print "verified" has to hold a paid listing to do it.
//
// AND WHY A NAME IS NOT AN IDENTITY
//
// "Tbilisi Real Estate" is four brokers. Deduplicating on a display name would
// merge competitors into one record and then attribute one firm's listings to
// another, which is worse than holding two records. So identity comes only from
// something a firm controls and does not share: a domain, a phone number, a
// Telegram handle, a company registration number, a profile URL on a portal. When
// none of those is present we have an observation and no identity, and this module
// says so by returning null rather than inventing a key from the name.

import type { SupplyRole } from './participants.ts';

/* ------------------------------------------------------------------ *
 * Identity                                                           *
 * ------------------------------------------------------------------ */

/**
 * The kinds of key that are stable enough to deduplicate a firm on.
 *
 * Ordered deliberately, strongest first — see `IDENTITY_PRECEDENCE`. A company
 * registration number is issued by the state and cannot be shared; a domain is
 * bought and is usually one firm; a Telegram handle is unique but is often a
 * person at the firm rather than the firm; a phone number is unique but gets
 * reassigned and is sometimes a portal's call-tracking number; a profile URL is
 * unique only within one portal.
 */
export type BrokerKeyKind =
  | 'COMPANY_ID'
  | 'DOMAIN'
  | 'TELEGRAM'
  | 'PHONE'
  | 'PROFILE_URL';

export const IDENTITY_PRECEDENCE: readonly BrokerKeyKind[] = [
  'COMPANY_ID', 'DOMAIN', 'TELEGRAM', 'PHONE', 'PROFILE_URL',
];

/** Only these two supply roles are brokers in the directory sense. */
export type BrokerRole = Extract<SupplyRole, 'AGENCY' | 'BROKER'>;

export const BROKER_ROLES: readonly BrokerRole[] = ['AGENCY', 'BROKER'];

export function isBrokerRole(role: SupplyRole | null | undefined): role is BrokerRole {
  return role === 'AGENCY' || role === 'BROKER';
}

export interface BrokerKey {
  kind: BrokerKeyKind;
  /** Normalised. This is what goes in the unique index. */
  value: string;
  /** Exactly what we read, before normalising. Kept so a bad rule is auditable. */
  raw: string;
}

/**
 * Whatever a listing, a channel post or a profile page told us about who is
 * offering. Every field optional, because in practice most of them are absent —
 * the common case on a Georgian portal is a phone number and nothing else.
 */
export interface BrokerEvidence {
  displayName?: string | null;
  companyId?: string | null;
  website?: string | null;
  telegram?: string | null;
  phone?: string | null;
  profileUrl?: string | null;
}

/** Digits only, with Georgia's country code made explicit where it is implied. */
function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, '');
  const plus = digits.startsWith('+');
  const bare = digits.replace(/\D/g, '');
  if (bare.length < 9) return null;

  /*
   * GEORGIAN MOBILE NUMBERS ARE WRITTEN THREE WAYS for the same phone: 555123456,
   * 0555123456 and +995555123456. Treating those as three brokers would triple
   * every agency in the database, so the national forms are promoted to the
   * international one. Only for Georgia, and only for lengths that can only be
   * Georgian — an 11-digit number starting 7 is Russian and is left alone.
   */
  if (plus || bare.startsWith('995')) {
    const trimmed = bare.replace(/^995/, '');
    return trimmed.length === 9 ? `+995${trimmed}` : `+${bare}`;
  }
  if (bare.length === 9) return `+995${bare}`;
  if (bare.length === 10 && bare.startsWith('0')) return `+995${bare.slice(1)}`;
  return `+${bare}`;
}

/** The registrable host, lowercased, without www or a path. */
function normaliseDomain(raw: string): string | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;
  const withoutScheme = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  const host = withoutScheme.split(/[/?#]/)[0].replace(/^www\./, '').replace(/\.$/, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return null;

  /*
   * A PORTAL IS NOT A BROKER. myhome.ge appears in the contact block of tens of
   * thousands of listings and identifying every one of them as the same firm would
   * produce a single broker record holding the entire market. The portals we read
   * are therefore never identities; when a listing's only domain is the portal it
   * is published on, that listing has no broker identity, which is the truth.
   */
  if (PORTAL_HOSTS.some((portal) => host === portal || host.endsWith(`.${portal}`))) return null;
  return host;
}

/**
 * The hosts we crawl. Listed here rather than imported from the adapter registry
 * because this is a semantic claim ("this host is a marketplace, not a firm") and
 * it must stay true even if an adapter is retired.
 */
const PORTAL_HOSTS: readonly string[] = [
  'myhome.ge', 'ss.ge', 'ss.com', 'livo.ge', 'place.ge', 'korter.ge',
  'ehome.ge', 'bina.az', 'facebook.com', 'instagram.com', 't.me',
  'telegram.me', 'olx.ge', 'home.ge', 'realtor.ge', 'airbnb.com', 'booking.com',
];

/** A Telegram handle without its @, lowercased. */
function normaliseTelegram(raw: string): string | null {
  const text = raw.trim().toLowerCase();
  const handle = text
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^(?:t\.me|telegram\.me)\//, '')
    .replace(/^@/, '')
    .split(/[/?#]/)[0];
  /* Telegram's own rule: 5–32 characters, letters, digits and underscores. */
  return /^[a-z0-9_]{5,32}$/.test(handle) ? handle : null;
}

/** A Georgian company identification number is eleven digits. */
function normaliseCompanyId(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  return digits.length === 9 || digits.length === 11 ? digits : null;
}

/** A full URL, lowercased host, path kept because that is what makes it a profile. */
function normaliseProfileUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = url.pathname.replace(/\/+$/, '');
  /* A bare host is a website, not a profile; without a path this says nothing. */
  if (!path || path === '/') return null;
  return `${host}${path}`;
}

const NORMALISERS: Readonly<Record<BrokerKeyKind, (raw: string) => string | null>> = {
  COMPANY_ID: normaliseCompanyId,
  DOMAIN: normaliseDomain,
  TELEGRAM: normaliseTelegram,
  PHONE: normalisePhone,
  PROFILE_URL: normaliseProfileUrl,
};

/**
 * Every usable key in the evidence, strongest first.
 *
 * All of them, not just the best one: the strongest key is what a record is
 * deduplicated ON, and the others are what lets a later sighting with only a
 * phone number find the record that was created from a domain.
 */
export function brokerKeysFrom(evidence: BrokerEvidence): BrokerKey[] {
  const raws: Readonly<Record<BrokerKeyKind, string | null | undefined>> = {
    COMPANY_ID: evidence.companyId,
    DOMAIN: evidence.website,
    TELEGRAM: evidence.telegram,
    PHONE: evidence.phone,
    PROFILE_URL: evidence.profileUrl,
  };
  const keys: BrokerKey[] = [];
  for (const kind of IDENTITY_PRECEDENCE) {
    const raw = raws[kind];
    if (raw === null || raw === undefined) continue;
    const text = String(raw).trim();
    if (!text) continue;
    const value = NORMALISERS[kind](text);
    if (value) keys.push({ kind, value, raw: text });
  }
  return keys;
}

/**
 * The one key this record is identified by, or null when nothing stable was seen.
 *
 * Returning null is a real and frequent answer, and it is the honest one: a
 * listing that says "agency" and gives a portal's call-tracking number has told us
 * a role and not an identity.
 */
export function brokerIdentityFrom(evidence: BrokerEvidence): BrokerKey | null {
  return brokerKeysFrom(evidence)[0] ?? null;
}

/* ------------------------------------------------------------------ *
 * What we know about a discovered broker                             *
 * ------------------------------------------------------------------ */

/**
 * A stored broker we learned about from the outside world.
 *
 * NOTE WHAT IS NOT HERE: no `verified`, no `paid`, no `plan`, no `registered`. Not
 * because they are always false, but because this record is incapable of knowing
 * them, and a field that can only ever hold a guess is how a guess gets rendered
 * as a fact.
 */
export interface BrokerRecord {
  id: string;
  role: BrokerRole;
  key: BrokerKey;
  displayName: string | null;
  countryCode: string;
  cities: readonly string[];
  languages: readonly string[];
  /** When discovery first saw this firm at all. */
  firstSeenAt: string;
  /** When discovery last saw it — a source-freshness clock, not a listing's age. */
  lastSeenAt: string;
  /** When we last confirmed it still resolves. Null until we have. */
  lastVerifiedAt: string | null;
  /** How many observations are attributed to it, and from how many sources. */
  observationCount: number;
  sourceCount: number;
}

/**
 * A registration. Only the paid side of the product can build one of these,
 * because only it has an owning account and a paid-until instant.
 */
export interface DirectoryStandingInput {
  status: 'PENDING_REVIEW' | 'ACTIVE' | 'SUSPENDED' | 'EXPIRED';
  paidUntil: string | null;
}

export interface DirectoryListing extends DirectoryStandingInput {
  brokerId: string | null;
  /**
   * The account that registered. There is no directory listing without one, and it
   * is the reason no discovery path can create one: discovery has no user.
   *
   * Deliberately NOT part of DirectoryStandingInput. The standing decision does not
   * need to know WHO registered, only that a registration exists and is current, and
   * broker_directory_public does not expose the owner to customers. Requiring it here
   * and not there means a caller reading the public view does not have to invent a
   * placeholder to ask the question.
   */
  ownerUserId: string;
}

/**
 * Where a broker stands with Homatch commercially.
 *
 * Three values and not two, because "we are looking at it" is not "they are in"
 * and must not render as either.
 */
export type DirectoryStanding =
  /** Not registered with Homatch. The answer for every discovered broker. */
  | 'NOT_LISTED'
  /** Registered, paid, current. The only value that may be shown as a listing. */
  | 'LISTED_ACTIVE'
  /** Registered but not currently payable-and-current. Not shown as a listing. */
  | 'LISTED_INACTIVE';

/**
 * The only way to obtain a standing.
 *
 * Takes a listing, not a broker — so a caller holding only intelligence cannot
 * reach LISTED_ACTIVE, and a caller holding a listing must still have a current
 * paid-until to reach it. `at` is passed in rather than read from the clock so
 * that this stays a pure function and so a test can prove the expiry boundary.
 */
export function directoryStandingOf(
  listing: DirectoryStandingInput | null | undefined,
  at: Date,
): DirectoryStanding {
  if (!listing) return 'NOT_LISTED';
  if (listing.status !== 'ACTIVE') return 'LISTED_INACTIVE';
  if (!listing.paidUntil) return 'LISTED_INACTIVE';
  const until = Date.parse(listing.paidUntil);
  if (!Number.isFinite(until)) return 'LISTED_INACTIVE';
  return until > at.getTime() ? 'LISTED_ACTIVE' : 'LISTED_INACTIVE';
}

/** May this broker appear in the customer-facing Homatch broker directory? */
export function mayAppearInDirectory(standing: DirectoryStanding): boolean {
  return standing === 'LISTED_ACTIVE';
}

/* ------------------------------------------------------------------ *
 * What the customer is told                                          *
 * ------------------------------------------------------------------ */

export type BrokerPresentation =
  /** A paid Homatch directory listing. */
  | 'DIRECTORY_LISTING'
  /** Market intelligence: a firm we observed, with no relationship to us. */
  | 'MARKET_INTELLIGENCE';

export interface BrokerDisclosure {
  presentation: BrokerPresentation;
  /**
   * An i18n key, not a sentence. The distinction has to survive six languages and
   * a string built here would ship English into all of them.
   */
  labelKey: string;
  /** True only for a current paid listing. Nothing else may claim it. */
  registeredWithHomatch: boolean;
}

/**
 * How to present a broker, given only what is actually known.
 *
 * Deliberately takes the standing rather than the listing, so that the single
 * place that decides standing is `directoryStandingOf` and this cannot become a
 * second, disagreeing rule.
 */
export function discloseBroker(standing: DirectoryStanding): BrokerDisclosure {
  if (standing === 'LISTED_ACTIVE') {
    return {
      presentation: 'DIRECTORY_LISTING',
      labelKey: 'broker_disclosure_directory',
      registeredWithHomatch: true,
    };
  }
  /*
   * LISTED_INACTIVE lands here on purpose. An expired or suspended registration is
   * presented exactly like a firm we merely observed — because that is all it
   * currently is, and letting a lapsed payment keep a badge is the same lie as
   * inventing one.
   */
  return {
    presentation: 'MARKET_INTELLIGENCE',
    labelKey: 'broker_disclosure_observed',
    registeredWithHomatch: false,
  };
}
