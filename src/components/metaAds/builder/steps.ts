// The builder's steps and what "done" means for each — pure, so the stepper,
// the Continue hint and the tests agree. Advisory only: the server preflight
// is the gate in front of Meta and money; this only guides the customer.
import type { MetaAsset, MetaCampaignRow, MetaCreativeRow, MetaStatus } from '@/services/metaAds';
// Relative, with the extension, so node:test can import this module directly.
import { GOAL_SPECS, isHttpsUrl } from '../../../lib/metaAds/payload.ts';
import type { MetaGoal } from '../../../lib/metaAds/strategy.ts';

export const STEPS = ['account', 'offer', 'goal', 'destination', 'audience', 'budget', 'creative', 'placements', 'brief', 'review'] as const;
export type StepKey = (typeof STEPS)[number];

export const ALL_GOALS: MetaGoal[] = ['LEADS_ON_META', 'MESSAGES', 'LEADS_ON_WEBSITE', 'SITE_REGISTRATIONS', 'PROMOTE', 'ENGAGEMENT'];

export function selectedAsset(status: MetaStatus | null, kind: MetaAsset['kind']): MetaAsset | null {
  return status?.assets.find((a) => a.kind === kind && a.selected && a.status !== 'UNAVAILABLE') ?? null;
}

export interface StepContext {
  status: MetaStatus | null;
  campaign: MetaCampaignRow;
  creatives: MetaCreativeRow[];
}

/** Why a step is not done yet — an i18n key, or null when done. */
export function stepGap(step: StepKey, ctx: StepContext): string | null {
  const { status, campaign: c, creatives } = ctx;
  const goal = c.goal as MetaGoal;
  const spec = GOAL_SPECS[goal];
  const health = status?.connection?.health ?? (status?.connection?.status === 'CONNECTED' ? 'CONNECTED' : 'NOT_CONNECTED');
  switch (step) {
    case 'account':
      if (health === 'NOT_CONNECTED') return 'madsb_gap_connect';
      if (health === 'TOKEN_EXPIRED' || health === 'REVOKED') return 'madsb_gap_reconnect';
      if (!selectedAsset(status, 'PAGE')) return 'madsb_gap_page';
      if (!selectedAsset(status, 'AD_ACCOUNT')) return 'madsb_gap_ad_account';
      return null;
    case 'offer': {
      if (c.property_id) return null;
      const offer = c.offer as { isProperty?: boolean; title?: string } | null;
      if (offer && offer.isProperty === false && String(offer.title ?? '').trim()) return null;
      return offer && offer.isProperty === false ? 'madsb_gap_offer_title' : 'madsb_gap_offer';
    }
    case 'goal':
      return (status?.settings.goalsEnabled ?? []).includes(goal) ? null : 'madsb_gap_goal';
    case 'destination':
      if (spec.needsWebsiteUrl && !isHttpsUrl(c.destination?.url)) return 'madsb_gap_url';
      if (spec.needsPixel && !selectedAsset(status, 'PIXEL')) return 'madsb_gap_pixel';
      if (spec.needsLeadForm && !(c.destination?.formId || selectedAsset(status, 'LEAD_FORM'))) return 'madsb_gap_form';
      if (spec.needsMessagingApp && !c.destination?.messagingApp) return 'madsb_gap_messaging';
      return null;
    case 'audience':
      return null;
    case 'budget': {
      const min = status?.settings.minDailyCents ?? 200;
      const minDays = Math.max(2, status?.settings.minDurationDays ?? 2);
      if (!(Number(c.daily_budget_cents) >= min)) return 'madsb_gap_budget';
      if (!(Number(c.duration_days) >= minDays)) return 'madsb_gap_days';
      return null;
    }
    case 'creative': {
      const withMedia = creatives.filter((cr) => cr.media.length > 0);
      if (withMedia.length === 0) return 'madsb_gap_media';
      if (goal !== 'ENGAGEMENT' && withMedia.some((cr) => !cr.primary_text.trim())) return 'madsb_gap_text';
      if (['LEADS_ON_META', 'LEADS_ON_WEBSITE', 'SITE_REGISTRATIONS', 'PROMOTE'].includes(goal) && withMedia.some((cr) => !cr.headline.trim())) return 'madsb_gap_headline';
      return null;
    }
    case 'placements':
      return c.placements?.mode === 'CUSTOM' && !(c.placements.list ?? []).length ? 'madsb_gap_placements' : null;
    case 'brief':
      // Optional: the owner's own words, never required to continue.
      return null;
    case 'review':
      return c.preflight?.status === 'READY' ? null : 'madsb_gap_preflight';
  }
}

/** Clamp and parse the two money/time inputs the way the server will. */
export function parseDailyCents(input: string): number | null {
  const n = Number(String(input).replace(',', '.').trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

export function parseDays(input: string, minDays: number): { days: number | null; tooShort: boolean } {
  const trimmed = String(input).trim();
  if (!/^\d+$/.test(trimmed)) return { days: null, tooShort: false };
  const n = Number(trimmed);
  if (n < Math.max(2, minDays)) return { days: null, tooShort: true };
  return { days: Math.min(n, 365), tooShort: false };
}

export function urlProblem(url: string | undefined | null): string | null {
  const v = String(url ?? '').trim();
  if (!v) return 'madsb_url_empty';
  if (/^http:\/\//i.test(v)) return 'madsb_url_not_https';
  if (!/^https:\/\//i.test(v)) return 'madsb_url_scheme';
  return isHttpsUrl(v) ? null : 'madsb_url_invalid';
}

/**
 * A preflight detail code → i18n keys. Codes that carry a value (SHORT_1234,
 * ACCOUNT_CURRENCY_GEL, MIN_2_DAYS) keep it as {{value}}; permission names are
 * shown as they are, because they are what Meta's own screens call them.
 */
export function preflightDetails(detail: string): Array<{ key: string; value: string }> {
  return detail.split(',').filter(Boolean).slice(0, 4).map((raw) => {
    const code = raw.trim();
    let m: RegExpMatchArray | null;
    if ((m = code.match(/^SHORT_(\d+)$/))) return { key: 'madsb_pfd_short', value: `$${(Number(m[1]) / 100).toFixed(2)}` };
    if ((m = code.match(/^MIN_(\d+)_DAYS$/))) return { key: 'madsb_pfd_min_days', value: m[1] };
    if ((m = code.match(/^ACCOUNT_STATUS_(\d+)$/))) return { key: 'madsb_pfd_account_status', value: m[1] };
    if ((m = code.match(/^ACCOUNT_CURRENCY_(\w+)$/))) return { key: 'madsb_pfd_account_currency', value: m[1] };
    if (code.startsWith('meta_err')) return { key: code, value: '' };
    if (/^[a-z_]+$/.test(code)) return { key: 'madsb_pfd_permission', value: code };
    return { key: `madsb_pfd_${code.toLowerCase()}`, value: code };
  });
}

/** The automation this campaign will actually get, by goal. */
export function handledTasks(goal: MetaGoal, opts: { hasInstagram: boolean; placementsMode: string; housing: boolean }): string[] {
  const spec = GOAL_SPECS[goal];
  const tasks = ['campaign_structure', 'objective_mapping', 'adset_config', 'location_targeting'];
  if (opts.housing) tasks.push('housing_rules');
  tasks.push('budget_schedule', opts.placementsMode === 'CUSTOM' ? 'placements_manual' : 'placements_auto', 'media_upload', 'media_validation', 'copy_fields', 'cta_config');
  if (spec.needsPixel) tasks.push('tracking_pixel');
  if (spec.needsLeadForm) tasks.push('instant_form', 'lead_webhook');
  if (spec.needsMessagingApp) tasks.push('messaging_destination');
  if (opts.hasInstagram) tasks.push('instagram_identity');
  tasks.push('payload', 'preflight', 'submission', 'status_sync', 'spend_settlement', 'error_normalization');
  return tasks;
}
