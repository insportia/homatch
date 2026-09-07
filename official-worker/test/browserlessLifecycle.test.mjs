import { test } from 'node:test';
import assert from 'node:assert/strict';
import { researchContext } from '../.tstest-build/browser/BrowserlessRuntime.js';

test('Browserless researchContext adopts and caches an existing CDP context', async () => {
  const existingContext = { name: 'existing' };
  let newContextCalls = 0;

  const browser = {
    __homatchBrowserless: true,
    contexts: () => [existingContext],
    newContext: async () => {
      newContextCalls++;
      return { name: 'unexpected' };
    },
  };

  const first = await researchContext(browser);
  const second = await researchContext(browser);

  assert.equal(first, existingContext);
  assert.equal(second, existingContext);
  assert.equal(browser.__homatchResearchContext, existingContext);
  assert.equal(newContextCalls, 0);
});

test('Browserless researchContext creates exactly one persistent context when CDP exposes no default context', async () => {
  const createdContext = { name: 'created' };
  let newContextCalls = 0;

  const browser = {
    __homatchBrowserless: true,
    contexts: () => [],
    newContext: async () => {
      newContextCalls++;
      return createdContext;
    },
  };

  const first = await researchContext(browser);
  const second = await researchContext(browser);
  const third = await researchContext(browser);

  assert.equal(first, createdContext);
  assert.equal(second, createdContext);
  assert.equal(third, createdContext);
  assert.equal(browser.__homatchResearchContext, createdContext);
  assert.equal(newContextCalls, 1);
});

test('local researchContext remains isolated and creates a new context per call', async () => {
  let newContextCalls = 0;

  const browser = {
    contexts: () => [],
    newContext: async (options) => {
      newContextCalls++;
      return { id: newContextCalls, options };
    },
  };

  const first = await researchContext(browser);
  const second = await researchContext(browser);

  assert.notEqual(first, second);
  assert.equal(newContextCalls, 2);
  assert.equal(first.options.locale, 'ka-GE');
  assert.equal(first.options.acceptDownloads, true);
  assert.deepEqual(first.options.viewport, { width: 1440, height: 1000 });
});
