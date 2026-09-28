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

/* Generated-map freshness. */
const mapHead = readStampHead(join(ROOT, 'docs/claude/generated/ROUTE_MAP.md'));
if (!mapHead) console.log('\nmaps    NOT GENERATED — run: npm run homatch:map');
else if (mapHead !== head) console.log(`\nmaps    STALE (generated at ${mapHead}, HEAD ${head}) — run: npm run homatch:map`);
else console.log('\nmaps    fresh (docs/claude/generated/*)');

const statePath = join(ROOT, 'docs/claude/PROJECT_STATE.md');
if (existsSync(statePath)) {
  const updated = readFileSync(statePath, 'utf8').match(/last_updated:\s*(.+)/)?.[1];
  console.log(`state   docs/claude/PROJECT_STATE.md (last_updated: ${updated ?? 'unknown'})`);
} else {
  console.log('state   PROJECT_STATE.md missing');
}

console.log('\nnext    homatch:scope · homatch:test:affected · homatch:check · CLAUDE.md for the rules');
