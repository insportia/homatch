/*
 * npm run homatch:context — the one-screen engineering snapshot.
 *
 * Cheap by contract: git + filesystem only. No network, no production SQL.
 * This is what a fresh or freshly-compacted session runs FIRST, instead of
 * re-exploring the repository.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ROOT, git, changedFiles, domainsFor, PROTECTED_WARNINGS,
  parseMigrations, readStampHead,
} from './lib.mjs';

const head = git('rev-parse', '--short', 'HEAD');
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
const dirty = git('status', '--porcelain').split('\n').filter(Boolean);

console.log(`branch  ${branch}`);
console.log(`HEAD    ${head}  ${git('log', '-1', '--format=%s').slice(0, 72)}`);
console.log(`tree    ${dirty.length === 0 ? 'clean' : `${dirty.length} uncommitted change(s)`}`);

/* Deployed refs, as last fetched. Local knowledge only — verifying real
   production state is deploy-time work (npm run homatch:deploy:scope after a
   fresh `git fetch origin '+refs/deployed/*:refs/deployed/*'`). */
for (const ref of ['frontend', 'edge']) {
  const sha = git('rev-parse', '--short', `refs/deployed/${ref}`);
  console.log(`deployed/${ref.padEnd(8)} ${sha || '(not fetched)'} ${sha && sha === head ? '== HEAD' : ''}`);
}

const { base, files } = changedFiles();
console.log(`\nvs ${base.slice(0, 8)} (merge-base with origin/main): ${files.length} changed file(s)`);
const domains = domainsFor(files);
if (domains.size) {
  console.log(`domains ${[...domains.keys()].join(', ')}`);
  for (const d of domains.keys()) if (PROTECTED_WARNINGS[d]) console.log(`  ⚠ ${d}: ${PROTECTED_WARNINGS[d].split('.')[0]}.`);
}

const migrations = parseMigrations();
console.log(`\nmigrations ${migrations.length} in repo; latest:`);
for (const m of migrations.slice(-3)) console.log(`  ${m.file}`);

/* Generated-map freshness. A commit that merely CONTAINS the maps must not
   read as stale, so staleness means: a map INPUT changed since the stamp
   (or the stamp's commit is unknown to this checkout). */
const MAP_INPUTS = ['src/routes.tsx', 'src/pages', 'src/site', 'supabase',
  '.github/workflows/deploy.yml', 'scripts/deploy-scope.mjs',
  'scripts/claude/lib.mjs', 'scripts/claude/repo-map.mjs', 'tests/matrix'];
const mapHead = readStampHead(join(ROOT, 'docs/claude/generated/ROUTE_MAP.md'));
if (!mapHead) {
  console.log('\nmaps    NOT GENERATED — run: npm run homatch:map');
} else if (mapHead === head) {
  console.log('\nmaps    fresh (docs/claude/generated/*)');
} else if (!git('rev-parse', '--verify', `${mapHead}^{commit}`)) {
  console.log(`\nmaps    UNKNOWN BASE (stamp ${mapHead} not in this checkout) — run: npm run homatch:map`);
} else {
  // Diff against the working tree, so uncommitted input edits count too.
  const changedInputs = git('diff', '--name-only', mapHead, '--', ...MAP_INPUTS)
    .split('\n').filter(Boolean);
  if (changedInputs.length === 0) {
    console.log(`\nmaps    fresh (inputs unchanged since stamp ${mapHead})`);
  } else {
    console.log(`\nmaps    STALE (${changedInputs.length} input(s) changed since ${mapHead}) — run: npm run homatch:map`);
  }
}

const statePath = join(ROOT, 'docs/claude/PROJECT_STATE.md');
if (existsSync(statePath)) {
  const updated = readFileSync(statePath, 'utf8').match(/last_updated:\s*(.+)/)?.[1];
  console.log(`state   docs/claude/PROJECT_STATE.md (last_updated: ${updated ?? 'unknown'})`);
} else {
  console.log('state   PROJECT_STATE.md missing');
}

console.log('\nnext    homatch:scope · homatch:test:affected · homatch:check · CLAUDE.md for the rules');
