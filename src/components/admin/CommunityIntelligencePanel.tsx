// HOMATCH ADMIN — WHAT THE GLOBAL INTELLIGENCE STORE HOLDS, OVER TIME.
//
// timeBounds() shipped with nine windows and no consumer, so LAST HOUR and THIS
// MONTH were types nobody could see the answer to. This is the screen.
//
// THE ONE CONTROL THAT IS NOT A PREFERENCE
//
// The clock. "Buyers who POSTED today" and "buyers we FOUND today" are different
// questions with different answers, and a report that quietly picks one is a report
// that can be read wrong with total confidence. So the choice is visible, it is
// labelled in plain words rather than by column name, and switching it is the
// fastest way to learn something real:
//
//   a full FOUND bar beside an empty POSTED one means we swept a channel today and
//   everything on it is old
//
//   a full POSTED bar beside an empty FOUND one cannot happen, and if it ever does
//   the discovery timestamps are wrong
//
// published_at is also NULLABLE — a source that stated no date has none — so the
// POSTED view legitimately holds fewer rows than the FOUND view. That is said on
// the screen, because otherwise it reads as data loss.
//
// AN EMPTY PERIOD IS DRAWN
//
// Not skipped. A week with two quiet days must not look like a week that was never
// collected, so every bucket in the window is rendered and the quiet ones are
// visible as gaps at the baseline. How many held nothing is stated as a number,
// because on a store this young that IS the finding.
//
// NO GLOBAL DESIGN CHANGES. Card, Badge, Button and the existing muted/emerald/
// amber vocabulary, exactly as the Social Discovery page beside it uses them. The
// bar row scrolls inside its own overflow-x container so 720 hourly buckets cannot
// widen the page at 320px.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Clock, Loader2, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import {
  getCommunityIntelligence,
  type IntelligenceClock,
  type IntelligenceSeries,
  type IntelligenceWindow,
} from '@/services/social';

const WINDOWS: readonly { id: IntelligenceWindow; key: string }[] = [
  { id: 'LAST_HOUR', key: 'intel_win_last_hour' },
  { id: 'TODAY', key: 'intel_win_today' },
  { id: 'YESTERDAY', key: 'intel_win_yesterday' },
  { id: 'LAST_24H', key: 'intel_win_last_24h' },
  { id: 'THIS_WEEK', key: 'intel_win_this_week' },
  { id: 'LAST_7D', key: 'intel_win_last_7d' },
  { id: 'THIS_MONTH', key: 'intel_win_this_month' },
  { id: 'LAST_30D', key: 'intel_win_last_30d' },
];

const CLOCKS: readonly { id: IntelligenceClock; key: string }[] = [
  { id: 'discovered_at', key: 'intel_clock_discovered' },
  { id: 'published_at', key: 'intel_clock_published' },
  { id: 'last_verified_at', key: 'intel_clock_verified' },
];

/** A short axis label for a bucket, in the operator's own locale. */
function bucketLabel(iso: string, bucket: string, locale: string): string {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return '';
  try {
    if (bucket === 'HOUR') {
      return at.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    }
    if (bucket === 'MONTH') {
      return at.toLocaleDateString(locale, { month: 'short', year: '2-digit' });
    }
    return at.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  } catch {
    /* An unexpected locale tag must not take the panel down with it. */
    return iso.slice(0, 10);
  }
}

export function CommunityIntelligencePanel(): React.ReactElement {
  const { t, lang } = useLanguage();
  /* `range`, not `window`: a state variable called window shadows the global one
     for the whole component, and the next person to reach for window.matchMedia or
     window.location here would get a string. */
  const [range, setRange] = useState<IntelligenceWindow>('LAST_7D');
  const [clock, setClock] = useState<IntelligenceClock>('discovered_at');
  const [data, setData] = useState<IntelligenceSeries | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getCommunityIntelligence({ window: range, column: clock }));
    } catch (cause) {
      /*
       * The server's own words. It answers 400 with the reason -- an unknown
       * platform, a window that would produce more points than a chart can carry --
       * and replacing that with "could not load" would throw away the only thing
       * that says which input to change.
       */
      setError(cause instanceof Error ? cause.message : String(cause));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [range, clock]);

  useEffect(() => { void load(); }, [load]);

  /* The tallest bar decides the scale. Zero when the window is empty, and the
     guard keeps a division by zero out of a style attribute. */
  const peak = useMemo(
    () => (data?.series ?? []).reduce((max, point) => Math.max(max, point.evidence), 0),
    [data],
  );

  const emptyPeriods = data ? data.buckets - data.bucketsWithEvidence : 0;

  return (
    <Card>
      <CardContent className="space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h2 className="text-sm font-semibold sm:text-base" dir="auto">{t('intel_title')}</h2>
            <p className="text-xs text-muted-foreground" dir="auto">{t('intel_clock_note')}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading
              ? <Loader2 className="me-2 h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="me-2 h-3.5 w-3.5" />}
            {t('intel_refresh')}
          </Button>
        </div>

        {/* Both selector rails scroll rather than wrap into a wall of buttons, and
            shrink-0 on the children is what stops a long Georgian label being
            squeezed to nothing instead of scrolling. */}
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {WINDOWS.map((entry) => (
            <Button
              key={entry.id}
              size="sm"
              variant={range === entry.id ? 'default' : 'outline'}
              className="shrink-0"
              onClick={() => setRange(entry.id)}
            >
              <span dir="auto">{t(entry.key)}</span>
            </Button>
          ))}
        </div>

        <div className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-1">
          <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {CLOCKS.map((entry) => (
            <Button
              key={entry.id}
              size="sm"
              variant={clock === entry.id ? 'secondary' : 'ghost'}
              className="shrink-0"
              onClick={() => setClock(entry.id)}
            >
              <span dir="auto">{t(entry.key)}</span>
            </Button>
          ))}
        </div>

        {error && (
          <p className="flex items-start gap-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span dir="auto">{error}</span>
          </p>
        )}

        {loading && !data && <Skeleton className="h-40 w-full" />}

        {data && (
          <>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {([
                ['intel_total_evidence', data.totals.evidence, ''],
                ['intel_total_demand', data.totals.demand, 'text-sky-600'],
                ['intel_total_supply', data.totals.supply, 'text-emerald-600'],
                ['intel_total_unknown', data.totals.unknown, 'text-muted-foreground'],
                ['intel_total_unavailable', data.totals.unavailable, 'text-amber-600'],
              ] as const).map(([key, value, accent]) => (
                <div key={key} className="min-w-0 rounded-md bg-muted/40 px-3 py-2">
                  <dt className="truncate text-xs text-muted-foreground" dir="auto">{t(key)}</dt>
                  <dd className={cn('font-semibold tabular-nums', accent)}>{value}</dd>
                </div>
              ))}
            </dl>

            {/*
              * THE SERIES. Every bucket in the window, including the empty ones —
              * a quiet day and an uncollected day must not look alike.
              *
              * Scrolls inside itself: thirty days by hour is 720 bars, and the page
              * body must never scroll horizontally at 320px.
              */}
            <div className="overflow-x-auto">
              <div className="flex h-40 min-w-full items-end gap-px">
                {data.series.map((point) => {
                  const height = peak > 0 ? Math.round((point.evidence / peak) * 100) : 0;
                  return (
                    <div
                      key={point.bucketStart}
                      className="flex h-full min-w-[6px] flex-1 flex-col justify-end"
                      title={`${bucketLabel(point.bucketStart, data.bucket, lang)} · ${point.evidence}`}
                    >
                      {/* A one-pixel floor on an empty bucket, so the baseline is
                          visibly continuous and a gap reads as "nothing here"
                          rather than as the chart ending. */}
                      <div
                        className={cn(
                          'w-full rounded-t-sm',
                          point.evidence === 0 ? 'bg-border' : 'bg-primary/70',
                        )}
                        style={{ height: point.evidence === 0 ? 1 : `${Math.max(2, height)}%` }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span dir="auto">
                {bucketLabel(data.bounds.from, data.bucket, lang)}
                {' — '}
                {bucketLabel(data.bounds.to, data.bucket, lang)}
              </span>
              <Badge variant="outline" className="shrink-0 font-normal">
                {t(CLOCKS.find((c) => c.id === data.bounds.column)?.key ?? 'intel_clock_discovered')}
              </Badge>
            </div>

            {/*
              * WHAT IS NOT THERE, said as a number.
              *
              * On a store this young the emptiness is the finding, and leaving it to
              * be counted off the bars means nobody counts it.
              */}
            {data.totals.evidence === 0 ? (
              <p className="text-xs text-muted-foreground" dir="auto">{t('intel_nothing_stored')}</p>
            ) : emptyPeriods > 0 && (
              <p className="text-xs text-muted-foreground" dir="auto">
                {t('intel_empty_periods', { empty: emptyPeriods, total: data.buckets })}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default CommunityIntelligencePanel;
