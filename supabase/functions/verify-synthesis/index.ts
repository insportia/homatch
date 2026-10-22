// HOMATCH — the Buyer Intelligence Report.
//
// The customer-facing output of Verify. ONE editorial due-diligence briefing:
// what was found, what it means in context, what deserves attention, what
// could not be confirmed, and what this buyer should do before paying.
//
// WHAT CHANGED AND WHY
// --------------------
// This used to hand the model a list of finished sentences stripped of source,
// date, provenance and certainty — and the model, holding nothing to reason
// with, produced "a mortgage exists" where the research already knew the same
// bank publicly finances the project. buildEvidencePackage() now reads the
// WHOLE report (including `publicResearch`, which nothing read before) and
// keeps provenance attached, tiered so registry evidence is never crowded out
// by social noise.
//
// The safety property is unchanged and still enforced: the model may cite only
// evidence ids that exist, every substantial claim must carry one, and an
// output that fails is DISCARDED in favour of a deterministic report built
// from the same evidence. There is no path by which invented prose reaches a
// customer.
//
// Because of that fallback the function does not fail when OPENAI_API_KEY is
// absent or the provider is down: it returns the deterministic report and says
// so via `mode`.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { projectVerify } from '../../../src/dealroom/domain/assemble.ts';
import { buildEvidencePackage } from '../../../src/verify/intelligence/evidencePackage.ts';
import { officialHistoryView } from '../../../src/verify/intelligence/tasIntelligence.ts';
import { resolveIdentity } from '../../../src/verify/intelligence/propertyIdentity.ts';
import { persistableVisuals, toCustomerVisualAssets, withheldVisualCount, VISUAL_BUCKET, VISUAL_URL_TTL_SECONDS } from '../../../src/verify/intelligence/visualAssets.ts';
import { annotateVisualQuality, visualByteSizes } from '../../../src/verify/intelligence/visualQuality.ts';
import { withVisualDates } from '../../../src/verify/intelligence/visualDates.ts';
import { applyVisualRecovery, needsVisualRecovery } from '../../../src/verify/intelligence/visualRecovery.ts';
import { providerOutcomes } from '../../../src/verify/providerOutcomes.ts';
import { buildIntelligenceBundle } from '../../../src/verify/intelligence/bundle.ts';
import { draftSnapshot, segmentsFor } from '../../../src/verify/intelligence/marketSnapshot.ts';
import { writeSnapshot } from '../../../src/verify/intelligence/snapshotStore.ts';
import { districtOfAddress, cityOfAddress } from '../../../src/verify/intelligence/locationIntelligence.ts';
import { withNeighborhood } from '../../../src/verify/intelligence/locationIntelligence.ts';
import { resolveNeighborhood } from '../../../src/verify/intelligence/neighborhoodFetch.ts';
import { subjectMarketFacts } from '../../../src/verify/intelligence/marketHierarchy.ts';
import { projectSlug } from '../../../src/verify/intelligence/harvest.ts';
import { buildIntelligencePrompt } from '../../../src/verify/intelligence/prompt.ts';
import { resolveAssetClass } from '../../../src/verify/researchPlan.ts';
import { finalizeReport } from '../../../src/verify/intelligence/report.ts';
import { withPropertyRegister } from '../../../src/verify/intelligence/registerEnrichment.ts';
import { looksLikePersonName, redactPeopleSupport, scrubPersonalNumbersDeep } from '../../../src/verify/intelligence/peopleIntelligence.ts';
import { NBG_RATES_URL, parseNbgUsd, buildFxContext } from '../../../src/verify/intelligence/fx.ts';
import { REPORT_LOGIC_VERSION, shouldAutoUpgrade, versionMarkers, markUpgradeAttempted, logicVersionOf } from '../../../src/verify/intelligence/reportVersion.ts';
import { hasOwnRegister, reuseEarlierRegister, targetCadastralCode, type RegisterCandidate } from '../../../src/verify/intelligence/registerReuse.ts';
import { extractFreshness } from '../../../src/verify/intelligence/propertyRegister.ts';
import { buildUnitIdentity } from '../../../src/verify/intelligence/unitIdentity.ts';
import { explainTechnical } from '../../../src/verify/intelligence/technicalExplained.ts';
import { extractProjectSignals } from '../../../src/verify/intelligence/projectStory.ts';
import { keepStoryOnRebuild } from '../../../src/verify/intelligence/storyGuard.ts';
import { propertyKindFromResult, type PropertyKindResult } from '../../../src/verify/intelligence/propertyKind.ts';
import { finalBuyerAssessment } from '../../../src/verify/intelligence/buyerAssessment.ts';
import { READY_FAST_COLUMNS, canServeStoredFast, readEnrichmentMarkers } from '../../../src/verify/intelligence/reportReadPath.ts';
import { needsMarketRefresh } from '../../../src/verify/marketRefresh.ts';
import { planStoredTasTexts, applyStoredTasText } from '../../../src/verify/intelligence/tasCaseSources.ts';
import type { FxContext } from '../../../src/verify/intelligence/fx.ts';
import { parseTranslateRequest } from '../../../src/verify/translation/textTranslation.ts';
import { translateTexts } from './translate.ts';

/**
 * GEL/USD context from the National Bank of Georgia.
 *
 * Strictly best-effort and strictly bounded: a 4s timeout, and ANY failure
 * yields null so the report simply omits the section. FX is useful colour on
 * a historical change, never a reason for the report to be late or to fail.
 */
async function fetchFx(historicalDate: string | null): Promise<FxContext | null> {
  if (!historicalDate) return null;
  const today = new Date().toISOString().slice(0, 10);
  const get = async (date: string) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    try {
      const url = date === today ? NBG_RATES_URL : `${NBG_RATES_URL}?date=${date}`;
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return null;
      return parseNbgUsd(await res.json(), date);
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  };
  const [then, now] = await Promise.all([get(historicalDate), get(today)]);
  return buildFxContext(then, now);
}

/** The earliest dated evidence, used as the "then" point for FX context. */
function earliestEvidenceDate(items: { date?: string }[]): string | null {
  const dates = items
    .map((i) => i.date)
    .filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}/.test(d))
    .sort();
  return dates[0] ?? null;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-driver',
};
/*
 * THE FINAL SYNTHESIS MODEL.
 *
 * This is the one call that writes the customer's Buyer Intelligence report:
 * the research is already finished and stored, and the model's job here is to
 * reason over the completed evidence package, not to look anything up.
 *
 * OPENAI_SYNTHESIS_MODEL exists so that model can be changed for THIS stage
 * alone. OPENAI_MODEL is shared with research-agent's own report accounting,
 * so moving it would silently move two things at once.
 *
 * PINNED MEANS NO FALLBACK.
 *
 * When OPENAI_SYNTHESIS_MODEL is set, the run is an experiment about that
 * model, and a refusal must be visible as a refusal. Before this, a non-ok
 * response was dropped on the floor — `if (res.ok)` and nothing else — so an
 * unknown model id (404) or an unauthorised project (403) produced a
 * deterministic report that looked exactly like success. That is the one
 * outcome an experiment must never produce.
 */
/*
 * THE FINAL SYNTHESIS MODEL.
 *
 * gpt-5.6-luna. The GPT-6 Astra experiment ran on this stage and was ended:
 * the reports it produced were not an improvement on the ones this model
 * writes, so the stage is back on the model that was already proven for it.
 * Nothing else about the experiment is kept — there is no second model, no
 * A/B, and no dormant switch waiting to be flipped.
 *
 * OPENAI_SYNTHESIS_MODEL still overrides it, for moving THIS stage without a
 * deploy. OPENAI_MODEL deliberately does not: it is shared with
 * research-agent's report accounting, and changing it would move two things
 * at once.
 */
const VERIFY_SYNTHESIS_MODEL = 'gpt-5.6-luna';
const SYNTHESIS_MODEL_OVERRIDE = (Deno.env.get('OPENAI_SYNTHESIS_MODEL') ?? '').trim();
const MODEL = SYNTHESIS_MODEL_OVERRIDE || VERIFY_SYNTHESIS_MODEL;
/* The report's content in the customer's language (`translate`, translate.ts):
   the synthesis model unless OPENAI_TRANSLATION_MODEL moves this stage alone. */
const TRANSLATION_MODEL = (Deno.env.get('OPENAI_TRANSLATION_MODEL') ?? '').trim() || MODEL;

/*
 * WHICH FAILURES DEGRADE QUIETLY, AND WHICH DO NOT.
 *
 * KEPT from the experiment, deliberately. Before it, a non-ok response was
 * dropped on the floor — `if (res.ok)` and nothing else — so an unknown model
 * id or an unauthorised project produced a deterministic report that looked
 * exactly like a successful one. That was a real defect independent of which
 * model is configured, and restoring Luna is no reason to restore it.
 *
 * A refusal meaning "this model is not available to you" is reported. A
 * transient 429 or 503 still degrades the prose, because a blip says nothing
 * about whether the model is the right one and a customer would rather have
 * the deterministic report than none.
 */
const MODEL_UNAVAILABLE_STATUSES = new Set([400, 401, 403, 404]);

const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

function textOf(p: any): string {
  if (p?.output_text) return p.output_text;
  const a: string[] = [];
  for (const i of p?.output || []) {
    if (i?.type === 'message') for (const c of i.content || []) if (c?.type === 'output_text' && c.text) a.push(c.text);
  }
  return a.join('\n').trim();
}

/**
 * Write the finished report down.
 *
 * Deliberately best-effort: the customer standing in front of a freshly built
 * report must get it even if the write fails. A failed write only costs a
 * rebuild later — swallowing the report to report a storage error would cost
 * the thing they actually asked for.
 */
/*
 * WRITING THE REPORT BACK.
 *
 * This used to write through the CALLER's client and swallow whatever came
 * back. There is an RLS policy letting an owner update their own
 * research_jobs row, but the `authenticated` role has no table-level UPDATE
 * grant — and a policy filters ROWS, it does not grant privileges. So every
 * write failed with "42501 permission denied for table research_jobs", the
 * error went into a console line, and a freshly generated report was billed,
 * returned once and lost. The next view regenerated it and lost it again.
 *
 * The fix is not a new grant. Widening UPDATE on research_jobs to every
 * authenticated user would let somebody rewrite their own result_json, which
 * later feeds AI context — a much bigger door than the one being closed.
 * Writing the report back is a SERVER action, so it uses the service client,
 * exactly as the driver branch already does.
 *
 * The authorisation is unchanged and happens before this is ever reached: the
 * job was loaded through the caller's own RLS-scoped client, so a caller can
 * only ever persist for a job they were already allowed to see.
 */
/*
 * OFFICIAL TAS VISUALS, DELIVERED AS SHORT-LIVED SIGNED URLS.
 *
 * The persisted report holds a bucket path per visual; the customer never
 * sees one. At read time — after the job was loaded through the CALLER'S
 * RLS client, so only its owner reaches this — each path becomes a signed
 * URL valid for one hour, and the path is removed. Internal usage numbers
 * leave the response too. A visual that cannot be signed is simply omitted:
 * the textual report stands on its own.
 */
// Visual Property Intelligence: every customer-visible asset (≤ VISUAL_ASSET_MAX),
// as VerifyVisualAsset (src/verify/intelligence/visualAssets.ts), signed in ONE
// storage call. UNRELATED_SUSPECT assets never reach this list.
// `jobId` travels with the answer so the report can open official files
// through the secure viewer (research-agent `document_file`); the caller
// already knows it, nothing new is disclosed.
async function forCustomer(db: any, payload: Record<string, unknown>, jobId?: string): Promise<Record<string, unknown>> {
  const { _usage: _droppedUsage, _timing: _droppedTiming, officialVisuals, ...stripped } = payload as Record<string, any>;
  const rest: Record<string, any> = jobId ? { ...stripped, jobId } : stripped;
  // Personal numbers never reach the browser, whatever an older build stored.
  if (rest.people) rest.people = redactPeopleSupport(rest.people);
  for (const k of ['report', 'evidence', 'evidenceGroups', 'officialHistory', 'officialDocuments', 'people', 'participants', 'projectTeam', 'projectTeamV2', 'identity']) if (rest[k]) rest[k] = scrubPersonalNumbersDeep(rest[k]);
  // Fresh photographs (freshPhotos.ts): each bucket path becomes a signed URL
  // in the same bucket with the same TTL; an unsignable photo is omitted.
  if (Array.isArray(rest.freshPhotos?.photos) && rest.freshPhotos.photos.length) {
    const fp = rest.freshPhotos;
    const paths = fp.photos.map((p: any) => String(p?.path ?? '')).filter(Boolean);
    const urls: Record<string, string | null> = {};
    if (paths.length) {
      const { data, error } = await db.storage.from(VISUAL_BUCKET).createSignedUrls(paths, VISUAL_URL_TTL_SECONDS).catch((e: unknown) => ({ data: null, error: e }));
      if (!error) for (const d of Array.isArray(data) ? data : []) if (d?.path) urls[d.path] = d.signedUrl ?? null;
    }
    rest.freshPhotos = {
      ...fp,
      photos: fp.photos.flatMap((p: any) => {
        const url = urls[String(p?.path ?? '')];
        if (!url) return [];
        const { path: _path, ...photo } = p;
        return [{ ...photo, url }];
      }),
    };
  }
  if (!Array.isArray(officialVisuals) || !officialVisuals.length) return rest;
  const signed = await toCustomerVisualAssets(
    officialVisuals,
    async (paths, ttl) => {
      const out: Record<string, string | null> = {};
      const { data, error } = await db.storage.from(VISUAL_BUCKET).createSignedUrls(paths, ttl);
      if (error) throw error;
      for (const d of Array.isArray(data) ? data : []) if (d?.path) out[d.path] = d.signedUrl ?? null;
      return out;
    },
    { explanations: rest?.report?.visualExplanations, ttlSeconds: VISUAL_URL_TTL_SECONDS },
  ).catch(() => []);
  // Found but not shown (blank / strip / unsignable): counted, so the gallery
  // says images exist but could not be presented instead of "none found".
  const withheld = withheldVisualCount(officialVisuals, signed.length);
  const out = signed.length ? { ...rest, officialVisuals: signed } : rest;
  return withheld ? { ...out, officialVisualsWithheld: withheld } : out;
}

function officialDocumentPages(result: any): number {
  let n = 0;
  for (const r of Array.isArray(result?.browserOfficial?.results) ? result.browserOfficial.results : []) {
    for (const d of Array.isArray(r?.documents) ? r.documents : []) {
      const p = Number(d?.pagesRead ?? d?.pageCount);
      if (Number.isFinite(p) && p > 0 && p < 2000) n += p;
    }
  }
  return n;
}

/** What this verification reviewed, in counts a customer can read. */
function researchCoverage(job: any, pkg: any, bundle: any): Record<string, unknown> {
  const tas = pkg?.tas;
  const ledger = job?.result_json?._marketplaceLedger;
  return {
    researchedAt: job?.completed_at ?? null,
    latestOfficialDocumentDate: tas?.coverage?.latestDate ?? null,
    earliestOfficialDocumentDate: tas?.coverage?.earliestDate ?? null,
    officialCasesReviewed: tas?.coverage?.cases ?? 0,
    officialStepsReviewed: tas?.coverage?.motions ?? 0,
    officialAttachmentsRead: tas?.coverage?.attachmentsRead ?? 0,
    // Real page counts only: TAS attachments read + every official document
    // the browser workers opened (register extracts, company extracts …).
    officialPagesRead: (tas?.coverage?.pagesRead ?? 0) + officialDocumentPages(job?.result_json),
    officialFactsConsolidated: Array.isArray(tas?.facts) ? tas.facts.length : 0,
    // The funnel: discovered → processed → retained → selected → shown.
    officialRecordsDiscovered: tas?.funnel?.discoveredDocuments ?? 0,
    officialAttachmentsDiscovered: tas?.funnel?.discoveredAttachments ?? 0,
    officialEvidenceSelectedForSynthesis: pkg?.items ? pkg.items.filter((i: any) => i.tasRef).length : 0,
    officialMilestonesShown: tas?.funnel?.milestones ?? 0,
    officialProcessingIncomplete: tas?.funnel?.incomplete === true,
    // analyzedCount: every priced listing scored (count is now the HEADLINE
    // sample, which is 0..2 when the market is EVIDENCE_LIMITED).
    marketListingsAnalyzed: typeof bundle?.market?.analyzedCount === 'number'
      ? bundle.market.analyzedCount
      : typeof bundle?.market?.count === 'number' ? bundle.market.count : 0,
    marketplaceListingsAdded: typeof ledger?.added === 'number' ? ledger.added : 0,
    // Per provider, the state only — reasons and errors stay in Admin.
    providers: providerOutcomes(job?.result_json, job?.mode === 'cadastral' ? ['tas', 'mygov'] : []).map((o) => ({ provider: o.provider, state: o.state })),
  };
}

/*
 * What the read-time corrections need beyond the job row. Read-only and
 * best-effort: the ad-search cost record is fetched only when the report
 * carries no ad result (jobs finished before PR #138 lost it; the enrichment
 * itself ignores it whenever the job kept its own stage result), and the admin
 * policy only to know the searched country. A failed read changes nothing.
 */
async function enrichmentContext(db: any, job: any): Promise<{ completedAt: string | null; adsCost: any; adsPolicy: unknown }> {
  const ctx = { completedAt: job?.completed_at ?? null, adsCost: null as any, adsPolicy: null as unknown };
  if (job?.synthesis_json?.developerAds) return ctx;
  try {
    const { data } = await db
      .from('cost_events')
      .select('success,source,timestamp')
      .eq('job_id', job.id)
      .eq('operation_type', 'DEVELOPER_ADS_VERIFY')
      .order('timestamp', { ascending: false })
      .limit(1);
    ctx.adsCost = data?.[0] ?? null;
    if (ctx.adsCost) {
      const { data: setting } = await db.from('admin_settings').select('value').eq('key', 'verify_developer_ads').maybeSingle();
      ctx.adsPolicy = setting?.value ?? null;
    }
  } catch {
    /* nothing recovered */
  }
  return ctx;
}

async function persist(db: any, jobId: string, payload: unknown): Promise<void> {
  const { error } = await db
    .from('research_jobs')
    .update({
      synthesis_json: payload,
      synthesis_state: 'READY',
      synthesis_at: new Date().toISOString(),
    })
    .eq('id', jobId);

  if (error) {
    // Loud, because a silent failure here costs a model call every view.
    console.error(`verify-synthesis: could not persist report for ${jobId}: ${error.message ?? error}`);
  }
}

/*
 * A REPORT ALREADY WRITTEN CAN STILL BE WRONG.
 *
 * The participants parser used to read shareholders by proximity to the word
 * "share", which turned the lines following the real rows into eight
 * registered shareholders of the developer that do not exist — "we
 * additionally inform you", "is not registered", "of the public registry".
 *
 * That is fixed at the parser, but those names are already sitting in
 * synthesis_json for every report generated before the fix, and a persisted
 * report is served as a READ: it never passes through the parser again.
 *
 * Regenerating would mean a model call, and a charge, for every historical
 * case. Re-checking the names on the way out costs nothing and covers all of
 * them. A participant whose name is administrative vocabulary rather than a
 * person is dropped; everything else is left exactly as written.
 */
function withCredibleParticipants(payload: Record<string, unknown>): Record<string, unknown> {
  const people = payload?.people as { people?: unknown[] } | undefined;
  if (!people || !Array.isArray(people.people)) return payload;

  const kept = people.people.filter((p) => {
    const name = (p as Record<string, unknown>)?.name;
    return typeof name === 'string' && looksLikePersonName(name);
  });
  if (kept.length === people.people.length) return payload;

  console.warn(
    `verify-synthesis: dropped ${people.people.length - kept.length} non-credible participant(s) from a persisted report`
  );
  return { ...payload, people: { ...people, people: kept } };
}


/*
 * WHAT THIS VERIFICATION LEARNED ABOUT THE MARKET.
 *
 * A snapshot is written for the NARROWEST segment the property genuinely
 * belongs to — its project if we know one, otherwise its district, otherwise
 * its city. Only one, and only the narrowest: writing the same median against
 * a project AND a district AND a city would let a single building's prices
 * masquerade as a district answer for every other building in it.
 *
 * draftSnapshot refuses anything too thin to be worth reusing, so a run that
 * found two listings stores nothing rather than storing something that would
 * immediately force a refresh.
 *
 * Never throws. Bookkeeping must not cost a customer their report.
 */
async function recordMarketSnapshot(db: any, job: any, bundle: any): Promise<void> {
  try {
    const market = bundle?.market;
    if (!market) return;

    /*
     * A RUN THAT REUSED A SNAPSHOT HAS NOTHING NEW TO SAY ABOUT THE MARKET.
     *
     * It was handed the range and told not to rebuild it, so it searched less
     * and gathered fewer comparables by design. Writing its market back would
     * replace the snapshot it just leaned on with a thinner copy — and the run
     * after that would be thinner still, until confidence fell to LOW and
     * forced the full refresh this was meant to avoid.
     *
     * Production showed the first step: a reusing run wrote source_count 1 over
     * a snapshot built from 2. The store also refuses to accept a weaker
     * replacement, but the honest place to stop is here, where we know the run
     * was never asked to research a market in the first place.
     */
    const marketPlan = job?.result_json?._reusePlan?.marketPlan;
    if (marketPlan && marketPlan.refresh === false) {
      console.log(
        'verify-synthesis: market snapshot for ' + job.id +
        ' — not rewritten, this run reused an existing snapshot'
      );
      return;
    }

    const profile = job?.result_json?.projectProfile ?? {};
    const address = profile.address ?? bundle?.snapshot?.address ?? null;

    const segments = segmentsFor({
      projectSlug: projectSlug(profile.name),
      district: districtOfAddress(address),
      city: cityOfAddress(address),
      propertyType: 'RESIDENTIAL',
      /*
       * ROOMS ARE DELIBERATELY NOT IN THE KEY YET.
       *
       * A segment key has to be computable identically BEFORE research (to
       * find a snapshot) and AFTER it (to store one). Room count is only known
       * afterwards, so keying on it would mean every lookup missed and every
       * write landed in a segment nothing could ever find again — the most
       * expensive possible outcome, since it costs the write and saves
       * nothing.
       *
       * The column exists and roomBandOf() is tested, so this becomes a key
       * dimension the moment rooms are known at plan time. Until then the
       * honest key is the one both ends can actually compute.
       */
      rooms: null,
    });
    if (!segments.length) return;

    /*
     * Distinct sources behind the comparables. One portal is one opinion, and
     * confidence should know the difference.
     */
    const comparables = Array.isArray(job?.result_json?.market?.comparables)
      ? job.result_json.market.comparables
      : [];
    const sourceCount = new Set(
      comparables.map((c: any) => String(c?.source ?? '').trim().toLowerCase()).filter(Boolean)
    ).size;

    const draft = draftSnapshot(segments[0], market, {
      sourceCount: Math.max(1, sourceCount),
      refreshReason: job?.result_json?._marketPlan?.reasons?.[0] ?? 'INITIAL',
    });
    if (!draft) return;

    const out = await writeSnapshot(db, draft, {
      jobId: job.id,
      city: cityOfAddress(address) ?? null,
      district: districtOfAddress(address) ?? null,
    });

    console.log(
      'verify-synthesis: market snapshot for ' + job.id + ' — ' +
      (out.written
        ? `${out.segmentKey} ${draft.confidence} (${draft.usableComparableCount} comparables${out.superseded ? ', superseded previous' : ''})`
        : `not written: ${out.reason ?? 'unknown'}`)
    );
  } catch (e) {
    console.error('verify-synthesis: market snapshot threw', e instanceof Error ? e.message : String(e));
  }
}

/*
 * THE REGISTER FROM THE BUYER'S OWN EARLIER CHECK (registerReuse.ts).
 *
 * Only when this job's own result yields no extract. Same user_id, same
 * exact cadastral code, COMPLETE, earlier, newest first, at most five
 * candidates — read with the service client because the decision is a
 * server one, but scoped to the job owner's own rows, never cross-user. Each
 * candidate's browserOfficial is fetched alone so five full result_json
 * blobs are never pulled at once. Best-effort: any failure means no reuse.
 */
async function loadEarlierRegister(db: any, job: any, rj: any) {
  try {
    const userId = job?.user_id;
    const code = targetCadastralCode(rj, job?.query ?? null);
    if (!userId || !code) return null;
    const queries = [...new Set([String(job?.query ?? '').trim(), code].filter(Boolean))];
    const { data: ids, error } = await db
      .from('research_jobs')
      .select('id,completed_at')
      .eq('user_id', userId)
      .eq('status', 'COMPLETE')
      .is('deleted_at', null)
      .in('query', queries)
      .neq('id', job.id)
      .lt('completed_at', job.completed_at ?? new Date().toISOString())
      .order('completed_at', { ascending: false })
      .limit(5);
    if (error || !Array.isArray(ids) || !ids.length) return null;
    for (const row of ids) {
      const { data } = await db
        .from('research_jobs')
        .select('id,completed_at,browserOfficial:result_json->browserOfficial')
        .eq('id', row.id)
        .eq('user_id', userId)
        .maybeSingle();
      if (!data) continue;
      const candidate: RegisterCandidate = { id: data.id, completedAt: data.completed_at ?? null, browserOfficial: data.browserOfficial };
      const reused = reuseEarlierRegister(rj, code, [candidate]);
      if (reused) return reused;
    }
  } catch (e) {
    console.warn('verify-synthesis: earlier register lookup failed', e instanceof Error ? e.message : String(e));
  }
  return null;
}

/*
 * ONE AUTO-UPGRADE PER REPORT AND VERSION (reportVersion.ts).
 *
 * The claim is a compare-and-set on the row the caller just read: READY and
 * the same synthesis_at. Exactly one concurrent opener wins; the others see
 * PENDING and are answered "pending" by the ordinary guard, exactly like an
 * in-flight first build. The stored report stays in synthesis_json until the
 * rebuilt one replaces it.
 */
async function claimUpgrade(db: any, job: any): Promise<boolean> {
  try {
    let q = db
      .from('research_jobs')
      .update({ synthesis_state: 'PENDING', synthesis_at: new Date().toISOString() })
      .eq('id', job.id)
      .eq('synthesis_state', 'READY');
    q = job.synthesis_at ? q.eq('synthesis_at', job.synthesis_at) : q.is('synthesis_at', null);
    const { data, error } = await q.select('id');
    return !error && Array.isArray(data) && data.length === 1;
  } catch {
    return false;
  }
}

/** A failed upgrade puts the stored report back, marked so it is not retried on every open. */
async function restoreAfterFailedUpgrade(db: any, job: any): Promise<void> {
  const { error } = await db
    .from('research_jobs')
    .update({ synthesis_state: 'READY', synthesis_json: markUpgradeAttempted(job.synthesis_json ?? {}), synthesis_at: job.synthesis_at ?? new Date().toISOString() })
    .eq('id', job.id);
  if (error) console.error(`verify-synthesis: could not restore report for ${job.id}: ${error.message ?? error}`);
}

/*
 * THE BUILD — one path for a first synthesis, a forced rebuild and an
 * auto-upgrade alike (same evidence, same model call, same gates).
 */
/*
 * TAS text past the worker's inline cap (tasCaseSources.planStoredTasTexts):
 * the stored originals of the priority cases, read once per build from the
 * private verify-evidence bucket with the service client. Bounded (two
 * documents, 1.6M characters, 8 s each, in parallel); a failure leaves the
 * inline excerpt, exactly as before. Memory only: result_json is not written.
 */
/** Private bucket holding the full stored source texts (written by verify-queue). */
const EVIDENCE_BUCKET = 'verify-evidence';
async function hydrateStoredTasTexts(db: any, rj: any, timing: Record<string, unknown>): Promise<void> {
  const started = performance.now();
  const plan = planStoredTasTexts(rj);
  if (!plan.length) return;
  const read = await Promise.all(plan.map(async (p) => {
    try {
      const dl = db.storage.from(EVIDENCE_BUCKET).download(p.path);
      const res: any = await Promise.race([dl, new Promise((r) => setTimeout(() => r({ error: 'timeout' }), 8000))]);
      if (res?.error || !res?.data) return false;
      return applyStoredTasText(rj, p.documentId, await res.data.text(), p.chars);
    } catch {
      return false;
    }
  }));
  timing.storedTasTexts = { planned: plan.length, applied: read.filter(Boolean).length, chars: plan.reduce((n, p) => n + p.chars, 0), ms: Math.round(performance.now() - started) };
}

async function buildReport(job: any, writer: any, opts: { autoUpgrade: boolean; trigger: 'research' | 'driver' | 'customer'; forced: boolean }): Promise<Record<string, unknown>> {
  const jobId: string = job.id;
  // Build timing (internal, src/verify/performance.ts): server clock only,
  // stored as synthesis_json._timing and stripped by forCustomer().
  const timing: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    trigger: opts.autoUpgrade ? 'upgrade' : opts.trigger,
    forced: opts.forced,
  };
  /* The unit's register: this job's own, or — when its Service 176 task
     yielded none — the buyer's own earlier extract for the same exact unit. */
  let rj: any = job.result_json ?? {};
  let registerSource: { jobId: string; asOf: string | null; reused: true; freshExtractAdvised: boolean } | null = null;
  if (!hasOwnRegister(rj)) {
    const reused = await loadEarlierRegister(writer, job, rj);
    if (reused) {
      rj = reused.resultJson;
      registerSource = { ...reused.registerSource, freshExtractAdvised: extractFreshness(reused.register).freshExtractAdvised };
    }
  }
  // The projection still supplies the deterministic property model (type,
  // buyer plan, what completed and what did not). The evidence package is
  // what the model reasons over.
  const projection = projectVerify({ jobId: job.id, report: rj });
  // "Now" is the job's own completion: a date the papers cite after it is never a decision.
  await hydrateStoredTasTexts(writer, rj, timing);
  const pkg = buildEvidencePackage(rj, { now: job.completed_at ?? null });
  // Identity from OFFICIAL records only (TAS cases, registry documents and evidence) — never listings.
  const identity = resolveIdentity(rj?.exactUnit?.code ?? job.query ?? null, {
    tas: rj?.browserOfficial, documents: rj?.documents, official: rj?.officialEvidence, rights: rj?.rightsAndRestrictions, land: rj?.landProfile,
    // The unit's own NAPR record (identity-bound Service 176 facts) documents the exact unit.
    register: rj?.service176Evidence,
  });
  // Exact unit / parent parcel / building / project / ownership, from official records only (unitIdentity.ts).
  const unitIdentity = buildUnitIdentity(rj, job.query ?? null);

  // Market, location, people and the buyer's own official self-checks are
  // computed deterministically here; the model is handed the RESULT and asked
  // to explain it, never to do the arithmetic.
  /* Source-verified neighbourhood (OpenStreetMap, neighborhood.ts): measured
     here, in parallel with FX, and stored with the report so opening it never
     refetches. A failure is stored as UNAVAILABLE; there is no LLM fallback. */
  const neighborhoodP = resolveNeighborhood({
    resultJson: rj,
    query: job.query ?? null,
    // v6 (job eeefada9): the register's own address when the package has none.
    address: pkg.subject?.address ?? subjectMarketFacts(rj).address ?? null,
    previous: job.synthesis_json?.location?.neighborhood,
    earlierBrowserOfficial: async (parcel: string) => {
      const { data } = await writer.from('research_jobs').select('bo:result_json->browserOfficial')
        .like('query', `${parcel}%`).neq('id', jobId).order('created_at', { ascending: false }).limit(8);
      return (data ?? []).map((r: any) => r?.bo);
    },
  });
  const fx = await fetchFx(earliestEvidenceDate(pkg.items));
  const bundle = buildIntelligenceBundle(rj, pkg, fx);
  /* v7: what the register says this property IS (parking, land, apartment…), for the prompt and the story. */
  let subjectKind: PropertyKindResult | null = null;
  try {
    subjectKind = propertyKindFromResult(rj);
  } catch {
    subjectKind = null;
  }
  bundle.location = withNeighborhood(bundle.location, await neighborhoodP);

  /*
   * WHAT THIS VERIFICATION LEARNED ABOUT THE MARKET, KEPT.
   *
   * bundle.market is the deterministic answer — median, band, tier, sample
   * size — computed from comparables that were actually gathered. Until now
   * it was quoted once and discarded, so the next flat in the same building
   * paid for the same five-band sweep to rebuild it. That sweep is 45% of
   * what a Verify costs.
   *
   * Stored against the SEGMENT it describes rather than the job that
   * happened to compute it. Bookkeeping: it runs after the report is safe
   * and can never cost a customer their answer.
   */
  await recordMarketSnapshot(writer, job, bundle);

  // No evidence at all is a legitimate outcome, not an error: every source
  // may have been technically unavailable. Say so plainly rather than
  // returning an empty report that reads like a clean bill of health.
  if (!pkg.items.length) {
    const emptyPayload = {
      report: null,
      mode: 'DETERMINISTIC' as const,
      propertyType: projection.propertyType,
      snapshot: bundle.snapshot,
      selfChecks: bundle.selfChecks,
    /*
     * DETERMINISTIC, SO A QUIET MODEL CANNOT DELETE THEM.
     *
     * The live Villion synthesis returned evidenceUsed: [] and
     * nextSteps: [] while the report displayed a company id, two
     * shareholders and a registered pledge. These three are computed from
     * the evidence package and the market scoring, so they exist whenever
     * the underlying evidence does.
     */
    evidenceGroups: bundle.evidenceGroups,
    checklist: bundle.checklist,
    comparableSelection: bundle.comparables,
      empty: true,
      ...versionMarkers(job.synthesis_json, opts.autoUpgrade),
    };
    // "No evidence at all" is a real, final answer, not a failure to retry.
    timing.persistAt = new Date().toISOString();
    (emptyPayload as Record<string, unknown>)._timing = timing;
    await persist(writer, jobId, emptyPayload);
    const { _timing: _droppedEmptyTiming, ...emptyForCustomer } = emptyPayload as Record<string, unknown>;
    return emptyForCustomer;
  }

  let raw: string | null = null;
  // Token usage of THIS call, kept with the report for COGS and Admin.
  // It used to be discarded, leaving the final synthesis unmetered.
  let usage: { model: string; inputTokens: number | null; outputTokens: number | null; cachedTokens: number | null } | null = null;
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (apiKey) {
    // The asset class decides which sections this property can even have:
    // a plot of land has no building quality, and a heading with nothing
    // real under it gets filled with something.
    const { system, user } = buildIntelligencePrompt(pkg, bundle, resolveAssetClass(rj), {
      identity,
      unitIdentity,
      // Provenance for the prose, without the internal job id.
      registerSource: registerSource ? { asOf: registerSource.asOf, reused: true, freshExtractAdvised: registerSource.freshExtractAdvised } : null,
      propertyKind: subjectKind,
    });
    try {
      timing.modelStartedAt = new Date().toISOString();
      const res = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          input: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });
      timing.modelEndedAt = new Date().toISOString();
      if (res.ok) {
        const body = await res.json();
        raw = textOf(body);
        const u = body?.usage ?? null;
        usage = {
          model: MODEL,
          inputTokens: typeof u?.input_tokens === 'number' ? u.input_tokens : null,
          outputTokens: typeof u?.output_tokens === 'number' ? u.output_tokens : null,
          cachedTokens: typeof u?.input_tokens_details?.cached_tokens === 'number' ? u.input_tokens_details.cached_tokens : null,
        };
      } else {
        // The provider's own words, not a summary of them.
        const detail = (await res.text()).slice(0, 500);
        const reason = `SYNTHESIS_MODEL_UNAVAILABLE: ${MODEL} refused: HTTP ${res.status} ${detail}`;
        if (MODEL_UNAVAILABLE_STATUSES.has(res.status)) throw new Error(reason);
        console.error(reason);
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      // Re-throw the availability refusal raised just above; a transport
      // failure is transient and degrades the prose, never the report.
      if (reason.startsWith('SYNTHESIS_MODEL_UNAVAILABLE')) throw e;
      console.error('synthesis model call failed', reason);
    }
  }

  // The bundle travels into finalize so the deterministic facts can veto a
  // model statement that contradicts them — see stripFalseScarcity.
  const final = finalizeReport(pkg, raw, bundle);
  if (final.mode === 'DETERMINISTIC' && final.rejectedBecause.length) {
    // Worth knowing about: a model that keeps failing the gate is a
    // prompt/model problem we want visible in logs, not silently absorbed.
    console.warn('buyer intelligence rejected', JSON.stringify(final.rejectedBecause));
  }

  /* The project's signals, read once: the status cards and the story guard use them. */
  const projectSignals = extractProjectSignals(rj);
  /* v7 (owner, 2026-10-11): an automatic rebuild keeps the stored chapters
     (the editorial baseline); every story passes the continuity guard. */
  const propertyStory = keepStoryOnRebuild(job.synthesis_json, final.propertyStory, { autoUpgrade: opts.autoUpgrade, evolution: projectSignals?.evolution, kind: subjectKind?.kind ?? null });
  const built = {
    /* Which model actually wrote this, for COGS and for inspection. */
    synthesisModel: MODEL,
    synthesisModelPinned: true,
    report: {
      // v3: summary + keyFindings replace overallView/executiveSummary, and
      // the pre-purchase checklist is gone rather than renamed.
      summary: final.summary,
      // The latest confirmed official position, the documented history
      // oldest-first, and one caption per official TAS visual.
      ...(final.currentStatus ? { currentStatus: final.currentStatus } : {}),
      ...(propertyStory ? { propertyStory } : {}),
      ...(final.visualCaptions ? { visualCaptions: final.visualCaptions } : {}),
      ...(final.visualExplanations?.length ? { visualExplanations: final.visualExplanations } : {}),
      keyFindings: final.keyFindings,
      sections: final.sections,
      attentionPoints: final.attentionPoints,
      finalView: final.finalView,
      contractUpload: final.contractUpload,
      // Final narrative pass (2026-10-11): deterministic, from stored evidence.
      // The glossary cards for the technical facts, and what the record says
      // about the works (audit finding, site photos, the project's own
      // statement) for the three-track story. buyerAssessment is set below,
      // once the register has been merged in.
      technicalExplained: explainTechnical({ specs: pkg.dossier?.technicalSpecs ?? [], publicResearch: rj?.publicResearch, team: pkg.dossier?.projectTeamV2 ?? [] }),
      projectSignals,
    },
    // The sources behind the prose, so the UI can offer them underneath
    // without the customer having to read raw research output.
    evidence: final.evidenceUsed,
    snapshot: bundle.snapshot,
    market: bundle.market,
    location: bundle.location,
    people: bundle.people,
    fx: bundle.fx,
    // Official checks the BUYER can run. These replace the old inventory of
    // what our own pipeline could not retrieve.
    selfChecks: bundle.selfChecks,
    /*
     * DETERMINISTIC, SO A QUIET MODEL CANNOT DELETE THEM.
     *
     * The live Villion synthesis returned evidenceUsed: [] and
     * nextSteps: [] while the report displayed a company id, two
     * shareholders and a registered pledge. These three are computed from
     * the evidence package and the market scoring, so they exist whenever
     * the underlying evidence does.
     */
    evidenceGroups: bundle.evidenceGroups,
    checklist: bundle.checklist,
    comparableSelection: bundle.comparables,
    // Reusable by Contract Intelligence when a signatory must be compared
    // against the register.
    participants: bundle.participants,
    mode: final.mode,
    propertyType: projection.propertyType,
    evidenceCounts: pkg.tierCounts,
    // Research transparency: counts only, never links.
    research: researchCoverage(job, pkg, bundle),
    // Deterministic official history for the report: status (with its
    // conclusiveness), the 5–10 milestones, value changes, and the funnel
    // from discovered records to what is shown. Case/decision numbers only.
    officialHistory: pkg.tas ? officialHistoryView(pkg.tas) : null,
    // Which unit the records actually concern; a near match is never merged (propertyIdentity.ts).
    identity,
    // Developer advertising (marketing signal): only a completed stage reaches
    // the customer; the view carries no run ids or costs by construction.
    developerAds: pkg.developerAds && (pkg.developerAds.outcome === 'COMPLETE' || pkg.developerAds.outcome === 'CACHED') ? pkg.developerAds : null,
    // Bucket paths (internal) of the customer-visible visuals, with their
    // scope/category; forCustomer() turns them into signed URLs.
    // Each record carries its byte size and quality verdict (visualQuality.ts):
    // a blank layer stays here with its reason; forCustomer never shows it.
    // Each record also carries its case (caseRef) and provenance dates
    // (visualDates.ts): capture ONLY from EXIF, file-name / filing dates as
    // DOCUMENT dates, joined through officialDocuments.
    officialVisuals: withVisualDates(
      annotateVisualQuality(persistableVisuals(rj?.officialVisuals, pkg.tas?.visuals ?? []), visualByteSizes(rj)),
      pkg.dossier?.officialDocuments ?? [],
      { today: new Date().toISOString().slice(0, 10) },
    ),
    /*
     * THE OFFICIAL DOSSIER (officialDossier.ts) — customer-visible, names
     * kept exactly: the team with documented roles and provenance, the
     * specifications with their standing (APPROVED / PROPOSED), and the
     * case files with their public TAS links, priority cases first.
     */
    projectTeamV2: pkg.dossier?.projectTeamV2 ?? [],
    technicalSpecs: pkg.dossier?.technicalSpecs ?? [],
    officialDocuments: pkg.dossier?.officialDocuments ?? [],
    // Recent public photographs of the building (research-agent `fresh_photos`,
    // freshPhotos.ts): bucket paths here, signed by forCustomer() at read time.
    freshPhotos: rj?._freshPhotos ?? null,
    // Disclosed when the extract came from the buyer's own earlier check of this unit.
    registerSource,
    _usage: usage,
    empty: false,
    ...versionMarkers(job.synthesis_json, opts.autoUpgrade),
  };

  /* The register vetoes prose it disproves before anything is stored. */
  const payload = withPropertyRegister(built, rj, await enrichmentContext(writer, job));
  // The buyer assessment rests on the merged facts (register, history, market):
  // the model's draft when it passes the guard, else assembled from them.
  (payload as { report: Record<string, unknown> }).report.buyerAssessment = finalBuyerAssessment(final.buyerAssessmentDraft, payload);
  if (timing.modelStartedAt && !timing.modelEndedAt) timing.modelEndedAt = new Date().toISOString();
  if (timing.modelStartedAt) timing.modelMs = Date.parse(String(timing.modelEndedAt)) - Date.parse(String(timing.modelStartedAt));
  timing.persistAt = new Date().toISOString();
  (payload as Record<string, unknown>)._timing = timing;
  /* Enriched above by the current read derivations: a READY open may serve it
     without result_json (reportReadPath.ts). */
  Object.assign(payload as Record<string, unknown>, readEnrichmentMarkers());
  await persist(writer, jobId, payload);
  console.log(JSON.stringify({ scope: 'verify_synthesis_timing', jobId, ...timing, persistMs: Date.now() - Date.parse(String(timing.persistAt)) }));
  return await forCustomer(writer, payload, jobId);
}

/*
 * BEFORE A LOGIC-VERSION REBUILD: RECOVER SKIPPED OFFICIAL PICTURES.
 *
 * A report built from a run whose older-case budget skipped native images
 * (or kept the newest cases' stored pictures out of the gallery) asks
 * research-agent's `recover_visuals` once, server to server with the service
 * key, and folds the answer into the in-memory result_json the rebuild reads
 * (research-agent has already written the same change to the row). Network
 * wait only; bounded at 60 s; any failure is logged and the rebuild goes on
 * with what it has. Charges nothing.
 */
async function recoverVisualsBeforeRebuild(job: any): Promise<void> {
  try {
    if (!job?.result_json || !needsVisualRecovery(job.result_json)) return;
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    if (!key || !url) return;
    const res = await fetch(`${url}/functions/v1/research-agent`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'recover_visuals', jobId: job.id }),
      signal: AbortSignal.timeout(60_000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`recover_visuals_http_${res.status}:${String(body?.error ?? '').slice(0, 60)}`);
    if (body?.apply) applyVisualRecovery(job.result_json, body.apply);
    console.log(JSON.stringify({ scope: 'verify_synthesis', event: 'visual_recovery', jobId: job.id, skipped: !!body?.skipped, counts: body?.marker?.counts ?? null }));
  } catch (e) {
    console.warn(JSON.stringify({ scope: 'verify_synthesis', event: 'visual_recovery_failed', jobId: job?.id, error: String((e as Error)?.message ?? e).slice(0, 160) }));
  }
}

/*
 * BEFORE A BUILD: LOOK ONCE FOR RECENT PHOTOGRAPHS OF THE BUILDING.
 *
 * research-agent's `fresh_photos` (free public sources, at most once per
 * 24 h per job, nothing charged) searches, copies accepted images into the
 * private bucket and writes result_json._freshPhotos; the answer is folded
 * into the in-memory result_json the build reads. Bounded at 35 s; any
 * failure is logged and the build goes on without it.
 */
async function freshPhotosBeforeBuild(job: any): Promise<void> {
  try {
    if (!job?.result_json || job.status !== 'COMPLETE') return;
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    if (!key || !url) return;
    const res = await fetch(`${url}/functions/v1/research-agent`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'fresh_photos', jobId: job.id }),
      signal: AbortSignal.timeout(35_000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`fresh_photos_http_${res.status}:${String(body?.error ?? '').slice(0, 60)}`);
    if (body?.freshPhotos && typeof body.freshPhotos === 'object') job.result_json._freshPhotos = body.freshPhotos;
    console.log(JSON.stringify({ scope: 'verify_synthesis', event: 'fresh_photos', jobId: job.id, skipped: !!body?.skipped, status: body?.freshPhotos?.status ?? null, photos: Array.isArray(body?.freshPhotos?.photos) ? body.freshPhotos.photos.length : 0 }));
  } catch (e) {
    console.warn(JSON.stringify({ scope: 'verify_synthesis', event: 'fresh_photos_failed', jobId: job?.id, error: String((e as Error)?.message ?? e).slice(0, 160) }));
  }
}

/*
 * BEFORE A REBUILD: START THE ONE MARKET REFRESH (marketRefresh.ts).
 * Start only (the worker search takes minutes); the cron driver folds the
 * listings and requests one further rebuild. Bounded at 15 s, never blocks.
 */
async function startMarketRefreshBeforeRebuild(job: any): Promise<void> {
  try {
    if (!job?.result_json || !needsMarketRefresh(job.result_json)) return;
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    if (!key || !url) return;
    const res = await fetch(`${url}/functions/v1/research-agent`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'refresh_market', jobId: job.id }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.json().catch(() => null);
    console.log(JSON.stringify({ scope: 'verify_synthesis', event: 'market_refresh_start', jobId: job.id, status: res.status, started: !!body?.started, skipped: !!body?.skipped }));
  } catch (e) {
    console.warn(JSON.stringify({ scope: 'verify_synthesis', event: 'market_refresh_start_failed', jobId: job?.id, error: String((e as Error)?.message ?? e).slice(0, 160) }));
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ error: 'unauthorized' }, 401);

    /* TWO CALLERS, TWO TRUST MODELS.
     *
     * A customer arrives with their own session and is held to RLS exactly as
     * before — a job that is not theirs is simply not found.
     *
     * The driver arrives with no session at all, because it belongs to no
     * customer: research finished while nobody was watching and the report
     * still has to be built. It proves itself with the service-role key
     * itself, compared in full, so a merely-valid user token can never take
     * this branch. */
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
    const internal =
      req.headers.get('x-internal-driver') === '1' &&
      !!serviceKey &&
      bearer === serviceKey;

    const supabase = internal
      ? createClient(Deno.env.get('SUPABASE_URL')!, serviceKey)
      : createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_ANON_KEY')!,
          { global: { headers: { Authorization: authHeader } } }
        );

    /* READS stay with the caller and stay under RLS. Only the write-back of a
     * report we just built uses the service client — see persist() for why a
     * table-level UPDATE grant would be the wrong fix. Falls back to the
     * caller's client when no service key is configured, so a misconfigured
     * environment degrades to the old behaviour rather than crashing. */
    const writer = serviceKey
      ? createClient(Deno.env.get('SUPABASE_URL')!, serviceKey)
      : supabase;

    if (!internal) {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user?.id) return json({ error: 'unauthorized' }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const jobId = String(body?.jobId ?? '').trim();
    if (!jobId) return json({ error: 'jobId is required' }, 400);

    /* TRANSLATE (owner P0, 2026-10-12): the report's Georgian content in the
       customer's language, keyed on the text and cached for every report.
       Same authorisation as reading the report: the job must be visible
       through the CALLER's RLS-scoped client, or the answer is 404. The
       cache, the allowance and the cost row use the service client. */
    if (body?.action === 'translate') {
      const parsed = parseTranslateRequest(body);
      if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
      const { data: visible, error: visErr } = await supabase.from('research_jobs').select('id').eq('id', jobId).maybeSingle();
      if (visErr) throw visErr;
      if (!visible) return json({ error: 'not found' }, 404);
      const out = await translateTexts(writer, parsed.request, { apiKey: Deno.env.get('OPENAI_API_KEY'), model: TRANSLATION_MODEL, skipped: parsed.skipped });
      return json(out);
    }

    /* READY FAST PATH (reportReadPath.ts). The row is read WITHOUT
       result_json (1.8 MB for job 8ba97da9); result_json is fetched only when
       something below actually needs it: a rebuild, an upgrade, or a report
       persisted before its read derivations were applied at build time. */
    const readStarted = performance.now();
    const { data: job, error } = await supabase
      .from('research_jobs')
      .select(READY_FAST_COLUMNS)
      .eq('id', jobId)
      .maybeSingle();
    if (error) throw error;
    if (!job) return json({ error: 'not found' }, 404);
    const loadMs = Math.round(performance.now() - readStarted);
    const readLog = (path: string, extra: Record<string, unknown> = {}) =>
      console.log(JSON.stringify({ scope: 'verify_synthesis_read', jobId, path, loadMs, totalMs: Math.round(performance.now() - readStarted), ...extra }));
    if (canServeStoredFast(job, { force: !!body?.force })) {
      const signStarted = performance.now();
      const out = await forCustomer(writer, withCredibleParticipants(job.synthesis_json as Record<string, unknown>), job.id);
      readLog('fast', { signMs: Math.round(performance.now() - signStarted), visuals: Array.isArray((out as any).officialVisuals) ? (out as any).officialVisuals.length : 0 });
      return json({ ...out, persisted: true });
    }
    let resultLoaded = false;
    const ensureResult = async () => {
      if (resultLoaded) return;
      const { data: full, error: rjError } = await supabase.from('research_jobs').select('result_json').eq('id', jobId).maybeSingle();
      if (rjError) throw rjError;
      (job as any).result_json = full?.result_json ?? null;
      resultLoaded = true;
    };

    /* ============================================================== *
     * WHAT `force` IS, AND WHAT IT MUST NOT BECOME.
     *
     * `force: true` skips the persisted report and rebuilds it — which
     * means a model call, and therefore provider cost, on demand.
     *
     * Cross-user abuse is already impossible and stays that way through
     * RLS rather than through a check here: research_jobs.SELECT is
     * `auth.uid() = user_id`, so the read above returns nothing for
     * somebody else's job and this function answers 404. That is the right
     * place for it — a policy cannot be forgotten by a later caller.
     *
     * What RLS cannot see is repetition. Nothing stopped the OWNER of a job
     * from calling force in a loop, each iteration buying another synthesis.
     * The report is persisted precisely so that returning to a case is a
     * read; a rebuild is only ever legitimate when the code that builds it
     * has changed, which is not something that happens twice a minute.
     *
     * So a forced rebuild is refused while a recent one exists. The service
     * role is exempt — internal reassembly after a deploy is exactly the
     * legitimate use, and it is already authenticated by full comparison
     * against the service key above.
     *
     * 429 rather than 403: nothing is forbidden, it is simply too soon, and
     * the caller is told when it will not be.
     * ============================================================== */
    const FORCE_COOLDOWN_MS = 10 * 60 * 1000;
    if (body?.force && !internal) {
      const lastBuilt = Date.parse(String(job.synthesis_at ?? ''));
      const age = Number.isFinite(lastBuilt) ? Date.now() - lastBuilt : Number.POSITIVE_INFINITY;
      if (job.synthesis_state === 'READY' && job.synthesis_json && age < FORCE_COOLDOWN_MS) {
        return json({
          error: 'rebuild_too_soon',
          retryAfterSeconds: Math.ceil((FORCE_COOLDOWN_MS - age) / 1000),
        }, 429);
      }
    }

    /* BUILT ONCE.
     *
     * The report used to be regenerated on every single view — opening a
     * finished case from History re-ran the model and re-charged for it.
     * The persisted report is now authoritative, so returning to a case is
     * a read. */
    /* A report built by older logic, for a recent job, is rebuilt ONCE
       (reportVersion.ts). Everything else reads exactly as before. */
    const upgrade = !body?.force && shouldAutoUpgrade({
      synthesisState: job.synthesis_state, synthesisJson: job.synthesis_json, completedAt: job.completed_at, now: Date.now(),
    });
    const serveStored = async () => {
      await ensureResult();
      const read = withPropertyRegister(withCredibleParticipants(job.synthesis_json as Record<string, unknown>), job.result_json, await enrichmentContext(writer, job));
      return json({ ...(await forCustomer(writer, read, job.id)), persisted: true });
    };
    if (job.synthesis_state === 'READY' && job.synthesis_json && !body?.force && !upgrade) {
      await ensureResult();
      const enrichStarted = performance.now();
      const read = withPropertyRegister(withCredibleParticipants(job.synthesis_json as Record<string, unknown>), job.result_json, await enrichmentContext(writer, job));
      readLog('full', { enrichMs: Math.round(performance.now() - enrichStarted) });
      /* The unit's register is re-applied on every read, so reports written
         before the extracts were decoded (c80f7237) show the true owner and
         mortgages without a rebuild or a charge. Nothing is written back. */
      return json({ ...(await forCustomer(writer, read, job.id)), persisted: true });
    }
    if (upgrade) {
      if (!(await claimUpgrade(writer, job))) return await serveStored();
      await ensureResult();
      // Pictures an older run skipped are recovered first (never blocks the rebuild).
      await recoverVisualsBeforeRebuild(job);
      // Market evidence is refreshed from the free portals in the background; the driver folds it and asks for one more rebuild.
      await startMarketRefreshBeforeRebuild(job);
      // Recent public photographs of the building, once per 24 h (never blocks the rebuild).
      await freshPhotosBeforeBuild(job);
      console.log(`verify-synthesis: auto-upgrading report ${job.id} from logic v${logicVersionOf(job.synthesis_json)} to v${REPORT_LOGIC_VERSION}`);
      try {
        return json(await buildReport(job, writer, { autoUpgrade: true, trigger: 'customer', forced: false }));
      } catch (e) {
        console.error(`verify-synthesis: auto-upgrade of ${job.id} failed`, e instanceof Error ? e.message : String(e));
        await restoreAfterFailedUpgrade(writer, job);
        return await serveStored();
      }
    }

    /* ALREADY BEING WRITTEN.
     *
     * research-agent marks the job PENDING and builds the report itself the
     * moment research completes. The page used to call in at the same moment
     * and, finding no READY report, start a SECOND model build of the same
     * report — double the cost, and the customer waited on the slower one.
     * A fresh PENDING is answered "pending"; the page asks again shortly.
     * A stale one (an evicted build) is rebuilt here as before. */
    const pendingAge = Date.now() - Date.parse(String(job.synthesis_at ?? ''));
    if (job.synthesis_state === 'PENDING' && !body?.force && !internal && Number.isFinite(pendingAge) && pendingAge < 4 * 60 * 1000) {
      return json({ pending: true, retryAfterMs: 4000 }, 202);
    }

    await ensureResult();
    // A first build (or a forced one) looks once for recent photographs too.
    if (!job.synthesis_json || body?.force) await freshPhotosBeforeBuild(job);
    return json(await buildReport(job, writer, { autoUpgrade: false, trigger: internal ? (body?.trigger === 'research' ? 'research' : 'driver') : 'customer', forced: !!body?.force }));
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error('verify-synthesis failed', reason);
    /*
     * A model-availability refusal is reported in full rather than as
     * "internal_error". It names the model and carries the provider's own
     * status — and nothing else, so no credential travels with it. Every
     * other failure stays generic, because an unexpected stack trace is not
     * a thing to hand a browser.
     */
    if (reason.startsWith('SYNTHESIS_MODEL_UNAVAILABLE')) {
      return json({ error: 'synthesis_model_unavailable', detail: reason, model: MODEL }, 502);
    }
    return json({ error: 'internal_error' }, 500);
  }
});
