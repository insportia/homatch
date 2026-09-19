import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validateContractUpload, validateUpload, ANALYSABLE_MIME, ALLOWED_MIME,
  CONTRACT_ACCEPT, CONTRACT_FORMATS, MAX_BYTES, MAX_MB,
} from '../uploadValidation.ts';

/*
 * UPLOADING A CONTRACT.
 *
 * The flow had three entry points and only one of them worked end to end:
 *
 *   - the Verification Center stored the file and never requested an
 *     analysis, so the contract sat unread, created no job, and never
 *     appeared in Running tasks;
 *   - the finished report's "upload the contract" button uploaded nothing —
 *     it navigated to a tab and left the customer to find a control there;
 *   - every picker offered JPEG, PNG, WEBP and legacy .doc, none of which
 *     the analyser can read, so a photographed contract uploaded cleanly and
 *     then terminated as UNSUPPORTED, which the retry path refuses to re-run.
 *
 * These tests hold all three closed.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(here, rel), 'utf8');
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const pdf = (over = {}) => ({ name: 'contract.pdf', size: 1024, type: 'application/pdf', ...over });
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/* ------------------------------------------------------------------ *
 * We offer exactly what the analyser can read. Not one format more.   *
 * ------------------------------------------------------------------ */

test('the offered formats are exactly the formats the analyser accepts', () => {
  const fn = read('../../../supabase/functions/deal-room-document-analyze/index.ts');
  const m = fn.match(/const ANALYSABLE_MIME = \[([^\]]+)\]/);
  assert.ok(m, 'the analyser must declare ANALYSABLE_MIME');
  // The function writes DOCX through a constant; resolve it the same way.
  const serverList = m[1]
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .map((s) => (s === 'DOCX_MIME' ? DOCX : s))
    .filter(Boolean);
  assert.deepEqual(
    [...ANALYSABLE_MIME].sort(), serverList.sort(),
    'the client picker and the analyser must agree on what can be read'
  );
});

test('the picker never advertises a format that would be rejected later', () => {
  for (const mime of ['image/jpeg', 'image/png', 'image/webp', 'application/msword']) {
    assert.equal(
      CONTRACT_ACCEPT.includes(mime), false,
      `${mime} cannot be analysed and must not be offered`
    );
    // …but the storage layer still accepts it for ordinary case documents.
    assert.equal(ALLOWED_MIME.includes(mime), true, `${mime} must remain storable`);
  }
  // Extensions as well as MIME: Android pickers honour only one of the two.
  assert.match(CONTRACT_ACCEPT, /\.pdf/);
  assert.match(CONTRACT_ACCEPT, /\.docx/);
});

/* ------------------------------------------------------------------ *
 * Validation.                                                         *
 * ------------------------------------------------------------------ */

test('a real PDF and a real DOCX are accepted', () => {
  assert.equal(validateContractUpload(pdf()).ok, true);
  assert.equal(validateContractUpload({ name: 'c.docx', size: 2048, type: DOCX }).ok, true);
});

test('an image is storable but not analysable, and is refused here', () => {
  const jpeg = { name: 'photo.jpg', size: 2048, type: 'image/jpeg' };
  assert.equal(validateUpload(jpeg).ok, true, 'still a valid case document');
  const out = validateContractUpload(jpeg);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'UNSUPPORTED_TYPE');
});

test('an oversized file is refused, and the limit is stated in whole MB', () => {
  const out = validateContractUpload(pdf({ size: MAX_BYTES + 1 }));
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'TOO_LARGE');
  assert.equal(MAX_MB, 20);
  assert.equal(validateContractUpload(pdf({ size: MAX_BYTES })).ok, true, 'exactly at the limit is fine');
});

test('a zero-byte file is refused before anything is uploaded', () => {
  assert.deepEqual(validateContractUpload(pdf({ size: 0 })), { ok: false, reason: 'EMPTY' });
});

test('a renamed executable cannot masquerade as a contract', () => {
  for (const name of ['deed.pdf.exe', '../../etc/passwd.pdf', 'a\\b.pdf', `we${String.fromCharCode(0)}ird.pdf`]) {
    const out = validateContractUpload(pdf({ name }));
    assert.equal(out.ok, false, `${JSON.stringify(name)} must be refused`);
  }
});

test('MIME and extension must agree', () => {
  assert.equal(validateContractUpload({ name: 'contract.docx', size: 10, type: 'application/pdf' }).ok, false);
  assert.equal(validateContractUpload({ name: 'contract.pdf', size: 10, type: DOCX }).ok, false);
});

test('a long non-Latin filename is accepted — it is a name, not a defect', () => {
  const ka = 'ნასყიდობის-ხელშეკრულება-კრწანისის-ქუჩა-N6-ბინა-42-2026-წლის-19-სექტემბერი.pdf';
  const ru = 'договор-купли-продажи-квартиры-в-районе-Крцаниси-номер-42-от-19-сентября.pdf';
  const he = 'חוזה-מכר-דירה-ברחוב-קרצאניסי-מספר-42.pdf';
  for (const name of [ka, ru, he]) {
    assert.equal(validateContractUpload(pdf({ name })).ok, true, `${name} must be accepted`);
  }
});

/* ------------------------------------------------------------------ *
 * The component contract.                                             *
 * ------------------------------------------------------------------ */

test('choosing a file queues the analysis and opens that exact document', () => {
  const src = read('../../components/verify/ContractUpload.tsx');
  const code = stripComments(src);

  // The step that was missing everywhere except the case workspace.
  assert.match(code, /requestAnalysis\(\{\s*id: documentId/, 'the upload must queue the analysis');
  // Straight to the contract's own page. This used to assert the
  // Verification Case's Documents tab; Contracts is a product now and
  // that workspace is no longer part of the customer journey. The
  // requirement is unchanged: the upload opens THAT document, not a list.
  assert.match(code, /navigate\(`\/contracts\/\$\{documentId\}`/,
    'the upload must open the contract it just created');
  // No metadata is asked for.
  assert.equal(/category|docKey|label:/.test(code), false, 'no metadata form may be introduced');
});

test('a double tap cannot start two uploads or create two cases', () => {
  const code = stripComments(read('../../components/verify/ContractUpload.tsx'));
  // A ref, not state: state lags a synchronous second event by a render.
  assert.match(code, /running\s*=\s*useRef\(false\)/);
  assert.match(code, /if \(!picked \|\| running\.current\) return;/);
  assert.match(code, /running\.current = true;/);
  assert.match(code, /running\.current = false;/);
});

test('a failed upload leaves no empty case behind, and never deletes an existing one', () => {
  const code = stripComments(read('../../components/verify/ContractUpload.tsx'));
  assert.match(code, /let createdCaseId: string \| null = null;/);
  assert.match(code, /if \(createdCaseId\) \{/, 'only a case this call created may be removed');
  assert.match(code, /deleteDealRoom\(createdCaseId\)/);
});

test('the file input is a real input with an accessible name, and drag/drop is never required', () => {
  const src = read('../../components/verify/ContractUpload.tsx');
  assert.match(src, /type="file"/);
  assert.match(src, /accept=\{CONTRACT_ACCEPT\}/);
  assert.match(src, /aria-label=\{t\('contract_upload_cta'\)\}/);
  // The primary action is a button element, not a clickable div.
  assert.match(src, /<Button\s+type="button"/);
  assert.equal(/onDrop|onDragOver/.test(src), false, 'drag and drop must not be the way in');
  // No camera capture: there is no OCR path behind it.
  assert.equal(/capture=/.test(src), false, 'camera capture must not be offered without OCR');
  // The failure is announced, not only drawn.
  assert.match(src, /role="alert"/);
  assert.match(src, /aria-live="polite"/);
});

test('the remove control is a real tap target, not a 16px icon', () => {
  const src = read('../../components/verify/ContractUpload.tsx');
  const block = src.slice(src.indexOf('contract_remove_file') - 700, src.indexOf('contract_remove_file') + 200);
  assert.match(block, /h-11 w-11/, 'the remove button must be at least 44px');
  assert.match(block, /aria-label=\{t\('contract_remove_file'\)\}/);
});

/* ------------------------------------------------------------------ *
 * Every entry point goes through the one component.                   *
 * ------------------------------------------------------------------ */

test('the Verification Center no longer carries its own upload logic', () => {
  const src = read('../../components/verify/StartFromDocument.tsx');
  assert.match(src, /ContractUpload/);
  const code = stripComments(src);
  assert.equal(/uploadDocument\(/.test(code), false, 'the duplicate upload path must be gone');
  assert.equal(/createDocumentVerificationCase\(/.test(code), false);
});

test('the finished report opens a picker instead of navigating somewhere else', () => {
  const src = read('../../components/verify/VerifyReport.tsx');
  const code = stripComments(src);
  assert.match(code, /<ContractUpload caseId=\{contractCaseId \?\? null\} variant="inline" \/>/);
  assert.equal(
    /onUploadContract/.test(code), false,
    'the navigate-only callback must not come back'
  );
});

test('a saved case passes its own id, so a contract does not create a second case', () => {
  const src = read('../../../src/pages/VerificationCasePage.tsx');
  assert.match(src, /contractCaseId=\{room\.id\}/);
});

/* ------------------------------------------------------------------ *
 * The billing refusal that produced a six-minute spinner.             *
 * ------------------------------------------------------------------ */

test('a billing refusal writes a legal terminal state, not PENDING', () => {
  const fn = read('../../../supabase/functions/deal-room-document-analyze/index.ts');
  const code = stripComments(fn);

  // PENDING is not in the column's CHECK constraint, so the update failed
  // silently and the row stayed RUNNING until the stale sweeper found it.
  assert.equal(
    /analysis_state: 'PENDING'/.test(code), false,
    'PENDING is not an allowed analysis_state'
  );
  const migration = read('../../../supabase/migrations/20260911100000_document_analysis.sql');
  assert.equal(migration.includes("'PENDING'"), false, 'and it is still not allowed by the constraint');

  // The refusal branch must terminate the row and say why.
  const branch = code.slice(code.indexOf('if (!grant.ok)'), code.indexOf('const REASONING'));
  assert.match(branch, /analysis_state: 'FAILED'/);
  assert.match(branch, /analysis_error: 'BILLING_REQUIRED'/);
  assert.match(branch, /refusalErr/, 'the write must be checked, not fired and forgotten');
});

test('a billing refusal reads as an action, not as a generic failure', () => {
  const worker = read('../../../supabase/functions/jobs-worker/index.ts');
  // The column has to be selected or the comparison is always undefined.
  assert.match(worker, /\.select\('id,deal_room_id,analysis_state,analysis_error'\)/);
  assert.match(worker, /d\.analysis_error === 'BILLING_REQUIRED'/);
  assert.match(worker, /'doc_error_billing'/);

  const card = read('../../components/documents/DocumentCard.tsx');
  assert.match(card, /doc\.analysisError === 'BILLING_REQUIRED'/);
});

/* ------------------------------------------------------------------ *
 * Six languages, no English fallback.                                 *
 * ------------------------------------------------------------------ */

test('every new customer-facing string exists in all six languages', () => {
  const src = read('../../i18n/translations.ts');
  const KEYS = [
    'contract_upload_title', 'contract_upload_hint', 'contract_upload_cta',
    'contract_upload_working', 'contract_remove_file',
    'contract_err_bad_type', 'contract_err_too_large', 'contract_err_bad_name',
    'contract_err_empty', 'contract_err_upload_failed', 'contract_err_retry',
    'doc_error_billing',
    'job_open_workspace', 'job_review_retry', 'job_open_activity',
  ];
  for (const key of KEYS) {
    const hits = [...src.matchAll(new RegExp(`^\\s{2}${key}:`, 'gm'))];
    assert.equal(hits.length, 6, `${key} must exist in all six language blocks, found ${hits.length}`);
  }
});

test('the format and size placeholders are single-braced and substituted, not printed', () => {
  const src = read('../../i18n/translations.ts');
  // The component substitutes {formats} and {max} itself.
  const component = read('../../components/verify/ContractUpload.tsx');
  assert.match(component, /\.replace\('\{formats\}', CONTRACT_FORMATS\)/);
  assert.match(component, /\.replace\('\{max\}', String\(MAX_MB\)\)/);
  // Every translation of those two keys must carry the placeholder, or a
  // language would silently lose the number.
  for (const [key, token] of [['contract_err_bad_type', '{formats}'], ['contract_err_too_large', '{max}']]) {
    const lines = [...src.matchAll(new RegExp(`^\\s{2}${key}: '([^']*)'`, 'gm'))].map((m) => m[1]);
    assert.equal(lines.length, 6);
    for (const line of lines) {
      assert.ok(line.includes(token), `${key} must keep ${token}: ${line}`);
    }
  }
  assert.equal(CONTRACT_FORMATS, 'PDF, DOCX');
});
