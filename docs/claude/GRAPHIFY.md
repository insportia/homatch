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

## Online viewer (private, cloud — no owner PC)

`graphify-viewer/` is the source of a **separate** Vercel project,
`homatch-architecture`. It is not part of the customer HOMATCH build, nothing
in HOMATCH imports it, and its failure cannot affect homatch.live, Supabase,
Railway or Runpod.

```
push to main ─► Vercel (viewer project, Root Directory graphify-viewer/) ─► node build.mjs
                 │  → graphify-viewer/.vercel/output (Build Output API, INSIDE the Root Directory)
                 │  same scripts/claude/graphify.mjs as Claude Code (code-only, no LLM,
                 │  no credential in Graphify's environment)
                 ├─ secret scan of every published file + excluded-path check → fail closed
                 ├─ docs-only commit → cached graph re-published, revision re-stamped
                 ├─ failure → last valid graph re-published as UPDATE_FAILED
                 │            (attempted commit, last good commit, reason);
                 │            nothing cached → build fails, previous deployment stays
                 └─ deploy: shell + g/** (Graphify HTML/JSON) + status.json + /api/freshness
```

- **Access**: Vercel Authentication on every deployment URL of the project
  (`all_except_custom_domains`) and **no custom domain**, so every URL —
  including `homatch-architecture.vercel.app` — needs a Vercel login with
  access to the `insportia` team. Unauthenticated requests get 401 / the
  Vercel login, never the graph. `noindex` headers are defence in depth,
  not the control. Do not add a custom domain unless the plan can protect
  it ("All Deployments" protection); otherwise it would be public.
- **Guard**: `.github/workflows/architecture-viewer-guard.yml` (daily, on
  viewer changes, or by hand) requests the page, status, full graph,
  presets, traces and the function **anonymously** and fails if any is
  served. Override the URL with the repo variable `ARCHITECTURE_VIEWER_URL`.
- **Status bar**: branch @ short SHA, graph generated time, and a badge:
  `CURRENT` (live homatch.live runs this revision or an older commit of it —
  read from the build id it already publishes in `/sw.js`), `STALE` (live
  runs a commit this graph has not seen), `STALE · UPDATE FAILED`,
  `UNVERIFIED` (the live check could not run). Never CURRENT by default.
- **History**: the last 20 builds (commit, time, built / reused / failed +
  reason). Each successful build stays openable at its own deployment URL
  (also protected).
- **Presets**: All HOMATCH (community map), Design Studio, Meta Ads,
  Discovery / Campaigns, Supabase / DB, Infrastructure, Runpod / Blender —
  the `VIEWS` patterns in `scripts/claude/graphify.mjs`, i.e. filters over
  the one real graph. Traces, each stage a real node of the revision:
  - Design Studio (the #48 Blender scene factory): upload → reconstruction →
    compiled SceneBuildSpec → `runEngine` → `handleFactory` (Runpod
    dispatch) → worker `handle()` → `run_blender()` → `export_glb()` →
    `handleQa()` → signed R2 PUT → `attachFactoryModels()` →
    SceneController → walkthrough. The HTTP / Runpod / Blender-subprocess
    hops read NO_STATIC_PATH by design: verify those in source.
  - Meta Ads: builder → state → targeting → creative → review →
    meta-ads-api → OAuth → Graph API → publish → insights.
  - Meta Leads (#49): form → Page → permissions → Instant Forms state →
    Lead Ads Terms (`LeadTermsFlow` → `recheckLeadForms` → `readLeadTerms`)
    → domain guard → readiness → lead ingest.
  Plus a dependency source scan (SAM, TRELLIS, HF_TOKEN, Runpod, Blender,
  generated assets: paths only, same exclusions as the graph).
- **Manual refresh**: Vercel → homatch-architecture → Deployments → latest
  production → Redeploy (or push to main). The build cache carries the
  history; "Redeploy without cache" starts history afresh.
- **Which commits build** (repo config, overrides the dashboard):
  - viewer: `graphify-viewer/vercel.json` `ignoreCommand` — production
    (main) always rebuilds the graph; a preview builds only when the commit
    touched `graphify-viewer/`, `scripts/claude/graphify.mjs` or
    `.graphifyignore`.
  - customer app: root `vercel.json` `ignoreCommand`
    `git diff --quiet HEAD^ HEAD -- . ':(exclude)graphify-viewer'` — a commit
    that only changes `graphify-viewer/` does not rebuild homatch.live.
    Anything else (or an unreadable HEAD^) builds as before.

### Same truth for Claude (cloud or local)

A fresh cloud session needs no state from any PC:

```sh
uv tool install "graphifyy[sql]==0.9.73"
git checkout <the viewer's revision SHA>        # shown in the status bar
node scripts/claude/graphify.mjs                # ~1 min
node scripts/claude/graphify.mjs digest         # → "<sha> <digest>"
```

The digest equals the viewer's History → Digest for that commit (verified:
clean builds of one commit give one digest). The wrapper always builds from
scratch: an incremental extract over an old `graphify-out/` was seen to
drift (same commit, 18 nodes fewer). Then `graphify query /
path / explain` as above. Claude does **not** read the hosted viewer: it
rebuilds the same graph from the same commit and proves equality by digest.

### Vercel project settings (homatch-architecture)

The project exists (`prj_oRMiFPyvDLKzugaO6fuWOLgoZauj`). One source of
truth: the repository. Dashboard settings that the repo overrides should be
left at their defaults.

| Setting | Value | Source |
|---|---|---|
| Git repository / production branch | `insportia/homatch` / `main` | dashboard |
| Root Directory | `graphify-viewer` | dashboard (only setting the repo cannot express) |
| Include files outside the Root Directory | **on** (the graph indexes the whole repo) | dashboard |
| Framework, Build, Install command | `null` / `node build.mjs` / `echo no-install-needed` | `graphify-viewer/vercel.json` |
| Output Directory | none — Build Output API `graphify-viewer/.vercel/output` | `build.mjs` |
| Ignored Build Step | see "Which commits build" | `graphify-viewer/vercel.json` |
| Deployment Protection | Vercel Authentication, Standard (all but custom domains); no custom domain | dashboard |

Why the first deployments failed (2026-10-02): with Root Directory unset the
project read the repo-root `vercel.json` (the customer app's: vite, `dist`),
so its first READY build (c028ec49) was the customer app, not the viewer.
After Root Directory became `graphify-viewer`, `build.mjs` still wrote
`<repo>/.vercel/output`; Vercel looks inside the Root Directory, found
nothing, fell back to `public`, and failed. `build.mjs` now writes inside
`graphify-viewer/`.
