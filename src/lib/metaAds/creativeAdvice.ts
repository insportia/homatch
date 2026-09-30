// META ADS — WHAT HOMATCH SAYS ABOUT THE CREATIVES. Four severities, and only
// one of them stops a launch:
//
//   INFO             neutral fact ("HOMATCH will run your strongest 2")
//   RECOMMENDATION   amber: you can continue; this would help
//   WARNING          amber: you can continue; something could not be checked
//                    or will look worse on some placements
//   BLOCKING_ERROR   red: Meta would refuse it, or it cannot run at all
//
// Every item is a code plus parameters; the builder turns codes into words in
// the customer's language. Pure — the same function runs in the browser (live
// advice while uploading) and in preflight (the launch gate).

import { checkMedia, PLACEMENTS, type MediaFacts, type Placement } from './payload.ts';
import type { MetaGoal } from './strategy.ts';

export type AdviceSeverity = 'INFO' | 'RECOMMENDATION' | 'WARNING' | 'BLOCKING_ERROR';

export interface AdviceItem {
  severity: AdviceSeverity;
  code: string;
  /** The creative it is about; absent for campaign-wide advice. */
  creativeId?: string;
  params?: Record<string, string | number>;
}

export interface CreativeForAdvice {
  id: string;
  media: Array<{ mime?: string; size?: number; width?: number | null; height?: number | null; duration?: number | null }>;
  headline?: string | null;
  primaryText?: string | null;
}

const LEAD_OR_TRAFFIC: MetaGoal[] = ['LEADS_ON_META', 'LEADS_ON_WEBSITE', 'SITE_REGISTRATIONS', 'PROMOTE'];

/** 0..1 — used by the strategy to put the strongest creatives first. */
export function creativeQuality(c: CreativeForAdvice): number {
  const m = c.media?.[0];
  if (!m) return 0;
  const facts: MediaFacts = { mime: String(m.mime ?? ''), sizeBytes: Number(m.size ?? 0), width: m.width, height: m.height, durationSeconds: m.duration };
  const check = checkMedia(facts, PLACEMENTS);
  if (check.verdict === 'INCOMPATIBLE') return 0;
  let q = 0.6;
  const short = Math.min(Number(m.width ?? 0), Number(m.height ?? 0));
  if (short >= 1080) q += 0.2; else if (short >= 600) q += 0.1;
  const ready = Object.values(check.placements).filter((v) => v === 'READY').length;
  q += Math.min(0.15, ready * 0.03);
  if (String(c.headline ?? '').trim() && String(c.primaryText ?? '').trim()) q += 0.05;
  return Math.min(1, Math.round(q * 100) / 100);
}

export function creativeAdvice(
  creatives: CreativeForAdvice[],
  ctx: { goal: MetaGoal; placements?: readonly Placement[]; recommendedCreativeCount?: number | null },
): AdviceItem[] {
  const out: AdviceItem[] = [];
  const placements = ctx.placements && ctx.placements.length ? ctx.placements : PLACEMENTS;
  if (creatives.length === 0) {
    out.push({ severity: 'BLOCKING_ERROR', code: 'CREATIVE_REQUIRED' });
    return out;
  }
  let vertical = 0;
  for (const c of creatives) {
    if (!c.media || c.media.length === 0) {
      out.push({ severity: 'BLOCKING_ERROR', code: 'MEDIA_REQUIRED', creativeId: c.id });
      continue;
    }
    if (ctx.goal !== 'ENGAGEMENT' && !String(c.primaryText ?? '').trim()) {
      out.push({ severity: 'BLOCKING_ERROR', code: 'PRIMARY_TEXT_REQUIRED', creativeId: c.id });
    }
    if (LEAD_OR_TRAFFIC.includes(ctx.goal) && !String(c.headline ?? '').trim()) {
      out.push({ severity: 'BLOCKING_ERROR', code: 'HEADLINE_REQUIRED', creativeId: c.id });
    }
    if (String(c.headline ?? '').length > 255 || String(c.primaryText ?? '').length > 2200) {
      out.push({ severity: 'BLOCKING_ERROR', code: 'TEXT_TOO_LONG', creativeId: c.id });
    }
    // EVERY media item, not only the first.
    c.media.forEach((m, index) => {
      const check = checkMedia({ mime: String(m.mime ?? ''), sizeBytes: Number(m.size ?? 0), width: m.width, height: m.height, durationSeconds: m.duration }, placements);
      const params = { index: index + 1 };
      for (const reason of check.reasons) {
        const severity: AdviceSeverity =
          ['media_format_unsupported', 'media_too_large', 'media_resolution_too_low', 'media_video_too_short', 'media_video_too_long', 'media_no_compatible_placement'].includes(reason)
            ? 'BLOCKING_ERROR'
            : reason === 'media_dimensions_unknown' ? 'WARNING' : 'RECOMMENDATION';
        out.push({ severity, code: reason.toUpperCase(), creativeId: c.id, params });
      }
      const w = Number(m.width ?? 0);
      const h = Number(m.height ?? 0);
      if (w > 0 && h > 0 && h / w >= 1.5) vertical += 1;
    });
  }
  const wantsVertical = placements.some((p) => p.includes('stories') || p.includes('reels'));
  if (wantsVertical && vertical === 0 && creatives.some((c) => c.media?.length)) {
    out.push({ severity: 'RECOMMENDATION', code: 'ADD_VERTICAL_VERSION' });
  }
  const rec = Number(ctx.recommendedCreativeCount ?? 0);
  if (rec > 0) {
    const usable = creatives.filter((c) => c.media?.length).length;
    if (usable < rec) {
      out.push({ severity: 'RECOMMENDATION', code: 'ADD_CREATIVE_VARIATION', params: { have: usable, recommended: rec } });
    } else if (usable > rec) {
      out.push({ severity: 'INFO', code: 'STRONGEST_CREATIVES_RUN_FIRST', params: { have: usable, running: rec } });
    }
  }
  return out;
}

export const blocksLaunch = (items: AdviceItem[]) => items.some((i) => i.severity === 'BLOCKING_ERROR');
