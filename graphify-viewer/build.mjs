#!/usr/bin/env node
/*
 * HOMATCH ARCHITECTURE VIEWER — cloud build (separate Vercel project).
 *
 *   node graphify-viewer/build.mjs  → graphify-viewer/.vercel/output (Build Output API v3)
 *
 * The viewer project's Vercel Root Directory is graphify-viewer/, and Vercel
 * looks for .vercel/output INSIDE the Root Directory. Everything this build
 * writes for Vercel (the output and the build-cache state) therefore lives
 * next to this file; the repository root is only READ (the graph covers the
 * whole repo). Writing to <repo>/.vercel/output made every build end with
 * "No Output Directory named 'public' found" (deploys after c028ec49).
 *
 * Runs in the viewer project's own Vercel build, on every push to main
 * (and to the preview branches the project allows). It is NOT part of the
 * customer HOMATCH build and nothing in HOMATCH imports it.
 *
 *   1. revision     the commit Vercel is building (branch, sha)
 *   2. previous     the last valid graph + status, kept in Vercel's build
 *                   cache (graphify-viewer/.cache/homatch-viewer, declared in
 *                   config.json relative to the Root Directory).
 *                   No credential is involved; an evicted cache only means
 *                   no history carry-over and no failure fallback
 *   3. reuse?       only docs/markdown changed since the live graph's commit
 *                   → keep that graph, re-stamp the revision (no rebuild)
 *   4. build        Graphify through scripts/claude/graphify.mjs — the SAME
 *                   wrapper Claude Code uses: code-only AST, no LLM, no
 *                   credentials in its environment
 *   5. verify       every published file is scanned for credential shapes and
 *                   the graph for excluded source paths; any hit FAILS CLOSED
 *   6. failure      the new graph is not published; the last valid graph is
 *                   re-published, marked UPDATE_FAILED with the attempted
 *                   commit, the last good commit and the reason. With no
 *                   cached graph the build fails instead: Vercel keeps the
 *                   previous deployment live and /api/freshness turns STALE
 *   7. output       viewer shell + graph artifacts + status.json + the
 *                   /api/freshness function (live CURRENT/STALE check)
 *
 * Access control is NOT in this file: the project has Vercel Authentication
 * on every deployment URL and no custom domain (docs/claude/GRAPHIFY.md).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, cpSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, relative, extname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const GRAPHIFY_VERSION = '0.9.73';
export const HISTORY_LIMIT = 20;
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
/* Vercel Root Directory = HERE: the Build Output API dir must be inside it. */
export const OUTPUT_DIR = join(HERE, '.vercel', 'output');
/* Hosts the viewer answers on (regex, Vercel route `has`/`missing` syntax). */
export const ALLOWED_HOST = '^[a-z0-9-]+-insportia\\.vercel\\.app$';

/* ── 5. what may never be published ─────────────────────────────────────── */

export const SECRET_PATTERNS = [
  ['jwt', /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['aws-access-key', /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['stripe-key', /\b[sr]k_(live|test)_[A-Za-z0-9]{16,}/],
  ['openai-anthropic-key', /\bsk-(ant-|proj-)?[A-Za-z0-9_-]{24,}/],
  ['supabase-token', /\bsbp_[a-f0-9]{30,}/],
  ['github-token', /\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/],
  ['google-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['meta-access-token', /\bEAA[A-Za-z0-9]{60,}/],
  ['runpod-key', /\brpa_[A-Za-z0-9]{20,}/],
  ['huggingface-token', /\bhf_[A-Za-z0-9]{30,}/],
  ['signed-url', /X-Amz-(Signature|Credential)=|[?&](sig|signature|token)=[A-Za-z0-9._~%-]{24,}/i],
  ['secret-assignment', /\b(SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE|META_APP_SECRET|R2_SECRET_ACCESS_KEY|RUNPOD_API_KEY|HF_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY)\b\s*[:=]\s*['"`][^'"`\s]{12,}['"`]/],
];

/** Credential-shaped matches in one text; the match itself is never echoed. */
export function scanText(text) {
  const hits = [];
  for (const [name, re] of SECRET_PATTERNS) {
    const m = re.exec(text);
    if (m) hits.push({ pattern: name, offset: m.index });
  }
  return hits;
}

const TEXT_EXT = new Set(['.html', '.json', '.md', '.js', '.mjs', '.css', '.txt']);
export function scanTree(dir) {
  const findings = [];
  for (const file of walk(dir)) {
    if (!TEXT_EXT.has(extname(file))) continue;
    for (const h of scanText(readFileSync(file, 'utf8'))) findings.push({ file: relative(dir, file), ...h });
  }
  return findings;
}

/* Source paths that must never have been indexed at all (.graphifyignore). */
const FORBIDDEN_SOURCE = /(^|\/)\.env($|\.)|\.(pem|key|p12|pfx)$|(^|\/)secrets\/|^supabase\/\.temp\/|(^|\/)\.mcp\.json$|(^|\/)(fixtures)\//;
export function forbiddenSources(graph) {
  return [...new Set(graph.nodes.map((n) => n.source_file).filter((f) => f && FORBIDDEN_SOURCE.test(f)))];
}

/* ── 3. does this commit change what the graph would show? ──────────────── */

const NOT_GRAPHED = /(^|\/)[^/]+\.md$|^docs\/|^\.github\/|^LICENSE$|\.(png|jpe?g|webp|gif|svg|glb|gltf|pdf|mp4|woff2?)$/i;
/** null = cannot tell (rebuild); true = graph-relevant; false = docs/assets only. */
export function graphRelevant(changedPaths) {
  if (!Array.isArray(changedPaths)) return null;
  return changedPaths.some((p) => p && !NOT_GRAPHED.test(p));
}

/* ── 6. the status every viewer shows ────────────────────────────────────── */

/**
 * prev: the live status.json (or null). outcome: { kind: 'built'|'reused'|'failed', reason? }.
 * The graph shown is the new one only for 'built'; 'reused' keeps the live
 * graph and moves the revision; 'failed' keeps the live graph and says so.
 */
export function nextStatus({ prev, revision, outcome, now, deploymentUrl, graphInfo }) {
  const entry = { sha: revision.sha, branch: revision.branch, at: now, result: outcome.kind, deployment: deploymentUrl ?? null };
  if (outcome.reason) entry.reason = outcome.reason;
  const history = [entry, ...(prev?.history ?? [])].slice(0, HISTORY_LIMIT);
  if (outcome.kind === 'built') {
    return { state: 'CURRENT', revision, graph: { sha: revision.sha, generatedAt: now, ...graphInfo }, lastAttempt: entry, history };
  }
  if (outcome.kind === 'reused' && prev?.graph) {
    return { state: 'CURRENT', revision, graph: prev.graph, note: `no graph-relevant change since ${prev.graph.sha.slice(0, 8)}`, lastAttempt: entry, history };
  }
  if (prev?.graph) {
    return {
      state: 'UPDATE_FAILED', revision: prev.revision, graph: prev.graph,
      failure: { attemptedSha: revision.sha, attemptedBranch: revision.branch, at: now, reason: outcome.reason ?? 'unknown', lastGoodSha: prev.graph.sha },
      lastAttempt: entry, history,
    };
  }
  return { state: 'NO_GRAPH', revision, graph: null, failure: { attemptedSha: revision.sha, at: now, reason: outcome.reason ?? 'unknown', lastGoodSha: null }, lastAttempt: entry, history };
}

/* ── mobile: Graphify's HTML has no viewport and a fixed 280px sidebar ───── */

const MOBILE_CSS = `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style id="homatch-mobile">
@media (max-width: 760px) {
  body { flex-direction: column !important; height: 100dvh !important; }
  #graph { flex: 1 1 auto !important; min-height: 58dvh; }
  #sidebar { width: auto !important; max-height: 42dvh; border-left: 0 !important; border-top: 1px solid #2a2a4e; overflow: auto !important; }
  #search, input[type="text"] { font-size: 16px !important; }
}
</style>`;
export function mobilePatch(html) {
  if (html.includes('id="homatch-mobile"')) return html;
  return html.replace(/<head([^>]*)>/i, (m) => `${m}\n${MOBILE_CSS}`);
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p); else yield p;
  }
}
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', cwd: ROOT, ...opts });
const git = (...a) => { const r = run('git', a); return r.status === 0 ? r.stdout.trim() : null; };
const log = (m) => console.log(`[viewer] ${m}`);

function revisionOf() {
  return {
    sha: process.env.VERCEL_GIT_COMMIT_SHA || git('rev-parse', 'HEAD') || 'unknown',
    branch: process.env.VERCEL_GIT_COMMIT_REF || git('rev-parse', '--abbrev-ref', 'HEAD') || 'unknown',
    message: (process.env.VERCEL_GIT_COMMIT_MESSAGE || git('log', '-1', '--format=%s') || '').split('\n')[0].slice(0, 140),
  };
}

/* Cross-build state: Vercel restores .cache/** paths declared in config.json. */
const STATE = join(HERE, '.cache', 'homatch-viewer');
function readState() {
  try { return JSON.parse(readFileSync(join(STATE, 'status.json'), 'utf8')); } catch { return null; }
}
function restoreState(prev, dest) {
  for (const f of prev?.files ?? []) {
    const src = join(STATE, 'g', f);
    if (!existsSync(src)) throw new Error(`cached graph incomplete: g/${f} missing`);
    mkdirSync(dirname(join(dest, f)), { recursive: true });
    cpSync(src, join(dest, f));
  }
}
function saveState(status, G) {
  rmSync(STATE, { recursive: true, force: true });
  mkdirSync(STATE, { recursive: true });
  cpSync(G, join(STATE, 'g'), { recursive: true });
  writeFileSync(join(STATE, 'status.json'), JSON.stringify(status));
  writeFileSync(join(STATE, '.gitignore'), '# viewer build state (Vercel build cache): never committed\n*\n');
}

function installGraphify() {
  const bin = join(homedir(), '.local', 'bin');
  process.env.PATH = `${bin}:${process.env.PATH}`;
  const have = run('graphify', ['--version']);
  if (have.status === 0 && have.stdout.includes(GRAPHIFY_VERSION)) return;
  let uv = run('uv', ['--version']).status === 0 ? 'uv' : null;
  if (!uv && run('python3', ['-m', 'pip', 'install', '--user', '--quiet', 'uv']).status === 0) uv = join(bin, 'uv');
  if (!uv) {
    const r = run('sh', ['-c', 'curl -LsSf https://astral.sh/uv/install.sh | sh']);
    if (r.status === 0) uv = join(bin, 'uv');
  }
  if (!uv) throw new Error('no way to install uv (needed for Graphify)');
  const r = run(uv, ['tool', 'install', '--python', '3.12', `graphifyy[sql]==${GRAPHIFY_VERSION}`], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`uv tool install graphifyy[sql]==${GRAPHIFY_VERSION} failed`);
}

/* Which files on this revision still mention the GPU-pipeline dependencies.
   A SOURCE SCAN, not graph data: paths and counts only, never contents. */
const DEP_TERMS = {
  SAM: /\bSAM ?2(\.1)?\b|\bsam2\b|Sam2Segmenter|segment[-_ ]anything/i,
  TRELLIS: /trellis/i,
  HF_TOKEN: /\bHF_TOKEN\b|huggingface_hub|hf_hub_download/,
  Runpod: /runpod/i,
  Blender: /\bblender\b|\bbpy\b/i,
  'Generated assets': /ds_generated_assets|ds_generation_jobs|generated_assets/i,
};
const SCAN_SKIP_DIR = new Set(['node_modules', '.git', '.vercel', 'graphify-out', 'dist', 'coverage', 'worktrees', 'fixtures', '__snapshots__']);
const SCAN_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.py', '.sql', '.toml', '.yml', '.yaml', '.sh', '.json']);
function sourceScan() {
  const out = Object.fromEntries(Object.keys(DEP_TERMS).map((k) => [k, []]));
  const visit = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      const rel = relative(ROOT, p);
      if (e.isDirectory()) { if (!SCAN_SKIP_DIR.has(e.name) && rel !== 'graphify-viewer') visit(p); continue; }
      /* same exclusions as the graph (.graphifyignore: vendored/minified), and
         never the graph tooling's own pattern lists */
      if (!SCAN_EXT.has(extname(e.name)) || /(^|\/)\.env|lock\.(json|yaml)$|translations\.ts$|^official-worker\/extensions\/[^/]+\/src\/|\.min\.js$|^scripts\/claude\/graphify\.mjs$/.test(rel) || statSync(p).size > 1_000_000) continue;
      const text = readFileSync(p, 'utf8');
      for (const [k, re] of Object.entries(DEP_TERMS)) if (re.test(text)) out[k].push(rel);
    }
  };
  visit(ROOT);
  return out;
}

/* ── the build ───────────────────────────────────────────────────────────── */

const SHELL = ['index.html', 'viewer.css', 'viewer.js'];

async function main() {
  const OUT = OUTPUT_DIR;
  const STATIC = join(OUT, 'static');
  const G = join(STATIC, 'g');
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(G, { recursive: true });

  const revision = revisionOf();
  const now = new Date().toISOString();
  log(`revision ${revision.branch} @ ${revision.sha.slice(0, 8)}`);
  const prev = readState();
  log(prev?.graph ? `cached state: graph @ ${prev.graph.sha.slice(0, 8)} (${prev.state}), ${prev.history?.length ?? 0} history entries` : 'cached state: none (first build or cache evicted)');

  let outcome;
  let graphInfo = {};
  /* 3. docs-only since the live graph → reuse it */
  const changed = prev?.graph?.sha ? git('diff', '--name-only', prev.graph.sha, revision.sha) : null;
  const relevant = graphRelevant(changed === null ? null : changed.split('\n').filter(Boolean));
  if (prev?.graph && prev.state !== 'UPDATE_FAILED' && relevant === false) {
    try { restoreState(prev, G); outcome = { kind: 'reused' }; log('no graph-relevant change: cached graph re-published'); }
    catch (e) { log(`reuse failed (${e.message}) — rebuilding`); }
  }

  if (!outcome) {
    try {
      installGraphify();
      const b = run(process.execPath, ['scripts/claude/graphify.mjs'], { stdio: 'inherit' });
      if (b.status !== 0) throw new Error(`graphify build exited ${b.status}`);
      const go = join(ROOT, 'graphify-out');
      const graph = JSON.parse(readFileSync(join(go, 'graph.json'), 'utf8'));
      const bad = forbiddenSources(graph);
      if (bad.length) throw new Error(`excluded source paths reached the graph: ${bad.slice(0, 5).join(', ')}`);
      /* assemble g/ */
      mkdirSync(join(G, 'all'), { recursive: true });
      mkdirSync(join(G, 'data'), { recursive: true });
      cpSync(join(go, 'graph.html'), join(G, 'all', 'graph.html'));
      if (existsSync(join(go, 'callflow.html'))) cpSync(join(go, 'callflow.html'), join(G, 'all', 'callflow.html'));
      cpSync(join(go, 'graph.json'), join(G, 'data', 'graph.json'));
      cpSync(join(go, 'GRAPH_REPORT.md'), join(G, 'data', 'GRAPH_REPORT.md'));
      cpSync(join(go, 'traces.json'), join(G, 'traces.json'));
      for (const v of readdirSync(join(go, 'views'), { withFileTypes: true })) {
        if (!v.isDirectory()) continue;
        for (const f of ['graph.html', 'callflow.html', 'graph.json']) {
          const src = join(go, 'views', v.name, f);
          if (existsSync(src)) { mkdirSync(join(G, 'views', v.name), { recursive: true }); cpSync(src, join(G, 'views', v.name, f)); }
        }
      }
      cpSync(join(go, 'views', 'index.json'), join(G, 'views', 'index.json'));
      writeFileSync(join(G, 'deps.json'), JSON.stringify(sourceScan(), null, 2));
      for (const f of walk(G)) if (f.endsWith('.html')) writeFileSync(f, mobilePatch(readFileSync(f, 'utf8')));
      const by = (c) => graph.links.filter((e) => e.confidence === c).length;
      const dg = run(process.execPath, ['scripts/claude/graphify.mjs', 'digest']).stdout.trim().split(' ')[1] ?? null;
      graphInfo = {
        graphifyVersion: GRAPHIFY_VERSION, builtAtCommit: graph.built_at_commit ?? null, digest: dg,
        nodes: graph.nodes.length, edges: graph.links.length, extracted: by('EXTRACTED'), inferred: by('INFERRED'),
        files: new Set(graph.nodes.map((n) => n.source_file).filter(Boolean)).size,
      };
      /* 5. fail closed on any credential shape anywhere we would publish */
      const findings = scanTree(G);
      if (findings.length) throw new Error(`secret scan: ${findings.length} credential-shaped match(es): ${findings.slice(0, 5).map((f) => `${f.file}[${f.pattern}]`).join(', ')}`);
      outcome = { kind: 'built' };
      log(`graph built: ${graphInfo.nodes} nodes, ${graphInfo.edges} edges; secret scan clean`);
    } catch (e) {
      outcome = { kind: 'failed', reason: String(e.message).slice(0, 300) };
      log(`UPDATE FAILED: ${outcome.reason}`);
      rmSync(G, { recursive: true, force: true });
      mkdirSync(G, { recursive: true });
      let restored = false;
      if (prev?.graph) {
        try { restoreState(prev, G); restored = true; log(`last valid graph @ ${prev.graph.sha.slice(0, 8)} re-published as UPDATE_FAILED`); }
        catch (e2) { log(`could not restore the last valid graph: ${e2.message}`); }
      }
      if (!restored) {
        /* Nothing valid to show: fail the build so the previous deployment
           stays live; its /api/freshness will report STALE. */
        console.error(`[viewer] refresh failed and no cached graph to fall back on: ${outcome.reason}`);
        process.exit(1);
      }
    }
  }

  const status = nextStatus({ prev, revision, outcome, now, deploymentUrl: process.env.VERCEL_URL ?? null, graphInfo });
  if (outcome.kind === 'reused') status.graph = prev.graph;
  status.files = [...walk(G)].map((f) => relative(G, f)).sort();
  status.ancestors = (git('log', '--format=%H', '-n', '300', revision.sha) ?? '').split('\n').filter(Boolean).map((h) => h.slice(0, 8));
  if (outcome.kind !== 'built' && prev?.ancestors?.length && !status.ancestors.length) status.ancestors = prev.ancestors;

  for (const f of SHELL) cpSync(join(HERE, f), join(STATIC, f));
  writeFileSync(join(STATIC, 'status.json'), JSON.stringify(status, null, 2));

  /* the live freshness check (Vercel Function, Node) */
  const fn = join(OUT, 'functions', 'api', 'freshness.func');
  mkdirSync(fn, { recursive: true });
  cpSync(join(HERE, 'freshness.cjs'), join(fn, 'index.js'));
  writeFileSync(join(fn, 'package.json'), JSON.stringify({ type: 'commonjs' }));
  writeFileSync(join(fn, 'status.json'), JSON.stringify({ state: status.state, revision: status.revision, graph: status.graph && { sha: status.graph.sha }, ancestors: status.ancestors }));
  writeFileSync(join(fn, '.vc-config.json'), JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.js', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 10 }));

  const headers = {
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'SAMEORIGIN',
    'Cache-Control': 'private, max-age=0, must-revalidate',
  };
  writeFileSync(join(OUT, 'config.json'), JSON.stringify({
    version: 3,
    cache: ['.cache/homatch-viewer/**'],
    routes: [
      /* Serve ONLY on Vercel's team-scoped hosts (deployment, branch and
         <project>-insportia URLs), which Vercel Authentication protects.
         Every other host — the bare <project>.vercel.app production domain
         (served anonymously on 2026-10-02 although protection was on) or any
         custom domain — gets a 404 before files or functions are reached. */
      { src: '/(.*)', missing: [{ type: 'host', value: ALLOWED_HOST }], status: 404, dest: '/__host_not_allowed' },
      { src: '/(.*)', headers, continue: true },
      { handle: 'filesystem' },
      { src: '/(.*)', status: 404, dest: '/index.html' },
    ],
  }, null, 2));

  if (status.graph) saveState(status, G);
  log(`status ${status.state}; ${status.files.length} graph files; history ${status.history.length}`);
  /* A failed update still deploys (the viewer must SAY it failed), but the
     build log carries the failure. */
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  main().catch((e) => { console.error(`[viewer] build crashed: ${e.stack || e.message}`); process.exit(1); });
}
