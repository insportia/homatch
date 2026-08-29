/**
 * HOMATCH — Centralized External Discovery Safety Gate
 *
 * ALL provider calls MUST pass through this gate before execution.
 * 8 mandatory checks — any failure = NO call, no silent fallback.
 *
 * SAFETY INVARIANT: external_discovery_enabled=false, kill_switch=true
 * means ZERO real provider calls can be made from this file.
 */

export interface SafetyGateResult {
  allowed: boolean;
  reason?: string;
  checks: Record<string, boolean>;
}

export interface AdminSettings {
  external_discovery_enabled: boolean;
  provider_kill_switch: boolean;
  disabled_providers: string[];
  spend_cap_global: number;
  spend_cap_per_run_usd: number;
  spend_cap_per_property_usd: number;
  dry_run_mode: boolean;
}

export interface GateContext {
  db: ReturnType<typeof import('https://esm.sh/@supabase/supabase-js@2').createClient>;
  provider: string;
  propertyId: string;
  campaignId?: string;
  claimToken?: string;
  estimatedCostUsd: number;
  runId: string;
  attempt: number;
  maxAttempts?: number;
}

/**
 * Load admin settings as a typed object. Never trusts frontend values.
 */
export async function loadAdminSettings(db: GateContext['db']): Promise<AdminSettings> {
  const { data } = await db
    .from('admin_settings')
    .select('key, value')
    .in('key', [
      'external_discovery_enabled', 'provider_kill_switch', 'disabled_providers',
      'spend_cap_global', 'spend_cap_per_run_usd', 'spend_cap_per_property_usd',
      'dry_run_mode', 'max_job_attempts',
    ]);

  const raw: Record<string, string> = {};
  for (const row of data ?? []) {
    raw[row.key] = String(row.value ?? '').replace(/^"|"$/g, '');
  }

  let disabledProviders: string[] = [];
  try {
    const parsed = JSON.parse(raw['disabled_providers'] ?? '[]');
    disabledProviders = Array.isArray(parsed) ? parsed.map(String) : [];
  } catch { /* keep empty */ }

  return {
    external_discovery_enabled: raw['external_discovery_enabled'] === 'true',
    provider_kill_switch: raw['provider_kill_switch'] !== 'false', // default safe=true
    disabled_providers: disabledProviders,
    spend_cap_global: Number(raw['spend_cap_global'] ?? 250),
    spend_cap_per_run_usd: Number(raw['spend_cap_per_run_usd'] ?? 20),
    spend_cap_per_property_usd: Number(raw['spend_cap_per_property_usd'] ?? 5),
    dry_run_mode: raw['dry_run_mode'] === 'true',
  };
}

/**
 * Get monthly spend for a provider (or global).
 */
export async function getMonthlySpend(
  db: GateContext['db'],
  provider?: string,
): Promise<number> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  let query = db.from('cost_events').select('cost_usd').gte('timestamp', monthStart.toISOString());
  if (provider) query = query.eq('provider', provider);

  const { data } = await query;
  return (data ?? []).reduce((sum: number, r: { cost_usd: unknown }) => sum + Number(r.cost_usd ?? 0), 0);
}

/**
 * Get per-property spend in the current run.
 */
export async function getPropertyRunSpend(
  db: GateContext['db'],
  propertyId: string,
  runId: string,
): Promise<number> {
  const { data } = await db
    .from('cost_ledger')
    .select('estimated_cost, actual_cost')
    .eq('property_id', propertyId)
    .eq('job_id', runId);

  return (data ?? []).reduce(
    (sum: number, r: { actual_cost: unknown; estimated_cost: unknown }) =>
      sum + Number(r.actual_cost ?? r.estimated_cost ?? 0),
    0,
  );
}

/**
 * Main 8-gate safety check. Returns allowed=false with reason on any failure.
 * NEVER silently falls back to another provider.
 */
export async function checkExternalDiscoverySafety(
  ctx: GateContext,
): Promise<SafetyGateResult> {
  const checks: Record<string, boolean> = {};

  try {
    const settings = await loadAdminSettings(ctx.db);

    // Gate 1: External discovery master switch
    checks['external_enabled'] = settings.external_discovery_enabled;
    if (!settings.external_discovery_enabled) {
      return { allowed: false, reason: 'external_discovery_enabled=false', checks };
    }

    // Gate 2: Kill switch
    checks['kill_switch_off'] = !settings.provider_kill_switch;
    if (settings.provider_kill_switch) {
      return { allowed: false, reason: 'provider_kill_switch=true', checks };
    }

    // Gate 3: Provider not in disabled list
    const providerDisabled = settings.disabled_providers
      .map(p => p.toUpperCase())
      .includes(ctx.provider.toUpperCase());
    checks['provider_enabled'] = !providerDisabled;
    if (providerDisabled) {
      return { allowed: false, reason: `Provider ${ctx.provider} is disabled`, checks };
    }

    // Gate 4: Dry-run mode
    checks['not_dry_run'] = !settings.dry_run_mode;
    if (settings.dry_run_mode) {
      return { allowed: false, reason: 'dry_run_mode=true — no real provider calls', checks };
    }

    // Gate 5: Active property with active campaign
    const { data: prop } = await ctx.db
      .from('properties')
      .select('id, matching_status')
      .eq('id', ctx.propertyId)
      .maybeSingle();
    checks['active_property'] = !!(prop && prop.matching_status === 'ACTIVE');
    if (!prop || prop.matching_status !== 'ACTIVE') {
      return { allowed: false, reason: `Property ${ctx.propertyId} is not ACTIVE`, checks };
    }

    const { data: campaign } = await ctx.db
      .from('matching_campaigns')
      .select('id, status')
      .eq('property_id', ctx.propertyId)
      .eq('status', 'ACTIVE')
      .maybeSingle();
    checks['active_campaign'] = !!campaign;
    if (!campaign) {
      return { allowed: false, reason: 'No active campaign for property', checks };
    }

    // Gate 6: Valid claim token (if provided)
    if (ctx.claimToken) {
      const { data: job } = await ctx.db
        .from('discovery_query_queue')
        .select('id, status, claim_token, property_id')
        .eq('claim_token', ctx.claimToken)
        .eq('property_id', ctx.propertyId)
        .maybeSingle();
      checks['valid_claim'] = !!(job && job.status === 'PROCESSING' && job.claim_token === ctx.claimToken);
      if (!job || job.status !== 'PROCESSING') {
        return { allowed: false, reason: 'Invalid or expired claim token', checks };
      }
    } else {
      checks['valid_claim'] = true; // no claim required for this call type
    }

    // Gate 7: Retry allowed (attempt <= max)
    const maxAttempts = ctx.maxAttempts ?? 4;
    checks['retry_allowed'] = ctx.attempt <= maxAttempts;
    if (ctx.attempt > maxAttempts) {
      return { allowed: false, reason: `Max attempts (${maxAttempts}) exceeded`, checks };
    }

    // Gate 8: Budget checks (global + per-provider + per-property + per-run)
    const [globalSpend, providerSpend, propertyRunSpend] = await Promise.all([
      getMonthlySpend(ctx.db),
      getMonthlySpend(ctx.db, ctx.provider),
      getPropertyRunSpend(ctx.db, ctx.propertyId, ctx.runId),
    ]);

    const providerCapKey = `spend_cap_${ctx.provider.toLowerCase()}`;
    const { data: providerCapRow } = await ctx.db
      .from('admin_settings')
      .select('value')
      .eq('key', providerCapKey)
      .maybeSingle();
    const providerCap = Number(
      String(providerCapRow?.value ?? '0').replace(/"/g, '') || '0',
    );

    const globalBudgetOk = globalSpend + ctx.estimatedCostUsd <= settings.spend_cap_global;
    const providerBudgetOk = providerCap <= 0 || providerSpend + ctx.estimatedCostUsd <= providerCap;
    const propertyBudgetOk = propertyRunSpend + ctx.estimatedCostUsd <= settings.spend_cap_per_property_usd;
    const runBudgetOk = propertyRunSpend + ctx.estimatedCostUsd <= settings.spend_cap_per_run_usd;

    checks['global_budget'] = globalBudgetOk;
    checks['provider_budget'] = providerBudgetOk;
    checks['property_budget'] = propertyBudgetOk;
    checks['run_budget'] = runBudgetOk;

    if (!globalBudgetOk) return { allowed: false, reason: `Global budget exceeded: ${globalSpend}+${ctx.estimatedCostUsd} > ${settings.spend_cap_global}`, checks };
    if (!providerBudgetOk) return { allowed: false, reason: `${ctx.provider} budget exceeded`, checks };
    if (!propertyBudgetOk) return { allowed: false, reason: `Per-property run budget exceeded`, checks };
    if (!runBudgetOk) return { allowed: false, reason: `Per-run budget exceeded`, checks };

    return { allowed: true, checks };
  } catch (err) {
    // Any error in safety gate = deny
    return {
      allowed: false,
      reason: `Safety gate error: ${err instanceof Error ? err.message : String(err)}`,
      checks,
    };
  }
}

/**
 * Log a cost event to both cost_events and cost_ledger.
 * NEVER trusts estimated cost after the fact — actual cost is recorded server-side.
 */
export async function logProviderCost(
  db: GateContext['db'],
  params: {
    provider: string;
    operationType: string;
    propertyId: string;
    jobId: string;
    campaignId?: string;
    claimToken?: string;
    attempt: number;
    estimatedCostUsd: number;
    actualCostUsd: number;
    success: boolean;
    errorMsg?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const safeMetadata = { ...params.metadata };
  // Strip any credentials from metadata
  delete safeMetadata['apiKey'];
  delete safeMetadata['token'];
  delete safeMetadata['password'];
  delete safeMetadata['authorization'];

  await Promise.allSettled([
    db.from('cost_events').insert({
      provider: params.provider,
      operation_type: params.operationType,
      units: 1,
      cost_usd: params.actualCostUsd,
      success: params.success,
      cache_hit: false,
      property_id: params.propertyId,
      timestamp: now,
    }),
    db.from('cost_ledger').insert({
      provider: params.provider,
      job_id: params.jobId,
      property_id: params.propertyId,
      campaign_id: params.campaignId ?? null,
      operation_type: params.operationType,
      estimated_cost: params.estimatedCostUsd,
      actual_cost: params.actualCostUsd,
      currency: 'USD',
      claim_token: params.claimToken ?? null,
      attempt: params.attempt,
      success: params.success,
      error_msg: params.errorMsg ?? null,
      metadata: safeMetadata,
      created_at: now,
    }),
  ]);
}
