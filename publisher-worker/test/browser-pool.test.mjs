import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserPool } from '../src/browser-pool.mjs';
function setup(maxContexts = 2) {
  const contexts = [];
  const browser = {
    isConnected: () => true,
    close: async () => {},
    newContext: async (options) => {
      const context = {
        options,
        closed: false,
        setDefaultTimeout() {},
        setDefaultNavigationTimeout() {},
        async close() {
          this.closed = true;
        },
      };
      contexts.push(context);
      return context;
    },
  };
  return {
    contexts,
    pool: new BrowserPool({ launch: async () => browser, maxContexts }),
  };
}
const identity = { userId: 'u1', portalId: 'myhome', accountId: 'a1' };
test('each operation gets a separate context and browser cleanup', async () => {
  const s = setup();
  await s.pool.run(
    { ...identity, storageState: { cookies: ['a'] } },
    async () => {},
  );
  await s.pool.run(
    { ...identity, userId: 'u2', storageState: { cookies: ['b'] } },
    async () => {},
  );
  assert.equal(s.contexts.length, 2);
  assert.ok(s.contexts.every((c) => c.closed));
  assert.notDeepEqual(
    s.contexts[0].options.storageState,
    s.contexts[1].options.storageState,
  );
  assert.equal(s.pool.active, 0);
  await s.pool.close();
});
test('browser failure closes context and frees capacity', async () => {
  const s = setup();
  await assert.rejects(
    s.pool.run(identity, async () => {
      throw new Error('failure');
    }),
  );
  assert.ok(s.contexts[0].closed);
  assert.equal(s.pool.active, 0);
  await s.pool.close();
});
test('same-account concurrent execution is refused', async () => {
  const s = setup();
  let release;
  const pending = new Promise((r) => {
    release = r;
  });
  const first = s.pool.run(identity, () => pending);
  await assert.rejects(
    s.pool.run(identity, async () => {}),
    /BACKPRESSURE/,
  );
  release();
  await first;
  await s.pool.close();
});
test('browser concurrency applies backpressure before creating another context', async () => {
  const s = setup(1);
  let release;
  const pending = new Promise((r) => {
    release = r;
  });
  const first = s.pool.run(identity, () => pending);
  await assert.rejects(
    s.pool.run({ ...identity, accountId: 'a2' }, async () => {}),
    /BACKPRESSURE/,
  );
  release();
  await first;
  await s.pool.close();
});
test('closed pool cannot launch work', async () => {
  const s = setup();
  await s.pool.close();
  await assert.rejects(
    s.pool.run(identity, async () => {}),
    /BACKPRESSURE/,
  );
});
