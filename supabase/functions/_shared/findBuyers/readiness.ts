// Search readiness on the server: the inputs of decideReadiness, read from
// settings, the provider credential and the Actor registry. Never names a
// provider to the customer; the reason code is generic.

import { decideReadiness, type Readiness } from '../../../../src/research-core/findBuyers/readiness.ts';
import { enabledActorMap, type FindBuyersSettings } from './campaign.ts';
import type { DiscoverySettings } from '../discoverySettings.ts';
import { providerConfigured as memo23Configured } from './memo23Client.ts';

export async function discoveryReadiness(db: any, discovery: DiscoverySettings, findBuyers: FindBuyersSettings): Promise<Readiness & { eligibleActors: number }> {
  const providerConfigured = memo23Configured();
  let eligibleActors = 0;
  if (findBuyers.socialEnabled && providerConfigured) {
    eligibleActors = Object.keys(await enabledActorMap(db, findBuyers.pricingMaxAgeDays)).length;
  }
  return {
    ...decideReadiness({
      socialEnabled: findBuyers.socialEnabled,
      providerConfigured,
      eligibleActors,
      nativeSourceDiscoveryEnabled: discovery.campaignSourceDiscoveryEnabled,
      telegramEnabled: discovery.telegramEnabled,
      forumEnabled: discovery.forumDiscoveryEnabled,
    }),
    eligibleActors,
  };
}
