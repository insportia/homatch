# TAS API_FIRST — contract provenance

Every contract this implementation depends on, and where it came from.
"Verified" means live-verified by the owner's local tas-worker workspace
(README.md / TASK.md, uploaded 2026-10-08). That archive contained the
contract notes and a pdfjs page reader, but **no implementation source, tests,
captured replies or diagnostics** — so nothing below has been re-run live
from this repository (its sandbox cannot reach tas.ge / docs.tbilisi.gov.ge).

| Contract | Status | Encoded in |
|---|---|---|
| Search `DocumentManager.getDocsForPublicInfo`, POST text/plain, stateless (no cookies, empty httpSessionId/scriptSessionId) | VERIFIED (owner) | `TasApiClient.ts`, `dwr.ts` |
| Full search criteria object incl. empty strings, nulls, `ext-gen1020`, `applicationId=2`, 14 status ids, `start`/`limit` inside the object, `array:` lowercase, `windowName=` | VERIFIED (owner) — byte-identical body asserted in `test/tasApi.test.mjs` | `searchParams()` |
| Page size 25 | VERIFIED (browser uses 25) | `TAS_PAGE_SIZE` |
| Reply `dwr.engine.remote.handleCallback("0","0",{isSuccess, source:[…], sources:[total]})` | Shape VERIFIED by owner notes; exact field types NOT verified | `parseSearchPage()` (also accepts older names) |
| Detail `UserMethods.getUserDocumentLastMotion`, `c0-param0=string:<id>`, `page=/architect/public.html?docId=<id>` | VERIFIED (owner) | `TasApiClient.detail()` |
| Detail fields `documentId, documentNo, motionId, responseText, attachedFiles, attachedFileId, fileIdOnStorage, fileName` | OBSERVED (owner) | `normalizeCaseDetail()` — graph-wide, unknown fields preserved in `unmapped` |
| `docAuthor, coApplicants, docValues, docClassCalculatorValues, archDocMeta, archDocType` | FROM MASTER PROMPT, not observed in owner notes | read by name if present |
| `NewArchitectureResponse?documentId&motionId`, stateless, HTML (~692 KB, ~3.5 k chars of text for 639208/4304382) | VERIFIED (owner) for one motion | `responseUrl()`, `htmlToText()` |
| How ALL motion ids are exposed in the detail graph | NOT VERIFIED — owner notes say "determine from public detail data" | any object carrying `motionId` (graph-wide) |
| `DownloadServlet?downloadCase=2&attachedFileId=<id>` | **NOT VERIFIED** — owner notes: "DO NOT assume … until independently verified" | `attachmentUrl()`; failures are accounted (`DOWNLOAD_FAILED`), never hidden |
| 19 docs / 133 motions / 413 attachments / 22 on 1161121 | Master-prompt figures; reproduced only by a STRUCTURAL fixture | `test/fixtures/tas/tasFixture.mjs` |

Acceptance (owner's TASK.md §19) has NOT been met from this repository.
API_FIRST therefore ships inactive: `admin_settings.verify_tas_implementation`
defaults to LEGACY, and any FAILED API run falls back to LEGACY in-step.
Admin TEST (`POST /tas/test`) is the first live check after deployment.
