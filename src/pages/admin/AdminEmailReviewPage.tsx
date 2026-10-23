// HOMATCH — Admin: Email campaign review and governance (/admin/email-review). Owner brief §10, §14.
//
// The manual review queue for Email Studio campaigns, the decision log, and the controls that
// govern email marketing. A decision goes through email_campaign_review_decide (admin-only,
// reason required for anything but approval, written to admin_audit_log, refuses to approve a
// hard prohibition). Settings go through admin_set_setting (audited). No control here can lift a
// hard prohibition: those are code in the Campaign Risk Engine, not settings.

import { CheckCircle2, Loader2, MailCheck, PauseCircle, PencilLine, RefreshCw, ShieldAlert, XCircle } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { EmailPreviewFrame, findingText, PhaseBadge, RiskReport, reasonText } from '@/components/emailStudio/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';
import type { Finding } from '@/emailMarketing/risk/links';
import { extractLinks } from '@/emailMarketing/risk/links';
import { cn } from '@/lib/utils';
import { updateAdminSetting } from '@/services/api';

interface QueueRow {
  id: string; owner_id: string; name: string; subject: string | null; preview_text: string | null; status: string; language: string | null;
  sender_name: string | null; sender_email: string | null; reply_to: string | null; html_body: string | null; text_body: string | null;
  risk_level: string | null; risk_score: number | null; risk_reasons: Finding[] | null; submitted_at: string | null; audience_count: number | null;
  contact_list_ids: string[] | null; contact_list_id: string | null; review_note: string | null; updated_at: string;
}
interface Decision { id: string; campaign_id: string; owner_id: string; action: string; actor_kind: string; reason: string | null; risk_level: string | null; created_at: string }

const QUEUE_STATES = ['UNDER_REVIEW', 'READY_FOR_REVIEW', 'REVIEW_REQUIRED'];
const COLS = 'id, owner_id, name, subject, preview_text, status, language, sender_name, sender_email, reply_to, html_body, text_body, risk_level, risk_score, risk_reasons, submitted_at, audience_count, contact_list_ids, contact_list_id, review_note, updated_at';

export default function AdminEmailReviewPage() {
  const { t, lang } = useLanguage();
  const [queue, setQueue] = useState<QueueRow[] | null>(null);
  const [active, setActive] = useState<QueueRow[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [owners, setOwners] = useState<Map<string, string>>(new Map());
  const [open, setOpen] = useState<QueueRow | null>(null);

  const load = useCallback(async () => {
    const [q, a, d] = await Promise.all([
      supabase.from('outreach_campaigns').select(COLS).eq('campaign_type', 'EMAIL').in('status', QUEUE_STATES).order('submitted_at', { ascending: true }).limit(200),
      supabase.from('outreach_campaigns').select(COLS).eq('campaign_type', 'EMAIL').in('status', ['APPROVED', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLIANCE_PAUSED']).order('updated_at', { ascending: false }).limit(100),
      supabase.from('email_campaign_reviews').select('id, campaign_id, owner_id, action, actor_kind, reason, risk_level, created_at').in('actor_kind', ['ADMIN', 'SYSTEM']).order('created_at', { ascending: false }).limit(100),
    ]);
    const rows = (q.data ?? []) as QueueRow[];
    setQueue(rows); setActive((a.data ?? []) as QueueRow[]); setDecisions((d.data ?? []) as Decision[]);
    const ids = [...new Set([...rows, ...((a.data ?? []) as QueueRow[])].map((r) => r.owner_id).concat(((d.data ?? []) as Decision[]).map((x) => x.owner_id)))];
    if (ids.length) {
      const { data: users } = await supabase.from('users').select('auth_id, email, full_name').in('auth_id', ids);
      setOwners(new Map(((users ?? []) as Array<{ auth_id: string; email: string | null; full_name: string | null }>).map((u) => [u.auth_id, u.full_name || u.email || u.auth_id.slice(0, 8)])));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('ems_admin_title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('ems_admin_subtitle')}</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void load()}><RefreshCw className="h-4 w-4" />{t('ems_refresh')}</Button>
      </div>

      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue">{t('ems_admin_queue')} {queue ? `(${queue.length})` : ''}</TabsTrigger>
          <TabsTrigger value="active">{t('ems_admin_active')}</TabsTrigger>
          <TabsTrigger value="log">{t('ems_admin_log')}</TabsTrigger>
          <TabsTrigger value="governance">{t('ems_admin_governance')}</TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="mt-4">
          {queue === null ? <Skeleton className="h-32 w-full" /> : queue.length === 0 ? (
            <div className="flex items-center gap-2 rounded-xl border bg-card p-6 text-sm text-muted-foreground"><MailCheck className="h-5 w-5" />{t('ems_admin_queue_empty')}</div>
          ) : (
            <ul className="space-y-2">
              {queue.map((r) => <CampaignRowItem key={r.id} r={r} owner={owners.get(r.owner_id)} onOpen={() => setOpen(r)} />)}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="active" className="mt-4">
          {active.length === 0 ? <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">{t('ems_admin_active_empty')}</p> : (
            <ul className="space-y-2">{active.map((r) => <CampaignRowItem key={r.id} r={r} owner={owners.get(r.owner_id)} onOpen={() => setOpen(r)} />)}</ul>
          )}
        </TabsContent>

        <TabsContent value="log" className="mt-4">
          <ul className="divide-y rounded-xl border bg-card">
            {decisions.map((d) => (
              <li key={d.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5 text-sm">
                <span className="font-medium">{t(`ems_rev_${d.action.toLowerCase()}`)}</span>
                <span className="text-[12px] text-muted-foreground">{t(`ems_actor_${d.actor_kind.toLowerCase()}`)} · {owners.get(d.owner_id) ?? d.owner_id.slice(0, 8)}</span>
                <span className="ms-auto text-[12px] text-muted-foreground">{new Date(d.created_at).toLocaleString(lang)}</span>
                {d.reason ? <span className="w-full text-[13px] text-muted-foreground">{reasonText(t, d.reason)}</span> : null}
              </li>
            ))}
            {decisions.length === 0 ? <li className="p-6 text-sm text-muted-foreground">{t('ems_admin_log_empty')}</li> : null}
          </ul>
        </TabsContent>

        <TabsContent value="governance" className="mt-4"><Governance /></TabsContent>
      </Tabs>

      <Sheet open={Boolean(open)} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-3xl">
          {open ? <ReviewDetail row={open} owner={owners.get(open.owner_id)} onDone={() => { setOpen(null); void load(); }} /> : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function CampaignRowItem({ r, owner, onOpen }: { r: QueueRow; owner?: string; onOpen: () => void }) {
  const { t, lang } = useLanguage();
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full flex-wrap items-center gap-3 rounded-xl border bg-card p-3.5 text-start hover:border-foreground/30">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium [overflow-wrap:anywhere]">{r.name}</span><PhaseBadge status={r.status} />
            {r.risk_level ? <Badge variant="outline" className={cn('text-[11px]', r.risk_level === 'HIGH' || r.risk_level === 'BLOCKED' ? 'border-red-300 text-red-700' : r.risk_level === 'MEDIUM' ? 'border-amber-300 text-amber-800' : 'text-emerald-700')}>{t(`ems_level_${r.risk_level.toLowerCase()}`)} · {r.risk_score ?? 0}</Badge> : null}
          </div>
          <p className="text-[13px] text-muted-foreground [overflow-wrap:anywhere]">{r.subject}</p>
        </div>
        <div className="text-end text-[12px] text-muted-foreground">
          <p>{owner ?? r.owner_id.slice(0, 8)}</p>
          <p>{t('ems_admin_recipients', { n: r.audience_count ?? 0 })} · {r.submitted_at ? new Date(r.submitted_at).toLocaleString(lang) : ''}</p>
        </div>
      </button>
    </li>
  );
}

function ReviewDetail({ row, owner, onDone }: { row: QueueRow; owner?: string; onDone: () => void }) {
  const { t, lang } = useLanguage();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [history, setHistory] = useState<Decision[]>([]);
  useEffect(() => {
    void supabase.from('email_campaign_reviews').select('id, campaign_id, owner_id, action, actor_kind, reason, risk_level, created_at').eq('campaign_id', row.id)
      .order('created_at', { ascending: false }).limit(30).then(({ data }) => setHistory((data ?? []) as Decision[]));
  }, [row.id]);
  const links = useMemo(() => extractLinks(row.html_body ?? ''), [row.html_body]);
  const findings = row.risk_reasons ?? [];
  const blocked = row.risk_level === 'BLOCKED';
  const decide = async (decision: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED' | 'PAUSED') => {
    if (decision !== 'APPROVED' && !reason.trim()) { toast.error(t('ems_admin_reason_required')); return; }
    setBusy(decision);
    const { error } = await supabase.rpc('email_campaign_review_decide', { p_campaign: row.id, p_decision: decision, p_reason: reason.trim() || null });
    setBusy(null);
    if (error) { toast.error(/HARD_PROHIBITION/.test(error.message) ? t('ems_admin_hard_prohibition') : t('ems_admin_decide_failed')); return; }
    toast.success(t(`ems_rev_${decision.toLowerCase()}`));
    onDone();
  };
  const inQueue = QUEUE_STATES.includes(row.status) || row.status === 'CHANGES_REQUESTED';
  const pausable = ['APPROVED', 'SCHEDULED', 'RUNNING'].includes(row.status);
  return (
    <div className="space-y-5">
      <SheetHeader><SheetTitle className="pe-8 [overflow-wrap:anywhere]">{row.name}</SheetTitle></SheetHeader>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div><dt className="text-[12px] text-muted-foreground">{t('ems_admin_owner')}</dt><dd>{owner ?? row.owner_id}</dd></div>
        <div><dt className="text-[12px] text-muted-foreground">{t('ems_admin_status')}</dt><dd><PhaseBadge status={row.status} /></dd></div>
        <div><dt className="text-[12px] text-muted-foreground">{t('ems_admin_sender')}</dt><dd dir="ltr" className="break-all">{row.sender_name ?? '—'} &lt;{row.sender_email ?? 'HOMATCH'}&gt;</dd></div>
        <div><dt className="text-[12px] text-muted-foreground">{t('ems_f_reply_to')}</dt><dd dir="ltr" className="break-all">{row.reply_to ?? '—'}</dd></div>
        <div><dt className="text-[12px] text-muted-foreground">{t('ems_admin_recipients_label')}</dt><dd>{row.audience_count ?? 0} · {t('ems_admin_lists', { n: row.contact_list_ids?.length ?? (row.contact_list_id ? 1 : 0) })}</dd></div>
        <div><dt className="text-[12px] text-muted-foreground">{t('ems_admin_risk')}</dt><dd>{row.risk_level ? `${t(`ems_level_${row.risk_level.toLowerCase()}`)} · ${row.risk_score ?? 0}` : '—'}</dd></div>
      </dl>

      <section>
        <h3 className="mb-2 text-sm font-semibold">{t('ems_risk_title')}</h3>
        <RiskReport findings={findings} />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">{t('ems_admin_links', { n: links.length })}</h3>
        {links.length === 0 ? <p className="text-sm text-muted-foreground">{t('ems_admin_no_links')}</p> : (
          <ul className="space-y-1 text-[13px]">
            {links.map((l, i) => {
              const own = findings.filter((f) => f.where === l.url || (f.where ?? '').startsWith(l.url));
              return (
                <li key={i} className="rounded-lg border px-2.5 py-1.5">
                  <p className="break-all font-mono text-[12px]" dir="ltr">{l.url}</p>
                  {l.text ? <p className="text-[12px] text-muted-foreground">{t('ems_admin_link_text')}: {l.text}</p> : null}
                  {own.map((f, j) => <p key={j} className="text-[12px] text-red-700">{findingText(t, f)}</p>)}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <EmailPreviewFrame subject={row.subject ?? row.name} html={row.html_body} text={row.text_body} senderName={row.sender_name} language={row.language} previewText={row.preview_text} />

      <section className="space-y-2 rounded-xl border bg-muted/30 p-3.5">
        <Label htmlFor="ems-reason" className="text-sm font-semibold">{t('ems_admin_reason')}</Label>
        <Textarea id="ems-reason" rows={3} value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} placeholder={t('ems_admin_reason_placeholder')} />
        {blocked ? <p className="flex items-center gap-1.5 text-[13px] text-red-700"><ShieldAlert className="h-4 w-4" />{t('ems_admin_hard_prohibition')}</p> : null}
        <div className="flex flex-wrap gap-2">
          {inQueue ? (
            <>
              <Button className="gap-1.5 bg-emerald-700 text-white hover:bg-emerald-800" disabled={Boolean(busy) || blocked} onClick={() => void decide('APPROVED')}>
                {busy === 'APPROVED' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}{t('ems_admin_approve')}
              </Button>
              <Button variant="outline" className="gap-1.5" disabled={Boolean(busy)} onClick={() => void decide('CHANGES_REQUESTED')}><PencilLine className="h-4 w-4" />{t('ems_admin_request_changes')}</Button>
              <Button variant="outline" className="gap-1.5 border-red-300 text-red-700 hover:bg-red-50" disabled={Boolean(busy)} onClick={() => void decide('REJECTED')}><XCircle className="h-4 w-4" />{t('ems_admin_reject')}</Button>
            </>
          ) : null}
          {pausable ? <Button variant="outline" className="gap-1.5" disabled={Boolean(busy)} onClick={() => void decide('PAUSED')}><PauseCircle className="h-4 w-4" />{t('ems_admin_pause')}</Button> : null}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">{t('ems_history_title')}</h3>
        <ol className="space-y-1.5 text-sm">
          {history.map((h) => (
            <li key={h.id}><span className="font-medium">{t(`ems_rev_${h.action.toLowerCase()}`)}</span> <span className="text-[12px] text-muted-foreground">· {t(`ems_actor_${h.actor_kind.toLowerCase()}`)} · {new Date(h.created_at).toLocaleString(lang)}</span>{h.reason ? <p className="text-[13px] text-muted-foreground">{reasonText(t, h.reason)}</p> : null}</li>
          ))}
        </ol>
      </section>
    </div>
  );
}

const SETTING_KEYS = ['email_review_policy', 'email_marketing_live', 'email_studio_sending_enabled', 'outreach_email_sending_enabled',
  'email_marketing_provider_daily_cap', 'email_marketing_provider_monthly_cap', 'email_marketing_tenant_daily_cap', 'provider_kill_switch'];

function Governance() {
  const { t } = useLanguage();
  const [s, setS] = useState<Record<string, unknown> | null>(null);
  const [caps, setCaps] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data } = await supabase.from('admin_settings').select('key, value').in('key', SETTING_KEYS);
    const m = Object.fromEntries(((data ?? []) as Array<{ key: string; value: unknown }>).map((r) => [r.key, r.value]));
    setS(m);
    setCaps({ daily: String(m.email_marketing_provider_daily_cap ?? ''), monthly: String(m.email_marketing_provider_monthly_cap ?? ''), tenant: String(m.email_marketing_tenant_daily_cap ?? '') });
  }, []);
  useEffect(() => { void load(); }, [load]);
  const set = async (key: string, value: unknown) => {
    const reason = window.prompt(t('ems_admin_setting_reason'));
    if (!reason?.trim()) return;
    setBusy(key);
    try { await updateAdminSetting(key, value, reason.trim()); toast.success(t('ems_admin_saved')); await load(); }
    catch { toast.error(t('ems_admin_save_failed')); } finally { setBusy(null); }
  };
  if (!s) return <Skeleton className="h-48 w-full" />;
  const truthy = (v: unknown) => v === true || v === 'true';
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold">{t('ems_admin_policy')}</h3>
        <p className="text-[13px] text-muted-foreground">{t('ems_admin_policy_sub')}</p>
        <div className="flex flex-col gap-2">
          {(['MANUAL_ALL', 'AUTO_LOW_RISK'] as const).map((p) => (
            <button key={p} type="button" disabled={Boolean(busy)} onClick={() => s.email_review_policy !== p && void set('email_review_policy', p)}
              className={cn('rounded-lg border p-3 text-start', s.email_review_policy === p ? 'border-[#0C1119] ring-1 ring-[#0C1119]' : 'hover:border-foreground/40')}>
              <p className="text-sm font-medium">{t(`ems_policy_${p.toLowerCase()}`)}</p>
              <p className="text-[12px] text-muted-foreground">{t(`ems_policy_${p.toLowerCase()}_sub`)}</p>
            </button>
          ))}
        </div>
        <p className="text-[12px] text-muted-foreground">{t('ems_admin_hard_rules_note')}</p>
      </section>

      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold">{t('ems_admin_switches')}</h3>
        {['email_marketing_live', 'email_studio_sending_enabled', 'outreach_email_sending_enabled'].map((k) => (
          <label key={k} className="flex items-center justify-between gap-3 text-sm">
            <span><span className="font-medium">{t(`ems_set_${k}`)}</span><span className="block text-[12px] text-muted-foreground">{t(`ems_set_${k}_sub`)}</span></span>
            <Switch checked={truthy(s[k])} disabled={Boolean(busy)} onCheckedChange={(v) => void set(k, v)} />
          </label>
        ))}
        <p className="rounded-lg bg-muted/50 p-2.5 text-[12px] text-muted-foreground">{t('ems_admin_kill_note', { state: truthy(s.provider_kill_switch) ? t('ems_on') : t('ems_off') })}</p>
      </section>

      <section className="space-y-3 rounded-xl border bg-card p-4 lg:col-span-2">
        <h3 className="text-sm font-semibold">{t('ems_admin_limits')}</h3>
        <p className="text-[13px] text-muted-foreground">{t('ems_admin_limits_sub')}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {([['daily', 'email_marketing_provider_daily_cap'], ['monthly', 'email_marketing_provider_monthly_cap'], ['tenant', 'email_marketing_tenant_daily_cap']] as const).map(([k, key]) => (
            <div key={k} className="space-y-1">
              <Label htmlFor={`cap-${k}`} className="text-[13px]">{t(`ems_cap_${k}`)}</Label>
              <div className="flex gap-1.5">
                <Input id={`cap-${k}`} type="number" min={0} value={caps[k] ?? ''} onChange={(e) => setCaps((c) => ({ ...c, [k]: e.target.value }))} />
                <Button variant="outline" disabled={Boolean(busy) || caps[k] === String(s[key] ?? '') || !(Number(caps[k]) >= 0)} onClick={() => void set(key, Math.floor(Number(caps[k])))}>{t('ems_save')}</Button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
