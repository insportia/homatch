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
  'mobile:routes': { title: 'Mobile — every customer route', files: ['tests/mobile/routeOverflow.test.mjs', 'tests/mobile/routeHealth.test.mjs', 'tests/mobile/textContrast.test.mjs', 'tests/mobile/formControls.test.mjs', 'tests/mobile/propertyOwnerWorkspace.test.mjs', 'tests/mobile/publishingWorkspace.test.mjs'] },
  'mobile:shell': { title: 'Mobile — shell, motion, composer', files: ['tests/mobile/shellAndMotion.test.mjs', 'tests/mobile/appShell.test.mjs', 'tests/mobile/chatComposer.test.mjs', 'tests/mobile/serviceControls.test.mjs', 'tests/mobile/serviceControlsExpand.test.mjs'] },
  'mobile:auth': { title: 'Mobile — auth screens', files: ['tests/mobile/authScreens.test.mjs', 'tests/mobile/legalCompliance.test.mjs'] },
  'mobile:verify': { title: 'Mobile — verification report', files: ['tests/mobile/mobileOverflow.test.mjs', 'tests/mobile/verifyReportPremium.test.mjs', 'tests/mobile/verifyReportTranslation.test.mjs', 'tests/mobile/verifyReportDelivery.test.mjs'] },
  'mobile:meta-ads': { title: 'Mobile — Meta Ads builder', files: ['tests/mobile/metaAdsBuilder.test.mjs'] },
  'mobile:mortgage': { title: 'Mobile — mortgage', files: ['tests/mobile/mortgageConsultant.test.mjs', 'tests/mobile/mortgageHuman.test.mjs'] },
  'mobile:expats': { title: 'Mobile — For Expats', files: ['tests/mobile/expatsReadable.test.mjs', 'tests/mobile/myGeorgia.test.mjs'] },
  'mobile:admin-mortgage': { title: 'Mobile — admin mortgage rules and bank products', files: ['tests/mobile/adminMortgageBankProducts.test.mjs'] },
  'mobile:discovery': { title: 'Mobile — admin Discovery', files: ['tests/mobile/adminDiscovery.test.mjs', 'tests/mobile/findPropertyAttribution.test.mjs', 'tests/mobile/findPropertyMarketplace.test.mjs', 'tests/mobile/findBuyersResults.test.mjs', 'tests/mobile/internalMatches.test.mjs', 'tests/mobile/findBuyersReport.test.mjs', 'tests/mobile/findBuyersUx.test.mjs', 'tests/mobile/findBuyersNavigation.test.mjs', 'tests/mobile/homatchLeads.test.mjs', 'tests/mobile/ownerDemoLead.test.mjs', 'tests/mobile/matchExpansion.test.mjs', 'tests/mobile/findPropertyCosts.test.mjs', 'tests/mobile/matchingWorkspace.test.mjs'] },
  'mobile:broker': { title: 'Mobile — broker lifecycle', files: ['tests/mobile/brokerLifecycle.test.mjs'] },
  'mobile:tasks': { title: 'Mobile — tasks and contracts', files: ['tests/mobile/tasksAndContracts.test.mjs', 'tests/mobile/leadEmailCampaigns.test.mjs'] },
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
      /^supabase\/migration-(baseline|gate)\.json$/,
    ],
  },
  // Dependencies, toolchain, build system, test runners, lint rules, any
  // workflow no component owns. Everything is built or checked with these.
  TOOLCHAIN: {
    scope: 'repo',
    paths: [
      /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|package-lock\.json|\.npmrc|\.nvmrc|\.node-version|deno\.lock|\.gitattributes)$/,
      /^(vite\.config\.[cm]?[jt]s|tsconfig[^/]*\.json|biome\.jsonc?|tailwind\.config\.[cm]?[jt]s|postcss\.config\.[cm]?[jt]s|index\.html|share\.html|\.env\.harness|components\.json|sgconfig\.yml|vercel\.json)$/,
      // Vercel functions served next to the SPA (api/geo.ts).
      /^api\/[^/]+\.ts$/,
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
    paths: [/^src\/(pages\/auth|auth|components\/impersonation|components\/legal|lib\/legal|lib\/consent)\//, /^src\/lib\/impersonation\.ts$/, /^src\/pages\/CookiesPage\.tsx$/, fn('enable-google-oauth', 'impersonate-user', 'anon-session', 'admin-user360')],
    suites: ['mobile:auth', 'mobile:routes', 'mobile:shell'],
    proofs: ['auth: login / signup / reset reachable in production; impersonation still admin-only'],
  },
  BILLING: {
    security: true,
    paths: [/^src\/(components\/billing|pages\/CreditsPage|services\/(billing|credits))/i,
      // Subscriptions (2026-10-29): client, customer pages, admin page, shared edge code, tests.
      /^src\/subscriptions\//, /^src\/pages\/(MySubscriptionPage|SubscriptionConfirmPage|SubscriptionSandboxPayPage)\.tsx$/,
      /^supabase\/functions\/_shared\/(entitlements|saasNotify)\.ts$/, /^supabase\/functions\/_shared\/saasPayments\//,
      /^tests\/matrix\/saasSubscriptions\.test\.mjs$/, /^tests\/sql\/saas\//, /^scripts\/saas-subs-i18n-/,
      fn('billing', 'credits-topup', 'payment-webhook', 'payment-method-setup', 'atomic-unlock', 'unlock-external-contact', 'research-purchase', 'spend-cap-check', 'saas-checkout', 'saas-payments-webhook')],
    suites: ['mobile:routes', 'mobile:shell'],
    proofs: ['money: reserve → settle → release on a real row; no unknown COGS silently zero'],
  },
  STORAGE: {
    security: true,
    paths: [fn('storage-sign', 'storage-inventory', 'storage-migrate', 'storage-selftest', 'storage-retention', 'storage-reupload-proof'), /^src\/pages\/admin\/AdminStoragePage/,
      /^supabase\/functions\/_shared\/retention\//, /^src\/(services\/retention|components\/retention\/)/, /^tests\/sql\/retention\//],
    suites: [],
    proofs: ['storage: storage-selftest PASS in production; storage_authorize allows/denies per namespace as before',
      'retention: tests/sql/retention/run.sh PASS; retention_admin_dry_run read-only in production; storage_retention.purge_enabled still false unless the owner approved'],
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
    paths: [/^supabase\/functions\/_shared\/marketplace(Catalogue|History|Inventory|PropertyContext|PropertyTurn)\.ts$/, /^src\/pages\/(FindPropertyPage|ActiveSearchPage|admin\/AdminDiscovery|admin\/AdminSocialDiscovery)/, /^src\/(components\/matching|components\/findProperty|components\/findBuyers|components\/leads|findBuyers|leads|matching|research-core)\//, /^src\/services\/(findBuyers|findBuyersLeads|homatchLeads|ownerDemoLead|matchingWorkspace|curatedLeadsAdmin)\.ts$/, /^src\/pages\/property\/(HomatchLeadsPage|LeadDetailPage|MatchingWorkspacePage|LegacyMatchingRedirect)\.tsx$/, /^scripts\/matching\//, /^tests\/mobile\/matchingWorkspaceFixture\.mjs$/, /^src\/components\/admin\/(FindBuyersControlCenter|FindBuyersIntelligencePanel)\.tsx$/, /^src\/services\/marketplaceSearch/, /^supabase\/functions\/_shared\/noModelGuard\.ts$/, /^scripts\/saas-search-i18n-(data|apply)\.mjs$/, fn('supply-matching', 'find-property', 'find-property-plan', 'find-property-run', 'marketplace-search', 'marketplace-worker-ingest', 'run-matching', 'run-matching-v2', 'discovery-queue-worker', 'demand-discovery', 'supply-discovery', 'external-discovery-orchestrator', 'seed-discovery-queries', 'continuous-matching-worker', 'classify-signals', 'classify-signals-v2', 'revalidate-supply', 'generate-search-profile', 'ingest-live-chat', 'source-discovery-massive', 'source-audit', 'source-monitor-public', 'seed-demo-matches', 'match-campaign')],
    suites: ['mobile:discovery', 'mobile:routes'],
  },
  PWA_PUSH: {
    paths: [/^public\/(sw|service-worker|manifest)[^/]*$/, /^src\/serviceWorker\//, /^src\/lib\/(pwa|push)\.ts$/, /^src\/lib\/notifications\//, /^src\/(components\/notifications|pages\/NotificationsPage)/, fn('push-send', 'active-search-notify'),
      // Finished-job notifications (UX round 2026-10-25): the push copy generator and the copy.
      /^scripts\/sw-push-copy\.mjs$/, /^scripts\/ux-navnotify-i18n-(data|apply)\.mjs$/,
      // Reliable transactional notifications (saas-notify, 2026-10-29): the email leg, its retry
      // sweeper, the generated six-language copy, the one-click unsubscribe, the admin log, and
      // the client hook that keeps users.preferred_language current.
      /^supabase\/functions\/_shared\/(notify|notifyEmail|transactionalEmail|notificationCopy|notificationCopy\.generated|notificationUnsubscribe|jobNotify)\.ts$/,
      /^supabase\/functions\/_shared\/__tests__\/(notificationDelivery|notifyEmail|transactionalEmail|jobNotify)\.test\.mjs$/,
      /^scripts\/saas-notify-(i18n-data|i18n-apply|copy)\.mjs$/,
      /^src\/hooks\/usePersistPreferredLanguage\.ts$/, /^src\/components\/admin\/NotificationDeliveryLog\.tsx$/],
    suites: ['push', 'a11y', 'mobile:shell'],
    proofs: ['push: push-send PROVEN_EXACT; a real subscription receives a test notification'],
  },
  VERIFY: {
    paths: [/^src\/pages\/(Verify|ContractResultPage|VerificationCasePage|ContractsHistoryPage|ContractsPage)/, /^src\/(verify|components\/verify|components\/contracts|components\/research|contracts)\//, /^src\/services\/(verifyResult|verifyDocumentFile|verifyReportPrefetch|verifyDelivery)\.ts$/, fn('research-agent', 'verify-synthesis', 'verify-queue', 'verify-scaling', 'verification-handoff', 'browserbase-handoff', 'revalidate-evidence', 'homatch-research')],
    suites: ['mobile:verify', 'mobile:routes'],
  },
  MORTGAGE: { paths: [/^src\/(pages\/Mortgage(Page|TermsPage|TermPage)|components\/mortgage|mortgage)/, /^src\/services\/mortgageFxRates\.ts$/, /^scripts\/ux-mortgage-i18n/, fn('mortgage-fx-rates')], suites: ['mobile:mortgage', 'mobile:routes', 'mobile:admin-mortgage'] },
  /* For Expats and My Georgia by HOMI (onboarding, dashboard, guide hub). */
  EXPATS: { paths: [/^src\/(pages\/(ForExpatsPage|Expat|MyGeorgia)|components\/expats|expats|myGeorgia)/, /^src\/services\/myGeorgia\.ts$/,
    /^scripts\/expat-content\//, /^scripts\/homi-mygeorgia-i18n-data\.mjs$/, /^scripts\/ux-expats-i18n-(data|apply)\.mjs$/, /^tests\/mobile\/myGeorgia\.test\.mjs$/], suites: ['mobile:expats'] },
  // PUBLISH TO PORTALS: the standalone listing-publishing workspace (/publishing),
  // its edge function and its publishing_* / publishing_engine_* objects.
  PUBLISHING: {
    paths: [/^src\/(pages|components)\/publishing\//, /^src\/publishing\//, /^src\/services\/publishing\.ts$/, fn('publishing-engine', 'publishing-worker'), /^scripts\/publishing[/-]/,
      /^src\/pages\/admin\/AdminPropertyPortals?Page\.tsx$/, /^tests\/sql\/publishing\//, /^tests\/mobile\/publishingWorkspace\.test\.mjs$/],
    suites: ['mobile:routes'],
    proofs: ['publishing: publishing-engine + publishing-worker PROVEN_EXACT; migrations 20261103090000 + 20261106090000 + 20261108090000 in the ledger; publishing_providers seeded with 8 rows; RLS select-own on publishing_engine_* and no browser access to publishing_provider*'],
  },
  // SERVICE CONTROL CENTER: the owner's pause / resume switches for six services, the
  // customer-side gates that read them and the Admin page that writes them.
  SERVICE_CONTROLS: {
    paths: [/^src\/lib\/serviceControls\//, /^src\/components\/serviceControls\//, /^src\/pages\/admin\/AdminServiceControlPage\.tsx$/, /^src\/services\/serviceControls\.ts$/,
      fn('service-control'), /^supabase\/functions\/_shared\/serviceControl\.ts$/, /^tests\/sql\/service_controls(_expand|_broker)?\//, /^tests\/mobile\/serviceControls[A-Za-z]*\.(test\.)?mjs$/,
      /^tests\/matrix\/serviceControlsExpand\.test\.mjs$/, /^scripts\/service-controls-(expand-)?i18n/, /^docs\/claude\/SERVICE_CONTROLS(_INVENTORY)?\.md$/,
      // Email Marketing hidden (2026-10-29): its fail-closed key, pause gate and proofs.
      /^supabase\/functions\/_shared\/emailMarketing\/pauseGate\.ts$/, /^tests\/matrix\/emailMarketingHidden\.test\.mjs$/, /^tests\/sql\/email_marketing_hidden\//, /^scripts\/saas-email-i18n/],
    suites: ['mobile:routes', 'mobile:shell'],
    proofs: ['service controls: migration 20261109090000 in the ledger with all six rows OFF; service-control + every gated function PROVEN_EXACT; anon gets SERVICE_DISABLED from each paused backend; customer navigation shows none of the six', 'service controls expansion: migration 20261110090000 in the ledger; the six unchanged (switches, versions); fourteen new rows ON/ON in their groups; every newly gated function PROVEN_EXACT; customer navigation unchanged while all fourteen are ON', 'email marketing hidden: migration 20261207140000 in the ledger; email_marketing OFF/OFF with its audit row; email_campaigns (SMS) unchanged; email-marketing, outreach-send, outreach-campaign-preview, comm-campaign-launch, comm-dispatch-worker, jobs-worker, service-control, homatch-ai PROVEN_EXACT; SCHEDULED/RUNNING email campaigns and Studio schedules unchanged after a tick'],
  },
  BROKER: { paths: [/^src\/(pages\/(Broker|admin\/AdminBrokersPage)|components\/broker)/, fn('[a-z-]*broker[a-z-]*')], suites: ['mobile:broker', 'mobile:routes'] },
  PUBLIC_HOMEPAGE: {
    paths: [/^src\/pages\/(HomePage|AboutPage|PricingPage|PartnersPage|PrivacyPage|TermsPage|ProductEntryPage|ContactPage)/, /^src\/components\/home\//, /^public\//, /^scripts\/build-sitemap/],
    suites: ['mobile:shell', 'mobile:routes', 'a11y'],
  },
  ADMIN: { paths: [/^src\/(pages\/admin|components\/admin|admin)\//], suites: ['mobile:routes', 'a11y', 'mobile:admin-mortgage'] },
  // Customer product surfaces without a dedicated suite of their own: the
  // route sweeps, the shell and the tasks suite are what render them.
  PRODUCT: {
    paths: [/^src\/(pages|components|lib|services|campaign|chat|crm|dealroom|documents|emailStudio|import|investment|jobs|property|surfaces)\//],
    suites: ['mobile:routes', 'mobile:shell', 'mobile:tasks'],
  },
  // Edge functions whose consumers reach them only over HTTP and that no
  // browser suite can observe (every browser suite stubs the network).
  EDGE: { paths: [/^supabase\/functions\/[^_/][^/]*\//] },
  // No runtime effect: validated by static + unit.
  TOOLING: {
    paths: [/^scripts\/claude\//, /^\.graphifyignore$/, /^graphify-viewer\//, /^scripts\/[^/]*i18n[^/]*\.mjs$/, /^scripts\/[a-z0-9-]+-(apply|data(-?\d+)?|keep|coverage)\.mjs$/, /^\.claude\//, /^CLAUDE\.md$/, /^docs\//, /^[^/]+\.md$/, /^scripts\/verify-scale\//, /^scripts\/bench\//, /^scripts\/portals\/live-check\.mjs$/, /^scripts\/homi\/[^/]+\.py$/,/^scripts\/(audit|probe|capture|inspect|live-test|investment-research-liveproof|studio-coverage|sync-comm-domain)[^/]*\.mjs$/],
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
  [/^public\.(retention_|knowledge_|market_observations$|contract_insight_counts$)/, 'STORAGE'],
  [/^public\.(meta_)/, 'META_ADS'],
  [/^public\.(site_|app_content|studio_)/, 'SITE_STUDIO'],
  [/^public\.(dt_|developer_|dev_)/, 'DEVELOPER'],
  [/^public\.(push_|notification)/, 'PWA_PUSH'],
  // The finished-job notification outbox, its trigger function and drain RPCs (20261204103000).
  [/^public\.(job_notification_|background_jobs_enqueue_notification$)/, 'PWA_PUSH'],
  [/^public\.(publishing_)/, 'PUBLISHING'],
  [/^public\.(broker)/, 'BROKER'],
  [/^public\.(mortgage)/, 'MORTGAGE'],
  [/^public\.(expat)/, 'EXPATS'],
  [/^public\.(research_|verify|verification|deal_room)/, 'VERIFY'],
  // Verify Admin reads: engine stats and report delivery (20261207120000 / 20261208130000) and the audited report retry (20261208100000).
  [/^public\.(admin_verify_)/, 'VERIFY'],
  // Contracts: revisions, owner-only deletion and the fixed price the entry page shows.
  [/^public\.(contract_revisions|contract_document_delete$|contract_fixed_price$)/, 'VERIFY'],
  // homatch_refuse_spend_while_viewed: the BEFORE INSERT guard on credit_ledger / usage_reservations.
  [/^public\.(billing|credit|payment|wallet|cost_events|ledger|unlock|homatch_refuse_spend_while_viewed$)/, 'BILLING'],
  // Subscriptions (20261207100000 / 100100): plans, usage ledger, trials, checkout, lifecycle, admin RPCs.
  [/^public\.(saas_|admin_saas_|entitlement_status_for_me$|contract_analysis_entitlement_for_me$)/, 'BILLING'],
  // Finance V2: tax profiles, commercial policies, the service registry and its admin ledger views/RPCs.
  [/^public\.(finance_tax_profiles$|finance_commercial_policies$|finance_services$|finance_vat_bps_at$|finance_split_gross$|finance_cost_status$|finance_credits_to_usd$|finance_v2_)/, 'BILLING'],
  [/^public\.(discovery|supply_|demand_|match|search_profile|active_search|social_discovery|source_)/, 'DISCOVERY'],
  // The paid discovery pricing policy (37/63) and native matching's resumable retirement.
  [/^public\.(paid_discovery_|retire_native_matches|find_property_|my_find_property_campaign$)/, 'DISCOVERY'],
  // Customer property-interest history, demand interests and saved listings (Demand Intelligence).
  [/^public\.(property_interest_|customer_demand_interests$|saved_property_listings$|interest_|record_interest_event$|record_my_property_interest$|my_property_interest_history$|set_my_interest_tracking$|delete_my_property_interest_history$|purge_expired_property_interest$|demand_interest_strength$|admin_demand_)/, 'DISCOVERY'],
  // Find Property Knowledge Engine exact cache (service role only).
  [/^public\.property_knowledge_/, 'DISCOVERY'],
  // Find Property free portal search: worker claim, live-search dispatch and quota, shared runs.
  [/^public\.(marketplace_|claim_marketplace_|consume_marketplace_|admin_marketplace_)/, 'DISCOVERY'],
  // Property inventory (20261119100000): the write-through function and its status view.
  [/^public\.(upsert_marketplace_inventory$|property_inventory_)/, 'DISCOVERY'],
  // FIND BUYERS / FIND TENANTS (memo23 social intelligence) and the discovery queue's claim/finish functions.
  [/^public\.(find_buyers_|admin_find_buyers_|claim_discovery_|finish_discovery_|signal_platform$|source_type$)/, 'DISCOVERY'],
  // HOMATCH Internal Matches: the admin/tester DEMO buyer (demo_* tables and RPCs) and the per-person key.
  // The owner Demo Mode in HOMATCH Leads (owner_demo_lead_* RPCs) lives on the same demo tables.
  [/^public\.(demo_|internal_match_demo_|my_native_match_counterparts$|owner_demo_lead_)/, 'DISCOVERY'],
  // HOMATCH Leads: the internal marketplace (feed, unlock entitlements, segment rules,
  // saved/seen, the property matching queue) and its admin views.
  [/^public\.(internal_lead|lead_contact_prefs_of$|lead_contact_preferences|my_lead_contact_preferences$|set_my_lead_contact_preferences$|native_match_|admin_internal_lead|open_native_conversation$)/, 'DISCOVERY'],
  // Find Buyers 2.0 smart match expansion: classified candidates, measured area geography,
  // the owner's reach controls and the expansion settings reader.
  [/^public\.internal_match_(candidates|place_geo|preferences|upsert$|retire$|refresh_place_geo$|visible$|expansion_config$)/, 'DISCOVERY'],
  // Matching workspace (20261129090000): the curated External Leads Database, its entitlements,
  // admin import/publication RPCs, the matching switches and the save-to-list / audience helpers.
  [/^public\.(curated_|admin_curated_|matching_|admin_matching_|admin_outreach_list|outreach_source_list$|outreach_list_)/, 'DISCOVERY'],
  // The price catalogue every paid product reads.
  [/^public\.billable_products$/, 'BILLING'],
  // The seller's CRM for unlocked leads.
  [/^public\.(lead_crm_|crm_)/, 'PRODUCT'],
  // Property conversations (media, translation cache, seen/mute/block RPCs) and Email Studio.
  [/^public\.(message_translations$|messages_reply_same_conversation$|mark_conversation_seen$|set_conversation_muted$|block_conversation_counterpart$|unblock_conversation_counterpart$|my_conversation_context$|my_message_translations$|conversation_for_participant$|dm_media_object_allowed$|email_studio_)/, 'PRODUCT'],
  // Email Studio builder history and deliverability evidence (20261201090000).
  [/^public\.(email_design_versions|email_deliverability_checks$|email_placement_tests$)/, 'PRODUCT'],
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
  [/^(pubw|publishing)_/, 'PUBLISHING'],
  [/^broker_/, 'BROKER'],
  [/^(verify|dr)_/, 'VERIFY'],
  // Contracts (entry, result, history) and the UX round's contracts copy.
  [/^(ct|ux_ct)_/, 'VERIFY'],
  [/^(pwa|notif|jobdone)_/, 'PWA_PUSH'],
  [/^auth_/, 'AUTH_SECURITY'],
  [/^admin_/, 'ADMIN'],
  // Admin → Finance (incl. Finance V2 per-service dashboards).
  [/^fin_(v2|tab)_/, 'ADMIN'],
  // Find Property workspace (history, results, property page; property-scoped AI chat errors).
  [/^fpw_/, 'DISCOVERY'],
  // Find Property search screens (marketplace search, sources, results workspace).
  [/^(fpx|mps)_/, 'DISCOVERY'],
  [/^fbx_/, 'DISCOVERY'],
  // Find Property saved listings, activity history and the paid social campaign.
  [/^fpi_/, 'DISCOVERY'],
  [/^fbl_/, 'DISCOVERY'],
  [/^im_/, 'DISCOVERY'],
  [/^(hl|rb)_/, 'DISCOVERY'],
  [/^(crm|pc|es)_/, 'PRODUCT'],
  // Matching workspace (customer) and its email handoff.
  [/^(mw|mwe)_/, 'DISCOVERY'],
];
