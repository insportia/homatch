# TAS API_FIRST — contract provenance

Every contract this implementation depends on, and where it came from.
"Verified" means live-verified by the owner's local tas-worker workspace
(README.md / TASK.md, uploaded 2026-10-08); "EXERCISED" means the owner's
recovered PowerShell command history (3,551 lines) ran it live — the history
holds commands, not their outputs. That archive contained the
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
| How ALL motion ids are exposed in the detail graph | EXERCISED by owner's history: every `motionId:<n>` anywhere in the detail reply was treated as a motion | any object carrying `motionId`, plus motion ids cited by attachments (graph-wide — equivalent, without the regex's blind spots) |
| Response classification by bytes: `%PDF-` → PDF, `<html`/`<!doctype html` → HTML, ≤ 32 bytes or whitespace → EMPTY | EXERCISED by owner's history (STEP 4 inventory) | `classifyPayload()` |
| `DownloadServlet?downloadCase=2&attachedFileId=<id>` at the domain ROOT | EXERCISED by owner's history: both `/architect/DownloadServlet` and root were probed; the final full-inventory script used ROOT. Outputs were not recorded in the history | `attachmentUrl()`; failures are accounted (`DOWNLOAD_FAILED`), never hidden |
| Attachment name/type from `Content-Disposition` (RFC 5987 `filename*` first); extension wins for PLA (no reliable magic) | EXERCISED by owner's history | `fileNameFromDisposition()`, `classifyPayload()` |
| PDF text status: READ_TEXT ≥ 50 chars, LOW_TEXT 1–49, SCAN_OR_IMAGE_ONLY 0 | Thresholds of owner's acceptance scripts | `classifyPdfText()` |
| Georgian mojibake | Owner's CP437 repair compensated for PowerShell reading a child process's stdout; not applicable in-process. A guarded CP1252/Latin-1 repair is applied only when the signature is present and the result is Georgian | `repairGeorgianMojibake()` |
| PDF parser | Owner used pdfjs-dist (current); this worker uses the existing `pdf-parse` (older bundled pdf.js). Georgian text-layer fidelity on real TAS PDFs is **NOT VERIFIED** — first live run must compare | injectable `parsePdf` |
| 19 docs / 67 PDF + 1 HTML + 65 empty responses / 413 attachments = 326 PDF + 87 non-PDF (pla 34, jpg 30, dwg 16, rar 7) / 22 on 1161121 | Expectations written into the owner's later scripts (history has commands, not outputs); reproduced here only by a STRUCTURAL fixture | `test/fixtures/tas/tasFixture.mjs` |
| 1161121: 21 vs 22 | The history's line-anchored regex `^s\d+\.attachedFileId=` only sees assignment-form records, not inline object literals — the plausible cause of 21 | graph evaluation covers both forms (tested) |

Acceptance (owner's TASK.md §19) has NOT been met from this repository.
API_FIRST therefore ships inactive: `admin_settings.verify_tas_implementation`
defaults to LEGACY, and any FAILED API run falls back to LEGACY in-step.
Admin TEST (`POST /tas/test`) is the first live check after deployment.
