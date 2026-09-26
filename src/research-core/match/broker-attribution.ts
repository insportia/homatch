// WHO POSTED THIS, READ OFF THE LISTING ITSELF.
//
// The matcher has always been able to compare a demand role against a supply role,
// and has never had a supply role to compare. It was reading one out of
// `source_status` — a column that holds AVAILABLE or null — so every persisted
// match in production carries supply_role null and PARTICIPANTS unknown. BROKER and
// AGENCY were declared participants who had never once participated.
//
// This module is what actually reads the role, from the only place the fact exists:
// the words on the listing.
//
// THE RULE THAT MATTERS MOST HERE IS THE NEGATIVE ONE
//
// "Owner, no agents please" contains the word "agent". A keyword scan reads that
// listing as an agency listing, attributes a private flat to a firm that isn't
// involved, and then shows a customer a broker who never existed. That phrasing is
// not rare — on Georgian portals it is one of the most common sentences in the
// description, in all three languages. So negation is checked BEFORE the positive
// keywords and it wins outright, rather than being one signal among several.
//
// AND THE SECOND RULE: UNKNOWN IS AN ANSWER.
//
// Most listings do not say who is offering. `null` is returned, the observation
// stores null, and PARTICIPANTS stays UNKNOWN — which the comparison discipline
// already handles correctly by folding it into neither side. Guessing "probably an
// agency because there are four phone numbers" would be inventing the fact the
// column exists to record.

import type { SupplyRole } from './participants.ts';
import {
  type BrokerEvidence,
  type BrokerKey,
  brokerIdentityFrom,
  brokerKeysFrom,
} from './broker-identity.ts';

export interface ListingText {
  title?: string | null;
  description?: string | null;
  canonicalUrl?: string | null;
}

export interface Attribution {
  /** Who is offering, or null when the listing did not say. */
  role: SupplyRole | null;
  /** Contact details found, normalised. */
  evidence: BrokerEvidence;
  /** The key this firm would be deduplicated on, or null when there is none. */
  identity: BrokerKey | null;
  /** Every usable key, so a later phone-only sighting can find a domain record. */
  keys: BrokerKey[];
  /**
   * The listing said it does not want intermediaries. Recorded rather than merely
   * acted on, because "an owner who says no agents" is itself market intelligence
   * and because it makes the decision auditable.
   */
  excludesIntermediaries: boolean;
  /** The phrase that decided the role. Empty when the role is null. */
  reason: string;
}

/*
 * NEGATION, IN THE THREE LANGUAGES THE LISTINGS ARE WRITTEN IN.
 *
 * Georgian marks this with a postposition (`გარეშე`, "without") that follows its
 * noun, so the pattern has to allow the words between them. Russian does it with
 * `без` before, or with a dative plus `не звонить`. English puts it either way
 * round. All three forms are here because all three appear.
 */
const NO_INTERMEDIARY = [
  /\bno\s+(?:agent|agents|agency|agencies|broker|brokers|realtor|realtors)\b/,
  /\b(?:agents?|agencies|brokers?|realtors?)\s+(?:need\s+not|please\s+do\s+not|do\s+not)\s+(?:call|apply|contact)/,
  /\bwithout\s+(?:an?\s+)?(?:agent|agency|broker|realtor|intermediar\w*)/,
  /\bdirect\s+from\s+(?:the\s+)?owner\b/,
  /без\s+посредник\w*/,
  /без\s+агентств\w*/,
  /(?:агентств\w*|посредник\w*|риелтор\w*|брокер\w*)[^.!?\n]{0,20}не\s+(?:звонить|беспокоить|писать)/,
  /не\s+агентство/,
  /(?:შუამავლ\w*|სააგენტო\w*|რიელტორ\w*)[^.!?\n]{0,24}გარეშე/,
  /პირდაპირ\s+მესაკუთრ\w*/,
];

/*
 * THE POSITIVE KEYWORDS, in precedence order.
 *
 * DEVELOPER first because a developer's own sales office describes itself in words
 * that overlap with an agency's. AGENCY before BROKER because a firm that calls
 * itself an agency is one, and `broker` also appears inside agency boilerplate.
 * LANDLORD before SELLER because a rental listing by an owner is more specifically
 * a landlord, and the deal kind should not have to disambiguate it.
 *
 * `რიელტორ` and `риелтор` matter: listingExtract.sellerTypeFrom has classified
 * those as BROKER since it was written, and participants.supplyRoleFrom did not
 * know them, so a realtor-worded listing produced a seller type and no role.
 */
const ROLE_WORDS: readonly { role: SupplyRole; pattern: RegExp; label: string }[] = [
  {
    role: 'DEVELOPER',
    label: 'developer',
    pattern: /\bdevelopers?\b|from\s+the\s+(?:builder|developer)|застройщик\w*|от\s+застройщика|დეველოპერ\w*|მშენებელი\s+კომპანი\w*/,
  },
  {
    role: 'AGENCY',
    label: 'agency',
    pattern: /\bagenc(?:y|ies)\b|\breal\s+estate\s+agent\b|\brealtors?\b|агентств\w*|риелтор\w*|риэлтор\w*|სააგენტო\w*|რიელტორ\w*/,
  },
  {
    role: 'BROKER',
    label: 'broker',
    pattern: /\bbrokers?\b|\bbrokerage\b|брокер\w*|посредник\w*|შუამავალ\w*|შუამავლ\w*/,
  },
  {
    role: 'LANDLORD',
    label: 'landlord',
    pattern: /\blandlord\b|\blessor\b|арендодател\w*|მეიჯარ\w*|გამქირავებ\w*/,
  },
  {
    role: 'SELLER',
    label: 'owner',
    pattern: /\bowner\b|\bby\s+owner\b|собственник\w*|частное\s+лицо|хозяин\b|მესაკუთრ\w*|მფლობელ\w*/,
  },
];

/* ------------------------------------------------------------------ *
 * Contact details                                                    *
 * ------------------------------------------------------------------ */

/**
 * A Georgian phone number, or nothing.
 *
 * Not a general digit scan: a listing is full of nine-digit-ish runs that are
 * prices, areas and cadastral codes, and turning a price into a broker identity
 * would merge every flat that costs $120,000 into one firm. So a candidate has to
 * look like a Georgian number specifically — international prefix, a mobile range,
 * or a Tbilisi landline — and has to not be sitting next to a unit or a currency.
 */
function phonesIn(text: string): string[] {
  const found: string[] = [];
  const candidate = /(\+?995[\s.\-()]*)?(\d[\d\s.\-()]{7,16}\d)/g;
  let match: RegExpExecArray | null;
  while ((match = candidate.exec(text)) !== null) {
    const whole = match[0];
    const digits = whole.replace(/\D/g, '');
    if (digits.length < 9 || digits.length > 13) continue;

    const national = digits.replace(/^995/, '').replace(/^0/, '');
    /* 5xx mobile, 32x Tbilisi, 4xx other Georgian landline. */
    if (!/^(5\d{8}|32\d{7}|4\d{8})$/.test(national)) continue;

    /* A number introduced or followed by money or an area is not a phone. */
    const before = text.slice(Math.max(0, match.index - 14), match.index);
    const after = text.slice(match.index + whole.length, match.index + whole.length + 10);
    if (/[$€₾]|usd|gel|eur|лар|price|цена|ფას/i.test(before)) continue;
    if (/^\s*(?:\$|€|₾|usd|gel|eur|m2|м2|кв\.?\s?м|მ2|sqm|%)/i.test(after)) continue;

    if (!found.includes(whole.trim())) found.push(whole.trim());
  }
  return found;
}

/** Telegram handles and t.me links. */
function telegramIn(text: string): string[] {
  const found: string[] = [];
  const pattern = /(?:(?:https?:\/\/)?t(?:elegram)?\.me\/|@)([a-zA-Z0-9_]{5,32})\b/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const handle = match[1].toLowerCase();
    if (!found.includes(handle)) found.push(handle);
  }
  return found;
}

/** Bare hosts and URLs. The portal filter in broker-identity discards our own. */
function hostsIn(text: string): string[] {
  const found: string[] = [];
  const pattern = /(?:https?:\/\/)?((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:ge|com|net|org|az|ru|eu|io|co))\b/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const host = match[1].toLowerCase();
    if (!found.includes(host)) found.push(host);
  }
  return found;
}

/* ------------------------------------------------------------------ *
 * The one function callers use                                       *
 * ------------------------------------------------------------------ */

/**
 * Read the supply role and any broker identity off a listing.
 *
 * Pure, deterministic and explainable: the same text always produces the same
 * role, and `reason` names the word that decided it. No model is consulted — a
 * semantic signal may suggest a role elsewhere in the product, but what gets
 * written into `supply_observations.supply_role` and matched on is this.
 */
export function attributionFrom(listing: ListingText): Attribution {
  const joined = [listing.title ?? '', listing.description ?? '']
    .filter(Boolean)
    .join('\n');
  const haystack = joined.toLowerCase();

  const excludesIntermediaries = NO_INTERMEDIARY.some((pattern) => pattern.test(haystack));

  let role: SupplyRole | null = null;
  let reason = '';
  for (const entry of ROLE_WORDS) {
    if (!entry.pattern.test(haystack)) continue;
    /*
     * "No agents" wins. A listing that excludes intermediaries is not an agency
     * listing no matter how many times the word appears in the exclusion, so the
     * intermediary roles are skipped and the owner roles are still allowed —
     * "owner, no agents" should read as SELLER, not as nothing.
     */
    if (excludesIntermediaries
      && (entry.role === 'AGENCY' || entry.role === 'BROKER')) continue;
    role = entry.role;
    reason = excludesIntermediaries
      ? `${entry.label}; listing excludes intermediaries`
      : entry.label;
    break;
  }

  /*
   * CONTACT DETAILS ARE COLLECTED ONLY FOR A BROKER ROLE.
   *
   * A private owner's mobile number is a private individual's phone number, and
   * building a deduplicated, queryable identity record out of it would be
   * assembling a directory of people who never asked to be in one. Brokers and
   * agencies publish their contact details as a business; owners publish theirs to
   * sell one flat. So this only runs for AGENCY and BROKER.
   */
  const evidence: BrokerEvidence = {};
  if (role === 'AGENCY' || role === 'BROKER') {
    const phones = phonesIn(joined);
    const handles = telegramIn(joined);
    const hosts = hostsIn(joined);
    if (phones.length) evidence.phone = phones[0];
    if (handles.length) evidence.telegram = handles[0];
    if (hosts.length) evidence.website = hosts[0];
    /*
     * THE LISTING'S OWN URL IS NOT A BROKER PROFILE URL, and must never be used as
     * one. Every listing has a different canonical URL, so keying a broker on it
     * would give every single listing its own broker record and dedup would do
     * nothing at all — the exact opposite of the point. PROFILE_URL is for a
     * broker's page on a portal, which an adapter has to extract deliberately;
     * `canonicalUrl` stays in `ListingText` only so lineage can record where the
     * attribution was read from.
     */
  }

  const keys = brokerKeysFrom(evidence);
  return {
    role,
    evidence,
    identity: brokerIdentityFrom(evidence),
    keys,
    excludesIntermediaries,
    reason,
  };
}
