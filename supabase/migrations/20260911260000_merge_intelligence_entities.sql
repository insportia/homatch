/* ══════════════════════════════════════════════════════════════════════
 * FOLDING ONE ENTITY INTO ANOTHER WITHOUT LOSING WHAT IT KNEW
 * ══════════════════════════════════════════════════════════════════════
 *
 * The same development reached the graph twice — "Kristian Stiven St, 18" and
 * "Kristian Stiven Street, 18" — as two PROJECT entities holding seven facts
 * each. A verification arriving through one could not see anything learned
 * through the other.
 *
 * canonicalProjectKey (src/verify/intelligence/projectIdentity.ts) stops that
 * happening again. This is for the rows already written, and for any future
 * pair that slips through a different way.
 *
 * WHY THIS IS SQL AND NOT A SCRIPT. Four tables' worth of invariants have to
 * hold at the end: one CURRENT fact per (entity, key), no relationship from a
 * thing to itself, no duplicate (from, to, relation), and every fact still
 * attached to an entity that exists. Doing it row by row from outside the
 * database means a half-merged graph if anything fails in the middle. This
 * runs in one transaction: it either happens or it does not.
 *
 * WHAT IS PRESERVED, DELIBERATELY.
 *
 * Facts       Nothing is deleted. A loser fact whose key the winner already
 *             holds becomes SUPERSEDED and points at the winner's fact
 *             through superseded_by, so the history reads as "we used to
 *             believe this, then we learned that" — which is what actually
 *             happened, and is the same shape the normal write path produces.
 * Provenance  first_job_id, source_kind, source_ref, evidence_ref and
 *             retrieved_at ride along on the row untouched. A moved fact is
 *             still attributable to the verification that found it.
 * History     Superseded and stale rows move too. They are the record of what
 *             changed and when, and dropping them would quietly rewrite it.
 * Relations   Edges are repointed. A duplicate edge collapses onto the
 *             survivor, which takes the EARLIER retrieved_at and the LATER
 *             last_verified_at of the two — the union of what both knew.
 * Timestamps  The surviving entity's first_seen_at goes back to the earlier
 *             of the two, because that is when Homatch first saw this thing.
 */

create or replace function public.merge_intelligence_entities(
  p_winner uuid,
  p_loser  uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_winner  public.intelligence_entities;
  v_loser   public.intelligence_entities;
  v_facts_moved      int := 0;
  v_facts_superseded int := 0;
  v_edges_moved      int := 0;
  v_edges_collapsed  int := 0;
  v_edges_dropped    int := 0;
  v_tmp              int := 0;
begin
  if p_winner is null or p_loser is null or p_winner = p_loser then
    raise exception 'merge needs two different entities (winner=%, loser=%)', p_winner, p_loser;
  end if;

  select * into v_winner from public.intelligence_entities where id = p_winner for update;
  select * into v_loser  from public.intelligence_entities where id = p_loser  for update;

  if v_winner.id is null then raise exception 'winner % does not exist', p_winner; end if;
  if v_loser.id  is null then raise exception 'loser % does not exist', p_loser;  end if;

  /* Merging a project into a company would silently corrupt the graph in a
   * way nothing downstream checks. Refuse rather than trust the caller. */
  if v_winner.entity_type <> v_loser.entity_type then
    raise exception 'refusing to merge % into % — different entity types',
      v_loser.entity_type, v_winner.entity_type;
  end if;

  /* ── facts the winner already holds ──────────────────────────────────
   * The loser's version becomes history rather than being deleted, and says
   * which fact replaced it. Done BEFORE the move so the one-CURRENT-per-key
   * index is never momentarily violated. */
  with clash as (
    select l.id as loser_fact, w.id as winner_fact
    from public.intelligence_facts l
    join public.intelligence_facts w
      on w.entity_id = p_winner
     and w.fact_key  = l.fact_key
     and w.status    = 'CURRENT'
    where l.entity_id = p_loser
      and l.status    = 'CURRENT'
  )
  update public.intelligence_facts f
     set status        = 'SUPERSEDED',
         superseded_by = clash.winner_fact,
         valid_to      = coalesce(f.valid_to, now()),
         updated_at    = now()
    from clash
   where f.id = clash.loser_fact;
  get diagnostics v_facts_superseded = row_count;

  /* ── everything else the loser knew moves across ─────────────────── */
  update public.intelligence_facts
     set entity_id  = p_winner,
         updated_at = now()
   where entity_id = p_loser;
  get diagnostics v_facts_moved = row_count;

  /* ── edges that would become self-referential ─────────────────────
   * unit -> loser and unit -> winner both exist, or loser -> winner does.
   * A thing cannot be part of itself; the winner's own edge already says
   * whatever this one said. */
  delete from public.intelligence_relationships
   where (from_entity_id = p_loser and to_entity_id = p_winner)
      or (from_entity_id = p_winner and to_entity_id = p_loser);
  get diagnostics v_edges_dropped = row_count;

  /* ── duplicate edges collapse onto the survivor ───────────────────
   * The survivor takes the union of what both rows knew about when it was
   * first seen and last confirmed, so repointing never loses provenance. */
  update public.intelligence_relationships w
     set retrieved_at      = least(w.retrieved_at, l.retrieved_at),
         last_verified_at  = greatest(w.last_verified_at, l.last_verified_at),
         first_job_id      = coalesce(w.first_job_id, l.first_job_id),
         confidence        = greatest(coalesce(w.confidence, 0), coalesce(l.confidence, 0)),
         updated_at        = now()
    from public.intelligence_relationships l
   where l.from_entity_id = p_loser
     and w.from_entity_id = p_winner
     and w.to_entity_id   = l.to_entity_id
     and w.relation       = l.relation;

  delete from public.intelligence_relationships l
   using public.intelligence_relationships w
   where l.from_entity_id = p_loser
     and w.from_entity_id = p_winner
     and w.to_entity_id   = l.to_entity_id
     and w.relation       = l.relation;
  get diagnostics v_edges_collapsed = row_count;

  update public.intelligence_relationships w
     set retrieved_at      = least(w.retrieved_at, l.retrieved_at),
         last_verified_at  = greatest(w.last_verified_at, l.last_verified_at),
         first_job_id      = coalesce(w.first_job_id, l.first_job_id),
         confidence        = greatest(coalesce(w.confidence, 0), coalesce(l.confidence, 0)),
         updated_at        = now()
    from public.intelligence_relationships l
   where l.to_entity_id   = p_loser
     and w.to_entity_id   = p_winner
     and w.from_entity_id = l.from_entity_id
     and w.relation       = l.relation;

  delete from public.intelligence_relationships l
   using public.intelligence_relationships w
   where l.to_entity_id   = p_loser
     and w.to_entity_id   = p_winner
     and w.from_entity_id = l.from_entity_id
     and w.relation       = l.relation;
  get diagnostics v_tmp = row_count;
  v_edges_collapsed := v_edges_collapsed + v_tmp;

  /* ── the rest repoint ─────────────────────────────────────────────── */
  update public.intelligence_relationships
     set from_entity_id = p_winner, updated_at = now()
   where from_entity_id = p_loser;
  get diagnostics v_edges_moved = row_count;

  update public.intelligence_relationships
     set to_entity_id = p_winner, updated_at = now()
   where to_entity_id = p_loser;
  get diagnostics v_tmp = row_count;
  v_edges_moved := v_edges_moved + v_tmp;

  /* ── the surviving entity inherits the longer memory ──────────────── */
  update public.intelligence_entities
     set first_seen_at        = least(v_winner.first_seen_at, v_loser.first_seen_at),
         last_seen_at         = greatest(v_winner.last_seen_at, v_loser.last_seen_at),
         display_name         = coalesce(v_winner.display_name, v_loser.display_name),
         developer_profile_id = coalesce(v_winner.developer_profile_id, v_loser.developer_profile_id),
         developer_project_id = coalesce(v_winner.developer_project_id, v_loser.developer_project_id),
         updated_at           = now()
   where id = p_winner;

  delete from public.intelligence_entities where id = p_loser;

  return jsonb_build_object(
    'winner', p_winner,
    'winner_key', v_winner.natural_key,
    'loser', p_loser,
    'loser_key', v_loser.natural_key,
    'facts_moved', v_facts_moved,
    'facts_superseded', v_facts_superseded,
    'edges_repointed', v_edges_moved,
    'edges_collapsed', v_edges_collapsed,
    'edges_dropped_as_self', v_edges_dropped
  );
end;
$$;

comment on function public.merge_intelligence_entities(uuid, uuid) is
  'Folds one intelligence entity into another in a single transaction, preserving facts, their provenance and their history, and repointing relationships without breaking the one-CURRENT-per-key, no-self-edge or unique-edge invariants. Which entities to merge is decided outside the database, by canonicalProjectKey.';

revoke all on function public.merge_intelligence_entities(uuid, uuid) from public, anon, authenticated;
grant execute on function public.merge_intelligence_entities(uuid, uuid) to service_role;
