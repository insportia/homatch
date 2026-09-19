/*
 * THE ARTIFACT IS THE AUTHORITY, AND A VERSION NUMBER IS ONLY EVIDENCE.
 *
 * The first version of this guard said: PROVEN if and only if the version
 * advanced. That is right for a bundle that changed and WRONG for one that
 * did not, and on 2026-09-19 it failed a run in which nothing was wrong.
 *
 * `supabase functions deploy` deduplicates. When the bundle it builds from
 * the current checkout is identical to what production already runs it
 * prints:
 *
 *   No change found in Function: comm-agent
 *   Deployed Functions on project ptxajsjhobhvsfhmutjn: comm-agent
 *
 * ...skips the upload, and exits 0. Four functions did that, the version
 * counter correctly stayed put, and the guard called it an unproven deploy.
 * Chasing those version numbers would have meant re-uploading unchanged code
 * purely to move an integer -- churn that makes the history LESS truthful.
 *
 * But "No change found" is the CLI reporting on its own work, and a tool's
 * self-report is exactly what this whole repair exists to stop trusting. So
 * it is never proof by itself. The artifact is fetched back out of production
 * and its stored source compared, file by file, against the revision being
 * deployed. That is strictly stronger than a version bump: a bump says
 * "something was uploaded", equivalence says "what is running is this".
 *
 * Two legitimate outcomes, one authority:
 *
 *   UPLOADED        the bundle changed, the version advanced, and the
 *                   artifact now matches the expected revision.
 *   ALREADY_CURRENT  the bundle was identical, nothing was uploaded, and the
 *                   artifact already matches the expected revision.
 *
 * Everything else fails, including the case this file exists to keep failing:
 * the CLI exits 0 and the deployed source is NOT the expected source.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const sha = (s) => createHash('sha256').update(s).digest('hex');

/** Windows path separator, spelled so no shell or patch script can eat it. */
const SEP = String.fromCharCode(92);

/**
 * Line endings only.
 *
 * The repository is checked out with CRLF on Windows and LF on the runner,
 * and the bundler stores what it was given. That difference is not a source
 * difference. NOTHING else is normalised: whitespace, comments and ordering
 * are all real content, and a comparison that forgave them could not tell a
 * changed function from an unchanged one -- which is the only question here.
 */
export const normalise = (text) => text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

/**
 * Pair an expected repository path with the deployed entry that carries it.
 *
 * The deployed names are not repo-relative and their prefix is not even
 * stable between functions: comm-agent's entry point is stored as
 * `homatch/supabase/functions/comm-agent/index.ts` while ai-talk-session's is
 * `homatch/functions/ai-talk-session/index.ts`. Both are the same file.
 *
 * So the match is on a SUFFIX of the expected repo path, and it must be
 * unique. Matching on a basename would let `_shared/comm/llm.ts` be proven by
 * some other `llm.ts`; requiring exactly one suffix match cannot.
 */
export function locate(expectedPath, deployedNames) {
  const candidates = [expectedPath, expectedPath.replace(/^supabase\//, '')];
  const hits = deployedNames.filter((n) => candidates.some((c) => n === c || n.endsWith(`/${c}`)));
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Does production run this exact revision of this function?
 *
 * Driven from the EXPECTED side, deliberately. Walking the deployed files and
 * checking each against the repo would pass a bundle that simply left a file
 * out; every file the function imports must be present and identical.
 */
export function compareSources(expected, deployed) {
  const deployedNames = Object.keys(deployed);
  const rows = [];
  for (const path of Object.keys(expected).sort()) {
    const found = locate(path, deployedNames);
    if (!found) {
      rows.push({ path, ok: false, reason: 'not present in the deployed artifact' });
      continue;
    }
    const want = normalise(expected[path]);
    const got = normalise(deployed[found]);
    rows.push(want === got
      ? { path, ok: true, as: found, sha: sha(want) }
      : { path, ok: false, as: found, reason: 'deployed content differs from this revision' });
  }
  const equivalent = rows.length > 0 && rows.every((r) => r.ok);
  /*
   * One number for the whole function, over paths AND contents, so a report
   * can be compared between runs without re-listing every file. Built from
   * the expected paths so it names what was checked, not what was found.
   */
  const digest = sha(rows.map((r) => `${r.path}\u0000${r.sha ?? 'MISMATCH'}`).join('\n'));
  return { equivalent, digest, files: rows.length, rows };
}

/**
 * The verdict for one owed function.
 *
 * `sinceMs` still applies, but only where it means anything. If the version
 * advanced, this run should be the reason, and an advance that predates the
 * run is somebody else's upload landing in the window. If the version did not
 * advance there is no upload to date, and equivalence has already answered
 * the only question worth asking.
 */
export function evaluate({ name, pre, post, equivalence, sinceMs }) {
  if (!equivalence || equivalence.checked === false) {
    return { name, ok: false, mode: 'UNVERIFIABLE', reason: equivalence?.reason ?? 'the deployed artifact could not be retrieved' };
  }
  const advanced = post.version > pre.version;
  if (!equivalence.equivalent) {
    const bad = equivalence.rows.filter((r) => !r.ok).slice(0, 4).map((r) => `${r.path} (${r.reason})`);
    return {
      name,
      ok: false,
      mode: advanced ? 'UPLOADED_WRONG_SOURCE' : 'STALE',
      reason: advanced
        ? `version advanced ${pre.version} -> ${post.version} but the deployed source is not this revision: ${bad.join('; ')}`
        : `nothing was uploaded and production is not running this revision: ${bad.join('; ')}`,
      digest: equivalence.digest,
    };
  }
  if (advanced && Number.isFinite(sinceMs) && post.updated_at < sinceMs) {
    return {
      name,
      ok: false,
      mode: 'FOREIGN_UPLOAD',
      reason: `version advanced ${pre.version} -> ${post.version} but updated_at ${post.updated_at} predates this run (${sinceMs})`,
      digest: equivalence.digest,
    };
  }
  return {
    name,
    ok: true,
    mode: advanced ? 'UPLOADED' : 'ALREADY_CURRENT',
    from: pre.version,
    to: post.version,
    files: equivalence.files,
    digest: equivalence.digest,
  };
}

/** Every owed function, or the run does not pass. */
export function evaluateAll(entries) {
  const rows = entries.map(evaluate);
  return { ok: rows.length > 0 && rows.every((r) => r.ok), rows };
}

/* ── Reading the two sides ───────────────────────────────────────────────── */

/*
 * THE FILES THAT ACTUALLY REACH PRODUCTION.
 *
 * Not the same set as the deploy-scope closure, and the difference is not
 * cosmetic. `import type { TrustTier } from './generated/vocabulary.ts'`
 * disappears at build time -- there is no runtime module -- so vocabulary.ts
 * is in comm-campaign-launch's import graph and is NOT in its artifact.
 * Three of the five functions owed on 2026-09-19 had exactly one such file,
 * and demanding it be present would have failed three correct deployments.
 *
 * Scope deliberately keeps using the wider closure: redeploying because a
 * type changed is harmless, and missing a deploy is not. Equivalence needs
 * the narrower one, because it is comparing against what was emitted.
 */
const TYPE_ONLY = /(?:import|export)\s+type\s[^'"]*?['"](\.[^'"]+)['"]/g;
const SPECIFIER = /(?:from|import)\s*['"](\.[^'"]+)['"]/g;

export function runtimeClosure(entry, root = process.cwd()) {
  const seen = new Set();
  const stack = [resolve(root, entry)];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    let text;
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    // Erase the type-only imports, then read what is left. A specifier that
    // appears both ways -- type-only here, by value there -- survives on the
    // strength of the value import, which is the correct reading.
    const emitted = text.replace(TYPE_ONLY, '');
    for (const m of emitted.matchAll(SPECIFIER)) {
      const target = resolve(dirname(file), m[1]);
      for (const c of [target, `${target}.ts`, join(target, 'index.ts')]) {
        if (existsSync(c) && !seen.has(c)) { stack.push(c); break; }
      }
    }
  }
  return new Set([...seen].map((f) => relative(root, f).split(SEP).join('/')));
}

/** The files a function ships, at the revision in the working tree. */
export function expectedSources(fn, root = process.cwd()) {
  const out = {};
  for (const path of runtimeClosure(`supabase/functions/${fn}/index.ts`, root)) {
    try { out[path] = readFileSync(join(root, path), 'utf8'); } catch { /* walked but unreadable */ }
  }
  return out;
}

/** Whatever `supabase functions download` wrote, flattened to path -> content. */
export function readDownloaded(dir) {
  const out = {};
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      const key = relative(dir, full).split('\\').join('/');
      try { out[key] = readFileSync(full, 'utf8'); } catch { /* binary, not source */ }
    }
  };
  walk(dir);
  return out;
}
