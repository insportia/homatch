// ============================================================
// HOMATCH — social-collect Edge Function
// Collects new posts from a registered social source
// (Facebook / Telegram / Instagram / VK) via Apify.
// Only collects NEW content per source (cursor-based).
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ApifyProvider } from '../_shared/providers.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BUYER_PLATFORMS = ['FACEBOOK', 'TELEGRAM', 'INSTAGRAM', 'VK'] as const;
type SocialPlatform = typeof BUYER_PLATFORMS[number];

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const { sourceId, maxItems = 50, dryRun = false } = await req.json();

    // Load source
    const { data: source, error: srcErr } = await supabase
      .from('source_registry')
      .select('*')
      .eq('id', sourceId)
      .maybeSingle();

    if (srcErr || !source) {
      return json({ error: 'Source not found', sourceId }, 404);
    }
    if (!source.active) {
      return json({ error: 'Source is inactive', sourceId }, 400);
    }

    const platform = source.platform as SocialPlatform;
    if (!BUYER_PLATFORMS.includes(platform)) {
      return json({ error: `Platform ${platform} not supported for social collection` }, 400);
    }

    const provider = new ApifyProvider();
    const status = provider.isConfigured() ? 'CONFIGURED' : 'MOCK';

    if (dryRun) {
      return json({ status, sourceId, platform, url: source.url, dryRun: true });
    }

    // Collect
    const collectResponse = await provider.collect({
      platform,
      sourceUrl: source.url,
      externalId: source.external_id ?? undefined,
      since: source.last_collected_at ?? undefined,
      maxItems,
    });

    // Insert raw signals
    let inserted = 0;
    let skipped = 0;
    let filtered = 0;

    for (const post of collectResponse.posts) {
      const text = post.text?.trim();
      if (!text || text.length < 20) { filtered++; continue; }

      // Cheap pre-filter: skip obvious ads/spam
      if (isCheapFilteredOut(text)) { filtered++; continue; }

      const fingerprint = await contentFingerprint(text);

      const { error: insertErr } = await supabase
        .from('raw_signals')
        .insert({
          source_id: sourceId,
          platform,
          external_id: post.externalId,
          source_url: post.sourceUrl ?? source.url,
          author_public_name: post.authorName ?? null,
          author_public_url: post.authorUrl ?? null,
          original_text: text,
          language: source.language ?? null,
          published_at: post.publishedAt ?? null,
          content_fingerprint: fingerprint,
          provider: collectResponse.provider,
          classification_status: 'PENDING',
        });

      if (insertErr?.code === '23505') {
        // Also try fingerprint dedupe
        const { data: existingByFp } = await supabase
          .from('raw_signals')
          .select('id')
          .eq('content_fingerprint', fingerprint)
          .maybeSingle();
        if (existingByFp) {
          skipped++;
        } else {
          skipped++;
        }
      } else if (!insertErr) {
        inserted++;
      }
    }

    // Update source registry
    const now = new Date().toISOString();
    await supabase
      .from('source_registry')
      .update({
        last_collected_at: now,
        last_successful_at: now,
        failure_count: 0,
      })
      .eq('id', sourceId);

    // Track COGS (Apify costs tracked via usage credits separately)
    await supabase.from('cost_events').insert({
      provider: 'APIFY',
      operation_type: `COLLECT_${platform}`,
      source: sourceId,
      market: source.country_code,
      units: collectResponse.posts.length,
      cost_usd: collectResponse.costUsd,
      success: true,
      cache_hit: false,
    });

    return json({
      success: true,
      status,
      sourceId,
      platform,
      postsCollected: collectResponse.posts.length,
      signalsInserted: inserted,
      signalsSkipped: skipped,
      signalsFiltered: filtered,
      provider: collectResponse.provider,
    });
  } catch (err) {
    console.error('social-collect error:', err);

    // Track failure if sourceId available
    try {
      const body = await req.json().catch(() => ({}));
      if (body?.sourceId) {
        const supabaseRetry = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        );
        await supabaseRetry.rpc('increment_source_failure', { p_source_id: body.sourceId });
      }
    } catch { /* ignore */ }

    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});

// ── CHEAP PRE-FILTER ──────────────────────────────────────────
// Multilingual rule-based filter to avoid sending junk to AI

const SPAM_PATTERNS = [
  // English
  /\bfor sale\b.*\bcontact\b/i,
  /\bright property\b/i,
  /\bwww\./i,
  /\bcall now\b/i,
  /\breal estate agent\b/i,
  // Russian
  /продам квартиру/i,
  /агентство недвижимости/i,
  /звоните/i,
  // Georgian
  /ვყიდი ბინას/i,
  // Turkish
  /satılık daire/i,
  /emlak ofisi/i,
  // Arabic
  /للبيع/i,
  // Hebrew
  /למכירה/i,
];

const BUYER_SIGNALS = [
  // English
  /\b(looking for|searching for|want to buy|want to rent|need a flat|need an apartment|seeking)\b/i,
  // Russian
  /\b(ищу|куплю|сниму|хочу купить|ищем квартиру|ищем жильё)\b/i,
  // Georgian
  /\b(ვეძებ|ვიყიდი|გვინდა)\b/i,
  // Turkish
  /\b(arıyorum|satın almak|kiralamak istiyorum)\b/i,
  // Arabic
  /\b(أبحث عن|أريد شراء|أريد استئجار)\b/i,
  // Hebrew
  /\b(מחפש|אני מחפש|רוצה לקנות)\b/i,
];

function isCheapFilteredOut(text: string): boolean {
  // If matches spam patterns and no buyer signal → filter
  const hasSpam = SPAM_PATTERNS.some(p => p.test(text));
  const hasBuyer = BUYER_SIGNALS.some(p => p.test(text));
  if (hasSpam && !hasBuyer) return true;

  // Very short or no meaningful content
  const wordCount = text.split(/\s+/).length;
  if (wordCount < 5) return true;

  // Likely URL-only post
  if (/^https?:\/\/\S+$/.test(text.trim())) return true;

  return false;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

async function contentFingerprint(text: string): Promise<string> {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim().substring(0, 200);
  const data = new TextEncoder().encode(normalized);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .slice(0, 8)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
