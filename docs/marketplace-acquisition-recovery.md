# Controlled Marketplace Search recovery

## Confirmed production evidence (2026-10-08)

Search `4cdcad01-524f-479c-b717-ed633856b490`: marketplace-search v9 accepted start with HTTP 202 at 19:28:06 UTC; MyHome claimed its run, obtained count 44, then failed the first list request before parsing any rows. Stored status is FAILED / ALL_WORKERS_FAILED. The worker's long URL precedes the error reason, and ingestion caps messages at 300 characters, erasing the reason. This patch preserves the reason first. It does not claim to repair the unknown source failure.

The active Railway worker deployment is `28c2dd75-50b3-43e7-8448-189f6c9a849e`, commit `6a0850e28c17cc72f6b3625a1fdac02beb6dc972`. Current main already includes SS.ge runtime, registration migration and scoped switches. Production read-only inspection found only myhome-agent registered; no ssge-agent runs and no marketplace_ssge_enabled setting. SS.ge was not dispatched, rather than failing acquisition.

Direct HTTP and Chromium public requests from this development environment are denied by the network sandbox. Neither saved production errors nor logs establish a CAPTCHA, website change, validation rejection or network fault. No paid CAPTCHA solve is appropriate without evidence and approval.

## Release approvals and sequence

1. Review/merge the diagnostic patch, then approve deploying only the existing official worker service. Do not deploy unrelated products or alter marketplace switches. The patch changes error ordering, not acquisition behavior.
2. Approve one controlled unpaid MyHome search using the failing criteria: BUY/APARTMENT, Tbilisi/Vake, USD 120000–160000, area 80–110, rooms 3+, bedrooms 2+, NEW_BUILD/UNDER_CONSTRUCTION. Keep the existing bounded upgrade collection, deadlines and request pacing. Capture the first complete SOURCE_REQUEST_FAILED message from worker report ingestion. This search may fail; it is diagnostic, not acceptance.
3. Classify the preserved evidence before changing acquisition: HTTP validation errors require comparing the actual parameter dictionary/UI contract; malformed JSON requires inspecting response content; network errors require network diagnosis. Access-control/CAPTCHA responses stop acquisition. Do not bypass access controls or invoke paid recovery without separate approval. Implement and test a cause-specific correction only after this evidence exists.
4. Separately approve applying the already-reviewed additive migration `20261020090000_ssge_marketplace_worker.sql`. It inserts ssge-agent as PROVEN/disabled and marketplace_ssge_enabled=false, preserving existing settings on replay. No new migration or duplicate registration architecture is required.
5. Separately approve provisioning independent SSGE_WORKER_TOKEN (at least 32 random characters), storing its SHA-256 in the SS.ge registry row, enabling SSGE_MARKETPLACE_ENABLED on the existing service, and finally activating that row and marketplace_ssge_enabled. Keep other providers' switches unchanged. Never commit tokens or reuse the MyHome token.
6. After the MyHome cause-specific fix is reviewed/deployed and SS.ge is approved/ready, run one controlled combined search. Confirm two independent run IDs, real HTTP acquisition, exact listing identities/price/area/deal/type, canonical source listings and stored owned results. One failed source must produce partial results from the successful source; a genuine successful zero-inventory response must remain distinct from all-source failure. Do not manufacture a production failure to test isolation; fault-injection belongs in tests.
7. Reopen that exact owned search on desktop and mobile, refresh it and navigate through history/property/back. Confirm real counts, attribution, partial/error/empty states and recovery. Do not declare LIVE VERIFIED until these production checks pass.

No paid actor or CAPTCHA job is required by this plan. Any paid operation needs additional explicit approval. No release, configuration change or production search was performed while preparing this patch.
