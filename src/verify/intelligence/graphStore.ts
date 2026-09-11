// HOMATCH — reading from and writing to the intelligence graph.
//
// The only module that touches the intelligence tables. Everything it does is
// driven by the pure logic beside it: harvest.ts decides what may be learned,
// freshness.ts decides what must be re-checked, and this decides how that
// becomes rows.
//
// THREE OUTCOMES WHEN A FACT IS WRITTEN, and the difference between them is
// the whole value of the layer:
//
//   UNCHANGED  we already knew this and the new observation agrees. Nothing is
//              inserted; the existing row's last_verified_at moves forward.
//              This is what makes the next verification cheap.
//
//   CHANGED    we knew something different. The old row is superseded rather
//              than overwritten, so "owner A → owner B" survives as history
//              with both provenances intact. A buyer asking "has this changed
//              recently?" is asking about exactly this.
//
//   NEW        we did not know it.
//
// Overwriting in place would collapse the second case into the first and lose
// the one thing a returning customer most wants to know.
//
// Nothing here throws into a caller's critical path: a verification the
// customer paid for must never be lost because the graph could not be
// updated. Failures are logged and the harvest is abandoned, never the report.

import type { Harvest, HarvestedEntity, HarvestedFact, HarvestedRelationship } from './harvest.ts';
import type { KnownFact } from './freshness.ts';

/** The narrow slice of a Supabase client this module needs. */
export interface GraphClient {
  from(table: string): any;
}

export interface WriteOutcome {
  entities: number;
  factsNew: number;
  factsChanged: number;
  factsUnchanged: number;
  relationshipsNew: number;
  relationshipsConfirmed: number;
  /** Facts whose value moved, for the buyer-visible change history. */
  changes: { factKey: string; from: string | null; to: string | null }[];
  errors: string[];
}

const emptyOutcome = (): WriteOutcome => ({
  entities: 0, factsNew: 0, factsChanged: 0, factsUnchanged: 0,
  relationshipsNew: 0, relationshipsConfirmed: 0, changes: [], errors: [],
});

/**
 * A comparable rendering of a fact's value.
 *
 * Used only to answer "is this the same as what we held", so it has to be
 * stable across two observations of an unchanged fact. Arrays are sorted
 * because "lift, parking" and "parking, lift" are the same amenities, and a
 * report that listed them in a different order should not read as a change.
 */
export function valueSignature(f: {
  valueText?: string | null;
  valueNumber?: number | null;
  valueJson?: unknown;
}): string {
  if (f.valueNumber != null) return `n:${f.valueNumber}`;
  if (f.valueText != null && String(f.valueText).trim()) return `t:${String(f.valueText).trim()}`;
  if (f.valueJson != null) {
    const j = Array.isArray(f.valueJson)
      ? [...f.valueJson].map((x) => JSON.stringify(x)).sort()
      : f.valueJson;
    return `j:${JSON.stringify(j)}`;
  }
  return '';
}

/** The same rendering, for a row already in the database. */
function rowSignature(row: any): string {
  return valueSignature({
    valueText: row?.value_text,
    valueNumber: row?.value_number == null ? null : Number(row.value_number),
    valueJson: row?.value_json,
  });
}

/** A short, human rendering for the change history. */
function readableValue(row: any): string | null {
  if (row?.value_number != null) return String(row.value_number);
  if (row?.value_text) return String(row.value_text);
  if (row?.value_json != null) return JSON.stringify(row.value_json);
  return null;
}

/**
 * Finds or creates the node for one real-world thing.
 *
 * `last_seen_at` moves on every sighting, which is how a project nobody has
 * looked at in a year becomes visible as such.
 */
async function upsertEntity(db: GraphClient, e: HarvestedEntity): Promise<string | null> {
  const { data: existing } = await db
    .from('intelligence_entities')
    .select('id')
    .eq('key_kind', e.keyKind)
    .eq('natural_key', e.naturalKey)
    .maybeSingle();

  if (existing?.id) {
    await db
      .from('intelligence_entities')
      .update({ last_seen_at: new Date().toISOString(), ...(e.displayName ? { display_name: e.displayName } : {}) })
      .eq('id', existing.id);
    return existing.id;
  }

  const { data, error } = await db
    .from('intelligence_entities')
    .insert({
      entity_type: e.entityType,
      key_kind: e.keyKind,
      natural_key: e.naturalKey,
      display_name: e.displayName ?? null,
    })
    .select('id')
    .single();

  if (error) {
    // Another verification of the same property, running at the same moment,
    // may have created it between the read and the insert. That is a race to
    // lose gracefully, not an error.
    const { data: raced } = await db
      .from('intelligence_entities')
      .select('id')
      .eq('key_kind', e.keyKind)
      .eq('natural_key', e.naturalKey)
      .maybeSingle();
    return raced?.id ?? null;
  }
  return data?.id ?? null;
}

async function writeFact(
  db: GraphClient,
  entityId: string,
  f: HarvestedFact,
  jobId: string | null,
  out: WriteOutcome
): Promise<void> {
  const now = new Date().toISOString();

  const { data: current } = await db
    .from('intelligence_facts')
    .select('id, value_text, value_number, value_json')
    .eq('entity_id', entityId)
    .eq('fact_key', f.factKey)
    .eq('status', 'CURRENT')
    .maybeSingle();

  const incoming = valueSignature(f);
  if (!incoming) return;

  if (current && rowSignature(current) === incoming) {
    // KNOWN AND STILL TRUE. The cheapest outcome there is: no new row, and
    // the clock on the existing one moves forward so the next verification
    // finds it fresh.
    await db
      .from('intelligence_facts')
      .update({ last_verified_at: now, ...(f.confidence != null ? { confidence: f.confidence } : {}) })
      .eq('id', current.id);
    out.factsUnchanged += 1;
    return;
  }

  const row = {
    entity_id: entityId,
    fact_key: f.factKey,
    value_text: f.valueText ?? null,
    value_number: f.valueNumber ?? null,
    value_json: f.valueJson ?? null,
    value_unit: f.valueUnit ?? null,
    source_kind: f.sourceKind,
    source_ref: f.sourceRef ?? null,
    evidence_ref: f.evidenceRef ?? null,
    first_job_id: jobId,
    retrieved_at: now,
    last_verified_at: now,
    confidence: f.confidence ?? null,
    freshness_class: f.freshnessClass,
    status: 'CURRENT',
    ...(current ? { supersedes: current.id } : {}),
  };

  if (current) {
    /*
     * IT CHANGED. The old value is superseded, never overwritten.
     *
     * Superseding FIRST, because a partial unique index allows exactly one
     * CURRENT row per fact and the insert would otherwise collide with the
     * row it is replacing. That constraint is what makes "two truths" a
     * failure rather than a silent state.
     */
    await db.from('intelligence_facts').update({ status: 'SUPERSEDED', valid_to: now }).eq('id', current.id);
  }

  const { data: inserted, error } = await db.from('intelligence_facts').insert(row).select('id').single();
  if (error) {
    out.errors.push(`${f.factKey}: ${error.message ?? error}`);
    // Put the old value back rather than leaving the entity with no current
    // answer at all: a gap reads as "we never knew", which is worse than
    // "we knew this yesterday".
    if (current) {
      await db.from('intelligence_facts').update({ status: 'CURRENT', valid_to: null }).eq('id', current.id);
    }
    return;
  }

  if (current) {
    await db.from('intelligence_facts').update({ superseded_by: inserted?.id ?? null }).eq('id', current.id);
    out.factsChanged += 1;
    out.changes.push({
      factKey: f.factKey,
      from: readableValue(current),
      to: readableValue(row),
    });
  } else {
    out.factsNew += 1;
  }
}

async function writeRelationship(
  db: GraphClient,
  fromId: string,
  toId: string,
  r: HarvestedRelationship,
  jobId: string | null,
  out: WriteOutcome
): Promise<void> {
  const now = new Date().toISOString();

  const { data: existing } = await db
    .from('intelligence_relationships')
    .select('id')
    .eq('from_entity_id', fromId)
    .eq('to_entity_id', toId)
    .eq('relation', r.relation)
    .maybeSingle();

  if (existing?.id) {
    await db
      .from('intelligence_relationships')
      .update({ last_verified_at: now, status: 'CURRENT' })
      .eq('id', existing.id);
    out.relationshipsConfirmed += 1;
    return;
  }

  const { error } = await db.from('intelligence_relationships').insert({
    from_entity_id: fromId,
    to_entity_id: toId,
    relation: r.relation,
    source_kind: r.sourceKind,
    source_ref: r.sourceRef ?? null,
    evidence_ref: r.evidenceRef ?? null,
    first_job_id: jobId,
    retrieved_at: now,
    last_verified_at: now,
    confidence: r.confidence ?? null,
    // Written explicitly rather than left to the column default. The read
    // path FILTERS on this, so a row that relies on a default is a row that
    // disappears the day the default changes — and it would disappear
    // silently, as a property that suddenly has no parcel.
    status: 'CURRENT',
  });

  if (error) out.errors.push(`${r.relation}: ${error.message ?? error}`);
  else out.relationshipsNew += 1;
}

/**
 * Writes a whole harvest, and reports what actually changed.
 *
 * Never throws. The caller is finishing a verification somebody paid for, and
 * the graph is an optimisation: losing an update costs one cheap future
 * verification, while losing the report costs a customer.
 */
export async function persistHarvest(
  db: GraphClient,
  harvest: Harvest,
  jobId: string | null
): Promise<WriteOutcome> {
  const out = emptyOutcome();
  try {
    const ids = new Map<string, string>();
    const keyOf = (e: HarvestedEntity) => `${e.keyKind}:${e.naturalKey}`;

    for (const e of harvest.entities) {
      const id = await upsertEntity(db, e);
      if (id) { ids.set(keyOf(e), id); out.entities += 1; }
    }

    for (const f of harvest.facts) {
      const id = ids.get(keyOf(f.entity));
      if (id) await writeFact(db, id, f, jobId, out);
    }

    for (const r of harvest.relationships) {
      const from = ids.get(keyOf(r.from));
      const to = ids.get(keyOf(r.to));
      if (from && to) await writeRelationship(db, from, to, r, jobId, out);
    }
  } catch (e) {
    out.errors.push(e instanceof Error ? e.message : String(e));
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The read path                                                       *
 * ------------------------------------------------------------------ */

export interface KnownIntelligence {
  entityId: string | null;
  facts: KnownFact[];
  /** Facts about the parcel, building or project this property belongs to. */
  relatedFacts: KnownFact[];
  relatedEntities: { id: string; entityType: string; naturalKey: string; relation: string }[];
}

/**
 * What Homatch already knows about one property.
 *
 * Includes facts about the things it BELONGS to — its parcel, its project,
 * the company that built it — because that is where reuse actually pays.
 * A second flat in the same building needs none of the project research the
 * first one paid for.
 *
 * A parcel fact is returned as a parcel fact and never merged into the unit's
 * own: the distinction between "registered against this flat" and "registered
 * against the land it stands on" is the single most consequential one in a
 * Georgian due-diligence report.
 */
export async function loadKnownIntelligence(
  db: GraphClient,
  keyKind: string,
  naturalKey: string
): Promise<KnownIntelligence> {
  const empty: KnownIntelligence = { entityId: null, facts: [], relatedFacts: [], relatedEntities: [] };
  try {
    const { data: entity } = await db
      .from('intelligence_entities')
      .select('id')
      .eq('key_kind', keyKind)
      .eq('natural_key', naturalKey)
      .maybeSingle();
    if (!entity?.id) return empty;

    // value_text comes back too: the planner needs one value, the asset
    // class, to know which fact families this kind of property can even have.
    const { data: facts } = await db
      .from('intelligence_facts')
      .select('fact_key, value_text, status, last_verified_at, freshness_class, content_hash, source_ref')
      .eq('entity_id', entity.id)
      .eq('status', 'CURRENT');

    /*
     * Two plain reads rather than one embedded join.
     *
     * PostgREST can embed the far side of a relationship, but naming the
     * foreign key explicitly — which is required here, because the table
     * points at intelligence_entities twice — ties this query to a constraint
     * name that a future migration can rename without anything failing until
     * production. Two queries are duller, cheaper to reason about, and mean
     * the same thing.
     */
    /*
     * TWO HOPS, AND NO MORE.
     *
     * One hop reaches the parcel. The project stands on the parcel and the
     * company built the project, so a second hop is what actually reaches the
     * research worth reusing — measured in production, a flat whose link to
     * its project could not be verified had seven researched project facts
     * sitting unreachable and reused three facts out of eighteen.
     *
     * The limit is two because the third hop is where a graph stops being an
     * answer and starts being a crawl: a company builds other projects, and
     * their facts are about other properties.
     *
     * Everything past the first hop stays in relatedFacts. The distinction
     * between "registered against this flat" and "true of the land it stands
     * on" is the most consequential one in a Georgian due-diligence report,
     * and it is preserved by construction rather than by remembering to.
     */
    const relatedEntities: KnownIntelligence['relatedEntities'] = [];
    const visited = new Set<string>([entity.id]);
    let frontier = [entity.id];

    for (let hop = 0; hop < 2 && frontier.length; hop++) {
      const { data: edges } = await db
        .from('intelligence_relationships')
        .select('to_entity_id, relation')
        .in('from_entity_id', frontier)
        .eq('status', 'CURRENT');

      const edgeRows = ((edges ?? []) as { to_entity_id: string; relation: string }[])
        .filter((e) => e.to_entity_id && !visited.has(e.to_entity_id));
      if (!edgeRows.length) break;

      const ids = [...new Set(edgeRows.map((e) => e.to_entity_id))];
      const { data: targets } = await db
        .from('intelligence_entities')
        .select('id, entity_type, natural_key')
        .in('id', ids);

      const byId = new Map<string, { id: string; entity_type: string; natural_key: string }>(
        ((targets ?? []) as { id: string; entity_type: string; natural_key: string }[]).map((t) => [t.id, t])
      );

      for (const e of edgeRows) {
        const t = byId.get(e.to_entity_id);
        if (!t || visited.has(t.id)) continue;
        visited.add(t.id);
        relatedEntities.push({ id: t.id, entityType: t.entity_type, naturalKey: t.natural_key, relation: e.relation });
      }
      frontier = ids.filter((id) => byId.has(id));
    }

    let relatedFacts: KnownFact[] = [];
    if (relatedEntities.length) {
      const { data: rf } = await db
        .from('intelligence_facts')
        .select('entity_id, fact_key, status, last_verified_at, freshness_class, content_hash, source_ref')
        .in('entity_id', relatedEntities.map((r) => r.id))
        .eq('status', 'CURRENT');
      relatedFacts = (rf ?? []) as KnownFact[];
    }

    return { entityId: entity.id, facts: (facts ?? []) as KnownFact[], relatedFacts, relatedEntities };
  } catch {
    // Knowing nothing is always a safe answer: the verification simply
    // researches everything, exactly as it did before this layer existed.
    return empty;
  }
}
