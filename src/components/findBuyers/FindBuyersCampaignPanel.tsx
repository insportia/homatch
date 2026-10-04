// The running (or last) FIND BUYERS / FIND TENANTS search, as live
// intelligence on the HOMATCH navy frame: what is being searched, in which
// languages, how far it got, what it found. Stages are derived from facts the
// server recorded, never from a timer. Brands only — no provider internals,
// no costs. The 30-day rule is stated, with how much older content it skipped.

import React, { useEffect, useState } from 'react';
import {
  Activity, CalendarCheck2, Check, Copy, Globe2, Layers, Loader2, MessageCircle, MessagesSquare, PauseCircle, Radar, Scale, Trophy, Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { getCampaignState, type FindBuyersCampaignState } from '@/services/findBuyers';
import { GOLD_FILL, GOLD_TEXT, IconChip, NAVY_BAND, SourceBadge } from '@/components/findBuyers/brand';

const ALL_LANGS = ['ka', 'ru', 'en', 'ar', 'he', 'tr'];

function relativeTime(iso: string | null, lang: string): string | null {
  if (!iso) return null;
  const secs = Math.round((Date.parse(iso) - Date.now()) / 1000);
  if (!Number.isFinite(secs)) return null;
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  const abs = Math.abs(secs);
  if (abs < 60) return rtf.format(secs, 'second');
  if (abs < 3600) return rtf.format(Math.round(secs / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(secs / 3600), 'hour');
  return rtf.format(Math.round(secs / 86400), 'day');
}

export function FindBuyersCampaignPanel({
  jobId,
  running,
  paused,
  onProgress,
}: {
  jobId: string;
  running: boolean;
  paused: boolean;
  onProgress?: (qualified: number) => void;
}) {
  const { t, lang } = useLanguage();
  const [state, setState] = useState<FindBuyersCampaignState | null>(null);

  useEffect(() => {
    let alive = true;
    let last = -1;
    const load = () => getCampaignState(jobId).then((s) => {
      if (!alive) return;
      setState(s);
      const q = Number(s?.stats?.qualified ?? 0);
      if (q !== last) { last = q; onProgress?.(q); }
    }).catch(() => undefined);
    load();
    const timer = running && !paused ? window.setInterval(load, 8000) : null;
    return () => { alive = false; if (timer) window.clearInterval(timer); };
  }, [jobId, running, paused, onProgress]);

  if (!state) return null;
  const tenant = state.transaction === 'RENT';
  const st = (state.stats ?? {}) as FindBuyersCampaignState['stats'] & { commentsReviewed?: number; staleSkipped?: number };
  const explored = st.sourcesExplored ?? [];
  const productive = st.sourcesProductive ?? [];
  const searched = new Set(st.languagesSearched ?? []);
  const finished = Boolean(state.finalized_at) || !running;

  const steps: Array<{ key: string; done: boolean; icon: React.ComponentType<{ className?: string }> }> = [
    { key: 'fbx_stage_sources', done: explored.length > 0, icon: Radar },
    { key: 'fbx_stage_demand', done: Number(st.signalsAnalyzed ?? 0) > 0, icon: Activity },
    { key: 'fbx_stage_compare', done: Number(st.signalsAnalyzed ?? 0) > 0, icon: Scale },
    { key: 'fbx_stage_conversations', done: Number(st.commentsReviewed ?? 0) > 0 || Number(st.qualified ?? 0) > 0, icon: MessagesSquare },
    { key: 'fbx_stage_comments', done: Number(st.commentsReviewed ?? 0) > 0, icon: MessageCircle },
    { key: 'fbx_stage_dedupe', done: finished, icon: Layers },
    { key: tenant ? 'fbx_stage_rank_tenants' : 'fbx_stage_rank_buyers', done: finished, icon: Trophy },
  ];
  const current = steps.findIndex((s) => !s.done);
  const doneCount = steps.filter((s) => s.done).length;

  const title = finished ? t('fbx_finished') : paused ? t('fbx_paused') : t(tenant ? 'fbx_running_tenants' : 'fbx_running_buyers');

  return (
    <section className={cn('relative overflow-hidden rounded-2xl p-4 text-white shadow-[0_20px_44px_-24px_hsl(218_60%_8%/0.9)] ring-1 ring-inset ring-[hsl(40_80%_55%/0.35)]', NAVY_BAND)} aria-live="polite">
      <span className="pointer-events-none absolute -end-10 -top-10 h-32 w-32 rounded-full bg-[radial-gradient(circle,hsl(40_94%_60%/0.22),transparent_70%)]" aria-hidden="true" />

      <div className="flex items-center gap-2.5">
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', finished ? 'bg-white/10' : GOLD_FILL)}>
          {finished ? <Check className={cn('h-[18px] w-[18px]', GOLD_TEXT)} aria-hidden="true" />
            : paused ? <PauseCircle className="h-[18px] w-[18px] text-[hsl(218_52%_11%)]" aria-hidden="true" />
            : <Radar className="h-[18px] w-[18px] text-[hsl(218_52%_11%)] motion-safe:animate-pulse" aria-hidden="true" />}
        </span>
        <div className="min-w-0">
          <p className="font-display text-sm font-semibold leading-tight">{title}</p>
          <p className="mt-0.5 text-2xs text-[hsl(218_40%_80%)]">
            {t(tenant ? 'fbx_mode_rent' : 'fbx_mode_sale')} · <span dir="ltr" className={GOLD_TEXT}>{t('fbx_credits_value', { credits: String(state.credits_committed) })}</span>
          </p>
        </div>
      </div>

      {/* progress */}
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
        <div className={cn('h-full rounded-full transition-[width] duration-700', GOLD_FILL)} style={{ width: `${Math.round((doneCount / steps.length) * 100)}%` }} />
      </div>
      <ol className="mt-3 space-y-1.5">
        {steps.map((s, i) => {
          const active = i === current && !finished && !paused;
          return (
            <li key={s.key} className={cn('flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-2xs font-medium',
              active ? 'bg-white/10 text-white ring-1 ring-inset ring-[hsl(40_80%_60%/0.45)]' : s.done ? 'text-white' : 'text-[hsl(218_35%_72%)]')}>
              <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                s.done ? GOLD_FILL : active ? 'bg-white/15' : 'bg-white/5 ring-1 ring-inset ring-white/15')}>
                {s.done ? <Check className="h-3.5 w-3.5 text-[hsl(218_52%_11%)]" aria-hidden="true" />
                  : active ? <Loader2 className={cn('h-3.5 w-3.5 animate-spin', GOLD_TEXT)} aria-hidden="true" />
                  : <s.icon className="h-3.5 w-3.5" aria-hidden="true" />}
              </span>
              <span>{t(s.key)}</span>
            </li>
          );
        })}
      </ol>

      {/* languages */}
      <div className="mt-3.5 border-t border-white/10 pt-3">
        <p className="flex items-center gap-1.5 text-2xs font-semibold text-[hsl(218_40%_82%)]"><Globe2 className={cn('h-3.5 w-3.5', GOLD_TEXT)} aria-hidden="true" />{t('fbx_stat_languages')}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {ALL_LANGS.map((l) => (
            <span key={l} title={t(`fbx_lang_${l}`)}
              className={cn('rounded-lg px-2 py-1 text-2xs font-bold uppercase tracking-wide',
                searched.has(l) ? `${GOLD_FILL} text-[hsl(218_52%_11%)]` : 'bg-white/5 text-[hsl(218_35%_75%)] ring-1 ring-inset ring-white/15')}>
              {l}
            </span>
          ))}
        </div>
      </div>

      {/* sources */}
      <div className="mt-3">
        <p className="text-2xs font-semibold text-[hsl(218_40%_82%)]">{t('fbx_stat_sources')}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {explored.length ? explored.map((s) => <SourceBadge key={s} source={s} onDark className={productive.includes(s) ? 'ring-[hsl(40_94%_60%/0.8)]' : ''} />)
            : <span className="text-2xs text-[hsl(218_35%_75%)]">—</span>}
        </div>
      </div>

      {/* numbers */}
      <dl className="mt-3.5 grid grid-cols-2 gap-2">
        <Tile icon={Activity} label={t('fbx_stat_signals')} value={String(st.signalsAnalyzed ?? 0)} />
        <Tile icon={Users} label={t(tenant ? 'fbx_stat_qualified_tenants' : 'fbx_stat_qualified_buyers')} value={String(st.qualified ?? 0)} strong />
        <Tile icon={Copy} label={t('fbx_stat_duplicates')} value={String(st.duplicatesRemoved ?? 0)} />
        <Tile icon={Radar} label={t('fbx_stat_productive')} value={String(productive.length)} />
      </dl>

      {/* the 30-day rule, stated */}
      <p className="mt-3 flex items-start gap-2 rounded-xl bg-white/5 p-2.5 text-2xs leading-snug text-[hsl(218_40%_85%)] ring-1 ring-inset ring-white/10">
        <CalendarCheck2 className={cn('mt-px h-4 w-4 shrink-0', GOLD_TEXT)} aria-hidden="true" />
        <span>
          {t('fbx_fresh_rule')}
          {Number(st.staleSkipped ?? 0) > 0 ? <> {t('fbx_fresh_skipped', { count: String(st.staleSkipped) })}</> : null}
        </span>
      </p>
      <p className="mt-2 text-end text-2xs text-[hsl(218_35%_75%)]">{t('fbx_stat_last_activity')}: {relativeTime(state.last_activity_at, lang) ?? '—'}</p>
    </section>
  );
}

function Tile({ icon, label, value, strong }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2 rounded-xl p-2.5 ring-1 ring-inset',
      strong ? 'bg-[hsl(40_94%_60%/0.12)] ring-[hsl(40_80%_60%/0.5)]' : 'bg-white/5 ring-white/10')}>
      <IconChip icon={icon} tone="onDark" className="h-7 w-7 rounded-lg" />
      <div className="min-w-0">
        <dt className="truncate text-2xs text-[hsl(218_40%_82%)]">{label}</dt>
        <dd className={cn('font-display font-bold tabular-nums', strong ? `text-lg ${GOLD_TEXT}` : 'text-sm text-white')}>{value}</dd>
      </div>
    </div>
  );
}

export default FindBuyersCampaignPanel;
