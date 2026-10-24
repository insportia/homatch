// HOMATCH INVESTMENT — "შედეგის შენახვა": a named result to come back to on any device.
//
// Saving stores the strategy and the inputs (what the investor entered or accepted) with the
// headline figures as they were. Opening one puts those inputs back into the workspace, where
// the same engine recomputes everything: a saved result is a bookmark, never a second engine.

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bookmark, FolderOpen, Trash2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { InvestmentContext } from '@/investment/consultant/context';
import { STRATEGIES, type StrategyId } from '@/investment/strategies/definitions';
import { summarySlots } from '@/investment/strategies/summary';
import type { StrategyRun } from '@/investment/strategies/run';
import { deleteResult, listSavedResults, saveResult, type SavedInvestmentResult } from '@/services/investmentResults';
import { formatMoney, formatPercent, intlLocaleFor } from './primitives';

const pill = 'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors';

export function SaveResultBar({ run, strategy, context }: { run: StrategyRun | null; strategy: StrategyId; context: InvestmentContext }) {
  const { t } = useLanguage();
  const { homatchUser } = useAuth();
  const navigate = useNavigate();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'saved' | 'failed'>('idle');
  if (!run) return null;

  const save = async () => {
    if (!homatchUser) return;
    setState('busy');
    try {
      await saveResult({
        userId: homatchUser.id, name: name || t('inv_saved_default_name'), strategy, context,
        summary: summarySlots(run).map((s) => ({ labelKey: s.labelKey, value: s.figure.value, kind: s.kind })),
        currency: run.model?.currency ?? null,
      });
      setState('saved'); setNaming(false); setName('');
      window.dispatchEvent(new Event('homatch:investment-saved'));
    } catch { setState('failed'); }
  };

  return (
    <div className="hm-invest-panel flex flex-wrap items-center gap-2 p-4" data-testid="inv-save-result">
      {!homatchUser ? (
        <button type="button" className={cn(pill, 'border-[hsl(var(--gold-border))]')} onClick={() => navigate('/auth/login?next=/investment')}>
          <Bookmark className="h-4 w-4" aria-hidden="true" />{t('inv_saved_sign_in')}
        </button>
      ) : naming ? (
        <div className="flex w-full flex-wrap items-end gap-2" role="group" aria-label={t('inv_saved_save')}>
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-sm font-medium text-foreground">{t('inv_saved_name')}</span>
            <input autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={t('inv_saved_default_name')}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void save(); } }}
              className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-[hsl(var(--gold))]" />
          </label>
          <button type="button" onClick={() => void save()} disabled={state === 'busy'} className={cn(pill, 'border-[hsl(var(--gold))] bg-[hsl(var(--gold))] text-[hsl(var(--primary-foreground))]')}>{t('inv_saved_save')}</button>
          <button type="button" onClick={() => setNaming(false)} className={cn(pill, 'border-border')}>{t('inv_saved_cancel')}</button>
        </div>
      ) : (
        <button type="button" onClick={() => { setNaming(true); setState('idle'); }} className={cn(pill, 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]')}>
          <Bookmark className="h-4 w-4" aria-hidden="true" />{t('inv_saved_save')}
        </button>
      )}
      {state === 'saved' ? <p role="status" className="text-sm text-emerald-700">{t('inv_saved_done')}</p> : null}
      {state === 'failed' ? <p role="alert" className="text-sm text-[hsl(var(--destructive))]">{t('inv_saved_failed')}</p> : null}
    </div>
  );
}

export function SavedResultsList({ onOpen }: { onOpen: (r: SavedInvestmentResult) => void }) {
  const { t, lang } = useLanguage();
  const { homatchUser } = useAuth();
  const locale = intlLocaleFor(lang);
  const [rows, setRows] = useState<SavedInvestmentResult[] | null>(null);
  const [confirm, setConfirm] = useState<SavedInvestmentResult | null>(null);
  const load = useCallback(() => { if (homatchUser) listSavedResults().then(setRows).catch(() => setRows([])); }, [homatchUser]);
  useEffect(() => {
    load();
    window.addEventListener('homatch:investment-saved', load);
    return () => window.removeEventListener('homatch:investment-saved', load);
  }, [load]);
  if (!homatchUser || !rows || rows.length === 0) return null;

  const figure = (s: SavedInvestmentResult['summary'][number], currency: string | null) =>
    s.value === null ? '' : s.kind === 'money' ? formatMoney(s.value, currency ?? 'USD', locale) : s.kind === 'percent' ? formatPercent(s.value, locale, 1) : String(Math.round(s.value * 10) / 10);

  return (
    <section aria-labelledby="inv-saved-title" className="hm-invest-panel mb-6 p-5" data-testid="inv-saved-list">
      <h2 id="inv-saved-title" className="font-display text-lg font-semibold text-foreground">{t('inv_saved_title')}</h2>
      <ul className="mt-3 grid gap-2">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-background p-3">
            <div className="min-w-0">
              <p className="font-medium text-foreground">{r.name}</p>
              <p className="text-xs text-muted-foreground">
                {STRATEGIES[r.strategy] ? t(STRATEGIES[r.strategy].titleKey) : ''}
                {' · '}{new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(r.createdAt))}
                {r.summary[0] ? ` · ${t(r.summary[0].labelKey)} ${figure(r.summary[0], r.currency)}` : ''}
              </p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => onOpen(r)} className={cn(pill, 'border-border')}><FolderOpen className="h-4 w-4" aria-hidden="true" />{t('inv_saved_open')}</button>
              <button type="button" onClick={() => setConfirm(r)} aria-label={t('inv_saved_delete')} className={cn(pill, 'border-border px-3')}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
            </div>
          </li>
        ))}
      </ul>
      <AlertDialog open={confirm !== null} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('inv_saved_delete_title')}</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.name}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('inv_saved_cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={async (e) => { e.preventDefault(); if (confirm) { await deleteResult(confirm.id).catch(() => {}); setConfirm(null); load(); } }}>{t('inv_saved_delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
