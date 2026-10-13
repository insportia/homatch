import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** AAD prevents moving a ciphertext to another tenant, account or portal. Keys stay in worker secrets. */
export class SessionVault {
  constructor(keys, currentKeyId) {
    if (
      !keys[currentKeyId] ||
      Object.values(keys).some(
        (key) => !Buffer.isBuffer(key) || key.length !== 32,
      )
    ) {
      throw new Error('INVALID_SESSION_KEY_CONFIGURATION');
    }
    this.keys = keys;
    this.currentKeyId = currentKeyId;
  }
  binding({ userId, portalId, accountId }) {
    if (
      ![userId, portalId, accountId].every(
        (v) => typeof v === 'string' && v.length > 0,
      )
    )
      throw new Error('INVALID_SESSION_BINDING');
    return Buffer.from(JSON.stringify([userId, portalId, accountId]));
  }
  encrypt(storageState, identity, expiresAt) {
    if (
      !Number.isFinite(Date.parse(expiresAt)) ||
      Date.parse(expiresAt) <= Date.now()
    )
      throw new Error('SESSION_EXPIRED');
    const iv = randomBytes(12);
    const cipher = createCipheriv(
      'aes-256-gcm',
      this.keys[this.currentKeyId],
      iv,
    );
    cipher.setAAD(this.binding(identity));
    const body = Buffer.concat([
      cipher.update(JSON.stringify({ storageState, expiresAt }), 'utf8'),
      cipher.final(),
    ]);
    return {
      keyId: this.currentKeyId,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      body: body.toString('base64'),
    };
  }
  decrypt(envelope, identity, now = Date.now()) {
    const key = this.keys[envelope.keyId];
    if (!key) throw new Error('SESSION_KEY_UNAVAILABLE');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(envelope.iv, 'base64'),
    );
    decipher.setAAD(this.binding(identity));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const payload = JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(envelope.body, 'base64')),
        decipher.final(),
      ]).toString('utf8'),
    );
    if (
      !Number.isFinite(Date.parse(payload.expiresAt)) ||
      Date.parse(payload.expiresAt) <= now
    )
      throw new Error('SESSION_EXPIRED');
    return payload.storageState;
  }
}

/** Ephemeral delivery only: restarting the worker expires its pending challenges. No OTP persistence/logging. */
export class ChallengeBroker {
  #challenges = new Map();
  constructor({
    now = Date.now,
    ttlMs = 180_000,
    maxAttempts = 3,
    maxPending = 100,
  } = {}) {
    if (
      ttlMs < 1 ||
      ttlMs > 300_000 ||
      maxAttempts < 1 ||
      maxAttempts > 5 ||
      maxPending < 1
    )
      throw new Error('INVALID_CHALLENGE_LIMIT');
    Object.assign(this, { now, ttlMs, maxAttempts, maxPending });
  }
  sweep() {
    for (const [id, item] of this.#challenges)
      if (item.expiresAt <= this.now()) this.cancel(id);
  }
  create(identity) {
    this.sweep();
    if (this.#challenges.size >= this.maxPending)
      throw new Error('CHALLENGE_CAPACITY');
    if (
      !['userId', 'portalId', 'accountId', 'attemptId'].every(
        (k) => typeof identity[k] === 'string' && identity[k],
      )
    )
      throw new Error('INVALID_CHALLENGE_BINDING');
    const id = randomBytes(32).toString('hex');
    const expiresAt = this.now() + this.ttlMs;
    let deliver;
    const value = new Promise((resolve) => {
      deliver = resolve;
    });
    const timer = setTimeout(() => this.cancel(id), this.ttlMs);
    timer.unref?.();
    this.#challenges.set(id, {
      identity: { ...identity },
      expiresAt,
      attempts: 0,
      deliver,
      timer,
    });
    return { id, expiresAt, value };
  }
  submit(id, identity, code) {
    this.sweep();
    const item = this.#challenges.get(id);
    if (
      !item ||
      !['userId', 'portalId', 'accountId', 'attemptId'].every(
        (k) => item.identity[k] === identity[k],
      )
    )
      throw new Error('CHALLENGE_UNAVAILABLE');
    item.attempts += 1;
    if (typeof code !== 'string' || !/^\d{4,8}$/.test(code)) {
      if (item.attempts >= this.maxAttempts) this.cancel(id);
      throw new Error('INVALID_CHALLENGE_CODE');
    }
    clearTimeout(item.timer);
    this.#challenges.delete(id);
    item.deliver(code);
  }
  cancel(id) {
    const item = this.#challenges.get(id);
    if (item) {
      clearTimeout(item.timer);
      item.deliver(null);
      this.#challenges.delete(id);
    }
  }
  close() {
    for (const id of this.#challenges.keys()) this.cancel(id);
  }
}
