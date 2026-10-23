// safeSnakeGame.test.mjs — a failing Snake closes itself; the Verify workspace never sees the error (prod 12272abd, 2026-10-23).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const code = (p) => readFileSync(fileURLToPath(new URL(`../../../../${p}`, import.meta.url)), 'utf8');

// The retry is plain logic; read it straight from the module's source to avoid loading React here.
const src = code('src/components/games/SafeSnakeGame.tsx');

test('a stale or blipped chunk is fetched once more; any other error is not retried', async () => {
  const { isChunkLoadError } = await import('../../../lib/lazyRoute.ts');
  const loadOnce = async (load) => { try { return await load(); } catch (e) { if (!isChunkLoadError(e)) throw e; return await load(); } };
  let n = 0;
  const flaky = async () => { n++; if (n === 1) throw new TypeError('Failed to fetch dynamically imported module: https://homatch.live/assets/SnakeGame-old.js'); return { default: 'ok' }; };
  assert.deepEqual(await loadOnce(flaky), { default: 'ok' });
  assert.equal(n, 2);
  let m = 0;
  const broken = async () => { m++; throw new Error('boom'); };
  await assert.rejects(loadOnce(broken), /boom/);
  assert.equal(m, 1);
  // The module implements exactly this.
  assert.match(src, /if \(!isChunkLoadError\(error\)\) throw error;\n\s+return await load\(\);/);
});

test('the boundary closes the game and reports; it never reloads the page or rethrows', () => {
  assert.match(src, /static getDerivedStateFromError\(\)/);
  assert.match(src, /componentDidCatch\(error: Error\): void \{\n\s+reportError\(error, \{ boundary: 'snake'/);
  assert.match(src, /this\.props\.onFailed\(\);/);
  assert.doesNotMatch(src, /location\.reload/);
  assert.match(src, /<GameBoundary onFailed=\{onFailed\}>\n\s+<Suspense fallback=\{null\}>/, 'the lazy chunk is inside the boundary');
});

test('Verify opens Snake only through the isolated wrapper', () => {
  const stream = code('src/components/verify/ResearchStream.tsx');
  assert.match(stream, /lazy\(\(\) => import\('@\/components\/games\/SafeSnakeGame'\)\)/);
  assert.doesNotMatch(stream, /import\('@\/components\/games\/SnakeGame'\)/);
  assert.match(stream, /onFailed=\{\(\) => \{ setPlaying\(false\); setGameUnavailable\(true\); \}\}/);
  assert.match(stream, /!stopped && !reportReady && !gameUnavailable && \(/);
});
