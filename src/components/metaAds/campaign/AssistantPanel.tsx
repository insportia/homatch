// HOMATCH NOW — the campaign assistant, answering four questions from what
// the backend holds: what HOMATCH is watching, what it found, what it is
// doing, and what the customer should do next. Three layers stay visibly
// apart: META DATA (Meta's status and results), HOMATCH INTELLIGENCE
// (analysis and recommendations) and HOMATCH ACTION (monitoring; Campaign
// Guard is the only automatic actor). No autonomy is claimed that the code
// does not have — see src/lib/metaAds/assistant.ts.
import React from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import type { CampaignDetail } from '@/services/metaAds';
import { assistantAnswers, lastExternalChange } from '@/lib/metaAds/assistant';
import { LiveDot } from './LiveStatusCard';
import type { Fmt, T } from './shared';

const OUTSIDE_FOUND = ['mm_as_found_paused_outside', 'mm_as_found_resumed_outside', 'mm_as_found_status_changed', 'mm_as_found_changed_outside'];

export function AssistantPanel({ t, fmt, d, onOpenTab }: { t: T; fmt: Fmt; d: CampaignDetail; onOpenTab: (tab: 'optimization' | 'integrity' | 'overview') => void }) {
  const c = d.campaign;
  const life = d.analysis?.lifetime ?? null;
  const openRecs = d.recommendations.filter((r) => r.status === 'OPEN');
  const openEvents = d.events.filter((e) => e.state === 'OPEN' && e.action_required).length;
  const guardOpen = d.guard.incidents.filter((i) => i.status === 'ACTIVE' && i.level !== 'NOTICE').length;
  const lastExternal = lastExternalChange(d.events, Date.now());
  const a = assistantAnswers({
    status: c.status,
    hasDelivery: !!life && (life.impressions > 0 || life.spendMinor > 0),
    openRecommendations: openRecs.length,
    actionableRecommendations: openRecs.filter((r) => r.actionable).length,
    needsAttention: Math.max(openEvents, guardOpen),
    lastExternal,
    lastSyncedAt: c.last_synced_at ?? null,
  });

  const rows: Array<[string, string, string, string | null]> = [
    ['watching', t('mm_as_q_watching'), t(a.watching), null],
    ['found', t('mm_as_q_found'), t(a.found, a.foundVars), lastExternal && OUTSIDE_FOUND.includes(a.found) ? fmt.dateTime(lastExternal.at) : null],
    ['doing', t('mm_as_q_doing'), t(a.doing), null],
    ['next', t('mm_as_q_next'), t(a.next), null],
  ];

  return (
    <section data-mm-assistant={a.phase} aria-labelledby="mm-as-title"
      className="overflow-hidden rounded-2xl border border-[hsl(var(--gold-border))] bg-card shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 id="mm-as-title" className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Sparkles className="h-4 w-4 text-[hsl(var(--gold-ink))]" aria-hidden="true" />{t('mm_as_title')}
        </h2>
        {a.watched && (
          <p className="flex items-center gap-2 text-2xs font-medium text-muted-foreground" data-mm-assistant-watching="">
            <LiveDot status={c.status} />
            {t('mm_as_monitoring')}
            {c.last_synced_at && <span className="tabular-nums" title={fmt.dateTime(c.last_synced_at)}>· {t('mm_as_checked', { when: fmt.rel(c.last_synced_at) ?? '—' })}</span>}
          </p>
        )}
      </div>
      <div className="px-4 py-3">
        <p className="text-[15px] font-semibold leading-snug text-foreground">{t('mm_as_hero')}</p>
        <dl className="mt-3 grid gap-2.5 sm:grid-cols-2">
          {rows.map(([k, q, answer, when]) => (
            <div key={k} className="min-w-0 rounded-xl bg-[hsl(var(--secondary))]/40 px-3 py-2.5" data-mm-assistant-row={k}>
              <dt className="text-2xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">{q}</dt>
              <dd className="mt-1 text-[13px] leading-relaxed text-foreground">
                {answer}{when ? <span className="ms-1 text-muted-foreground tabular-nums">({when})</span> : null}
              </dd>
            </div>
          ))}
        </dl>
        {a.nextTab && (
          <button type="button" onClick={() => onOpenTab(a.nextTab!)}
            className="mt-3 inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-[hsl(38_92%_54%)] px-3.5 text-2xs font-bold text-[#161309] hover:bg-[hsl(38_92%_60%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))]">
            {t(a.nextTab === 'optimization' ? 'mm_as_open_recs' : 'mm_as_open_integrity')}<ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden="true" />
          </button>
        )}
        <p className="mt-3 border-t border-border pt-2.5 text-2xs leading-relaxed text-muted-foreground" data-mm-assistant-control="">{t('mm_as_control')}</p>
      </div>
    </section>
  );
}
