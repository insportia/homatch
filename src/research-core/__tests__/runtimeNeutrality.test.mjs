// The Research Core has to run in three places: a Deno Edge Function, the
// Node test runner, and the Vite build's type-check. Nothing enforces that at
// runtime until the deploy, and a `node:crypto` import that slips in here does
// not fail the frontend build or the unit suite — it fails the edge function,
// in production, on the first request.
//
// So it is enforced here, by reading every file in the directory.
//
// The other four rules are checked the same way and for the same reason: each
// of them is invisible until the exact moment it costs something.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'src', 'research-core');

function sourceFiles(dir = ROOT, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue;
      sourceFiles(full, out);
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const FILES = sourceFiles();
const read = (file) => readFileSync(file, 'utf8');
const rel = (file) => file.slice(ROOT.length + 1).replace(/\\/g, '/');

/** Strip comments so a rule cannot be broken by a sentence describing it. */
function code(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

/** Balanced-paren extraction, because a regex cannot match nested types. */
function constructorParameterLists(text) {
  const lists = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf('constructor(', from);
    if (at === -1) return lists;
    let depth = 0;
    let end = -1;
    for (let i = at + 'constructor'.length; i < text.length; i += 1) {
      if (text[i] === '(') depth += 1;
      else if (text[i] === ')') {
        depth -= 1;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) return lists;
    lists.push(text.slice(at + 'constructor('.length, end));
    from = end + 1;
  }
}

function splitTopLevel(text) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const c of text) {
    if ('([{<'.includes(c)) depth += 1;
    if (')]}>'.includes(c)) depth -= 1;
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

test('the directory is not empty — a passing scan of nothing proves nothing', () => {
  assert.ok(FILES.length > 30, `only ${FILES.length} source files found`);
});

test('no file imports a Node built-in', () => {
  for (const file of FILES) {
    const body = code(read(file));
    assert.ok(
      !/from\s+['"]node:/.test(body),
      `${rel(file)} imports a node: module, which does not exist in a Deno Edge Function`,
    );
    // Only a CommonJS module load counts. `require(id: ProfileId)` is a
    // perfectly ordinary method name and is not what this rule is about.
    assert.ok(!/\brequire\s*\(\s*['"]/.test(body), `${rel(file)} uses require('…')`);
  }
});

test('no file reaches for a runtime-specific global', () => {
  for (const file of FILES) {
    const body = code(read(file));
    assert.ok(!/\bprocess\.(env|stderr|stdout|argv)\b/.test(body), `${rel(file)} uses process.*`);
    assert.ok(!/\bDeno\./.test(body), `${rel(file)} uses Deno.*`);
    assert.ok(!/\bBuffer\b/.test(body), `${rel(file)} uses Buffer`);
    assert.ok(!/\b__dirname\b|\b__filename\b/.test(body), `${rel(file)} uses CommonJS globals`);
  }
});

test('no file uses TypeScript syntax that Node cannot strip', () => {
  // Node runs .ts in strip-only mode: it deletes types and executes the rest.
  // Anything that EMITS code — a parameter property, an enum, a namespace, a
  // decorator — is a hard load error. This is not a style rule; a single
  // `constructor(private readonly x: T)` makes every test that imports the
  // file fail to load, which is how it was found.
  for (const file of FILES) {
    const body = code(read(file));
    for (const params of constructorParameterLists(body)) {
      for (const param of splitTopLevel(params)) {
        // A parameter property is a modifier at the START of a parameter.
        // `profiles: readonly ResearchProfile[]` puts `readonly` after the
        // colon and is an ordinary readonly array type, not a field.
        assert.ok(
          !/^\s*(private|public|protected)\s/.test(param) &&
            !/^\s*readonly\s+[A-Za-z_$][\w$]*\s*\??\s*:/.test(param),
          `${rel(file)} uses a constructor parameter property: "${param.trim()}"`,
        );
      }
    }
    assert.ok(!/^\s*(export\s+)?(const\s+)?enum\s/m.test(body), `${rel(file)} declares an enum`);
    assert.ok(!/^\s*(export\s+)?namespace\s/m.test(body), `${rel(file)} declares a namespace`);
    assert.ok(!/^\s*@[A-Za-z]/m.test(body), `${rel(file)} uses a decorator`);
  }
});

// A raw control character in source is invisible in every editor and every
// diff, and for a separator used in cache and dedupe keys a dropped one would
// merge two things that are not the same. There is no check for it here
// because src/verify/__tests__/sourceHygiene.test.mjs already walks the whole
// of src/ for exactly that, research-core included, and a second copy of a
// working gate is one more thing to keep in step.

test('the core holds no database client', () => {
  for (const file of FILES) {
    const body = code(read(file));
    assert.ok(
      !/supabase-js|createClient\s*\(/.test(body),
      `${rel(file)} reaches for Supabase; persistence belongs behind a port`,
    );
    assert.ok(
      !/\bfrom\s*\(\s*['"](research_jobs|research_cache|intelligence_|cost_events|usage_events)/.test(body),
      `${rel(file)} names a table directly`,
    );
  }
});

test('the core contains no price, rate or currency conversion constant', () => {
  // A rate here would be a second answer to a question provider_price_book
  // already answers with an effective date attached.
  for (const file of FILES) {
    const body = code(read(file));
    assert.ok(
      !/\b(costPerUnit|pricePerToken|USD_PER|RATE_USD|EXCHANGE_RATE|FX_RATE)\b/.test(body),
      `${rel(file)} appears to hold a rate constant`,
    );
  }
});

test('every relative import carries an explicit .ts extension', () => {
  // Deno resolves no extensions. An import that works under the bundler and
  // not under Deno is the exact failure this whole file exists to prevent.
  for (const file of FILES) {
    const body = read(file);
    const specifiers = [...body.matchAll(/from\s+['"](\.[^'"]+)['"]/g)].map((m) => m[1]);
    for (const specifier of specifiers) {
      assert.ok(
        specifier.endsWith('.ts'),
        `${rel(file)} imports "${specifier}" without a .ts extension`,
      );
    }
  }
});

test('the core is consumed only through its deliberate integration points', () => {
  /*
   * This assertion used to read "nothing outside the core imports it yet",
   * which was right while the core was vendored and unwired. It is now wired
   * into Verify deliberately, so the property worth guarding has changed: the
   * core must be reached from a SMALL, NAMED set of seams, not from wherever
   * a feature happened to need a helper.
   *
   * The distinction matters because the core's value is that it is runtime
   * neutral and has one way in. A component importing a fetch primitive
   * directly would bypass the network policy, the rate limits and the cost
   * accounting, and nothing would notice until production.
   *
   * Adding a seam here is meant to be a deliberate edit, the same way the old
   * assertion was.
   */
  const ALLOWED = new Set([
    // Discovery engine: the campaign run, its source jobs, the unlock
    // freshness guard, the classifier taxonomy, and the Matches screen's
    // current-demand split -- all reading the ONE active-demand policy and
    // the ONE signal taxonomy rather than re-deriving them.
    'supabase/functions/_shared/campaignRun.ts',
    'supabase/functions/_shared/campaignSources.ts',
    /*
     * FIND BUYERS / FIND TENANTS (memo23 social intelligence). These four edge
     * modules import only research-core/findBuyers: pure decision code (DNA,
     * query plan, similarity, intent, identity, scoring, allocation,
     * normalizers). The one network door to Apify is _shared/findBuyers/
     * memo23Client.ts, which imports nothing from the core; no fetch, policy
     * or flow primitive of the core is reached from here.
     */
    'supabase/functions/_shared/findBuyers/campaign.ts',
    'supabase/functions/_shared/findBuyers/executor.ts',
    'supabase/functions/_shared/findBuyers/pipeline.ts',
    'supabase/functions/_shared/findBuyers/translate.ts',
    /* Admin re-qualification of a finished campaign's stored leads: the same
       pure qualification the pipeline uses (research-core/findBuyers/requalify),
       no provider call. */
    'supabase/functions/_shared/findBuyers/admin.ts',
    'supabase/functions/_shared/__tests__/findBuyersPipelineQualification.test.mjs',
    'supabase/functions/_shared/__tests__/findBuyersRequalify.test.mjs',
    /* Launch readiness: the pure decideReadiness rule (research-core/findBuyers/readiness). */
    'supabase/functions/_shared/findBuyers/readiness.ts',
    /*
     * The one UI seam onto the Find Buyers core: owner screens show what a search
     * looks for through the same Property DNA the search uses. Components import
     * this seam, never the core.
     */
    'src/findBuyers/searchDna.ts',
    /* The admin seam onto the Actor catalog: class and lifecycle come from the
       same pure rules the planner and cost bound use. */
    'src/findBuyers/actorCatalog.ts',
    'supabase/functions/atomic-unlock/index.ts',
    'supabase/functions/classify-signals-v2/index.ts',
    'src/matching/currentDemand.ts',
    'supabase/functions/_shared/fx.ts',
    'supabase/functions/_shared/__tests__/campaignMoney.test.mjs',
    // The Verify market lane and the seed it is built from.
    'src/verify/marketLane.ts',
    'src/verify/researchSeed.ts',
    'src/verify/__tests__/marketLane.test.mjs',
    'src/verify/__tests__/researchSeed.test.mjs',
    // What the lane learned about its sources, written back to the registry.
    'src/verify/sourceHealth.ts',
    'src/verify/__tests__/sourceHealth.test.mjs',
    // The one server that runs research.
    'supabase/functions/research-agent/index.ts',
    /*
     * HOMATCH INVESTMENT INTELLIGENCE — the second consumer, and a
     * deliberate seam rather than an incidental one.
     *
     * lane.ts is the whole of it. It builds a ResearchSeed from an
     * investment consultation, calls discoverComparables for a sale sweep
     * and a rent sweep, and reduces what comes back with the core's OWN
     * pooling, dedupe and independence functions. It implements no
     * statistic, no cache, no fetch path and no source registry; it does
     * not touch HttpClient, NetworkPolicy or any flow-control primitive
     * directly. Every one of those reaches it through createPortalRuntime,
     * which is the same single door Verify's market lane goes through.
     *
     * The edge function is listed for one reason: it calls
     * createPortalRuntime to build that door. It holds no research logic.
     *
     * If a component ever appears in this list, that is the signal the seam
     * has stopped being a seam.
     */
    'src/investment/evidence/lane.ts',
    'supabase/functions/investment-research/index.ts',
    /*
     * MARKET DISCOVERY'S SEARCH PROVIDERS — the third seam, and the reason
     * the core defines a provider contract instead of implementing one.
     *
     * The core owns what a SearchProvider IS and what a discovery run does
     * with the answers. It deliberately owns no vendor: there is no
     * paid-provider rung (see discovery/ladder.ts), and the previous
     * discovery function was built entirely on bought SERP calls, which is
     * why it has no capability today.
     *
     * So HOW the public web is reached lives out here. These two files hold
     * the plain HTTP fetcher the crawler drives, and the translation of a
     * ResearchSeed into the geography the resolver needs. Neither implements a
     * statistic,
     * a tier, an extractor or a fetch path, and none touches HttpClient,
     * NetworkPolicy or any flow-control primitive — all of that stays behind
     * createPortalRuntime and runMarketLane, exactly as before.
     *
     * If an extractor or a tier ever appears in one of these, the seam has
     * stopped being a seam.
     */
    'src/verify/search/subjectGeo.ts',
    'src/verify/search/httpCrawlFetcher.ts',
    'src/verify/__tests__/marketDiscoveryWiring.test.mjs',
    /*
     * FOR EXPATS PROVIDER REPUTATION — the fourth seam, and the narrowest.
     *
     * reputation.ts imports exactly two things: dedupeObservations and
     * computeIndependence. It uses them for the question they were written
     * for — how many of these are actually different sources, and which of
     * them are the same document twice — because the alternative was a
     * second implementation of source independence that would disagree
     * with Verify's within a month.
     *
     * It reaches no fetch path, no NetworkPolicy, no rate limiter, no
     * cache and no source registry. It does not run research; it scores
     * evidence that a run has already produced. That is why it is a seam
     * and not a consumer, and it is why this entry is one file rather than
     * a directory.
     *
     * If this file ever imports HttpClient, a transport, or anything under
     * fetch/ or flow/, the seam has stopped being a seam.
     */
    'src/expats/research/reputation.ts',
    /*
     * CAMPAIGN SEARCH LANGUAGES — the fifth seam, and the first one with a
     * screen behind it.
     *
     * A customer picks the languages their campaign searches in, and the
     * launch screen must preview the resulting set with the SAME function the
     * server resolves it with: a preview that disagrees with what gets billed
     * is worse than no preview. That pulls the core into the direction of the
     * UI for the first time, which is precisely the pressure this list exists
     * to hold.
     *
     * So the screen does not reach the core. src/campaign/searchLanguages.ts
     * is one file that re-exports the language functions and nothing else,
     * and SearchLanguagePicker and CampaignLaunchPanel import that. The rule
     * is not about campaign-languages.ts, which is pure and harmless — it is
     * about the next component, which would reach in for a fetch primitive
     * and bypass the network policy without anybody noticing.
     *
     * On the server side _shared/campaignLanguages.ts is the same door: it
     * reads and writes rows, re-resolves the customer's CHOICE rather than
     * trusting a conclusion the client computed, and holds no discovery
     * logic. match-campaign is listed because it calls that door.
     *
     * If a component appears here instead of the seam, the seam has stopped
     * being a seam.
     */
    'src/campaign/searchLanguages.ts',
    'supabase/functions/_shared/campaignLanguages.ts',
    'supabase/functions/match-campaign/index.ts',
    /*
     * EXPAND SEARCH — the same seam, widened by one file rather than by one
     * component.
     *
     * src/campaign/searchExpansion.ts re-exports exactly one function and two
     * types, and deliberately NOT planExpansion: whether an expansion may be
     * sold, and what it excludes, is decided on the server holding the
     * campaign's real sweep history. A client computing its own answer would be
     * a second opinion about money.
     *
     * supply-discovery needs no new entry: it is already the seventh seam below,
     * and withoutAlreadyRead — how a deeper sweep drops the sources a campaign
     * already paid to read, after its own entitlement gate and never instead of
     * it — is one more function from the core it was already allowed to reach.
     */
    'src/campaign/searchExpansion.ts',
    /*
     * SOCIAL CONNECTIONS — the eighth seam, and it imports two pure tables.
     *
     * social/meta-capabilities.ts and social/acquisition.ts are claims about
     * what Meta, Reddit, VK and Telegram legitimately permit, each row carrying
     * its evidence and the date the documentation was read. The edge function
     * reports them to the admin screen and derives a connection's effective
     * status from them; it implements no capability judgement of its own,
     * because a second opinion about "may we read this" is exactly the thing
     * that must not drift.
     *
     * Neither module touches a fetch path, a rate limiter, a cache or a source
     * registry. If this function ever grows its own availability rule, the seam
     * has stopped being a seam.
     */
    'supabase/functions/social-connections/index.ts',
    /*
     * COMMUNITY SYNC — the ninth seam, and the one that writes.
     *
     * It reaches the Telegram preview client, the Community Evidence
     * contract, the observation planner, the direction classifier, the
     * hash and the language detector. Every one of those is a decision the
     * core owns: what a stable identity is, whether a re-observation is an
     * edit, which side of the market a sentence is on. The worker owns the
     * schedule, the lock and the SQL, and no judgement of its own.
     *
     * If it ever grows its own identity rule or its own direction verdict,
     * the seam has stopped being a seam.
     */
    'supabase/functions/community-sync/index.ts',
    /*
     * The same seam's source-discovery half: the multilingual public-chat
     * searches and the measured audit (telegram-sources.ts) decide which
     * communities are worth reading; the file only registers and records.
     */
    'supabase/functions/community-sync/sourceDiscovery.ts',
    /*
     * DISCOVERY SETTINGS — the one reader of the canonical active-demand
     * freshness policy. It parses the admin setting through
     * parseActiveDemandPolicy() so no function holds its own copy of "how old
     * may demand be".
     */
    'supabase/functions/_shared/discoverySettings.ts',
    /*
     * GLOBAL INTELLIGENCE READS — the same seam from the other direction.
     *
     * community-intelligence imports timeBounds(), truncUnit() and bucketCount()
     * and computes no window of its own. The rule it must not reimplement is that
     * a CALENDAR window is local and a DURATION is not: a second copy that got it
     * backwards would produce an off-by-one-day report that looks entirely
     * plausible, and nobody checks a plausible number.
     */
    'supabase/functions/community-intelligence/index.ts',
    /*
     * FIND PROPERTY -- and the seam that matters most here is assessMatch().
     *
     * supply-matching fixes a demand row and iterates supply; run-matching-v2 fixes a
     * property and iterates demand. Both MUST reach the same verdict about the same
     * pair, so both call the same comparison. If this worker ever grows its own idea of
     * what a compatible pair is, the product acquires a flat that matches a buyer whose
     * buyer does not match the flat -- and nothing would report it.
     *
     * It also consumes judgeDelivery() and the listing-age policy rather than
     * re-deciding freshness, because there are four clocks here and collapsing any two
     * of them is how a 2022 listing gets shown as current.
     */
    'supabase/functions/supply-matching/index.ts',
    /*
     * FIND PROPERTY, THE READ — and it consumes exactly one seam: the rule that
     * decides whether a broker is a Homatch registration or a firm we merely found.
     *
     * It is a seam rather than two lines of local logic because the answer is
     * customer-facing and irreversible in the way a wrong badge is: telling somebody
     * that a company we scraped off a portal is a registered Homatch partner is a
     * claim about a commercial relationship that does not exist. directoryStandingOf()
     * is the only function that can return anything but NOT_LISTED, it requires a
     * registration's own status and paid-until to do it, and discloseBroker() turns
     * that into the one label a screen may print. A second copy of that rule here
     * would be a second place for it to be wrong.
     */
    'supabase/functions/find-property/index.ts',
    /*
     * FIND PROPERTY, THE PLANNER -- and the seam here is the line between what a model
     * is allowed to decide and what it is not.
     *
     * A language model reads the customer's prose. Its output then passes through
     * normalisePlan(), which recognises every value out of a closed set or discards it
     * and says so. That function is in the core rather than in this function for the
     * ordinary reason -- it is tested, it is pure, and the browser needs the same
     * vocabulary to render the plan editor -- and for one specific to it: it is the only
     * thing standing between a model's JSON and a database filter. A second copy of it
     * here would be a second place for a city name to turn into an expression.
     *
     * Note what this function does NOT consume: nothing that scores, ranks or compares.
     * It writes an intent_profiles row and stops. supply-matching does the matching.
     */
    'supabase/functions/find-property-plan/index.ts',
    /*
     * NATIVE INTENT — the newest seam, and the rule it must not reimplement is who a
     * sentence is about.
     *
     * Both of these read intent/interpret.ts for the same four judgements: whose intent
     * a sentence expresses, what kind of thing was said, how firmly it was meant, and
     * how wide it reaches. Each of those, decided locally and differently, produces a
     * specific customer-facing harm — the worst being an owner told that somebody is
     * personally interested in their property when that person was talking about their
     * brother.
     *
     * They own their own plumbing and no judgement. send-message reads the property from
     * a column and the meaning from the shared reader; ingest-live-chat owns a cursor, a
     * batch and a gate before an expensive call, and asks the same reader the same
     * questions.
     *
     * Neither touches a fetch path, a rate limiter, a cache or a source registry. If
     * either grows its own attribution rule, the seam has stopped being a seam.
     */
    /*
     * _shared/intent.ts is the door itself: the one place a surface says what it
     * understood, and the one place validate() decides whether that may become trusted
     * state. It reaches validate() and nothing else in the core.
     */
    'supabase/functions/_shared/intent.ts',
    'supabase/functions/send-message/index.ts',
    'supabase/functions/ingest-live-chat/index.ts',
    /*
     * _shared/nativeDemand.ts is the pipeline every conversational surface shares: the
     * deterministic constraint reader, the plan gate and the effective-state resolver,
     * so the common room, a private message and an AI conversation cannot each grow a
     * reading of their own. It reaches intent/*, discovery/search-plan.ts and nothing
     * with a network path.
     */
    'supabase/functions/_shared/nativeDemand.ts',
    /*
     * EVIDENCE FRESHNESS — the sixth seam, and the one that decides what a
     * customer is allowed to see.
     *
     * The rules about which timestamp may move live in
     * discovery/revalidation.ts and nowhere else, because the failure they
     * prevent is subtle enough to be re-introduced by anybody
     * reimplementing them: a revalidation job whose fetch times out, setting
     * last_verified_at = now() in the same statement that records the
     * attempt, so the stalest evidence in the system becomes the evidence
     * that looks newest.
     *
     * _shared/evidenceFreshness.ts is the door. It reads rows, hands them to
     * applyRevalidation and judgeDelivery, and writes back what comes out. It
     * holds no rule of its own and performs no fetch.
     *
     * The two functions below are listed because they call that door:
     * run-matching-v2 is the only thing that turns external evidence into a
     * customer-visible row, so the delivery gate belongs there; and
     * revalidate-evidence is the worker that does the re-reading on its own
     * tick, so that neither a match run nor a page view ever puts somebody
     * else's server latency in front of a customer.
     *
     * If either grows its own copy of "advance last_verified_at", the seam
     * has stopped being a seam.
     */
    'supabase/functions/_shared/evidenceFreshness.ts',
    'supabase/functions/run-matching-v2/index.ts',
    /*
     * The legacy matcher consumes exactly one core module —
     * match/demand-freshness.ts — so that "how old may demand be" has one
     * definition across v1, v2 and supply-matching instead of three. It
     * touches no fetch path and no flow-control primitive.
     */
    'supabase/functions/run-matching/index.ts',
    'supabase/functions/revalidate-evidence/index.ts',
    /*
     * SUPPLY DISCOVERY — the seventh seam, and the widest.
     *
     * It is the production discovery path: it builds createPortalRuntime()
     * and asks the registered adapters for listings. That means it touches
     * more of the core than any other consumer — the runtime, the listing
     * model, language detection, hashing and entity resolution.
     *
     * It is still a seam rather than a consumer, and the test is what it
     * does NOT contain: no extractor, no fetch of its own, no source policy,
     * no resolution rule. It assembles the door, walks through it, and
     * writes down what it found. Every decision it makes is made by a pure
     * function in the core, which is what keeps those decisions testable
     * without a network.
     *
     * If a selector, a rate limit or a merge rule ever appears in this file,
     * the seam has stopped being a seam.
     */
    'supabase/functions/supply-discovery/index.ts',
    /*
     * DEMAND DISCOVERY — the supply seam's opposite number.
     *
     * It builds the same createPortalRuntime() and asks a forum reader for
     * posts instead of asking an adapter for listings. There is ONE fetch
     * path in this system, and a second one built for demand would be a
     * second place to get robots, rate limits and the SSRF allowlist wrong.
     *
     * Same rule as every other seam: it assembles the door and walks
     * through it. No post delimiter, no author pattern, no direction
     * lexicon, no boilerplate rule appears in this file -- those live in
     * adapters/forum and signals/direction, where they can be tested
     * without a network.
     */
    'supabase/functions/demand-discovery/index.ts',
    /*
     * SUPPLY REVALIDATION. It builds the same runtime to ask one question of
     * a page it has already read: is this still here, and does it still say
     * the same thing.
     *
     * It deliberately does NOT re-parse. Deciding here whether the price
     * moved would mean a second extraction path that could disagree with the
     * adapter, and two readers of one page is how a field ends up with two
     * truths. It compares a hash and nothing else.
     */
    'supabase/functions/revalidate-supply/index.ts',
    /*
     * CANDIDATE SOURCE AUDITING. It builds the runtime to ask five questions
     * of a host nobody has characterised yet: what robots permits, what the
     * sitemap names, and what one detail page publishes.
     *
     * The runtime is the reason this is allowed to exist at all. A host with
     * no SourcePolicy is refused before a request is made, so an auditor
     * cannot become a general-purpose fetcher pointed at whatever a row
     * happens to contain.
     */
    'supabase/functions/source-audit/index.ts',
    /*
     * PHASE 2 COMPLETION — two more deliberate seams, both read-only uses of
     * pure modules:
     *
     * findPropertySettlement counts one charge per PROPERTY: it normalizes the
     * delivered observations (discovery-entity.ts) and groups them with the
     * shared cross-source dedupe, so the bill and the screen agree on what one
     * property is. It fetches nothing and decides no price.
     *
     * DiscoveryIntelligencePanel renders the source readiness matrix
     * (source-capabilities.ts: the static matrix and sourceStatus()) inside the
     * Admin shell. It imports no fetch path, adapter or runtime.
     */
    'supabase/functions/_shared/findPropertySettlement.ts',
    'src/components/admin/DiscoveryIntelligencePanel.tsx',
    /*
     * FIND PROPERTY — MARKETPLACE SEARCH (research-core/marketplace).
     *
     * The edge functions run the pure brief/readiness/pipeline modules; the
     * customer screens import the same brief, readiness and handoff modules
     * (and types) so the client asks exactly the questions the server gate
     * checks. None of these seams imports a fetch path, adapter or runtime:
     * the marketplace modules are pure data in, data out.
     */
    'supabase/functions/_shared/marketplaceSearch.ts',
    // Existing read-only legacy catalogue reconstruction, shared by owned
    // marketplace dossiers and the existing paid AI chat context loader.
    'supabase/functions/_shared/marketplaceCatalogue.ts',
    'supabase/functions/marketplace-search/index.ts',
    'supabase/functions/marketplace-worker-ingest/index.ts',
    'src/services/marketplaceSearch.ts',
    'src/components/findProperty/CompareView.tsx',
    'src/components/findProperty/MarketplaceSearchExperience.tsx',
    'src/components/findProperty/PropertyIntelligence.tsx',
    'src/components/findProperty/ResultsView.tsx',
    'src/components/findProperty/SearchBuilder.tsx',
    'src/components/findProperty/format.ts',
    /*
     * PHASE 2 — UNIVERSAL DISCOVERY (docs/claude/PHASE2_DISCOVERY.md).
     *
     * find-property-run compiles a FIND PROPERTY run's DiscoveryPlan from the
     * stored SearchPlan (re-validated through normalisePlan) and reads the
     * portal runtime's adapter ids to know which registry adapters are
     * executable listing portals (building the runtime touches no network).
     * The driver maps a provider to its customer-safe source group for run
     * progress. Neither fetches: plans and names only.
     */
    'supabase/functions/find-property-run/index.ts',
    'supabase/functions/discovery-queue-worker/driver.ts',
    /* A listing post filtered out of demand is read by the deterministic
       community-listing extractor and stored as supply. Text in, fields out;
       no fetch. */
    'supabase/functions/_shared/communitySupply.ts',
  ]);

  const roots = ['src', 'supabase/functions', 'official-worker/src'];
  const offenders = [];

  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      if (entry === 'node_modules' || entry === 'research-core') continue;
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|mjs)$/.test(entry)) continue;
      /*
       * AN IMPORT, NOT A MENTION.
       *
       * This used to test the raw file text for the string "research-core",
       * which flags any file that so much as NAMES the core in a comment —
       * including a test whose entire subject is explaining which files are
       * allowed to reach it. Prose is not a dependency, and a guard that
       * cannot tell the difference teaches people to stop writing the
       * comment rather than to stop writing the import.
       *
       * Comments are stripped and only a real module specifier counts, so
       * the check now means what its name says. Everything in ALLOWED is
       * still caught: each one genuinely imports.
       */
      const body = code(readFileSync(full, 'utf8'));
      const importsCore =
        /(?:from|import)\s*\(?\s*['"][^'"]*research-core\/[^'"]*['"]/.test(body);
      if (!importsCore) continue;
      // rel() is relative to the CORE; these files are outside it, so the
      // comparison is made against the repository root instead.
      const relative = full
        .slice(process.cwd().length + 1)
        .split(String.fromCharCode(92))
        .join('/');
      if (!ALLOWED.has(relative)) offenders.push(relative);
    }
  };

  for (const root of roots) walk(join(process.cwd(), root));
  assert.deepEqual(
    offenders,
    [],
    `research-core reached from outside its integration seams: ${offenders.join(', ')}`,
  );
});

test('the public surface exports the bridge, not a second research system', () => {
  const index = read(join(ROOT, 'index.ts'));
  // Things that must be reachable.
  for (const name of ['toEvidenceItem', 'toActualUsage', 'budgetFor', 'documentFingerprint']) {
    assert.match(index, new RegExp(`\\b${name}\\b`), `index.ts does not export ${name}`);
  }
  // Things that must NOT exist at all.
  for (const forbidden of ['EvidenceRecord', 'RESEARCH_SCHEMA_SQL', 'SqlResearchStore', 'DEFAULT_COST_MODEL']) {
    assert.ok(
      !index.includes(forbidden),
      `index.ts exports ${forbidden}, which would duplicate an existing Homatch system`,
    );
  }
});
