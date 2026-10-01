# Graphify — internal code graph (pre-flight, never proof)

Graphify (https://github.com/Graphify-Labs/graphify, PyPI `graphifyy`, CLI
`graphify`) turns the repository into a local knowledge graph: tree-sitter
AST nodes and edges, Leiden communities, an interactive HTML view and a
plain-language report. It is an **internal engineering tool**. Nothing in
Vercel, Supabase, Railway, Runpod, the frontend bundle or any edge function
depends on it, and its output is never committed or published.

## Install (once per machine)

```sh
uv tool install "graphifyy[sql]==0.9.73"   # [sql] = tree-sitter-sql, so migrations are indexed
graphify --version
```

Pinned to the version the HOMATCH exclusions and wrapper were audited
against. Upgrade deliberately: re-audit what it indexes (below) first.

The Claude Code skill is committed at `.claude/skills/graphify/` (the
official `graphify install --project` output, unmodified). The official
`graphify claude install` hooks are **not** installed: they redirect
Read/Grep to the graph with a machine-specific absolute path, and Graphify
never replaces source reading here.

## Build / refresh — always through the wrapper

```sh
node scripts/claude/graphify.mjs          # full rebuild (~1–2 min) + focused views
node scripts/claude/graphify.mjs views    # re-cut the focused views only
```

The wrapper runs `graphify extract . --code-only` (local AST, no LLM),
`graphify cluster-only .` and `graphify export callflow-html`, then cuts the
focused views. **It runs Graphify in a sanitised environment** — no LLM API
keys, no AWS credentials, no `claude` on PATH — because Graphify otherwise
names communities with any LLM backend it can detect (including the local
`claude` CLI), sending node identifiers off the machine. Without a backend
it uses its documented deterministic fallback (each community is named after
its hub node). Do not run bare `graphify cluster-only` / `/graphify` full
pipelines on HOMATCH: semantic extraction over docs and LLM labelling are
out of scope.

`graphify-out/` writes its own `.gitignore` (`*`): nothing in it can be
committed.

## What is indexed — and what is not

`.graphifyignore` (gitignore syntax, merged with `.gitignore`) excludes:
environment and credential files (`.env*`, keys, `supabase/.temp/`,
`.mcp.json`), git bundles, build output and caches, worktrees, the i18n
bundle, fixtures, lockfiles, binary assets, recording specs, and the
vendored minified worker extension. Code only — `--code-only` skips
documents, images and media entirely.

Before trusting a rebuilt graph after changing exclusions or upgrading,
re-check: no excluded path appears as a `source_file` in `graph.json`, and a
scan of `graph.json` for credential shapes (JWTs, `sk_`/`sbp_` keys, AKIA,
private-key headers, signed-URL query strings) is empty.

## Open it

| Output | What it is |
|---|---|
| `graphify-out/graph.html` | whole repo; above 5,000 nodes Graphify renders an aggregated community map |
| `graphify-out/views/design-studio/graph.html` | Design Studio + one hop of real dependencies |
| `graphify-out/views/meta-ads/graph.html` | Meta Ads (builder, edge functions, OAuth, webhooks, leads) + one hop |
| `graphify-out/**/callflow.html` | Mermaid call-flow per community |
| `graphify-out/GRAPH_REPORT.md` | hubs, communities, surprising connections |

Open the HTML files in a browser (`open` / `xdg-open` / double-click). They
load vis-network and Mermaid from public CDNs (unpkg, jsDelivr), so the
viewing machine needs internet; the graph data itself stays in the file.
Search box = node name; click a node for its file, community and edges;
the community legend toggles groups. For an area not covered by a view, add
a pattern list to `VIEWS` in `scripts/claude/graphify.mjs`.

## Ask it (Claude and humans)

```sh
graphify query "how does a reconstruction reach SceneController"
graphify path "handleAction()" "graph()"            # → calls [EXTRACTED]
graphify explain "handleReconstruct()"
```

Answers carry `file:line` and an edge confidence. "No path" often means an
HTTP hop: `graphify path "MetaAdsCreatePage" "graph()"` finds none, because
the browser reaches `meta-ads-api` through `functions.invoke`, not an import.
`query` output is budget-truncated (it says so); narrow it or raise `--budget`. Use the skill
(`/graphify query …`) the same way against the existing graph.

## Pre-flight rule for significant tasks

For a cross-cutting change, an unfamiliar subsystem or an impact question:

1. Refresh (`node scripts/claude/graphify.mjs`) if the graph is older than
   the code you care about.
2. Ask the graph for the entry points, call paths and blast radius.
3. **Read the source** at every `file:line` the answer depends on. The
   graph proposes where to look; the source decides.
4. Then the normal tools: `npm run homatch:scope`, `homatch:release:plan`.

## How to read it honestly

- **EXTRACTED** = an edge the AST states (an import, a call). **INFERRED** =
  Graphify's guess (name resolution, similarity). **AMBIGUOUS** = unresolved.
  Report them separately; never cite an INFERRED edge as fact without the
  source.
- Static only. It does not see HTTP hops (`supabase.functions.invoke('x')` →
  `supabase/functions/x/`), dependency-injected calls, dynamic imports by
  string, SQL called from TypeScript, or runtime configuration. Bridge those
  from source.
- Status language: "GRAPH ANALYZED" ≠ "TESTED" ≠ "DEPLOYED" ≠ "PROVEN".
- Graphing a subsystem grants no permission to change it; workstream
  boundaries are unchanged.
- An index is never proof of production state (`refs/deployed/*` and the
  artifact proofs are).
