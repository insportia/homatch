/*
 * HOMATCH FAST RELEASE — which checks a change needs, and whether a merged
 * commit may be promoted on the strength of validation it already passed.
 *
 * Pure and dependency-free: the PR workflow, the deploy workflow and
 * tests/matrix/releasePath.test.mjs all call these same functions, so the
 * rule that decides a release is the rule that is tested.
 *
 *   FULL      every suite. Dependencies, build system, CI/CD, auth / RLS /
 *             security, shared infrastructure, anything unrecognised.
 *   TARGETED  static + unit always, plus only the browser suites the changed
 *             paths can affect.
 *   FAST      (post-merge only) the merged tree is byte-identical to a tree
 *             a successful PR validation run recorded, and that run covered
 *             every suite the change requires. Nothing is re-run; the
 *             deployment-specific checks and the production proof still are.
 *
 * Uncertainty always resolves upward: an unmatched path is FULL, a missing
 * or unreadable record is FULL, a record that does not cover the change is
 * FULL. There is no switch that skips validation; there is only evidence
 * that it already happened.
 */

/** Every validation suite, in the order the full gate runs them. */
export const SUITES = ['static', 'unit', 'mobile', 'developer', 'onboarding', 'floorplan', 'studio', 'push', 'a11y'];
/** Always run, whatever changed: cheap, and they guard everything. */
export const ALWAYS = ['static', 'unit'];
export const BROWSER = SUITES.filter((s) => !ALWAYS.includes(s));

/*
 * A change to the machinery that decides releases cannot certify itself:
 * the promotion logic that would skip validation is the code under change.
 * These paths force a full post-merge gate even when provenance is proven.
 */
export const GATEKEEPER = [/^\.github\//, /^scripts\/release\//];

/* Paths whose blast radius is the whole product or whose correctness is
   security-critical. Any one of them makes the change FULL. */
const FULL_RULES = [
  [/^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.npmrc|\.nvmrc|\.node-version)$/, 'dependencies or toolchain'],
  [/^\.github\//, 'CI/CD workflow'],
  [/^scripts\/(release\/|run-tests\.mjs|run-full-matrix\.mjs|lint\.sh|deploy-scope\.mjs|edgeArtifacts\.mjs|setup-mobile-test\.mjs)/, 'release / test / deploy machinery'],
  [/^\.rules\//, 'lint rules'],
  [/^(vite\.config\.[cm]?[jt]s|tsconfig[^/]*\.json|biome\.jsonc?|tailwind\.config\.[cm]?[jt]s|postcss\.config\.[cm]?[jt]s|index\.html|\.env\.harness|components\.json)$/, 'build system'],
  [/^src\/(main|App|routes)\.tsx$/, 'application shell'],
  [/^src\/(contexts|db|hooks|integrations)\//, 'shared frontend core'],
  [/^src\/components\/(ui|layouts|common)\//, 'shared UI primitives'],
  [/^src\/index\.css$/, 'global styles'],
  [/^src\/i18n\/(?!translations\.ts$)/, 'i18n runtime'],
  [/^supabase\/functions\/_shared\//, 'shared edge infrastructure'],
  [/(^|\/)[^/]*(auth|rls|grant|permission|impersonat|security|secret|credential|vault)/i, 'auth / security sensitive path'],
  [/^supabase\/config\.toml$/, 'Supabase configuration'],
  [/^official-worker\//, 'Railway worker'],
];

/* SQL that changes who may read or write what. A migration containing any of
   these is a security change, not a schema detail. */
const SECURITY_SQL = /\b(create|alter|drop)\s+policy\b|\b(grant|revoke)\b|\brow\s+level\s+security\b|\bsecurity\s+definer\b|\bauth\.(uid|role|jwt)\s*\(/i;

/* Browser suites by product area. A path in an isolated area runs the
   suites that exercise it; mobile runs for any customer-visible change. */
const AREA_RULES = [
  // Meta Ads (builder, campaign, workspace, admin) — UI covered by mobile
  // (metaAdsBuilder, routeOverflow) and the accessibility audit.
  [/^src\/(components\/metaAds|components\/admin\/metaAds|lib\/metaAds)\/|^src\/pages\/outreach\/MetaAds|^src\/pages\/admin\/AdminMetaAds|^src\/services\/metaAds\.ts$/, ['mobile', 'a11y'], 'Meta Ads'],
  // Developer workspace, Design Studio / floor plans: their journeys.
  [/^src\/(pages|components|lib|services)\/(developer|designStudio|design-studio|floorplan)/i, ['mobile', 'developer', 'onboarding', 'floorplan'], 'Developer / Design Studio'],
  // Site Studio and its App Content editor.
  [/^src\/(pages|components|lib|services)\/(siteStudio|studio|appContent)/i, ['mobile', 'studio'], 'Site Studio'],
  // Web push / service worker / PWA.
  [/^public\/(sw|service-worker)[^/]*\.js$|^src\/(lib\/pwa|lib\/push|components\/notifications)/i, ['mobile', 'push', 'a11y'], 'push / PWA'],
  // The translation bundle: every language's strings, rendered everywhere.
  [/^src\/i18n\/translations\.ts$/, ['mobile', 'a11y'], 'translations'],
  // Browser suites themselves run when they change.
  [/^tests\/mobile\//, ['mobile'], 'mobile suite'],
  [/^tests\/studio\//, ['studio'], 'studio suite'],
  [/^tests\/browser\/developerAcceptance/, ['developer'], 'developer suite'],
  [/^tests\/browser\/developerOnboarding/, ['onboarding'], 'onboarding suite'],
  [/^tests\/browser\/floorplanPipeline/, ['floorplan'], 'floor-plan suite'],
  [/^tests\/browser\/pushHandlers/, ['push'], 'push suite'],
  [/^tests\/browser\/(accessibilityAudit|languageChunks)/, ['a11y'], 'a11y suite'],
  // Public assets are rendered.
  [/^public\//, ['mobile'], 'public assets'],
];

/* Paths no browser suite can observe: static + unit cover them. */
const NO_BROWSER_RULES = [
  [/^supabase\/functions\/[^_/][^/]*\//, 'edge function'],
  [/^supabase\/migrations\/[^/]+\.sql$/, 'migration'],
  [/^supabase\/migration-baseline\.json$/, 'migration baseline'],
  [/^docs\//, 'documentation'],
  [/^[^/]+\.md$/, 'documentation'],
  [/^scripts\/(claude\/|[^/]*i18n[^/]*\.mjs$|lib\/i18nSplice\.mjs$)/, 'tooling script'],
  [/^(src|tests|supabase\/functions)\/.*__tests__\//, 'unit test'],
  [/^tests\/(matrix|developer)\//, 'source-parsing test'],
  [/^\.claude\//, 'Claude tooling'],
];

/**
 * Which suites a set of changed paths requires, and why.
 * `read(path)` (optional) returns a file's text, used to classify migrations
 * by what they do rather than by where they live; without it every
 * migration is treated as security-relevant.
 */
export function classifyChanges(files, { read } = {}) {
  const suites = new Set(ALWAYS);
  const reasons = [];
  let full = false;
  const list = [...new Set((files ?? []).map((f) => String(f).trim()).filter(Boolean))].sort();
  if (list.length === 0) {
    return { tier: 'FULL', suites: [...SUITES], reasons: ['no changed files could be determined'], files: list };
  }
  for (const f of list) {
    const fullHit = FULL_RULES.find(([re]) => re.test(f));
    if (fullHit) { full = true; reasons.push(`${f}: ${fullHit[1]} → FULL`); continue; }
    if (/^supabase\/migrations\/[^/]+\.sql$/.test(f)) {
      let sql = null;
      try { sql = read ? read(f) : null; } catch { sql = null; }
      if (sql == null) { full = true; reasons.push(`${f}: migration could not be read → FULL`); continue; }
      if (SECURITY_SQL.test(sql)) { full = true; reasons.push(`${f}: changes policies / grants / RLS → FULL`); continue; }
      reasons.push(`${f}: migration (no access-control change)`);
      continue;
    }
    const area = AREA_RULES.find(([re]) => re.test(f));
    if (area) { area[1].forEach((s) => suites.add(s)); reasons.push(`${f}: ${area[2]} → ${area[1].join(', ')}`); continue; }
    const quiet = NO_BROWSER_RULES.find(([re]) => re.test(f));
    if (quiet) { reasons.push(`${f}: ${quiet[1]}`); continue; }
    // Frontend we cannot attribute to one area: its dependents are unknown.
    full = true;
    reasons.push(`${f}: no rule proves its blast radius → FULL`);
  }
  if (full) return { tier: 'FULL', suites: [...SUITES], reasons, files: list };
  return { tier: 'TARGETED', suites: SUITES.filter((s) => suites.has(s)), reasons, files: list };
}

/** The shape a PR validation run records about itself. */
export const RECORD_VERSION = 1;

/**
 * May this merged commit be promoted without re-running validation?
 *
 *   mergedTree   git tree id of the commit being deployed (HEAD^{tree})
 *   record       the validation record the PR run uploaded, or null
 *   run          { conclusion, path, event } of that PR run from the API, or null
 *   changed      files changed by the commit being deployed (HEAD^..HEAD)
 *   read         optional file reader for migration classification
 *
 * Returns { path: 'FAST' | 'FULL', reasons }. Every branch that is not a
 * complete, positive proof returns FULL.
 */
export function promotionDecision({ mergedTree, record, run, changed, read }) {
  const no = (why) => ({ path: 'FULL', reasons: [why] });
  if (!mergedTree || !/^[0-9a-f]{40}$/.test(mergedTree)) return no('the deployed tree id is unknown');
  if (!run) return no('no successful PR validation run was found for this commit');
  if (run.conclusion !== 'success') return no(`the PR validation run concluded ${run.conclusion ?? 'unknown'}`);
  if (run.event !== 'pull_request') return no(`the validation run came from ${run.event ?? 'an unknown event'}, not a pull request`);
  if (run.path !== '.github/workflows/pr-check.yml') return no(`the validation run came from ${run.path ?? 'an unknown workflow'}`);
  if (!record) return no('the PR run has no validation record');
  if (record.version !== RECORD_VERSION) return no(`validation record version ${record.version} is not ${RECORD_VERSION}`);
  if (record.validatedTree !== mergedTree) {
    return no(`the deployed tree ${mergedTree.slice(0, 12)} is not the validated tree ${String(record.validatedTree).slice(0, 12)} (main moved, or the merge changed code)`);
  }
  const gate = (changed ?? []).filter((f) => GATEKEEPER.some((re) => re.test(f)));
  if (gate.length) return no(`the release machinery changed (${gate.join(', ')}); it cannot vouch for itself`);
  const required = classifyChanges(changed, { read });
  const ran = new Set(record.suites ?? []);
  const missing = required.suites.filter((s) => !ran.has(s));
  if (missing.length) return no(`the PR run did not cover: ${missing.join(', ')}`);
  return {
    path: 'FAST',
    reasons: [
      `deployed tree ${mergedTree.slice(0, 12)} is byte-identical to the tree PR validation run ${record.runId} validated`,
      `that run covered every required suite (${required.suites.join(', ')}) at tier ${record.tier}`,
    ],
  };
}

/** test:mobile's canonical file list, split deterministically into shards. */
export function mobileShards(testMobileScript, count) {
  const files = String(testMobileScript).match(/tests\/mobile\/[\w.-]+\.test\.mjs/g) ?? [];
  const shards = Array.from({ length: count }, () => []);
  files.forEach((f, i) => shards[i % count].push(f));
  return shards;
}
