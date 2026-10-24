// EMAIL STUDIO — Deliverability & compliance (/outreach/email/deliverability). Owner brief §1, §11.
//
// What protects this account's inbox placement, in one place: sender authentication per domain
// (SPF / DKIM / DMARC from the provider's own record status), bounce and complaint rates against
// the thresholds providers act on, the plan allowance, opted-out and suppressed contacts, and the
// rules every campaign passes before it can send. Nothing here is a setting the customer can use
// to weaken those rules; the controls live with the server and the admin. Sender authentication
// is the LIVE check (DeliverabilityHealth: public DNS + provider records), never an assumed "OK".

import { AlertTriangle, CheckCircle2, ExternalLink, Globe, Mail, UserX } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CommsWorkspace, Section } from '@/components/communications/CommsWorkspace';
import { Kpi, KpiRow, PageHeader } from '@/components/communications/primitives';
import { DeliverabilityHealth } from '@/components/emailStudio/DeliverabilityHealth';
import { EmailSettingsTabs } from '@/components/emailStudio/EmailSettingsTabs';
import { pct } from '@/components/emailStudio/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';
import { cn } from '@/lib/utils';
import { rate, type SendTotals, sendFacts, totalsOf } from '@/services/emailCampaignStudio';
import { type EmailPlanView, getEmailPlan } from '@/services/emailMarketing';

/* Thresholds mailbox providers act on (Google/Yahoo bulk-sender rules: complaints < 0.3%,
   aim for < 0.1%; bounces above ~2% damage reputation). */
const BOUNCE_WARN = 0.02;
const COMPLAINT_WARN = 0.001;
const COMPLAINT_LIMIT = 0.003;

export default function EmailDeliverabilityPage() {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [plan, setPlan] = useState<EmailPlanView | null>(null);
  const [totals, setTotals] = useState<SendTotals | null>(null);
  const [optOuts, setOptOuts] = useState<{ unsubscribed: number; suppressed: number; recent: Array<{ email: string | null; unsubscribed_at: string | null; suppressed_reason: string | null }> } | null>(null);

  useEffect(() => {
    void getEmailPlan().then(setPlan).catch(() => setPlan(null));
    void sendFacts(new Date(Date.now() - 30 * 86_400_000).toISOString(), { realOnly: true }).then((f) => setTotals(totalsOf(f))).catch(() => setTotals(null));
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [u, s, recent] = await Promise.all([
        supabase.from('outreach_contacts').select('id', { count: 'exact', head: true }).eq('owner_id', user.id).eq('unsubscribed', true),
        supabase.from('outreach_contacts').select('id', { count: 'exact', head: true }).eq('owner_id', user.id).eq('suppressed', true),
        supabase.from('outreach_contacts').select('email, unsubscribed_at, suppressed_reason').eq('owner_id', user.id).or('unsubscribed.eq.true,suppressed.eq.true')
          .order('updated_at', { ascending: false }).limit(8),
      ]);
      setOptOuts({ unsubscribed: u.count ?? 0, suppressed: s.count ?? 0, recent: (recent.data ?? []) as Array<{ email: string | null; unsubscribed_at: string | null; suppressed_reason: string | null }> });
    })().catch(() => setOptOuts({ unsubscribed: 0, suppressed: 0, recent: [] }));
  }, []);

  const bounce = totals ? rate(totals.bounced, totals.accepted) : null;
  const complaint = totals ? rate(totals.complained, totals.accepted) : null;
  const health = useMemo(() => {
    if (!totals || !totals.accepted) return 'NONE';
    if ((complaint ?? 0) >= COMPLAINT_LIMIT) return 'BAD';
    if ((bounce ?? 0) >= BOUNCE_WARN || (complaint ?? 0) >= COMPLAINT_WARN) return 'WARN';
    return 'GOOD';
  }, [totals, bounce, complaint]);

  return (
    <CommsWorkspace product="email" header={
      <PageHeader eyebrow={t('dnav_email')} title={t('ems_nav_deliverability')} subtitle={t('ems_dl_subtitle')}
        secondary={{ label: t('ems_manage_domains'), onClick: () => navigate('/outreach/email/domains'), icon: Globe }} />
    }>
      <EmailSettingsTabs />
      <div className={cn('flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm', health === 'GOOD' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : health === 'NONE' ? 'bg-muted/40' : health === 'WARN' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-red-200 bg-red-50 text-red-800')} role="status">
        {health === 'GOOD' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
        <p>{t(`ems_dl_health_${health.toLowerCase()}`)}</p>
      </div>

      <KpiRow cols={4}>
        <Kpi labelKey="ems_k_bounce_rate" value={totals ? pct(bounce) : null} sub={t('ems_dl_bounce_target')} loading={!totals} />
        <Kpi labelKey="ems_k_complaint_rate" value={totals ? pct(complaint) : null} sub={t('ems_dl_complaint_target')} loading={!totals} />
        <Kpi labelKey="ems_dl_unsubscribed" value={optOuts ? optOuts.unsubscribed : null} loading={!optOuts} icon={UserX} />
        <Kpi labelKey="ems_dl_allowance" value={plan ? plan.period.remaining.toLocaleString(lang) : null} sub={plan ? t('ems_dl_allowance_sub', { plan: plan.effectivePlan }) : null} loading={!plan} icon={Mail} />
      </KpiRow>

      <DeliverabilityHealth totals={totals} />

      <div className="grid gap-5 lg:grid-cols-2">
        <Section titleKey="ems_dl_rules_title" sub={t('ems_dl_rules_sub')}>
          <ul className="space-y-2 rounded-2xl border bg-card p-4 text-sm">
            {['consent', 'unsubscribe', 'suppression', 'review', 'links', 'prohibited', 'sender', 'limits'].map((k) => (
              <li key={k} className="flex items-start gap-2.5"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /><span>{t(`ems_rule_${k}`)}</span></li>
            ))}
          </ul>
        </Section>
        <Section titleKey="ems_dl_optouts_title" sub={t('ems_dl_optouts_sub')} action={{ label: t('ems_dl_manage_contacts'), onClick: () => navigate('/outreach/email/contacts') }}>
          <div className="rounded-2xl border bg-card p-4">
            {!optOuts ? <Skeleton className="h-20 w-full" /> : optOuts.recent.length === 0 ? <p className="text-sm text-muted-foreground">{t('ems_dl_optouts_none')}</p> : (
              <ul className="divide-y text-sm">
                {optOuts.recent.map((r, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="min-w-0 break-all" dir="ltr">{r.email ?? '—'}</span>
                    <span className="text-2xs text-muted-foreground">{r.suppressed_reason ? t('ems_dl_suppressed') : t('ems_dl_unsubscribed_one')}{r.unsubscribed_at ? ` · ${new Date(r.unsubscribed_at).toLocaleDateString(lang)}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
            {optOuts ? <p className="mt-2 text-2xs text-muted-foreground">{t('ems_dl_suppressed_total', { n: optOuts.suppressed })}</p> : null}
          </div>
        </Section>
      </div>

      <Button variant="outline" className="gap-1.5" onClick={() => navigate('/outreach/email/plan')}><ExternalLink className="h-4 w-4" />{t('ems_dl_plan_link')}</Button>
    </CommsWorkspace>
  );
}
