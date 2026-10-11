// The official document library and the secure viewer's gate
// (src/verify/officialDocumentLibrary.ts): grouping by what a file proves,
// which files may ever be opened, and the rule that a raw TAS DownloadServlet
// link is never a usable button (owner report 2026-10-11: "Access Denied").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  attachedFileIdOf, fileAccessOf, documentGroupOf, buildDocumentLibrary, ledgerFileFor, libraryItems,
  documentCachePath, DOC_GROUP_ORDER, DOCUMENT_BUCKET,
} from '../officialDocumentLibrary.ts';
import { buildOfficialDocuments } from '../intelligence/officialDocuments.ts';
import { VERIFY_FINAL_DOCS_STRINGS } from '../../../scripts/verify-final-docs-i18n-data.mjs';

const ROOT = process.cwd();
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
const translations = read('src/i18n/translations.ts');
const valuesOf = (key) => [...translations.matchAll(new RegExp(`^  ${key}: '((?:[^'\\\\]|\\\\.)*)',$`, 'gm'))].map((m) => m[1]);

const DL = (id) => `https://docs.tbilisi.gov.ge/DownloadServlet?downloadCase=2&attachedFileId=${id}`;
const f = (id, fileName, format, outcome, kind = 'PDF') => ({ fileName, kind, format, outcome, pages: null, sourceUrl: DL(id), date: null });

/* Shaped like job 8ba97da9's stored officialDocuments (file names as filed). */
const DOCS = [
  { caseRef: 'AR11161121', caseDate: '2026-09-17', documentId: '1161121', priority: 1, publicUrl: 'https://docs.tbilisi.gov.ge/architect/public.html?docId=1161121', files: [
    f('5418975', 'გენგეგმა.pdf', 'pdf', 'READ_TEXT', 'DRAWING'),
    f('5418976', 'გენგეგმა 16,09,2026.dwg', 'dwg', 'UNSUPPORTED_FORMAT', 'DRAWING'),
    f('5418977', 'ფოტოები.pdf', 'pdf', 'SCAN_OR_IMAGE_ONLY'),
    f('5418980', 'ჭრილები.pdf', 'pdf', 'READ_TEXT', 'DRAWING'),
    f('5418990', 'site.jpg', 'jpg', 'NOT_PROCESSED_BUDGET', 'IMAGE'),
    f('5418991', 'lost.pdf', 'pdf', 'DOWNLOAD_FAILED'),
  ] },
  { caseRef: 'AR11115640', caseDate: '2025-11-03', documentId: '1115640', priority: null, publicUrl: null, files: [
    f('5077353', 'დემონტაჟი კრწანისის ქ-ზე.rar', 'rar', 'UNSUPPORTED_FORMAT', 'ARCHIVE'),
    f('5077354', 'Krtsanisi Site+.pla', 'pla', 'UNSUPPORTED_FORMAT', 'OTHER'),
  ] },
  { caseRef: 'AR1942605', caseDate: '2022-12-30', documentId: '942605', priority: null, publicUrl: null, files: [
    f('3944704', 'ქ. თბილისი, კრწანისის ქ.6, (01,18,06,019,055)-გეოლოგია და საექსპერტო შეფასება 2022.10.04.pdf', 'pdf', 'READ_TEXT'),
    f('3944713', 'konstruqciebis eqspertiza konstrukciebi krwanisi 2022.12.30.pdf', 'pdf', 'READ_TEXT'),
    f('3944726', 'photos 2022.12.25.pdf', 'pdf', 'SCAN_OR_IMAGE_ONLY'),
  ] },
  { caseRef: 'AR1990786', caseDate: '2024-01-10', documentId: '990786', priority: null, publicUrl: null, files: [
    f('4249587', 'მინდობილობა - პირი.PDF', 'pdf', 'READ_TEXT'),
    f('4260195', 'ახალი ამონაწერი.pdf', 'pdf', 'READ_TEXT'),
    f('2486634', 'NewArchitectureResponse gapi.pdf', 'pdf', 'READ_TEXT'),
    f('4260197', 'gazi.pdf', 'pdf', 'SCAN_OR_IMAGE_ONLY'),
  ] },
];

test('the attachment id comes from the stored field or a docs.tbilisi.gov.ge DownloadServlet URL only', () => {
  assert.equal(attachedFileIdOf({ sourceUrl: DL('5418975') }), '5418975');
  assert.equal(attachedFileIdOf({ attachedFileId: '42' }), '42');
  assert.equal(attachedFileIdOf({ sourceUrl: 'https://evil.example/DownloadServlet?attachedFileId=1' }), null);
  assert.equal(attachedFileIdOf({ sourceUrl: `${DL('1')}x` }), null);
  assert.equal(attachedFileIdOf({ attachedFileId: '../1' }), null);
});

test('only pdf/jpg/png with an id are viewable; CAD and archives are technical; personal papers are private', () => {
  assert.equal(fileAccessOf(f('1', 'a.pdf', 'pdf', 'READ_TEXT')), 'VIEWABLE');
  assert.equal(fileAccessOf(f('1', 'a.JPG', null, 'IMAGE')), 'VIEWABLE');
  for (const fmt of ['dwg', 'pla', 'rar', 'zip', 'dxf']) assert.equal(fileAccessOf(f('1', `a.${fmt}`, fmt, 'UNSUPPORTED_FORMAT')), 'TECHNICAL', fmt);
  assert.equal(fileAccessOf(f('1', 'მინდობილობა.PDF', 'pdf', 'READ_TEXT')), 'PRIVATE');
  assert.equal(fileAccessOf({ fileName: 'a.pdf', format: 'pdf' }), 'NO_ID');
});

test('files are grouped by what they prove, in reading order', () => {
  assert.equal(documentGroupOf({ fileName: 'ახალი ამონაწერი.pdf' }), 'PERMITS');
  assert.equal(documentGroupOf({ fileName: 'NewArchitectureResponse gapi.pdf' }), 'PERMITS');
  assert.equal(documentGroupOf({ fileName: 'მშენებლობის ნებართვა.pdf' }), 'PERMITS');
  assert.equal(documentGroupOf({ fileName: 'გენგეგმა.pdf', kind: 'DRAWING' }), 'DRAWINGS');
  assert.equal(documentGroupOf({ fileName: '02. floor plans.pdf' }), 'DRAWINGS');
  assert.equal(documentGroupOf({ fileName: 'konstruqciebis eqspertiza.pdf' }), 'EXPERT', 'an expert review is not a drawing');
  assert.equal(documentGroupOf({ fileName: 'გეოლოგია და საექსპერტო შეფასება.pdf' }), 'EXPERT');
  assert.equal(documentGroupOf({ fileName: 'photos 2022.12.25.pdf' }), 'PHOTOS');
  assert.equal(documentGroupOf({ fileName: 'IMG_2201.jpg', kind: 'IMAGE' }), 'PHOTOS');
  assert.equal(documentGroupOf({ fileName: 'gazi.pdf' }), 'OTHER');
  assert.deepEqual(DOC_GROUP_ORDER, ['PERMITS', 'DRAWINGS', 'EXPERT', 'PHOTOS', 'OTHER']);

  const lib = buildDocumentLibrary(DOCS);
  assert.deepEqual(lib.groups.map((g) => g.key), ['PERMITS', 'DRAWINGS', 'EXPERT', 'PHOTOS', 'OTHER']);
  // The priority case's drawings come first in their group.
  assert.equal(lib.groups[1].top[0].caseRef, 'AR11161121');
  // The main view never offers a technical, private or failed file.
  for (const g of lib.groups) for (const i of g.top) {
    assert.equal(i.access, 'VIEWABLE', i.fileName);
    assert.equal(i.failed, false, i.fileName);
  }
  const main = lib.groups.flatMap((g) => g.top.map((i) => i.fileName));
  assert.ok(!main.includes('lost.pdf'), 'a DOWNLOAD_FAILED file reached the main view');
  assert.ok(!main.some((n) => /მინდობილობა/.test(n)), 'a power of attorney reached the main view');
  // The full library keeps every file for audit, flagged.
  assert.equal(lib.counts.total, 15);
  assert.equal(lib.counts.technical, 3);
  assert.equal(lib.counts.private, 1);
  assert.equal(lib.counts.failed, 1);
  assert.ok(lib.all.find((i) => i.fileName === 'lost.pdf').failed);
});

test('the server gate: in this report, viewable, not private', () => {
  assert.deepEqual(ledgerFileFor(DOCS, '5418975').ok, true);
  assert.equal(ledgerFileFor(DOCS, '5418975').format, 'pdf');
  assert.equal(ledgerFileFor(DOCS, '5418990').format, 'jpg');
  assert.deepEqual(ledgerFileFor(DOCS, '9999999'), { ok: false, reason: 'not_in_report' });
  assert.deepEqual(ledgerFileFor(DOCS, '5418976'), { ok: false, reason: 'not_viewable' });
  assert.deepEqual(ledgerFileFor(DOCS, '4249587'), { ok: false, reason: 'private_document' });
  assert.deepEqual(ledgerFileFor(DOCS, 'x; drop'), { ok: false, reason: 'bad_id' });
  assert.deepEqual(ledgerFileFor(null, '1'), { ok: false, reason: 'not_in_report' });
  assert.equal(documentCachePath('5418975', 'pdf'), 'files/5418975.pdf');
  assert.equal(DOCUMENT_BUCKET, 'verify-documents');
});

test('new reports store the attachment id; stored ones fall back to the URL', () => {
  const docs = buildOfficialDocuments([{ caseRef: 'C1', documentId: '1', date: '2026-01-01', title: null, docType: null, status: null, priority: 1, publicUrl: null,
    attachments: [{ fileName: 'a.pdf', format: 'pdf', outcome: 'READ_TEXT', pages: 2, attachedFileId: '777', date: null }] }]);
  assert.equal(docs[0].files[0].attachedFileId, '777');
  assert.equal(libraryItems(docs)[0].attachedFileId, '777');
});

test('no raw DownloadServlet link is ever a usable button', () => {
  const docsUi = code('src/components/verify/OfficialDocuments.tsx');
  assert.ok(!/sourceUrl/.test(docsUi), 'the document explorer reads a raw file URL');
  assert.ok(!/<a[\s>]/.test(docsUi), 'the document explorer renders a raw anchor');
  assert.match(docsUi, /SecureFileButton/);
  assert.match(docsUi, /verify_fdocs_technical/);
  assert.match(docsUi, /libraryOpen \? \(/, 'the full library is mounted before it is opened');
  assert.match(docsUi, /OfficialImagesViewer/);
  const link = code('src/components/verify/OfficialLink.tsx');
  assert.match(link, /isTasFileUrl\(safe\)/);
  assert.match(link, /jobId && id \? <SecureFileButton/, 'a TAS file link outside a report must render nothing');
  const agent = code('supabase/functions/research-agent/index.ts');
  assert.match(agent, /b\?\.action === 'document_file'/);
  assert.match(agent, /ledgerFileFor\(/, 'document_file serves a file without checking the job ledger');
  assert.match(agent, /\.eq\('user_id', user\.id\)/);
  assert.match(agent, /is_admin/);
  assert.match(code('supabase/functions/verify-synthesis/index.ts'), /\{ \.\.\.stripped, jobId \}/, 'the report no longer carries its job id for the viewer');
  assert.match(code('official-worker/src/index.ts'), /mountTasFileRoutes\(app, \{ token: TOKEN \}\)/);
  assert.match(read('supabase/migrations/20261030091500_verify_documents_bucket.sql'), /'verify-documents', 'verify-documents', false/);
});

test('every document string exists in six locales with its placeholders', () => {
  for (const [key, vals] of Object.entries(VERIFY_FINAL_DOCS_STRINGS)) {
    assert.equal(vals.length, 6, key);
    assert.equal(valuesOf(key).length, 6, `${key} is not in translations.ts in six locales`);
    const ph = (s) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join();
    for (const v of vals) {
      assert.equal(ph(v), ph(vals[0]), `${key}: placeholder drift`);
      assert.ok(!v.includes('—'), `${key}: em dash`);
    }
  }
});
