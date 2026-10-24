// EMAIL STUDIO — "ელფოსტის მიწოდების ხარისხი" (email deliverability quality). Owner brief 2026-10-24 Part 4.
//
// Verified facts only, each labelled with where it comes from:
//   · the sending domain as receivers see it — public DNS (SPF of the envelope domain, DKIM key,
//     DMARC policy and reports, alignment) and the provider's own record status (deliverability_check);
//   · delivery as the provider reports it — ACCEPTED by the provider and DELIVERED to the receiving
//     server, which is NOT inbox placement;
//   · placement as the OWNER observed it in a real mailbox (a controlled test), optionally with the
//     authentication that mailbox's own headers record (pasted, read in the browser, never stored raw).
// Inbox and Spam exist here only as owner-observed tests. Anything not measured shows as unavailable.
// "Possible reasons" are hypotheses and say so. Nothing here changes DNS or provider settings.

import { AlertTriangle, CheckCircle2, CircleHelp, Inbox, Loader2, MailWarning, RefreshCw, ShieldAlert, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useLanguage } from '@/contexts/LanguageContext';
import { aligned, analyzeHeaders, type HeaderReport } from '@/emailMarketing/deliverability/headers';
import { cn } from '@/lib/utils';
import {
  type CheckState, type DeliverabilityDomain, type DeliverabilityResult, deletePlacementTest, type EmailAllowance, getAllowance, lastDeliverabilityCheck, listPlacementTests,
  type Mailbox, type Placement, type PlacementTest, rate, recordPlacementTest, runDeliverabilityCheck, type SendTotals, StudioError,
} from '@/services/emailCampaignStudio';
import { pct } from './shared';

const MAILBOXES: Mailbox[] = ['GMAIL', 'OUTLOOK', 'YAHOO', 'APPLE', 'OTHER'];
const PLACEMENTS: Placement[] = ['INBOX', 'SPAM', 'PROMOTIONS', 'OTHER_TAB', 'NOT_RECEIVED'];

function StateIcon({ s }: { s: CheckState | 'ok' | 'warn' | 'bad' | 'info' }) {
  const k = s.toUpperCase();
  if (k === 'OK') return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />;
  if (k === 'WARN' || k === 'INFO') return <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />;
  if (k === 'BAD') return <XCircle className="h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />;
  return <CircleHelp className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
}

export function DeliverabilityHealth({ totals }: { totals: SendTotals | null }) {
  const { t, lang } = useLanguage();
  const [check, setCheck] = useState<DeliverabilityResult | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [tests, setTests] = useState<PlacementTest[] | null>(null);
  const [allowance, setAllowance] = useState<EmailAllowance | null>(null);

  useEffect(() => {
    void lastDeliverabilityCheck().then(setCheck).catch(() => setCheck(null));
    void listPlacementTests().then(setTests).catch(() => setTests([]));
    void getAllowance().then(setAllowance).catch(() => setAllowance(null));
  }, []);

  const recheck = async () => {
    setBusy(true);
    try { setCheck(await runDeliverabilityCheck()); } catch (e) {
      toast.error(e instanceof StudioError && e.code === 'RATE_LIMITED' ? t('ems_dq_rate_limited') : t('ems_dq_check_failed'));
    } finally { setBusy(false); }
  };
  const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' }) : t('ems_dq_unavailable'));
  const lastInbox = tests?.find((x) => x.placement === 'INBOX') ?? null;

  return (
    <section className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5" aria-labelledby="dq-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="dq-title" className="text-base font-semibold">{t('ems_dq_title')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('ems_dq_sub')}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-2xs text-muted-foreground">{t('ems_dq_last_check')}: {check === undefined ? '…' : when(check?.checkedAt)}</span>
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" disabled={busy} onClick={() => void recheck()}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}{t('ems_dq_recheck')}
          </Button>
        </div>
      </div>

      {check === undefined ? <div className="h-24 animate-pulse rounded-xl bg-muted" /> : !check ? (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">{t('ems_dq_never_checked')}</p>
      ) : check.domains.map((d) => <DomainCard key={d.domain} d={d} />)}

      <DeliveryFunnel totals={totals} tests={tests} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label={t('ems_dq_complaint_rate')} value={totals ? pct(rate(totals.complained, totals.accepted)) : null} hint={t('ems_dq_complaint_target')} />
        <Metric label={t('ems_dq_bounce_rate')} value={totals ? pct(rate(totals.bounced, totals.accepted)) : null} hint={t('ems_dl_bounce_target')} />
        <Metric label={t('ems_dq_unsubscribes')} value={totals ? `${totals.unsubscribed.toLocaleString(lang)} · ${pct(rate(totals.unsubscribed, totals.delivered))}` : null} hint={t('ems_dq_30_days')} />
        <Metric label={t('ems_dq_failures')} value={totals ? totals.failed.toLocaleString(lang) : null} hint={t('ems_dq_30_days')} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border p-3.5">
          <p className="text-sm font-medium">{t('ems_dq_reputation')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('ems_dq_reputation_unavailable')}</p>
        </div>
        <div className="rounded-xl border p-3.5">
          <p className="text-sm font-medium">{t('ems_dq_limits')}</p>
          {allowance ? (
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {allowance.tenantDaily ? <li>{t('ems_dq_limit_daily', { n: allowance.tenantDaily.remaining.toLocaleString(lang), cap: allowance.tenantDaily.cap.toLocaleString(lang) })}</li> : null}
              {allowance.providerDaily ? <li>{t('ems_dq_limit_provider_day', { n: allowance.providerDaily.remaining.toLocaleString(lang) })}</li> : null}
              {allowance.providerMonthly ? <li>{t('ems_dq_limit_provider_month', { n: allowance.providerMonthly.remaining.toLocaleString(lang) })}</li> : null}
              <li>{t('ems_dq_limit_pace')}</li>
            </ul>
          ) : <p className="mt-1 text-xs text-muted-foreground">{t('ems_dq_unavailable')}</p>}
        </div>
      </div>

      <PlacementTests tests={tests} setTests={setTests} lastInbox={lastInbox ? when(lastInbox.observed_at) : null} />
    </section>
  );
}

function Metric({ label, value, hint }: { label: string; value: string | null; hint?: string }) {
  const { t } = useLanguage();
  return (
    <div className="rounded-xl border p-3">
      <p className="text-2xs font-medium uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value ?? t('ems_dq_unavailable')}</p>
      {hint ? <p className="text-2xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/* ── one sending domain ─────────────────────────────────────────────────────────────────── */

const FIXES: Record<string, 'dns' | 'info'> = {
  SPF_MISSING: 'dns', SPF_DUPLICATE: 'dns', SPF_PLUS_ALL: 'dns', SPF_LOOKUPS_HIGH: 'dns', DKIM_MISSING: 'dns', DKIM_REVOKED: 'dns',
  DMARC_MISSING: 'dns', DMARC_POLICY_NONE: 'info', DMARC_NO_REPORTS: 'dns', ROOT_SPF_DUPLICATE: 'dns',
};

function DomainCard({ d }: { d: DeliverabilityDomain }) {
  const { t } = useLanguage();
  const verified = /^verified$/i.test(d.providerStatus ?? '');
  const provider: CheckState = d.providerStatus == null ? 'UNKNOWN' : verified ? 'OK' : /fail/i.test(d.providerStatus) ? 'BAD' : 'WARN';
  const rows: Array<[string, CheckState, string | null]> = [
    [t('ems_dq_domain_verify'), provider, d.providerStatus ? t(`ems_dq_provider_${verified ? 'verified' : /fail/i.test(d.providerStatus) ? 'failed' : 'pending'}`) : t('ems_dq_unavailable')],
    [t('ems_dq_spf'), d.dns.spf.state, d.dns.spf.record ? `${d.dns.returnPath}` : null],
    [t('ems_dq_dkim'), d.dns.dkim.state, `${d.dns.dkim.selector}._domainkey`],
    [t('ems_dq_dmarc'), d.dns.dmarc.state, d.dns.dmarc.policy ? `p=${d.dns.dmarc.policy}${d.dns.dmarc.rua ? ' · rua' : ''}` : null],
    [t('ems_dq_alignment'), d.dns.alignment.state, d.dns.alignment.dkimAligned ? t('ems_dq_aligned_dkim') : d.dns.alignment.spfAligned ? t('ems_dq_aligned_spf') : null],
  ];
  const codes = [...d.dns.spf.codes, ...d.dns.dkim.codes, ...d.dns.dmarc.codes, ...d.dns.rootSpf.codes].filter((c) => !c.endsWith('_LOOKUP_FAILED'));
  const failedLookups = [...d.dns.spf.codes, ...d.dns.dkim.codes, ...d.dns.dmarc.codes].some((c) => c.endsWith('_LOOKUP_FAILED'));
  const dmarcSuggestion = `v=DMARC1; p=none; rua=mailto:dmarc-reports@${d.domain}; fo=1`;
  return (
    <div className="space-y-3 rounded-xl border p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-2xs uppercase tracking-[0.1em] text-muted-foreground">{t('ems_dq_sending_domain')}</p>
          <p className="text-sm font-semibold" dir="ltr">{d.domain}</p>
        </div>
        <span className="rounded-full bg-muted px-2 py-0.5 text-2xs text-muted-foreground">{d.shared ? t('ems_dq_shared_domain') : t('ems_dq_own_domain')}</span>
      </div>
      <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-5">
        {rows.map(([label, s, detail]) => (
          <li key={label} className="flex items-start gap-2 rounded-lg bg-muted/40 p-2 text-xs">
            <StateIcon s={s} />
            <span className="min-w-0"><span className="block font-medium">{label}</span>
              <span className="block text-2xs text-muted-foreground">{t(`ems_dq_state_${s.toLowerCase()}`)}{detail ? <> · <span dir="ltr">{detail}</span></> : null}</span></span>
          </li>
        ))}
      </ul>
      {d.tracking.click || d.tracking.open ? (
        <p className="flex items-start gap-1.5 text-xs text-amber-800"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t(d.tracking.click ? 'ems_dq_click_tracking_on' : 'ems_dq_open_tracking_on')}</p>
      ) : d.tracking.click === false ? <p className="text-2xs text-muted-foreground">{t('ems_dq_tracking_off')}</p> : null}
      {failedLookups ? <p className="text-2xs text-muted-foreground">{t('ems_dq_lookup_failed')}</p> : null}
      {codes.length ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium">{t('ems_dq_fix_items')}</p>
          <ul className="space-y-1">
            {codes.map((c) => (
              <li key={c} className="rounded-lg border bg-background p-2 text-xs">
                <span className="flex items-start gap-1.5">{FIXES[c] === 'dns' ? <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" aria-hidden="true" /> : <CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}{t(`ems_dq_code_${c.toLowerCase()}`)}</span>
                {c === 'DMARC_NO_REPORTS' ? (
                  <span className="mt-1 block rounded bg-muted px-2 py-1 font-mono text-2xs" dir="ltr">{`_dmarc.${d.domain} TXT "${dmarcSuggestion}"`}</span>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="text-2xs text-muted-foreground">{t('ems_dq_dns_owner_only')}</p>
        </div>
      ) : null}
    </div>
  );
}

/* ── delivery status: what the provider reports vs what a mailbox showed ───────────────── */

function DeliveryFunnel({ totals, tests }: { totals: SendTotals | null; tests: PlacementTest[] | null }) {
  const { t, lang } = useLanguage();
  const inbox = tests?.filter((x) => x.placement === 'INBOX' || x.placement === 'PROMOTIONS' || x.placement === 'OTHER_TAB').length ?? null;
  const spam = tests?.filter((x) => x.placement === 'SPAM').length ?? null;
  const n = (v: number | null | undefined) => (v == null ? t('ems_dq_unavailable') : v.toLocaleString(lang));
  const steps: Array<[React.ComponentType<{ className?: string }>, string, string, string]> = [
    [ShieldCheck, t('ems_dq_accepted'), n(totals?.accepted), t('ems_dq_accepted_hint')],
    [Inbox, t('ems_dq_delivered'), n(totals?.delivered), t('ems_dq_delivered_hint')],
    [CheckCircle2, t('ems_dq_inbox_verified'), n(inbox), t('ems_dq_inbox_verified_hint')],
    [MailWarning, t('ems_dq_spam_verified'), n(spam), t('ems_dq_spam_verified_hint')],
  ];
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{t('ems_dq_delivery_status')} <span className="text-2xs font-normal text-muted-foreground">· {t('ems_dq_30_days')}</span></p>
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map(([I, label, value, hint]) => (
          <li key={label} className="rounded-xl border p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium"><I className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />{label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
            <p className="text-2xs leading-snug text-muted-foreground">{hint}</p>
          </li>
        ))}
      </ol>
      <p className="flex items-start gap-1.5 rounded-lg bg-muted/50 p-2.5 text-xs text-muted-foreground"><CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t('ems_dq_placement_unknown')}</p>
      <p className="text-2xs text-muted-foreground">{t('ems_dq_simulator_excluded')}</p>
    </div>
  );
}

/* ── controlled placement tests ─────────────────────────────────────────────────────────── */

function authSummary(r: HeaderReport) {
  return {
    spf: r.spf.result, dkimAligned: r.dkim.some((d) => d.result === 'pass' && aligned(d.domain, r.fromDomain)),
    dmarc: r.dmarc.result, dmarcPolicy: r.dmarc.policy, compauth: r.compauth?.result ?? null, scl: r.scl, tls: r.tls, oneClick: r.listUnsubscribePost,
    findings: r.findings.map((f) => f.code),
  };
}

function PlacementTests({ tests, setTests, lastInbox }: { tests: PlacementTest[] | null; setTests: (f: (x: PlacementTest[] | null) => PlacementTest[] | null) => void; lastInbox: string | null }) {
  const { t, lang } = useLanguage();
  const [mailbox, setMailbox] = useState<Mailbox>('GMAIL');
  const [placement, setPlacement] = useState<Placement>('INBOX');
  const [raw, setRaw] = useState('');
  const [saving, setSaving] = useState(false);
  const report = useMemo(() => (raw.trim() ? analyzeHeaders(raw) : null), [raw]);

  const save = async () => {
    setSaving(true);
    try {
      const row = await recordPlacementTest({ mailbox, placement, auth: report ? authSummary(report) : null });
      setTests((x) => [row, ...(x ?? [])]);
      setRaw('');
      toast.success(t('ems_dq_test_saved'));
    } catch { toast.error(t('ems_dq_test_failed')); } finally { setSaving(false); }
  };
  const remove = async (id: string) => {
    try { await deletePlacementTest(id); setTests((x) => (x ?? []).filter((r) => r.id !== id)); } catch { toast.error(t('ems_dq_test_failed')); }
  };

  return (
    <div className="space-y-3 rounded-xl border p-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{t('ems_dq_test_results')}</p>
        <span className="text-2xs text-muted-foreground">{t('ems_dq_last_good_test')}: {lastInbox ?? t('ems_dq_unavailable')}</span>
      </div>
      <ol className="list-decimal space-y-0.5 ps-5 text-xs text-muted-foreground">
        <li>{t('ems_dq_how_1')}</li><li>{t('ems_dq_how_2')}</li><li>{t('ems_dq_how_3')}</li>
      </ol>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1"><Label className="text-xs">{t('ems_dq_mailbox')}</Label>
          <Select value={mailbox} onValueChange={(v) => setMailbox(v as Mailbox)}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{MAILBOXES.map((m) => <SelectItem key={m} value={m}>{t(`ems_dq_mailbox_${m.toLowerCase()}`)}</SelectItem>)}</SelectContent></Select>
        </div>
        <div className="space-y-1"><Label className="text-xs">{t('ems_dq_where_landed')}</Label>
          <Select value={placement} onValueChange={(v) => setPlacement(v as Placement)}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{PLACEMENTS.map((p) => <SelectItem key={p} value={p}>{t(`ems_dq_place_${p.toLowerCase()}`)}</SelectItem>)}</SelectContent></Select>
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{t('ems_dq_headers')}</Label>
        <Textarea value={raw} rows={5} dir="ltr" className="font-mono text-2xs" placeholder={t('ems_dq_headers_placeholder')} onChange={(e) => setRaw(e.target.value)} />
        <p className="text-2xs text-muted-foreground">{t('ems_dq_headers_private')}</p>
      </div>
      {report ? <HeaderFindings r={report} placement={placement} /> : null}
      <Button type="button" size="sm" className="h-8" disabled={saving} onClick={() => void save()}>{saving ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : null}{t('ems_dq_record_test')}</Button>
      {tests && tests.length ? (
        <ul className="divide-y text-xs">
          {tests.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className={cn('rounded-full px-2 py-0.5 text-2xs font-semibold', r.placement === 'SPAM' || r.placement === 'NOT_RECEIVED' ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800')}>{t(`ems_dq_place_${r.placement.toLowerCase()}`)}</span>
              <span>{t(`ems_dq_mailbox_${r.mailbox.toLowerCase()}`)}</span>
              {r.auth ? <span className="text-2xs text-muted-foreground" dir="ltr">{`SPF ${String(r.auth.spf)} · DMARC ${String(r.auth.dmarc)}`}</span> : null}
              <span className="ms-auto text-2xs text-muted-foreground">{new Date(r.observed_at).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' })}</span>
              <button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-red-700" aria-label={t('ems_d_delete')} onClick={() => void remove(r.id)}><Trash2 className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
      ) : tests ? <p className="text-xs text-muted-foreground">{t('ems_dq_no_tests')}</p> : null}
    </div>
  );
}

/* What the mailbox's own headers say (verified), then possible reasons (hypotheses). */
function HeaderFindings({ r, placement }: { r: HeaderReport; placement: Placement }) {
  const { t } = useLanguage();
  const failing = r.findings.filter((f) => f.severity === 'bad' || f.severity === 'warn');
  const hypotheses: string[] = [];
  if (placement === 'SPAM' || placement === 'NOT_RECEIVED') {
    if (!failing.length) hypotheses.push('ems_dq_hyp_reputation', 'ems_dq_hyp_content', 'ems_dq_hyp_engagement');
    if (r.dmarc.policy === 'none') hypotheses.push('ems_dq_hyp_dmarc_none');
    if (!r.listUnsubscribePost) hypotheses.push('ems_dq_hyp_one_click');
  }
  return (
    <div className="space-y-2 rounded-lg border bg-background p-2.5">
      <p className="text-xs font-medium">{t('ems_dq_header_verified')}</p>
      <ul className="space-y-1">
        {r.findings.map((f) => (
          <li key={f.code} className="flex items-start gap-1.5 text-xs"><StateIcon s={f.severity} />
            <span>{t(`ems_dq_h_${f.code.toLowerCase()}`)}{f.detail ? <span className="text-muted-foreground" dir="ltr"> · {f.detail}</span> : null}</span></li>
        ))}
      </ul>
      {hypotheses.length ? (
        <>
          <p className="pt-1 text-xs font-medium">{t('ems_dq_possible_reasons')}</p>
          <ul className="list-disc space-y-0.5 ps-5 text-xs text-muted-foreground">{hypotheses.map((h) => <li key={h}>{t(h)}</li>)}</ul>
        </>
      ) : null}
    </div>
  );
}
