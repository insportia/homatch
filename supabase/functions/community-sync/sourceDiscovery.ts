// Telegram SOURCE discovery: search → register → audit → (maybe) activate.
//
// Runs on its own slow cadence (at most daily) because Telegram's public-chat
// search is one of its most tightly limited methods. Everything it finds is
// kept globally in community_targets, so no campaign ever pays to find the
// same community again.
//
// What it will not do: join anything, read a private chat, or activate a
// community on a guess. A found community starts DISCOVERED and switched OFF;
// it is activated only after its own recent messages were read and measured,
// and only if Admin allows automatic activation.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { TelegramError, type TelegramClient } from '../../../src/research-core/adapters/telegram/client.ts';
import { auditSource, sourceQueriesFor } from '../../../src/research-core/discovery/telegram-sources.ts';
import type { DiscoverySettings } from '../_shared/discoverySettings.ts';

const AUDITS_PER_RUN = 6;
const RESULTS_PER_QUERY = 10;

export async function discoverTelegramSources(
  db: ReturnType<typeof createClient>,
  client: TelegramClient,
  settings: DiscoverySettings,
  options: { queries: string[] | null; maxQueries: number; market?: string },
): Promise<Record<string, unknown>> {
  if (!client.capabilities.searchPublicChats) {
    return { skipped: 'CAPABILITY_NOT_SUPPORTED', detail: `${client.mode} cannot search public chats` };
  }
  const market = (options.market ?? 'GE').toUpperCase();
  const queries = (options.queries?.length
    ? options.queries.map((query) => ({ language: null as string | null, query }))
    : sourceQueriesFor(market)).slice(0, Math.max(1, Math.min(15, options.maxQueries)));

  const found = new Map<string, { chat: Awaited<ReturnType<TelegramClient['resolveChat']>>; query: string; language: string | null }>();
  let stoppedBy: { kind: string; retryAfterSeconds: number | null } | null = null;

  for (const { query, language } of queries) {
    try {
      const chats = await client.searchPublicChats(query, RESULTS_PER_QUERY);
      for (const chat of chats) {
        if (chat.username && !found.has(chat.username)) found.set(chat.username, { chat, query, language });
      }
    } catch (error) {
      const kind = error instanceof TelegramError ? error.kind : 'NETWORK_ERROR';
      stoppedBy = { kind, retryAfterSeconds: error instanceof TelegramError ? error.retryAfterSeconds : null };
      break;
    }
  }

  /* Register. Existing targets are left exactly as they are — an operator's
     decision about a community is never overwritten by a search result. */
  let registered = 0;
  for (const { chat, query, language } of found.values()) {
    const { data, error } = await db.from('community_targets').upsert({
      platform: 'TELEGRAM',
      external_id: chat.username,
      name: chat.title,
      url: `https://t.me/${chat.username}`,
      market,
      languages: language ? [language] : [],
      community_type: chat.kind,
      visibility: 'PUBLIC',
      membership_state: 'PUBLIC',
      readability: 'UNVERIFIED',
      acquisition_mode: 'AUTHORIZED_ACCOUNT',
      lifecycle: 'DISCOVERED',
      discovery_enabled: false,
      telegram_peer_id: chat.id,
      discovered_via: 'TELEGRAM_SEARCH',
      metadata: { discovered_query: query, participants: chat.participants },
    }, { onConflict: 'platform,external_id', ignoreDuplicates: true }).select('id');
    if (!error && data?.length) registered += 1;
  }

  /* Audit: newest DISCOVERED first, a handful per run. */
  const audits: Array<Record<string, unknown>> = [];
  if (!stoppedBy) {
    const { data: pending } = await db.from('community_targets')
      .select('id,external_id,metadata')
      .eq('platform', 'TELEGRAM').eq('lifecycle', 'DISCOVERED')
      .order('created_at', { ascending: false }).limit(AUDITS_PER_RUN);
    for (const target of pending ?? []) {
      try {
        const page = await client.readHistory(String(target.external_id), { cursor: null, limit: 50 });
        const audit = auditSource(page.items.map((m) => ({ text: m.text, date: m.date })), {
          activeMaxDays: settings.freshness.activeMaxDays,
          minRelevance: settings.telegramMinRelevance,
        });
        await db.from('community_targets').update({
          lifecycle: audit.qualifies ? 'AUDITED' : 'LOW_SIGNAL',
          readability: 'READABLE',
          discovery_enabled: audit.qualifies && settings.telegramAutoEnableSources,
          relevance_score: audit.relevance,
          last_message_at: audit.lastMessageAt,
          audited_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          metadata: { ...((target.metadata as Record<string, unknown>) ?? {}), audit: { ...audit, at: new Date().toISOString() } },
        }).eq('id', target.id);
        /* The read proved the channel public and readable, so it gets the
           registry entry every signal it yields points back to (raw_signals.
           source_id). Without it revalidate-evidence answers "unregistered;
           not requested" and the evidence stays UNKNOWN forever. */
        await registerSource(db, target, market);
        audits.push({ target: target.external_id, qualifies: audit.qualifies, relevance: audit.relevance, reason: audit.reason });
      } catch (error) {
        const kind = error instanceof TelegramError ? error.kind : 'NETWORK_ERROR';
        if (['NOT_CONFIGURED', 'DISABLED', 'AUTH_FAILED', 'RATE_LIMITED'].includes(kind)) {
          stoppedBy = { kind, retryAfterSeconds: error instanceof TelegramError ? error.retryAfterSeconds : null };
          break;
        }
        await db.from('community_targets').update({
          lifecycle: kind === 'CHAT_PRIVATE' ? 'BLOCKED' : kind === 'CHAT_NOT_FOUND' ? 'RETIRED' : 'DEGRADED',
          readability: kind === 'CHAT_PRIVATE' ? 'API_UNAVAILABLE' : undefined,
          last_error_code: kind,
          last_error_at: new Date().toISOString(),
        }).eq('id', target.id);
        audits.push({ target: target.external_id, qualifies: false, reason: kind });
      }
    }
  }

  return {
    market,
    queriesRun: queries.length,
    communitiesFound: found.size,
    newlyRegistered: registered,
    audits,
    stoppedBy,
    autoEnable: settings.telegramAutoEnableSources,
  };
}

/**
 * The source_registry entry for a community a real read proved public.
 * Registered AUDITED with a PUBLIC_HTML finding (a public channel's permalinks
 * render for anyone), and `active: false`: the community target, not the
 * registry, decides whether HOMATCH reads it. An existing entry is kept as it
 * is — an operator's decision about a source is never overwritten here.
 */
export async function registerSource(
  db: ReturnType<typeof createClient>,
  target: { id: unknown; external_id: unknown },
  market: string,
): Promise<string | null> {
  const handle = String(target.external_id ?? '');
  if (!/^[A-Za-z0-9_]{3,64}$/.test(handle)) return null;
  await db.from('source_registry').upsert({
    platform: 'TELEGRAM',
    external_id: handle,
    url: `https://t.me/${handle}`,
    source_type: 'TELEGRAM_GROUP',
    source_family: 'PUBLIC_COMMUNITY',
    country_code: market,
    access_state: 'PUBLIC',
    access_finding: 'PUBLIC_HTML',
    lifecycle: 'AUDITED',
    adapter_id: 'telegram:mtproto',
    active: false,
    priority_rationale: 'Registered by Telegram source discovery after a real read of its recent public messages.',
  }, { onConflict: 'platform,external_id', ignoreDuplicates: true });
  const { data } = await db.from('source_registry').select('id')
    .eq('platform', 'TELEGRAM').eq('external_id', handle).maybeSingle();
  const sourceId = (data as { id?: string } | null)?.id ?? null;
  if (sourceId) {
    await db.from('community_targets').update({ source_id: sourceId, source_registry_id: sourceId })
      .eq('id', target.id).is('source_id', null);
  }
  return sourceId;
}
