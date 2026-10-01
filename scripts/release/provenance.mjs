#!/usr/bin/env node
/*
 * node scripts/release/provenance.mjs
 *
 * Runs first in the deploy workflow's Validate job. Answers one question with
 * evidence: was the exact code about to be deployed already validated?
 *
 *   1. The deployed commit's tree id — the hash of every file's bytes.
 *   2. The pull request GitHub merged as this commit (by merge_commit_sha,
 *      not by branch name).
 *   3. A SUCCESSFUL `PR Checks` run (pull_request event, pr-check.yml) for
 *      that PR's final head commit, read from the Actions API — never from
 *      anything a person could hand-edit.
 *   4. The validation record that run uploaded, listing the tree it validated
 *      and the suites it ran.
 *   5. promotionDecision(): identical tree, suites covering what this change
 *      requires, and no change to the release machinery itself.
 *
 * Writes `path=FAST|VALIDATE` and `base` (the parent commit) to
 * GITHUB_OUTPUT. It never fails the job: every error, missing token, missing
 * record or API surprise answers VALIDATE, which runs the validation this
 * change requires (its component plan, in parallel) before anything deploys.
 */
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promotionDecision } from './classify.mjs';
import { repoContext } from './context.mjs';

export const RECORD_ARTIFACT = 'validation-record';
export const RECORD_FILE = 'validation-record.json';
const PR_WORKFLOW = '.github/workflows/pr-check.yml';

/** Unzip one file from an artifact zip with the system `unzip`. */
function unzipOne(buf, name) {
  const dir = mkdtempSync(join(tmpdir(), 'artifact-'));
  const zip = join(dir, 'a.zip');
  writeFileSync(zip, Buffer.from(buf));
  return execFileSync('unzip', ['-p', zip, name], { encoding: 'utf8' });
}

/**
 * Find the validation evidence for `sha`. Every lookup is injectable so the
 * test suite drives it without a network. Returns { run, record, notes }.
 */
export async function findEvidence({ api, repo, sha, token, fetchImpl = fetch, unzip = unzipOne }) {
  const notes = [];
  const get = async (path, accept = 'application/vnd.github+json') => {
    const res = await fetchImpl(`${api}/repos/${repo}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
    return res;
  };
  const pulls = await (await get(`/commits/${sha}/pulls`)).json();
  const pr = (Array.isArray(pulls) ? pulls : []).find((p) => p.merge_commit_sha === sha && p.merged_at);
  if (!pr) return { run: null, record: null, notes: ['no merged pull request has this commit as its merge commit'] };
  notes.push(`merged pull request #${pr.number}, final head ${String(pr.head?.sha).slice(0, 12)}`);

  const runs = await (await get(`/actions/workflows/pr-check.yml/runs?head_sha=${pr.head.sha}&event=pull_request&per_page=20`)).json();
  const candidates = (runs.workflow_runs ?? [])
    .filter((r) => r.conclusion === 'success' && r.path === PR_WORKFLOW && r.event === 'pull_request')
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  if (!candidates.length) return { run: null, record: null, notes: [...notes, 'no successful PR Checks run exists for that head commit'] };
  const run = candidates[0];
  notes.push(`PR Checks run ${run.id} (attempt ${run.run_attempt}) concluded ${run.conclusion}`);

  const arts = await (await get(`/actions/runs/${run.id}/artifacts`)).json();
  const art = (arts.artifacts ?? []).find((a) => a.name === RECORD_ARTIFACT && !a.expired);
  if (!art) return { run, record: null, notes: [...notes, `run ${run.id} has no ${RECORD_ARTIFACT} artifact`] };
  const zipRes = await get(`/actions/artifacts/${art.id}/zip`, 'application/vnd.github+json');
  const record = JSON.parse(unzip(await zipRes.arrayBuffer(), RECORD_FILE));
  return { run, record, notes };
}

async function main() {
  const out = (k, v) => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
  const summary = (s) => process.env.GITHUB_STEP_SUMMARY && appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${s}\n`);
  const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

  let decision;
  let notes = [];
  let parent = '';
  try {
    const sha = process.env.GITHUB_SHA || git('rev-parse', 'HEAD');
    const mergedTree = git('rev-parse', `${sha}^{tree}`);
    let changed = null;
    try { parent = git('rev-parse', `${sha}^`); changed = git('diff', '--name-only', parent, sha).split('\n').filter(Boolean); } catch { changed = null; }
    const context = repoContext({ base: parent || undefined, head: sha });
    let ev = { run: null, record: null, notes: [] };
    if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPOSITORY) {
      ev.notes.push('no GitHub token or repository in the environment');
    } else {
      ev = await findEvidence({
        api: process.env.GITHUB_API_URL || 'https://api.github.com',
        repo: process.env.GITHUB_REPOSITORY, sha, token: process.env.GITHUB_TOKEN,
      });
    }
    notes = ev.notes;
    decision = promotionDecision({ mergedTree, record: ev.record, run: ev.run, changed, ...context });
  } catch (err) {
    decision = { path: 'VALIDATE', reasons: [`provenance could not be established: ${String(err?.message ?? err).split('\n')[0]}`], required: null };
  }

  console.log(`RELEASE PATH: ${decision.path}`);
  for (const n of notes) console.log(`  · ${n}`);
  for (const r of decision.reasons) console.log(`  → ${r}`);
  out('path', decision.path);
  // The parent the fallback validation plans against. Empty (no parent) makes
  // the fallback plan against nothing it can diff, which plans REPO_FULL.
  out('base', parent);
  out('tier', decision.required?.tier ?? 'REPO_FULL');
  summary([
    `### Release path: ${decision.path}`,
    decision.path === 'FAST'
      ? 'The deployed code is byte-identical to code that already passed PR validation covering everything this change requires. No validation suite is re-run; the deployment prerequisites, the owed deploy and the production proof still run.'
      : `No complete proof of prior validation: the plan for this change (${decision.required?.tier ?? 'REPO_FULL'}) runs now, in parallel, before anything deploys.`,
    '',
    ...notes.map((n) => `- ${n}`),
    ...decision.reasons.map((r) => `- **${r}**`),
    ...(decision.required?.proofs ?? []).map((p) => `- proof owed: ${p}`),
    '',
  ].join('\n'));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
