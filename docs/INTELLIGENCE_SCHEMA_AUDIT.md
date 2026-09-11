# What Homatch already knows, and where it keeps it

An audit of every existing structure that could carry reusable intelligence,
done before writing a single migration. The question was deliberately narrow:

> Can the tables we already have express
> **ENTITY → FACT → SOURCE → VERSION/FRESHNESS → CURRENT VALUE**,
> and if not, what is genuinely missing?

The answer matters because the expensive mistake here is not a missing table.
It is a second knowledge system built beside a working one, after which every
read has to ask which of the two is right.

## The short version

| Role | What exists | Verdict |
|---|---|---|
| ENTITY | `developer_profiles`, `developer_projects`, `canonical_property_groups`, denormalised columns on `research_jobs` | **Missing for property.** No registry keyed by cadastral code. |
| FACT | `property_facts` (54-column listing snapshot), `deal_room_document_findings` (private) | **Missing.** Nothing stores one fact with its own provenance and validity. |
| SOURCE | `source_registry` (314 rows), `discovered_sources`, `research_jobs.evidence_bundle` | **Partial.** Platform level yes, record level no. |
| VERSION / FRESHNESS | `research_cache` (0 rows), `property_trust_scores.data_stale`, `*.last_checked_at` | **Right shape, dormant.** Keyed by query, not by fact. |
| CURRENT VALUE | `research_jobs.result_json` | **Missing.** Current per job, never per entity. |
| COGS | `cost_events` + `provider_price_book` | **Sufficient.** Extended this pass, not replaced. |

## ENTITY

`developer_profiles` is a real entity table and a good one — name, slug,
country, website, score, permits, restrictions, and a `last_checked_at` that
already expresses freshness. `developer_projects` hangs project entities off
it. Both are effectively unpopulated.

`canonical_property_groups` / `canonical_property_sources` are the closest
thing to a canonical property, but they exist to group **listings of the same
flat across portals**. There is no entity type, no cadastral code, and nothing
above the listing — no parcel, no building, no project.

`research_jobs` carries `entity_name`, `project_name`, `address`,
`developer_name`, `company_name` as denormalised columns for its own list UI.
They identify nothing across jobs: two verifications of the same flat produce
two unrelated rows.

**The gap, stated plainly.** The one identifier that actually identifies a
Georgian property — the cadastral code — exists only as `research_jobs.query`
and as free text inside `result_json`. Nothing can answer "have we researched
this property before?" without a string comparison against a query column.
Every reuse idea in the intelligence mandate depends on that question having
an answer.

## FACT

`property_facts` has 54 columns and looks at first like a fact table. It is
not. It is one row per imported **listing**, with `source_url`,
`external_listing_id`, price, area, rooms and so on — a snapshot of what one
portal said, in a wide table.

What it cannot express is the thing reuse requires:

> ownership = "LLC Millenio Group", established by registry extract *X* dated
> 14 July 2025, confidence high, valid from then until superseded, now
> superseded by *Y*.

There is no fact key, no per-fact source reference, no `observed_at`, no
validity window, no confidence, and no supersession. A column can hold today's
value; it cannot hold a value's history or its evidence.

`deal_room_document_findings` does carry findings with provenance, and is
deliberately out of scope: those come from **private uploaded documents** and
must never enter shared intelligence.

## SOURCE

`source_registry` (314 rows) is a genuine registry of *platforms* — myhome.ge,
ss.ge — with `quality_score`, `last_collected_at`, `last_successful_at`,
`failure_count`. `discovered_sources` tracks newly found ones with
`first_seen_at` / `last_seen_at` / `last_monitored_at`.

Both answer "which sites do we read". Neither answers "which **record** did
this fact come from, and has that record changed" — this registry extract,
this permit, this listing at this revision. `research_jobs.evidence_bundle`
holds per-job URLs in JSON, which is evidence for one report rather than a
source identity anything else can refer to.

## VERSION / FRESHNESS

`research_cache` is the find of this audit. Its columns are almost exactly
what source-level change detection needs:

```
fingerprint, provider, source_platform, source_reference, query_json,
result_json, content_hash, confidence, freshness_status,
acquired_at, last_verified_at, retention_expires_at, hit_count
```

`content_hash` plus `last_verified_at` plus `freshness_status` is a
change-detection substrate that somebody designed properly and nothing ever
used. **It holds zero rows.**

Its one limitation is what it is keyed on: `fingerprint` over `query_json`,
i.e. a cached *response to a query*, not a *source record*. Reuse at fact
level needs the second. The columns support it; the key needs to mean
something different.

Elsewhere freshness is ad hoc but present: `property_trust_scores.data_stale`,
`developer_profiles.last_checked_at`, `source_registry.last_collected_at`.
Three different conventions, none shared.

## CURRENT VALUE

Nothing holds it. `result_json` is the current value **for one job**. Two
verifications of the same flat a month apart produce two complete reports and
no statement anywhere about which is now true, or what changed between them.

## What this pass adds, and what it deliberately does not

**Extends, does not replace:**

- `cost_events` — already the right table for COGS; Verify now writes to it.
- `provider_price_book` — added this pass rather than pricing in source.
- `research_cache` — repurposed as the source-record store it was built to be,
  rather than a new table beside it.
- `canonical_property_groups` / `property_facts` — remain the listing-dedupe
  layer the market cache builds on.
- `developer_profiles` / `developer_projects` — remain the developer and
  project entities, linked to rather than duplicated.

**Genuinely missing, therefore added:**

- an entity registry that can identify a property by its cadastral code, and
  distinguish a unit from its parent parcel;
- a fact ledger: one row per (entity, fact key) with its source, evidence,
  validity window, confidence, freshness class and supersession;
- a relationship table, so unit → parcel → building → project → developer is
  recorded with provenance rather than inferred.

**Explicitly excluded from shared intelligence,** and enforced rather than
documented: uploaded contracts, deal-room documents and findings, private
notes, chat messages, user-specific conclusions, and model prose. Only
structured facts with a real source may enter the layer.
