// FIND BUYERS / FIND TENANTS — native Telegram into the people-first pipeline (2026-10-16).
//
// The free native reader (community-sync, MTProto) stores Telegram messages in
// raw_signals for internal matching, but until now none of them reached Find Buyers:
// a campaign showed only paid-Actor leads. At the end of a campaign the fresh native
// messages are judged by the SAME pipeline as every Actor result — the same classifier,
// the same 30-day rule, the same gates (sellers, brokers, unconfirmed buy/rent) — and
// a genuine buyer or tenant becomes a lead with its message link as evidence.
//
// Free: no Actor, nothing reserved. The pipeline's model is used only for ambiguous
// text (≤ 3 batched calls), costed to the campaign like any OpenAI call. The stored
// messages are never re-written (reusing + verbatim ids): their classification for
// internal matching stays theirs.

import { processItems, type CampaignRow, type PipelineResult } from './pipeline.ts';
import { parsePriceBook } from './openai.ts';
import type { FindBuyersSettings } from './campaign.ts';
import type { NormalizedItem } from '../../../../src/research-core/findBuyers/normalize.ts';

/** Demand-looking messages first, then undecided ones; bounded per campaign. */
export const NATIVE_TELEGRAM_LIMITS = { demand: 150, unknown: 150, maxAgeDays: 30 } as const;

export function nativeMessageItem(r: any): NormalizedItem | null {
  const text = String(r.original_text ?? '').trim();
  if (!text || !r.external_id) return null;
  return {
    kind: 'POST', network: 'TELEGRAM', externalId: String(r.external_id), url: r.source_url ?? null,
    parentExternalId: null, parentUrl: null,
    author: { id: null, name: r.author_public_name ?? null, url: r.author_public_url ?? null, handle: null },
    text, publishedAt: r.published_at ?? null,
    engagement: { comments: null, likes: null, shares: null }, group: null, inlineComments: [],
  };
}

export async function assessNativeTelegram(db: any, matchingJobId: string, settings: FindBuyersSettings, now = Date.now()): Promise<PipelineResult | null> {
  const { data: campaign } = await db.from('find_buyers_campaigns')
    .select('matching_job_id,campaign_id,property_id,user_id,transaction,dna,finalized_at').eq('matching_job_id', matchingJobId).maybeSingle();
  if (!campaign || campaign.finalized_at) return null;
  const since = new Date(now - NATIVE_TELEGRAM_LIMITS.maxAgeDays * 86_400_000).toISOString();
  const cols = 'id,external_id,source_url,author_public_name,author_public_url,original_text,published_at';
  const base = () => db.from('raw_signals').select(cols).eq('platform', 'TELEGRAM').eq('provider', 'HOMATCH')
    .not('target_id', 'is', null).gte('published_at', since).order('published_at', { ascending: false });
  const [demand, unknown] = await Promise.all([
    base().eq('research_direction', 'DEMAND').limit(NATIVE_TELEGRAM_LIMITS.demand),
    base().eq('research_direction', 'UNKNOWN').limit(NATIVE_TELEGRAM_LIMITS.unknown),
  ]);
  const items = [...((demand.data ?? []) as any[]), ...((unknown.data ?? []) as any[])]
    .map(nativeMessageItem).filter((x): x is NormalizedItem => x !== null);
  if (!items.length) return null;
  return processItems({
    db, campaign: campaign as CampaignRow, stage: 'TELEGRAM_CHANNEL', runId: `native-tg:${matchingJobId}`, runLanguage: null,
    datasetId: null, providerRunId: null, book: parsePriceBook(settings.priceBook), gate: settings.commentGate,
    lowDownPaymentRatio: settings.lowDownPaymentRatio, parent: null, sourceId: null, sourceYield: null, now,
    reusing: true, verbatimIds: true, aiAmbiguous: settings.aiAmbiguous, aiHeadroomPerItemMicros: settings.aiHeadroomPerItemMicros,
  }, items);
}
