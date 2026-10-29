// HOMATCH — Admin → Service Control Center.
//
// The owner's pause / resume switches for every manageable HOMATCH service, grouped by
// product area (inventory: docs/claude/SERVICE_CONTROLS_INVENTORY.md). Each has two switches —
//   Backend execution   may the server start new work for it
//   Frontend visibility does it appear in its customer-facing places
// — and the second can only be on while the first is. Nothing is deleted by a
// pause: records, conversations, projects, credentials and settings stay.
//
// There is no "pause everything" button: a group is paused at most, and only after the
// admin types the group's name (checked again by the database). Platform pieces —
// sign-in, wallet, billing, property management, messages, Admin itself — have no switch.
//
// ACCESS CONTROL IS NOT THIS FILE'S JOB. The service-control function re-checks
// is_admin() on the caller's own token on every request; the database writes the
// audit row. This page never shows a change as done before the server says so.

import { AlertTriangle, CheckCircle2, History, Loader2, PauseCircle, PlayCircle, RefreshCw, ShieldAlert, XCircle } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ErrorState, Kpi, KpiRow, LoadingBlock, PageHeader } from '@/components/communications/primitives';
import { SERVICE_NAME_KEYS } from '@/components/serviceControls/ServiceGate';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';
import { serviceControlStore } from '@/lib/serviceControls';
import { cn } from '@/lib/utils';
import {
  type Effective, type ServiceCard, ServiceControlError, type ServiceOverview,
  pauseServiceGroup, serviceOverview, setService,
} from '@/services/serviceControls';

const POLL_MS = 20_000;

const DESCRIPTION_KEYS: Record<ServiceCard['key'], TranslationKey> = {
  publishing: 'svc_desc_publishing',
  ai_call_center: 'svc_desc_ai_call_center',
  ai_talk: 'svc_desc_ai_talk',
  whatsapp: 'svc_desc_whatsapp',
  live_chat: 'svc_desc_live_chat',
  design_studio: 'svc_desc_design_studio',
  find_property: 'svc_desc_find_property',
  find_property_deep: 'svc_desc_find_property_deep',
  find_buyers: 'svc_desc_find_buyers',
  find_buyers_external: 'svc_desc_find_buyers_external',
  internal_matching: 'svc_desc_internal_matching',
  curated_leads: 'svc_desc_curated_leads',
  verify: 'svc_desc_verify',
  contracts: 'svc_desc_contracts',
  mortgage: 'svc_desc_mortgage',
  investment: 'svc_desc_investment',
  for_expats: 'svc_desc_for_expats',
  meta_ads: 'svc_desc_meta_ads',
  email_campaigns: 'svc_desc_email_campaigns',
  email_marketing: 'svc_desc_email_marketing',
  ai_assistant: 'svc_desc_ai_assistant',
  brokers_directory: 'svc_desc_brokers_directory',
  broker_desk: 'svc_desc_broker_desk',
  developers: 'svc_desc_developers',
};

/** The order the groups are shown in; a group the server names but this list does not goes last. */
const GROUP_ORDER = ['discovery', 'intelligence', 'marketing', 'communications', 'assistant', 'professionals', 'design', 'publishing', 'other'];
const groupName = (group: string): TranslationKey => `svc_group_${GROUP_ORDER.includes(group) ? group : 'other'}` as TranslationKey;

const EFFECTIVE: Record<Effective, { key: TranslationKey; tone: string; Icon: typeof CheckCircle2 }> = {
  PAUSED: { key: 'svc_effective_paused', tone: 'border-muted-foreground/30 text-muted-foreground', Icon: PauseCircle },
  BACKEND_ONLY: { key: 'svc_effective_backend_only', tone: 'border-gold/50 text-gold-ink', Icon: PlayCircle },
  LIVE: { key: 'svc_effective_live', tone: 'border-emerald-500/50 text-emerald-600 dark:text-emerald-400', Icon: CheckCircle2 },
  DEGRADED: { key: 'svc_effective_degraded', tone: 'border-destructive/50 text-destructive', Icon: AlertTriangle },
};

/** A readiness or note code → its words, or the code itself if it is new. */
function useCodeText() {
  const { t } = useLanguage();
  return (code: string) => {
    if (code.startsWith('SECRET_')) return t('svc_code_secret', { name: code.slice(7) });
    if (code.startsWith('SCHEMA_')) return t('svc_code_schema', { name: code.slice(7) });
    return t(`svc_code_${code.toLowerCase()}` as TranslationKey);
  };
}

type Pending =
  | { kind: 'set'; card: ServiceCard; frontend: boolean; backend: boolean }
  | { kind: 'pause_group'; group: string; count: number };

export default function AdminServiceControlPage() {
  const { t, lang } = useLanguage();
  const codeText = useCodeText();
  const [data, setData] = useState<ServiceOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [notReady, setNotReady] = useState<{ key: ServiceCard['key']; missing: string[] } | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const next = await serviceOverview();
      if (mounted.current) { setData(next); setError(null); }
    } catch (e) {
      if (mounted.current) setError(e instanceof ServiceControlError ? e.code : 'NETWORK_ERROR');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    const id = window.setInterval(() => { void load(true); }, POLL_MS);
    return () => { mounted.current = false; window.clearInterval(id); };
  }, [load]);

  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(lang === 'en' ? 'en-GB' : lang) : '—');

  const confirm = async () => {
    if (!pending) return;
    const job = pending;
    setPending(null);
    const why = reason.trim();
    const confirmation = typed.trim();
    setReason('');
    setTyped('');
    if (job.kind === 'pause_group') {
      setBusy(`group:${job.group}`);
      try {
        const r = await pauseServiceGroup(job.group, confirmation, why);
        toast.success(r.result === 'CHANGED' ? t('svc_toast_paused_group', { n: r.changed.length, group: t(groupName(job.group)) }) : t('svc_toast_unchanged'));
      } catch (e) {
        toast.error(t('svc_toast_failed', { code: e instanceof ServiceControlError ? e.code : 'NETWORK_ERROR' }));
      } finally {
        setBusy(null);
        void serviceControlStore.refresh();
        await load(true);
      }
      return;
    }
    const { card, frontend, backend } = job;
    setBusy(card.key);
    try {
      const r = await setService(card.key, frontend, backend, card.version ?? 0, why);
      toast.success(r.result === 'CHANGED' ? t('svc_toast_saved', { service: t(SERVICE_NAME_KEYS[card.key]) }) : t('svc_toast_unchanged'));
    } catch (e) {
      const code = e instanceof ServiceControlError ? e.code : 'NETWORK_ERROR';
      if (code === 'NOT_READY' && e instanceof ServiceControlError) {
        setNotReady({ key: card.key, missing: e.detail.missing ?? [] });
      } else if (code === 'VERSION_CONFLICT') {
        toast.warning(t('svc_toast_conflict'));
      } else {
        toast.error(t('svc_toast_failed', { code }));
      }
    } finally {
      setBusy(null);
      void serviceControlStore.refresh();
      await load(true);
    }
  };

  const services = data?.services ?? [];
  const paused = services.filter((s) => s.effective === 'PAUSED').length;
  const notReadyCount = services.filter((s) => !s.readiness.ready).length;
  // Every job, session and campaign the cards report, summed (unknown counts are skipped).
  const runningWork = services.reduce((sum, s) => sum + Object.values(s.running).reduce<number>((a, n) => a + (typeof n === 'number' ? n : 0), 0), 0);
  const groups = [...new Set(services.map((s) => s.group ?? 'other'))]
    .sort((a, b) => (GROUP_ORDER.indexOf(a) + 100 * Number(!GROUP_ORDER.includes(a))) - (GROUP_ORDER.indexOf(b) + 100 * Number(!GROUP_ORDER.includes(b))))
    .map((group) => ({ group, cards: services.filter((s) => (s.group ?? 'other') === group) }));

  return (
    <div className="space-y-6" data-testid="service-control-center">
      <PageHeader
        eyebrow={t('svc_eyebrow')}
        title={t('svc_title')}
        subtitle={t('svc_subtitle', { seconds: data?.propagationSeconds ?? 10 })}
        secondary={{ label: t('svc_refresh'), onClick: () => { void load(); } }}
      />

      {error ? <ErrorState messageKey="svc_load_failed" detail={error} onRetry={() => { void load(); }} /> : null}

      {loading && !data ? <LoadingBlock rows={6} /> : null}

      {data ? (
        <>
          <KpiRow cols={4}>
            <Kpi labelKey="svc_kpi_paused" icon={PauseCircle} value={`${paused} / ${services.length}`} />
            <Kpi labelKey="svc_kpi_live" icon={PlayCircle} value={`${services.length - paused} / ${services.length}`} accent={services.length - paused > 0} />
            <Kpi labelKey="svc_kpi_not_ready" icon={ShieldAlert} value={notReadyCount} />
            <Kpi labelKey="svc_kpi_running_work" icon={RefreshCw} value={runningWork} />
          </KpiRow>

          {groups.map(({ group, cards }) => {
            const running = cards.filter((c) => c.effective !== 'PAUSED').length;
            const anyOn = cards.some((c) => c.backend || c.frontend);
            return (
              <section key={group} data-testid={`service-group-${group}`} className="space-y-3">
                <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-2">
                  <div className="min-w-0">
                    <h2 className="font-display text-xl font-semibold">{t(groupName(group))}</h2>
                    <p className="text-sm text-muted-foreground">{t('svc_group_count', { live: running, total: cards.length })}</p>
                  </div>
                  {group !== 'other' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={busy !== null || !anyOn}
                      onClick={() => setPending({ kind: 'pause_group', group, count: cards.length })}
                      data-testid={`svc-pause-group-${group}`}
                    >
                      {busy === `group:${group}` ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <PauseCircle className="me-2 h-4 w-4" />}
                      {t('svc_group_pause_action')}
                    </Button>
                  ) : null}
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  {cards.map((card) => (
                    <ServiceCardView
                      key={card.key}
                      card={card}
                      busy={busy === card.key}
                      locked={busy !== null}
                      when={when}
                      codeText={codeText}
                      onChange={(frontend, backend) => setPending({ kind: 'set', card, frontend, backend })}
                    />
                  ))}
                </div>
              </section>
            );
          })}
          <p className="text-xs text-muted-foreground">{t('svc_checked_at', { at: when(data.checkedAt) })}</p>
        </>
      ) : null}

      <AlertDialog open={pending !== null} onOpenChange={(open) => { if (!open) { setPending(null); setReason(''); setTyped(''); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.kind === 'pause_group' ? t('svc_group_pause_title', { group: t(groupName(pending.group)) })
                : pending ? t('svc_confirm_title', { service: t(SERVICE_NAME_KEYS[pending.card.key]) }) : ''}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === 'pause_group' ? t('svc_group_pause_body')
                : pending ? (
                  <>
                    {t(pending.backend ? 'svc_confirm_backend_on' : 'svc_confirm_backend_off')}{' '}
                    {t(pending.frontend ? 'svc_confirm_frontend_on' : 'svc_confirm_frontend_off')}
                    {/* Turning a live product off is the one change customers notice at once. */}
                    {!pending.backend && pending.card.effective !== 'PAUSED' && pending.card.failMode === 'OPEN'
                      ? <span className="mt-2 block font-medium text-destructive">{t('svc_confirm_live_warning')}</span> : null}
                  </>
                ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pending?.kind === 'pause_group' ? (
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">{t('svc_group_confirm_label', { token: pending.group })}</span>
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false}
                dir="ltr" className="font-mono" data-testid="svc-group-confirm-input" aria-describedby="svc-group-token" />
              <span id="svc-group-token" className="sr-only">{pending.group}</span>
            </label>
          ) : null}
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">{t('svc_reason_label')}</span>
            <Textarea value={reason} maxLength={500} rows={3} onChange={(e) => setReason(e.target.value)} placeholder={t('svc_reason_placeholder')} />
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('svc_cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending?.kind === 'pause_group' && typed.trim() !== pending.group}
              onClick={(e) => { e.preventDefault(); void confirm(); }}
            >{t('svc_confirm_action')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={notReady !== null} onOpenChange={(open) => { if (!open) setNotReady(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{notReady ? t('svc_not_ready_title', { service: t(SERVICE_NAME_KEYS[notReady.key]) }) : ''}</AlertDialogTitle>
            <AlertDialogDescription>{t('svc_not_ready_body')}</AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="list-disc space-y-1 ps-5 text-sm">
            {(notReady?.missing ?? []).map((m) => <li key={m}>{codeText(m)}</li>)}
          </ul>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setNotReady(null)}>{t('svc_ok')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ServiceCardView({ card, busy, locked, when, codeText, onChange }: {
  card: ServiceCard;
  busy: boolean;
  locked: boolean;
  when: (iso: string | null) => string;
  codeText: (code: string) => string;
  onChange: (frontend: boolean, backend: boolean) => void;
}) {
  const { t } = useLanguage();
  const [showHistory, setShowHistory] = useState(false);
  const effective = EFFECTIVE[card.effective];
  const running = Object.entries(card.running).filter(([, n]) => n !== null && n !== undefined);
  const disabled = locked || card.version === null;

  return (
    <Card data-testid={`service-card-${card.key}`} className={cn('min-w-0', card.effective === 'DEGRADED' && 'border-destructive/40')}>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold">{t(SERVICE_NAME_KEYS[card.key])}</h2>
            <p className="text-sm text-muted-foreground">{t(DESCRIPTION_KEYS[card.key])}</p>
            <p className="mt-1 text-xs text-muted-foreground" data-testid={`svc-failmode-${card.key}`}>
              {t(card.failMode === 'OPEN' ? 'svc_failmode_open' : 'svc_failmode_closed')}
            </p>
          </div>
          <Badge variant="outline" className={cn('shrink-0 gap-1.5', effective.tone)}>
            <effective.Icon className="h-3.5 w-3.5" aria-hidden="true" />{t(effective.key)}
          </Badge>
        </div>

        <div className="divide-y rounded-lg border">
          <SwitchRow
            label={t('svc_backend_label')}
            hint={t(card.backend ? 'svc_backend_on_hint' : 'svc_backend_off_hint')}
            checked={card.backend}
            disabled={disabled}
            busy={busy}
            onToggle={(on) => onChange(on ? card.frontend : false, on)}
            testId={`svc-backend-${card.key}`}
          />
          <SwitchRow
            label={t('svc_frontend_label')}
            hint={t(!card.backend ? 'svc_frontend_needs_backend' : card.frontend ? 'svc_frontend_on_hint' : 'svc_frontend_off_hint')}
            checked={card.frontend}
            disabled={disabled || !card.backend}
            busy={busy}
            onToggle={(on) => onChange(on, true)}
            testId={`svc-frontend-${card.key}`}
          />
        </div>

        <div className="space-y-1.5 text-sm">
          <p className="flex items-center gap-1.5 font-medium">
            {card.readiness.ready
              ? <><CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />{t('svc_ready')}</>
              : <><XCircle className="h-4 w-4 text-destructive" aria-hidden="true" />{t('svc_not_ready')}</>}
          </p>
          {card.readiness.missing.length > 0 ? (
            <ul className="list-disc space-y-0.5 ps-5 text-destructive">
              {card.readiness.missing.map((m) => <li key={m}>{codeText(m)}</li>)}
            </ul>
          ) : null}
          {card.readiness.notes.length > 0 ? (
            <ul className="list-disc space-y-0.5 ps-5 text-muted-foreground">
              {card.readiness.notes.map((m) => <li key={m}>{codeText(m)}</li>)}
            </ul>
          ) : null}
        </div>

        {running.length > 0 ? (
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            {running.map(([label, n]) => (
              <div key={label} className="rounded-md bg-secondary/60 px-2.5 py-1.5">
                <dt className="text-xs text-muted-foreground">{t(`svc_running_${label}` as TranslationKey)}</dt>
                <dd className="font-semibold tabular-nums">{n}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {t('svc_last_change', { at: when(card.updatedAt), by: card.updatedBy ?? t('svc_system') })}
            {card.reason ? <> — <span className="italic">{card.reason}</span></> : null}
          </span>
          <div className="flex gap-2">
            {(card.backend || card.frontend) ? (
              <Button size="sm" variant="outline" disabled={disabled} onClick={() => onChange(false, false)}>
                <PauseCircle className="me-1.5 h-3.5 w-3.5" />{t('svc_pause_this')}
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory}>
              <History className="me-1.5 h-3.5 w-3.5" />{t('svc_history')}
            </Button>
          </div>
        </div>

        {showHistory ? (
          card.history.length === 0 ? <p className="text-xs text-muted-foreground">{t('svc_history_empty')}</p> : (
            <ol className="space-y-1.5 text-xs">
              {card.history.map((h, i) => (
                <li key={`${h.at}-${i}`} className="rounded-md border px-2.5 py-1.5">
                  <span className="font-medium">{when(h.at)}</span> · {h.by ?? t('svc_system')} · {codeText(h.result ?? h.action)}
                  {h.after ? <> · {t('svc_history_state', { backend: h.after.backend ? t('svc_on') : t('svc_off'), frontend: h.after.frontend ? t('svc_on') : t('svc_off') })}</> : null}
                  {h.reason ? <> — <span className="italic">{h.reason}</span></> : null}
                  {h.missing?.length ? <> — {h.missing.map(codeText).join(', ')}</> : null}
                </li>
              ))}
            </ol>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}

function SwitchRow({ label, hint, checked, disabled, busy, onToggle, testId }: {
  label: string; hint: string; checked: boolean; disabled: boolean; busy: boolean; onToggle: (on: boolean) => void; testId: string;
}) {
  const id = `${testId}-switch`;
  return (
    <div className="flex items-center justify-between gap-3 p-3">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </label>
      <span className="flex shrink-0 items-center gap-2">
        {busy ? <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" /> : null}
        <Switch id={id} data-testid={testId} checked={checked} disabled={disabled} onCheckedChange={onToggle} />
      </span>
    </div>
  );
}
