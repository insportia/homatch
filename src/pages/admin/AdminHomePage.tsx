// HOMATCH Admin — the front door.
//
// WHAT THIS REPLACED
//
// /admin used to be a grid of counters: users, properties, campaigns, raw
// signals, qualified signals, matches, unlocks, revenue, margin. All true,
// none of it a question an owner opens the Admin to answer. Those counts
// are still a page — /admin/metrics — because somebody does want them,
// just not first.
//
// WHAT IT ANSWERS INSTEAD
//
// Is Homatch working. Is anything broken. Is there something I have to do.
//
// EVERY STATUS HERE IS READ, NEVER ASSUMED
//
// The rows come from comm-provider-status, which probes the providers and
// reports health plus a sentence naming what is wrong, and from the spend
// cap reader. Nothing is defaulted to green. When a source cannot be read
// the row says Unknown and says so is not a claim that anything is broken
// — because turning "I could not check" into "Working" is the one failure
// an operations screen must never have.

import {AlertTriangle, ArrowRight, 
  CheckCircle2, HelpCircle, Loader2,MinusCircle, XCircle, 
} from 'lucide-react';
import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';
import { cn } from '@/lib/utils';
import { getSpendCapStatus } from '@/services/api';
import { readProviderStatus } from '@/services/communications';
import type { ChannelReadinessRow, ProviderReportRow } from '@/types/communications';
import type { SpendCapStatus } from '@/types/types';

/**
 * The five states a row can be in.
 *
 * UNKNOWN is a first-class member and not a synonym for a problem: it
 * means the probe itself did not answer, which is a different fact from
 * the thing being broken, and conflating them sends somebody to fix a
 * provider that is fine.
 */
type State = 'OK' | 'ACTION' | 'OFF' | 'PROBLEM' | 'UNKNOWN';

const STATE_LABEL: Record<State, TranslationKey> = {
  OK: 'admin_status_working',
  ACTION: 'admin_status_action',
  OFF: 'admin_status_off',
  PROBLEM: 'admin_status_problem',
  UNKNOWN: 'admin_status_unknown',
};

const STATE_ICON: Record<State, typeof CheckCircle2> = {
  OK: CheckCircle2,
  ACTION: AlertTriangle,
  OFF: MinusCircle,
  PROBLEM: XCircle,
  UNKNOWN: HelpCircle,
};

const STATE_TONE: Record<State, string> = {
  OK: 'text-[#12A06B]',
  ACTION: 'text-[hsl(var(--warning))]',
  OFF: 'text-muted-foreground',
  PROBLEM: 'text-destructive',
  UNKNOWN: 'text-muted-foreground',
};

function stateOfProvider(report: ProviderReportRow | undefined): State {
  if (!report) return 'UNKNOWN';
  switch (report.health) {
    case 'HEALTHY': return 'OK';
    case 'DISABLED': return 'OFF';
    case 'NOT_CONFIGURED': return 'ACTION';
    case 'DOWN': return 'PROBLEM';
    case 'DEGRADED': return 'ACTION';
    default: return 'UNKNOWN';
  }
}

/*
 * `detailDir` is 'ltr' when the sentence is the PROVIDER's rather than
 * ours. The provider writes in English and names environment variables
 * inside the sentence, and on an RTL page the bidi algorithm takes that
 * sentence's full stop for the surrounding paragraph's own and throws it
 * to the far end — ".never reach the inbox". Marking the run as LTR is
 * what keeps the provider's words shaped the way the provider wrote
 * them. Our own translated sentences take the page's direction and must
 * NOT be marked, which is why this is a prop and not a blanket rule.
 */
function StatusRow({ label, state, detail, detailDir, to }: {
  label: string; state: State; detail?: string | null; detailDir?: 'ltr'; to?: string;
}) {
  const { t } = useLanguage();
  const Icon = STATE_ICON[state];
  const body = (
    <div className="flex items-start gap-3 px-4 py-3">
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', STATE_TONE[state])} aria-hidden="true" />
      <div className="min-w-[10rem] flex-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className={cn('text-xs', STATE_TONE[state])}>{t(STATE_LABEL[state])}</p>
        {detail && (
          <p dir={detailDir} className="mt-1 text-2xs leading-relaxed text-muted-foreground">{detail}</p>
        )}
      </div>
      {to && <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden="true" />}
    </div>
  );
  if (!to) return <li className="border-t border-border first:border-0">{body}</li>;
  return (
    <li className="border-t border-border first:border-0">
      <Link to={to} className="block transition-colors hover:bg-accent/50">{body}</Link>
    </li>
  );
}

export default function AdminHomePage() {
  const { t } = useLanguage();
  const [loading, setLoading] = React.useState(true);
  const [providers, setProviders] = React.useState<ProviderReportRow[] | null>(null);
  const [readiness, setReadiness] = React.useState<ChannelReadinessRow[]>([]);
  const [caps, setCaps] = React.useState<SpendCapStatus[] | null>(null);

  React.useEffect(() => {
    let live = true;
    void Promise.all([
      readProviderStatus(),
      getSpendCapStatus().catch(() => null),
    ]).then(([status, capRows]) => {
      if (!live) return;
      if (status.ok) { setProviders(status.providers); setReadiness(status.readiness); }
      else { setProviders(null); }
      setCaps(capRows);
      setLoading(false);
    });
    return () => { live = false; };
  }, []);

  const byProvider = React.useMemo(() => {
    const map = new Map<string, ProviderReportRow>();
    for (const p of providers ?? []) map.set(p.provider, p);
    return map;
  }, [providers]);

  const channel = React.useCallback(
    (name: ChannelReadinessRow['channel']) => readiness.find((r) => r.channel === name),
    [readiness],
  );

  /* ── The rows ──────────────────────────────────────────────────── */
  const rows = React.useMemo(() => {
    const voiceReady = channel('AI_TALK');
    const callsReady = channel('TELEPHONY');
    const waReady = channel('WHATSAPP');
    const resend = byProvider.get('RESEND');

    const capWarn = (caps ?? []).filter((c) => c.warning).length;

    return [
      {
        key: 'voice',
        label: t('admin_home_sys_voice'),
        state: providers === null ? 'UNKNOWN' as State
          : voiceReady ? (voiceReady.ready ? 'OK' : 'ACTION') as State
            : stateOfProvider(byProvider.get('CARTESIA')),
        detail: providers === null ? t('admin_status_unknown_why') : byProvider.get('CARTESIA')?.detail ?? null,
        detailDir: providers === null ? undefined : 'ltr' as const,
        to: '/admin/communication/voice',
      },
      {
        key: 'calls',
        label: t('admin_home_sys_calls'),
        state: providers === null ? 'UNKNOWN' as State
          : callsReady ? (callsReady.ready ? 'OK' : 'ACTION') as State
            : stateOfProvider(byProvider.get('VAPI')),
        detail: providers === null ? null : byProvider.get('VAPI')?.detail ?? null,
        detailDir: 'ltr' as const,
        to: '/admin/communication/call-center',
      },
      {
        key: 'email',
        label: t('admin_home_sys_email'),
        state: providers === null ? 'UNKNOWN' as State : stateOfProvider(resend),
        detail: providers === null ? null : resend?.detail ?? null,
        detailDir: 'ltr' as const,
        to: '/admin/communication/email',
      },
      {
        key: 'whatsapp',
        label: t('admin_home_sys_whatsapp'),
        state: providers === null ? 'UNKNOWN' as State
          : waReady ? (waReady.ready ? 'OK' : 'ACTION') as State
            : stateOfProvider(byProvider.get('META')),
        detail: providers === null ? null : byProvider.get('META')?.detail ?? null,
        detailDir: 'ltr' as const,
        to: '/admin/communication/whatsapp',
      },
      {
        key: 'spend',
        label: t('admin_home_sys_spend'),
        state: caps === null ? 'UNKNOWN' as State : capWarn > 0 ? 'ACTION' as State : 'OK' as State,
        detail: null,
        detailDir: undefined,
        to: '/admin/spend-caps',
      },
    ];
  }, [t, providers, byProvider, channel, caps]);

  /*
   * WHAT ACTUALLY NEEDS DOING.
   *
   * Only rows that carry their own explanation: the provider report's
   * `detail` is a sentence naming the thing to change, written where the
   * check is made. Inventing a sentence here would be inventing a
   * diagnosis, so a provider that is unhealthy WITHOUT a detail is shown
   * in the status list above and not repeated as an action.
   */
  const attention = React.useMemo(() => {
    /*
     * The CHANNEL first, the provider's sentence second.
     *
     * comm-provider-status writes a genuinely useful sentence, but it
     * opens with the environment variable — "RESEND_WEBHOOK_SECRET is
     * unset: ..." — which is the answer to the engineer's question, not
     * to the owner's. The owner's question is which part of their
     * product is not working.
     *
     * So the heading is the thing they recognise, taken from the same
     * verdict rather than invented, and the provider's own sentence sits
     * under it unchanged. Nothing is paraphrased: a diagnosis rewritten
     * in the browser is a diagnosis nobody checked.
     */
    const out: Array<{ key: string; title: string; detail: string | null; to: string }> = [];
    const CHANNEL: Record<string, { title: string; to: string }> = {
      RESEND: { title: t('admin_home_sys_email'), to: '/admin/communication/email' },
      META: { title: t('admin_home_sys_whatsapp'), to: '/admin/communication/whatsapp' },
      VAPI: { title: t('admin_home_sys_calls'), to: '/admin/communication/call-center' },
      CARTESIA: { title: t('admin_home_sys_voice'), to: '/admin/communication/voice' },
    };
    for (const p of providers ?? []) {
      if (p.health === 'HEALTHY' || p.health === 'DISABLED') continue;
      if (!p.detail) continue;
      const channel = CHANNEL[p.provider] ?? { title: p.provider, to: '/admin/providers' };
      out.push({ key: `p:${p.provider}`, title: channel.title, detail: p.detail, to: channel.to });
    }
    /*
     * A CHANNEL CAN BE BLOCKED WHILE ITS PROVIDER IS FINE.
     *
     * The credentials answer, the probe is healthy, and the channel
     * still cannot run because something else is unset. The status row
     * above knows that — it reads readiness — but the loop above only
     * reads provider health, so production showed three rows saying
     * Action required and exactly one thing to do underneath. The screen
     * contradicted itself, which is the one thing a control centre may
     * not do.
     *
     * `blockedBy` is the backend's own channel-level reason, so this
     * still invents no diagnosis. A channel blocked with nothing said
     * about why stays out, for the same reason as above.
     */
    const READINESS: Partial<Record<ChannelReadinessRow['channel'], { title: string; to: string; provider: string }>> = {
      AI_TALK: { title: t('admin_home_sys_voice'), to: '/admin/communication/voice', provider: 'CARTESIA' },
      TELEPHONY: { title: t('admin_home_sys_calls'), to: '/admin/communication/call-center', provider: 'VAPI' },
      WHATSAPP: { title: t('admin_home_sys_whatsapp'), to: '/admin/communication/whatsapp', provider: 'META' },
    };
    for (const r of readiness) {
      if (r.ready) continue;
      const c = READINESS[r.channel];
      /* Already named by its provider — one row per thing to fix. */
      if (!c || out.some((o) => o.key === `p:${c.provider}`)) continue;
      const said = r.blockedBy.filter((s) => typeof s === 'string' && s.trim().length > 0);
      const detail = said.length > 0 ? said.join(' ') : byProvider.get(c.provider)?.detail ?? null;
      if (!detail) continue;
      out.push({ key: `r:${r.channel}`, title: c.title, detail, to: c.to });
    }

    for (const c of caps ?? []) {
      if (!c.warning) continue;
      out.push({
        key: `c:${c.provider}`,
        title: t('admin_home_sys_spend'),
        detail: c.provider,
        to: '/admin/spend-caps',
      });
    }
    return out;
  }, [providers, readiness, byProvider, caps, t]);

  /*
   * THE COUNT DESCRIBES THE LIST UNDER IT.
   *
   * This used to count PROVIDERS while the list rendered ROWS, and the
   * two do not agree: a row's state also takes channel readiness into
   * account, so production showed "3 of 5 working" directly above five
   * rows of which two said Working. A summary that contradicts the thing
   * it summarises is worse than no summary, because the reader trusts
   * the short number and stops reading.
   */
  const okCount = rows.filter((r) => r.state === 'OK').length;
  const totalCount = rows.length;

  return (
    <div className="mx-auto w-full max-w-[64rem] space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold text-foreground">{t('admin_home_title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('admin_home_subtitle')}</p>
      </header>

      {/* ── Status ─────────────────────────────────────────────────── */}
      <section aria-labelledby="admin-home-status">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="admin-home-status" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('admin_home_status_title')}
          </h2>
          {loading ? (
            <span className="flex items-center gap-1.5 text-2xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              {t('admin_home_checking')}
            </span>
          ) : totalCount > 0 ? (
            <span className="text-2xs text-muted-foreground">
              {t('admin_home_providers_count', { ok: okCount, total: totalCount })}
            </span>
          ) : null}
        </div>

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="space-y-3 p-4">
                {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : (
              <ul>
                {rows.map((r) => (
                  <StatusRow
                    key={r.key}
                    label={r.label}
                    state={r.state}
                    detail={r.detail}
                    detailDir={r.detailDir}
                    to={r.to}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── Needs your attention ───────────────────────────────────── */}
      <section aria-labelledby="admin-home-attention">
        <h2 id="admin-home-attention" className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('admin_home_attention_title')}
        </h2>
        <Card>
          <CardContent className={cn('p-0', loading && 'p-4')}>
            {loading ? (
              <Skeleton className="h-10 w-full" />
            ) : attention.length === 0 ? (
              <p className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-[#12A06B]" aria-hidden="true" />
                {t('admin_home_all_clear')}
              </p>
            ) : (
              <ul>
                {attention.map((a) => (
                  <li key={a.key} className="flex flex-wrap items-start gap-3 border-t border-border px-4 py-3 first:border-0">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--warning))]" aria-hidden="true" />
                    <div className="min-w-[12rem] flex-1">
                      <p className="text-sm font-medium text-foreground">{a.title}</p>
                      {a.detail && (
                        <p dir="ltr" className="mt-0.5 text-2xs leading-relaxed text-muted-foreground">{a.detail}</p>
                      )}
                    </div>
                    <Button asChild size="sm" variant="outline" className="shrink-0">
                      <Link to={a.to}>{t('admin_home_fix')}</Link>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
