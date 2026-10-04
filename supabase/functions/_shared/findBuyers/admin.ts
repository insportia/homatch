// Admin verification of one memo23 Actor: current pricing and input schema,
// read from Apify server-side and written to the registry. Verifying never
// enables an Actor; an operator does that separately.

import { actorDefinition, Memo23Error } from './memo23Client.ts';

export async function verifyActor(db: any, actorKey: string) {
  const { data: actor } = await db.from('find_buyers_actor_registry').select('actor_key,actor_id,input_contract,health').eq('actor_key', actorKey).maybeSingle();
  if (!actor) return { success: false, error: 'UNKNOWN_ACTOR' };
  try {
    const def = await actorDefinition(actor.actor_id);
    const verifiedAt = new Date().toISOString();
    const priced = def.pricing.model !== 'UNKNOWN' && def.pricing.pricePer1kMicros != null;
    await db.from('find_buyers_actor_registry').update({
      pricing_model: def.pricing.model,
      price_per_1k_micros: def.pricing.pricePer1kMicros,
      start_fee_micros: def.pricing.startFeeMicros,
      pricing_source: `apify api ${verifiedAt.slice(0, 10)}`,
      /* Only a price Apify actually stated counts as verified. */
      pricing_verified_at: priced ? verifiedAt : null,
      input_contract: { ...(actor.input_contract ?? {}), schemaProperties: def.schemaProperties, pricingRaw: def.pricing.raw ?? null },
      input_contract_verified_at: def.schemaProperties.length ? verifiedAt : null,
      /* Metadata is not a run: health only moves on a real execution. A
         previous failed verification (DEGRADED/FAILED) is cleared to UNKNOWN. */
      ...(['DEGRADED', 'FAILED'].includes(actor.health) ? { health: 'UNKNOWN' } : {}),
      last_verified_at: verifiedAt,
      last_error: priced ? null : 'pricing not stated by Apify; set it manually and mark verified',
      updated_at: verifiedAt,
    }).eq('actor_key', actorKey);
    return { success: true, actorKey, pricing: { model: def.pricing.model, pricePer1kMicros: def.pricing.pricePer1kMicros, startFeeMicros: def.pricing.startFeeMicros }, schemaProperties: def.schemaProperties, priced };
  } catch (error) {
    const e = error instanceof Memo23Error ? error : new Memo23Error(String(error), 0, false);
    await db.from('find_buyers_actor_registry').update({ health: e.status === 404 ? 'FAILED' : 'DEGRADED', last_error: e.message.slice(0, 500) }).eq('actor_key', actorKey);
    return { success: false, error: e.message };
  }
}
