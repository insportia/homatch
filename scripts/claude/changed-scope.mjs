/*
 * npm run homatch:scope [--base <ref>] [--json]
 *
 * What did this diff touch, in product terms? Classifies changed files into
 * HOMATCH domains and prints the protected-surface warnings that apply, plus
 * whether Railway is in scope at all. Pure git + the shared rule table; no
 * network, no production access.
 */
import { changedFiles, domainsFor, PROTECTED_WARNINGS } from './lib.mjs';

const args = process.argv.slice(2);
const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : undefined;
const asJson = args.includes('--json');

const { base: usedBase, files } = changedFiles(base);
const domains = domainsFor(files);

const railwayTouched = files.some((f) => f.startsWith('official-worker/'));

if (asJson) {
  console.log(JSON.stringify({
    base: usedBase,
    files,
    domains: Object.fromEntries(domains),
    warnings: [...domains.keys()].filter((d) => PROTECTED_WARNINGS[d]).map((d) => ({ domain: d, warning: PROTECTED_WARNINGS[d] })),
    railway: railwayTouched ? 'TOUCHED' : 'NOT_REQUIRED',
  }, null, 2));
  process.exit(0);
}

console.log(`base ${usedBase.slice(0, 8)} — ${files.length} changed file(s)`);
if (files.length === 0) { console.log('clean: no changes to classify'); process.exit(0); }

if (domains.size === 0) {
  console.log('domains: none matched (misc files only)');
} else {
  for (const [domain, hit] of domains) {
    console.log(`\n${domain} (${hit.length})`);
    for (const f of hit.slice(0, 8)) console.log(`  ${f}`);
    if (hit.length > 8) console.log(`  … +${hit.length - 8} more`);
    if (PROTECTED_WARNINGS[domain]) console.log(`  ⚠ ${PROTECTED_WARNINGS[domain]}`);
  }
}

console.log(`\nRAILWAY: ${railwayTouched
  ? '⚠ official-worker/ touched — canonical worker only (homatch-official-worker / 3e7f132b-…); never -v2'
  : 'worker files untouched — RAILWAY DEPLOYMENT NOT REQUIRED'}`);
