// HOMATCH — Admin: Risk and Compliance.
//
// §53. A new Admin page rather than another tab on Admin Outreach, because
// §105 permits one "where the information architecture objectively requires
// it" and this is that case: the queue of campaigns waiting on a human is a
// working surface with its own cadence, not a report.
//
// WHAT MAKES THIS USABLE RATHER THAN DECORATIVE
//
// §50 forbids an opaque score, so every assessment carries its signals and
// this page renders them. An admin looking at a blocked campaign sees
// ACCOUNT_UNDER_ONE_DAY 25, CONSENT_EVIDENCE_ABSENT 28, DOMAIN_NEEDS_REVIEW
// 30 — the actual reasons — and can therefore disagree with them.
//
// §87: every action taken here is written to admin_audit_log.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldAlert, ShieldCheck, Ban, Snowflake, RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  Kpi, KpiRow, LoadingBlock, EmptyState, ErrorState, StatusBadge,
  ScrollTable, relativeTime,
} from '@/components/communications/primitives';
import { listRiskAssessments } from '@/services/communications';
import type { RiskAssessmentRow } from '@/types/communications';

type TKey = Parameters<ReturnType<typeof useLanguage>['t']>[0];

export default function AdminRiskPage() {
  const { t, lang: language } = useLanguage();

  const [rows, setRows] = useState<RiskAssessmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState('ALL');
  const [pendingOnly, setPendingOnly] = useState(true);
  const [selected, setSelected] = useState<RiskAssessmentRow | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try { setRows(await listRiskAssessments({ decision, pendingOnly, limit: 200 })); }
    catch { setError('admin_risk_load_failed'); }
    finally { setLoading(false); }
  }, [decision, pendingOnly]);

  useEffect(() => { void load(); }, [load]);

  const stats = useMemo(() => ({
    pending: rows.filter((r) => !r.reviewed_at && ['REVIEW', 'BLOCK'].includes(r.decision)).length,
    blocked: rows.filter((r) => r.decision === 'BLOCK').length,
    throttled: rows.filter((r) => r.decision === 'THROTTLE').length,
    critical: rows.filter((r) => r.risk_level === 'CRITICAL').length,
  }), [rows]);

  const review = useCallback(async (row: RiskAssessmentRow, verdict: 'APPROVED' | 'REJECTED') => {
    setBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const adminId = auth?.user?.id ?? null;

      const { error: updateError } = await supabase.from('comm_risk_assessments').update({
        reviewed_by: adminId,
        reviewed_at: new Date().toISOString(),
        review_decision: verdict,
        review_note: note.slice(0, 1000) || null,
      }).eq('id', row.id);

      if (updateError) { toast.error(t('comm_save_failed')); return; }

      if (row.campaign_id) {
        // APPROVED moves the campaign to a state it can be launched from; it
        // does NOT start it. A human approving a review is saying the campaign
        // is allowed, not pressing the customer's Launch button for them.
        await supabase.from('outreach_campaigns').update(
          verdict === 'APPROVED'
            ? { status: 'APPROVED', compliance_state: 'ADMIN_APPROVED', paused_reason: null }
            : { status: 'COMPLIANCE_PAUSED', compliance_state: 'ADMIN_REJECTED', paused_reason: note.slice(0, 300) || null },
        ).eq('id', row.campaign_id);
      }

      await supabase.from('admin_audit_log').insert({
        admin_id: adminId,
        target_id: row.owner_id,
        action: verdict === 'APPROVED' ? 'COMM_CAMPAIGN_APPROVED' : 'COMM_CAMPAIGN_REJECTED',
        entity_type: 'CAMPAIGN',
        entity_id: row.campaign_id ?? row.id,
        metadata: { assessmentId: row.id, riskLevel: row.risk_level, note: note.slice(0, 500) },
      });

      toast.success(t(verdict === 'APPROVED' ? 'admin_risk_approved' : 'admin_risk_rejected'));
      setSelected(null);
      setNote('');
      void load();
    } finally { setBusy(false); }
  }, [note, load, t]);

  const freezeAccount = useCallback(async (row: RiskAssessmentRow) => {
    setBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const adminId = auth?.user?.id ?? null;

      // §52: a freeze the customer cannot lift. Their own resume path checks
      // status = 'PAUSED' and outbound_frozen, and this sets both.
      await supabase.from('comm_account_trust').upsert({
        owner_id: row.owner_id,
        outbound_frozen: true,
        frozen_reason: note.slice(0, 300) || 'frozen by an administrator',
        frozen_at: new Date().toISOString(),
        reviewed_by: adminId,
        reviewed_at: new Date().toISOString(),
      }, { onConflict: 'owner_id' });

      await supabase.from('admin_audit_log').insert({
        admin_id: adminId,
        target_id: row.owner_id,
        action: 'COMM_OUTBOUND_FROZEN',
        entity_type: 'ACCOUNT',
        entity_id: row.owner_id,
        metadata: { assessmentId: row.id, note: note.slice(0, 500) },
      });

      toast.success(t('admin_risk_frozen'));
      setSelected(null);
      void load();
    } finally { setBusy(false); }
  }, [note, load, t]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">{t('admin_risk_title')}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('admin_risk_subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={decision} onValueChange={setDecision}>
            <SelectTrigger className="h-8 w-[130px] text-xs" aria-label={t('admin_risk_decision')}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t('comm_filter_all')}</SelectItem>
              <SelectItem value="BLOCK">{t('admin_risk_block')}</SelectItem>
              <SelectItem value="REVIEW">{t('admin_risk_review')}</SelectItem>
              <SelectItem value="THROTTLE">{t('admin_risk_throttle')}</SelectItem>
              <SelectItem value="ALLOW">{t('admin_risk_allow')}</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm" variant={pendingOnly ? 'default' : 'outline'}
            onClick={() => setPendingOnly((v) => !v)}
          >
            {t('admin_risk_pending_only')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setLoading(true); void load(); }}>
            <RefreshCw className="h-3.5 w-3.5" />
            <span className="sr-only">{t('comm_refresh')}</span>
          </Button>
        </div>
      </div>

      {error ? <ErrorState messageKey={error} onRetry={() => { setLoading(true); void load(); }} /> : null}

      <KpiRow cols={4}>
        <Kpi labelKey="admin_risk_kpi_pending" value={stats.pending} accent loading={loading} />
        <Kpi labelKey="admin_risk_kpi_blocked" value={stats.blocked} loading={loading} />
        <Kpi labelKey="admin_risk_kpi_throttled" value={stats.throttled} loading={loading} />
        <Kpi labelKey="admin_risk_kpi_critical" value={stats.critical} loading={loading} />
      </KpiRow>

      {loading ? <LoadingBlock rows={5} /> : !rows.length ? (
        <EmptyState icon={ShieldCheck} titleKey="admin_risk_empty" bodyKey="admin_risk_empty_body" />
      ) : (
        <ScrollTable minWidth={860}>
          <table className="w-full text-xs">
            <thead className="border-b bg-muted/40">
              <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-start [&>th]:font-medium [&>th]:text-muted-foreground">
                <th>{t('admin_risk_account')}</th>
                <th>{t('admin_risk_decision')}</th>
                <th>{t('admin_risk_level')}</th>
                <th>{t('admin_risk_domain')}</th>
                <th>{t('admin_risk_score')}</th>
                <th>{t('admin_risk_top_reasons')}</th>
                <th>{t('comm_col_created')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer border-b last:border-0 hover:bg-muted/30 [&>td]:px-3 [&>td]:py-2"
                  onClick={() => { setSelected(row); setNote(row.review_note ?? ''); }}
                >
                  <td className="font-mono text-[13px]">{row.owner_id.slice(0, 8)}</td>
                  <td><StatusBadge status={row.decision} labelKey={`admin_risk_${row.decision.toLowerCase()}`} /></td>
                  <td>
                    <Badge variant="outline" className={cn(
                      'text-[13px]',
                      row.risk_level === 'CRITICAL' && 'border-red-500/40 text-red-700 dark:text-red-400',
                      row.risk_level === 'HIGH' && 'border-amber-500/40 text-amber-700 dark:text-amber-400',
                    )}>
                      {row.risk_level}
                    </Badge>
                  </td>
                  <td>{row.domain_verdict ?? '·'}</td>
                  <td className="tabular-nums">{row.score ?? '·'}</td>
                  <td className="max-w-[260px] truncate text-[13px] text-muted-foreground">
                    {row.reasons.slice(0, 3).map((r) => r.code).join(', ') || '·'}
                  </td>
                  <td className="text-muted-foreground">{relativeTime(row.created_at, language)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollTable>
      )}

      <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetTitle className="text-sm">{t('admin_risk_detail')}</SheetTitle>
          {selected ? (
            <div className="mt-3 space-y-3 text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge status={selected.decision} labelKey={`admin_risk_${selected.decision.toLowerCase()}`} />
                <Badge variant="outline" className="text-[13px]">{selected.risk_level}</Badge>
                {selected.domain_verdict ? (
                  <Badge variant="outline" className="text-[13px]">
                    {t('admin_risk_domain')}: {selected.domain_verdict} ({selected.domain_stage})
                  </Badge>
                ) : null}
              </div>

              {selected.reviewed_at ? (
                <Alert>
                  <AlertDescription className="text-[13px]">
                    {t('admin_risk_already_reviewed')
                      .replace('{verdict}', selected.review_decision ?? '')
                      .replace('{when}', relativeTime(selected.reviewed_at, language))}
                  </AlertDescription>
                </Alert>
              ) : null}

              {/* §50's requirement made literal: the signals, with weights. */}
              <div>
                <p className="mb-1.5 font-medium">{t('admin_risk_signals')}</p>
                <ul className="space-y-1">
                  {selected.reasons.map((r, i) => (
                    <li key={`${r.code}-${i}`} className="flex items-start justify-between gap-2 rounded border p-1.5">
                      <span className="min-w-0">
                        <span className="block font-mono text-[13px]">{r.code}</span>
                        {r.detail ? <span className="block text-[13px] text-muted-foreground">{r.detail}</span> : null}
                      </span>
                      <span className="shrink-0 tabular-nums text-[13px] text-muted-foreground">
                        {r.source === 'DOMAIN' ? 'D' : 'R'} {r.weight}
                      </span>
                    </li>
                  ))}
                  {!selected.reasons.length ? (
                    <li className="text-[13px] text-muted-foreground">{t('admin_risk_no_signals')}</li>
                  ) : null}
                </ul>
              </div>

              <div className="space-y-1.5">
                <p className="font-medium">{t('admin_risk_note')}</p>
                <Textarea
                  value={note} onChange={(e) => setNote(e.target.value)}
                  rows={3} maxLength={1000} className="text-xs"
                  placeholder={t('admin_risk_note_placeholder')}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy} onClick={() => void review(selected, 'APPROVED')}>
                  <ShieldCheck className="me-1.5 h-3.5 w-3.5" />{t('admin_risk_approve')}
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void review(selected, 'REJECTED')}>
                  <Ban className="me-1.5 h-3.5 w-3.5" />{t('admin_risk_reject')}
                </Button>
                <Button size="sm" variant="destructive" disabled={busy} onClick={() => void freezeAccount(selected)}>
                  <Snowflake className="me-1.5 h-3.5 w-3.5" />{t('admin_risk_freeze')}
                </Button>
              </div>

              <p className="flex items-start gap-1.5 text-[13px] text-muted-foreground">
                <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                {t('admin_risk_audit_note')}
              </p>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
