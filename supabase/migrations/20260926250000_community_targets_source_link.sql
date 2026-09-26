-- A COMMUNITY TARGET'S LINK BACK TO THE REGISTRY.
--
-- Measured 2026-09-26, immediately after community-sync first persisted real
-- evidence: 18 rows, every one carrying target_id and NONE carrying source_id.
--
-- That matters because revalidate-evidence -- the worker that keeps evidence
-- deliverable -- resolves a signal's permission to be re-read through
-- source_registry!source_id. With source_id null it concludes "source is
-- unregistered and has never been audited; not requested" and advances no
-- timestamp, forever. So community evidence would reach the seven-day delivery
-- window, be queued for revalidation, and come back permanently UNKNOWN: not
-- because the channel is unreadable, but because nothing connected the row to the
-- registry entry that already existed for it.
--
-- The three Telegram targets were seeded FROM source_registry rows, so this link is
-- not new information. It was simply never recorded.
--
-- WHAT THIS DOES NOT DO
--
-- It does not make those channels revalidatable. Their registry rows are
-- lifecycle DISCOVERED with access_finding null, and revalidate-evidence refuses
-- an unaudited source on purpose -- that refusal is the registry contract working,
-- not a bug. Auditing and promoting a source is a decision about whether Homatch
-- may read it, and a migration is not where that gets decided.
--
-- What this removes is the STRUCTURAL dead end underneath that decision: once a
-- source is audited, the evidence can now actually be reached by the worker. Before
-- this column, promoting the source would have changed nothing and the reason would
-- have been invisible.
--
-- NULLABLE, deliberately. A community discovered on its own, with no registry entry
-- yet, is a legitimate state, and forcing a row here would mean inventing a registry
-- entry to satisfy a constraint. What the column forbids is the entry EXISTING while
-- the link is missing.
--
-- ON DELETE SET NULL: retiring a registry entry must not delete a target's
-- accumulated read history.
alter table community_targets
  add column if not exists source_id uuid
  references source_registry(id) on delete set null;

comment on column community_targets.source_id is
  'The registry entry this target corresponds to, when one exists. revalidate-evidence '
  'resolves re-read permission through source_registry, so a community signal with no '
  'path back to it can never be revalidated.';

create index if not exists community_targets_source_id_idx
  on community_targets (source_id)
  where source_id is not null;

-- Backfill from the URL each target was seeded from.
--
-- An exact match on the canonical t.me form, never LIKE: 'https://t.me/tbilisi'
-- must not claim 'https://t.me/tbilisiapartments', and a prefix match is exactly
-- how it would. The trailing-slash variant is included because the registry holds
-- both spellings.
update community_targets t
set source_id = r.id,
    updated_at = now()
from source_registry r
where t.source_id is null
  and t.platform = 'TELEGRAM'
  and lower(r.url) in (
    'https://t.me/' || lower(t.external_id),
    'https://t.me/' || lower(t.external_id) || '/'
  );
