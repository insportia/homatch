// Cryptic outside, honest inside: every Graph error family lands on a real
// i18n key with a truthful recoverability verdict.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMetaError } from '../errors.ts';

test('auth family → reconnect', () => {
  assert.equal(normalizeMetaError({ code: 190 }).customerKey, 'meta_err_reconnect');
  const oauth = normalizeMetaError({ type: 'OAuthException', message: 'expired' });
  assert.equal(oauth.action, 'RECONNECT');
  assert.equal(oauth.recoverable, false);
});

test('permission family → meta action required', () => {
  for (const code of [200, 10, 273]) {
    const n = normalizeMetaError({ code });
    assert.equal(n.customerKey, 'meta_err_permission', `code ${code}`);
    assert.equal(n.recoverable, false);
  }
});

test('rate limits are the only honest retries besides transient', () => {
  for (const code of [4, 17, 32, 613]) {
    assert.equal(normalizeMetaError({ code }).recoverable, true, `code ${code}`);
  }
  assert.equal(normalizeMetaError({ code: 999999, error_subcode: 80004 }).customerKey, 'meta_err_busy');
  for (const code of [1, 2]) {
    assert.equal(normalizeMetaError({ code }).customerKey, 'meta_err_temporary');
  }
});

test('invalid input and account restrictions are not retryable', () => {
  const invalid = normalizeMetaError({ code: 100, message: '(#100) Invalid parameter' });
  assert.equal(invalid.customerKey, 'meta_err_invalid');
  assert.equal(invalid.action, 'FIX_INPUT');
  for (const code of [368, 2446079, 2615]) {
    assert.equal(normalizeMetaError({ code }).customerKey, 'meta_err_account_action');
  }
});

test('the unknown falls through visibly, never silently', () => {
  const n = normalizeMetaError({ code: 31337, message: 'novel failure' });
  assert.equal(n.customerKey, 'meta_err_generic');
  assert.equal(n.action, 'CONTACT_SUPPORT');
  assert.equal(n.rawMessage, 'novel failure'); // admin keeps the truth
});
