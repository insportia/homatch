/**
 * continuous-matching-worker — Phase 6 rewrite
 *
 * INTERNAL-FIRST architecture:
 *   1. Auth via cron token
 *   2. Per-property: run internal matching pipeline
 *   3. Eligibility check: count fresh strong matches vs thresholds
 *   4. If eligible for external AND safety gates allow: dispatch discovery queue
 *   5. Process stale queue recovery
 *
 * SAFETY INVARIANT: external_discovery_enabled=false, kill_switch=true
 * means external discovery is NEVER triggered. System is code-complete
 * and ready for controlled activation only.
 *
 * Dry-run mode: full pipeline simulation, no real provider calls, $0 cost.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-token',
};

const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

// ── Admin settings loader ─────────────────────────────────────────
interface WorkerSettings {
  external_discovery_enabled: boolean;
  provider_kill_switch: boolean;
  dry_run_mode: boolean;
  match_score_threshold: number;
  min_strong_matches: number;
  match_freshness_hours: number;
  max_properties_per_tick: number;
  max_jobs_per_property_tick: number;
}

async function loadSettings(db: ReturnType<typeof createClient>): Promise<WorkerSettings> {
  const keys = [
    'external_discovery_enabled', 'provider_kill_switch', 'dry_run_mode',
    'match_score_threshold', 'min_strong_matches', 'match_freshness_hours',
    'max_properties_per_tick', 'max_jobs_per_property_tick',
  ];
  const { data } = await db.from('admin_settings').select('key,value').in('key', keys);
  const raw: Record<string, string> = {};
  for (const r of data ?? []) raw[r.key] = String(r.value ?? '').replace(/^"|"$/g, '');
  return {
    external_discovery_enabled: raw['external_discovery_enabled'] === 'true',
    provider_kill_switch:        raw['provider_kill_switch'] !== 'false', // safe default = true
    dry_run_mode:                raw['dry_run_mode'] === 'true',
    match_score_threshold:       Number(raw['match_score_threshold']   ?? 70),
    min_strong_matches:          Number(raw['min_strong_matches']       ?? 3),
    match_freshness_hours:       Number(raw['match_freshness_hours']    ?? 24),
    max_properties_per_tick:     Number(raw['max_properties_per_tick']  ?? 4),
    max_jobs_per_property_tick:  Number(raw['max_jobs_per_property_tick'] ?? 10),
  };
}

// ── Eligibility engine ────────────────────────────────────────────
interface EligibilityResult {
  eligible: boolean;
  freshStrongCount: number;
  totalMatchCount: number;
  reason: string;
  thresholdScore: number;
  minStrongRequired: number;
  freshnessHours: number;
}

async function checkEligibilityForExternal(
  db: ReturnType<typeof createClient>,
  propertyId: string,
  settings: WorkerSettings,
): Promise<EligibilityResult> {
  const freshnessWindow = new Date(Date.now() - settings.match_freshness_hours * 3600_000).toISOString();

  const [freshResult, totalResult] = await Promise.all([
    db.from('matches')
      .select('*', { count: 'exact', head: true })
      .eq('property_id', propertyId)
      .gte('match_score', settings.match_score_threshold)
      .in('status', ['NEW', 'PREVIEWED', 'UNLOCKED'])
      .gte('created_at', freshnessWindow),
    db.from('matches')
      .select('*', { count: 'exact', head: true })
      .eq('property_id', propertyId)
      .in('status', ['NEW', 'PREVIEWED', 'UNLOCKED']),
  ]);

  const freshStrongCount = freshResult.count ?? 0;
  const totalMatchCount  = totalResult.count ?? 0;
  const eligible = freshStrongCount < settings.min_strong_matches;

  return {
    eligible,
    freshStrongCount,
    totalMatchCount,
    reason: eligible
      ? `Only ${freshStrongCount}/${settings.min_strong_matches} fresh strong matches — eligible for external`
      : `${freshStrongCount} fresh strong matches >= threshold ${settings.min_strong_matches} — external skipped`,
    thresholdScore:    settings.match_score_threshold,
    minStrongRequired: settings.min_strong_matches,
    freshnessHours:    settings.match_freshness_hours,
  };
}

// ── Idempotent eligibility record ─────────────────────────────────
async function recordEligibilityDecision(
  db: ReturnType<typeof createClient>,
  propertyId: string,
  campaignId: string | null,
  result: EligibilityResult,
  runId: string,
  deferredJobCount = 0,
): Promise<void> {
  await db.from('eligibility_decisions').insert({
    property_id:      propertyId,
    campaign_id:      campaignId,
    eligible_for_external: result.eligible,
    fresh_strong_count:    result.freshStrongCount,
    total_match_count:     result.totalMatchCount,
    threshold_score:       result.thresholdScore,
    min_strong_required:   result.minStrongRequired,
    freshness_hours:       result.freshnessHours,
    reason:                result.reason,
    deferred_job_count:    deferredJobCount,
    run_id:                runId,
  }).catch(() => {}); // non-fatal audit log
}

// ── Main entry ────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const base = Deno.env.get('SUPABASE_URL')!;
  const key  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const db   = createClient(base, key);

  try {
    const token = req.headers.get('x-cron-token') ?? '';
    const { data: setting } = await db.from('admin_settings')
      .select('value').eq('key', 'continuous_worker_token').maybeSingle();
    const expected = String(setting?.value ?? '').replace(/^"|"$/g, '');
    if (!expected || token !== expected) return json({ error: 'Forbidden' }, 403);

    // Use EdgeRuntime.waitUntil to keep Deno alive through async processing
    // @ts-ignore Deno Deploy global
    EdgeRuntime.waitUntil(run(db, base, key));
    return json({ success: true, started: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// ── Worker core ───────────────────────────────────────────────────
async function run(
  db: ReturnType<typeof createClient>,
  base: string,
  key: string,
): Promise<void> {
  const runId = crypto.randomUUID();
  const startMs = Date.now();

  console.log(JSON.stringify({
    event: 'worker_start', runId, ts: new Date().toISOString(),
  }));

  // Load centralized settings once per tick
  const settings = await loadSettings(db);

  console.log(JSON.stringify({
    event: 'settings_loaded', runId,
    external_enabled:  settings.external_discovery_enabled,
    kill_switch:       settings.provider_kill_switch,
    dry_run:           settings.dry_run_mode,
    threshold:         settings.match_score_threshold,
    min_strong:        settings.min_strong_matches,
    max_properties:    settings.max_properties_per_tick,
  }));

  // ── Step 1: Recover stale queue jobs ──────────────────────────
  try {
    const { data: staleResult } = await db.rpc('recover_stale_discovery_jobs', {
      p_stale_after_minutes: 30,
    });
    if (staleResult) {
      console.log(JSON.stringify({ event: 'stale_recovery', runId, recovered: staleResult }));
    }
  } catch (e) {
    console.error(JSON.stringify({ event: 'stale_recovery_error', runId, error: String(e) }));
  }

  // ── Step 2: Fetch active campaigns (bounded) ──────────────────
  const { data: camps } = await db
    .from('matching_campaigns')
    .select(`id, property_id, status,
      property:properties!property_id(
        id, matching_status,
        facts:property_facts!property_id(country, country_code, city)
      )`)
    .eq('status', 'ACTIVE')
    .limit(settings.max_properties_per_tick);

  const results: Record<string, unknown>[] = [];

  for (const camp of camps ?? []) {
    const prop    = Array.isArray(camp.property) ? camp.property[0] : camp.property;
    if (!prop || prop.matching_status !== 'ACTIVE') continue;

    const facts   = Array.isArray(prop.facts) ? prop.facts[0] : prop.facts;
    const country = String(facts?.country_code ?? facts?.country ?? 'GE').toUpperCase();

    const propResult: Record<string, unknown> = {
      property_id: camp.property_id,
      campaign_id: camp.id,
      country,
    };

    try {
      // ── Step 3: INTERNAL PIPELINE (always runs) ─────────────
      // 3a. Harvest new signals via source-monitor-public
      try {
        const smResult = await invoke(base, key, 'source-monitor-public', {
          propertyId: camp.property_id, country, maxSources: 50, postsPerSource: 10,
        }, 150_000);
        propResult['source_monitor'] = smResult;
        console.log(JSON.stringify({ event: 'source_monitor_done', runId, property_id: camp.property_id, result: smResult }));
      } catch (e) {
        console.error(JSON.stringify({ event: 'source_monitor_error', runId, property_id: camp.property_id, error: String(e) }));
      }

      // 3b. Classify pending signals
      try {
        const classifyResult = await invoke(base, key, 'classify-signals-v2', {
          batchSize: 500, market: country,
        }, 150_000);
        propResult['classify'] = classifyResult;
        console.log(JSON.stringify({ event: 'classify_done', runId, property_id: camp.property_id, result: classifyResult }));
      } catch (e) {
        console.error(JSON.stringify({ event: 'classify_error', runId, property_id: camp.property_id, error: String(e) }));
      }

      // 3c. Run internal matching
      let matchResult: Record<string, unknown> = {};
      try {
        matchResult = await invoke(base, key, 'run-matching-v2', {
          propertyId: camp.property_id,
          campaignId: camp.id,
          intentProfileBatchSize: 1500,
        }, 150_000) as Record<string, unknown>;
        propResult['match'] = matchResult;
        console.log(JSON.stringify({
          event: 'matching_done', runId, property_id: camp.property_id,
          matches_created: matchResult['matchesCreated'], best_score: matchResult['bestScore'],
        }));
      } catch (e) {
        console.error(JSON.stringify({ event: 'matching_error', runId, property_id: camp.property_id, error: String(e) }));
      }

      // ── Step 4: ELIGIBILITY CHECK (internal-first decision) ──
      const eligibility = await checkEligibilityForExternal(db, camp.property_id, settings);
      propResult['eligibility'] = eligibility;

      console.log(JSON.stringify({
        event: 'eligibility_decision', runId, property_id: camp.property_id,
        eligible: eligibility.eligible,
        fresh_strong: eligibility.freshStrongCount,
        reason: eligibility.reason,
      }));

      // ── Step 5: EXTERNAL DISCOVERY (only if eligible + gates pass) ─
      let externalDispatched = false;
      let externalBlockReason = '';

      if (!eligibility.eligible) {
        // Internal results are sufficient — skip external
        externalBlockReason = eligibility.reason;
      } else if (!settings.external_discovery_enabled) {
        externalBlockReason = 'external_discovery_enabled=false (safety lock)';
      } else if (settings.provider_kill_switch) {
        externalBlockReason = 'provider_kill_switch=true (safety lock)';
      } else if (settings.dry_run_mode) {
        // Dry-run: simulate queue dispatch without real call
        externalBlockReason = 'dry_run_mode=true — simulated dispatch only';
        console.log(JSON.stringify({
          event: 'dry_run_dispatch_simulated', runId, property_id: camp.property_id,
          max_jobs: settings.max_jobs_per_property_tick,
        }));
        externalDispatched = true; // reported as dispatched in dry-run
      } else {
        // All gates passed — dispatch to discovery queue worker
        try {
          const dispatchResult = await invoke(base, key, 'discovery-queue-worker', {
            propertyId:  camp.property_id,
            batchSize:   settings.max_jobs_per_property_tick,
            runId,
            dryRun:      false,
          }, 90_000);
          externalDispatched = true;
          propResult['discovery_dispatch'] = dispatchResult;
          console.log(JSON.stringify({
            event: 'discovery_dispatched', runId, property_id: camp.property_id, result: dispatchResult,
          }));
        } catch (e) {
          externalBlockReason = `dispatch error: ${String(e)}`;
          console.error(JSON.stringify({ event: 'dispatch_error', runId, property_id: camp.property_id, error: String(e) }));
        }
      }

      propResult['external_dispatched'] = externalDispatched;
      propResult['external_block_reason'] = externalBlockReason || null;

      // ── Step 6: Record deterministic eligibility decision ────
      await recordEligibilityDecision(
        db, camp.property_id, camp.id, eligibility, runId,
        externalDispatched ? 0 : 0,
      );

    } catch (e) {
      propResult['error'] = String(e);
      console.error(JSON.stringify({ event: 'campaign_error', runId, property_id: camp.property_id, error: String(e) }));
    }

    results.push(propResult);
  }

  const durationMs = Date.now() - startMs;
  console.log(JSON.stringify({
    event: 'worker_done', runId, campaigns_processed: results.length,
    duration_ms: durationMs, dry_run: settings.dry_run_mode,
    external_enabled: settings.external_discovery_enabled,
    kill_switch: settings.provider_kill_switch,
  }));
}

// ── Internal invocation helper ────────────────────────────────────
async function invoke(
  base: string, key: string, fn: string, body: unknown, timeoutMs: number,
): Promise<unknown> {
  const r = await fetch(`${base}/functions/v1/${fn}`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(timeoutMs),
  });
  const text = await r.text();
  let d: unknown = {};
  try { d = JSON.parse(text); } catch { d = { raw: text }; }
  if (!r.ok) throw new Error(`${fn} ${r.status}: ${(d as Record<string, unknown>)?.error ?? text}`);
  return d;
}
