// Customer-list identifiers leave HOMATCH only as normalized SHA-256 hex —
// these vectors pin the exact normalization Meta documents.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeEmail, normalizePhone, sha256Hex, hashIdentifierRows, csvSafeCell,
} from '../hashing.ts';

test('email normalization: trim + lowercase, reject garbage', () => {
  assert.equal(normalizeEmail('  John.Doe@Example.COM '), 'john.doe@example.com');
  assert.equal(normalizeEmail('no-at-sign'), null);
  assert.equal(normalizeEmail('a@b'), null);        // needs a real TLD part
  assert.equal(normalizeEmail('x y@z.ge'), null);   // spaces never survive
});

test('phone normalization: digits, intl form, no plus/00/leading zeros', () => {
  assert.equal(normalizePhone('+995 555 12 34 56'), '995555123456');
  assert.equal(normalizePhone('00995555123456'), '995555123456');
  assert.equal(normalizePhone('0555 123 456'), '555123456');
  assert.equal(normalizePhone('12345'), null);           // too short
  assert.equal(normalizePhone('1'.repeat(16)), null);    // too long
});

test('sha256 hex matches the known vector', async () => {
  // Standard SHA-256("abc") test vector.
  assert.equal(await sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('rows need at least one valid identifier; schema stays fixed', async () => {
  const out = await hashIdentifierRows([
    { email: 'A@B.GE', phone: null },
    { email: 'broken', phone: '+995 599 000 111' },
    { email: 'broken', phone: 'nope' },
  ]);
  assert.deepEqual(out.schema, ['EMAIL_SHA256', 'PHONE_SHA256']);
  assert.equal(out.accepted, 2);
  assert.equal(out.rejected, 1);
  assert.equal(out.rows[0][0], await sha256Hex('a@b.ge'));
  assert.equal(out.rows[0][1], '');
  assert.equal(out.rows[1][1], await sha256Hex('995599000111'));
  // No raw identifier ever appears in the payload.
  for (const row of out.rows) for (const cell of row) assert.ok(!cell.includes('@'));
});

test('csv cells defuse formula injection and escape quotes', () => {
  assert.equal(csvSafeCell('=SUM(A1)'), '"\'=SUM(A1)"');
  assert.equal(csvSafeCell('+995'), '"\'+995"');
  assert.equal(csvSafeCell('-1'), '"\'-1"');
  assert.equal(csvSafeCell('@cmd'), '"\'@cmd"');
  assert.equal(csvSafeCell('says "hi"'), '"says ""hi"""');
  assert.equal(csvSafeCell(null), '""');
  assert.equal(csvSafeCell('plain'), '"plain"');
});
