// Whether the paid social OFFER campaign may be offered right now: the Find
// Property paid switch, its social switch, and the provider switch in Admin.
// The free marketplace search only asks this one question and touches no
// provider itself.
import { loadOfferSettings } from './socialOffers.ts';

export async function paidCampaignAvailable(db: any): Promise<boolean> {
  const [{ data }, offers] = await Promise.all([
    db.from('admin_settings').select('value').eq('key', 'find_property_discovery_enabled').maybeSingle(),
    loadOfferSettings(db),
  ]);
  return data?.value === true && offers.enabled;
}
