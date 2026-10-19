// FIND PROPERTY — the social offers a paid campaign found, as results of its search.
//
// A campaign belongs to one marketplace search: its discovery_run's subscription
// carries search_criteria.marketplaceSearchId, and both belong to the same person.
// Only ENDED campaigns contribute (owner rule 2026-10-17: no partial results while
// a search runs), and only offers their own Actor runs stored. processAndStore
// adds these candidates to the portals' and re-ranks; discoveryRun.ts
// publishSocialListings runs it once a campaign has ended.

import { socialCandidate, SOCIAL_ADAPTER_VERSION, type SocialObservation } from '../../../../src/research-core/marketplace/socialListings.ts';
import { isPaidDiscoveryPolicy, PAID_DISCOVERY_POLICIES } from '../../../../src/research-core/billing/paidDiscoveryPolicy.ts';
import type { ExternalListingCandidate } from '../../../../src/research-core/marketplace/worker-contract.ts';

export const SOCIAL_WORKER_ID = 'social-offers';
const OPEN_CAMPAIGN = ['QUEUED', 'SEARCHING', 'PAUSED', 'MATCHING'];
const MAX_OFFERS = 500;

/** Ended campaigns of this person for this search: their discovery run ids. */
async function endedCampaigns(db: any, searchId: string, userId: string): Promise<string[]> {
  const { data: subs } = await db.from('active_search_subscriptions').select('id')
    .eq('side', 'SUPPLY').eq('search_criteria->>marketplaceSearchId', searchId).eq('user_id', userId);
  const subIds = ((subs ?? []) as Array<{ id: string }>).map((s) => s.id);
  if (!subIds.length) return [];
  const { data: runs } = await db.from('discovery_runs').select('id,status')
    .in('subscription_id', subIds).eq('user_id', userId).in('pricing_policy', [...PAID_DISCOVERY_POLICIES]);
  return ((runs ?? []) as Array<{ id: string; status: string }>).filter((r) => !OPEN_CAMPAIGN.includes(r.status)).map((r) => r.id);
}

/** The social offers of this search's ended campaigns, as marketplace candidates. */
export async function loadSocialCandidates(db: any, searchId: string, userId: string | null, now = new Date()):
  Promise<Array<{ workerId: string; candidate: ExternalListingCandidate }>> {
  if (!userId) return [];
  const runIds = await endedCampaigns(db, searchId, userId);
  if (!runIds.length) return [];
  const { data: actorRuns } = await db.from('find_property_actor_runs').select('id').in('discovery_run_id', runIds);
  const actorRunIds = ((actorRuns ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (!actorRunIds.length) return [];
  const { data: rows, error } = await db.from('supply_observations')
    .select('id,external_id,canonical_url,transaction,property_type,city,district,sale_amount,sale_currency,rent_amount,rent_currency,rent_period,area_sqm,rooms,bedrooms,floor,total_floors,title,description,published_at,last_seen_at,image_urls,field_origins')
    .in('field_origins->>memo23ActorRunId', actorRunIds).in('adapter_version', ['fp-social-offers-1', SOCIAL_ADAPTER_VERSION])
    .order('last_seen_at', { ascending: false }).limit(MAX_OFFERS);
  if (error) throw new Error(`social offers read failed: ${error.message}`);
  return ((rows ?? []) as SocialObservation[])
    .map((o) => socialCandidate(o, now))
    .filter((c): c is ExternalListingCandidate => c != null)
    .map((candidate) => ({ workerId: SOCIAL_WORKER_ID, candidate }));
}

/** The marketplace search a paid social campaign was bought for, when it has one. */
export async function campaignSearchId(db: any, runId: string): Promise<string | null> {
  const { data: run } = await db.from('discovery_runs').select('subscription_id,user_id,pricing_policy').eq('id', runId).maybeSingle();
  if (!run?.subscription_id || !isPaidDiscoveryPolicy(run.pricing_policy)) return null;
  const { data: sub } = await db.from('active_search_subscriptions').select('search_criteria').eq('id', run.subscription_id).eq('user_id', run.user_id).maybeSingle();
  const id = sub?.search_criteria?.marketplaceSearchId;
  return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}
