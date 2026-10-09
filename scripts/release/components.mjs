/*
 * HOMATCH RELEASE — the component / dependency model.
 *
 * The one table that says which component owns a path, which validation
 * suites can observe that component, and which changes are global. The
 * classifier (classify.mjs), the PR workflow's suite matrix, the post-merge
 * promotion decision and tests/matrix/releasePath.test.mjs all read it, so
 * the rule that decides a release is the rule that is tested.
 *
 * Ownership is the FIRST matching rule, in table order. Dependencies are not
 * written here by hand: the frontend import graph (graph.mjs), the edge
 * import closure (deploy-scope.mjs) and the identifiers a migration defines
 * decide which components a change reaches. What this file says is only
 * what each component IS and what can observe it.
 *
 *   scope 'repo'        touching it is a repository-wide change (REPO_FULL)
 *   security: true      every change to it is security-relevant
 *                       (COMPONENT_FULL: its complete suite set always runs)
 *   suites              the browser / worker suites that can observe it
 *   proofs              production proof owed after deploy when it changes
 */

/* ── The suites ─────────────────────────────────────────────────────────
 * Every suite is one parallel CI job (static and unit are their own jobs and
 * always run). Mobile and Studio files are split by OWNER, not round-robin,
 * so a change runs the shards that can see it; the union of the shards is
 * exactly `test:mobile` / `test:studio` (releasePath.test.mjs proves it).
 */
export const SUITE_CATALOGUE = {
  static: { title: 'Static checks', always: true },
  unit: { title: 'Unit and matrix tests', always: true },
  'mobile:routes': { title: 'Mobile — every customer route', files: ['tests/mobile/routeOverflow.test.mjs', 'tests/mobile/routeHealth.test.mjs', 'tests/mobile/textContrast.test.mjs', 'tests/mobile/formControls.test.mjs', 'tests/mobile/propertyOwnerWorkspace.test.mjs'] },
  'mobile:shell': { title: 'Mobile — shell, motion, composer', files: ['tests/mobile/shellAndMotion.test.mjs', 'tests/mobile/appShell.test.mjs', 'tests/mobile/chatComposer.test.mjs'] },
  'mobile:auth': { title: 'Mobile — auth screens', files: ['tests/mobile/authScreens.test.mjs'] },
  'mobile:verify': { title: 'Mobile — verification report', files: ['tests/mobile/mobileOverflow.test.mjs'] },
  'mobile:meta-ads': { title: 'Mobile — Meta Ads builder', files: ['tests/mobile/metaAdsBuilder.test.mjs'] },
  'mobile:mortgage': { title: 'Mobile — mortgage', files: ['tests/mobile/mortgageConsultant.test.mjs', 'tests/mobile/mortgageHuman.test.mjs'] },
  'mobile:expats': { title: 'Mobile — For Expats', files: ['tests/mobile/expatsReadable.test.mjs'] },
  'mobile:discovery': { title: 'Mobile — admin Discovery', files: ['tests/mobile/adminDiscovery.test.mjs', 'tests/mobile/findPropertyAttribution.test.mjs', 'tests/mobile/findPropertyMarketplace.test.mjs', 'tests/mobile/findBuyersResults.test.mjs'] },
  'mobile:broker': { title: 'Mobile — broker lifecycle', files: ['tests/mobile/brokerLifecycle.test.mjs'] },
  'mobile:tasks': { title: 'Mobile — tasks and contracts', files: ['tests/mobile/tasksAndContracts.test.mjs'] },
  developer: { title: 'Developer acceptance', script: 'test:developer', files: ['tests/browser/developerAcceptance.test.mjs'] },
  onboarding: { title: 'Developer onboarding', script: 'test:onboarding', files: ['tests/browser/developerOnboarding.test.mjs'] },
  floorplan: { title: 'Floor plan pipeline', script: 'test:floorplan', files: ['tests/browser/floorplanPipeline.test.mjs'] },
  'studio:editor': { title: 'Site Studio — editor', files: ['tests/studio/previewWidth.test.mjs', 'tests/studio/inlineEditing.test.mjs', 'tests/studio/blocks.test.mjs', 'tests/studio/layers.test.mjs'], serial: true },
  'studio:content': { title: 'Site Studio — content', files: ['tests/studio/translationAndHistory.test.mjs', 'tests/studio/appContent.test.mjs', 'tests/studio/stylePresets.test.mjs', 'tests/studio/pageMatrix.test.mjs'], serial: true },
  push: { title: 'Web push handlers', script: 'test:push', files: ['tests/browser/pushHandlers.test.mjs'] },
  a11y: { title: 'Accessibility and language chunks', script: 'test:a11y', files: ['tests/browser/accessibilityAudit.test.mjs', 'tests/browser/languageChunks.test.mjs'] },
  worker: { title: 'Railway worker tests', worker: true, files: [] },
};

/** Suite ids in canonical order. */
export const SUITES = Object.keys(SUITE_CATALOGUE);
export const ALWAYS = SUITES.filter((s) => SUITE_CATALOGUE[s].always);
/** Suites that need a harness build and a real browser. */
export const BROWSER = SUITES.filter((s) => SUITE_CATALOGUE[s].files?.length);

/* ── The components ─────────────────────────────────────────────────── */
const fn = (...names) => new RegExp(`^supabase/functions/(${names.join('|')})/`);

export const COMPONENTS = {
  // The machinery that decides releases. Repository-wide, and it can never
  // certify its own change after merge (see GATEKEEPER).
  RELEASE_ENGINE: {
    scope: 'repo',
    paths: [
      /^\.github\/workflows\/(pr-check|deploy)\.ya?ml$/,
      /^scripts\/release\//,
      /^scripts\/(deploy-scope|deploy-status|edgeArtifacts|check-edge-functions|edge-syntax-check|migration-baseline)\.mjs$/,
      /^supabase\/migration-baseline\.json$/,
    ],
  },
  // Dependencies, toolchain, build system, test runners, lint rules, any
  // workflow no component owns. Everything is built or checked with these.
  TOOLCHAIN: {
    scope: 'repo',
    paths: [
      /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|package-lock\.json|\.npmrc|\.nvmrc|\.node-version|deno\.lock|\.gitattributes)$/,
      /^(vite\.config\.[cm]?[jt]s|tsconfig[^/]*\.json|biome\.jsonc?|tailwind\.config\.[cm]?[jt]s|postcss\.config\.[cm]?[jt]s|index\.html|share\.html|\.env\.harness|components\.json|sgconfig\.yml|vercel\.json)$/,
      /^\.rules\//,
      // Any workflow a component does not own (<component>-*.yml are owned).
      /^\.github\/(?!workflows\/(design-studio|meta-ads)-[^/]+\.ya?ml$)/,
      /^scripts\/(run-tests\.mjs|run-full-matrix\.mjs|lint\.sh|setup-mobile-test\.mjs|lib\/)/,
      /^supabase\/config\.toml$/,
    ],
  },
  // The application shell and the code every screen runs through.
  CORE_SHARED: {
    scope: 'repo',
    paths: [
      /^src\/(main|App|routes)\.tsx$/,
      /^src\/(contexts|db|hooks|integrations|types|providers|config)\//,
      /^src\/components\/(ui|layouts|common)\//,
      /^src\/(index\.css|global\.d\.ts|svg\.d\.ts|vite-env\.d\.ts)$/,
      /^src\/i18n\/(?!translations\.ts$)/,
    ],
  },
  RAILWAY: {
    paths: [/^official-worker\//],
    suites: ['worker'],
    deploy: 'railway',
    proofs: ['Railway: homatch-official-worker deployment SUCCESS at the merge commit, health endpoint'],
  },
  AUTH_SECURITY: {
    security: true,
    paths: [/^src\/(pages\/auth|auth|components\/impersonation)\//, /^src\/lib\/impersonation\.ts$/, fn('enable-google-oauth', 'impersonate-user', 'anon-session', 'admin-user360')],
    suites: ['mobile:auth', 'mobile:routes', 'mobile:shell'],
    proofs: ['auth: login / signup / reset reachable in production; impersonation still admin-only'],
  },
  BILLING: {
    security: true,
    paths: [/^src\/(components\/billing|pages\/CreditsPage|services\/(billing|credits))/i, fn('billing', 'credits-topup', 'payment-webhook', 'payment-method-setup', 'atomic-unlock', 'unlock-external-contact', 'research-purchase', 'spend-cap-check')],
    suites: ['mobile:routes', 'mobile:shell'],
    proofs: ['money: reserve → settle → release on a real row; no unknown COGS silently zero'],
  },
  STORAGE: {
    security: true,
    paths: [fn('storage-sign', 'storage-inventory', 'storage-migrate', 'storage-selftest'), /^src\/pages\/admin\/AdminStoragePage/],
    suites: [],
    proofs: ['storage: storage-selftest PASS in production; storage_authorize allows/denies per namespace as before'],
  },
  DESIGN_STUDIO: {
    paths: [
      /^src\/(pages|components|lib|services)\/designStudio\//, /^src\/share\//, fn('design-studio-[a-z-]+'),
      /^scripts\/design-studio\//, /^scripts\/build-scene-assets\.mjs$/, /^\.github\/workflows\/design-studio-[^/]+\.ya?ml$/,
      /^tests\/browser\/(designStudio|planToHome)\.qa\.mjs$/,
    ],
    suites: [],
    proofs: ['Design Studio: edge function PROVEN_EXACT; RLS on ds_* tables verified in production'],
  },
  DEVELOPER: {
    paths: [/^src\/(pages|components|lib|services)\/(developer|floorplan)\//, /^src\/pages\/(Developers?Page|DeveloperProfilePage)/, fn('developer-[a-z-]+'), /^tests\/developer\//, /^tests\/browser\/(devBackend|devScreens)\.mjs$/],
    suites: ['developer', 'onboarding', 'floorplan', 'mobile:routes'],
  },
  META_ADS: {
    paths: [/^src\/(components\/metaAds|components\/admin\/metaAds|lib\/metaAds)\//, /^src\/pages\/(outreach\/MetaAds|admin\/AdminMetaAds)/, /^src\/services\/metaAds\.ts$/, fn('meta-ads-api', 'meta-oauth', 'meta-webhooks'), /^\.github\/workflows\/meta-ads-[^/]+\.ya?ml$/,
      // The creative text layer's pinned fonts + wasm (preview and edge export load the same files).
      /^public\/creative-engine\//],
    suites: ['mobile:meta-ads'],
    proofs: ['Meta Ads: meta-ads-api PROVEN_EXACT; status_sync cron executing'],
  },
  SITE_STUDIO: {
    paths: [/^src\/components\/studio\//, /^src\/pages\/admin\/(SiteStudioPage|AppContentPage)/, /^src\/(lib|services)\/(siteStudio|studio|appContent)/i, /^src\/site\//],
    suites: ['studio:editor', 'studio:content', 'mobile:routes', 'a11y'],
  },
  DISCOVERY: {
    paths: [/^supabase\/functions\/_shared\/marketplace(Catalogue|History|PropertyContext|PropertyTurn)\.ts$/, /^src\/pages\/(FindPropertyPage|ActiveSearchPage|admin\/AdminDiscovery|admin\/AdminSocialDiscovery)/, /^src\/(components\/matching|components\/findProperty|components\/findBuyers|matching|research-core)\//, /^src\/services\/findBuyers\.ts$/, /^src\/components\/admin\/FindBuyersControlCenter\.tsx$/, /^src\/services\/marketplaceSearch/, fn('supply-matching', 'find-property', 'find-property-plan', 'find-property-run', 'marketplace-search', 'marketplace-worker-ingest', 'run-matching', 'run-matching-v2', 'discovery-queue-worker', 'demand-discovery', 'supply-discovery', 'external-discovery-orchestrator', 'seed-discovery-queries', 'continuous-matching-worker', 'classify-signals', 'classify-signals-v2', 'revalidate-supply', 'generate-search-profile', 'ingest-live-chat', 'source-discovery-massive', 'source-audit', 'source-monitor-public', 'seed-demo-matches', 'match-campaign')],
    suites: ['mobile:discovery', 'mobile:routes'],
  },
  PWA_PUSH: {
    paths: [/^public\/(sw|service-worker|manifest)[^/]*$/, /^src\/serviceWorker\//, /^src\/lib\/(pwa|push)\.ts$/, /^src\/lib\/notifications\//, /^src\/(components\/notifications|pages\/NotificationsPage)/, fn('push-send', 'active-search-notify')],
    suites: ['push', 'a11y', 'mobile:shell'],
    proofs: ['push: push-send PROVEN_EXACT; a real subscription receives a test notification'],
  },
  VERIFY: {
    paths: [/^src\/pages\/(Verify|ContractResultPage|VerificationCasePage|ContractsHistoryPage|ContractsPage)/, /^src\/(verify|components\/verify|components\/contracts|components\/research)\//, fn('research-agent', 'verify-synthesis', 'verification-handoff', 'browserbase-handoff', 'revalidate-evidence', 'homatch-research')],
    suites: ['mobile:verify', 'mobile:routes'],
  },
  MORTGAGE: { paths: [/^src\/(pages\/MortgagePage|components\/mortgage|mortgage)/], suites: ['mobile:mortgage', 'mobile:routes'] },
  EXPATS: { paths: [/^src\/(pages\/(ForExpatsPage|Expat)|components\/expats|expats)/, /^scripts\/expat-content\//], suites: ['mobile:expats'] },
  BROKER: { paths: [/^src\/(pages\/(Broker|admin\/AdminBrokersPage)|components\/broker)/, fn('[a-z-]*broker[a-z-]*')], suites: ['mobile:broker', 'mobile:routes'] },
  PUBLIC_HOMEPAGE: {
    paths: [/^src\/pages\/(HomePage|AboutPage|PricingPage|PartnersPage|PrivacyPage|TermsPage|ProductEntryPage|ContactPage)/, /^src\/components\/home\//, /^public\//, /^scripts\/build-sitemap/],
    suites: ['mobile:shell', 'mobile:routes', 'a11y'],
  },
  ADMIN: { paths: [/^src\/(pages\/admin|components\/admin|admin)\//], suites: ['mobile:routes', 'a11y'] },
  // Customer product surfaces without a dedicated suite of their own: the
  // route sweeps, the shell and the tasks suite are what render them.
  PRODUCT: {
    paths: [/^src\/(pages|components|lib|services|campaign|dealroom|documents|import|investment|jobs|property|surfaces)\//],
    suites: ['mobile:routes', 'mobile:shell', 'mobile:tasks'],
  },
  // Edge functions whose consumers reach them only over HTTP and that no
  // browser suite can observe (every browser suite stubs the network).
  EDGE: { paths: [/^supabase\/functions\/[^_/][^/]*\//] },
  // No runtime effect: validated by static + unit.
  TOOLING: {
    paths: [/^scripts\/claude\//, /^\.graphifyignore$/, /^graphify-viewer\//, /^scripts\/[^/]*i18n[^/]*\.mjs$/, /^scripts\/[a-z0-9-]+-(apply|data(-?\d+)?|keep|coverage)\.mjs$/, /^\.claude\//, /^CLAUDE\.md$/, /^docs\//, /^[^/]+\.md$/, /^scripts\/(audit|probe|capture|inspect|live-test|investment-research-liveproof|studio-coverage|sync-comm-domain)[^/]*\.mjs$/],
  },
  // Unit-run tests, and browser files no CI gate runs (manual suites:
  // test:surfaces, test:pwa, heroMobile) — changing them cannot change what
  // CI or production does.
  // tests/sql: local-Postgres fixture checks for migrations (run by hand with
  // tests/sql/run-phase2.sh); no CI gate runs them and production never reads them.
  TESTS: { paths: [/^tests\/(matrix|fixtures|sql)\//, /(^|\/)__tests__\//, /^tests\/browser\/(harnessIsolation|fixtureShape|commSurfaces|commFixtures|pwaInstallSheet)\.(test\.)?mjs$/, /^tests\/mobile\/heroMobile\.test\.mjs$/] },
  DATABASE: { paths: [/^supabase\/migrations\/[^/]+\.sql$/, /^supabase\/replay\//] },
  I18N: { paths: [/^src\/i18n\/translations\.ts$/] },
};

/* Components where the import graph is not the whole story: a browser test
   file is owned by the suite that runs it. */
export function suiteOfTestFile(file) {
  for (const [id, s] of Object.entries(SUITE_CATALOGUE)) if (s.files?.includes(file)) return id;
  return null;
}

/** First component whose rule matches the path, or null. */
export function ownerOf(file) {
  for (const [name, c] of Object.entries(COMPONENTS)) if (c.paths.some((re) => re.test(file))) return name;
  return null;
}

/*
 * A change to the machinery that decides releases cannot certify itself after
 * merge: the promotion logic that would skip validation is the code under
 * change. Only the release engine — not every workflow.
 */
export const GATEKEEPER = COMPONENTS.RELEASE_ENGINE.paths;

/* A path naming one of these inside a component makes that change
   security-relevant for the component. */
export const SECURITY_PATH = /(^|\/)[^/]*(auth|rls|grant|permission|impersonat|security|secret|credential|vault|policy|policies)/i;

/* Edge _shared files that every function's trust rests on. */
export const GLOBAL_EDGE_PRIMITIVE = /^supabase\/functions\/_shared\/(auth|cors|supabase|admin|jwt|security|rateLimit|guard)[^/]*$/i;

/* ── Migrations: ownership by what they define ──────────────────────────
 * The objects a migration creates, alters, drops, grants on or writes are
 * mapped to components by name. A global object (the users table, admin
 * predicates, the auth schema, storage.objects, default privileges) makes
 * the migration repository-wide.
 */
export const DB_OBJECT_OWNERS = [
  [/^(auth\.|storage\.objects$|storage\.buckets$|public\.(users|user_roles|profiles|is_admin|has_role|is_staff|current_user_[a-z_]+|handle_new_user)$)/, 'GLOBAL'],
  [/^public\.(ds_|design_studio)/, 'DESIGN_STUDIO'],
  [/^public\.(storage_)/, 'STORAGE'],
  [/^public\.(meta_)/, 'META_ADS'],
  [/^public\.(site_|app_content|studio_)/, 'SITE_STUDIO'],
  [/^public\.(dt_|developer_|dev_)/, 'DEVELOPER'],
  [/^public\.(push_|notification)/, 'PWA_PUSH'],
  [/^public\.(broker)/, 'BROKER'],
  [/^public\.(mortgage)/, 'MORTGAGE'],
  [/^public\.(expat)/, 'EXPATS'],
  [/^public\.(research_|verify|verification|deal_room)/, 'VERIFY'],
  // homatch_refuse_spend_while_viewed: the BEFORE INSERT guard on credit_ledger / usage_reservations.
  [/^public\.(billing|credit|payment|wallet|cost_events|ledger|unlock|homatch_refuse_spend_while_viewed$)/, 'BILLING'],
  [/^public\.(discovery|supply_|demand_|match|search_profile|active_search|social_discovery|source_)/, 'DISCOVERY'],
  // FIND BUYERS / FIND TENANTS (memo23 social intelligence) and the discovery queue's claim/finish functions.
  [/^public\.(find_buyers_|admin_find_buyers_|claim_discovery_|finish_discovery_|signal_platform$|source_type$)/, 'DISCOVERY'],
  // Database housekeeping no application code calls (cron history retention):
  // service_role only; proven by tests/sql/perf/run-db-bench.sh, not by any suite.
  [/^public\.purge_cron_history$/, 'TOOLING'],
];

/* Translation keys by prefix: a translation change reaches the component
   whose screens render those keys. Any key outside these prefixes (or a
   structural edit) reaches every screen. */
export const I18N_KEY_OWNERS = [
  [/^dsx?_/, 'DESIGN_STUDIO'],
  [/^(mm|mads|madsb)_/, 'META_ADS'],
  [/^studio_/, 'SITE_STUDIO'],
  [/^(dev|co)_/, 'DEVELOPER'],
  [/^mortgage_/, 'MORTGAGE'],
  [/^expat_/, 'EXPATS'],
  [/^broker_/, 'BROKER'],
  [/^(verify|dr)_/, 'VERIFY'],
  [/^(pwa|notif)_/, 'PWA_PUSH'],
  [/^auth_/, 'AUTH_SECURITY'],
  [/^admin_/, 'ADMIN'],
  [/^fbx_/, 'DISCOVERY'],
  [/^fbl_/, 'DISCOVERY'],
];
