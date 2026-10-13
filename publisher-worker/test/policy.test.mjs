import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateProperty,
  fingerprint,
  changedFields,
  idempotencyKey,
  planSelection,
  recoveryDecision,
  retryAt,
} from '../src/policy.mjs';
const listing = {
  id: 'p1',
  ownerId: 'u1',
  version: 1,
  title: 'Apartment',
  transaction: 'sale',
  type: 'apartment',
  description: 'Description',
  location: { country: 'GE', city: 'Tbilisi' },
  area: 80,
  price: { amount: 160000, currency: 'USD' },
  contact: { phone: '+995555123456' },
  photos: [
    {
      storagePath: 'u1/photo.jpg',
      sha256: 'a'.repeat(64),
      mime: 'image/jpeg',
      bytes: 100,
      cover: true,
    },
  ],
};
const limits = { maxCount: 10, maxBytes: 1000, mime: ['image/jpeg'] };
test('complete normalized listing validates against known limits', () =>
  assert.deepEqual(validateProperty(listing, limits), []));
test('unverified image limits block readiness', () =>
  assert.ok(
    validateProperty(listing).some((i) => i.code === 'unverified_limit'),
  ));
test('invalid price, floor and coordinates are rejected', () => {
  const issues = validateProperty(
    {
      ...listing,
      price: { amount: NaN, currency: 'USD' },
      floor: 8,
      totalFloors: 2,
      location: { ...listing.location, latitude: 91 },
    },
    limits,
  );
  for (const field of ['price.amount', 'floor', 'location.latitude'])
    assert.ok(issues.some((i) => i.field === field));
});
test('duplicate images, multiple covers, oversized and unsupported images fail validation', () => {
  const photo = { ...listing.photos[0], bytes: 2000, mime: 'text/html' };
  assert.ok(
    validateProperty({ ...listing, photos: [photo, photo] }, limits).length >=
      4,
  );
});
test('canonical hashes ignore object order but preserve photo order', () => {
  assert.equal(fingerprint({ a: 1, b: 2 }), fingerprint({ b: 2, a: 1 }));
  assert.notEqual(fingerprint(['a', 'b']), fingerprint(['b', 'a']));
});
test('price changes detected without changing description', () =>
  assert.deepEqual(
    changedFields(listing, {
      ...listing,
      price: { ...listing.price, amount: 155000 },
    }),
    ['price'],
  ));
const keyInput = {
  userId: 'u1',
  propertyId: 'p1',
  portalId: 'myhome',
  operation: 'publish',
  version: 1,
  confirmationId: 'confirm1',
};
test('replaying confirmation creates the same idempotency key', () =>
  assert.equal(idempotencyKey(keyInput), idempotencyKey({ ...keyInput })));
test('idempotency binds user, property, portal, operation, version and confirmation', () => {
  for (const field of Object.keys(keyInput))
    assert.notEqual(
      idempotencyKey(keyInput),
      idempotencyKey({
        ...keyInput,
        [field]: field === 'version' ? 2 : 'other',
      }),
    );
});
const portals = ['myhome', 'ss', 'new'].map((id) => ({
  id,
  enabled: true,
  permission: 'verified',
  operations: { publish: true },
}));
const accounts = portals.map((p) => ({
  id: `a-${p.id}`,
  portalId: p.id,
  userId: 'u1',
  status: 'connected',
}));
const selection = {
  userId: 'u1',
  property: listing,
  selected: ['myhome'],
  confirmed: ['myhome'],
  portals,
  accounts,
  operation: 'publish',
};
test('only individually selected portals enter plan', () =>
  assert.deepEqual(
    planSelection(selection).map((j) => j.portalId),
    ['myhome'],
  ));
test('new portal is never automatically added to saved selections', () =>
  assert.equal(planSelection(selection).length, 1));
test('mismatched, empty or duplicate confirmation is rejected', () => {
  for (const confirmed of [[], ['ss'], ['myhome', 'myhome']])
    assert.throws(
      () => planSelection({ ...selection, confirmed }),
      /CONFIRMED/,
    );
});
test('property ownership is enforced', () =>
  assert.throws(() => planSelection({ ...selection, userId: 'u2' }), /OWNED/));
test('account from another owner cannot be used', () =>
  assert.throws(
    () =>
      planSelection({
        ...selection,
        accounts: accounts.map((a) => ({ ...a, userId: 'u2' })),
      }),
    /CONNECTED/,
  ));
test('disabled, restricted or unsupported portals fail closed', () => {
  for (const change of [
    { enabled: false },
    { maintenance: true },
    { permission: 'pending' },
    { operations: { publish: false } },
  ])
    assert.throws(
      () =>
        planSelection({
          ...selection,
          portals: portals.map((p) => ({ ...p, ...change })),
        }),
      /ELIGIBLE/,
    );
});
test('ambiguous submission cannot be blindly retried', () => {
  const job = {
    operation: 'publish',
    submissionStarted: true,
    attempts: 1,
    maxAttempts: 3,
  };
  assert.equal(recoveryDecision(job), 'action_required');
  assert.equal(
    recoveryDecision({ ...job, reconcileResult: 'unknown' }),
    'action_required',
  );
  assert.equal(
    recoveryDecision({ ...job, reconcileResult: 'found' }),
    'complete_from_reconciliation',
  );
  assert.equal(
    recoveryDecision({ ...job, reconcileResult: 'absent_verified' }),
    'retry',
  );
});
test('retry budget ends in dead letter', () =>
  assert.equal(
    recoveryDecision({ operation: 'status', attempts: 3, maxAttempts: 3 }),
    'dead_letter',
  ));
test('retry backoff is bounded and grows', () => {
  assert.ok(retryAt(2, 0, () => 0.5) > retryAt(1, 0, () => 0.5));
  assert.ok(retryAt(100, 0, () => 1) <= 1080000);
});
