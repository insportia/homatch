> **HISTORICAL (2026-10-15).** The browser-extension adapters and the iframe workspace described here
> were retired. Publishing now lives at `/publishing` (manual handoff + server-verified public page);
> see `supabase/functions/publishing-engine/domain.ts` and docs/claude/PROJECT_STATE.md.

# SS.ge adapter integration — draft, not deployment-ready

Branch: `feat/ssge-adapter-isolated`. Base: `51d022a07c506143a9a89e47cfe3137ecf2d8660` (PR #205).

This adds SS.ge to the existing Universal Publishing Engine. There is no second app, database, UI or lifecycle. The SS.ge lab remains discovery material. Its sanitized 317-action recording and 81 candidate selectors were used as evidence, not replayed or committed. Generated CSS selectors and consequential recorded clicks are excluded.

## Architecture and shared changes

- `publishing-extension/adapters/contract.js` defines the existing adapter methods and result boundary. `background.js` routes by reviewed registry origins and script paths, checks the interface, and normalizes errors. Portal code retains its DOM selectors, mapping, validation and uploads.
- `publishing-extension/adapters/registry.json` is the registry source. Run `node scripts/publishing/sync-registry.mjs` after changes to generate the browser worker registry and backend copy. A parity test prevents drift. Future portals need an adapter, registry entry and narrow manifest host permission; the router and lifecycle do not need rebuilding.
- The existing UI selects the portal from the connected tab, sends the same canonical listing and job IDs, and invalidates review when tabs change. Portal controls remain translated in six languages.
- The existing API retains authenticated ownership, saved-payload substitution, version/revision checks and job states. Authorization, published domains and publication restrictions come from the registry. SS.ge has an additional unconditional publication block until live verification is completed.
- The additive migration expands the existing job table constraint to portal IDs and adds a generic, service-role-only, ownership/version/target-checked job RPC. It retains the existing row lock and unique `(listing_id,portal_id)` constraint. No table, policy, existing migration or MyHome RPC is replaced. The API uses the new RPC for both portals, so the migration must precede a future approved function release.

MyHome adapter, Chrome bridge, canonical schema, shared lifecycle, React host, original migration and deployment workflows are unchanged. Verify and unrelated features are untouched. The changed router/API/registry/UI files are shared integration surfaces requiring Workstream 1 review.

## Implemented and verified in fixtures

- Existing canonical property input; semantic category/deal selection; city/street option selection; price, currency, descriptions, contact and numeric fields; optional values without supported mappings fail explicitly.
- Selected option IDs are verified using labels. React-compatible value changes dispatch input/change events. Ambiguous or missing controls stop the operation. Submit-type controls and arbitrary optional text cannot become publication, deletion or promotion clicks.
- Photo transfer validates MIME signatures, size and count, supports hidden file inputs, and rejects repeat dispatch within the same document. Dispatch is explicitly **not** upload-completion proof.
- Draft preview is read-only and does not save a portal draft. Form readback checks field values, selected options and native validation. Form accessibility is distinguished from authenticated account identity.
- Existing persistent job identity and portal isolation are reused. Duplicate prevention applies to repeated jobs for the same canonical listing/portal; it does not identify separately-created canonical records for the same physical property. Ambiguous submissions remain reconciliation-only.
- Existing origin/frame/extension identity and owner/version/job-state boundaries remain enforced. Credentials, cookies, storage tokens and OTP values are not extracted. Authentication, SMS and CAPTCHA remain manual on the portal.

## Validation

`node --test tests/publishingEngine/*.test.mjs`: 21 passing tests on the exact PR #205 base, including existing frame/security tests, MyHome Chromium regression tests, SS.ge Chromium fixtures, registry/interface tests and the production publishing entry-point Vite build. JavaScript syntax and `git diff --check` pass.

Terminal GitHub fetch is blocked in this environment. The isolated sparse checkout was materialized through the connected GitHub integration; commit, tree and downloaded blob SHA-1 hashes were verified against GitHub. Only relevant release files were fetched. Consequently the local Vite build covers the publishing entry point, not the entire HOMATCH app. Full app typecheck/build must pass the existing PR CI. No workflows were changed. The new SQL migration has not been executed against Postgres here; no local Postgres/Docker runtime was available and no production SQL was run.

## Authenticated live verification still required

Direct Chromium navigation to `https://home.ss.ge/ka/udzravi-qoneba` fails with `net::ERR_NETWORK_ACCESS_DENIED`. No authenticated live behavior is claimed. Missing items:

1. Creation navigation and dependent stages in the current SS.ge form, including all category/deal combinations and required optional controls.
2. Current location autocomplete scopes, price modes, multilingual editor tabs and selected-state evidence.
3. Authentication/account identity, session expiry, CAPTCHA and phone verification markers.
4. Actual photo completion, ordering, removal, retry and reload reconciliation.
5. Free publication controls, payload-bound review confirmation, exact result ID/URL extraction and timeout reconciliation.
6. Listing status, edit, pause/resume and deletion workflows.

`preparePublish` reports unmet evidence and a preview. SS.ge publication is blocked in the adapter, extension router and backend, even when a caller supplies confirmation. Published-result extraction returns `UNVERIFIED`. Management methods remain unsupported; no paid-operation command is exposed. No real listing was published, edited, deleted or promoted.

Keep this PR draft. It is a locally-tested integration candidate, not a fully live-verified publishing adapter. Do not merge/deploy until Workstream 1 review, full CI, Postgres migration verification, authenticated SS.ge checks, and explicit deployment approval are complete.
