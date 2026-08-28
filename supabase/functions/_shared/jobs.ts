#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
/**
 * HOMATCH — Exportable Job Functions (Part 3)
 *
 * These functions are the canonical, portable implementation of all background jobs.
 * They can be called by:
 *   - Supabase Edge Functions (deploy each as a separate function)
 *   - A Deno/Node cron scheduler on any VPS
 *   - Manual invocation via CLI for testing
 *
 * No platform lock-in: all logic is here, not in proprietary scheduler configs.
 * Spend cap enforcement is checked BEFORE every paid provider call.
 * All provider calls log a CostEvent. All retries are bounded with exponential backoff.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── Types ──────────────────────────────────────────────────────────────────

export interface JobContext {
  supabase: ReturnType<typeof createClient>;
  dryRun?: boolean;
}

export interface JobResult {
  job: string;
  success: boolean;
  processed: number;
  errors: string[];
  skipped_cap?: number;
  duration_ms: number;
}

// ── Spend Cap Guard ────────────────────────────────────────────────────────

export async function isProviderAllowed(ctx: JobContext, provider: string): Promise<boolean> {
  const monthStart = new Date();
  monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

  const [settingsRes, costsRes] = await Promise.all([
    ctx.supabase.from('admin_settings').select('key, value').like('key', 'spend_cap_%'),
    ctx.supabase.from('cost_events').select('provider, cost_usd').gte('timestamp', monthStart.toISOString()),
  ]);

  const caps: Record<string, number> = {};
  for (const s of settingsRes.data ?? []) caps[s.key.replace('spend_cap_', '')] = Number(s.value);

  const spent: Record<string, number> = {};
  for (const c of costsRes.data ?? []) {
    const k = (c.provider as string).toLowerCase();
    spent[k] = (spent[k] ?? 0) + Number(c.cost_usd ?? 0);
  }

  const globalSpent = Object.values(spent).reduce((a, b) => a + b, 0);
  const globalCap = caps['global'] ?? 999999;
  const providerKey = provider.toLowerCase();
  const providerSpent = spent[providerKey] ?? 0;
  const providerCap = caps[providerKey] ?? 999999;

  if (globalSpent >= globalCap) { console.warn(`[cap] GLOBAL cap reached: ${globalSpent}/${globalCap}`); return false; }
  if (providerSpent >= providerCap) { console.warn(`[cap] ${provider} cap reached: ${providerSpent}/${providerCap}`); return false; }
  return true;
}

// ── Bounded Retry ──────────────────────────────────────────────────────────

export async function withRetry<T>(
  fn: () => Promise<T>,
  { maxAttempts = 3, baseDelayMs = 500 } = {}
): Promise<T> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try { return await fn(); } catch (e: any) {
      lastErr = e;
      if (attempt < maxAttempts - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

// ── CostEvent Logger ───────────────────────────────────────────────────────

export async function logCostEvent(ctx: JobContext, event: {
  provider: string; operation: string; cost_usd: number;
  success: boolean; cache_hit?: boolean;
  property_id?: string; raw_signal_id?: string;
}) {
  if (ctx.dryRun) return;
  await ctx.supabase.from('cost_events').insert({
    provider: event.provider, operation: event.operation, cost_usd: event.cost_usd,
    success: event.success, cache_hit: event.cache_hit ?? false,
    property_id: event.property_id ?? null, raw_signal_id: event.raw_signal_id ?? null,
    timestamp: new Date().toISOString(),
  });
}

// ── 1. discoverMarketSources ───────────────────────────────────────────────

export async function discoverMarketSources(ctx: JobContext): Promise<JobResult> {
  const start = Date.now();
  const errors: string[] = [];
  let processed = 0; let skipped_cap = 0;

  const { data: markets } = await ctx.supabase
    .from('markets').select('*').eq('enabled', true);

  for (const market of markets ?? []) {
    const allowed = await isProviderAllowed(ctx, 'DATAFORSEO');
    if (!allowed) { skipped_cap++; continue; }

    try {
      await withRetry(async () => {
        // Check QueryPack cache first — shared search, do not repeat
        const cacheKey = `discover:${market.country_code}`;
        const { data: existing } = await ctx.supabase.from('query_packs')
          .select('id').eq('market_id', market.id).eq('cache_key', cacheKey)
          .gte('expires_at', new Date().toISOString()).maybeSingle();
        if (existing) { console.log(`[discover] cache hit for market ${market.country_code}`); return; }

        const login = Deno.env.get('DATAFORSEO_LOGIN');
        const pwd = Deno.env.get('DATAFORSEO_PASSWORD');
        const provider = (login && pwd) ? 'DATAFORSEO' : 'MOCK';
        let results: any[] = [];

        if (provider === 'DATAFORSEO') {
          const creds = btoa(`${login}:${pwd}`);
          const r = await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/advanced', {
            method: 'POST',
            headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' },
            body: JSON.stringify([{ language_code: 'en', location_name: market.country_name, keyword: `real estate buy rent ${market.country_name} site:facebook.com OR site:t.me OR site:vk.com`, depth: 10 }]),
          });
          const json = await r.json();
          results = json?.tasks?.[0]?.result?.[0]?.items ?? [];
          await logCostEvent(ctx, { provider: 'DATAFORSEO', operation: 'discover_sources', cost_usd: 0.003, success: r.ok });
        } else {
          console.log(`[discover] MOCK — DATAFORSEO not configured for market ${market.country_code}`);
          await logCostEvent(ctx, { provider: 'DATAFORSEO', operation: 'discover_sources', cost_usd: 0, success: true, cache_hit: false });
        }

        // Upsert discovered sources into source_registry
        for (const item of results) {
          if (!item.url) continue;
          const platform = detectPlatform(item.url);
          if (!platform) continue;
          await ctx.supabase.from('source_registry').upsert({
            url: item.url, platform, display_name: item.title,
            market_id: market.id, active: true, quality_score: 5.0,
            discovered_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          }, { onConflict: 'url', ignoreDuplicates: true });
        }

        // Cache the query pack
        const expires = new Date(); expires.setHours(expires.getHours() + 24);
        await ctx.supabase.from('query_packs').upsert({
          market_id: market.id, cache_key: cacheKey,
          expires_at: expires.toISOString(), updated_at: new Date().toISOString(),
        }, { onConflict: 'cache_key' });

        processed++;
      });
    } catch (e: any) { errors.push(`market ${market.country_code}: ${e.message}`); }
  }

  return { job: 'discoverMarketSources', success: errors.length === 0, processed, errors, skipped_cap, duration_ms: Date.now() - start };
}

function detectPlatform(url: string): string | null {
  if (url.includes('facebook.com')) return 'FACEBOOK';
  if (url.includes('t.me') || url.includes('telegram')) return 'TELEGRAM';
  if (url.includes('vk.com')) return 'VK';
  if (url.includes('instagram.com')) return 'INSTAGRAM';
  return null;
}

// ── 2. collectSourceUpdates ────────────────────────────────────────────────

export async function collectSourceUpdates(ctx: JobContext): Promise<JobResult> {
  const start = Date.now();
  const errors: string[] = [];
  let processed = 0; let skipped_cap = 0;

  const { data: sources } = await ctx.supabase
    .from('source_registry').select('*').eq('active', true).order('last_collected_at', { ascending: true, nullsFirst: true }).limit(20);

  for (const source of sources ?? []) {
    const allowed = await isProviderAllowed(ctx, 'APIFY');
    if (!allowed) { skipped_cap++; continue; }

    try {
      await withRetry(async () => {
        const token = Deno.env.get('APIFY_API_TOKEN');
        const actorId = getActorId(source.platform);

        if (!token || !actorId) {
          console.log(`[collect] MOCK — Apify not configured for ${source.platform}`);
          await logCostEvent(ctx, { provider: 'APIFY', operation: `collect_${source.platform}`, cost_usd: 0, success: true, cache_hit: false });
          return;
        }

        // Only collect NEW content since last_collected_at (incremental monitoring)
        const since = source.last_collected_at ?? new Date(Date.now() - 7 * 86400000).toISOString();

        const runRes = await fetch(`https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${token}&memory=256&maxItems=50`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ startUrls: [{ url: source.url }], since, maxItems: 50 }),
        });

        const items = runRes.ok ? await runRes.json() : [];
        const costPerRun = 0.05;
        await logCostEvent(ctx, { provider: 'APIFY', operation: `collect_${source.platform}`, cost_usd: costPerRun, success: runRes.ok });

        for (const item of Array.isArray(items) ? items : []) {
          const text = item.text ?? item.message ?? item.body ?? '';
          if (!text || text.length < 20) continue;

          // Deduplicate by external ID + fingerprint
          const externalId = item.id ?? item.postId ?? item.messageId ?? null;
          const fingerprint = await hashText(text.slice(0, 200));

          const { data: dup } = await ctx.supabase.from('raw_signals')
            .select('id').or(`external_id.eq.${externalId},content_fingerprint.eq.${fingerprint}`)
            .maybeSingle();
          if (dup) continue;

          await ctx.supabase.from('raw_signals').insert({
            source_id: source.id, platform: source.platform,
            raw_text: text, external_id: externalId, content_fingerprint: fingerprint,
            language: item.language ?? null, author_id: item.authorId ?? null,
            source_url: item.url ?? source.url,
            classification_status: 'PENDING',
            discovered_at: item.createdAt ?? new Date().toISOString(),
          });
        }

        // Update last_collected_at
        await ctx.supabase.from('source_registry').update({ last_collected_at: new Date().toISOString() }).eq('id', source.id);
        processed++;
      });
    } catch (e: any) { errors.push(`source ${source.id}: ${e.message}`); }
  }

  return { job: 'collectSourceUpdates', success: errors.length === 0, processed, errors, skipped_cap, duration_ms: Date.now() - start };
}

function getActorId(platform: string): string | null {
  const map: Record<string, string | undefined> = {
    FACEBOOK: Deno.env.get('APIFY_FACEBOOK_ACTOR_ID'),
    TELEGRAM: Deno.env.get('APIFY_TELEGRAM_ACTOR_ID'),
    INSTAGRAM: Deno.env.get('APIFY_INSTAGRAM_ACTOR_ID'),
    VK: Deno.env.get('APIFY_VK_ACTOR_ID'),
  };
  return map[platform] ?? null;
}

async function hashText(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

// ── 3. classifyCandidateSignals ────────────────────────────────────────────

export async function classifyCandidateSignals(ctx: JobContext): Promise<JobResult> {
  const start = Date.now();
  const errors: string[] = [];
  let processed = 0; let skipped_cap = 0;

  const { data: signals } = await ctx.supabase
    .from('raw_signals').select('*').eq('classification_status', 'PENDING').limit(30);

  for (const signal of signals ?? []) {
    const allowed = await isProviderAllowed(ctx, 'OPENAI');
    if (!allowed) { skipped_cap++; continue; }

    try {
      await withRetry(async () => {
        // Cheap pre-filter: skip very short or spam-like content
        const text = signal.raw_text ?? '';
        if (text.length < 30) {
          await ctx.supabase.from('raw_signals').update({ classification_status: 'NOISE' }).eq('id', signal.id);
          return;
        }

        const key = Deno.env.get('OPENAI_API_KEY');
        if (!key) {
          console.log(`[classify] MOCK — OpenAI not configured`);
          await logCostEvent(ctx, { provider: 'OPENAI', operation: 'classify_signal', cost_usd: 0, success: true, cache_hit: false, raw_signal_id: signal.id });
          return;
        }

        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            temperature: 0,
            max_tokens: 512,
            messages: [{
              role: 'system',
              content: `You classify real estate intent signals. Return JSON only with fields:
                intent_type: BUY|RENT|INVEST|RELOCATE_BUY|RELOCATE_RENT|SELLER|AGENT_AD|PROPERTY_AD|SPAM|NOISE|UNKNOWN
                country: ISO country code or null
                city: city name or null
                transaction: SALE|RENT|INVESTMENT or null
                property_types: array of APARTMENT|HOUSE|VILLA|COMMERCIAL|LAND|OFFICE|PENTHOUSE|STUDIO|TOWNHOUSE|OTHER
                bedrooms_min: number or null
                bedrooms_max: number or null
                budget_min: number or null
                budget_max: number or null
                currency: ISO currency code or null
                confidence: 0.0-1.0
                language: ISO 639-1 code`
            }, { role: 'user', content: text.slice(0, 1500) }],
          }),
        });

        const tokens = 512;
        const costUsd = (tokens / 1000) * 0.00015;
        await logCostEvent(ctx, { provider: 'OPENAI', operation: 'classify_signal', cost_usd: costUsd, success: r.ok, raw_signal_id: signal.id });

        if (!r.ok) {
          await ctx.supabase.from('raw_signals').update({ classification_status: 'PENDING' }).eq('id', signal.id);
          return;
        }

        const json = await r.json();
        let intent: any;
        try { intent = JSON.parse(json.choices[0].message.content); } catch { intent = null; }

        const rejectTypes = ['SELLER', 'AGENT_AD', 'PROPERTY_AD', 'SPAM', 'NOISE', 'UNKNOWN'];
        if (!intent || rejectTypes.includes(intent.intent_type)) {
          await ctx.supabase.from('raw_signals').update({ classification_status: 'REJECTED' }).eq('id', signal.id);
          return;
        }

        // Create IntentProfile
        await ctx.supabase.from('intent_profiles').insert({
          raw_signal_id: signal.id,
          intent_type: intent.intent_type, country: intent.country, city: intent.city,
          transaction: intent.transaction, property_types: intent.property_types ?? [],
          bedrooms_min: intent.bedrooms_min, bedrooms_max: intent.bedrooms_max,
          budget_min: intent.budget_min, budget_max: intent.budget_max, currency: intent.currency,
          confidence: intent.confidence, language: intent.language ?? signal.language,
          created_at: new Date().toISOString(),
        });

        await ctx.supabase.from('raw_signals').update({ classification_status: 'CLASSIFIED', language: intent.language ?? signal.language }).eq('id', signal.id);
        processed++;
      });
    } catch (e: any) { errors.push(`signal ${signal.id}: ${e.message}`); }
  }

  return { job: 'classifyCandidateSignals', success: errors.length === 0, processed, errors, skipped_cap, duration_ms: Date.now() - start };
}

// ── 4. runMatching ────────────────────────────────────────────────────────

export async function runMatching(ctx: JobContext): Promise<JobResult> {
  const start = Date.now();
  const errors: string[] = [];
  let processed = 0;

  // Only active campaigns
  const { data: campaigns } = await ctx.supabase
    .from('matching_campaigns').select('*, properties(*, property_facts(*))').eq('status', 'ACTIVE').limit(20);

  // Recent unmatched intent profiles
  const { data: intents } = await ctx.supabase
    .from('intent_profiles').select('*')
    .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString())
    .limit(200);

  for (const campaign of campaigns ?? []) {
    for (const intent of intents ?? []) {
      try {
        // Skip if already matched
        const { data: existing } = await ctx.supabase.from('matches')
          .select('id').eq('property_id', campaign.property_id).eq('intent_profile_id', intent.id).maybeSingle();
        if (existing) continue;

        const facts = campaign.properties?.property_facts;
        const score = computeMatchScore(facts, intent);
        if (score < 30) continue; // Below minimum threshold

        const strength = scoreToStrength(score);
        const price = computePrice(strength, intent.confidence);

        await ctx.supabase.from('matches').insert({
          property_id: campaign.property_id,
          user_id: campaign.user_id,
          intent_profile_id: intent.id,
          match_score: score,
          signal_strength: strength,
          unlock_price_credits: price,
          status: 'LOCKED',
          preview_platform: intent.platform,
          preview_language: intent.language,
          preview_city: intent.city,
          preview_budget_min: intent.budget_min,
          preview_budget_max: intent.budget_max,
          preview_bedrooms: intent.bedrooms_min,
          created_at: new Date().toISOString(),
        });

        processed++;
      } catch (e: any) { errors.push(`campaign ${campaign.id} x intent ${intent.id}: ${e.message}`); }
    }
  }

  return { job: 'runMatching', success: errors.length === 0, processed, errors, duration_ms: Date.now() - start };
}

function computeMatchScore(facts: any, intent: any): number {
  if (!facts || !intent) return 0;
  let score = 0;
  // Hard factors
  if (facts.country_code && intent.country && facts.country_code.toLowerCase() !== intent.country.toLowerCase()) return 0;
  if (facts.transaction_type && intent.transaction && facts.transaction_type !== intent.transaction) return 0;
  // Weighted
  if (facts.city && intent.city && facts.city.toLowerCase() === intent.city.toLowerCase()) score += 25;
  if (intent.property_types?.includes(facts.property_type)) score += 15;
  if (intent.bedrooms_min != null && facts.bedrooms >= intent.bedrooms_min) score += 10;
  if (intent.budget_max != null && facts.price_amount <= intent.budget_max) score += 20;
  score += Math.round((intent.confidence ?? 0) * 30);
  return Math.min(score, 100);
}

function scoreToStrength(score: number): string {
  if (score >= 90) return 'EXCEPTIONAL';
  if (score >= 75) return 'VERY_STRONG';
  if (score >= 60) return 'STRONG';
  if (score >= 45) return 'GOOD';
  return 'POTENTIAL';
}

function computePrice(strength: string, confidence: number): number {
  const base: Record<string, number> = { POTENTIAL: 0.5, GOOD: 1.0, STRONG: 2.0, VERY_STRONG: 3.5, EXCEPTIONAL: 5.0 };
  const b = base[strength] ?? 0.5;
  return Math.max(0.10, Math.min(10.0, b * (0.7 + confidence * 0.6)));
}

// ── 5. sendNotifications ──────────────────────────────────────────────────

export async function sendNotifications(ctx: JobContext): Promise<JobResult> {
  const start = Date.now();
  const errors: string[] = [];
  let processed = 0;

  // Find new matches from last 10 min not yet notified
  const since = new Date(Date.now() - 10 * 60000).toISOString();
  const { data: newMatches } = await ctx.supabase
    .from('matches').select('*, properties(user_id, title)').eq('status', 'LOCKED').gte('created_at', since).limit(100);

  for (const match of newMatches ?? []) {
    const userId = match.properties?.user_id;
    if (!userId) continue;
    try {
      // In-app notification
      await ctx.supabase.from('notifications').insert({
        user_id: userId, type: 'MATCH_AVAILABLE',
        title: 'New match found',
        body: `A new ${match.signal_strength} match is available for ${match.properties?.title ?? 'your property'}.`,
        metadata: { match_id: match.id, property_id: match.property_id, strength: match.signal_strength },
        read: false, created_at: new Date().toISOString(),
      });
      processed++;
    } catch (e: any) { errors.push(`match ${match.id}: ${e.message}`); }
  }

  return { job: 'sendNotifications', success: errors.length === 0, processed, errors, duration_ms: Date.now() - start };
}

// ── 6. aggregateProviderCosts ─────────────────────────────────────────────

export async function aggregateProviderCosts(ctx: JobContext): Promise<JobResult> {
  const start = Date.now();
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

  const { data: costs } = await ctx.supabase.from('cost_events')
    .select('provider, cost_usd, success').gte('timestamp', monthStart.toISOString());

  const summary: Record<string, { total: number; calls: number; success: number }> = {};
  for (const c of costs ?? []) {
    if (!summary[c.provider]) summary[c.provider] = { total: 0, calls: 0, success: 0 };
    summary[c.provider].total += Number(c.cost_usd ?? 0);
    summary[c.provider].calls += 1;
    if (c.success) summary[c.provider].success += 1;
  }

  console.log('[aggregateProviderCosts] MTD summary:', JSON.stringify(summary, null, 2));

  return { job: 'aggregateProviderCosts', success: true, processed: Object.keys(summary).length, errors: [], duration_ms: Date.now() - start };
}

// ── 7. cleanupExpiredData ─────────────────────────────────────────────────

export async function cleanupExpiredData(ctx: JobContext): Promise<JobResult> {
  const start = Date.now();
  const errors: string[] = [];
  let processed = 0;

  const { data: settings } = await ctx.supabase.from('admin_settings').select('key, value').like('key', 'retention_%');
  const ret: Record<string, number> = {};
  for (const s of settings ?? []) ret[s.key] = Number(s.value);

  const noiseDays = ret['retention_noise_days'] ?? 7;
  const rejectedDays = ret['retention_rejected_days'] ?? 14;
  const costDays = ret['retention_cost_events_days'] ?? 180;

  try {
    const noiseCutoff = new Date(Date.now() - noiseDays * 86400000).toISOString();
    const { count: nc } = await ctx.supabase.from('raw_signals')
      .delete({ count: 'exact' }).eq('classification_status', 'NOISE').lt('discovered_at', noiseCutoff);
    processed += nc ?? 0;
  } catch (e: any) { errors.push(`noise cleanup: ${e.message}`); }

  try {
    const rejCutoff = new Date(Date.now() - rejectedDays * 86400000).toISOString();
    const { count: rc } = await ctx.supabase.from('raw_signals')
      .delete({ count: 'exact' }).eq('classification_status', 'REJECTED').lt('discovered_at', rejCutoff);
    processed += rc ?? 0;
  } catch (e: any) { errors.push(`rejected cleanup: ${e.message}`); }

  try {
    const costCutoff = new Date(Date.now() - costDays * 86400000).toISOString();
    const { count: cc } = await ctx.supabase.from('cost_events')
      .delete({ count: 'exact' }).lt('timestamp', costCutoff);
    processed += cc ?? 0;
  } catch (e: any) { errors.push(`cost_events cleanup: ${e.message}`); }

  return { job: 'cleanupExpiredData', success: errors.length === 0, processed, errors, duration_ms: Date.now() - start };
}
