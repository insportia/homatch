// EMAIL STUDIO — pieces every Email Studio screen shares: the campaign phase badge, the risk
// report, and the sandboxed email preview (desktop / mobile).

import { AlertOctagon, AlertTriangle, CheckCircle2, Info, Monitor, ShieldCheck, Smartphone } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/contexts/LanguageContext';
import { renderCampaignEmail } from '@/emailMarketing/campaignTemplate';
import { type EmailPhase, emailPhase } from '@/emailMarketing/reviewState';
import type { Finding, Severity } from '@/emailMarketing/risk/links';
import { cn } from '@/lib/utils';
import type { SendingDomain } from '@/services/emailMarketing';

const PHASE_TONE: Record<EmailPhase, string> = {
  DRAFT: 'border-border text-muted-foreground',
  READY_FOR_REVIEW: 'border-sky-300 bg-sky-50 text-sky-800',
  UNDER_REVIEW: 'border-amber-300 bg-amber-50 text-amber-900',
  CHANGES_REQUESTED: 'border-orange-300 bg-orange-50 text-orange-900',
  APPROVED: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  REJECTED: 'border-red-300 bg-red-50 text-red-800',
  SCHEDULED: 'border-indigo-300 bg-indigo-50 text-indigo-800',
  SENDING: 'border-[hsl(38_70%_60%)] bg-[hsl(38_90%_96%)] text-[hsl(32_70%_30%)]',
  SENT: 'border-emerald-400 bg-emerald-600 text-white',
  PARTIALLY_SENT: 'border-amber-400 bg-amber-100 text-amber-900',
  FAILED: 'border-red-400 bg-red-600 text-white',
  PAUSED: 'border-slate-300 bg-slate-100 text-slate-700',
  CANCELLED: 'border-border text-muted-foreground line-through',
};

/** A rate as a percentage, or a dash when there is no denominator (never a fake 0%). */
export const pct = (v: number | null) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`);

export function PhaseBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  const { t } = useLanguage();
  const phase = emailPhase(status);
  return (
    <Badge variant="outline" className={cn('whitespace-nowrap text-2xs font-semibold', PHASE_TONE[phase], className)}>
      {t(`ems_phase_${phase.toLowerCase()}`)}
    </Badge>
  );
}

const SEV_ORDER: Severity[] = ['BLOCK', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
const SEV_ICON: Record<Severity, React.ComponentType<{ className?: string }>> = {
  BLOCK: AlertOctagon, HIGH: AlertTriangle, MEDIUM: AlertTriangle, LOW: Info, INFO: Info,
};
const SEV_TONE: Record<Severity, string> = {
  BLOCK: 'text-red-700 bg-red-50 border-red-200',
  HIGH: 'text-orange-800 bg-orange-50 border-orange-200',
  MEDIUM: 'text-amber-900 bg-amber-50 border-amber-200',
  LOW: 'text-slate-700 bg-slate-50 border-slate-200',
  INFO: 'text-slate-600 bg-white border-slate-200',
};

/** A finding in plain words: the code's own sentence when one exists, else a generic one. */
export function findingText(t: (k: string, v?: Record<string, string | number>) => string, f: Finding): string {
  const key = `ems_risk_${f.code.toLowerCase()}`;
  const s = t(key, { detail: f.detail ?? '' });
  return s === key ? t('ems_risk_generic', { code: f.code.replace(/_/g, ' ').toLowerCase() }) : s;
}

export function RiskReport({ findings, compact = false }: { findings: Finding[]; compact?: boolean }) {
  const { t } = useLanguage();
  const sorted = useMemo(() => [...findings].sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity)), [findings]);
  if (!sorted.length) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-900">
        <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{t('ems_risk_clean')}</span>
      </div>
    );
  }
  return (
    <ul className="space-y-1.5" aria-label={t('ems_risk_title')}>
      {sorted.map((f, i) => {
        const Icon = SEV_ICON[f.severity];
        return (
          <li key={`${f.code}-${f.where ?? ''}-${i}`} className={cn('flex items-start gap-2.5 rounded-lg border px-3 py-2 text-[13px] leading-snug', SEV_TONE[f.severity])}>
            <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
              <p className="font-medium">{findingText(t, f)}</p>
              {!compact && f.where && !['body', 'subject', 'sender', 'audience', 'account'].includes(f.where) ? (
                <p className="mt-0.5 break-all text-2xs opacity-75" dir="ltr">{f.where}</p>
              ) : null}
            </div>
            <span className="shrink-0 text-2xs font-semibold uppercase tracking-wide opacity-70">{t(`ems_sev_${f.severity.toLowerCase()}`)}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function VerdictLine({ verdict, level }: { verdict: 'ALLOW' | 'REVIEW' | 'BLOCK'; level: string }) {
  const { t } = useLanguage();
  const Icon = verdict === 'BLOCK' ? AlertOctagon : verdict === 'REVIEW' ? AlertTriangle : CheckCircle2;
  const tone = verdict === 'BLOCK' ? 'text-red-700' : verdict === 'REVIEW' ? 'text-amber-800' : 'text-emerald-700';
  return (
    <p className={cn('flex items-center gap-2 text-sm font-semibold', tone)}>
      <Icon className="h-4 w-4" aria-hidden="true" />
      {t(`ems_verdict_${verdict.toLowerCase()}`)} · {t(`ems_level_${level.toLowerCase()}`)}
    </p>
  );
}

/**
 * The email exactly as a recipient's client renders it: the stored (server-rendered) body inside
 * the campaign shell, in an iframe with every sandbox permission withheld — no script runs and
 * nothing reaches this page. Desktop is the 600-px card on its canvas; mobile is a 375-px viewport.
 */
export function EmailPreviewFrame({ subject, html, text, senderName, language, previewText, className }: {
  subject: string; html: string | null; text?: string | null; senderName?: string | null; language?: string | null; previewText?: string | null; className?: string;
}) {
  const { t } = useLanguage();
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  /* A preview shows what a recipient with no stored name sees: each merge field becomes its fallback. */
  const doc = useMemo(() => {
    const merge = (s: string) => s.replace(/\{\{\s*(first_name|name)\s*(?:\|([^}]{0,40}))?\}\}/g, (_m, _f, fb?: string) => String(fb ?? '').trim());
    return renderCampaignEmail({
      subject: merge(subject), bodyHtml: html ? merge(html) : html, bodyText: text ? merge(text) : null, senderName: senderName ?? null,
      lang: language ?? 'en', preheader: previewText ? merge(previewText) : null, unsubscribeUrl: '#',
    }).html;
  }, [subject, html, text, senderName, language, previewText]);
  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-medium text-muted-foreground">{t('ems_preview_label')}</p>
        <div className="inline-flex shrink-0 rounded-lg border bg-card p-0.5" role="group" aria-label={t('ems_preview_device')}>
          {(['desktop', 'mobile'] as const).map((d) => (
            <button key={d} type="button" onClick={() => setDevice(d)} aria-pressed={device === d}
              className={cn('inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs transition-colors', device === d ? 'bg-[#0C1119] text-white' : 'text-muted-foreground hover:text-foreground')}>
              {d === 'desktop' ? <Monitor className="h-3.5 w-3.5" /> : <Smartphone className="h-3.5 w-3.5" />}
              {t(`ems_preview_${d}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="flex justify-center overflow-hidden rounded-xl border bg-[#EDE8E0] p-2 sm:p-3">
        <iframe
          title={t('ems_preview_label')}
          sandbox=""
          srcDoc={doc}
          className={cn('h-[34rem] rounded-lg border-0 bg-white shadow-sm transition-[width] duration-300 motion-reduce:transition-none', device === 'mobile' ? 'w-[375px] max-w-full' : 'w-full')}
        />
      </div>
    </div>
  );
}

/** Sender authentication for a customer domain, from the provider's own record status. */
export function domainAuth(d: SendingDomain): Record<'spf' | 'dkim' | 'dmarc', 'OK' | 'PENDING' | 'MISSING'> {
  const recs = d.records ?? [];
  const of = (pred: (r: SendingDomain['records'][number]) => boolean) => {
    const r = recs.find(pred);
    if (!r) return 'MISSING' as const;
    return /verified|valid|success/i.test(String(r.status ?? '')) ? 'OK' as const : 'PENDING' as const;
  };
  return {
    spf: of((r) => /spf/i.test(r.record ?? '') || /v=spf1/i.test(r.value)),
    dkim: of((r) => /dkim/i.test(r.record ?? '') || /_domainkey/i.test(r.name)),
    dmarc: of((r) => /dmarc/i.test(r.record ?? '') || /_dmarc/i.test(r.name)),
  };
}


/** A review reason: system decisions store a CODE (worded here, per language); a reviewer's own words show as written. */
export function reasonText(t: (k: string, v?: Record<string, string | number>) => string, reason: string | null | undefined): string {
  const r = String(reason ?? '').trim();
  if (!/^[A-Z][A-Z_]{2,40}$/.test(r)) return r;
  const key = `ems_reason_${r.toLowerCase()}`;
  const s = t(key);
  return s === key ? r.replace(/_/g, ' ').toLowerCase() : s;
}
