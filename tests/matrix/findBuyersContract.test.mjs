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
const PANEL = read('src/components/findBuyers/FindBuyersCampaignPanel.tsx');
const RESULTS = read('src/components/findBuyers/FindBuyersResults.tsx');
const SERVICE = read('src/services/findBuyers.ts');
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
  for (const f of verify) assert.doesNotMatch(read(f), /findBuyers|find_buyers|memo23|APIFY_MEMO23/, `${f} must not know Find Buyers`);
  for (const f of [...walk('src/research-core/findBuyers'), ...walk('supabase/functions/_shared/findBuyers'), ...walk('src/components/findBuyers')]) {
    assert.doesNotMatch(read(f), /from ['"][^'"]*(\/verify\/|research-agent|verify-synthesis)/, `${f} must not import Verify`);
  }
});

test('customer screens never show provider internals, costs or secrets', () => {
  for (const [name, src] of [['card', CARD], ['panel', PANEL], ['results', RESULTS]]) {
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

test('native Telegram is primary; memo23 Telegram is a fallback only', () => {
  assert.match(DRIVER, /job\.provider === 'TELEGRAM' && \(finalStatus === 'FAILED' \|\| finalStatus === 'CANCELLED'\)/);
  assert.match(DRIVER, /const NATIVE_PROVIDERS = \['TELEGRAM', 'TELEGRAM_SOURCES', 'FORUM', 'PORTAL'\]/);
  assert.match(read('src/research-core/findBuyers/campaignPlan.ts'), /if \(!input\.nativeTelegramActive\) pushKnown\('TELEGRAM_CHANNEL'/);
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

test('the generic APIFY provider stays retired; the new provider has its own key', () => {
  assert.match(read('supabase/functions/_shared/retiredProviders.ts'), /RETIRED_PROVIDERS = \['DATAFORSEO', 'APIFY'\] as const/);
  assert.match(MIGRATION, /v_allowed text\[\] := array\['TELEGRAM', 'TELEGRAM_SOURCES', 'FORUM', 'PORTAL', 'APIFY_MEMO23'\]/);
  assert.doesNotMatch(MIGRATION, /'APIFY'\s*,\s*'FIND_BUYERS_ACTOR_RUN'.*provider_disabled_list/s);
});
