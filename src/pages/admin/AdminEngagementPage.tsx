import React, { useEffect, useState } from 'react';
import { Loader2, Smartphone, Bell, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';

/**
 * THE INSTALL AND NOTIFICATION FUNNEL.
 *
 * WHY EVERY NUMBER CARRIES ITS CONFIDENCE
 *
 * The browser does not tell a web page that an install succeeded. Chromium
 * fires `appinstalled` and returns a userChoice; iOS fires nothing at all,
 * because installing there happens inside the Share menu. So a dashboard that
 * prints "1,400 installs" is printing a number no browser ever produced.
 *
 * Every row here is grouped by how it is known:
 *
 *   CONFIRMED  the browser said so
 *   DETECTED   measured in the moment (this session IS standalone)
 *   INFERRED   deduced (a first standalone launch implies an earlier install)
 *
 * A funnel that cannot say which of those it is looking at will be believed
 * anyway, which is the problem.
 *
 * WHAT IS DELIBERATELY ABSENT
 *
 * No install rate, no conversion percentage across the whole funnel, and no
 * iOS install count. The first two would divide numbers measured three
 * different ways; the third does not exist. The counts are shown and the
 * arithmetic is left to somebody who can see the confidence column.
 */

interface Row { event: string; confidence: string; n: number }

const ORDER = [
  'PWA_AFFORDANCE_VIEWED',
  'PWA_NATIVE_PROMPT_AVAILABLE',
  'PWA_INSTALL_CLICKED',
  'PWA_NATIVE_PROMPT_SHOWN',
  'PWA_NATIVE_PROMPT_ACCEPTED',
  'PWA_NATIVE_PROMPT_DISMISSED',
  'PWA_IOS_INSTRUCTIONS_SHOWN',
  'PWA_STANDALONE_DETECTED',
  'PWA_FIRST_STANDALONE_LAUNCH',
  'PWA_RETURNING_STANDALONE_SESSION',
];

const PUSH_ORDER = [
  'PUSH_PERMISSION_REQUESTED',
  'PUSH_PERMISSION_GRANTED',
  'PUSH_PERMISSION_DENIED',
  'PUSH_PERMISSION_DISMISSED',
  'PUSH_SUBSCRIPTION_CREATED',
  'PUSH_SUBSCRIPTION_INVALIDATED',
];

export default function AdminEngagementPage() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [subs, setSubs] = useState<{ live: number; revoked: number; failing: number } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      /* Read the raw events and fold them here. A view would be tidier and
         would also be a second place for the definition of the funnel to
         drift from this page. */
      const { data, error } = await supabase
        .from('pwa_events')
        .select('event, confidence')
        .gte('created_at', new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString())
        .limit(50000);
      if (error) { setFailed(error.message); setRows([]); return; }

      const counts = new Map<string, Row>();
      for (const e of data ?? []) {
        const key = `${e.event}|${e.confidence}`;
        const row = counts.get(key) ?? { event: e.event, confidence: e.confidence, n: 0 };
        row.n += 1;
        counts.set(key, row);
      }
      setRows([...counts.values()]);

      const { data: subRows } = await supabase
        .from('push_subscriptions')
        .select('enabled, revoked_at, failure_count')
        .limit(50000);
      setSubs({
        live: (subRows ?? []).filter((s) => s.enabled && !s.revoked_at).length,
        revoked: (subRows ?? []).filter((s) => s.revoked_at).length,
        failing: (subRows ?? []).filter((s) => (s.failure_count ?? 0) > 0 && !s.revoked_at).length,
      });
    })();
  }, []);

  const find = (event: string) => (rows ?? []).filter((r) => r.event === event);

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h1 className="text-xl font-bold">{t('admin_nav_engagement')}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{t('admin_engagement_intro')}</p>
      </div>

      {failed && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {failed}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Smartphone className="h-4 w-4" /> {t('admin_engagement_install')}
          </CardTitle>
          <CardDescription>{t('admin_engagement_confidence')}</CardDescription>
        </CardHeader>
        <CardContent>
          {rows === null ? <Loader2 className="h-4 w-4 animate-spin" /> : (
            <Funnel order={ORDER} find={find} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4" /> {t('admin_engagement_push')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {rows === null ? <Loader2 className="h-4 w-4 animate-spin" /> : (
            <Funnel order={PUSH_ORDER} find={find} />
          )}
          {subs && (
            <dl className="grid grid-cols-3 gap-3 border-t border-border pt-4 text-sm">
              <Stat label={t('admin_engagement_subs_live')} value={subs.live} />
              <Stat label={t('admin_engagement_subs_revoked')} value={subs.revoked} />
              <Stat label={t('admin_engagement_subs_failing')} value={subs.failing} />
            </dl>
          )}
        </CardContent>
      </Card>

      <p className="flex items-start gap-2 text-[13px] leading-relaxed text-muted-foreground">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{t('admin_engagement_ios_note')}</span>
      </p>
    </div>
  );
}

function Funnel({ order, find }: { order: string[]; find: (e: string) => Row[] }) {
  return (
    <ul className="space-y-2">
      {order.map((event) => {
        const parts = find(event);
        const total = parts.reduce((sum, r) => sum + r.n, 0);
        return (
          <li key={event} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-2 last:border-0">
            <span className="min-w-0 font-mono text-[13px] text-muted-foreground">{event}</span>
            <span className="flex items-baseline gap-3">
              {parts.map((p) => (
                <span key={p.confidence} className="text-[13px] text-muted-foreground">
                  {p.confidence} {p.n}
                </span>
              ))}
              <span className="text-base font-semibold tabular-nums text-foreground">{total}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}
