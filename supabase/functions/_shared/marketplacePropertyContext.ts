import { safeExternalUrl } from '../../../src/lib/safeExternalUrl.ts';

/** Own-search lookup precedes property lookup; no client facts are trusted. */
export async function marketplacePropertyContext(db: any, userId: string, input: unknown, legacyCatalogue?: (db: any, search: Record<string, unknown>) => Promise<any[]>) {
  if (!input || typeof input !== 'object') return null;
  const { searchId, propertyKey } = input as Record<string, unknown>;
  if (typeof searchId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(searchId)
    || typeof propertyKey !== 'string' || propertyKey.length < 1 || propertyKey.length > 200) return null;
  const { data: search, error: searchError } = await db.from('discovery_marketplace_searches')
    .select('id,request,processed_at,created_at').eq('id', searchId).eq('user_id', userId).maybeSingle();
  if (searchError) throw searchError;
  if (!search) return null;
  const { data: row, error } = await db.from('discovery_marketplace_properties')
    .select('view').eq('search_id', search.id).eq('property_key', propertyKey).maybeSingle();
  if (error) throw error;
  let p = row?.view;
  if ((!p || !p.intelligence) && legacyCatalogue) {
    p = (await legacyCatalogue(db, search)).find((property) => property.key === propertyKey);
  }
  if (!p) return null;
  const listings = Array.isArray(p.listings) ? p.listings : [];
  const context = {
    type: 'property', surface: 'find-property', searchId, propertyKey,
    title: String(p.title ?? '').slice(0, 180),
    searchCriteria: search.request,
    facts: p.facts, sourceCount: p.sourceCount, listingCount: listings.length,
    sourceListings: listings.slice(0, 12).map((l: any) => ({ source: l.source, sourceName: l.sourceName, priceUsd: l.priceUsd,
      sourceUrl: typeof l.exactUrl === 'string' ? safeExternalUrl(l.exactUrl) : null,
      publishedAt: l.publishedAt, updatedAt: l.updatedAt, observedAt: l.observedAt, lastVerifiedAt: l.lastVerifiedAt })),
    priceDiscrepancy: p.priceDiscrepancy, seller: p.seller,
    budgetOverageUsd: typeof p.facts?.priceUsd === 'number' && typeof search.request?.priceMaxUsd === 'number'
      ? Math.max(0, p.facts.priceUsd - search.request.priceMaxUsd) : null,
    matchReasons: p.reasons,
    upgrade: p.upgrade ? { band: p.upgrade.band, comparisonPropertyKey: p.upgrade.baselineKey,
      comparisonPremiumUsd: p.upgrade.extraPriceUsd, overBudgetRatio: p.upgrade.overMaxPct,
      advantages: p.upgrade.advantages } : null,
    unknowns: p.unverified,
    tradeoffs: Array.isArray(p.tradeoffs) ? p.tradeoffs.slice(0, 12) : [],
    comparableEvidence: { vsComparable: p.vsComparable },
    description: typeof p.description === 'string' ? p.description.slice(0, 2400) : null,
    evidence: p.intelligence,
  };
  // Refuse an unexpectedly oversized dossier rather than truncating structured
  // evidence mid-object or forwarding a massive source payload to the model.
  if (JSON.stringify(context).length > 12000) throw new Error('PROPERTY_AI_CONTEXT_TOO_LARGE');
  return context;
}
