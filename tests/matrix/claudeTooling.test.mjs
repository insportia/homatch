// THE ENGINEERING-LAYER GUARDS: scripts/claude/* must stay truthful.
//
// These tools exist so a session can trust a one-line answer instead of
// re-reading the repository. A wrong map is worse than no map, so the
// classifiers, parsers, and generators get the same source-level guard
// treatment as the product.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  domainsFor, PROTECTED_WARNINGS, checkMigrations, findInnerTransactions,
  parseRoutes, edgeDeployModes, HAND_DEPLOYED, edgeFunctionNames,
} from '../../scripts/claude/lib.mjs';

const ROOT = process.cwd();

test('domainsFor classifies representative files into the right domains', () => {
  const d = domainsFor([
    'src/pages/VerifyPage.tsx',
    'src/components/home/sections/HeroSection.tsx',
    'supabase/functions/billing/index.ts',
    'supabase/migrations/20270101000000_example.sql',
    'official-worker/src/index.ts',
    'src/i18n/translations.ts',
    '.github/workflows/deploy.yml',
    'scripts/claude/lib.mjs',
  ]);
  assert.ok(d.has('VERIFY'));
  assert.ok(d.has('PUBLIC_HOMEPAGE'));
  assert.ok(d.has('BILLING'));
  assert.ok(d.has('DATABASE'));
  assert.ok(d.has('AI_TALK'));
  assert.ok(d.has('I18N'));
  assert.ok(d.has('DEPLOYMENT'));
  assert.ok(d.has('TOOLING'));
  // A file may belong to several domains; the billing edge fn is also EDGE.
  assert.ok(d.get('EDGE').includes('supabase/functions/billing/index.ts'));
});

test('protected domains carry a warning; the warnings say what they protect', () => {
  for (const domain of ['VERIFY', 'PUBLIC_HOMEPAGE', 'ADMIN', 'BILLING', 'DATABASE', 'AI_TALK']) {
    assert.ok(PROTECTED_WARNINGS[domain], `${domain} must warn`);
  }
  assert.match(PROTECTED_WARNINGS.BILLING, /PAYG|reserve/i);
  assert.match(PROTECTED_WARNINGS.AI_TALK, /Never -v2/);
  assert.match(PROTECTED_WARNINGS.DATABASE, /append-only/i);
});

test('checkMigrations flags bad prefixes, duplicates, and bad names — and only those', () => {
  const problems = checkMigrations([
    { file: '20260101010101_good_one.sql', timestamp: '20260101010101', name: 'good_one' },
    { file: '00042_legacy.sql', timestamp: '00042', name: 'legacy' },
    { file: '20260101010101_dupe.sql', timestamp: '20260101010101', name: 'dupe' },
    { file: '20260202020202_BadName.sql', timestamp: '20260202020202', name: 'BadName' },
  ]);
  const kinds = problems.map((p) => `${p.file}:${p.kind}`).sort();
  assert.deepEqual(kinds, [
    '00042_legacy.sql:BAD_TIMESTAMP',
    '20260101010101_dupe.sql:DUPLICATE_TIMESTAMP',
    '20260202020202_BadName.sql:BAD_NAME',
  ]);
});

test('findInnerTransactions sees top-level begin/commit but not dollar-quoted bodies or comments', () => {
  assert.deepEqual(findInnerTransactions('begin;\nselect 1;\ncommit;'), ['begin', 'commit']);
  assert.deepEqual(findInnerTransactions('-- begin;\nselect 1; /* commit; */'), []);
  const fn = `create function f() returns void language plpgsql as $$
begin
  perform 1;
end;
$$;`;
  assert.deepEqual(findInnerTransactions(fn), []);
  // A plpgsql body must not hide a REAL top-level wrapper around it.
  assert.deepEqual(findInnerTransactions(`begin;\n${fn}\ncommit;`), ['begin', 'commit']);
});

test('parseRoutes reads the real route table with sane access classes', () => {
  const routes = parseRoutes(ROOT);
  assert.ok(routes.length > 150, `expected >150 routes, got ${routes.length}`);
  const home = routes.find((r) => r.path === '/');
  assert.ok(home, 'root route exists');
  assert.equal(home.access, 'public');
  const admin = routes.filter((r) => r.path.startsWith('/admin'));
  assert.ok(admin.length > 20, 'admin routes present');
  assert.ok(admin.every((r) => r.access === 'admin'), 'every /admin/* route is admin-only');
  const verify = routes.find((r) => r.path.startsWith('/verify/'));
  assert.ok(verify, '/verify/:id route exists');
});

test('edgeDeployModes matches the pipeline: modes known, hand-deploy pair exact', () => {
  const modes = edgeDeployModes(ROOT);
  const values = new Set(Object.values(modes));
  for (const v of values) assert.ok(['jwt', 'no-jwt', 'UNLISTED', 'hand-deploy-only'].includes(v));
  assert.equal(modes['impersonate-user'], 'hand-deploy-only');
  assert.equal(modes['unlock-external-contact'], 'hand-deploy-only');
  const count = (m) => Object.values(modes).filter((v) => v === m).length;
  assert.ok(count('jwt') > 20, 'jwt list parsed');
  assert.ok(count('no-jwt') > 10, 'no-jwt list parsed');
  // CI's owed universe must never include the hand-deploy pair.
  for (const name of HAND_DEPLOYED) assert.ok(!edgeFunctionNames(ROOT).includes(name));
});

test('generated maps are deterministic (two runs differ only in the stamp)', () => {
  const a = mkdtempSync(join(tmpdir(), 'cbm-map-a-'));
  const b = mkdtempSync(join(tmpdir(), 'cbm-map-b-'));
  try {
    execFileSync(process.execPath, ['scripts/claude/repo-map.mjs', '--out', a], { cwd: ROOT });
    execFileSync(process.execPath, ['scripts/claude/repo-map.mjs', '--out', b], { cwd: ROOT });
    const names = readdirSync(a).sort();
    assert.deepEqual(names, ['DB_MIGRATIONS.md', 'EDGE_FUNCTIONS.md', 'REPO_MAP.md', 'ROUTE_MAP.md']);
    const destamp = (dir, f) => readFileSync(join(dir, f), 'utf8').replace(/^<!-- GENERATED[^\n]*-->\n/, '');
    for (const f of names) assert.equal(destamp(a, f), destamp(b, f), `${f} must be deterministic`);
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test('Railway canonical-worker guard: deploy-relevant paths never name a -v2 worker', () => {
  const offenders = [];
  const scan = (dir) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.git')) continue;
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) scan(rel);
      else if (/\.(mjs|js|ts|tsx|yml|yaml|json|sh|toml)$/.test(entry.name)) {
        if (readFileSync(join(ROOT, rel), 'utf8').includes('homatch-official-worker-v2')) offenders.push(rel);
      }
    }
  };
  for (const dir of ['scripts', '.github', 'official-worker']) if (existsSync(join(ROOT, dir))) scan(dir);
  assert.deepEqual(offenders, [], 'no deploy path may reference the forbidden -v2 worker');
  // And the canonical service id stays documented where sessions read first.
  assert.match(readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8'), /3e7f132b-d0be-4804-9bc0-0b6ad368ad15/);
});
