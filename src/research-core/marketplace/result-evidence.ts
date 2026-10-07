import type { NormalizedListing } from './normalize.ts';
import type { PropertyFacts } from './ranking.ts';
import type { MarketplaceSearchRequest } from './worker-contract.ts';
import { descriptionSignals, type DescriptionSignal } from './description-signals.ts';
import { listingActivity, type ListingActivity } from './freshness.ts';

export type ResultSection = 'BEST' | 'FRESH' | 'VALUE' | 'CLOSE' | 'VERIFY' | 'UPGRADE';
export const RESULT_SECTIONS: readonly ResultSection[] = ['BEST', 'FRESH', 'VALUE', 'CLOSE', 'VERIFY', 'UPGRADE'];
export type WarningCode = 'POSSIBLE_DUPLICATE' | 'PRICE_CONFLICT' | 'INFORMATION_CONFLICT' | 'COPIED_DESCRIPTION' | 'MULTI_PROPERTY_CONTACT' | 'DATE_UNRELIABLE';
export interface ResultEvidence {
  section: ResultSection;
  strong: boolean;
  activity: ListingActivity;
  signals: DescriptionSignal[];
  warnings: WarningCode[];
  preferences: { confirmed: string[]; mentioned: string[]; unconfirmed: string[]; contradicted: string[] };
  verificationNeeded: boolean;
  primaryListingId: string;
  otherListingCount: number;
}

export function resultEvidence(rep: NormalizedListing, members: NormalizedListing[], facts: PropertyFacts, req: MarketplaceSearchRequest, now: Date): ResultEvidence {
  const signals = descriptionSignals(rep.description);
  const activity = listingActivity(rep.publishedAt, rep.updatedAt, now);
  const preferences: ResultEvidence['preferences'] = { confirmed: [], mentioned: [], unconfirmed: [], contradicted: [] };
  for (const preference of [...new Set([...req.mustHave, ...req.niceToHave])]) {
    const structured = preference === 'PARKING' ? facts.parking : preference === 'FURNISHED' ? facts.furnished : facts.amenities.includes(preference) ? true : null;
    const signal = signals.find((s) => s.code === preference);
    if (structured === true) preferences.confirmed.push(preference);
    else if (structured === false || signal?.polarity === 'NEGATED') preferences.contradicted.push(preference);
    else if (signal) preferences.mentioned.push(preference);
    else preferences.unconfirmed.push(preference);
  }
  const warnings: WarningCode[] = [];
  if (activity.invalidDate) warnings.push('DATE_UNRELIABLE');
  if (signals.some((s) => (s.code === 'PARKING' && facts.parking !== null && (s.polarity === 'MENTIONED') !== facts.parking)
    || (s.code === 'FURNISHED' && facts.furnished !== null && (s.polarity === 'MENTIONED') !== facts.furnished))) warnings.push('INFORMATION_CONFLICT');
  const conflictFields: Array<keyof PropertyFacts> = ['parking', 'furnished', 'buildingStatus', 'renovationStatus'];
  if (conflictFields.some((field) => new Set(members.map((m) => m[field as keyof NormalizedListing]).filter((v) => v !== null && v !== undefined)).size > 1)
    && !warnings.includes('INFORMATION_CONFLICT')) warnings.push('INFORMATION_CONFLICT');
  return { section: 'CLOSE', strong: false, activity, signals, warnings, preferences,
    verificationNeeded: warnings.length > 0, primaryListingId: rep.id, otherListingCount: members.length - 1 };
}
