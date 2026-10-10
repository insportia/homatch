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
| Decision outcome / number / issue date from response text | Shape VERIFIED for one motion (639208/4304382: decision 4303543, 13/12/2018, intermediate); other templates' wording NOT VERIFIED | `decisions.ts` (`extractDecision`), conservative: no operative wording → UNDETERMINED |
| 1161121: 21 vs 22 | The history's line-anchored regex `^s\d+\.attachedFileId=` only sees assignment-form records, not inline object literals — the plausible cause of 21 | graph evaluation covers both forms (tested) |

## Two newest cases — full fidelity (tas-api-2, 2026-10-10)

Production forensic (job 220ed087, parcel 01.18.06.019.055, 19 cases): every
stored case had `title:null, status:null, values:[]`, `unmappedKeys:['isSuccess']`;
AR11161121 (22 attachments) had 21 attachments `NOT_PROCESSED_BUDGET`. Changes,
and what is and is not verified:

| Contract / behaviour | Status | Encoded in |
|---|---|---|
| Detail reply wraps the case in an envelope carrying `isSuccess` (the only unmapped root key in production) | INFERRED from production `unmappedKeys`; the envelope key holding the case (`source`/`data`/…) is NOT VERIFIED — the normaliser picks the root or the child object carrying the most case fields | `caseRootOf()` in `tasModel.ts` |
| Label/value pairs anywhere in the detail graph (`docValues`, `docClassCalculatorValues`, `archDocMeta`, `docAuthor`, `coApplicants[]`, `archDocType`, any `{name\|label\|title\|key…, value\|text…}`) → `values[{label,value,path}]` | Field names NOT VERIFIED live (still "from master prompt"); extraction is graph-wide so unknown containers are still read | `extractLabelValuePairs()` |
| Sanitized raw detail reply (personal ids masked, phones/e-mails removed) stored as content-addressed JSON evidence | Worker-side only | `TasApiCase.rawDetail`, `tasEvidenceObjects()`, `queue/executor.ts` |
| Priority = two newest cases by the application's own date (`detail.submittedAt ?? searchRow.date`), parcel-matched; tie-break date desc → registration number desc → documentId desc | Deterministic, tested | `priority.ts` `selectPriorityCases()` |
| Date forms: ISO (zone-less = UTC), DD/MM/YYYY, DD.MM.YYYY, DD-MM-YYYY with HH:MM[:SS], YYYY.MM.DD, Georgian month names | Real TAS date formats beyond `new Date(…)` and DD/MM/YYYY are NOT VERIFIED | `parseTasDateMs()` |
| Public form page `/architect/public.html?docId=<id>` → `<script src=…/architect/dwr/interface/*.js>` → DWR method names | **NOT VERIFIED LIVE** (sandbox cannot reach docs.tbilisi.gov.ge). Behind `TAS_FORM_DISCOVERY` (default on); ≤ 3 HTTP requests per priority case, no retries, same-origin scripts only; method names recorded in `tasApi.formDiscovery.methods` | `formDiscovery.ts`, `priority.ts` (`findInterfaceScripts`, `parseDwrInterface`) |
| Form read call: only a method whose NAME reads one document/form/values by id (`get/load/read/find/fetch/view/show…` + `public/form/value/application/document/doc`), exactly one parameter, no write verb, not a list/search/motion method; called once with `string:<documentId>`, plaincall at `/architect/dwr/call/plaincall/<Script>.<method>.dwr`, page `/architect/public.html?docId=<id>` | **NOT VERIFIED LIVE** — no such method is known to exist; a missing method is `form.status: NOT_AVAILABLE`, any error `FAILED` (with reason), never fatal | `pickFormMethod()`, `captureCaseForm()` |
| `DownloadServlet` per-request byte bound for priority attachments (default 150 MB, `TAS_PRIORITY_MAX_BYTES`) | Same endpoint as above (EXERCISED); larger files → `DEFERRED` `PAYLOAD_TOO_LARGE:<bytes>` | `TasApiClient.request(…, {maxBytes})` |
| DWG / PLA / PLN / RAR / ZIP / 7Z / DXF / RVT / IFC / SKP are accounted from metadata (`UNSUPPORTED_FORMAT`, official URL, declared size) and NOT downloaded | Policy (nothing in the worker reads them) | `isUnsupportedExtension()` |
| Per-page PDF text (scanned page = < 50 chars) via pdf-parse `pagerender` | pdf-parse API; fidelity on real TAS PDFs NOT VERIFIED (see PDF parser row) | `defaultPdfParser` |

Deferral / continuation: priority attachments are processed first, in a
deterministic order (priority 1 then 2, by attachedFileId). A file is
`DEFERRED` only when a hard bound is hit (run deadline reserve, byte bound) —
with `deferredReason`, the official URL, `completeness.deferredAttachmentIds`
and `tasApi.priorityCoverage: 'PARTIAL'`. Finished files are cached per
attachedFileId (text, page info, visual records; visual bytes while held in
the in-process cache), so a follow-up run on the same replica re-uses them
and only fetches what was deferred. The cache is in-process: a different
replica re-reads from TAS.

Acceptance (owner's TASK.md §19) has NOT been met from this repository.
API_FIRST therefore ships inactive: `admin_settings.verify_tas_implementation`
defaults to LEGACY, and any FAILED API run falls back to LEGACY in-step.
Admin TEST (`POST /tas/test`) is the first live check after deployment.
