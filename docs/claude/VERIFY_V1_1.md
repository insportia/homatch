# Verify V1.1 — hardening and cost audit (2026-10-23)

Builds on V1 (PR #285, merged as `55939805`). All findings below come from
production data, queried read-only.

## Fixes

| Area | Root cause (evidence) | Fix |
|---|---|---|
| Nearby places (Overpass) | Public servers shed load. overpass-api.de answered 502 "at capacity" in 0.5 s; the mirror hung for more than 60 s; the main server, retried after a pause, answered in 35–37 s (885 KB, 233 elements). The old code tried each server once with a 30 s cap and logged nothing, so both V1 jobs stored UNAVAILABLE. | `fetchOverpass`: main server, then main again after a 4 s pause, then the mirror, then main. At most 45 s per attempt and 80 s in total. Each attempt is logged as `verify_neighborhood` / `overpass` with host, outcome, ms and bytes. A failure still stores UNAVAILABLE, and a centre that was already resolved is never lost. Checked live from a workstation: 502, then OK after 40 s (51 places, 6 stops, 24 routes). |
| Report build timing | `verify-synthesis` runs behind a 150 s gateway, and the model call takes 70–100 s. On job 055a9868, two failing Overpass tries (2 × 30 s) plus the model pushed the build past that limit. The caller got 504 twice, the report arrived on the third build, 8 minutes late (`synthesis_attempts` = 3), and the two lost builds probably paid for model calls that were never recorded. | Inside the build, the lookup is now limited to 25 s (`SYNTHESIS_OVERPASS`). If it fails, `completeNeighborhood` runs the full 80 s lookup in the background after the report is saved. It patches only `synthesis_json.location`, using compare-and-set on `synthesis_at`, so it never overwrites a newer build, and it makes no model call. The report text does not mention distances, so the patch cannot contradict it. |
| MyGov CAPTCHA budget | Records were opened newest-first. On 01.14.07.001.044 the 12 paid solves (all ACCEPTED, no failed retries) went partly to refused (statusId 12) and terminated (13) applications, while **all 38 records left gated were completed registrations (10)**. Re-verifying the same parcel paid for the same 12 records again. | `prioritiseNaprRecords`: completed registrations first, newest-first within each status. The budget is unchanged. Refused and terminated applications are still listed from the search. A PARTIAL result stays PARTIAL. |
| SS.ge | Cloudflare 403 on every worker request since at least 2026-10-22 18:32 UTC; this is not Verify's code. | No change to the marketplace workers (that is the myhome.ge workstream's area). A regression test locks in that a blocked SS.ge run is reported as provider `ssge` = FAILED with 0 evidence, never VERIFIED. SS.ge links can still appear among comparables when the market AI finds them by web search; those are public listing pages, not worker results. |

## Cost audit (measured, `verify_job_cogs` + `verify_billing`)

These are completed cadastral jobs with a settled wallet charge, which means
the billed production era from 2026-10-10. Earlier jobs ran the LEGACY
pipeline (no CAPTCHA solving, no billing), so they are not comparable.

| Per report | pre-V1 (n=6) | V1 (n=2) |
|---|---:|---:|
| Synthesis AI (both steps) | $0.1124 | $0.0988 |
| Research AI (identity, official, public, market) | $0.4252 | $0.4719 |
| of which the market stage | $0.1604 | $0.0954 |
| Web search | $0.1050 | $0.1150 |
| APIFY (developer ads) | $0.0129 | $0.0149 |
| 2Captcha | $0.0250 | $0.0240 |
| MyGov solves / RS.ge solves | 5.0 / 3.3 | 7.5 / 0.5 |
| **Total COGS** | **$0.6806** (min $0.549, max $0.953) | **$0.7246** (min $0.675, max $0.774) |
| Customer charge | $1.937 | $1.966 |
| Contribution (margin) | $1.256 (64.9%) | $1.241 (63.1%) |

**Same-property pairs** (the only like-for-like comparison):

| Property | Before | After | Change |
|---|---:|---:|---:|
| 01.14.07.001.044 | $0.953 | $0.774 | −18.7%, all of it in the market stage: no city-wide flats to value |
| 01.18.06.019.055.03.01.601 | $0.692 | $0.675 | −2.4% |

**Conclusion:** V1 was a correctness release, not a cost optimisation. With
two V1 jobs, no average saving can be claimed; the unpaired mean is slightly
higher. MyGov, RS.ge and the registries charge nothing. Their only variable
cost is 2Captcha at $0.003 per solve, about 3% of COGS. AI is about 80% of
COGS, which makes it the V2 lever.

**Not measured:** Railway worker compute and Supabase edge time. Neither is
recorded per job.
