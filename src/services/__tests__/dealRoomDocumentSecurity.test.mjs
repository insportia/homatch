import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateUpload, storagePathFor, ALLOWED_MIME, MAX_BYTES, SIGNED_URL_TTL_SECONDS } from '../uploadValidation.ts';

/*
 * Upload validation is a security control, so these tests are about what must
 * be REFUSED. The bucket and RLS enforce the same rules server-side; this
 * layer exists so the customer gets an understandable reason rather than a
 * storage error, and it must not be more permissive than the server.
 */

const file = (over = {}) => ({ name: 'contract.pdf', size: 1024, type: 'application/pdf', ...over });

test('a normal contract is accepted', () => {
  assert.deepEqual(validateUpload(file()), { ok: true });
});

test('an oversized file is refused at exactly the bucket limit', () => {
  assert.deepEqual(validateUpload(file({ size: MAX_BYTES })), { ok: true });
  assert.equal(validateUpload(file({ size: MAX_BYTES + 1 })).reason, 'TOO_LARGE');
});

test('an empty file is refused', () => {
  assert.equal(validateUpload(file({ size: 0 })).reason, 'EMPTY');
});

test('an executable is refused even when it claims to be a PDF', () => {
  assert.equal(validateUpload(file({ name: 'invoice.pdf.exe', type: 'application/pdf' })).reason, 'SUSPICIOUS_NAME');
  assert.equal(validateUpload(file({ name: 'run.sh', type: 'application/pdf' })).reason, 'SUSPICIOUS_NAME');
});

test('a MIME type that disagrees with the extension is refused', () => {
  // A browser reports whatever the file was renamed to; the two disagreeing
  // is a reason to stop, not to store.
  assert.equal(validateUpload(file({ name: 'photo.png', type: 'application/pdf' })).reason, 'UNSUPPORTED_TYPE');
  assert.equal(validateUpload(file({ name: 'doc.pdf', type: 'image/png' })).reason, 'UNSUPPORTED_TYPE');
});

test('path traversal in a filename is refused', () => {
  for (const name of ['../../etc/passwd.pdf', 'a/b.pdf', 'a\\b.pdf', '..\\x.pdf']) {
    assert.equal(validateUpload(file({ name })).reason, 'SUSPICIOUS_NAME', name);
  }
});

test('control characters in a filename are refused', () => {
  assert.equal(validateUpload(file({ name: 'a\u0000b.pdf' })).reason, 'SUSPICIOUS_NAME');
  assert.equal(validateUpload(file({ name: 'a\u001fb.pdf' })).reason, 'SUSPICIOUS_NAME');
});

test('an unsupported type is refused outright', () => {
  assert.equal(validateUpload(file({ name: 'x.zip', type: 'application/zip' })).reason, 'UNSUPPORTED_TYPE');
  assert.equal(validateUpload(file({ name: 'x.svg', type: 'image/svg+xml' })).reason, 'UNSUPPORTED_TYPE');
});

test('every accepted MIME type has a working extension mapping', () => {
  const EXT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx' };
  for (const mime of ALLOWED_MIME) {
    assert.deepEqual(validateUpload(file({ name: `f.${EXT[mime]}`, type: mime })), { ok: true }, mime);
  }
});

/* ---------------------------------------------------------------- *
 * Storage path                                                      *
 * ---------------------------------------------------------------- */

test('the first path segment is the owner user id — the storage policies depend on it', () => {
  const p = storagePathFor('user-1', 'room-9', 'doc-7', 'My Contract.PDF');
  assert.equal(p.split('/')[0], 'user-1');
  assert.equal(p, 'user-1/room-9/doc-7.pdf');
});

test('the stored object name never contains customer-supplied path fragments', () => {
  const p = storagePathFor('u', 'r', 'd', '../../evil/../name.p df');
  assert.ok(!p.includes('..'));
  assert.equal(p.split('/').length, 3, 'exactly user/room/document');
});

test('a file with no extension still produces a safe path', () => {
  assert.equal(storagePathFor('u', 'r', 'd', 'noext'), 'u/r/d.noext');
  assert.equal(storagePathFor('u', 'r', 'd', ''), 'u/r/d.bin');
});

test('signed URLs are short-lived', () => {
  assert.ok(SIGNED_URL_TTL_SECONDS > 0 && SIGNED_URL_TTL_SECONDS <= 300,
    'a leaked link must stop working quickly');
});
