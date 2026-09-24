// HOMATCH Admin — the two layers of a provider's truth.
//
// comm-provider-status already does the hard part. It probes Cartesia,
// Vapi, Meta and Resend, reports a health verdict, and — the valuable
// part — a `detail` sentence written where the check is made, naming the
// exact thing that is wrong. None of that is recomputed here. This file
// only decides which of the two layers a reader sees first:
//
//   THE CONSEQUENCE    "Replies do not reach Homatch."
//   THE IDENTIFIER     RESEND_WEBHOOK_SECRET — Missing
//
// The beginner needs the first sentence and would be stopped by the
// second. The engineer needs the identifier and is slowed down by prose.
// So the consequence is always visible and the identifiers are one
// disclosure away, never translated, because an identifier you have to
// type into a dashboard is not helped by being translated.
//
// A CREDENTIAL IS ONLY EVER A BOOLEAN HERE
//
// `credentials` carries `{ name, present }` and nothing else. No value, no
// prefix, no length. There is nothing on this screen that could leak a
// secret because the secret never leaves the server.

import { AlertTriangle, CheckCircle2, ChevronDown, HelpCircle, MinusCircle, XCircle } from 'lucide-react';
import React from 'react';
import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';
import { cn } from '@/lib/utils';
import { readProviderStatus } from '@/services/communications';
import type { ChannelReadinessRow, ProviderReportRow, ProviderRouteRow } from '@/types/communications';

export interface CommStatus {
  loading: boolean;
  ok: boolean;
  reason: string | null;
  providers: ProviderReportRow[];
  routes: ProviderRouteRow[];
  readiness: ChannelReadinessRow[];
}

/** One read of comm-provider-status, shared by every page in this area. */
export function useCommStatus(): CommStatus {
  const [state, setState] = React.useState<CommStatus>({
    loading: true, ok: false, reason: null, providers: [], routes: [], readiness: [],
  });
  React.useEffect(() => {
    let live = true;
    void readProviderStatus().then((res) => {
      if (!live) return;
      if (res.ok) {
        setState({
          loading: false, ok: true, reason: null,
          providers: res.providers, routes: res.routes, readiness: res.readiness,
        });
      } else {
        setState({ loading: false, ok: false, reason: res.reason, providers: [], routes: [], readiness: [] });
      }
    });
    return () => { live = false; };
  }, []);
  return state;
}

export type Verdict = 'OK' | 'ACTION' | 'OFF' | 'PROBLEM' | 'UNKNOWN';

export const VERDICT_LABEL: Record<Verdict, TranslationKey> = {
  OK: 'admin_status_working',
  ACTION: 'admin_status_action',
  OFF: 'admin_status_off',
  PROBLEM: 'admin_status_problem',
  UNKNOWN: 'admin_status_unknown',
};

const VERDICT_ICON: Record<Verdict, typeof CheckCircle2> = {
  OK: CheckCircle2, ACTION: AlertTriangle, OFF: MinusCircle, PROBLEM: XCircle, UNKNOWN: HelpCircle,
};

const VERDICT_TONE: Record<Verdict, string> = {
  OK: 'text-[#12A06B]',
  ACTION: 'text-[hsl(var(--warning))]',
  OFF: 'text-muted-foreground',
  PROBLEM: 'text-destructive',
  UNKNOWN: 'text-muted-foreground',
};

/** A provider's health, mapped onto what it means for the reader. */
export function verdictOf(report: ProviderReportRow | undefined, loaded: boolean): Verdict {
  if (!loaded) return 'UNKNOWN';
  if (!report) return 'UNKNOWN';
  switch (report.health) {
    case 'HEALTHY': return 'OK';
    case 'DISABLED': return 'OFF';
    case 'NOT_CONFIGURED': return 'ACTION';
    case 'DEGRADED': return 'ACTION';
    case 'DOWN': return 'PROBLEM';
    default: return 'UNKNOWN';
  }
}

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const { t } = useLanguage();
  const Icon = VERDICT_ICON[verdict];
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', VERDICT_TONE[verdict])}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {t(VERDICT_LABEL[verdict])}
    </span>
  );
}

/**
 * One fact about a channel, said as a consequence.
 *
 * `ok` decides the icon; `text` is the sentence a reader acts on.
 */
export function FactRow({ ok, text }: { ok: boolean; text: string }) {
  return (
    <li className="flex items-start gap-2.5 py-1.5">
      {ok
        ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#12A06B]" aria-hidden="true" />
        : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden="true" />}
      <span className="min-w-[12rem] flex-1 text-sm leading-relaxed text-foreground">{text}</span>
    </li>
  );
}

/**
 * The identifiers, behind a disclosure.
 *
 * Never translated, and never showing more than presence.
 */
export function TechnicalDetails({ report }: { report: ProviderReportRow | undefined }) {
  const { t } = useLanguage();
  const [open, setOpen] = React.useState(false);
  if (!report) return null;
  return (
    <div className="mt-3 border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-2xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronDown className={cn('h-3 w-3 transition-transform', !open && '-rotate-90 rtl:rotate-90')} aria-hidden="true" />
        {t('admin_technical_details')}
      </button>
      {open && (
        <dl className="mt-2 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <dt className="text-2xs text-muted-foreground">{t('comms_provider')}</dt>
            <dd className="font-mono text-2xs text-foreground">{report.provider}</dd>
          </div>
          {report.credentials.map((c) => (
            <div key={c.name} className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <dt className="min-w-0 break-all font-mono text-2xs text-muted-foreground">{c.name}</dt>
              <dd>
                <Badge variant={c.present ? 'outline' : 'destructive'} className="text-2xs">
                  {c.present ? t('admin_secret_present') : t('admin_secret_missing')}
                </Badge>
              </dd>
            </div>
          ))}
          {report.errorCode && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <dt className="text-2xs text-muted-foreground">{t('admin_status_problem')}</dt>
              <dd className="font-mono text-2xs text-destructive">{report.errorCode}</dd>
            </div>
          )}
          <p className="pt-1 text-2xs leading-relaxed text-muted-foreground">{t('admin_managed_in_env')}</p>
        </dl>
      )}
    </div>
  );
}

/**
 * What is still missing, in the order somebody has to fix it.
 *
 * Only the failing steps are listed when there are any: a checklist of
 * ticks is a certificate, and a reader looking at a broken channel wants
 * the two lines that are not ticked, not the six that are.
 */
export function SetupChecklist({ report }: { report: ProviderReportRow | undefined }) {
  const { t } = useLanguage();
  if (!report) return null;
  const missing = report.credentials.filter((c) => !c.present);
  if (missing.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {missing.map((c) => (
        <li key={c.name} className="flex items-start gap-2.5">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block font-mono text-2xs text-foreground">{c.name}</span>
            <span className="block text-2xs text-muted-foreground">{t('admin_secret_missing')}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
