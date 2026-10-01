/*
 * HOMATCH FAST RELEASE — the rules that decide how much validation a change
 * gets, and when merged code may be promoted on validation it already passed.
 *
 * What these tests guard is the asymmetry: being wrong toward FULL costs
 * minutes, being wrong toward FAST ships unvalidated code. So every FAST is
 * earned by a complete positive proof, and every doubt is FULL.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  SUITES, ALWAYS, classifyChanges, promotionDecision, mobileShards, RECORD_VERSION, GATEKEEPER,
} from '../../scripts/release/classify.mjs';
import { findEvidence, RECORD_ARTIFACT, RECORD_FILE } from '../../scripts/release/provenance.mjs';

const ROOT = process.cwd();
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const PR = read('.github/workflows/pr-check.yml');
const DEPLOY = read('.github/workflows/deploy.yml');
const PKG = JSON.parse(read('package.json'));

/* ── 1. Classification: TARGETED only where the blast radius is known ─── */

test('an isolated Meta Ads change runs static, unit, mobile and a11y — not the Developer or Studio journeys', () => {
  const r = classifyChanges(['src/components/metaAds/campaign/AssistantPanel.tsx', 'src/lib/metaAds/assistant.ts', 'src/pages/outreach/MetaAdsCampaignPage.tsx']);
  assert.equal(r.tier, 'TARGETED');
  assert.deepEqual(r.suites, ['static', 'unit', 'mobile', 'a11y']);
});

test('an edge-function-only change runs no browser suite; edge syntax and the units still run', () => {
  const r = classifyChanges(['supabase/functions/meta-ads-api/engine.ts', 'supabase/functions/meta-ads-api/__tests__/engine.test.mjs']);
  assert.equal(r.tier, 'TARGETED');
  assert.deepEqual(r.suites, ['static', 'unit']);
});

test('a translation-only change runs the i18n gates (in static) plus the rendering suites', () => {
  const r = classifyChanges(['src/i18n/translations.ts', 'scripts/meta-master-campaign-i18n-data.mjs']);
  assert.equal(r.tier, 'TARGETED');
  assert.deepEqual(r.suites, ['static', 'unit', 'mobile', 'a11y']);
});

test('a Developer / Design Studio change runs its own journeys', () => {
  const r = classifyChanges(['src/components/developer/ProjectCard.tsx']);
  assert.equal(r.tier, 'TARGETED');
  assert.deepEqual(r.suites, ['static', 'unit', 'mobile', 'developer', 'onboarding', 'floorplan']);
});

test('documentation only: the always-on suites and nothing else', () => {
  assert.deepEqual(classifyChanges(['docs/claude/PROJECT_STATE.md', 'README.md']).suites, ALWAYS);
});

test('dependencies, CI, build system, shared core and security escalate to FULL', () => {
  const full = [
    'package.json', 'pnpm-lock.yaml', '.github/workflows/deploy.yml', 'vite.config.ts', 'tsconfig.app.json',
    'scripts/run-tests.mjs', 'scripts/release/classify.mjs', 'scripts/deploy-scope.mjs', 'src/App.tsx',
    'src/contexts/LanguageContext.tsx', 'src/components/ui/button.tsx', 'src/i18n/bundles.ts',
    'supabase/functions/_shared/metaAds.ts', 'supabase/functions/meta-oauth/index.ts', 'official-worker/src/index.ts',
  ];
  for (const f of full) assert.equal(classifyChanges([f]).tier, 'FULL', f);
  // One FULL path makes the whole change FULL, whatever else it contains.
  const mixed = classifyChanges(['docs/x.md', 'pnpm-lock.yaml']);
  assert.equal(mixed.tier, 'FULL');
  assert.deepEqual(mixed.suites, SUITES);
});

test('a path no rule can place is FULL, and so is an empty change set', () => {
  assert.equal(classifyChanges(['src/components/somethingNew/Widget.tsx']).tier, 'FULL');
  assert.equal(classifyChanges(['weird/location.txt']).tier, 'FULL');
  assert.equal(classifyChanges([]).tier, 'FULL');
});

test('a migration is judged by what it does: access control is FULL, a plain table is not, unreadable is FULL', () => {
  const plain = 'create table if not exists public.t (id int primary key);';
  const policy = 'alter table public.t enable row level security;\ncreate policy p on public.t for select using (auth.uid() = owner);';
  const grant = 'grant select on public.t to authenticated;';
  const f = 'supabase/migrations/20990101000000_x.sql';
  assert.deepEqual(classifyChanges([f], { read: () => plain }).suites, ALWAYS);
  assert.equal(classifyChanges([f], { read: () => policy }).tier, 'FULL');
  assert.equal(classifyChanges([f], { read: () => grant }).tier, 'FULL');
  assert.equal(classifyChanges([f]).tier, 'FULL', 'no reader → cannot prove it is harmless');
  assert.equal(classifyChanges([f], { read: () => { throw new Error('gone'); } }).tier, 'FULL');
});

/* ── 2. Promotion: FAST only on a complete positive proof ─────────────── */

const TREE = 'a'.repeat(40);
const goodRun = { conclusion: 'success', event: 'pull_request', path: '.github/workflows/pr-check.yml' };
const goodRecord = { version: RECORD_VERSION, tier: 'FULL', suites: [...SUITES], validatedTree: TREE, runId: '42' };
const metaChange = ['src/components/metaAds/campaign/AssistantPanel.tsx'];

test('identical tree + successful PR run + covering suites → FAST', () => {
  const d = promotionDecision({ mergedTree: TREE, record: goodRecord, run: goodRun, changed: metaChange });
  assert.equal(d.path, 'FAST');
  assert.match(d.reasons.join(' '), /byte-identical/);
});

test('a targeted record promotes a change it covers, and not one it does not', () => {
  const targeted = { ...goodRecord, tier: 'TARGETED', suites: ['static', 'unit', 'mobile', 'a11y'] };
  assert.equal(promotionDecision({ mergedTree: TREE, record: targeted, run: goodRun, changed: metaChange }).path, 'FAST');
  const dev = promotionDecision({ mergedTree: TREE, record: targeted, run: goodRun, changed: ['src/components/developer/X.tsx'] });
  assert.equal(dev.path, 'FULL');
  assert.match(dev.reasons[0], /did not cover: developer, onboarding, floorplan/);
});

test('every missing or contrary piece of evidence is FULL', () => {
  const base = { mergedTree: TREE, record: goodRecord, run: goodRun, changed: metaChange };
  const cases = {
    'different tree (main moved / merge changed code)': { ...base, mergedTree: 'b'.repeat(40) },
    'no run': { ...base, run: null },
    'failed run': { ...base, run: { ...goodRun, conclusion: 'failure' } },
    'run from push, not a PR': { ...base, run: { ...goodRun, event: 'push' } },
    'run from another workflow': { ...base, run: { ...goodRun, path: '.github/workflows/other.yml' } },
    'no record': { ...base, record: null },
    'unknown record version': { ...base, record: { ...goodRecord, version: 99 } },
    'unknown tree id': { ...base, mergedTree: '' },
    'release machinery changed': { ...base, changed: ['.github/workflows/deploy.yml'] },
    'classifier changed': { ...base, changed: ['scripts/release/classify.mjs'] },
  };
  for (const [name, input] of Object.entries(cases)) {
    assert.equal(promotionDecision(input).path, 'FULL', name);
  }
  assert.ok(GATEKEEPER.some((re) => re.test('.github/workflows/pr-check.yml')));
});

/* ── 3. Evidence lookup: from the Actions API, by merge commit, never by branch ── */

function fakeApi({ pulls, runs, artifacts, record }) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const body = url.includes('/pulls') ? pulls
      : url.includes('/actions/workflows/pr-check.yml/runs') ? { workflow_runs: runs }
        : url.includes('/artifacts') && !url.endsWith('/zip') ? { artifacts }
          : null;
    return { ok: true, status: 200, json: async () => body, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(record)).buffer };
  };
  return { fetchImpl, calls, unzip: (buf, name) => { assert.equal(name, RECORD_FILE); return new TextDecoder().decode(buf); } };
}

test('evidence: the merged PR, its newest successful pr-check run, and that run\'s record', async () => {
  const sha = 'c'.repeat(40);
  const api = fakeApi({
    pulls: [{ number: 25, merge_commit_sha: sha, merged_at: '2026-09-30T19:56:00Z', head: { sha: 'd'.repeat(40) } }],
    runs: [
      { id: 1, conclusion: 'failure', path: '.github/workflows/pr-check.yml', event: 'pull_request', updated_at: '2026-09-30T19:40:00Z' },
      { id: 2, conclusion: 'success', path: '.github/workflows/pr-check.yml', event: 'pull_request', updated_at: '2026-09-30T19:55:00Z', run_attempt: 1 },
    ],
    artifacts: [{ id: 7, name: RECORD_ARTIFACT, expired: false }],
    record: goodRecord,
  });
  const ev = await findEvidence({ api: 'https://api.test', repo: 'o/r', sha, token: 't', fetchImpl: api.fetchImpl, unzip: api.unzip });
  assert.equal(ev.run.id, 2, 'the failed run is never the evidence');
  assert.deepEqual(ev.record, goodRecord);
  assert.ok(api.calls.some((u) => u.includes(`head_sha=${'d'.repeat(40)}`)), 'runs are looked up by the PR head commit');
});

test('evidence: a commit that is not a PR merge commit, or a run without a record, yields nothing to promote', async () => {
  const sha = 'c'.repeat(40);
  const notMerge = fakeApi({ pulls: [{ number: 9, merge_commit_sha: 'e'.repeat(40), merged_at: 'x', head: { sha: 'f'.repeat(40) } }], runs: [], artifacts: [], record: null });
  const a = await findEvidence({ api: 'x', repo: 'o/r', sha, token: 't', fetchImpl: notMerge.fetchImpl, unzip: notMerge.unzip });
  assert.equal(a.run, null);
  assert.equal(promotionDecision({ mergedTree: TREE, record: a.record, run: a.run, changed: metaChange }).path, 'FULL');

  const noRecord = fakeApi({
    pulls: [{ number: 9, merge_commit_sha: sha, merged_at: 'x', head: { sha: 'f'.repeat(40) } }],
    runs: [{ id: 3, conclusion: 'success', path: '.github/workflows/pr-check.yml', event: 'pull_request', updated_at: 'x' }],
    artifacts: [{ id: 8, name: 'something-else', expired: false }], record: null,
  });
  const b = await findEvidence({ api: 'x', repo: 'o/r', sha, token: 't', fetchImpl: noRecord.fetchImpl, unzip: noRecord.unzip });
  assert.equal(b.record, null);
  assert.equal(promotionDecision({ mergedTree: TREE, record: b.record, run: b.run, changed: metaChange }).path, 'FULL');
});

/* ── 4. The CLIs against a real git history ───────────────────────────── */

function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'release-path-'));
  const g = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, encoding: 'utf8' }).trim();
  g('init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'README.md'), 'x\n');
  g('add', '.'); g('commit', '-qm', 'base');
  g('checkout', '-qb', 'feature');
  for (const [p, body] of Object.entries(files)) { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), body); }
  g('add', '.'); g('commit', '-qm', 'change');
  return { dir, g };
}
const cli = (dir, script, ...args) => JSON.parse(execFileSync(process.execPath, [resolve(ROOT, script), ...args], { cwd: dir, encoding: 'utf8' }));

test('plan.mjs plans from the real diff: docs → always-on only; a lockfile → FULL', () => {
  const docs = repo({ 'docs/a.md': 'hi\n' });
  assert.deepEqual(cli(docs.dir, 'scripts/release/plan.mjs', '--base', 'main', '--json').suites, ALWAYS);
  const lock = repo({ 'pnpm-lock.yaml': 'lockfileVersion: 9\n' });
  assert.equal(cli(lock.dir, 'scripts/release/plan.mjs', '--base', 'main', '--json').tier, 'FULL');
  const migration = repo({ 'supabase/migrations/20990101000000_x.sql': 'grant select on t to anon;\n' });
  assert.equal(cli(migration.dir, 'scripts/release/plan.mjs', '--base', 'main', '--json').tier, 'FULL', 'migration content is read from the commit');
});

test('plan.mjs with a base it cannot find plans FULL', () => {
  const r = repo({ 'docs/a.md': 'hi\n' });
  assert.equal(cli(r.dir, 'scripts/release/plan.mjs', '--base', 'no-such-ref', '--json').tier, 'FULL');
});

test('record.mjs records the tree — the content identity a squash merge preserves', () => {
  const r = repo({ 'docs/a.md': 'hi\n' });
  execFileSync(process.execPath, [resolve(ROOT, 'scripts/release/record.mjs'), 'rec.json', '--tier', 'TARGETED', '--suites', 'static unit'], { cwd: r.dir });
  const rec = JSON.parse(readFileSync(join(r.dir, 'rec.json'), 'utf8'));
  assert.equal(rec.version, RECORD_VERSION);
  assert.equal(rec.validatedTree, r.g('rev-parse', 'HEAD^{tree}'));
  // A squash of the same content onto main has a new commit id and the same tree.
  r.g('checkout', '-q', 'main'); r.g('merge', '-q', '--squash', 'feature'); r.g('commit', '-qm', 'squash');
  assert.notEqual(r.g('rev-parse', 'HEAD'), rec.validatedCommit);
  assert.equal(r.g('rev-parse', 'HEAD^{tree}'), rec.validatedTree);
  assert.equal(promotionDecision({ mergedTree: r.g('rev-parse', 'HEAD^{tree}'), record: rec, run: goodRun, changed: ['docs/a.md'] }).path, 'FAST');
});

/* ── 5. The workflows do what the policy says ─────────────────────────── */

test('mobile shards are exactly test:mobile, no file lost or duplicated', () => {
  const all = PKG.scripts['test:mobile'].match(/tests\/mobile\/[\w.-]+\.test\.mjs/g);
  const shards = mobileShards(PKG.scripts['test:mobile'], 2);
  assert.ok(shards.every((s) => s.length > 0));
  assert.deepEqual([...shards.flat()].sort(), [...all].sort());
  assert.match(PR, /node scripts\/release\/shard\.mjs \$\{\{ matrix\.shard \}\}\/2/);
});

/** Each suite and the command(s) that implement it, in both workflows. */
const SUITE_COMMANDS = {
  static: ['pnpm exec tsc -p tsconfig.check.json --noEmit', 'pnpm run lint', 'pnpm run check:edge', 'node scripts/migration-baseline.mjs'],
  unit: ['pnpm test'],
  developer: ['pnpm run test:developer'],
  onboarding: ['pnpm run test:onboarding'],
  floorplan: ['pnpm run test:floorplan'],
  studio: ['pnpm run test:studio'],
  push: ['pnpm run test:push'],
  a11y: ['pnpm run test:a11y'],
};

test('the PR full gate and the deploy full gate are the same suites', () => {
  for (const [suite, cmds] of Object.entries(SUITE_COMMANDS)) {
    for (const c of cmds) {
      assert.ok(PR.includes(`run: ${c}`), `pr-check.yml lacks ${suite}: ${c}`);
      assert.ok(DEPLOY.includes(`run: ${c}`), `deploy.yml lacks ${suite}: ${c}`);
    }
  }
  assert.ok(DEPLOY.includes('run: pnpm run test:mobile'), 'deploy runs the canonical mobile command');
  // The rules the lint step enforces need their binary in both.
  assert.match(PR, /npm install -g @ast-grep\/cli/);
  assert.match(DEPLOY, /npm install -g @ast-grep\/cli/);
  // The old no-op type-check is gone from the PR gate.
  assert.doesNotMatch(PR, /run: pnpm exec tsc --noEmit\s*$/m);
  for (const s of SUITES) assert.ok(s === 'mobile' || SUITE_COMMANDS[s], `suite ${s} has no command mapping`);
});

test('"Validate PR" is the aggregate check, and the record is uploaded only after every planned suite passed', () => {
  const v = PR.slice(PR.indexOf('\n  validate:\n'));
  assert.match(v, /name: Validate PR/);
  assert.match(v, /needs: \[plan, static, unit, mobile, journeys, studio\]/);
  assert.match(v, /if: always\(\)/);
  const check = v.indexOf('Every planned suite passed');
  const rec = v.indexOf('scripts/release/record.mjs');
  const up = v.indexOf('actions/upload-artifact');
  assert.ok(check > 0 && rec > check && up > rec, 'check → record → upload, in that order');
  assert.match(v, new RegExp(`name: ${RECORD_ARTIFACT}`));
  assert.match(v, /if-no-files-found: error/);
  // A planned suite that did not succeed fails the aggregate.
  assert.match(v, /was planned and is/);
});

test('post-merge: only the repository suites are conditional; deployment checks and the proof are not', () => {
  const start = DEPLOY.indexOf('\n  validate:\n');
  const validate = DEPLOY.slice(start, DEPLOY.indexOf('\n  # ── Job 2', start));
  assert.match(validate, /- name: Release path \(validation provenance\)\n\s+id: provenance\n\s+continue-on-error: true/);
  assert.match(validate, /actions: read/);
  assert.match(validate, /fetch-depth: 2/);
  const steps = validate.split(/\n {6}- /).slice(1);
  const gated = steps.filter((s) => s.includes("if: steps.provenance.outputs.path != 'FAST'")).map((s) => s.match(/name: (.+)/)?.[1]);
  assert.deepEqual(gated.sort(), [
    'Accessibility and performance audit', 'Build mobile harness', 'Developer acceptance (real browser)',
    'Developer onboarding (real browser)', 'Floor plan pipeline (real browser)', 'Install ast-grep', 'Lint',
    'Mobile regression (real viewports)', 'Site Studio regression (real browser)', 'Tests', 'Type-check',
    'Web push handlers (real service worker)',
  ].sort());
  for (const always of ['Edge function syntax', 'Migration history', 'Install dependencies']) {
    const s = steps.find((x) => x.includes(`name: ${always}`));
    assert.ok(s && !/\n\s+if:/.test(s), `${always} must run on every path`);
  }
  // Gated on != FAST: an absent or failed decision runs everything.
  assert.doesNotMatch(validate, /== 'FULL'/);
  // The decision never leaves the job that made it.
  const rest = DEPLOY.slice(0, start) + DEPLOY.slice(start + validate.length);
  assert.doesNotMatch(rest, /provenance/);
  assert.doesNotMatch(DEPLOY, /needs\.validate\.outputs/);
  // Deploy, proof and ref advance are unchanged in kind.
  assert.match(DEPLOY, /- name: Prove it in production\n\s+if: always\(\)/);
  assert.match(DEPLOY, /needs: \[validate\]/);
});
