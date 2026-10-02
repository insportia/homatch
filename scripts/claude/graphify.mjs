#!/usr/bin/env node
/*
 * node scripts/claude/graphify.mjs [build|views] — the HOMATCH Graphify path.
 *
 *   build (default)  graphify extract . --code-only    local tree-sitter AST only
 *                    graphify cluster-only .            NEVER an LLM: Graphify
 *                      names communities with any LLM backend it can find —
 *                      an API key in the environment, or the local `claude`
 *                      CLI — which would send node names off the machine. It
 *                      runs here in a sanitised environment (no LLM keys, no
 *                      AWS credentials, no `claude` on PATH), so its own
 *                      documented fallback applies: deterministic names from
 *                      each community's hub node.
 *                    graphify export callflow-html, then the focused views
 *   views            only the focused views below
 *
 * Focused views:
 *
 * Graphify renders the whole HOMATCH graph (~24k nodes) as an aggregated
 * community map. For "what talks to what" inside one product area, this cuts
 * a subgraph out of graphify-out/graph.json — every node whose source file
 * belongs to the area, plus ONE hop of real dependencies (callers/callees,
 * imports) so shared code shows up — and renders it with Graphify's own
 * exporters:
 *
 *   graphify-out/views/<view>/graph.html          interactive (graphify export html)
 *   graphify-out/views/<view>/callflow.html       Mermaid call-flow (graphify export callflow-html)
 *
 * Local only. Reads graph.json; writes under graphify-out/ (self-ignored). Edge
 * confidence (EXTRACTED / INFERRED) is preserved exactly as Graphify wrote it.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const ROOT = process.cwd();
const GRAPH = process.argv.includes('--graph') ? process.argv[process.argv.indexOf('--graph') + 1] : join(ROOT, 'graphify-out/graph.json');
const OUT = join(GRAPH, '..', 'views');
/* Resolved once, before PATH is narrowed for the child processes. */
const GRAPHIFY = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['graphify'], { encoding: 'utf8' }).stdout?.split(/\r?\n/)[0]?.trim() || 'graphify';

export const VIEWS = {
  'design-studio': [
    /^src\/(pages|components|lib|services)\/designStudio\//, /^src\/share\//,
    /^supabase\/functions\/(design-studio-[^/]+|_shared\/designStudio)\//, /^scripts\/design-studio\//,
    /^infra\/design-studio-gpu-worker\//, /^supabase\/migrations\/.*design_studio/,
  ],
  'meta-ads': [
    /^src\/(components\/metaAds|components\/admin\/metaAds|lib\/metaAds)\//, /^src\/pages\/(outreach\/MetaAds|admin\/AdminMetaAds)/,
    /^src\/services\/metaAds\.ts$/, /^supabase\/functions\/(meta-ads-api|meta-oauth|meta-webhooks)\//,
    /^supabase\/functions\/_shared\/(metaAds|metaLeads)\.ts$/, /^supabase\/migrations\/.*meta_/,
  ],
  'discovery-campaigns': [
    /^src\/(campaign|matching)\//, /^src\/components\/(campaign|matching)\//, /^src\/pages\/(FindPropertyPage|ActiveSearchPage)/,
    /^src\/services\/(adminDiscovery|findProperty|matchingProgress|nativeMatches)\.ts$/,
    /^supabase\/functions\/(demand-discovery|supply-discovery|source-discovery-massive|external-discovery-orchestrator|discovery-queue-worker|seed-discovery-queries|match-campaign|comm-campaign-launch|outreach-[^/]+|run-matching(-v2)?|continuous-matching-worker|supply-matching|find-property(-plan)?|active-search-notify)\//,
    /^supabase\/functions\/_shared\/(campaign[A-Za-z]*|discoverySettings|matching_engine|nativeDemand|intent)\.ts$/,
    /^supabase\/migrations\/.*(discovery|campaign|match)/,
  ],
  'supabase-database': [
    /^supabase\/migrations\//, /^src\/db\//,
    /^supabase\/functions\/_shared\/(serviceCaller|storageAuth|spend_cap|billing)\.ts$/, /^supabase\/functions\/run-migration\//,
  ],
  infrastructure: [
    /^scripts\/(release|lib|claude)\//, /^scripts\/(deploy-scope|deploy-status|edgeArtifacts|check-edge-functions|edge-syntax-check|migration-baseline|run-tests|run-full-matrix)\.mjs$/,
    /^official-worker\//, /^src\/serviceWorker\//, /^vite\.config\.ts$/, /^graphify-viewer\//,
    /^supabase\/functions\/_shared\/(objectStore|storage[A-Za-z]*|serviceCaller|providers?|provider_types|providerCost|retiredProviders)\.ts$/,
    /^supabase\/functions\/_shared\/storage\//, /^supabase\/functions\/(system-health|provider-health-check|storage-[^/]+|spend-cap-check)\//,
  ],
  /* Whatever the revision really holds: since #48 the Runpod worker and the
     headless-Blender scene factory (infra/design-studio-gpu-worker), plus the
     BlendKit catalogue provider. A path filter, so SAM/TRELLIS code appears
     here only if a revision actually contains it. */
  'runpod-blender': [/(runpod|blender|blendkit|trellis|(^|[/_-])sam2?([/_.-]|$)|segmenter|gpu-worker)/i],
};

/* Stage → the node that stands for it. A stage with no match is reported as
   absent from this revision, never guessed. */
export const TRACES = {
  /* The merged Blender scene factory (#48): browser compiles a SceneBuildSpec,
     the edge dispatches one Runpod job per pass, the worker drives headless
     Blender, outputs go to R2 through signed PUTs, QA compares the render
     with the source, and the factory models join the canonical scene. */
  'design-studio': [
    ['Upload', /^uploadReference\(\)$/],
    ['AI reconstruction', /^handleReconstruct\(\)$/],
    ['SceneBuildSpec (compile)', /^compileSceneSpec\(\)$/],
    ['Factory orchestration', /^runEngine\(\)$/, /designStudio\/hybrid\/orchestrate\.ts$/],
    ['Factory edge (Runpod dispatch)', /^handleFactory\(\)$/, /design-studio-reconstruct\/factory\.ts$/],
    ['Runpod worker', /^handle\(\)$/, /gpu-worker\/worker\/handler\.py$/],
    ['Blender', /^run_blender\(\)$/, /gpu-worker\/worker\/pipeline\.py$/],
    ['GLB export', /^export_glb\(\)$/, /gpu-worker\/worker\/factory\/build\.py$/],
    ['Visual QA', /^handleQa\(\)$/, /design-studio-reconstruct\/factory\.ts$/],
    ['R2 (signed PUT)', /^presign\(\)$/, /_shared\/storage\/sigv4\.ts$/],
    ['Canonical scene', /^attachFactoryModels\(\)$/],
    ['SceneController', /^SceneController$/],
    ['Walkthrough', /^WalkthroughOverlay\(\)$/],
  ],
  'meta-ads': [
    ['Campaign Builder', /^MetaAdsCreatePage\(\)$/],
    ['State', /^useMetaDraft\(\)$/],
    ['Targeting', /^AudienceStep\(\)$/],
    ['Creative', /^CreativeStep\(\)$/],
    ['Review', /^ReviewStep\(\)$/],
    ['meta-ads-api', /^handleAction\(\)$/],
    ['OAuth', /^exchangeCodeForToken\(\)$/],
    ['Meta Graph API', /^graph\(\)$/],
    ['Campaign publish', /^publishCampaign\(\)$/],
    ['Insights', /^syncInsights\(\)$/],
  ],
  'meta-leads': [
    ['Leads (form builder)', /^LeadFormBuilder\(\)$/],
    ['Page / destination', /^DestinationStep\(\)$/],
    ['Permissions', /^missingInstantFormScopes\(\)$/],
    ['Instant Forms state', /^instantFormsState\(\)$|^InstantFormsState$/],
    ['Meta Lead Ads Terms (UI)', /^LeadTermsFlow\(\)$/],
    ['Terms re-check (Meta-confirmed)', /^recheckLeadForms\(\)$/],
    ['Terms read from Meta', /^readLeadTerms\(\)$/],
    ['Domain guard', /^classifyDomainScope\(\)$/],
    ['Readiness', /^runPreflight\(\)$/],
    ['Lead ingest (webhook)', /^ingestLead\(\)$/],
  ],
};

/* Test/QA files and shared UI primitives connect everything to everything;
   a trace never runs through them. */
const TEST_FILE = /(^|\/)(__tests__|tests)\/|\.(test|spec|qa)\.[cm]?[jt]sx?$|^src\/components\/ui\//;

/* Shortest static path from one node to another, skipping library hubs and
   test files. directed: follow edges source→target only (a calls/imports/
   contains b). Every hop keeps Graphify's relation and confidence. */
export function shortestPath(graph, from, to, { maxDepth = 6, directed = true } = {}) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  /* external modules (stdlib, npm) have no source file: shared imports are not coupling */
  const skip = (id) => HUB.test(byId.get(id)?.label ?? '') || TEST_FILE.test(byId.get(id)?.source_file ?? '') || !byId.get(id)?.source_file;
  const adj = new Map();
  for (const e of graph.links) {
    const dirs = directed ? [[e.source, e.target, '→']] : [[e.source, e.target, '→'], [e.target, e.source, '←']];
    for (const [a, b, dir] of dirs) {
      if (skip(b) || skip(a)) continue;
      if (!adj.has(a)) adj.set(a, []);
      adj.get(a).push({ to: b, dir, relation: e.relation, confidence: e.confidence, file: e.source_file, loc: e.source_location });
    }
  }
  const prev = new Map([[from, null]]);
  let frontier = [from];
  for (let d = 0; d < maxDepth && frontier.length && !prev.has(to); d += 1) {
    const next = [];
    for (const x of frontier) for (const h of adj.get(x) ?? []) if (!prev.has(h.to)) { prev.set(h.to, { from: x, ...h }); next.push(h.to); }
    frontier = next;
  }
  if (!prev.has(to)) return null;
  const hops = [];
  for (let x = to; prev.get(x); x = prev.get(x).from) hops.unshift(prev.get(x));
  return hops.map((h) => ({ from: byId.get(h.from)?.label, to: byId.get(h.to)?.label, dir: h.dir, relation: h.relation, confidence: h.confidence, at: h.file ? `${h.file}${h.loc ? `:${h.loc}` : ''}` : null }));
}

/*
 * A trace states, per consecutive pair of stages, the strongest thing the
 * graph actually says — never more:
 *   FLOW       a directed path a → … → b (calls / imports / contains)
 *   DEPENDS    only the reverse: b → … → a (b uses a; data still flows a→b)
 *   COUPLING   only an undirected connection (shared code), not a flow
 *   NO_STATIC_PATH  nothing within 6 hops — typically an HTTP or runtime
 *              hop (functions.invoke, a queue, a provider); bridge from source
 * Confidence is reported separately: ALL_EXTRACTED or INCLUDES_INFERRED.
 */
export function trace(graph, stages) {
  const degree = new Map();
  for (const e of graph.links) for (const x of [e.source, e.target]) degree.set(x, (degree.get(x) ?? 0) + 1);
  const pick = (re, fileRe) => graph.nodes.filter((n) => re.test(n.label ?? '') && !TEST_FILE.test(n.source_file ?? '') && (!fileRe || fileRe.test(n.source_file ?? '')))
    .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))[0];
  const found = stages.map(([stage, re, fileRe]) => {
    const n = pick(re, fileRe);
    return { stage, node: n ? { id: n.id, label: n.label, at: `${n.source_file}${n.source_location ? `:${n.source_location}` : ''}`, community: n.community_name ?? null } : null };
  });
  const links = [];
  const present = found.filter((s) => s.node);
  for (let i = 1; i < present.length; i += 1) {
    const [a, b] = [present[i - 1].node.id, present[i].node.id];
    let kind = 'FLOW';
    let hops = shortestPath(graph, a, b);
    if (!hops) { kind = 'DEPENDS'; hops = shortestPath(graph, b, a); }
    if (!hops) { kind = 'COUPLING'; hops = shortestPath(graph, a, b, { directed: false, maxDepth: 4 }); }
    if (!hops) kind = 'NO_STATIC_PATH';
    links.push({
      from: present[i - 1].stage, to: present[i].stage, kind,
      confidence: !hops ? null : hops.every((h) => h.confidence === 'EXTRACTED') ? 'ALL_EXTRACTED' : 'INCLUDES_INFERRED',
      hops: hops ?? [],
    });
  }
  return { stages: found, links };
}

/* Revision-independent identity of the graph content: nodes and edges only
   (community ids and labels can vary between runs). Two builds of one commit
   with one Graphify version give one digest. */
export function digest(graph) {
  const nodes = graph.nodes.map((n) => `${n.id}\t${n.source_file ?? ''}`).sort();
  const links = graph.links.map((e) => `${e.source}\t${e.target}\t${e.relation}\t${e.confidence}`).sort();
  return createHash('sha256').update(nodes.join('\n')).update('\n--\n').update(links.join('\n')).digest('hex');
}

/* Library hubs that would turn every view into a star around React. */
const HUB = /^(react|react-dom|react-router-dom|lucide-react|sonner|clsx|ref_https)$|^(cn|useLanguage|t)\(\)$/;

export function cut(graph, patterns, { maxNeighbors = 4000 } = {}) {
  const inArea = new Set(graph.nodes.filter((n) => patterns.some((re) => re.test(n.source_file ?? ''))).map((n) => n.id));
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const keep = new Set(inArea);
  let added = 0;
  for (const e of graph.links) {
    if (added >= maxNeighbors) break;
    const [a, b] = [e.source, e.target];
    for (const [x, y] of [[a, b], [b, a]]) {
      if (inArea.has(x) && !keep.has(y) && byId.has(y) && !HUB.test(byId.get(y).label ?? '')) { keep.add(y); added += 1; }
    }
  }
  const nodes = graph.nodes.filter((n) => keep.has(n.id) && !HUB.test(n.label ?? ''));
  const ids = new Set(nodes.map((n) => n.id));
  const links = graph.links.filter((e) => ids.has(e.source) && ids.has(e.target));
  return { ...graph, nodes, links, hyperedges: [], graph: { ...(graph.graph ?? {}), view: true } };
}

/* No LLM backend reachable: strip every credential Graphify could use (and
   anything secret-shaped: it needs none) and any directory that holds a
   `claude` executable. */
const LLM_ENV = /^(ANTHROPIC_|OPENAI_|GEMINI_|GOOGLE_API_KEY|KIMI_|MOONSHOT_|DEEPSEEK_|AZURE_|AWS_|OLLAMA_|GRAPHIFY_BACKEND|.*_API_KEY$)|SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE_KEY/i;
function localEnv() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !LLM_ENV.test(k)));
  const sep = process.platform === 'win32' ? ';' : ':';
  env.PATH = (process.env.PATH ?? '').split(sep)
    .filter((d) => d && !['claude', 'claude.cmd', 'claude.exe'].some((c) => existsSync(join(d, c)))).join(sep);
  return env;
}

function sh(args) {
  console.log(`$ graphify ${args.join(' ')}`);
  const r = spawnSync(GRAPHIFY, args, { stdio: 'inherit', env: localEnv() });
  if (r.status !== 0) { console.error(`graphify ${args[0]} failed`); process.exit(r.status ?? 1); }
}

/* graphify-out/ ignores itself: no root .gitignore entry needed, and the
   output can never be committed, whoever runs Graphify first. */
function selfIgnore() {
  mkdirSync(join(ROOT, 'graphify-out'), { recursive: true });
  writeFileSync(join(ROOT, 'graphify-out/.gitignore'), '# local Graphify output: never committed (docs/claude/GRAPHIFY.md)\n*\n');
}

function build() {
  sh(['extract', '.', '--code-only']);
  sh(['cluster-only', '.']);
  sh(['export', 'callflow-html', '.', '--output', join(ROOT, 'graphify-out/callflow.html')]);
}

function views(graph) {
  /* Community names live next to the full graph; with --graph Graphify looks
     beside the subgraph, so each view gets the names of its own communities
     (ids are unchanged by the cut). */
  const labelsFile = join(GRAPH, '..', '.graphify_labels.json');
  const labels = existsSync(labelsFile) ? JSON.parse(readFileSync(labelsFile, 'utf8')) : {};
  const summary = {};
  let failed = false;
  for (const [name, patterns] of Object.entries(VIEWS)) {
    const dir = join(OUT, name);
    mkdirSync(dir, { recursive: true });
    const sub = cut(graph, patterns);
    const by = (c) => sub.links.filter((e) => e.confidence === c).length;
    summary[name] = { nodes: sub.nodes.length, edges: sub.links.length, extracted: by('EXTRACTED'), inferred: by('INFERRED'), files: new Set(sub.nodes.map((n) => n.source_file).filter(Boolean)).size };
    if (!sub.nodes.length) { console.log(`${name}: no nodes in this revision`); continue; }
    const file = join(dir, 'graph.json');
    writeFileSync(file, JSON.stringify(sub));
    const present = new Set(sub.nodes.map((n) => String(n.community)));
    writeFileSync(join(dir, '.graphify_labels.json'), JSON.stringify(Object.fromEntries(Object.entries(labels).filter(([k]) => present.has(k)))));
    const html = spawnSync(GRAPHIFY, ['export', 'html', '--graph', file], { encoding: 'utf8', env: localEnv() });
    const flow = spawnSync(GRAPHIFY, ['export', 'callflow-html', '--graph', file, '--output', join(dir, 'callflow.html')], { encoding: 'utf8', env: localEnv() });
    const other = sub.links.length - by('EXTRACTED') - by('INFERRED');
    console.log(`${name}: ${sub.nodes.length} nodes, ${sub.links.length} edges (${by('EXTRACTED')} EXTRACTED, ${by('INFERRED')} INFERRED${other ? `, ${other} AMBIGUOUS/other` : ''})`
      + ` → ${join(dir, 'graph.html')}${html.status ? ' [html FAILED]' : ''} · ${join(dir, 'callflow.html')}${flow.status ? ' [callflow FAILED]' : ''}`);
    if (html.status) { failed = true; console.error(html.stderr || html.stdout); }
    if (flow.status) { failed = true; console.error(flow.stderr || flow.stdout); }
  }
  writeFileSync(join(OUT, 'index.json'), JSON.stringify(summary, null, 2));
  return !failed;
}

function traces(graph) {
  const out = Object.fromEntries(Object.entries(TRACES).map(([k, stages]) => [k, trace(graph, stages)]));
  writeFileSync(join(GRAPH, '..', 'traces.json'), JSON.stringify(out, null, 2));
  for (const [k, t] of Object.entries(out)) {
    console.log(`trace ${k}: ${t.stages.filter((s) => s.node).length}/${t.stages.length} stages in this revision; `
      + t.links.map((l) => `${l.from}→${l.to}=${l.kind}${l.confidence === 'INCLUDES_INFERRED' ? '(inferred)' : ''}`).join(', '));
  }
}

/* node scripts/claude/graphify.mjs [build|views|traces|digest] [--graph PATH] */
function main() {
  const mode = ['views', 'traces', 'digest'].find((m) => process.argv.includes(m)) ?? 'build';
  if (mode !== 'digest') selfIgnore();
  if (mode === 'build') build();
  if (!existsSync(GRAPH)) {
    console.error(`no graph at ${GRAPH} — run: node scripts/claude/graphify.mjs`);
    process.exit(1);
  }
  const graph = JSON.parse(readFileSync(GRAPH, 'utf8'));
  if (mode === 'digest') { console.log(`${graph.built_at_commit ?? 'unknown-commit'} ${digest(graph)}`); return; }
  let ok = true;
  if (mode !== 'traces') ok = views(graph);
  traces(graph);
  if (!ok) process.exit(1);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) main();
