// FIND BUYERS — "Take Your Research Further".
//
// The owner picks a new TOTAL research budget for the running campaign; only the
// difference is authorised (100 → 500 asks for 400), as its own reservation that the
// campaign settles at the end for what it actually used. Findings already saved stay.

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Loader2, Telescope, Wallet } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import {
  extendResearchBudget, getResearchBudget, newUnlockKey, RESEARCH_PRESETS, UnlockError, type ResearchBudget,
} from '@/services/homatchLeads';
import { researchExtension } from '@/leads/leadSummary';
import { BTN_PRIMARY, BTN_SECONDARY, SURFACE } from '@/components/leads/kit';
import { formatCreditsLabel } from '@/components/leads/LeadCard';
import { PRESET_COPY } from './ResearchBudgetSelector';

/** The product's minimum useful step (FIND_CLIENTS min_viable_budget_credits). */
const MIN_STEP = 50;

export function ResearchExtensionDialog({
  open, propertyId, jobId, onClose, onExtended, onViewResults,
}: {
  open: boolean;
  propertyId: string;
  jobId: string;
  onClose: () => void;
  onExtended: (totalCredits: number) => void;
  onViewResults?: () => void;
}) {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [budget, setBudget] = useState<ResearchBudget | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [custom, setCustom] = useState('');
  const [step, setStep] = useState<'CHOOSE' | 'REVIEW'>('CHOOSE');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useMemo(() => (open ? newUnlockKey().replace('ilu:', 'fbx:') : ''), [open]);
  const cr = (n: number) => formatCreditsLabel(n, lang);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setBudget(null); setTotal(null); setStep('CHOOSE'); setError(null); setCustom('');
    getResearchBudget(jobId).then((b) => {
      if (!alive) return;
      setBudget(b);
      setTotal(b.presets.find((p) => p > b.totalCredits) ?? null);
    }).catch(() => { if (alive) setError('LOAD_FAILED'); });
    return () => { alive = false; };
  }, [open, jobId]);

  const current = budget?.totalCredits ?? 0;
  const chosenTotal = custom ? Number(custom.replace(/[\s,]/g, '')) : total ?? 0;
  const ext = researchExtension(current, chosenTotal, { max: budget?.maxCredits ?? 100000, balance: budget?.balance ?? null, minStep: MIN_STEP });

  async function confirm() {
    setBusy(true); setError(null);
    try {
      const r = await extendResearchBudget(propertyId, jobId, chosenTotal, key);
      onExtended(r.totalCredits);
    } catch (e) {
      setError(e instanceof UnlockError ? e.code : 'REFUSED');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-[90dvh] max-w-[calc(100%-2rem)] overflow-y-auto bg-white sm:max-w-lg [&>*]:min-w-0" data-testid="research-extension">
        <DialogHeader>
          <span className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl bg-[hsl(var(--gold-soft))] ring-1 ring-inset ring-[hsl(var(--gold-border))]">
            <Telescope className="h-5 w-5 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
          </span>
          <DialogTitle className="font-display text-lg">{t('rb_ext_heading')}</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-[hsl(224_14%_28%)]">{t('rb_ext_description')}</DialogDescription>
        </DialogHeader>

        {!budget ? (
          <div className="flex justify-center py-8">{error ? <p className="text-sm text-[hsl(0_55%_38%)]">{t('hl_error_generic')}</p> : <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--gold-ink))]" />}</div>
        ) : budget.finished ? (
          <p className="rounded-xl bg-[hsl(42_60%_97%)] px-3 py-3 text-sm">{t('rb_ext_finished')}</p>
        ) : step === 'CHOOSE' ? (
          <div className="space-y-3">
            <p className="text-sm">{t('rb_ext_current', { n: cr(current) })}</p>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t('rb_selector_title')}>
              {(budget.presets.length ? budget.presets : [...RESEARCH_PRESETS]).filter((p) => p > current).map((p) => {
                const on = !custom && total === p;
                return (
                  <button key={p} type="button" role="radio" aria-checked={on} onClick={() => { setCustom(''); setTotal(p); }}
                    className={cn(SURFACE, 'flex items-start gap-2 p-3 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)]', on && 'ring-2 ring-[hsl(38_92%_54%)]')}>
                    <span className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border', on ? 'border-[hsl(38_92%_44%)] bg-[hsl(38_92%_54%)]' : 'border-[hsl(var(--border))]')} aria-hidden="true">
                      {on ? <Check className="h-3.5 w-3.5 text-[#161309]" /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-display font-bold tabular-nums" dir="ltr">{t('hl_credits_n', { n: cr(p) })}</span>
                      <span className="block text-xs font-semibold text-[hsl(var(--gold-ink))]">{t((PRESET_COPY[p] ?? ['rb_custom_name'])[0])}</span>
                      <span className="block text-xs text-[hsl(224_14%_30%)]">{t('rb_ext_additional', { n: cr(p - current) })}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <label className="block">
              <span className="text-sm font-semibold">{t('rb_custom_name')}</span>
              <input inputMode="numeric" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={t('rb_ext_custom_placeholder')}
                className="mt-1 min-h-11 w-full rounded-xl border border-[hsl(var(--border))] px-3 text-base font-semibold tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)]" />
            </label>
            {ext.problem && chosenTotal > 0 ? (
              <p role="alert" className="text-sm text-[hsl(0_55%_38%)]">{t(`rb_ext_problem_${ext.problem.toLowerCase()}`, { n: cr(MIN_STEP) })}</p>
            ) : null}
            <p className="text-xs leading-relaxed text-[hsl(224_14%_30%)]">{t('rb_ext_reassurance')}</p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {onViewResults ? <button type="button" className={BTN_SECONDARY} onClick={onViewResults}>{t('rb_cta_view_results')}</button> : null}
              <button type="button" className={BTN_PRIMARY} disabled={ext.problem != null} onClick={() => setStep('REVIEW')}>{t('rb_cta_review')}</button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <dl className="divide-y divide-[hsl(var(--border))] rounded-xl border border-[hsl(var(--border))] text-sm">
              <div className="flex justify-between gap-3 px-3 py-2.5"><dt>{t('rb_ext_review_current')}</dt><dd className="tabular-nums" dir="ltr">{cr(current)}</dd></div>
              <div className="flex justify-between gap-3 px-3 py-2.5"><dt>{t('rb_ext_review_new_total')}</dt><dd className="font-semibold tabular-nums" dir="ltr">{cr(chosenTotal)}</dd></div>
              <div className="flex justify-between gap-3 bg-[hsl(42_60%_97%)] px-3 py-3"><dt className="font-semibold">{t('rb_ext_review_additional')}</dt>
                <dd className="font-display text-lg font-bold tabular-nums text-[hsl(var(--gold-ink))]" dir="ltr">{t('hl_credits_n', { n: cr(ext.additional) })}</dd></div>
            </dl>
            {budget.balance != null ? <p className="flex items-center gap-1.5 text-xs text-[hsl(224_14%_30%)]"><Wallet className="h-3.5 w-3.5" aria-hidden="true" />{t('hl_bulk_balance', { n: cr(budget.balance) })}</p> : null}
            <p className="text-xs leading-relaxed text-[hsl(224_14%_30%)]">{t('rb_ext_reassurance')}</p>
            {error ? (
              <p role="alert" className="rounded-lg bg-[hsl(0_60%_97%)] px-3 py-2 text-sm text-[hsl(0_55%_34%)]">
                {t(error === 'INSUFFICIENT_CREDITS' ? 'hl_error_credits' : error === 'CAMPAIGN_FINISHED' ? 'rb_ext_finished' : 'hl_error_generic')}
              </p>
            ) : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className={BTN_SECONDARY} onClick={() => setStep('CHOOSE')} disabled={busy}>{t('rb_cta_review_back')}</button>
              {error === 'INSUFFICIENT_CREDITS' ? (
                <button type="button" className={BTN_PRIMARY} onClick={() => navigate('/credits')}><Wallet className="h-4 w-4" aria-hidden="true" />{t('hl_top_up')}</button>
              ) : (
                <button type="button" className={BTN_PRIMARY} onClick={confirm} disabled={busy} data-testid="rb-expand-confirm">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Telescope className="h-4 w-4" aria-hidden="true" />}{t('rb_cta_expand')}
                </button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
