# Service 176 release and intelligence mapping

Branch: feat/service176-integration. Base reviewed: 889d2736e6e104baaa5609790328e9087cc2224e (local and remote main). This document supersedes historical local checkpoint reports.

## Architecture

VerifyPage/researchJobs → research-agent → existing official-worker /research → ResearchContext cadastral plan (TAS_MAP, tas, additional mygov) → ResearchOrchestrator.runStep → MyGovApiWorkflow → source API core → existing legacy document aliases → research-agent worker result/evidence persistence and OFFICIAL_COLLECTION/SYNTHESIS → result_json → verify-synthesis buildEvidencePackage/buildIntelligenceBundle/grounded prompt/finalizeReport → verifyResult/resultNormalizer → VerifyReport summary, existing sections and evidence drawer.

The existing property plan, entity providers, scoring/confidence algorithms and UI hierarchy are unchanged. Legacy MyGovWorkflow remains for previously paused sessions. New My.gov steps are bounded (45 seconds; per-request default 8 seconds; no retries), run before allocating a browser context and always return keep:false. Protected or failed acquisition is provider-local. No successful evidence is fabricated for unavailable records. User-managed CAPTCHA implementation/configuration is outside this release; no solver dependency, credentials or standalone runtime configuration is shipped or changed.

## Reused source contracts

Six hash-tracked standalone modules implement anonymous cadastral POST /api/search, appID selection/status, permitted record acquisition, exact record/document identity, source references and strict PDF validation. No portal HTML/DOM scrape is required at runtime. Compiler-only URL/import adaptations are recorded in reference-manifest.json. All six reference hashes remain unchanged. HOMATCH already supplies pdf-parse, fetch and crypto; no dependency or migration was added.

PDF acceptance requires successful HTTP, application/pdf MIME, nonempty payload, %PDF-, exact final/source URL association and SHA-256. Text and page completeness must also pass before a document enters readable evidence. All source references remain in traversal/documentLinks; HTML/status/navigation references are not incorrectly validated as PDFs. Acceptance cadastral/appID/registration values occur only in fixtures and evidence documentation.

## Service 176 → Verify Intelligence Mapping

- Raw: search identities/status labels, record APP_ID/REG_NUMBER/CADCODE/ADDRESS/FULL_TRANSACT/dates and other source fields, all document references and source PDF text. Raw public records remain internal; applicants are not interpreted as owners.
- Accepted: cadastral identity, property address, application registration/type and source application status only after exact search → record identity and an associated validated/read PDF pass. Direct document text is supplied separately to existing legal/ownership analysis; no ownership or restriction conclusion is synthesized by this adapter.
- Model: service176Evidence contains source-record facts with appID, requested cadastral identity, registration, exact record/document URLs, sourceReference and hash provenance. buildEvidencePackage converts these to existing tier-1 PROPERTY/DOCUMENT items with OFFICIAL_REGISTRY/CONFIRMED certainty and sourceIdentity metadata. These are primary record metadata; the PDF link proves association, not that every metadata field appears in the PDF text.
- Sections: existing SNAPSHOT, key findings, relevant summary highlights, and evidence/source drawer. Existing legal/rights interpretation owns document-derived conclusions. No new card or repeated legal section is introduced.
- Summary: research-agent adds a separate validated facts/document-text block after the raw payload budget, preventing large raw search/traversal JSON from crowding out the new source. Buyer synthesis reads structured facts through the existing evidence package, preserving citations/grounding and deterministic fallback. Source text is data, never instructions; excerpts are bounded and explicitly marked when truncated.
- Evidence-only: source IDs, raw records, source fields not mapped to a supported concept, hash and acquisition details. They do not appear in summary prose.
- Conflicts: other providers' evidence is neither mutated nor overwritten. Existing conflict instructions receive both source facts. The new projection does not manufacture a material adverse finding or change scoring. My.gov and NAPR remain the same underlying registry, not independent corroboration.
- Unavailable: existing BLOCKED plus captcha:true/traversal.providerState=CAPTCHA_REQUIRED (or FAILED/TIMEOUT) remains non-blocking and unverified. It contributes no adverse property claim. A successfully acquired record can contribute its individually validated documents during a partial provider run; unavailable records contribute none.
- Files: MyGovApiWorkflow.ts, service176Evidence.ts, research-agent/index.ts and evidencePackage.ts; existing orchestration/document/report components handle the remainder.
- Proof: actual adapter-to-evidence-to-final-report test in mygovApiWorkflow.test.mjs; focused service176.test.mjs covers provenance, summary availability, all validated PDF text, conflicting facts, duplicate facts, foreign identity, unavailable neutrality and unchanged other-provider output. Actual ResearchOrchestrator tests prove provider dispatch and continued job completion.

## Local validation / release gates

- Worker suite: 392/392 passed. Relevant Verify/intelligence/provider/matrix suite: 1345/1345 passed before the final additional all-PDF-text regression; focused final mapping suite: 8/8 passed. Summary regressions: 61/61 passed. Edge syntax/reference gate: all 96 functions and 151 shared files passed.
- Three previously live-verified saved PDFs passed local HOMATCH parsing and source hash checks (160714, 199836, 202988 bytes; 2/1/2 pages). This is saved evidence replay, not a new production verification.
- Full initial repository unit run: 7749/7762 passed. The one Service176 scheduling assertion was corrected and its suite passes. Unchanged main snapshot: 7745/7755 passed; ten unrelated/environment failures reproduce there. Two additional migration assertions are sensitive to Windows line endings in unchanged files. No unrelated code was edited to fix them.
- Local full typecheck/build is blocked by missing installed @huggingface/transformers/pdfjs-dist; the same frontend errors reproduce on unchanged main. Worker full typecheck also reports missing installed telegram modules from existing main code. Focused worker compile/test is green. Biome detects the protected .claude/worktrees nested root configuration; those files were not modified. Shell-dependent release-engine tests require sh on PATH. These are not reported as green gates.

## Deployment scope after green required CI

Use the existing PR/merge/release pipeline. Required runtime: existing homatch-official-worker Railway service, research-agent, and verify-synthesis (its import closure includes changed evidencePackage). Shared src changes also trigger the repository's existing frontend deployment classification; no manual unrelated redeploy, new service, migration or secret configuration is needed. The final owed scope must be inspected against deployment refs after merge. No production success is claimed by local tests. Verify worker deployment SHA/health, exact edge artifacts, the existing Verify route and one owner-controlled acquisition before claiming production live verification.

Local Git metadata is read-only in this session (index.lock/FETCH_HEAD denied); remote GitHub operations may publish the reviewed scoped branch without modifying the stash or protected worktrees. No merge or deployment is permitted while required checks fail.
