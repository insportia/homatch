import { createHash } from 'node:crypto';

export function validateProperty(property, limits = null) {
  const issues = [];
  const required = (field, valid) => {
    if (!valid) issues.push({ field, code: 'required' });
  };
  required(
    'title',
    typeof property.title === 'string' && property.title.trim().length > 0,
  );
  required(
    'description',
    typeof property.description === 'string' &&
      property.description.trim().length > 0,
  );
  required('location.country', property.location?.country);
  required('location.city', property.location?.city);
  required(
    'contact.phone',
    /^\+[1-9]\d{6,14}$/.test(property.contact?.phone ?? ''),
  );
  for (const [field, value] of [
    ['area', property.area],
    ['price.amount', property.price?.amount],
  ]) {
    if (!Number.isFinite(value) || value <= 0)
      issues.push({ field, code: 'invalid' });
  }
  for (const field of [
    'rooms',
    'bedrooms',
    'bathrooms',
    'floor',
    'totalFloors',
  ]) {
    if (
      property[field] != null &&
      (!Number.isInteger(property[field]) || property[field] < 0)
    )
      issues.push({ field, code: 'invalid' });
  }
  if (
    property.floor != null &&
    property.totalFloors != null &&
    property.floor > property.totalFloors
  )
    issues.push({ field: 'floor', code: 'invalid' });
  if (!['sale', 'rent', 'daily_rent'].includes(property.transaction))
    issues.push({ field: 'transaction', code: 'unsupported' });
  if (!['apartment', 'house', 'land', 'commercial'].includes(property.type))
    issues.push({ field: 'type', code: 'unsupported' });
  if (!['USD', 'GEL', 'EUR'].includes(property.price?.currency))
    issues.push({ field: 'price.currency', code: 'unsupported' });
  for (const [field, max] of [
    ['latitude', 90],
    ['longitude', 180],
  ]) {
    const value = property.location?.[field];
    if (value != null && (!Number.isFinite(value) || Math.abs(value) > max))
      issues.push({ field: `location.${field}`, code: 'invalid' });
  }
  const photos = property.photos;
  if (!Array.isArray(photos) || photos.length === 0)
    issues.push({ field: 'photos', code: 'required' });
  else {
    if (photos.filter((p) => p.cover).length !== 1)
      issues.push({ field: 'photos.cover', code: 'invalid' });
    const hashes = new Set();
    for (const [i, photo] of photos.entries()) {
      if (
        !/^[a-f0-9]{64}$/.test(photo.sha256 ?? '') ||
        hashes.has(photo.sha256) ||
        !photo.storagePath ||
        photo.storagePath.includes('..') ||
        !Number.isFinite(photo.bytes) ||
        photo.bytes <= 0
      )
        issues.push({ field: `photos.${i}`, code: 'invalid' });
      hashes.add(photo.sha256);
      if (
        limits &&
        (photo.bytes > limits.maxBytes || !limits.mime.includes(photo.mime))
      )
        issues.push({ field: `photos.${i}`, code: 'unsupported' });
    }
    if (limits && photos.length > limits.maxCount)
      issues.push({ field: 'photos', code: 'unsupported' });
    if (!limits) issues.push({ field: 'photos', code: 'unverified_limit' });
  }
  return issues;
}

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((k) => value[k] !== undefined)
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
export function fingerprint(value) {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}
export function changedFields(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (k) => fingerprint(before[k] ?? null) !== fingerprint(after[k] ?? null),
  );
}
export function idempotencyKey({
  userId,
  propertyId,
  portalId,
  operation,
  version,
  confirmationId,
}) {
  if (
    ![userId, propertyId, portalId, operation, confirmationId].every(
      (v) => typeof v === 'string' && v,
    ) ||
    !Number.isInteger(version) ||
    version < 1
  )
    throw new Error('INVALID_IDEMPOTENCY_INPUT');
  return fingerprint([
    userId,
    propertyId,
    portalId,
    operation,
    version,
    confirmationId,
  ]);
}

/** Explicit exact selection. Unknown, newly introduced, disabled and unconnected portals cannot be added implicitly. */
export function planSelection({
  userId,
  property,
  selected,
  confirmed,
  accounts,
  portals,
  operation,
}) {
  if (property.ownerId !== userId) throw new Error('PROPERTY_NOT_OWNED');
  if (
    !Array.isArray(selected) ||
    !Array.isArray(confirmed) ||
    !selected.length ||
    new Set(selected).size !== selected.length ||
    new Set(confirmed).size !== confirmed.length ||
    [...selected].sort().join('\0') !== [...confirmed].sort().join('\0')
  )
    throw new Error('SELECTION_NOT_CONFIRMED');
  return selected.map((portalId) => {
    const portal = portals.find((p) => p.id === portalId);
    const account = accounts.find(
      (a) =>
        a.portalId === portalId &&
        a.userId === userId &&
        a.status === 'connected',
    );
    if (
      !portal ||
      !portal.enabled ||
      portal.maintenance ||
      portal.permission !== 'verified' ||
      !portal.operations[operation]
    )
      throw new Error('PORTAL_NOT_ELIGIBLE');
    if (!account) throw new Error('ACCOUNT_NOT_CONNECTED');
    return {
      portalId,
      accountId: account.id,
      propertyId: property.id,
      version: property.version,
      operation,
    };
  });
}

/** Never retry a possibly accepted mutation. Reconcile first, including after a worker crash. */
export function recoveryDecision({
  operation,
  submissionStarted,
  reconcileResult,
  attempts,
  maxAttempts,
}) {
  if (submissionStarted && operation !== 'status') {
    if (reconcileResult === 'found') return 'complete_from_reconciliation';
    if (reconcileResult !== 'absent_verified') return 'action_required';
  }
  return attempts >= maxAttempts ? 'dead_letter' : 'retry';
}
export function retryAt(attempt, now, random = Math.random) {
  return (
    now +
    Math.min(
      900_000,
      5_000 *
        2 ** Math.min(10, Math.max(0, attempt - 1)) *
        (0.8 + random() * 0.4),
    )
  );
}
