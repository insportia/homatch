/*
 * The private architecture viewer (graphify-viewer/) and the shared Graphify
 * wrapper it builds with. What these pin:
 *   - nothing credential-shaped is ever published (scan fails closed)
 *   - a failed refresh never serves the old graph as current
 *   - history stays bounded
 *   - traces never claim more than the graph states
 *   - the freshness verdict never says CURRENT when it cannot know
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scanText, scanTree, forbiddenSources, graphRelevant, nextStatus, mobilePatch, HISTORY_LIMIT } from '../../graphify-viewer/build.mjs';
import { trace, shortestPath, digest, VIEWS } from '../../scripts/claude/graphify.mjs';

const require = createRequire(import.meta.url);

test('secret scan: credential shapes are caught, ordinary code is not', () => {
  const hits = [
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.abcdefghijklmnopqrstu',
    '-----BEGIN RSA PRIVATE KEY-----', 'AKIAABCDEFGHIJKLMNOP', 'sk_live_abcdefghijklmnop1234',
    'sk-ant-abcdefghijklmnopqrstuvwxyz123', 'sbp_0123456789abcdef0123456789abcdef', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    'https://r2.example/x.glb?X-Amz-Signature=abc', 'RUNPOD_API_KEY = "rpa_ABCDEFGHIJKLMNOPQRSTUV"', 'hf_abcdefghijklmnopqrstuvwxyzABCDEF',
    `EAA${'B'.repeat(70)}`,
  ];
  for (const h of hits) assert.ok(scanText(`const x = ${JSON.stringify(h)};`).length, h.slice(0, 20));
  for (const ok of ['const key = process.env.RUNPOD_API_KEY;', "Deno.env.get('META_APP_SECRET')", 'function sk_helper() {}', 'presign()', 'tokenize(text)'])
    assert.deepEqual(scanText(ok), [], ok);
  const dir = mkdtempSync(join(tmpdir(), 'scan-'));
  writeFileSync(join(dir, 'a.json'), '{"label":"handleReconstruct()"}');
  assert.deepEqual(scanTree(dir), []);
  writeFileSync(join(dir, 'b.html'), '<script>var t="sbp_0123456789abcdef0123456789abcdef"</script>');
  assert.deepEqual(scanTree(dir).map((f) => [f.file, f.pattern]), [['b.html', 'supabase-token']]);
});

test('excluded source paths in the graph are detected', () => {
  const g = { nodes: [{ source_file: 'src/a.ts' }, { source_file: '.env.local' }, { source_file: 'supabase/.temp/x.ts' }, { source_file: 'keys/server.pem' }] };
  assert.deepEqual(forbiddenSources(g).sort(), ['.env.local', 'keys/server.pem', 'supabase/.temp/x.ts']);
});

test('docs-only commits reuse the graph; anything else or unknown rebuilds', () => {
  assert.equal(graphRelevant(['docs/claude/GRAPHIFY.md', 'README.md', 'public/a.png']), false);
  assert.equal(graphRelevant(['docs/x.md', 'src/App.tsx']), true);
  assert.equal(graphRelevant(['.claude/skills/graphify/SKILL.md']), false, 'the graph is code-only');
  assert.equal(graphRelevant(['.github/workflows/deploy.yml', 'scripts/release/plan.mjs']), true);
  assert.equal(graphRelevant(null), null);
});

const rev = (sha) => ({ sha, branch: 'main' });
test('status: built → CURRENT; failure keeps the last valid graph and says UPDATE_FAILED', () => {
  const built = nextStatus({ prev: null, revision: rev('a'.repeat(40)), outcome: { kind: 'built' }, now: 't1', graphInfo: { nodes: 1 } });
  assert.equal(built.state, 'CURRENT');
  assert.equal(built.graph.sha, 'a'.repeat(40));
  const failed = nextStatus({ prev: built, revision: rev('b'.repeat(40)), outcome: { kind: 'failed', reason: 'boom' }, now: 't2' });
  assert.equal(failed.state, 'UPDATE_FAILED');
  assert.equal(failed.graph.sha, 'a'.repeat(40), 'last valid graph stays');
  assert.equal(failed.revision.sha, 'a'.repeat(40), 'the revision shown is the graph\'s, not the failed one');
  assert.deepEqual([failed.failure.attemptedSha, failed.failure.lastGoodSha, failed.failure.reason], ['b'.repeat(40), 'a'.repeat(40), 'boom']);
  const none = nextStatus({ prev: null, revision: rev('c'.repeat(40)), outcome: { kind: 'failed', reason: 'x' }, now: 't3' });
  assert.equal(none.state, 'NO_GRAPH');
  const reused = nextStatus({ prev: built, revision: rev('d'.repeat(40)), outcome: { kind: 'reused' }, now: 't4' });
  assert.equal(reused.state, 'CURRENT');
  assert.equal(reused.revision.sha, 'd'.repeat(40));
  assert.equal(reused.graph.sha, 'a'.repeat(40));
  let s = built;
  for (let i = 0; i < HISTORY_LIMIT + 7; i += 1) s = nextStatus({ prev: s, revision: rev(String(i).padStart(40, '0')), outcome: { kind: 'built' }, now: `t${i}` });
  assert.equal(s.history.length, HISTORY_LIMIT);
});

test('mobile patch adds a viewport once', () => {
  const html = '<html><head><title>x</title></head><body></body></html>';
  const once = mobilePatch(html);
  assert.match(once, /name="viewport"/);
  assert.equal(mobilePatch(once), once);
});

/* a → b (call), c → b (call), d isolated, t is a test that touches all */
const G = {
  nodes: ['a()', 'b()', 'c()', 'd()', 't()'].map((l, i) => ({ id: l, label: l, source_file: i === 4 ? 'src/__tests__/x.test.ts' : `src/${l[0]}.ts` })),
  links: [
    { source: 'a()', target: 'b()', relation: 'calls', confidence: 'EXTRACTED' },
    { source: 'c()', target: 'b()', relation: 'calls', confidence: 'INFERRED' },
    { source: 't()', target: 'a()', relation: 'calls', confidence: 'EXTRACTED' },
    { source: 't()', target: 'd()', relation: 'calls', confidence: 'EXTRACTED' },
  ],
};
test('traces state only what the graph states', () => {
  const kinds = (stages) => trace(G, stages).links.map((l) => [l.kind, l.confidence]);
  assert.deepEqual(kinds([['A', /^a\(\)$/], ['B', /^b\(\)$/]]), [['FLOW', 'ALL_EXTRACTED']]);
  assert.deepEqual(kinds([['B', /^b\(\)$/], ['A', /^a\(\)$/]]), [['DEPENDS', 'ALL_EXTRACTED']]);
  assert.deepEqual(kinds([['A', /^a\(\)$/], ['C', /^c\(\)$/]]), [['COUPLING', 'INCLUDES_INFERRED']]);
  assert.deepEqual(kinds([['A', /^a\(\)$/], ['D', /^d\(\)$/]]), [['NO_STATIC_PATH', null]], 'never through a test file');
  const absent = trace(G, [['A', /^a\(\)$/], ['Runpod', /runpod/i], ['B', /^b\(\)$/]]);
  assert.equal(absent.stages[1].node, null);
  assert.equal(absent.links.length, 1);
  assert.equal(shortestPath(G, 'a()', 'd()'), null);
});

test('digest is content-only and order-independent', () => {
  const shuffled = { ...G, nodes: [...G.nodes].reverse().map((n) => ({ ...n, community: 9 })), links: [...G.links].reverse() };
  assert.equal(digest(G), digest(shuffled));
  assert.notEqual(digest(G), digest({ ...G, links: G.links.slice(1) }));
});

test('every preset the viewer offers exists in the wrapper', () => {
  for (const id of ['design-studio', 'meta-ads', 'discovery-campaigns', 'supabase-database', 'infrastructure', 'runpod-blender']) assert.ok(VIEWS[id], id);
});

async function freshness(status, body) {
  const dir = mkdtempSync(join(tmpdir(), 'fresh-'));
  cpSync(new URL('../../graphify-viewer/freshness.cjs', import.meta.url), join(dir, 'index.js'));
  writeFileSync(join(dir, 'package.json'), '{"type":"commonjs"}');
  writeFileSync(join(dir, 'status.json'), JSON.stringify(status));
  const real = globalThis.fetch;
  globalThis.fetch = async () => (body === null ? Promise.reject(new Error('offline')) : { ok: true, text: async () => body });
  try {
    let out = '';
    await require(join(dir, 'index.js'))({}, { setHeader() {}, end(s) { out = s; }, statusCode: 0 });
    return JSON.parse(out);
  } finally { globalThis.fetch = real; }
}
test('freshness: CURRENT only when the live build is this revision or its ancestor', async () => {
  const st = { state: 'CURRENT', revision: { sha: 'aaaaaaaa1111' }, ancestors: ['aaaaaaaa', 'bbbbbbbb'] };
  assert.equal((await freshness(st, "const VERSION = 'homatch-aaaaaaaa';")).verdict, 'CURRENT');
  assert.equal((await freshness(st, "const VERSION = 'homatch-bbbbbbbb';")).verdict, 'CURRENT');
  assert.equal((await freshness(st, "const VERSION = 'homatch-cccccccc';")).verdict, 'STALE');
  assert.equal((await freshness(st, null)).verdict, 'UNKNOWN');
  assert.equal((await freshness({ ...st, state: 'UPDATE_FAILED' }, "'homatch-aaaaaaaa'")).verdict, 'UPDATE_FAILED');
});

test('a stage may name its file; external modules never couple two stages', () => {
  const g = {
    nodes: [
      { id: 'h1', label: 'handle()', source_file: 'src/other.ts' },
      { id: 'h2', label: 'handle()', source_file: 'infra/w/handler.py' },
      { id: 'x', label: 'x()', source_file: 'infra/w/x.py' },
      { id: 'y', label: 'y()', source_file: 'infra/w/y.py' },
      { id: 'json', label: 'json' },
    ],
    links: [
      { source: 'h1', target: 'x', relation: 'calls', confidence: 'EXTRACTED' },
      { source: 'x', target: 'json', relation: 'imports', confidence: 'EXTRACTED' },
      { source: 'y', target: 'json', relation: 'imports', confidence: 'EXTRACTED' },
    ],
  };
  const t = trace(g, [['Worker', /^handle\(\)$/, /handler\.py$/], ['X', /^x\(\)$/]]);
  assert.equal(t.stages[0].node.at.startsWith('infra/w/handler.py'), true, 'the file decides between two handle()');
  assert.deepEqual(trace(g, [['X', /^x\(\)$/], ['Y', /^y\(\)$/]]).links.map((l) => l.kind), ['NO_STATIC_PATH'], 'shared `json` import is not coupling');
});

/*
 * Deploys after c028ec49 failed with "No Output Directory named 'public'":
 * the viewer project's Vercel Root Directory is graphify-viewer/, Vercel
 * looks for .vercel/output inside it, and the build wrote <repo>/.vercel/output.
 */
test('the Build Output API directory lives in the viewer Root Directory; config has one source of truth', async () => {
  const { OUTPUT_DIR } = await import('../../graphify-viewer/build.mjs');
  const viewerDir = new URL('../../graphify-viewer/', import.meta.url).pathname.replace(/\/$/, '');
  assert.equal(OUTPUT_DIR, `${viewerDir}/.vercel/output`);
  const { readFileSync } = await import('node:fs');
  const v = JSON.parse(readFileSync(new URL('../../graphify-viewer/vercel.json', import.meta.url), 'utf8'));
  assert.equal(v.framework, null);
  assert.equal(v.buildCommand, 'node build.mjs');
  assert.equal(v.outputDirectory, undefined, 'Build Output API: no static outputDirectory alongside it');
  assert.match(v.ignoreCommand, /VERCEL_ENV" = production \] && exit 1/, 'production always rebuilds the graph');
  const app = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
  assert.equal(app.ignoreCommand, "git diff --quiet HEAD^ HEAD -- . ':(exclude)graphify-viewer'", 'viewer-only commits do not rebuild the customer app');
});
