import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeConfig } from '../src/runtime.mjs';
test('runtime starts conservatively with two browser slots and bounded polling', () => {
  const config = runtimeConfig({});
  assert.equal(config.concurrency, 2);
  assert.equal(config.pollMs, 3000);
  assert.equal(config.maxRssMb, 1536);
});
test('invalid runtime budgets fail closed', () => {
  for (const env of [
    { PUBLISHER_CONCURRENCY: 100 },
    { PUBLISHER_CONCURRENCY: 0 },
    { PUBLISHER_MAX_RSS_MB: 64 },
    { PORT: 'invalid' },
    { PUBLISHER_POLL_MS: 0 },
  ])
    assert.throws(() => runtimeConfig(env), /INVALID_PUBLISHER_CONFIGURATION/);
});
