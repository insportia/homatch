/*
 * npm run homatch:test:affected [--run] [--base <ref>]
 *
 * The smallest meaningful test set for this diff — for ITERATION, never for
 * release. The final gates (npm run homatch:check:full) are untouched by
 * this and still decide readiness.
 *
 * Mapping is domain → commands, using only suites that exist in this repo.
 * Browser suites are RECOMMENDED but not run by default (they need
 * `npm run build:harness` and Chromium); unit-level selections run with
 * --run.
 */
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { changedFiles, domainsFor, ROOT } from './lib.mjs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : undefined;
const doRun = args.includes('--run');

/** unit: safe to execute here. browser: needs harness build; recommend only. */
const MAP = {
  I18N: {
    unit: ['npm run i18n:check', 'npm run i18n:keys',
      'node --test tests/matrix/placeholderParity.test.mjs tests/matrix/resultLanguage.test.mjs tests/matrix/customerVocabulary.test.mjs'],
    browser: [],
  },
  PUBLIC_HOMEPAGE: {
    unit: ['node --test tests/matrix/publicSite.test.mjs tests/matrix/publicNav.test.mjs src/lib/__tests__/pwa.test.mjs'],
    browser: ['npm run build:harness && npm run test:mobile', 'npm run test:a11y'],
  },
  VERIFY: {
    unit: ['node --test tests/matrix/deployCoverage.test.mjs'],
    browser: ['npm run build:harness && node --test tests/mobile/verifyReport.test.mjs'],
  },
  OWNER: {
    unit: ['node --test tests/matrix/propertyManagement.test.mjs tests/matrix/propertyGallery.test.mjs'],
    browser: ['npm run build:harness && node --test tests/mobile/routeOverflow.test.mjs'],
  },
  DISCOVERY: {
    unit: ['node --test tests/matrix/nativeMatching.test.mjs tests/matrix/nativePipeline.test.mjs tests/matrix/intentSources.test.mjs tests/matrix/matchPresentation.test.mjs tests/matrix/searchPlanPresentation.test.mjs'],
    browser: [],
  },
  ADMIN: {
    unit: ['node --test tests/matrix/functionGrants.test.mjs'],
    browser: ['npm run build:harness && npm run test:studio'],
  },
  BILLING: {
    unit: ['node --test tests/matrix/campaignFundedResults.test.mjs tests/matrix/deployScope.test.mjs'],
    browser: [],
  },
  NOTIFICATIONS: {
    unit: ['node --test src/lib/__tests__/pwa.test.mjs'],
    browser: ['npm run test:push'],
  },
  BROKER: {
    unit: ['node --test tests/matrix/brokerSeparation.test.mjs'],
    browser: [],
  },
  AI_TALK: {
    unit: ['npm run test:voice'],
    browser: [],
  },
  DATABASE: {
    unit: ['npm run homatch:migrations', 'node --test tests/matrix/migrationHistory.test.mjs tests/matrix/functionGrants.test.mjs tests/matrix/databaseBlocked.test.mjs'],
    browser: [],
  },
  EDGE: {
    unit: ['npm run check:edge', 'node --test tests/matrix/deployScope.test.mjs tests/matrix/deployPipeline.test.mjs tests/matrix/deployCoverage.test.mjs src/services/__tests__/edgeDeployRegistry.test.mjs'],
    browser: [],
  },
  DEPLOYMENT: {
    unit: ['node --test tests/matrix/deployScope.test.mjs tests/matrix/deployPipeline.test.mjs tests/matrix/deployCoverage.test.mjs'],
    browser: [],
  },
  TOOLING: {
    unit: ['node --test tests/matrix/claudeTooling.test.mjs'],
    browser: [],
  },
};

const { base: usedBase, files } = changedFiles(base);
const domains = [...domainsFor(files).keys()];

if (files.length === 0) { console.log('clean tree — nothing affected'); process.exit(0); }

/* A test file that changed is itself affected, whatever its domain. */
const changedTests = files.filter((f) => /\.test\.mjs$/.test(f) && existsSync(join(ROOT, f)));

const unit = new Set();
const browser = new Set();
for (const d of domains) {
  for (const c of MAP[d]?.unit ?? []) unit.add(c);
  for (const c of MAP[d]?.browser ?? []) browser.add(c);
}
if (changedTests.length) unit.add(`node --test ${changedTests.join(' ')}`);

/* Drop commands whose named test files do not exist (repo evolves). */
const exists = (cmd) => {
  const filesIn = cmd.match(/(?:tests|src)\/[^\s]+\.mjs/g) ?? [];
  return filesIn.every((f) => existsSync(join(ROOT, f)));
};
const unitCmds = [...unit].filter(exists);
const browserCmds = [...browser];

console.log(`base ${usedBase.slice(0, 8)} — domains: ${domains.join(', ') || '(none matched)'}`);
if (unitCmds.length === 0 && browserCmds.length === 0) {
  console.log('No mapped suites for this diff. For unclassified changes run: npm test');
  process.exit(0);
}
console.log('\nUnit-level (runs with --run):');
for (const c of unitCmds) console.log(`  ${c}`);
if (browserCmds.length) {
  console.log('\nBrowser-level (recommended; needs harness build + Chromium):');
  for (const c of browserCmds) console.log(`  ${c}`);
}
console.log('\nRelease readiness is still: npm run homatch:check:full');

if (doRun) {
  for (const c of unitCmds) {
    console.log(`\n$ ${c}`);
    execSync(c, { cwd: ROOT, stdio: 'inherit' });
  }
}
