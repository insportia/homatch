import { processSearch, publicView } from '../../../src/research-core/marketplace/pipeline.ts';
import type { CustomerProperty } from '../../../src/research-core/marketplace/browse-results.ts';
import type { ExternalListingCandidate, MarketplaceSearchRequest } from '../../../src/research-core/marketplace/worker-contract.ts';
import { readAll, loadConverter } from './marketplaceSearch.ts';
type Db = any;

/** Old saved searches acquire the new deterministic evidence from their own stored raw data.
 * No source request, model call or mutation occurs on a customer read. */
export async function resultCatalogue(db: Db, search: Record<string, unknown>): Promise<CustomerProperty[]> {
  const rows = await readAll<{ view: CustomerProperty }>((from, to) => db.from('discovery_marketplace_properties')
    .select('view').eq('search_id', search.id).order('property_key').range(from, to));
  if (rows.every((row) => row.view.intelligence)) return rows.map((row) => row.view);
  const raw = await readAll<{ raw: ExternalListingCandidate }>((from, to) => db.from('discovery_marketplace_listings')
    .select('raw').eq('search_id', search.id).order('id').range(from, to));
  if (!raw.length) return rows.map((row) => row.view);
  const output = processSearch({ request: search.request as MarketplaceSearchRequest,
    candidates: raw.map((row) => ({ workerId: 'stored', candidate: row.raw })), converter: await loadConverter(db),
    now: new Date(String(search.processed_at ?? search.created_at)) });
  return output.properties.map(publicView);
}
