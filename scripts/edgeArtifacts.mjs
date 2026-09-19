/*
 * WHAT PRODUCTION IS ACTUALLY RUNNING, ASKED OF PRODUCTION.
 *
 * On 2026-09-19 this pipeline reported "Deploy Edge Functions: success" twice
 * for work it never uploaded. Both times the evidence that it had not was
 * sitting in the Supabase API the whole time: ai-talk-session stayed at
 * version 107, updated_at 17:22:55, while refs/deployed/edge advanced to two
 * later commits and the manifest called production current.
 *
 * A deploy is proven by the artifact or it is not proven. This file reads the
 * version and updated_at that production reports; edgeEquivalence.mjs decides
 * what they mean, because the counter alone turned out to be the wrong rule.
 * It said PROVEN if and only if the version advanced, and run #676 failed with
 * nothing wrong: four functions were already identical to the revision being
 * deployed, so the CLI skipped their uploads and the counter correctly stood
 * still. A bump says something was uploaded; equivalence says what is running
 * is this, which is the question actually being asked.
 *
 *   node scripts/edgeArtifacts.mjs snapshot ai-talk-session comm-agent
 *   node scripts/edgeArtifacts.mjs verify pre.json post.json --since <ms> --downloads <dir>
 *
 * Needs SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF. The rules themselves
 * are pure functions in edgeEquivalence.mjs, so every one of them is tested
 * without touching production.
 */

/** A function that does not exist yet. Any real upload beats this. */
export const ABSENT = { version: 0, updated_at: 0, absent: true };

export async function fetchArtifact(name, { projectRef, token, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(
    `https://api.supabase.com/v1/projects/${projectRef}/functions/${name}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (res.status === 404) return { ...ABSENT };
  if (!res.ok) throw new Error(`${name}: API answered ${res.status}`);
  const body = await res.json();
  return {
    version: Number(body.version ?? 0),
    updated_at: Number(body.updated_at ?? 0),
    status: body.status ?? null,
  };
}

export async function snapshot(names, opts) {
  const out = {};
  for (const name of names) out[name] = await fetchArtifact(name, opts);
  return out;
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
    /*
     * THE ARTIFACT DECIDES, PER FUNCTION, BY NAME.
     *
     * pre/post versions are read back for evidence, but the verdict comes
     * from comparing what production stores against the revision in this
     * checkout. A function whose bundle did not change needs no upload and
     * must still be proven; a function whose version moved must still be the
     * right source. Both are the same question asked of the artifact.
     */
    const [preFile, postFile] = rest.filter((a) => !a.startsWith('-'));
    const arg = (flag) => { const i = rest.indexOf(flag); return i < 0 ? null : rest[i + 1]; };
    const since = Number(arg('--since'));
    const downloads = arg('--downloads');
    const { evaluateAll, compareSources, expectedSources, readDownloaded } =
      await import('./edgeEquivalence.mjs');
    const { existsSync } = await import('node:fs');

    const pre = JSON.parse(readFileSync(preFile, 'utf8'));
    const post = JSON.parse(readFileSync(postFile, 'utf8'));
    const found = {};
    const entries = Object.keys(pre).map((name) => {
      const dir = downloads ? `${downloads}/${name}` : null;
      let equivalence;
      // An artifact nobody could read is UNVERIFIABLE, never "fine". The
      // download writes its own directory layout and an empty one means the
      // retrieval failed, not that the function has no files.
      const files = dir && existsSync(dir) ? readDownloaded(dir) : null;
      if (!files || Object.keys(files).length === 0) {
        equivalence = { checked: false, reason: `nothing was downloaded to ${dir}` };
      } else {
        found[name] = Object.keys(files);
        equivalence = { checked: true, ...compareSources(expectedSources(name), files) };
      }
      return { name, pre: pre[name] ?? { ...ABSENT }, post: post[name] ?? { ...ABSENT }, equivalence, sinceMs: since };
    });

    const result = evaluateAll(entries);
    for (const row of result.rows) {
      if (row.ok) {
        const moved = row.mode === 'UPLOADED' ? `v${row.from} -> v${row.to}` : `v${row.to} unchanged`;
        console.log(`  proven   ${row.name}  ${row.mode}  ${moved}  ${row.files} file(s)  ${row.digest.slice(0, 12)}`);
      } else {
        console.log(`  UNPROVEN ${row.name}  ${row.mode}  ${row.reason}`);
      }
    }
    if (!result.ok) {
      // Say what WAS found, so a layout surprise is diagnosable from the log
      // rather than from a second failed run.
      for (const row of result.rows.filter((r) => !r.ok)) {
        const paths = found[row.name];
        if (paths) console.log(`  ${row.name} downloaded ${paths.length} file(s): ${paths.slice(0, 12).join(', ')}`);
      }
      console.log(`::error::the deployed artifact is not this revision: ${result.rows.filter((r) => !r.ok).map((r) => r.name).join(', ')}`);
      process.exit(1);
    }
    console.log(`all ${result.rows.length} owed function(s) proven equivalent to this revision`);
  } else {
    console.error('usage: edgeArtifacts.mjs snapshot <fn...> | verify <pre.json> <post.json> --since <ms> --downloads <dir>');
    process.exit(2);
  }
}
