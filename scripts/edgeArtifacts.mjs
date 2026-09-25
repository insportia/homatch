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
 * The API hands back the deployed ORIGINAL TypeScript for the whole import
 * closure, so this is a byte comparison against the revision — not a
 * transpiler problem, and not a hash whose semantics we would have to guess.
 *
 *   node scripts/edgeArtifacts.mjs snapshot ai-talk-session comm-agent
 *   node scripts/edgeArtifacts.mjs verify pre.json post.json --since <ms>
 *
 * Both need SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF: `verify` re-reads
 * each owed artifact to compare it, which is one extra GET per function and
 * the reason the rule can be trusted. The rule ITSELF — proveArtifact() — is
 * pure, so every case below is tested without touching production.
 */

import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { importClosure } from './deploy-scope.mjs';

const FUNCTIONS_DIR = 'supabase/functions';

/** A function that does not exist yet. Any real upload beats this. */
export const ABSENT = { version: 0, updated_at: 0, absent: true };

/*
 * WHERE THE DEPLOYED FILES COME FROM.
 *
 * deploy.yml's own comment recorded this endpoint as "metadata only. No
 * files[]", and that was true when it was written. It is not true now. Rather
 * than trust either observation, ask plainly and then ask once more with the
 * files requested explicitly; whichever answers with files wins, and if
 * neither does the proof says UNAVAILABLE and the ref does not move. The
 * route that worked is printed, so the next person reads a fact instead of
 * rediscovering this.
 */
const ARTIFACT_ROUTES = [
  (ref, name) => `https://api.supabase.com/v1/projects/${ref}/functions/${name}`,
  (ref, name) => `https://api.supabase.com/v1/projects/${ref}/functions/${name}?include_files=true`,
];

export async function fetchArtifact(name, { projectRef, token, fetchImpl = fetch, withFiles = true } = {}) {
  let body = null;
  let route = null;
  for (const url of withFiles ? ARTIFACT_ROUTES : ARTIFACT_ROUTES.slice(0, 1)) {
    const res = await fetchImpl(url(projectRef, name), { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 404) return { ...ABSENT };
    if (!res.ok) {
      /* A variant the API does not know is not a reason to fail the run —
         only the plain route has to work. */
      if (body) break;
      if (url === ARTIFACT_ROUTES[0]) throw new Error(`${name}: API answered ${res.status}`);
      break;
    }
    body = await res.json();
    route = url(projectRef, name).includes('include_files') ? 'include_files' : 'plain';
    if (Array.isArray(body.files)) break;
    if (!withFiles) break;
  }
  if (!body) throw new Error(`${name}: no route answered`);
  return {
    version: Number(body.version ?? 0),
    updated_at: Number(body.updated_at ?? 0),
    status: body.status ?? null,
    /*
     * KEPT, NOT DISCARDED.
     *
     * This is a content hash of the deployed bundle: it is stable across
     * repeated reads of one version and differs between versions (measured on
     * ai-talk-session, v107 f2fa457b... twice, v114 c9199b71...). It is
     * DIAGNOSTIC here and not proof, because reproducing it locally would mean
     * reproducing the CLI's eszip-and-brotli byte for byte, which needs the
     * same bundler in the same container. See proveArtifact/PROVEN_HASH for
     * the one place a hash may stand in for the files.
     */
    ezbr_sha256: body.ezbr_sha256 ?? null,
    /*
     * The deployed ORIGINAL TypeScript, when the API supplies it.
     *
     * The comment in deploy.yml records that this endpoint returned metadata
     * with "No files[]", and that the /body endpoint stored type-stripped
     * emitted JavaScript. The first half is no longer true: the same field set
     * now arrives with `files`, carrying the untranspiled source of the whole
     * dependency closure — verified against production on 2026-09-25 for
     * ai-talk-session (21 files), research-agent (69), investment-research
     * (39), verify-synthesis (27), comm-campaign-launch (17), comm-agent (12)
     * and cartesia-access-token (4), every one byte-identical to its revision.
     *
     * null means the API did not give them, which is UNAVAILABLE and therefore
     * unproven. It is never quietly downgraded to a weaker check.
     */
    files: Array.isArray(body.files)
      ? body.files.map((f) => ({ name: String(f.name), content: String(f.content ?? '') }))
      : null,
    route,
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
  /** Every deployed file is byte-identical to this revision. */
  PROVEN_EXACT: 'PROVEN_EXACT',
  /** Files unavailable, but a hash whose semantics we can reproduce matched. */
  PROVEN_HASH: 'PROVEN_HASH',
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

export function proveArtifact({ name, expected, deployed, expectedEzbr = null }) {
  const expectedPaths = Object.keys(expected);
  const entry = `${FUNCTIONS_DIR}/${name}/index.ts`;
  const base = {
    name,
    version: deployed?.version ?? 0,
    updated_at: deployed?.updated_at ?? 0,
    ezbr_sha256: deployed?.ezbr_sha256 ?? null,
    expectedFileCount: expectedPaths.length,
    deployedFileCount: deployed?.files?.length ?? 0,
    missing: [],
    foreign: [],
    mismatched: [],
    ambiguous: [],
  };

  if (!deployed || deployed.absent) {
    return { ...base, state: PROOF.UNAVAILABLE, reason: 'production has no such function' };
  }

  if (!Array.isArray(deployed.files)) {
    /*
     * No files means no correctness evidence. The only thing allowed to stand
     * in for them is a hash we can independently reproduce — which today we
     * cannot, so callers pass no expectedEzbr and this is honestly UNAVAILABLE
     * rather than quietly falling back to "the version moved, near enough".
     */
    if (expectedEzbr && deployed.ezbr_sha256 && expectedEzbr === deployed.ezbr_sha256) {
      return { ...base, state: PROOF.PROVEN_HASH, reason: 'deployed bundle hash equals the expected bundle hash' };
    }
    return {
      ...base,
      state: PROOF.UNAVAILABLE,
      reason: 'the API returned no deployed files and no reproducible bundle hash to stand in for them',
    };
  }

  const matchedExpected = new Set();
  for (const file of deployed.files) {
    const hits = matchDeployedName(file.name, expectedPaths);
    if (hits.length === 0) { base.foreign.push(file.name); continue; }
    if (hits.length > 1) { base.ambiguous.push(file.name); continue; }
    const repoPath = hits[0];
    matchedExpected.add(repoPath);
    if (canonical(expected[repoPath]) !== canonical(file.content)) base.mismatched.push(repoPath);
  }
  base.missing = expectedPaths.filter((p) => !matchedExpected.has(p));

  if (base.foreign.length || base.ambiguous.length) {
    return {
      ...base,
      state: PROOF.INCOMPLETE,
      reason: base.foreign.length
        ? `production runs ${base.foreign.length} file(s) this revision does not have`
        : `${base.ambiguous.length} deployed name(s) matched more than one repository path`,
    };
  }
  if (base.mismatched.length) {
    return { ...base, state: PROOF.STALE, reason: `${base.mismatched.length} deployed file(s) differ from this revision` };
  }
  if (!matchedExpected.has(entry)) {
    return { ...base, state: PROOF.INCOMPLETE, reason: 'the deployment does not contain the function entrypoint' };
  }
  return {
    ...base,
    state: PROOF.PROVEN_EXACT,
    reason: `${deployed.files.length} deployed file(s) identical to this revision`,
  };
}

/** Is this proof good enough to let the ref move? */
export const isProven = (proof) => proof.state === PROOF.PROVEN_EXACT || proof.state === PROOF.PROVEN_HASH;

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
    const tally = {
      owed: 0, proven: 0, unproven: 0, exact: 0, hashProven: 0, stale: 0, incomplete: 0, unavailable: 0,
    };
    const unproven = [];
    let routeSeen = null;

    for (const name of Object.keys(post)) {
      tally.owed += 1;
      const deployed = await fetchArtifact(name, opts);
      routeSeen ??= deployed.route;
      const proof = proveArtifact({ name, expected: expectedClosure(name), deployed });
      const ev = evidence.get(name);
      const moved = ev?.ok ? 'new version uploaded during this run' : 'deduplicated / already-current';

      console.log(`${name}:`);
      console.log(`  version ${pre[name]?.version ?? 0} -> ${proof.version}`);
      console.log(`  deployment: ${moved}`);
      console.log(`  artifact: ${proof.state}`);
      console.log(`  files: ${proof.deployedFileCount}/${proof.expectedFileCount} deployed/expected-closure`);
      /* Names only. Never contents: this log is public build output. */
      if (proof.mismatched.length) console.log(`  mismatched: ${proof.mismatched.slice(0, 8).join(', ')}${proof.mismatched.length > 8 ? ` (+${proof.mismatched.length - 8})` : ''}`);
      if (proof.foreign.length) console.log(`  not in this revision: ${proof.foreign.slice(0, 8).join(', ')}`);
      if (proof.ambiguous.length) console.log(`  ambiguous: ${proof.ambiguous.slice(0, 8).join(', ')}`);
      console.log(`  result: ${isProven(proof) ? 'PROVEN' : 'UNPROVEN'}  (${proof.reason})`);

      if (isProven(proof)) {
        tally.proven += 1;
        if (proof.state === PROOF.PROVEN_EXACT) tally.exact += 1; else tally.hashProven += 1;
      } else {
        tally.unproven += 1;
        unproven.push(name);
        if (proof.state === PROOF.STALE) tally.stale += 1;
        else if (proof.state === PROOF.INCOMPLETE) tally.incomplete += 1;
        else tally.unavailable += 1;
      }
    }

    console.log('');
    console.log(`artifact source: ${routeSeen ?? 'none'}`);
    console.log(
      `owed=${tally.owed} proven=${tally.proven} unproven=${tally.unproven} `
      + `exact=${tally.exact} hash=${tally.hashProven} stale=${tally.stale} `
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
