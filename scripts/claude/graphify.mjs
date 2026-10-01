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
};

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

/* No LLM backend reachable: strip every credential Graphify could use and
   any directory that holds a `claude` executable. */
const LLM_ENV = /^(ANTHROPIC_|OPENAI_|GEMINI_|GOOGLE_API_KEY|KIMI_|MOONSHOT_|DEEPSEEK_|AZURE_|AWS_|OLLAMA_|GRAPHIFY_BACKEND|.*_API_KEY$)/;
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

function main() {
  selfIgnore();
  if (!process.argv.includes('views')) build();
  if (!existsSync(GRAPH)) {
    console.error(`no graph at ${GRAPH} — run: graphify extract . --code-only && graphify cluster-only .`);
    process.exit(1);
  }
  const graph = JSON.parse(readFileSync(GRAPH, 'utf8'));
  /* Community names live next to the full graph; with --graph Graphify looks
     beside the subgraph, so each view gets the names of its own communities
     (ids are unchanged by the cut). */
  const labelsFile = join(GRAPH, '..', '.graphify_labels.json');
  const labels = existsSync(labelsFile) ? JSON.parse(readFileSync(labelsFile, 'utf8')) : {};
  for (const [name, patterns] of Object.entries(VIEWS)) {
    const dir = join(OUT, name);
    mkdirSync(dir, { recursive: true });
    const sub = cut(graph, patterns);
    const file = join(dir, 'graph.json');
    writeFileSync(file, JSON.stringify(sub));
    const present = new Set(sub.nodes.map((n) => String(n.community)));
    writeFileSync(join(dir, '.graphify_labels.json'), JSON.stringify(Object.fromEntries(Object.entries(labels).filter(([k]) => present.has(k)))));
    const html = spawnSync(GRAPHIFY, ['export', 'html', '--graph', file], { encoding: 'utf8', env: localEnv() });
    const flow = spawnSync(GRAPHIFY, ['export', 'callflow-html', '--graph', file, '--output', join(dir, 'callflow.html')], { encoding: 'utf8', env: localEnv() });
    const by = (c) => sub.links.filter((e) => e.confidence === c).length;
    const other = sub.links.length - by('EXTRACTED') - by('INFERRED');
    console.log(`${name}: ${sub.nodes.length} nodes, ${sub.links.length} edges (${by('EXTRACTED')} EXTRACTED, ${by('INFERRED')} INFERRED${other ? `, ${other} AMBIGUOUS/other` : ''})`
      + ` → ${join(dir, 'graph.html')}${html.status ? ' [html FAILED]' : ''} · ${join(dir, 'callflow.html')}${flow.status ? ' [callflow FAILED]' : ''}`);
    if (html.status) console.error(html.stderr || html.stdout);
    if (flow.status) console.error(flow.stderr || flow.stdout);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) main();
