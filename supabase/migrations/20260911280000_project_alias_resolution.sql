/* ══════════════════════════════════════════════════════════════════════
 * EVERY SPELLING OF A PROJECT THAT HAS BEEN SEEN POINTING AT IT
 * ══════════════════════════════════════════════════════════════════════
 *
 * canonicalProjectKey normalises the street-type word across scripts but not
 * the name. So "kristian-stiven-street-18" and "კრისტიან-სტივენის-street-18"
 * stayed two PROJECT entities, and split again in production within an hour of
 * the first pair being merged.
 *
 * Transliteration does not close it. The Georgian genitive makes "სტივენის"
 * into "stivenis", not "stiven", and stripping case endings is morphology
 * rather than a deterministic rewrite. A rule loose enough to fuse those is
 * loose enough to fuse two real developments, which would put one building's
 * floors, developer and commissioning status into another building's report.
 *
 * So nothing is inferred. A spelling OBSERVED for a project is remembered, and
 * the next verification that meets it resolves to the same entity. Evidence,
 * not inference.
 *
 * alias_key is unique among non-rejected rows: one spelling cannot point at
 * two projects. A collision does nothing rather than re-pointing, so the first
 * project to claim a spelling keeps it and the clash is left for a person.
 * REJECTED exists so an operator can say "this spelling is NOT this project"
 * and have that stick.
 */
create table if not exists public.intelligence_project_aliases (
  id           uuid primary key default gen_random_uuid(),
  entity_id    uuid not null references public.intelligence_entities(id) on delete cascade,
  alias_key    text not null,
  alias_raw    text not null,
  script       text not null default 'UNKNOWN'
               check (script in ('LATIN','GEORGIAN','CYRILLIC','MIXED','UNKNOWN')),
  source_kind  text not null default 'PUBLIC_WEB'
               check (source_kind in ('OFFICIAL_REGISTRY','OFFICIAL_DOCUMENT','PUBLIC_WEB','MARKET_LISTING',
                                      'PARTNER_PUBLICATION','DEVELOPER_STATEMENT','MEDIA_REPORT','DETERMINISTIC_DERIVATION')),
  evidence_ref text,
  confidence   numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  resolution   text not null default 'AUTO' check (resolution in ('AUTO','MANUAL','REJECTED')),
  first_job_id uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint alias_key_not_blank check (length(btrim(alias_key)) > 0)
);

create unique index if not exists intelligence_project_aliases_key
  on public.intelligence_project_aliases (alias_key)
  where resolution <> 'REJECTED';

create index if not exists intelligence_project_aliases_entity
  on public.intelligence_project_aliases (entity_id);

comment on table public.intelligence_project_aliases is
  'Observed spellings of a project name, each pointing at the entity it was seen for. Resolves cross-script and cross-source duplicates by evidence rather than by transliteration, which Georgian morphology makes unsafe.';

alter table public.intelligence_project_aliases enable row level security;
alter table public.intelligence_project_aliases force row level security;

drop policy if exists intelligence_project_aliases_service_all on public.intelligence_project_aliases;
create policy intelligence_project_aliases_service_all
  on public.intelligence_project_aliases for all to service_role using (true) with check (true);

drop policy if exists intelligence_project_aliases_admin_read on public.intelligence_project_aliases;
create policy intelligence_project_aliases_admin_read
  on public.intelligence_project_aliases for select to authenticated using (true);

revoke all on public.intelligence_project_aliases from anon;
grant select on public.intelligence_project_aliases to authenticated;
grant all on public.intelligence_project_aliases to service_role;

/* Projects that two different spellings put on the SAME parcel.
 *
 * A parcel is one registered piece of land. Two PROJECT entities reached from
 * a single parcel are the strongest corroboration available that they are one
 * development — and it is the evidence the cross-script case actually leaves
 * behind, because the Georgian-named run wrote the same parcel edge the Latin
 * one did.
 *
 * A REPORT, not an action. It proposes; merge_intelligence_entities disposes,
 * and only when a person runs it. Ambiguous cases must never auto-merge.
 */
create or replace view public.duplicate_projects_on_one_parcel as
select
  p.natural_key                         as parcel,
  min(e.id::text)::uuid                 as keep_entity,
  array_agg(e.id order by e.first_seen_at) as entity_ids,
  array_agg(e.natural_key order by e.first_seen_at) as project_keys,
  count(*)                              as projects_on_parcel
from public.intelligence_relationships r
join public.intelligence_entities p on p.id = r.from_entity_id and p.entity_type = 'PARENT_PARCEL'
join public.intelligence_entities e on e.id = r.to_entity_id   and e.entity_type = 'PROJECT'
where r.relation = 'PART_OF_PROJECT' and r.status = 'CURRENT'
group by p.natural_key
having count(*) > 1;

comment on view public.duplicate_projects_on_one_parcel is
  'Candidate duplicate PROJECT entities, corroborated by sharing a parcel. A proposal for merge_intelligence_entities to act on - never an automatic merge.';

revoke all on public.duplicate_projects_on_one_parcel from anon, authenticated;
grant select on public.duplicate_projects_on_one_parcel to service_role;
