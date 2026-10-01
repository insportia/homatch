/*
 * GET /api/freshness — is the graph this viewer shows still current?
 *
 * The viewer never has a GitHub credential. Its live oracle is the build id
 * the customer site already publishes: homatch.live/sw.js carries
 * `homatch-<first 8 of VERCEL_GIT_COMMIT_SHA>`, and HOMATCH production
 * deploys every merge to main. Read-only, one public file, 4 s budget: a
 * failure here makes the verdict UNKNOWN, never CURRENT, and nothing in
 * HOMATCH depends on this function.
 *
 *   CURRENT   the live site runs this graph's revision (or an older commit
 *             of its history: its deploy is still catching up)
 *   STALE     the live site runs a commit this graph has never seen
 *   UNKNOWN   the live build id could not be read
 * An UPDATE_FAILED / NO_GRAPH build state always wins over CURRENT.
 */
const status = require('./status.json');

const LIVE = 'https://homatch.live/sw.js';

module.exports = async (req, res) => {
  const out = { checkedAt: new Date().toISOString(), buildState: status.state, revision: status.revision?.sha?.slice(0, 8) ?? null, live: null };
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(LIVE, { signal: ctl.signal, headers: { 'cache-control': 'no-cache' } });
    clearTimeout(timer);
    const m = r.ok ? /homatch-([0-9a-f]{8})\b/.exec(await r.text()) : null;
    out.live = m ? m[1] : null;
  } catch { out.live = null; }
  const rev = out.revision;
  if (!out.live) { out.verdict = 'UNKNOWN'; out.reason = 'live build id unreadable'; }
  else if (out.live === rev) { out.verdict = 'CURRENT'; out.reason = 'live HOMATCH runs this revision'; }
  else if ((status.ancestors ?? []).includes(out.live)) { out.verdict = 'CURRENT'; out.reason = `live HOMATCH (${out.live}) is an older commit of this revision's history — its deploy is catching up`; }
  else { out.verdict = 'STALE'; out.reason = `live HOMATCH runs ${out.live}, a commit this graph has not seen`; }
  if (status.state !== 'CURRENT') { out.verdict = status.state; }
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'private, no-store');
  res.end(JSON.stringify(out));
};
