// META ADS — THE GRAPH PAYLOAD BUILDER. Pure, typed, tested.
//
// strategy.ts decides WHAT campaign to run. This module decides exactly which
// Marketing API parameters that campaign needs, per goal, so the adapter never
// improvises a payload. The previous launch path sent the same link-click
// shape for every goal: no media, no lead form, no pixel, placements ignored,
// ad sets and ads left PAUSED under an ACTIVE campaign. Every one of those is
// a campaign that either fails at Meta or silently never delivers.
//
// What this module guarantees:
//   · every goal has an explicit objective / optimization / destination /
//     promoted_object combination, stated once in GOAL_SPECS
//   · a creative always carries its media (image_hash or video_id)
//   · lead-form ads carry the form; website-conversion ads carry the pixel
//     and the conversion event; messaging ads carry the messaging app
//   · custom placements become real publisher_platforms / positions
//   · the tree is created with children ACTIVE under a PAUSED campaign, so a
//     partial failure never spends and switching the campaign on is the one
//     act that starts delivery
//
// No React, no Deno, no network: imported by the edge adapter and by
// node:test directly.

import type { MetaGoal, TypedCampaignPlan, PlannedAdSet } from './strategy.ts';

export type MessagingApp = 'MESSENGER' | 'INSTAGRAM_DIRECT' | 'WHATSAPP';

export interface GoalSpec {
  objective: string;
  optimizationGoal: string;
  /** Ad-set destination_type, when the goal has one. */
  destinationType: string | null;
  needsPixel: boolean;
  /** Standard event the website-conversion goals optimise for. */
  pixelEvent: 'LEAD' | 'COMPLETE_REGISTRATION' | null;
  needsLeadForm: boolean;
  needsWebsiteUrl: boolean;
  needsMessagingApp: boolean;
  defaultCta: string;
  /** CTAs Meta accepts for this goal that we offer customers. */
  allowedCtas: readonly string[];
}

export const GOAL_SPECS: Record<MetaGoal, GoalSpec> = {
  LEADS_ON_META: {
    objective: 'OUTCOME_LEADS', optimizationGoal: 'LEAD_GENERATION', destinationType: 'ON_AD',
    needsPixel: false, pixelEvent: null, needsLeadForm: true, needsWebsiteUrl: false, needsMessagingApp: false,
    // Instant Form ad CTAs as Meta documents them for lead ads (CONTACT_US is not among them).
    defaultCta: 'SIGN_UP', allowedCtas: ['SIGN_UP', 'LEARN_MORE', 'GET_QUOTE', 'APPLY_NOW', 'SUBSCRIBE'],
  },
  LEADS_ON_WEBSITE: {
    objective: 'OUTCOME_LEADS', optimizationGoal: 'OFFSITE_CONVERSIONS', destinationType: 'WEBSITE',
    needsPixel: true, pixelEvent: 'LEAD', needsLeadForm: false, needsWebsiteUrl: true, needsMessagingApp: false,
    defaultCta: 'LEARN_MORE', allowedCtas: ['LEARN_MORE', 'SIGN_UP', 'GET_QUOTE', 'CONTACT_US', 'APPLY_NOW'],
  },
  SITE_REGISTRATIONS: {
    objective: 'OUTCOME_LEADS', optimizationGoal: 'OFFSITE_CONVERSIONS', destinationType: 'WEBSITE',
    needsPixel: true, pixelEvent: 'COMPLETE_REGISTRATION', needsLeadForm: false, needsWebsiteUrl: true, needsMessagingApp: false,
    defaultCta: 'SIGN_UP', allowedCtas: ['SIGN_UP', 'LEARN_MORE', 'SUBSCRIBE', 'APPLY_NOW'],
  },
  PROMOTE: {
    objective: 'OUTCOME_TRAFFIC', optimizationGoal: 'LINK_CLICKS', destinationType: 'WEBSITE',
    needsPixel: false, pixelEvent: null, needsLeadForm: false, needsWebsiteUrl: true, needsMessagingApp: false,
    defaultCta: 'LEARN_MORE', allowedCtas: ['LEARN_MORE', 'CONTACT_US', 'GET_QUOTE'],
  },
  ENGAGEMENT: {
    objective: 'OUTCOME_ENGAGEMENT', optimizationGoal: 'POST_ENGAGEMENT', destinationType: 'ON_POST',
    needsPixel: false, pixelEvent: null, needsLeadForm: false, needsWebsiteUrl: false, needsMessagingApp: false,
    defaultCta: 'LEARN_MORE', allowedCtas: [],
  },
  MESSAGES: {
    objective: 'OUTCOME_ENGAGEMENT', optimizationGoal: 'CONVERSATIONS', destinationType: null,
    needsPixel: false, pixelEvent: null, needsLeadForm: false, needsWebsiteUrl: false, needsMessagingApp: true,
    defaultCta: 'MESSAGE_PAGE', allowedCtas: ['MESSAGE_PAGE'],
  },
};

/* ── PLACEMENTS ──────────────────────────────────────────────────────── */

export const PLACEMENTS = ['facebook_feed', 'instagram_feed', 'facebook_stories', 'instagram_stories', 'instagram_reels'] as const;
export type Placement = (typeof PLACEMENTS)[number];

const PLACEMENT_TARGETING: Record<Placement, { platform: 'facebook' | 'instagram'; position: string }> = {
  facebook_feed: { platform: 'facebook', position: 'feed' },
  facebook_stories: { platform: 'facebook', position: 'story' },
  instagram_feed: { platform: 'instagram', position: 'stream' },
  instagram_stories: { platform: 'instagram', position: 'story' },
  instagram_reels: { platform: 'instagram', position: 'reels' },
};

/** Aspect ratios each placement renders well; others are cropped or letterboxed. */
export const PLACEMENT_RATIOS: Record<Placement, { ideal: string; accepts: readonly string[] }> = {
  facebook_feed: { ideal: '4:5', accepts: ['1:1', '4:5', '1.91:1', '16:9'] },
  instagram_feed: { ideal: '4:5', accepts: ['1:1', '4:5', '1.91:1'] },
  facebook_stories: { ideal: '9:16', accepts: ['9:16', '4:5', '1:1'] },
  instagram_stories: { ideal: '9:16', accepts: ['9:16', '4:5', '1:1'] },
  instagram_reels: { ideal: '9:16', accepts: ['9:16'] },
};

/** Nearest named ratio for a width × height, within 3%. */
export function nameRatio(width: number, height: number): string | null {
  if (!(width > 0 && height > 0)) return null;
  const r = width / height;
  const named: Array<[string, number]> = [['1:1', 1], ['4:5', 0.8], ['9:16', 9 / 16], ['1.91:1', 1.91], ['16:9', 16 / 9]];
  let best: [string, number] | null = null;
  for (const [name, value] of named) {
    const diff = Math.abs(r - value) / value;
    if (diff <= 0.03 && (!best || diff < best[1])) best = [name, diff];
  }
  return best ? best[0] : null;
}

export type MediaVerdict = 'READY' | 'WARNING' | 'INCOMPATIBLE';

export interface MediaFacts {
  mime: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
}

export interface MediaCheck {
  verdict: MediaVerdict;
  ratio: string | null;
  /** Per-placement verdicts for the placements being checked. */
  placements: Partial<Record<Placement, MediaVerdict>>;
  reasons: string[];
}

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const VIDEO_MIMES = ['video/mp4', 'video/quicktime'];

/**
 * Deterministic media validation — format, size, resolution, duration and
 * per-placement ratio compatibility. Reasons are i18n keys, never prose.
 */
export function checkMedia(facts: MediaFacts, placements: readonly Placement[] = PLACEMENTS): MediaCheck {
  const reasons: string[] = [];
  const isImage = IMAGE_MIMES.includes(facts.mime);
  const isVideo = VIDEO_MIMES.includes(facts.mime);
  if (!isImage && !isVideo) {
    return { verdict: 'INCOMPATIBLE', ratio: null, placements: {}, reasons: ['media_format_unsupported'] };
  }
  const maxBytes = isImage ? 30 * 1024 * 1024 : 50 * 1024 * 1024;
  if (facts.sizeBytes > maxBytes) {
    return { verdict: 'INCOMPATIBLE', ratio: null, placements: {}, reasons: ['media_too_large'] };
  }
  const w = Number(facts.width ?? 0);
  const h = Number(facts.height ?? 0);
  let verdict: MediaVerdict = 'READY';
  if (!(w > 0 && h > 0)) {
    reasons.push('media_dimensions_unknown');
    verdict = 'WARNING';
  } else if (Math.min(w, h) < 600) {
    reasons.push(Math.min(w, h) < 320 ? 'media_resolution_too_low' : 'media_resolution_low');
    verdict = Math.min(w, h) < 320 ? 'INCOMPATIBLE' : 'WARNING';
  }
  if (isVideo) {
    const d = Number(facts.durationSeconds ?? 0);
    if (d > 0 && d < 1) { reasons.push('media_video_too_short'); verdict = 'INCOMPATIBLE'; }
    else if (d > 240 * 60) { reasons.push('media_video_too_long'); verdict = 'INCOMPATIBLE'; }
    else if (d > 60) { reasons.push('media_video_long_for_stories'); if (verdict === 'READY') verdict = 'WARNING'; }
  }
  const ratio = nameRatio(w, h);
  const perPlacement: Partial<Record<Placement, MediaVerdict>> = {};
  for (const p of placements) {
    const spec = PLACEMENT_RATIOS[p];
    if (!ratio) perPlacement[p] = 'WARNING';
    else if (ratio === spec.ideal) perPlacement[p] = 'READY';
    else if (spec.accepts.includes(ratio)) perPlacement[p] = 'WARNING';
    else perPlacement[p] = 'INCOMPATIBLE';
    if (p === 'instagram_reels' && isImage) perPlacement[p] = 'INCOMPATIBLE';
  }
  if (Object.values(perPlacement).some((v) => v !== 'READY') && verdict === 'READY') {
    reasons.push('media_ratio_cropped_on_some_placements');
    verdict = 'WARNING';
  }
  if (placements.length > 0 && Object.values(perPlacement).every((v) => v === 'INCOMPATIBLE')) {
    reasons.push('media_no_compatible_placement');
    verdict = 'INCOMPATIBLE';
  }
  return { verdict, ratio, placements: perPlacement, reasons };
}

/**
 * HOMATCH-recommended placements, from what is actually connected and what the
 * media can fill. Instagram placements need an Instagram identity; Reels need
 * video. Returned as an explicit list so the review screen can show it.
 */
export function recommendedPlacements(opts: {
  hasInstagram: boolean;
  hasVideo: boolean;
  goal: MetaGoal;
}): Placement[] {
  const out: Placement[] = ['facebook_feed', 'facebook_stories'];
  if (opts.hasInstagram) {
    out.push('instagram_feed', 'instagram_stories');
    if (opts.hasVideo) out.push('instagram_reels');
  }
  if (opts.goal === 'MESSAGES' && !opts.hasInstagram) return ['facebook_feed'];
  return out;
}

export function placementTargeting(list: readonly string[]): Record<string, string[]> | null {
  const valid = list.filter((p): p is Placement => (PLACEMENTS as readonly string[]).includes(p));
  if (valid.length === 0) return null;
  const platforms = new Set<string>();
  const fb: string[] = [];
  const ig: string[] = [];
  for (const p of valid) {
    const t = PLACEMENT_TARGETING[p];
    platforms.add(t.platform);
    (t.platform === 'facebook' ? fb : ig).push(t.position);
  }
  const out: Record<string, string[]> = { publisher_platforms: [...platforms] };
  if (fb.length) out.facebook_positions = fb;
  if (ig.length) out.instagram_positions = ig;
  return out;
}

/* ── LAUNCH CONTEXT ──────────────────────────────────────────────────── */

export interface LaunchContext {
  pageId: string;
  instagramUserId: string | null;
  pixelId: string | null;
  leadFormId: string | null;
  messagingApp: MessagingApp | null;
  whatsappNumber: string | null;
  countries: string[];
  startTime: string;
  endTime: string;
  websiteUrl: string | null;
}

export interface LaunchCreative {
  id: string;
  kind: 'IMAGE' | 'VIDEO';
  imageHash: string | null;
  videoId: string | null;
  /** Video thumbnail — Meta requires one for video creatives. */
  thumbnailUrl: string | null;
  primaryText: string;
  headline: string;
  description: string;
  cta: string | null;
}

/** What a goal needs that the context does not supply — for preflight. */
export function missingRequirements(goal: MetaGoal, ctx: Partial<LaunchContext>): string[] {
  const spec = GOAL_SPECS[goal];
  const missing: string[] = [];
  if (!ctx.pageId) missing.push('PAGE_REQUIRED');
  if (spec.needsPixel && !ctx.pixelId) missing.push('PIXEL_REQUIRED');
  if (spec.needsLeadForm && !ctx.leadFormId) missing.push('LEAD_FORM_REQUIRED');
  if (spec.needsWebsiteUrl && !isHttpsUrl(ctx.websiteUrl)) missing.push('DESTINATION_URL_INVALID');
  if (spec.needsMessagingApp) {
    if (!ctx.messagingApp) missing.push('MESSAGING_DESTINATION_REQUIRED');
    else if (ctx.messagingApp === 'INSTAGRAM_DIRECT' && !ctx.instagramUserId) missing.push('INSTAGRAM_REQUIRED');
    else if (ctx.messagingApp === 'WHATSAPP' && !ctx.whatsappNumber) missing.push('WHATSAPP_REQUIRED');
  }
  return missing;
}

export function isHttpsUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !!u.hostname && u.hostname.includes('.')
      && !/^(localhost|127\.|10\.|192\.168\.)/.test(u.hostname);
  } catch {
    return false;
  }
}

/* ── PARAMETERS ──────────────────────────────────────────────────────── */

export function campaignParams(plan: TypedCampaignPlan, name: string, countries: string[]): Record<string, unknown> {
  const params: Record<string, unknown> = {
    name: name.slice(0, 200),
    objective: plan.objective,
    buying_type: 'AUCTION',
    // Created PAUSED; switching this one flag on is what starts delivery.
    status: 'PAUSED',
    special_ad_categories: plan.specialAdCategories,
    is_adset_budget_sharing_enabled: false,
  };
  if (plan.specialAdCategories.length > 0) params.special_ad_category_country = countries;
  return params;
}

export function adSetParams(
  goal: MetaGoal,
  plan: TypedCampaignPlan,
  set: PlannedAdSet,
  ctx: LaunchContext,
  campaignId: string,
): Record<string, unknown> {
  const spec = GOAL_SPECS[goal];
  /* The plan's own targeting for this ad set (strategy v2: the customer's
     places, ages and gender, already made legal for the ad's category).
     A v1 plan has none and keeps its original market-wide spec. */
  const targeting: Record<string, unknown> = set.targeting
    ? { ...set.targeting }
    : { geo_locations: { countries: ctx.countries.length ? ctx.countries : ['GE'] }, age_min: 18 };
  targeting.targeting_automation = { advantage_audience: set.advantageAudience ? 1 : 0 };
  if (plan.audienceExternalId) targeting.custom_audiences = [{ id: plan.audienceExternalId }];
  const placementList = plan.placements.mode === 'CUSTOM' ? plan.placements.list : (set.placements ?? null);
  if (placementList && placementList.length) {
    const p = placementTargeting(placementList);
    if (p) Object.assign(targeting, p);
  }

  const params: Record<string, unknown> = {
    name: `HOMATCH ${set.key}`,
    campaign_id: campaignId,
    daily_budget: set.dailyBudgetCents,
    billing_event: 'IMPRESSIONS',
    optimization_goal: spec.optimizationGoal,
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    start_time: ctx.startTime,
    end_time: ctx.endTime,
    // ACTIVE under a PAUSED campaign: nothing delivers until the campaign flips.
    status: 'ACTIVE',
    targeting,
  };

  if (goal === 'MESSAGES') {
    params.destination_type = ctx.messagingApp ?? 'MESSENGER';
    params.promoted_object = ctx.messagingApp === 'WHATSAPP' && ctx.whatsappNumber
      ? { page_id: ctx.pageId, whatsapp_phone_number: ctx.whatsappNumber }
      : { page_id: ctx.pageId };
  } else {
    if (spec.destinationType) params.destination_type = spec.destinationType;
    if (goal === 'LEADS_ON_META' || goal === 'ENGAGEMENT') params.promoted_object = { page_id: ctx.pageId };
    if (spec.needsPixel) params.promoted_object = { pixel_id: ctx.pixelId, custom_event_type: spec.pixelEvent };
  }
  return params;
}

/**
 * The buttons Meta accepts for this goal and destination. Message ads carry
 * the one their app requires: WhatsApp's own type, otherwise Send message.
 */
export function ctaOptions(goal: MetaGoal, messagingApp?: string | null): readonly string[] {
  if (goal === 'MESSAGES') return [messagingApp === 'WHATSAPP' ? 'WHATSAPP_MESSAGE' : 'MESSAGE_PAGE'];
  return GOAL_SPECS[goal].allowedCtas;
}

/**
 * The button the ad will actually carry: the customer's choice when it is
 * valid for this goal and destination, otherwise the goal's default. ONE rule
 * for the Meta payload, the preview, the review and the editor — so what the
 * customer sees is what Meta receives, and an invalid choice is never sent.
 */
export function resolveCta(goal: MetaGoal, chosen: string | null | undefined, messagingApp?: string | null): string {
  const options = ctaOptions(goal, messagingApp);
  if (chosen && options.includes(chosen)) return chosen;
  return goal === 'MESSAGES' ? options[0] : GOAL_SPECS[goal].defaultCta;
}

export function creativeParams(goal: MetaGoal, creative: LaunchCreative, ctx: LaunchContext): Record<string, unknown> {
  const cta = resolveCta(goal, creative.cta, ctx.messagingApp);
  const storySpec: Record<string, unknown> = { page_id: ctx.pageId };
  if (ctx.instagramUserId) storySpec.instagram_user_id = ctx.instagramUserId;

  let link: string | null = null;
  let ctaValue: Record<string, unknown> | null = null;
  switch (goal) {
    case 'LEADS_ON_META':
      link = 'https://fb.me/';
      ctaValue = { lead_gen_form_id: ctx.leadFormId };
      break;
    case 'MESSAGES':
      link = 'https://fb.com/messenger_doc/';
      ctaValue = { app_destination: ctx.messagingApp ?? 'MESSENGER' };
      break;
    case 'ENGAGEMENT':
      link = null;
      break;
    default:
      link = ctx.websiteUrl;
  }

  if (creative.kind === 'VIDEO') {
    const video: Record<string, unknown> = {
      video_id: creative.videoId,
      message: creative.primaryText,
      title: creative.headline,
      ...(creative.thumbnailUrl ? { image_url: creative.thumbnailUrl } : {}),
      ...(creative.imageHash && !creative.thumbnailUrl ? { image_hash: creative.imageHash } : {}),
    };
    if (creative.description) video.link_description = creative.description;
    if (link) video.call_to_action = { type: cta, value: { link, ...(ctaValue ?? {}) } };
    storySpec.video_data = video;
  } else if (goal === 'ENGAGEMENT') {
    storySpec.photo_data = { image_hash: creative.imageHash, caption: creative.primaryText };
  } else {
    const linkData: Record<string, unknown> = {
      image_hash: creative.imageHash,
      link,
      message: creative.primaryText,
      name: creative.headline,
      call_to_action: { type: cta, ...(ctaValue ? { value: ctaValue } : {}) },
    };
    if (creative.description) linkData.description = creative.description;
    storySpec.link_data = linkData;
  }
  return { name: `HOMATCH creative ${creative.id.slice(0, 8)}`, object_story_spec: storySpec };
}

export function adParams(name: string, adSetId: string, creativeId: string): Record<string, unknown> {
  return { name: name.slice(0, 200) || 'HOMATCH ad', adset_id: adSetId, creative: { creative_id: creativeId }, status: 'ACTIVE' };
}

/* ── STATUS ──────────────────────────────────────────────────────────── */

export type HomatchCampaignStatus =
  | 'SUBMITTED' | 'META_REVIEW' | 'ACTIVE' | 'PAUSED' | 'REJECTED' | 'COMPLETED' | 'ARCHIVED' | 'FAILED';

export interface StatusVerdict {
  status: HomatchCampaignStatus;
  /** Set when Meta reports a problem that is not a rejection (billing, limits). */
  issue: 'WITH_ISSUES' | 'PARTIALLY_REJECTED' | null;
}

/**
 * Meta's effective statuses → the one HOMATCH status the customer sees.
 * ACTIVE is only ever reported when META says a campaign and at least one of
 * its ads are delivering-eligible — never because our own write succeeded.
 */
export function mapMetaStatus(input: {
  campaign: string | null | undefined;
  ads: Array<string | null | undefined>;
  endTimePassed?: boolean;
}): StatusVerdict {
  const c = String(input.campaign ?? '').toUpperCase();
  const ads = input.ads.map((a) => String(a ?? '').toUpperCase()).filter(Boolean);
  const any = (s: string) => ads.includes(s);
  const rejected = ads.filter((a) => a === 'DISAPPROVED').length;

  if (c === 'DELETED' || c === 'ARCHIVED') return { status: 'ARCHIVED', issue: null };
  if (ads.length > 0 && rejected === ads.length) return { status: 'REJECTED', issue: null };
  if (input.endTimePassed && (c === 'ACTIVE' || c === 'COMPLETED' || c === 'PAUSED')) return { status: 'COMPLETED', issue: null };
  if (c === 'PAUSED' || c === 'CAMPAIGN_PAUSED') return { status: 'PAUSED', issue: null };
  /* Paused lower down (the ad set or every ad switched off in Ads Manager):
     the campaign object still reads ACTIVE, but nothing can deliver. An
     explicit pause wins over any review state. */
  const PAUSED_LIKE = ['PAUSED', 'ADSET_PAUSED', 'CAMPAIGN_PAUSED'];
  if (ads.length > 0 && ads.every((a) => PAUSED_LIKE.includes(a))) return { status: 'PAUSED', issue: null };
  if (c === 'WITH_ISSUES') return { status: any('ACTIVE') ? 'ACTIVE' : 'META_REVIEW', issue: 'WITH_ISSUES' };
  if (c === 'IN_PROCESS' || any('PENDING_REVIEW') || any('IN_PROCESS') || any('PREAPPROVED')) {
    return { status: any('ACTIVE') ? 'ACTIVE' : 'META_REVIEW', issue: rejected ? 'PARTIALLY_REJECTED' : null };
  }
  if (c === 'ACTIVE' && any('ACTIVE')) return { status: 'ACTIVE', issue: rejected ? 'PARTIALLY_REJECTED' : null };
  if (c === 'ACTIVE') return { status: 'META_REVIEW', issue: null };
  return { status: 'SUBMITTED', issue: null };
}

/* ── SETTLEMENT ──────────────────────────────────────────────────────── */

/**
 * Closing a finished campaign against the ledger: the reserve comes back, the
 * real spend goes out, and the fee on budget that was never spent is refunded.
 * Integer cents; spend is clamped to the reserve (Meta overdelivery beyond the
 * authorised budget is HOMATCH's cost, never the customer's).
 */
/**
 * Who pays Meta for the ads themselves.
 *
 *   CUSTOMER_AD_ACCOUNT  the campaign runs on the customer's own ad account
 *                        and Meta bills that account directly. HOMATCH holds
 *                        and charges ONLY its fee; reserving the ad budget as
 *                        well would charge the customer twice.
 *   HOMATCH_WALLET       the ad budget is held in the HOMATCH Meta Ads balance
 *                        (for campaigns run on an ad account HOMATCH pays).
 */
export type BudgetBilling = 'CUSTOMER_AD_ACCOUNT' | 'HOMATCH_WALLET';

export function parseBudgetBilling(value: unknown): BudgetBilling {
  return String(value ?? '').replace(/"/g, '') === 'HOMATCH_WALLET' ? 'HOMATCH_WALLET' : 'CUSTOMER_AD_ACCOUNT';
}

/** What HOMATCH itself takes from the balance at launch, per billing model. */
/**
 * WHEN THE CAMPAIGN ASKS META TO START.
 *
 * "Launch now" asks for now + one minute: Meta wants a start in the future,
 * and a minute is the smallest buffer that survives the request itself. It is
 * HOMATCH's REQUESTED start, not a delivery promise — Meta reviews first and
 * delivery begins when Meta says so; the status shown is always Meta's. A
 * customer's explicit later schedule (start_at) is kept exactly. `nowMs` is the
 * server's clock (never the browser's); the result is an absolute instant,
 * sent as UTC ISO-8601, so no timezone or calendar-day arithmetic is involved.
 */
export const LAUNCH_START_BUFFER_MS = 60_000;
export function launchStartTime(nowMs: number, scheduledAt?: string | null): Date {
  const soonest = nowMs + LAUNCH_START_BUFFER_MS;
  const chosen = scheduledAt ? Date.parse(scheduledAt) : Number.NaN;
  return new Date(Number.isFinite(chosen) && chosen > soonest ? chosen : soonest);
}

export function launchCharge(totals: { mediaCents: number; feeCents: number }, billing: BudgetBilling) {
  return billing === 'HOMATCH_WALLET'
    ? { reserveCents: totals.mediaCents, feeCents: totals.feeCents, requiredCents: totals.mediaCents + totals.feeCents }
    : { reserveCents: 0, feeCents: totals.feeCents, requiredCents: totals.feeCents };
}

/**
 * Settlement when Meta billed the customer's own ad account: nothing was
 * reserved, so only the fee is reconciled -- refunded in proportion to the
 * planned budget Meta did not spend.
 */
export function feeOnlySettlement(plannedMediaCents: number, feeCents: number, actualSpendCents: number) {
  const planned = Math.max(0, Math.round(plannedMediaCents));
  const spend = Math.max(0, Math.min(Math.round(actualSpendCents), planned));
  const feeRefund = planned > 0 ? Math.floor((feeCents * (planned - spend)) / planned) : 0;
  return { releaseCents: 0, spendCents: spend, feeRefundCents: feeRefund };
}

export function settlement(reservedMediaCents: number, feeCents: number, actualSpendCents: number) {
  const spend = Math.max(0, Math.min(Math.round(actualSpendCents), reservedMediaCents));
  const unspent = reservedMediaCents - spend;
  const feeRefund = reservedMediaCents > 0 ? Math.floor((feeCents * unspent) / reservedMediaCents) : 0;
  return { releaseCents: reservedMediaCents, spendCents: spend, feeRefundCents: feeRefund };
}
