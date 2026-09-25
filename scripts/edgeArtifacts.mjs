/*
 * WHAT PRODUCTION IS ACTUALLY RUNNING, ASKED OF PRODUCTION.
 *
 * On 2026-09-19 this pipeline reported "Deploy Edge Functions: success" twice
 * for work it never uploaded. Both times the evidence that it had not was
 * sitting in the Supabase API the whole time: ai-talk-session stayed at
 * version 107, updated_at 17:22:55, while refs/deployed/edge advanced to two
 * later commits and the manifest called production current.
 *
 * A deploy is proven by the artifact or it is not proven.
 *
 * FOR FIVE DAYS THAT SENTENCE WAS ENFORCED BY THE WRONG NUMBER.
 *
 * `version` was treated as the proof, on the reasoning that the platform
 * increments it on every successful upload and so post > pre is something a
 * no-op loop cannot fake. Both halves turned out to be wrong in opposite
 * directions. It does not increment when the platform recognises a bundle it
 * already has — so fifteen functions that were byte-perfect in production
 * were called UNPROVEN, and refs/deployed/edge could never advance again once
 * a single run had partially deployed. And an increment says only that an
 * upload happened, not that it carried this revision, so a counter moving
 * over the wrong tree would have passed.
 *
 * The question is therefore asked of the source rather than the counter:
 *
 *     PRODUCTION CONTAINS THE EXPECTED ARTIFACT FOR EVERY OWED FUNCTION.
 *
 * That question is asked by comparing the deployed source closure against the
 * revision, byte for byte. The source comes out of the deployed eszip's own
 * source maps — see WHERE THE DEPLOYED SOURCE COMES FROM below — so it is the
 * original TypeScript the bundler was handed, not a transpiler output anyone
 * has to re-derive.
 *
 * When the artifact cannot be read, the answer is UNAVAILABLE and the ref
 * stays where it is. That is deliberate. The proof is written for the evidence
 * it requires rather than bent to the evidence that happens to be available,
 * and a guard that cannot see is a guard that says so instead of waving work
 * through.
 *
 *   node scripts/edgeArtifacts.mjs snapshot ai-talk-session comm-agent
 *   node scripts/edgeArtifacts.mjs verify pre.json post.json --since <ms>
 *
 * Both need SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF: `verify` re-reads
 * each owed artifact to compare it, which is one extra GET per function and
 * the reason the rule can be trusted. The rule ITSELF — proveArtifact() — is
 * pure, so every case below is tested without touching production.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { importClosure } from './deploy-scope.mjs';

const FUNCTIONS_DIR = 'supabase/functions';

/** A function that does not exist yet. Any real upload beats this. */
export const ABSENT = { version: 0, updated_at: 0, absent: true };

/*
 * WHERE THE DEPLOYED SOURCE COMES FROM.
 *
 * Two endpoints, and only one of them is any use:
 *
 *   GET /v1/projects/{ref}/functions/{slug}        metadata. Measured against
 *       production: no files[], and ?include_files=true does not add them
 *       either — run 36104657682 asked for all eighteen owed functions and
 *       every one came back empty. An earlier version of this file claimed
 *       otherwise, from reading a Supabase MCP response; that tool reaches
 *       the source by a route CI does not have.
 *
 *   GET /v1/projects/{ref}/functions/{slug}/body   the deployed eszip. This
 *       is the artifact, and it is what production is actually running.
 *
 * WHAT IS INSIDE AN ESZIP, MEASURED RATHER THAN ASSUMED.
 *
 * A module's stored source is TRANSPILED JavaScript — types stripped, `as`
 * removed, `interface` gone. Comparing that against repository TypeScript
 * would mean reimplementing the transpiler, which is exactly why an earlier
 * investigation ruled this endpoint out.
 *
 * But every module also carries a SOURCE MAP, and its `sourcesContent` is the
 * original file, byte for byte. Built an eszip from real TypeScript, parsed it
 * back, and compared: transpiled source 153 chars against an original of 215,
 * `interface` and `as Local` gone from the module body and both present in
 * sourcesContent, which matched the original exactly.
 *
 * So sourcesContent is the comparison layer. It is the original local source,
 * it is what the bundler actually took, and it needs no transpiler.
 */
const META_URL = (ref, name) => `https://api.supabase.com/v1/projects/${ref}/functions/${name}`;
const BODY_URL = (ref, name) => `${META_URL(ref, name)}/body`;

/** The eszip container magic. Anything before it is an envelope, not content. */
const ESZIP_MAGIC = 'ESZIP';

/**
 * Every plausible eszip inside whatever the endpoint handed back, best first.
 *
 * The CLI uploads `CONST_PREFIX || brotli(eszip)`, so a stored blob may arrive
 * wearing a prefix, a compression, both or neither. Guessing wrong is not
 * dangerous — the parser rejects nonsense and the function ends up UNAVAILABLE
 * — but guessing wrong when the right answer was available WOULD be, so this
 * offers candidates and lets the parser arbitrate rather than deciding alone.
 *
 * Searching raw bytes for the magic is the LAST resort on purpose: brotli
 * stores short or incompressible input almost literally, so the magic often
 * appears inside the compressed stream and a naive scan hands the parser a
 * corrupt tail that merely looks right.
 */
export function eszipCandidates(buf, { brotliDecompress } = {}) {
  const out = [];
  const magicAt0 = (b) => b.length >= ESZIP_MAGIC.length
    && b.subarray(0, ESZIP_MAGIC.length).toString('latin1') === ESZIP_MAGIC;
  const scan = (b) => {
    const head = b.subarray(0, Math.min(b.length, 4096)).toString('latin1');
    const i = head.indexOf(ESZIP_MAGIC);
    return i > 0 ? b.subarray(i) : null;
  };

  if (magicAt0(buf)) out.push(buf);
  if (brotliDecompress) {
    /*
     * Offset 0 first, then a short way in: the CLI puts a fixed constant in
     * front of the compressed eszip, and its length is an implementation
     * detail rather than something worth hardcoding here. Bounded to 64 and
     * stopped at the first success, and only reached when the bytes were not
     * a bare container to begin with.
     */
    for (let offset = 0; offset <= 64; offset += 1) {
      if (offset > 0 && out.length > 0) break;
      let inflated;
      try { inflated = brotliDecompress(buf.subarray(offset)); } catch { continue; }
      if (magicAt0(inflated)) { out.push(inflated); break; }
      const found = scan(inflated);
      if (found) { out.push(found); break; }
    }
  }
  const scanned = scan(buf);
  if (scanned) out.push(scanned);
  return out;
}

/** The single best candidate, or null. Kept for callers that want one guess. */
export function unwrapEszip(buf, opts = {}) {
  return eszipCandidates(buf, opts)[0] ?? null;
}

/** Metadata only: version, timestamps and the diagnostic hash. */
export async function fetchArtifact(name, { projectRef, token, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(META_URL(projectRef, name), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return { ...ABSENT };
  if (!res.ok) throw new Error(`${name}: API answered ${res.status}`);
  const body = await res.json();
  return {
    version: Number(body.version ?? 0),
    updated_at: Number(body.updated_at ?? 0),
    status: body.status ?? null,
    /*
     * KEPT, AND DIAGNOSTIC ONLY. IT CANNOT BE PROMOTED.
     *
     * WHAT IT ACTUALLY IS, read out of the pinned CLI (2.117.0) rather than
     * guessed from the field name. The deploy path bundles in a container,
     * then:
     *
     *   S = read(output.eszip)
     *   P = concat(CONST_PREFIX, brotli(S, { BROTLI_PARAM_QUALITY: 6 }))
     *   sha256 = hex(SHA-256(P))                     <- this field
     *
     * and uploads P as `application/vnd.denoland.eszip` to
     * POST /v1/projects/{ref}/functions with sha256 as the `ezbr_sha256`
     * QUERY PARAMETER. So the value is computed by the CLI and merely stored
     * by the platform — "ezbr" is eszip-plus-brotli. The CLI's own dedup is
     * exactly `deployed.ezbr_sha256 === freshly_computed.sha256`, which is
     * what "No change found in Function: x" means.
     *
     * WHY IT IS NOT THE PROOF. It is not reproducible. Production measured it
     * twice over a byte-identical source closure and disagreed with itself:
     * cartesia-access-token v26 a34394a5... and v27 43428031..., the same four
     * files, each verified identical to its revision, with no commit in
     * between touching supabase/ or src/. Seventeen other functions hashed
     * stably across the same pair of runs, so the bundle is MOSTLY
     * deterministic — and "mostly" is what a proof may not be.
     */
    ezbr_sha256: body.ezbr_sha256 ?? null,
  };
}

/*
 * WHAT PRODUCTION CALLS A LOCAL MODULE, MEASURED.
 *
 * Not `file:`. An eszip built on a laptop names local modules with file URLs;
 * the containerised bundler that made these does not, and run 36111826961
 * retrieved and parsed all eighteen bodies and found zero of them. Run
 * 36113577620 printed the census instead of guessing a third time:
 *
 *   cartesia-access-token   6 local of 22   [https:15 (none):6 jsr:1]
 *   research-agent        600 local of 624  [vfs:529 (none):71 https:17 npm:5 jsr:2]
 *
 * The repository modules are the SCHEME-LESS ones, named relative to the
 * bundle root — functions/_shared/comm/auth.ts, or
 * homatch/src/verify/researchPlan.ts once the closure reaches into src/.
 *
 * The rest are not ours. vfs: is vendored npm — 529 of research-agent's 624
 * entries. And an eszip carries control records that are not code at all:
 * ---SUPABASE-ESZIP-VERSION-ESZIP--- and ---EDGE-RUNTIME-METADATA--- sit
 * beside the modules in every single function, and counting them as deployed
 * source made all eighteen INCOMPLETE for "running files this revision does
 * not have" — while underneath that verdict every real module matched.
 */
const REMOTE_SCHEME = /^(https?|jsr|npm|node|data|blob|vfs):/i;
const CONTROL_RECORD = /^-{3}[A-Z0-9-]+-{3}$/;

/**
 * Could this eszip entry have come from this repository?
 *
 * Stated as what it is NOT, because that is the half that does not move when
 * the bundler is invoked differently. Being lenient here admits nothing on its
 * own: an entry only reaches the comparison if its path ALSO suffix-matches a
 * file in the expected closure.
 */
export function isRepositoryModule(specifier) {
  const spec = String(specifier);
  return !REMOTE_SCHEME.test(spec) && !CONTROL_RECORD.test(spec);
}

/**
 * The local modules production is actually running, as original source.
 *
 * Remote dependencies (https:, jsr:, npm:) are deliberately not returned:
 * they do not come from this repository and there is nothing here to compare
 * them against. Only `file:` modules — the entrypoint, _shared and src/ — are
 * the deployed local code this proof is about.
 *
 * A local module whose source map carries no sourcesContent is returned with
 * `content: null` rather than with its transpiled body, because the transpiled
 * body is not comparable and pretending otherwise would fail every function
 * for the wrong reason. The proof reads null as "cannot be established".
 */
export async function fetchDeployedModules(name, { projectRef, token, fetchImpl = fetch, parserFactory } = {}) {
  const res = await fetchImpl(BODY_URL(projectRef, name), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return { ok: false, reason: 'production has no body for this function', modules: null };
  if (!res.ok) return { ok: false, reason: `body endpoint answered ${res.status}`, modules: null };

  const raw = Buffer.from(await res.arrayBuffer());
  const { brotliDecompressSync } = await import('node:zlib');
  const candidates = eszipCandidates(raw, { brotliDecompress: brotliDecompressSync });
  if (candidates.length === 0) {
    return { ok: false, reason: `no eszip container in ${raw.length} bytes`, modules: null, bytes: raw.length };
  }

  const makeParser = parserFactory ?? (async () => {
    const { Parser } = await import('@deno/eszip');
    return Parser.createInstance();
  });

  /*
   * Each candidate gets its own parser instance: parseBytes is stateful, and a
   * rejected attempt must not leave anything behind for the next one.
   */
  let parser = null;
  let specifiers = null;
  let lastError = 'no candidate parsed';
  for (const candidate of candidates) {
    let attempt;
    try {
      attempt = await makeParser();
    } catch (err) {
      return { ok: false, reason: `eszip parser unavailable: ${err?.message ?? err}`, modules: null, bytes: raw.length };
    }
    try {
      specifiers = await attempt.parseBytes(new Uint8Array(candidate));
      await attempt.load();
      parser = attempt;
      break;
    } catch (err) {
      lastError = err?.message ?? String(err);
    }
  }
  if (!parser) {
    return { ok: false, reason: `eszip did not parse: ${lastError}`, modules: null, bytes: raw.length };
  }

  const schemes = new Map();
  const modules = [];
  const examples = [];
  for (const specifier of specifiers) {
    const spec = String(specifier);
    const scheme = (spec.match(/^([a-z][a-z0-9+.-]*):/i)?.[1] ?? '(none)').toLowerCase();
    schemes.set(scheme, (schemes.get(scheme) ?? 0) + 1);
    if (!isRepositoryModule(spec)) continue;

    let sourceUrl = spec;
    let content = null;
    try {
      const rawMap = await parser.getModuleSourceMap(specifier);
      if (rawMap) {
        const map = JSON.parse(rawMap);
        const from = (map.sources ?? [])[0];
        const text = (map.sourcesContent ?? [])[0];
        if (typeof text === 'string') content = text;
        if (typeof from === 'string' && isRepositoryModule(from)) sourceUrl = from;
      }
    } catch { /* leave content null: unresolvable, not wrong */ }
    if (examples.length < 3) examples.push(sourceUrl);
    modules.push({ specifier: spec, sourceUrl, content });
  }

  /*
   * Shapes, never contents: this log is public build output. It exists
   * because the one thing that has repeatedly cost a run is not knowing how
   * production names a module.
   */
  const census = [...schemes.entries()].sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}:${n}`).join(' ');
  return {
    ok: true,
    reason: `${modules.length} local of ${specifiers.length} modules [${census}]`,
    modules,
    bytes: raw.length,
    examples,
  };
}

/*
 * Version evidence for every owed function, without the file bodies.
 *
 * pre.json and post.json exist to say what MOVED, and they are written to the
 * runner's disk and read back. Carrying a megabyte of deployed source through
 * them twice would buy nothing: the proof re-reads the artifact itself.
 */
export async function snapshot(names, opts) {
  const out = {};
  for (const name of names) {
    const { files, route, ...rest } = await fetchArtifact(name, { ...opts, withFiles: false });
    out[name] = rest;
  }
  return out;
}

/* ── THE ARTIFACT PROOF ───────────────────────────────────────────────────
 *
 * DEPLOYMENT EVIDENCE AND CORRECTNESS EVIDENCE ARE DIFFERENT THINGS.
 *
 * `version`, `updated_at`, the CLI's exit code and the words "Deployed
 * Functions" all answer "did a deployment event happen?". None of them
 * answers "is the code production runs the code this revision says it should
 * run?" — and that second question is the only one the pipeline actually
 * cares about. Run 36099775881 proved both halves of the gap in one job:
 *
 *   cartesia-access-token  CLI printed "Deploying Function (95 kB)", printed
 *                          "Deployed Functions", earned a ✅ — and the version
 *                          stayed at 26, because the platform deduplicates an
 *                          identical bundle server-side. Deployment evidence
 *                          said nothing happened; the artifact was correct.
 *
 *   fifteen others         "No change found", version unmoved, every one of
 *                          them byte-identical to the revision. The old rule
 *                          called all fifteen UNPROVEN and refused the ref,
 *                          which is how refs/deployed/edge sat at 61cd6388
 *                          for five days while production was already current.
 *
 * So the invariant is stated over the artifact, not over the event:
 *
 *     PRODUCTION CONTAINS THE EXPECTED ARTIFACT FOR EVERY OWED FUNCTION.
 *
 * A version increment is NOT accepted as a substitute. A deploy that bumps
 * the counter while uploading the wrong tree is exactly the false success
 * this mechanism exists to catch, so it fails here like any other mismatch.
 */

/** What a proof can conclude. Anything not PROVEN_* leaves the ref alone. */
export const PROOF = {
  /** Every deployed local module is identical to this revision. */
  PROVEN_EXACT: 'PROVEN_EXACT',
  /*
   * There is deliberately no PROVEN_HASH. The only hash production offers is
   * ezbr_sha256, it is the CLI's own number, and it is not reproducible --
   * cartesia-access-token hashed differently twice over an identical source
   * closure. A proof state nobody can reach honestly is a proof state that
   * eventually gets reached dishonestly.
   */
  /** Production answered, and what it is running is not this revision. */
  STALE: 'STALE',
  /** Production is running a file this revision does not have, or the
   *  deployed names cannot be resolved against the repository unambiguously. */
  INCOMPLETE: 'INCOMPLETE',
  /** Production would not tell us what it is running. Never a pass. */
  UNAVAILABLE: 'UNAVAILABLE',
};

/**
 * Resolve one deployed file name onto repository paths.
 *
 * The CLI names deployed files relative to the parent of the closure's common
 * ancestor, so the prefix depends on how far the closure reaches:
 *
 *   closure inside supabase/functions   functions/_shared/comm/auth.ts
 *   closure reaching into src/          homatch/supabase/functions/x/index.ts
 *
 * Rather than reimplement that rule — and inherit a new bug the first time a
 * checkout is named something other than `homatch` — a deployed name and a
 * repository path correspond when either is a path-suffix of the other.
 * Measured against production for 8 function/version pairs: 200 files, every
 * one matched, and never more than one candidate.
 */
export function matchDeployedName(deployedName, expectedPaths) {
  return expectedPaths.filter(
    (p) => p === deployedName || p.endsWith(`/${deployedName}`) || deployedName.endsWith(`/${p}`),
  );
}

/**
 * Does production contain the expected artifact? Pure, so it is testable
 * without a network, a token or a deployment.
 *
 * `expected` is a repo-path -> contents map for the function's import closure.
 * It DELIBERATELY over-approximates: importClosure() cannot tell `import type`
 * from a value import, so it follows type-only edges the bundler erases —
 * research-agent expects 82 files and production correctly bundles 69. That
 * makes "expected file missing from production" normal and informational, and
 * it is reported without failing anything.
 *
 * The comparison that DOES decide runs over the files production actually
 * deployed, and it is sound in the direction that matters: a bundle's
 * membership cannot change without a textual change to a file already in it,
 * because adding or removing an import means editing the importing file. So a
 * production bundle whose every file matches this revision cannot be missing
 * work this revision introduced. ai-talk-session is the worked example — v114
 * added _shared/comm/generated/numericSafety.ts, and v107 is caught not by
 * noticing the absent file but because v107's index.ts, which would have had
 * to import it, differs.
 */
/*
 * THE ONLY NORMALISATION, AND WHY IT IS NOT A LOOPHOLE.
 *
 * A CRLF is how a file is WRITTEN OUT, not what the repository contains. This
 * checkout has core.autocrlf=true, so every line of every file on disk ends
 * \r\n, while git stores \n and the Linux runner that built the bundle checked
 * out \n. Comparing the two raw makes all 200 files differ and reports a
 * perfectly current production as STALE — the same Windows artefact that has
 * already made deployPipeline look like a broken pipeline once.
 *
 * So both sides are canonicalised to \n before comparison, and NOTHING else
 * is touched: no trimming, no whitespace collapsing, no comment stripping, no
 * reformatting. Those would hide real differences. This one cannot, because
 * git treats \r\n and \n as the same content by construction — a file that
 * genuinely ships CRLF (.gitattributes eol=crlf) is stored CRLF and deployed
 * CRLF, and canonicalising both sides leaves it equal either way.
 */
const canonical = (s) => String(s).split('\r\n').join('\n');

export function proveArtifact({ name, expected, deployed }) {
  const expectedPaths = Object.keys(expected);
  const entry = `${FUNCTIONS_DIR}/${name}/index.ts`;
  const modules = Array.isArray(deployed?.modules) ? deployed.modules : null;
  const base = {
    name,
    version: deployed?.version ?? 0,
    updated_at: deployed?.updated_at ?? 0,
    ezbr_sha256: deployed?.ezbr_sha256 ?? null,
    expectedFileCount: expectedPaths.length,
    deployedFileCount: modules?.length ?? 0,
    matched: 0,
    missing: [],
    foreign: [],
    mismatched: [],
    ambiguous: [],
    unresolved: [],
  };

  if (!deployed || deployed.absent) {
    return { ...base, state: PROOF.UNAVAILABLE, reason: 'production has no such function' };
  }
  if (!modules) {
    /*
     * No readable artifact is no correctness evidence, and there is nothing
     * weaker that may stand in for it. ezbr_sha256 is right there and is NOT
     * used: it is the CLI's own number and it is not reproducible.
     */
    return {
      ...base,
      state: PROOF.UNAVAILABLE,
      reason: deployed.reason ?? 'the deployed artifact could not be read',
    };
  }

  const matchedExpected = new Set();
  for (const mod of modules) {
    const path = decodeURIComponent(String(mod.sourceUrl ?? mod.specifier ?? '')).replace(/^file:\/\//, '');
    const hits = matchDeployedName(path, expectedPaths);
    if (hits.length === 0) { base.foreign.push(path); continue; }
    if (hits.length > 1) { base.ambiguous.push(path); continue; }
    const repoPath = hits[0];
    matchedExpected.add(repoPath);
    /*
     * A local module whose source map carried no sourcesContent. Its
     * transpiled body is in the artifact and is NOT comparable to repository
     * TypeScript, so this is "cannot be established" rather than "differs" —
     * and it blocks the proof instead of quietly passing.
     */
    if (typeof mod.content !== 'string') { base.unresolved.push(repoPath); continue; }
    base.matched += 1;
    if (canonical(expected[repoPath]) !== canonical(mod.content)) base.mismatched.push(repoPath);
  }
  base.missing = expectedPaths.filter((p) => !matchedExpected.has(p));

  if (base.foreign.length || base.ambiguous.length) {
    return {
      ...base,
      state: PROOF.INCOMPLETE,
      reason: base.foreign.length
        ? `production runs ${base.foreign.length} local module(s) this revision does not have`
        : `${base.ambiguous.length} deployed path(s) matched more than one repository file`,
    };
  }
  if (base.unresolved.length) {
    return {
      ...base,
      state: PROOF.INCOMPLETE,
      reason: `${base.unresolved.length} deployed module(s) carried no original source to compare`,
    };
  }
  if (base.mismatched.length) {
    return {
      ...base,
      state: PROOF.STALE,
      reason: `${base.mismatched.length} deployed module(s) differ from this revision`,
    };
  }
  if (!matchedExpected.has(entry)) {
    return { ...base, state: PROOF.INCOMPLETE, reason: 'the deployment does not contain the function entrypoint' };
  }
  return {
    ...base,
    state: PROOF.PROVEN_EXACT,
    reason: `${base.matched} deployed module(s) identical to this revision`,
  };
}

/** Is this proof good enough to let the ref move? */
export const isProven = (proof) => proof.state === PROOF.PROVEN_EXACT;

/** Read one function's expected closure off disk, as proveArtifact wants it. */
export function expectedClosure(name, root = process.cwd()) {
  const out = {};
  for (const rel of importClosure(`${FUNCTIONS_DIR}/${name}/index.ts`, root)) {
    try { out[rel] = readFileSync(resolvePath(root, rel), 'utf8'); } catch { /* unreadable: absent from the map */ }
  }
  return out;
}

/*
 * DEPLOYMENT EVIDENCE, AS A PURE FUNCTION.
 *
 * Per function, not per job. The old check asked one question about one
 * function (ai-talk-session) and only when a cross-job output said to, so a
 * run that uploaded comm-agent and silently dropped ai-talk-session passed —
 * which is exactly what run 8618f244 did. Every name that was owed is now
 * answered for by name.
 *
 * WHAT THIS IS AND IS NOT, SINCE 2026-09-25.
 *
 * It answers "did a deployment event happen for this function during this
 * run?" and nothing else. It is REPORTED, and it no longer DECIDES: a
 * legitimate server-side or CLI-side deduplication moves no counter and is
 * not a failure, and a counter that moves over the wrong tree is not a pass.
 * proveArtifact() decides. This stays because "the version moved, and it
 * moved during this run" is worth printing next to the proof — it is how a
 * reader tells a fresh upload from an already-current function.
 */
export function compareArtifacts(pre, post, sinceMs) {
  const rows = [];
  for (const name of Object.keys(pre)) {
    const a = pre[name] ?? { ...ABSENT };
    const b = post[name];
    if (!b) {
      rows.push({ name, ok: false, reason: 'no post-deploy reading was taken' });
      continue;
    }
    if (!(b.version > a.version)) {
      rows.push({
        name,
        ok: false,
        reason: `version did not advance (${a.version} -> ${b.version})`,
        pre: a,
        post: b,
      });
      continue;
    }
    if (Number.isFinite(sinceMs) && b.updated_at < sinceMs) {
      rows.push({
        name,
        ok: false,
        reason: `version advanced but updated_at ${b.updated_at} predates this run (${sinceMs})`,
        pre: a,
        post: b,
      });
      continue;
    }
    rows.push({ name, ok: true, from: a.version, to: b.version, at: b.updated_at });
  }
  return { ok: rows.every((r) => r.ok), rows };
}

/*
 * OWED > 0 AND UPLOADED = 0 IS A FAILURE, NOT AN OUTCOME.
 *
 * The 2026-09-19 no-op passed every gate because nothing in the pipeline ever
 * asked this question. A loop that matches no function is not "nothing to
 * do": the list of functions to match was computed from work that is owed, so
 * matching none of them means the loop and the list disagree, and the only
 * safe reading of a disagreement is that the run is broken.
 */
export function uploadAccounting(owedCount, uploadedCount) {
  if (owedCount > 0 && uploadedCount === 0) {
    return {
      ok: false,
      reason: `${owedCount} function(s) owed and 0 uploaded — the deploy loop matched nothing`,
    };
  }
  if (uploadedCount < owedCount) {
    return {
      ok: false,
      reason: `${owedCount} owed but only ${uploadedCount} reached a deploy command — ${owedCount - uploadedCount} named function(s) are in no deploy list`,
    };
  }
  return { ok: true };
}

/* ── CLI ──────────────────────────────────────────────────────────────── */

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop());

if (isMain) {
  const [, , mode, ...rest] = process.argv;
  const { readFileSync } = await import('node:fs');

  if (mode === 'snapshot') {
    const names = rest.filter((a) => !a.startsWith('-'));
    const out = await snapshot(names, {
      projectRef: process.env.SUPABASE_PROJECT_REF,
      token: process.env.SUPABASE_ACCESS_TOKEN,
    });
    console.log(JSON.stringify(out, null, 2));
  } else if (mode === 'verify') {
    const [preFile, postFile] = rest.filter((a) => !a.startsWith('-'));
    const sinceIdx = rest.indexOf('--since');
    const since = sinceIdx >= 0 ? Number(rest[sinceIdx + 1]) : NaN;
    const pre = JSON.parse(readFileSync(preFile, 'utf8'));
    const post = JSON.parse(readFileSync(postFile, 'utf8'));

    /* Deployment evidence: reported beside each function, never the verdict. */
    const evidence = new Map(compareArtifacts(pre, post, since).rows.map((r) => [r.name, r]));

    const opts = {
      projectRef: process.env.SUPABASE_PROJECT_REF,
      token: process.env.SUPABASE_ACCESS_TOKEN,
    };

    /*
     * WHICH FUNCTIONS A DEPLOY LOOP ACTUALLY REACHED.
     *
     * "version did not move" is reported as "deduplicated / already-current",
     * and that phrase covers two different events: the CLI ran and chose to
     * skip, or no loop ever reached the function. They call for opposite
     * fixes -- one is a CLI behaviour to work around, the other is a name
     * missing from a hand-maintained list, which is exactly the run-724
     * failure where an owed function matched neither loop and nobody noticed.
     *
     * Each loop appends "<name> <list>" as it starts an attempt. Absent file
     * means an older workflow produced this run, and the answer is UNKNOWN
     * rather than "not attempted" -- the distinction being the whole point.
     *
     * WHAT IT ANSWERED, run 741, 2026-09-25:
     *
     *   research-agent UNPROVEN - attempted=yes via the nojwt list
     *   state=STALE version=161->161 deployment=deduplicated / already-current
     *   mismatched=market/runtime.ts, adapters/portal/configured.ts,
     *              adapters/portal/family.ts, adapters/portal/sources.ts
     *
     * So it is NOT the run-724 failure. The loop reached the function, the
     * CLI ran, it exited 0, and Supabase created no new version.
     *
     * Every mismatched file lives in src/research-core/ -- OUTSIDE
     * supabase/functions/research-agent/ -- and that function's own index.ts
     * was unchanged. The same shape produced every occurrence of this:
     * match-campaign in 733, investment-research and supply-discovery in 734,
     * supply-discovery in 735 and 739. A function whose entrypoint is
     * untouched and whose imported modules changed is the case that goes
     * stale.
     *
     * It is INTERMITTENT rather than absolute -- run 740 shipped the same
     * kind of change successfully -- so this is a description of the pattern
     * and not yet a mechanism. It is recorded here rather than worked around,
     * because a workaround aimed at the wrong mechanism would hide the right
     * one, and the proof already fails loudly and refuses to advance
     * refs/deployed/edge, so nothing false is claimed while it happens.
     */
    const attemptedPath = process.env.RUNNER_TEMP
      ? `${process.env.RUNNER_TEMP}/attempted.txt` : null;
    let attempted = null;
    if (attemptedPath && existsSync(attemptedPath)) {
      attempted = new Map(
        readFileSync(attemptedPath, 'utf8')
          .split('\n')
          .map((line) => line.trim().split(/\s+/))
          .filter((parts) => parts[0])
          .map((parts) => [parts[0], parts[1] ?? 'unknown']),
      );
    }
    const tally = {
      owed: 0, proven: 0, unproven: 0, exact: 0, stale: 0, incomplete: 0, unavailable: 0,
    };
    const unproven = [];

    for (const name of Object.keys(post)) {
      tally.owed += 1;
      const meta = await fetchArtifact(name, opts);
      const body = meta.absent
        ? { ok: false, reason: 'production has no such function', modules: null }
        : await fetchDeployedModules(name, opts);
      const proof = proveArtifact({
        name,
        expected: expectedClosure(name),
        deployed: { ...meta, modules: body.modules, reason: body.reason },
      });
      const ev = evidence.get(name);
      const moved = ev?.ok ? 'new version uploaded during this run' : 'deduplicated / already-current';

      console.log(`${name}:`);
      console.log(`  version ${pre[name]?.version ?? 0} -> ${proof.version}`);
      console.log(`  deployment: ${moved}`);
      console.log(`  body: ${body.ok ? `retrieved (${body.bytes ?? 0} bytes)` : `NOT retrieved`} — ${body.reason}`);
      /* Path shapes only. How production names a module is the thing that
         has repeatedly cost a run to discover. */
      if (body.examples?.length) console.log(`  module paths: ${body.examples.join(" | ")}`);
      console.log(`  artifact: ${proof.state}`);
      console.log(
        `  modules: ${proof.deployedFileCount} deployed local, ${proof.matched} compared`
        + `, ${proof.expectedFileCount} in the expected closure`,
      );
      /* Names only. Never contents: this log is public build output. */
      if (proof.mismatched.length) console.log(`  mismatched: ${proof.mismatched.slice(0, 8).join(', ')}${proof.mismatched.length > 8 ? ` (+${proof.mismatched.length - 8})` : ''}`);
      if (proof.foreign.length) console.log(`  not in this revision: ${proof.foreign.slice(0, 8).join(', ')}`);
      if (proof.ambiguous.length) console.log(`  ambiguous: ${proof.ambiguous.slice(0, 8).join(', ')}`);
      if (proof.unresolved.length) console.log(`  no original source: ${proof.unresolved.slice(0, 8).join(', ')}`);
      /*
       * Reported, never decisive. A type-only import is followed by
       * importClosure() and erased by the bundler, so a healthy function
       * normally has some of these.
       */
      if (proof.missing.length) console.log(`  in closure but not deployed: ${proof.missing.length} (type-only imports and unused re-exports land here)`);
      console.log(`  ezbr_sha256: ${String(proof.ezbr_sha256).slice(0, 16)} (diagnostic; not reproducible)`);
      console.log(`  result: ${isProven(proof) ? 'PROVEN' : 'UNPROVEN'}  (${proof.reason})`);

      if (isProven(proof)) {
        tally.proven += 1;
        tally.exact += 1;
      } else {
        tally.unproven += 1;
        unproven.push(name);
        /*
         * THE DIAGNOSIS GOES IN THE ANNOTATION, NOT ONLY IN THE LOG.
         *
         * Everything printed above lands in the job log, and a job log is
         * readable by whoever can authenticate to this repository's Actions
         * API. A check-run ANNOTATION is readable more widely, and it is
         * what anybody reaching for the failure sees first -- so a run that
         * failed for a knowable reason should not require log access to
         * learn what that reason was.
         *
         * The names of mismatched modules are path shapes, not contents:
         * this is public build output and the files themselves stay out of
         * it. Path shapes are also the thing that has repeatedly cost a run
         * to rediscover.
         */
        const reached = attempted === null
          ? 'attempted=UNKNOWN (this run predates the attempt log)'
          : attempted.has(name)
            ? `attempted=yes via the ${attempted.get(name)} list`
            : 'attempted=NO — no deploy loop reached this function, so it is '
              + 'owed but missing from both name lists';
        const detail = [
          reached,
          `state=${proof.state}`,
          `version=${pre[name]?.version ?? 0}->${proof.version}`,
          `deployment=${moved}`,
          `modules=${proof.deployedFileCount} deployed/${proof.matched} compared`,
          proof.mismatched.length ? `mismatched=${proof.mismatched.slice(0, 6).join(',')}` : '',
          proof.foreign.length ? `notInRevision=${proof.foreign.slice(0, 4).join(',')}` : '',
          proof.unresolved.length ? `noSource=${proof.unresolved.slice(0, 4).join(',')}` : '',
          `reason=${proof.reason}`,
        ].filter(Boolean).join(' ');
        console.log(`::error::${name} UNPROVEN — ${detail}`);
        if (proof.state === PROOF.STALE) tally.stale += 1;
        else if (proof.state === PROOF.INCOMPLETE) tally.incomplete += 1;
        else tally.unavailable += 1;
      }
    }

    console.log('');
    console.log(
      `owed=${tally.owed} proven=${tally.proven} unproven=${tally.unproven} `
      + `exact=${tally.exact} stale=${tally.stale} `
      + `incomplete=${tally.incomplete} unavailable=${tally.unavailable}`,
    );
    if (unproven.length) {
      console.log(`::error::production does not contain the expected artifact for: ${unproven.join(', ')}`);
      process.exit(1);
    }
    console.log(`all ${tally.owed} owed function(s) contain the expected artifact in production`);
  } else {
    console.error('usage: edgeArtifacts.mjs snapshot <fn...> | verify <pre.json> <post.json> --since <ms>');
    process.exit(2);
  }
}
