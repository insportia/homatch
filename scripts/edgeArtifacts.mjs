/*
 * WHAT PRODUCTION IS ACTUALLY RUNNING, ASKED OF PRODUCTION.
 *
 * On 2026-09-19 this pipeline reported "Deploy Edge Functions: success" twice
 * for work it never uploaded. Both times the evidence that it had not was
 * sitting in the Supabase API the whole time: ai-talk-session stayed at
 * version 107, updated_at 17:22:55, while refs/deployed/edge advanced to two
 * later commits and the manifest called production current.
 *
 * A deploy is proven by the artifact or it is not proven. `version` is the
 * proof: the platform increments it on every successful upload, so
 * post > pre is something a no-op loop cannot fake. updated_at is the
 * corroborating timestamp, and is checked second because clock skew between a
 * runner and the API should never be the thing that fails a real deploy.
 *
 *   node scripts/edgeArtifacts.mjs snapshot ai-talk-session comm-agent
 *   node scripts/edgeArtifacts.mjs verify pre.json post.json --since <ms>
 *
 * Needs SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF for `snapshot`.
 * `verify` is pure: two files and a number, no network, so the rule it
 * enforces can be tested without touching production.
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
 * THE RULE, AS A PURE FUNCTION.
 *
 * Per function, not per job. The old check asked one question about one
 * function (ai-talk-session) and only when a cross-job output said to, so a
 * run that uploaded comm-agent and silently dropped ai-talk-session passed —
 * which is exactly what run 8618f244 did. Every name that was owed is now
 * answered for by name.
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
    const result = compareArtifacts(
      JSON.parse(readFileSync(preFile, 'utf8')),
      JSON.parse(readFileSync(postFile, 'utf8')),
      since,
    );
    for (const row of result.rows) {
      console.log(row.ok ? `  proven  ${row.name}  v${row.from} -> v${row.to}` : `  UNPROVEN ${row.name}  ${row.reason}`);
    }
    if (!result.ok) {
      console.log(`::error::the edge deploy reported success but production does not show it: ${result.rows.filter((r) => !r.ok).map((r) => r.name).join(', ')}`);
      process.exit(1);
    }
    console.log(`all ${result.rows.length} owed function(s) proven in production`);
  } else {
    console.error('usage: edgeArtifacts.mjs snapshot <fn...> | verify <pre.json> <post.json> --since <ms>');
    process.exit(2);
  }
}
