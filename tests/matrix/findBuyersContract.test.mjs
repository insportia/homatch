// FIND BUYERS / FIND TENANTS — the product's guarantees, read from the sources
// that implement them (docs/claude/PHASE2_DISCOVERY.md § Find Buyers).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const walk = (dir, out = []) => {
  for (const e of readdirSync(join(root, dir))) {
    const f = join(dir, e);
    if (statSync(join(root, f)).isDirectory()) walk(f, out); else out.push(f);
  }
  return out;
};

const CARD = read('src/components/findBuyers/PotentialBuyerCard.tsx');
const BRAND = read('src/components/findBuyers/brand.tsx');
const PANEL = read('src/components/findBuyers/LiveSearchModule.tsx');
const RESULTS = read('src/components/findBuyers/FindBuyersResults.tsx');
const SERVICE = read('src/services/findBuyers.ts');
const REPORT = read('src/components/findBuyers/CampaignReport.tsx');
const NOTES = read('src/components/findBuyers/ResearchNotes.tsx');
const REPORT_VM = read('src/findBuyers/campaignReport.ts');
const PIPELINE = read('supabase/functions/_shared/findBuyers/pipeline.ts');
const EXECUTOR = read('supabase/functions/_shared/findBuyers/executor.ts');
const CAMPAIGN = read('supabase/functions/_shared/findBuyers/campaign.ts');
const RUN = read('supabase/functions/_shared/campaignRun.ts');
const DRIVER = read('supabase/functions/discovery-queue-worker/driver.ts');
const MATCH = read('supabase/functions/match-campaign/index.ts');
const TRANSLATE = read('supabase/functions/_shared/findBuyers/translate.ts');
const MIGRATION = read('supabase/migrations/20261014100000_find_buyers_social_intelligence.sql');

test('Verify is untouched: no Verify file reaches Find Buyers, and Find Buyers reaches no Verify code', () => {
  const verify = [...walk('src/verify'), ...walk('src/components/verify'), ...walk('supabase/functions/research-agent'), ...walk('supabase/functions/verify-synthesis')]
    .filter((f) => /\.(ts|tsx|mjs)$/.test(f));
  /*
   * One seam, by owner decision (2026-10-09): Verify's Developer Advertising
   * stage shares the memo23 Apify client — run, poll, cost and the APIFY
   * switch — and nothing else. research-agent imports exactly that file;
   * no Verify file reaches a Find Buyers campaign, planner, table or ledger.
   * Naming a memo23 Actor is allowed; knowing Find Buyers is not.
   */
  const SEAM = "from '../_shared/findBuyers/memo23Client.ts';";
  const AGENT = join('supabase', 'functions', 'research-agent', 'index.ts');
  assert.equal(read(AGENT).split(SEAM).length - 1, 1, 'research-agent imports the shared memo23 client exactly once');
  for (const f of verify) {
    const src = f === AGENT ? read(f).replace(SEAM, '') : read(f);
    assert.doesNotMatch(src, /findBuyers|find_buyers|FindBuyers/, `${f} must not know Find Buyers`);
  }
  for (const f of [...walk('src/research-core/findBuyers'), ...walk('supabase/functions/_shared/findBuyers'), ...walk('src/components/findBuyers')]) {
    assert.doesNotMatch(read(f), /from ['"][^'"]*(\/verify\/|research-agent|verify-synthesis)/, `${f} must not import Verify`);
  }
});

test('customer screens never show provider internals, costs or secrets', () => {
  for (const [name, src] of [['card', CARD], ['panel', PANEL], ['results', RESULTS], ['report', REPORT], ['notes', NOTES], ['report view-model', REPORT_VM]]) {
    assert.doesNotMatch(src, /actor_?id|actorKey|memo23|apify|_micros|costUsd|APIFY_API_TOKEN/i, `${name} leaks internals`);
  }
  assert.doesNotMatch(SERVICE.slice(0, SERVICE.indexOf('/* ── admin')), /provider_budget_micros|customer_value_micros/, 'owner reads exclude economics');
  assert.match(MIGRATION, /grant select \(matching_job_id, campaign_id, property_id, user_id, transaction, credits_committed, languages,\s*stats/, 'owners get stats columns only');
});

test('the result card: provenance via safe links, original text kept, translation on request, RTL and touch safe', () => {
  assert.match(CARD, /safeExternalUrl\(href\)/);
  assert.match(CARD, /rel="noopener noreferrer nofollow"/);
  assert.match(CARD, /dir="auto" lang=\{srcLang \?\? undefined\}/, 'the original keeps its own direction and language');
  assert.match(CARD, /translateLeadSignal\(propertyId, lead\.id, best\.signalId, lang\)/, 'translation targets the UI language');
  assert.match(CARD, /fbx_original_lang/);
  assert.doesNotMatch(CARD, /\b(ml|mr|pl|pr)-\d|text-left|text-right|left-\d|right-\d/, 'logical properties only (RTL)');
  assert.ok((BRAND.match(/min-h-11/g) ?? []).length >= 2, '44px-class targets for framed and primary actions');
  assert.match(CARD, /FRAMED_ACTION/); assert.match(CARD, /PRIMARY_ACTION/);
  assert.doesNotMatch(CARD + BRAND, /text-muted-foreground|text-gray-|text-slate-|bg-gray-|bg-slate-/, 'no neutral greys on the premium card');
  assert.match(CARD, /min-w-0/, 'no horizontal overflow from long words');
  assert.match(CARD, /break-words/);
});

test('translation is cached by content hash + languages + model version and costed as TRANSLATION', () => {
  const cacheRead = TRANSLATE.indexOf("from('find_buyers_translations').select");
  const modelCall = TRANSLATE.indexOf('await openAiJson');
  assert.ok(cacheRead > 0 && cacheRead < modelCall, 'cache is read before any model call');
  assert.match(TRANSLATE, /eq\('content_hash', hash\)\.eq\('source_lang', sourceLang\)\.eq\('target_lang', opts\.targetLang\)\.eq\('model_version'/);
  assert.match(TRANSLATE, /kind: 'TRANSLATION'/);
  assert.match(TRANSLATE, /allowed\.has\(opts\.signalId\)/, 'only the lead\'s own evidence can be translated');
  assert.match(MATCH, /controlAction === 'translate'/);
  assert.ok(MATCH.indexOf("controlAction === 'translate'") > MATCH.indexOf("property.user_id !== homatchUser.id"), 'owner check precedes translation');
});

test('comments are bought only for comparable parent posts, and stored comments are reused first', () => {
  assert.match(PIPELINE, /a\.commentsDecision === 'FETCH' \|\| a\.commentsDecision === 'FETCH_JUSTIFIED'/);
  assert.ok(PIPELINE.indexOf('reuseStoredComments(ctx, parent, out)') < PIPELINE.indexOf('out.followUps.push({ stage: commentsStage'), 'reuse before a paid follow-up');
  assert.match(PIPELINE, /classification_status: 'FILTERED_OUT'/, 'never PENDING: the demand classifier does not re-pay for these');
});

test('Telegram: COMBINED by default (owner 2026-10-08) — free reader + paid memo23 on the channels it does not cover; NATIVE_FIRST / PAID_FIRST only by setting', () => {
  assert.match(DRIVER, /job\.provider === 'TELEGRAM' && \(finalStatus === 'FAILED' \|\| finalStatus === 'CANCELLED'\)/);
  assert.match(DRIVER, /const NATIVE_PROVIDERS = \['TELEGRAM', 'TELEGRAM_SOURCES', 'FORUM', 'PORTAL'\]/);
  const pref = read('src/research-core/findBuyers/telegramPreference.ts');
  /* Default is COMBINED; NATIVE_FIRST and PAID_FIRST only when the setting says so. */
  assert.match(pref, /if \(v === 'PAID_FIRST'\) return 'PAID_FIRST';\s*if \(v === 'NATIVE_FIRST'\) return 'NATIVE_FIRST';\s*return 'COMBINED';/);
  assert.match(pref, /return pref === 'PAID_FIRST' \|\| !nativeTelegramActive;/);
  /* Paid never reads a channel the free reader covers. */
  assert.match(pref, /&& !nativeCovers\(c\)/);
  /* The planner only plans paid Telegram at launch through that rule, and only on known channels (never a guessed seed). */
  assert.match(read('src/research-core/findBuyers/campaignPlan.ts'), /if \(planPaidTelegram\(input\.telegramPreference \?\? 'NATIVE_FIRST', input\.nativeTelegramActive\)\) \{\s*pushKnown\('TELEGRAM_CHANNEL', 'TELEGRAM'/);
  /* COMBINED adds the uncovered channels when Phase 1's Telegram search has an outcome (Find Buyers only). */
  assert.match(DRIVER, /job\.provider === 'TELEGRAM_SOURCES' && job\.metadata\?\.direction === 'DEMAND'[\s\S]{0,160}queueCombinedTelegram\(db, job\.matching_job_id\)/);
  assert.match(CAMPAIGN, /if \(settings\.telegramPreference !== 'COMBINED' \|\| !settings\.socialEnabled \|\| !settings\.apifyEnabled\) return 0;/);
  /* The free reader is skipped only under PAID_FIRST when paid Telegram jobs were actually queued; community discovery stays. */
  const mc = read('supabase/functions/match-campaign/index.ts');
  assert.match(mc, /const skipNativeReader = findBuyers\.telegramPreference === 'PAID_FIRST' && paidTelegramQueued > 0;/);
  assert.match(mc, /plan: skipNativeReader \? withoutNativeTelegramReader\(plan\) : plan,/);
  assert.match(pref, /providers: t\.providers\.filter\(\(p\) => p !== 'TELEGRAM'\)/);
});

test('money: provider runs end and are booked BEFORE settlement reads COGS; budget is reserved before every run', () => {
  const finish = RUN.indexOf("finishSocialCampaign(db, job.id, 'FINALIZE')");
  const costRead = RUN.indexOf("db.from('cost_events').select('cost_usd')");
  assert.ok(finish > 0 && finish < costRead, 'abort + book precede the COGS read');
  assert.match(RUN, /await finishSocialCampaign\(db, job\.id, reason\)[\s\S]{0,200}releaseExecution/, 'a failed campaign aborts runs before releasing');
  const reserve = EXECUTOR.indexOf("rpc('find_buyers_reserve_actor_run'");
  const start = EXECUTOR.indexOf('await startRun(');
  assert.ok(reserve > 0 && reserve < start, 'reserve before start');
  assert.match(EXECUTOR, /maxTotalChargeUsd: Number\(reservation\.reservedMicros\) \/ 1_000_000/, 'the provider is capped at the reservation');
  assert.match(MIGRATION, /where id = p_run_id and cost_booked_at is null/, 'cost is booked once');
  assert.match(MATCH, /minimumCredits\(findBuyers\.minUsd, walletRate\)/, '$10 minimum in wallet credits');
  assert.match(CAMPAIGN, /Math\.floor\(\(customerValueMicros \* providerShareBps\) \/ 10_000\)/, 'provider ceiling in integer micros');
});

test('every new switch is off and no Actor runs unverified', () => {
  assert.match(MIGRATION, /\('find_buyers_social_enabled', 'false'::jsonb\)/);
  assert.match(MIGRATION, /enabled boolean not null default false/);
  assert.match(MIGRATION, /PRICING_NOT_VERIFIED/);
  assert.doesNotMatch(MIGRATION, /pricing_verified_at\)\s*values/i);
  const seeds = MIGRATION.slice(MIGRATION.indexOf('insert into public.find_buyers_actor_registry'), MIGRATION.indexOf('on conflict (actor_key) do nothing'));
  for (const id of seeds.match(/'memo23~[a-z0-9-]+'/g) ?? []) assert.match(id, /^'memo23~/);
  assert.equal((seeds.match(/'memo23~/g) ?? []).length, 16, 'sixteen memo23 Actors registered');
});

test('Apify is live only as APIFY_MEMO23; the generic APIFY provider has no executor; DataForSEO stays retired', () => {
  assert.match(read('supabase/functions/_shared/retiredProviders.ts'), /RETIRED_PROVIDERS = \['DATAFORSEO'\] as const/);
  const worker = read('supabase/functions/discovery-queue-worker/index.ts');
  const exec = worker.slice(worker.indexOf('async function executeProvider('));
  assert.match(exec, /if \(provider === 'APIFY'\) \{\s*throw new ProviderError\(APIFY_ONLY_VIA_MEMO23, false, 423\)/,
    'a generic APIFY queue job is refused, non-retryable');
  assert.match(MIGRATION, /v_allowed text\[\] := array\['TELEGRAM', 'TELEGRAM_SOURCES', 'FORUM', 'PORTAL', 'APIFY_MEMO23'\]/);
  assert.doesNotMatch(MIGRATION, /'APIFY'\s*,\s*'FIND_BUYERS_ACTOR_RUN'.*provider_disabled_list/s);
});

test('memo23 jobs run through a bounded pool with a global run cap (no batch of four)', () => {
  const SLOTS = read('supabase/migrations/20261015090000_find_buyers_global_run_slots.sql');
  const social = DRIVER.slice(DRIVER.indexOf('async function runSocialJobs'), DRIVER.indexOf('async function runSocialJob('));
  assert.match(social, /runWorkerPool</, 'the social pass is the worker pool');
  assert.match(social, /p_limit: 1,/, 'each lane claims one job at a time');
  assert.doesNotMatch(social, /Promise\.all\(jobs\.map/, 'no claim-N-then-wait-for-all-N batch');
  assert.match(DRIVER, /const SOCIAL_PASS_MS = 45_000;/);
  assert.match(DRIVER, /priority: POLL_PRIORITY/, 'started runs are polled ahead of unstarted jobs');
  assert.match(EXECUTOR, /reason === 'GLOBAL_BUSY'\) return out\(\{ outcome: 'WAIT'/, 'a full pool waits, never cancels');
  assert.match(EXECUTOR, /const POLL_SECONDS = 10;/);
  assert.match(SLOTS, /pg_advisory_xact_lock\(hashtext\('find_buyers:memo23_global_slots'\)\)/);
  assert.match(SLOTS, /value ->> 'APIFY_MEMO23'\)::int from public\.admin_settings\s+where key = 'discovery_provider_concurrency'\), 4\)/);
  assert.match(SLOTS, /'reason', 'GLOBAL_BUSY', 'retry', true/);
  assert.doesNotMatch(SLOTS, /update public\.admin_settings|insert into public\.admin_settings/, 'the cap is not changed by this migration');
});

test('A/X. readiness is checked before any credit is reserved; zero executable work never settles a charge', () => {
  const gate = MATCH.indexOf('const readiness = await discoveryReadiness(db, discovery, findBuyers);');
  const reserve = MATCH.indexOf('const grant = await beginExecution(db, {');
  assert.ok(gate > 0 && reserve > 0 && gate < reserve, 'readiness gate precedes beginExecution');
  assert.match(MATCH, /reasonCode: 'DISCOVERY_UNAVAILABLE',\s+readinessReason: readiness\.reason,\s+\}, 409\)/);
  /* After planning: nothing external queued and nothing found → released, failed/DISCOVERY_UNAVAILABLE. */
  const unavailable = MATCH.slice(MATCH.indexOf("if (outcomeWithoutExternalWork(freshFromInternal) === 'UNAVAILABLE') {"));
  assert.ok(unavailable.length > 0);
  const block = unavailable.slice(0, unavailable.indexOf("await event(db, jobId!, sourcesAvailable ? 'SOURCE_DISCOVERY_NOT_NEEDED'"));
  assert.match(block, /failCampaignJob\(db, \{[\s\S]*?\}, grant, 'DISCOVERY_UNAVAILABLE'/);
  assert.doesNotMatch(block, /finalizeCampaignJob|settleExecution/, 'the unavailable path never settles');
  assert.match(block, /creditsCharged: 0/);
  assert.match(RUN, /if \(grant\) await releaseExecution\(db, grant, reason\.toLowerCase\(\)\)/, 'failCampaignJob releases the whole reservation');
});

test('L. a paused search is still the property\'s search: no second campaign or reservation beside it', () => {
  const block = MATCH.slice(MATCH.indexOf('ONE RUNNING SEARCH PER PROPERTY'), MATCH.indexOf('const discovery = await loadDiscoverySettings(db);'));
  assert.match(block, /\.in\('status', \[\.\.\.ACTIVE_SEARCH_STATUSES\]\)/);
  assert.match(read('supabase/functions/_shared/findBuyers/startClaim.ts'), /'classifying', 'ranking', 'paused',\s*\] as const/);
  assert.match(block, /alreadyRunning: true/);
});

test('lifecycle truth migration: one state derivation, PAUSING polls, truthful notices', () => {
  const L = read('supabase/migrations/20261016090000_find_buyers_lifecycle_truth.sql');
  assert.match(L, /create or replace function public\.find_buyers_job_state\(p_job_id uuid\)/);
  assert.match(L, /when not v_executed then 'UNAVAILABLE'/, 'no work ran → never completed-zero');
  assert.match(L, /or \(j\.status::text = 'paused' and upper\(coalesce\(q\.provider, ''\)\) = 'APIFY_MEMO23'\s+and nullif\(q\.metadata ->> 'actorRunId', ''\) is not null\)\)/);
  assert.match(L, /and not \(upper\(coalesce\(provider, ''\)\) = 'APIFY_MEMO23' and nullif\(metadata ->> 'actorRunId', ''\) is not null\)/);
  assert.match(L, /'ძებნა ამ ეტაპზე ვერ დაიწყო'/);
  assert.match(L, /'ძებნა დასრულდა — ამ ეტაპზე ახალი აქტიური მოთხოვნა ვერ მოიძებნა'/);
  assert.match(L, /'მყიდველების ძებნა დაიწყო'/);
  assert.match(L, /'პირველი შესაბამისობები უკვე ვიპოვეთ'/);
  assert.doesNotMatch(L, /update public\.admin_settings|insert into public\.admin_settings/, 'no switch or setting changes');
  assert.match(L, /revoke all on function public\.find_buyers_job_state\(uuid\) from public, anon, authenticated;/);
});

test('owner screens read the server lifecycle, never infer it from stored matches', () => {
  const PAGE = read('src/pages/property/MatchesPage.tsx');
  const DETAIL = read('src/pages/property/PropertyDetailPage.tsx');
  for (const src of [PAGE, DETAIL]) {
    assert.match(src, /useCampaignStatus\(/);
    assert.doesNotMatch(src, /MatchingJobProgress/, 'the old client-derived progress widget is gone');
  }
  assert.doesNotMatch(PAGE, /matches_load_more/, 'numbered pages, no "show more"');
  assert.match(PAGE, /getMatchesPaged\(propertyId, \{ page: matchPage/);
  assert.doesNotMatch(DETAIL, /initialActive=\{property\.matching_status === 'ACTIVE'\}/);
  assert.doesNotMatch(read('src/components/findBuyers/DiscoverySnake.tsx'), /setInterval|Math\.random/, 'the network animates server facts, no scripted loop');
});

test('T/W. the importer keeps every listing photo and records media health', () => {
  const IMP = read('supabase/functions/import-property/index.ts');
  assert.doesNotMatch(IMP, /slice\(0,\s*5\)/, 'no five-photo cap on an external gallery');
  assert.match(IMP, /extractListingMedia\(html, \{ listingId: listingIdForMedia \|\| null/);
  assert.match(IMP, /photos_candidates: media\.candidates/);
  assert.match(IMP, /const merged = mergeGallery\(existing, facts\.gallery_images \?\? \[\]\);/);
  assert.doesNotMatch(IMP.slice(IMP.indexOf('MEDIA REFRESH OF AN EXISTING PROPERTY')), /from\('property_photos'\)\.(delete|update|insert)/, 'owner uploads are never touched');
});

test('30-day rule at read time: customer reads and campaign counts use current leads only', () => {
  const sql = read('supabase/migrations/20261017090000_find_buyers_current_leads_one_active_search.sql');
  assert.match(sql, /find_buyers_signal_is_current\(p_signal_at timestamptz\)[\s\S]*p_signal_at is not null[\s\S]*now\(\) - interval '30 days'/);
  assert.match(sql, /create or replace view public\.find_buyers_current_leads with \(security_invoker = true\)/);
  assert.match(sql, /from public\.find_buyers_leads where matching_job_id = p_job_id\s+and public\.find_buyers_signal_is_current\(signal_at\)/);
  const svc = read('src/services/findBuyers.ts');
  assert.doesNotMatch(svc, /from\('find_buyers_leads'\)/, 'owner reads go through find_buyers_current_leads');
  assert.match(svc, /from\('find_buyers_current_leads'\)/);
  /* an undated comment carries the parent post's publication date (what ingest judged), never "observed now" */
  assert.match(read('supabase/functions/_shared/findBuyers/pipeline.ts'),
    /publishedAt: a\.item\.publishedAt \?\? \(a\.item\.kind === 'COMMENT' \? a\.parent\?\.publishedAt \?\? null : null\)/);
});

test('one active search per property: the job row is claimed before any credit is reserved', () => {
  const sql = read('supabase/migrations/20261017090000_find_buyers_current_leads_one_active_search.sql');
  assert.match(sql, /create unique index if not exists uidx_matching_jobs_one_active_per_property\s+on public\.matching_jobs \(property_id\)\s+where status not in \('completed', 'partially_completed', 'failed', 'cancelled', 'budget_reached'\)/);
  const mc = read('supabase/functions/match-campaign/index.ts');
  const claim = mc.indexOf('await claimSearch(db,');
  const reserve = mc.indexOf('await beginExecution(db,');
  assert.ok(claim > 0 && reserve > claim, 'claimSearch runs before beginExecution');
  assert.match(mc.slice(claim, reserve), /if \(!claim\.ok\) \{[\s\S]*alreadyRunning: true[\s\S]*\}/, 'the loser returns before reserving');
  assert.match(mc, /if \(!grant\.ok\) \{\s*\/\*[^*]*\*\/\s*await abandonClaim\(db, jobId\);/, 'a refused reservation gives the claim back');
  assert.doesNotMatch(mc, /from\('matching_jobs'\)\.insert/, 'no second, unguarded job insert');
});

test('the campaign report: owner-authorized, records-only, no provider money for the owner, legacy never qualified', () => {
  const sql = read('supabase/migrations/20261024130000_find_buyers_campaign_report.sql');
  const body = sql.slice(sql.indexOf('-- REPORT BODY BEGIN'), sql.indexOf('-- REPORT BODY END'));
  assert.match(sql, /c\.user_id = public\.auth_user_id\(\)[\s\S]{0,200}p\.user_id = public\.auth_user_id\(\)[\s\S]{0,120}raise exception 'FORBIDDEN'/, 'owner or admin only');
  assert.match(sql, /revoke all on function public\.find_buyers_campaign_report\(uuid\) from public, anon;/);
  assert.match(sql, /revoke all on function public\.admin_find_buyers_intelligence\(integer\) from public, anon;/);
  assert.match(sql, /if not public\.is_admin\(\) then raise exception 'FORBIDDEN'; end if;/);
  /* the owner sees a share of the research budget; micros only inside the admin-only economics block */
  const ownerKeys = body.replace(/'economics', case when public\.is_admin\(\)[\s\S]*?end\n/, '');
  assert.doesNotMatch(ownerKeys, /'[a-zA-Z]*Micros'/, 'no micros key reaches the owner');
  /* legacy (no category) is counted apart and never as STRONG/POTENTIAL */
  assert.match(body, /count\(\*\) from l where l\.cur and l\.cat is null\) as uncategorised/);
  assert.match(body, /l\.cat in \('STRONG', 'POTENTIAL'\)/);
  assert.doesNotMatch(body, /coalesce\(l\.cat, 'POTENTIAL'\)|coalesce\(l\.cat, 'STRONG'\)/, 'a missing category is never promoted');
  /* the screen claims no full coverage and words only known codes */
  assert.match(REPORT, /fbr_scope_disclaimer/);
  assert.match(REPORT_VM, /default: return null;/);
  assert.match(read('src/services/findBuyers.ts'), /rpc\('find_buyers_campaign_report', \{ p_job_id: jobId \}\)/);
});
