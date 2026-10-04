// The running (or last) FIND BUYERS / FIND TENANTS search, as live
// intelligence: what is being searched, in which languages, how far it got,
// what it found. Stages are derived from facts the server recorded (sources
// explored, signals analysed, comments reviewed, duplicates folded), never
// from a timer. Brands and categories only — no provider internals, no costs.

import React, { useEffect, useState } from 'react';
import { Check, Circle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { getCampaignState, type FindBuyersCampaignState } from '@/services/findBuyers';

const SOURCE_LABEL: Record<string, string> = {
  FACEBOOK: 'Facebook', INSTAGRAM: 'Instagram', TIKTOK: 'TikTok', VK: 'VK', TELEGRAM: 'Telegram', LINKEDIN: 'LinkedIn', FORUM: 'Forum',
};
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
  /** Called when the qualified count grows, so the results list refreshes. */
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
  const st = state.stats ?? {};
  const explored = (st.sourcesExplored ?? []).map((s) => SOURCE_LABEL[s] ?? s);
  const productive = (st.sourcesProductive ?? []).map((s) => SOURCE_LABEL[s] ?? s);
  const searched = new Set(st.languagesSearched ?? []);
  const finished = Boolean(state.finalized_at) || !running;

  const steps: Array<{ key: string; done: boolean }> = [
    { key: 'fbx_stage_sources', done: explored.length > 0 },
    { key: 'fbx_stage_demand', done: Number(st.signalsAnalyzed ?? 0) > 0 },
    { key: 'fbx_stage_compare', done: Number(st.signalsAnalyzed ?? 0) > 0 },
    { key: 'fbx_stage_conversations', done: Number((st as any).commentsReviewed ?? 0) > 0 || Number(st.qualified ?? 0) > 0 },
    { key: 'fbx_stage_comments', done: Number((st as any).commentsReviewed ?? 0) > 0 },
    { key: 'fbx_stage_dedupe', done: finished },
    { key: tenant ? 'fbx_stage_rank_tenants' : 'fbx_stage_rank_buyers', done: finished },
  ];
  const current = steps.findIndex((s) => !s.done);

  const title = finished
    ? t('fbx_finished')
    : paused ? t('fbx_paused') : t(tenant ? 'fbx_running_tenants' : 'fbx_running_buyers');

  return (
    <section className="hm-discovery-panel p-3.5" aria-live="polite">
      <div className="flex items-center gap-2">
        {!finished && !paused ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[hsl(var(--primary))]" aria-hidden="true" /> : null}
        <p className="font-display text-sm font-semibold text-foreground">{title}</p>
      </div>
      <p className="mt-0.5 text-2xs text-muted-foreground">
        {t(tenant ? 'fbx_mode_rent' : 'fbx_mode_sale')} · <span dir="ltr">{t('fbx_credits_value', { credits: String(state.credits_committed) })}</span>
      </p>

      <ol className="mt-3 space-y-1.5">
        {steps.map((s, i) => (
          <li key={s.key} className={cn('flex items-center gap-2 text-2xs', s.done ? 'text-foreground' : i === current && !finished ? 'text-foreground' : 'text-muted-foreground/70')}>
            {s.done ? <Check className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--primary))]" aria-hidden="true" />
              : i === current && !finished && !paused ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
              : <Circle className="h-3 w-3 shrink-0" aria-hidden="true" />}
            <span>{t(s.key)}</span>
          </li>
        ))}
      </ol>

      <dl className="mt-3.5 grid grid-cols-2 gap-x-3 gap-y-2.5 border-t border-border/50 pt-3">
        <div className="col-span-2">
          <dt className="text-2xs text-muted-foreground">{t('fbx_stat_languages')}</dt>
          <dd className="mt-1 flex flex-wrap gap-1">
            {ALL_LANGS.map((l) => (
              <span key={l} className={cn('rounded-md border px-1.5 py-0.5 text-2xs font-semibold uppercase', searched.has(l) ? 'border-[hsl(var(--primary))]/50 text-foreground' : 'border-border text-muted-foreground/70')} title={t(`fbx_lang_${l}`)}>
                {l}
              </span>
            ))}
          </dd>
        </div>
        <Item label={t('fbx_stat_sources')} value={explored.length ? explored.join(', ') : '—'} />
        <Item label={t('fbx_stat_productive')} value={productive.length ? productive.join(', ') : '—'} />
        <Item label={t('fbx_stat_signals')} value={String(st.signalsAnalyzed ?? 0)} />
        <Item label={t(tenant ? 'fbx_stat_qualified_tenants' : 'fbx_stat_qualified_buyers')} value={String(st.qualified ?? 0)} strong />
        <Item label={t('fbx_stat_duplicates')} value={String(st.duplicatesRemoved ?? 0)} />
        <Item label={t('fbx_stat_last_activity')} value={relativeTime(state.last_activity_at, lang) ?? '—'} />
      </dl>
    </section>
  );
}

function Item({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-2xs text-muted-foreground">{label}</dt>
      <dd className={cn('mt-0.5 break-words text-xs text-foreground', strong ? 'font-display text-base font-semibold' : 'font-semibold')}>{value}</dd>
    </div>
  );
}

export default FindBuyersCampaignPanel;
