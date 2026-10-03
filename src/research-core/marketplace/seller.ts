// HOMATCH MARKETPLACE SEARCH — who is selling, as far as the evidence goes.
//
// A listing that says "owner" is a claim, not a fact. Brokers post as owners
// all the time, so a self-declared owner is LIKELY_OWNER only when something
// else agrees (this contact is on one property in the whole search, and the
// source says the seller has few listings). VERIFIED_OWNER is reserved for an
// independent verification HOMATCH itself holds; the marketplace pipeline never
// reaches it from listing text.
//
// Every classification carries its evidence and reason codes. Nothing here is a
// judgement about anybody's honesty.

import type { NormalizedListing } from './normalize.ts';

export type SellerClass = 'VERIFIED_OWNER' | 'LIKELY_OWNER' | 'AGENCY' | 'BROKER' | 'DEVELOPER' | 'UNKNOWN';

export interface SellerAssessment {
  classification: SellerClass;
  confidence: number;
  reasonCodes: string[];
  evidence: string[];
}

export interface SellerContext {
  /** Distinct properties each public phone appears on in this search. */
  propertiesPerPhone: ReadonlyMap<string, number>;
  /** Phone keys HOMATCH has independently verified as a property's owner (none by default). */
  verifiedOwnerPhoneKeys?: ReadonlySet<string>;
}

/** A contact on this many different properties is acting for more than one owner. */
export const MULTI_PROPERTY_CONTACT = 4;
/** A seller with more listings than this on the source is not a private owner. */
export const OWNER_MAX_SOURCE_LISTINGS = 2;

const AGENCY_TEXT = /სააგენტ|უძრავი ქონების კომპანი|\bagency\b|\brealty\b|агентств|риелтор|риэлтор|emlak ofisi|komisyon|საკომისიო|комисси/iu;
const OWNER_TEXT = /მესაკუთრისგან|მესაკუთრე|\bowner\b|from the owner|собственник|от хозяина|sahibinden/iu;
const DEVELOPER_TEXT = /დეველოპერ|\bdeveloper\b|застройщик|müteahhit/iu;

export function classifySeller(l: NormalizedListing, ctx: SellerContext): SellerAssessment {
  const reasons: string[] = [];
  const evidence: string[] = [];
  const text = `${l.title ?? ''}\n${l.description ?? ''}`;
  const declared = l.seller.declaredType;
  const phoneProps = l.seller.phoneKey ? ctx.propertiesPerPhone.get(l.seller.phoneKey) ?? 1 : null;
  const sourceCount = l.seller.sourceListingCount;

  if (l.seller.phoneKey && ctx.verifiedOwnerPhoneKeys?.has(l.seller.phoneKey)) {
    return { classification: 'VERIFIED_OWNER', confidence: 0.95, reasonCodes: ['HOMATCH_VERIFIED_OWNER'], evidence: ['contact matches a HOMATCH-verified owner'] };
  }
  if (declared === 'DEVELOPER' || DEVELOPER_TEXT.test(text)) {
    reasons.push(declared === 'DEVELOPER' ? 'DECLARED_DEVELOPER' : 'DEVELOPER_TEXT');
    evidence.push(declared === 'DEVELOPER' ? 'source marks the seller as a developer' : 'listing text names a developer');
    return { classification: 'DEVELOPER', confidence: declared === 'DEVELOPER' ? 0.9 : 0.65, reasonCodes: reasons, evidence };
  }
  if (declared === 'AGENCY') {
    return { classification: 'AGENCY', confidence: 0.85, reasonCodes: ['DECLARED_AGENCY'], evidence: ['source marks the seller as an agency'] };
  }
  if (declared === 'BROKER') {
    return { classification: 'BROKER', confidence: 0.85, reasonCodes: ['DECLARED_BROKER'], evidence: ['source marks the seller as a broker'] };
  }
  const multiContact = phoneProps !== null && phoneProps >= MULTI_PROPERTY_CONTACT;
  const manyOnSource = sourceCount !== null && sourceCount > OWNER_MAX_SOURCE_LISTINGS + 3;
  if (multiContact || manyOnSource) {
    if (multiContact) { reasons.push('CONTACT_ON_MANY_PROPERTIES'); evidence.push(`the same public contact is on ${phoneProps} properties in this search`); }
    if (manyOnSource) { reasons.push('MANY_SOURCE_LISTINGS'); evidence.push(`the seller has ${sourceCount} listings on the source`); }
    if (declared === 'OWNER' || OWNER_TEXT.test(text)) reasons.push('OWNER_CLAIM_NOT_SUPPORTED');
    const agency = AGENCY_TEXT.test(text);
    return { classification: agency ? 'AGENCY' : 'BROKER', confidence: multiContact && manyOnSource ? 0.8 : 0.65, reasonCodes: reasons, evidence };
  }
  if (AGENCY_TEXT.test(text)) {
    return { classification: 'AGENCY', confidence: 0.6, reasonCodes: ['AGENCY_TEXT'], evidence: ['listing text names an agency or a commission'] };
  }
  const claimsOwner = declared === 'OWNER' || OWNER_TEXT.test(text);
  if (claimsOwner) {
    reasons.push(declared === 'OWNER' ? 'DECLARED_OWNER' : 'OWNER_TEXT');
    evidence.push(declared === 'OWNER' ? 'source marks the seller as the owner' : 'listing text says it is from the owner');
    const singleContact = phoneProps === 1;
    const fewOnSource = sourceCount !== null && sourceCount <= OWNER_MAX_SOURCE_LISTINGS;
    if (singleContact) { reasons.push('CONTACT_ON_ONE_PROPERTY'); evidence.push('the public contact appears on this property only'); }
    if (fewOnSource) { reasons.push('FEW_SOURCE_LISTINGS'); evidence.push(`the seller has ${sourceCount} listing(s) on the source`); }
    /* The claim alone is not enough: at least one independent signal must agree. */
    if (singleContact || fewOnSource) {
      return { classification: 'LIKELY_OWNER', confidence: singleContact && fewOnSource ? 0.8 : 0.65, reasonCodes: reasons, evidence };
    }
    reasons.push('OWNER_CLAIM_UNCORROBORATED');
    return { classification: 'UNKNOWN', confidence: 0.4, reasonCodes: reasons, evidence };
  }
  return { classification: 'UNKNOWN', confidence: 0.3, reasonCodes: ['NO_SELLER_EVIDENCE'], evidence: [] };
}

export const isOwnerClass = (c: SellerClass) => c === 'VERIFIED_OWNER' || c === 'LIKELY_OWNER';
