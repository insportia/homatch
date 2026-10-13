import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionVault, ChallengeBroker } from '../src/security.mjs';
const identity = {
  userId: 'u1',
  portalId: 'myhome',
  accountId: 'a1',
  attemptId: 't1',
};
const vault = new SessionVault(
  { v1: Buffer.alloc(32, 7), old: Buffer.alloc(32, 8) },
  'v1',
);
const expiry = new Date(Date.now() + 60_000).toISOString();
test('session ciphertext decrypts only with its original ownership binding', () => {
  const state = { cookies: [{ value: 'secret-cookie' }] };
  const encrypted = vault.encrypt(state, identity, expiry);
  assert.deepEqual(vault.decrypt(encrypted, identity), state);
  assert.ok(!JSON.stringify(encrypted).includes('secret-cookie'));
  for (const field of ['userId', 'portalId', 'accountId'])
    assert.throws(() =>
      vault.decrypt(encrypted, { ...identity, [field]: 'other' }),
    );
});
test('session tampering is rejected', () => {
  const encrypted = vault.encrypt({}, identity, expiry);
  const body = Buffer.from(encrypted.body, 'base64');
  body[0] ^= 1;
  assert.throws(() =>
    vault.decrypt({ ...encrypted, body: body.toString('base64') }, identity),
  );
});
test('expired sessions and missing keys are rejected', () => {
  const encrypted = vault.encrypt({}, identity, expiry);
  assert.throws(
    () => vault.decrypt(encrypted, identity, Date.parse(expiry)),
    /EXPIRED/,
  );
  assert.throws(
    () => vault.decrypt({ ...encrypted, keyId: 'missing' }, identity),
    /UNAVAILABLE/,
  );
  assert.throws(() => vault.encrypt({}, identity, 'invalid'), /EXPIRED/);
});
test('encryption uses unique nonces', () =>
  assert.notEqual(
    vault.encrypt({}, identity, expiry).iv,
    vault.encrypt({}, identity, expiry).iv,
  ));
test('invalid key configuration fails closed', () =>
  assert.throws(() => new SessionVault({ a: Buffer.alloc(12) }, 'a')));
test('challenge is bound to user, portal, account and attempt', async () => {
  const broker = new ChallengeBroker();
  const challenge = broker.create(identity);
  for (const field of Object.keys(identity))
    assert.throws(
      () =>
        broker.submit(
          challenge.id,
          { ...identity, [field]: 'other' },
          '123456',
        ),
      /UNAVAILABLE/,
    );
  broker.submit(challenge.id, identity, '123456');
  assert.equal(await challenge.value, '123456');
  assert.throws(
    () => broker.submit(challenge.id, identity, '123456'),
    /UNAVAILABLE/,
  );
  broker.close();
});
test('abandoned challenges expire without retaining OTP', async () => {
  let now = 0;
  const broker = new ChallengeBroker({ now: () => now, ttlMs: 100 });
  const challenge = broker.create(identity);
  now = 100;
  assert.throws(
    () => broker.submit(challenge.id, identity, '123456'),
    /UNAVAILABLE/,
  );
  assert.equal(await challenge.value, null);
  broker.close();
});
test('invalid submissions have bounded attempts', async () => {
  const broker = new ChallengeBroker({ maxAttempts: 2 });
  const challenge = broker.create(identity);
  assert.throws(() => broker.submit(challenge.id, identity, 'nope'), /INVALID/);
  assert.throws(() => broker.submit(challenge.id, identity, 'nope'), /INVALID/);
  assert.throws(
    () => broker.submit(challenge.id, identity, '123456'),
    /UNAVAILABLE/,
  );
  assert.equal(await challenge.value, null);
  broker.close();
});
test('challenge capacity and shutdown are bounded', async () => {
  const broker = new ChallengeBroker({ maxPending: 1 });
  const challenge = broker.create(identity);
  assert.throws(() => broker.create(identity), /CAPACITY/);
  broker.close();
  assert.equal(await challenge.value, null);
});
