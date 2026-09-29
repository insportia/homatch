// The discovery settings every discovery function reads, in one query.
//
// One place, so that "is Telegram on", "what is the freshness window" and
// "may a discovered source switch itself on" are answered identically by the
// scheduler, the campaign path and the admin screen.

import {
  parseActiveDemandPolicy,
  type ActiveDemandFreshnessPolicy,
} from '../../../src/research-core/discovery/freshness-policy.ts';

export type TelegramMode = 'MTPROTO_USER' | 'PUBLIC_PREVIEW';

export interface DiscoverySettings {
  freshness: ActiveDemandFreshnessPolicy;
  telegramEnabled: boolean;
  telegramMode: TelegramMode;
  telegramAutoEnableSources: boolean;
  telegramMinRelevance: number;
  /** Master switch for scheduled background refresh (all sources). */
  backgroundRefreshEnabled: boolean;
  forumDiscoveryEnabled: boolean;
  classifierScheduleEnabled: boolean;
  campaignMinCredits: number;
  campaignDefaultCredits: number;
  campaignMaxCredits: number | null;
  sourceJobMaxAttempts: number;
  sourceJobLeaseSeconds: number;
  /** May a campaign queue its own Telegram/forum source jobs for a gap? */
  campaignSourceDiscoveryEnabled: boolean;
  /** How long an asynchronous campaign may wait for its source jobs. */
  campaignDiscoveryMinutes: number;
}

export const DISCOVERY_SETTING_KEYS = [
  'discovery_freshness_policy',
  'telegram_discovery_enabled',
  'telegram_integration_mode',
  'telegram_source_auto_enable',
  'telegram_source_min_relevance',
  'discovery_background_refresh_enabled',
  'forum_discovery_enabled',
  'classifier_schedule_enabled',
  'campaign_min_credits',
  'campaign_default_credits',
  'campaign_max_credits',
  'discovery_job_max_attempts',
  'discovery_job_lease_seconds',
  'campaign_source_discovery_enabled',
  'campaign_discovery_minutes',
] as const;

const unquote = (v: unknown) => (typeof v === 'string' ? v.replace(/^"|"$/g, '') : v);
const bool = (v: unknown, fallback: boolean) => {
  const u = unquote(v);
  if (u === true || u === 'true') return true;
  if (u === false || u === 'false') return false;
  return fallback;
};
const num = (v: unknown, fallback: number, min: number, max: number) => {
  const n = Number(unquote(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export function parseDiscoverySettings(rows: Array<{ key: string; value: unknown }>): DiscoverySettings {
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const minCredits = num(m.get('campaign_min_credits'), 50, 50, 100_000);
  const maxRaw = m.get('campaign_max_credits');
  const max = maxRaw === undefined || maxRaw === null || unquote(maxRaw) === '' ? null : num(maxRaw, 0, minCredits, 1_000_000);
  return {
    freshness: parseActiveDemandPolicy(m.get('discovery_freshness_policy')),
    telegramEnabled: bool(m.get('telegram_discovery_enabled'), false),
    telegramMode: unquote(m.get('telegram_integration_mode')) === 'PUBLIC_PREVIEW' ? 'PUBLIC_PREVIEW' : 'MTPROTO_USER',
    telegramAutoEnableSources: bool(m.get('telegram_source_auto_enable'), true),
    telegramMinRelevance: num(m.get('telegram_source_min_relevance'), 0.2, 0, 1),
    backgroundRefreshEnabled: bool(m.get('discovery_background_refresh_enabled'), false),
    forumDiscoveryEnabled: bool(m.get('forum_discovery_enabled'), false),
    classifierScheduleEnabled: bool(m.get('classifier_schedule_enabled'), false),
    campaignMinCredits: minCredits,
    campaignDefaultCredits: Math.max(minCredits, num(m.get('campaign_default_credits'), 50, 50, 1_000_000)),
    campaignMaxCredits: max,
    sourceJobMaxAttempts: num(m.get('discovery_job_max_attempts'), 4, 1, 10),
    sourceJobLeaseSeconds: num(m.get('discovery_job_lease_seconds'), 180, 30, 1800),
    campaignSourceDiscoveryEnabled: bool(m.get('campaign_source_discovery_enabled'), false),
    /* Capped below the 60-minute reservation TTL, so a reservation is never
       swept out from under a campaign that is still running. */
    campaignDiscoveryMinutes: num(m.get('campaign_discovery_minutes'), 30, 5, 45),
  };
}

export async function loadDiscoverySettings(db: any): Promise<DiscoverySettings> {
  const { data } = await db.from('admin_settings').select('key,value').in('key', DISCOVERY_SETTING_KEYS as unknown as string[]);
  return parseDiscoverySettings((data ?? []) as Array<{ key: string; value: unknown }>);
}
