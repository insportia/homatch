// HOMATCH HOME FINANCING — "ჩემი იპოთეკები".
//
// Save a calculation under a name, come back to it, change it, copy it,
// compare two, delete one. Not a CRM: one list, one card per scenario,
// actions on the card. Every saved figure is the snapshot taken when it
// was saved; reopening recalculates live with today's rules, and saving
// that adds a new version rather than overwriting the old one.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Copy, FolderOpen, History, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { formatMoney, formatPercent, intlLocaleFor } from '@/components/workspace/primitives';
import { deleteMortgageScenario, getMyMortgageScenarios, saveMortgageScenario } from '@/services/mortgageApi';
import { MORTGAGE_ENGINE_VERSION, chainRowIds, isStale, toChains, type ScenarioChain } from '@/mortgage/workspace';
import type { AffordabilityResult, MortgageCalculationResult, MortgageInput, MortgageScenario } from '@/mortgage/types';
import type { FinancingDraft } from './useFinancingSession';
import { useMortgageAsk } from './askConsultant';

type StoredInput = MortgageInput & { draft?: Partial<FinancingDraft> };

const btn = 'inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:border-[hsl(var(--gold-border))]';
const goldBtn = 'inline-flex min-h-11 items-center gap-1.5 rounded-full bg-[hsl(var(--gold))] px-5 text-sm font-semibold text-[hsl(var(--primary-foreground))] transition-colors hover:bg-[hsl(var(--gold-hover))] disabled:cursor-not-allowed disabled:opacity-60';

export function MortgageWorkspace({
  userId,
  draft,
  input,
  result,
  affordability,
  activeRuleIds,
  onOpenDraft,
  onNew,
}: {
  userId: string | null;
  draft: FinancingDraft;
  input: MortgageInput | null;
  result: MortgageCalculationResult | null;
  affordability: AffordabilityResult | null;
  /** Ids of the rules in force now, or null while they load. */
  activeRuleIds: string[] | null;
  onOpenDraft: (draft: Partial<FinancingDraft>) => void;
  onNew: () => void;
}) {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const { ask, available } = useMortgageAsk();
  const locale = intlLocaleFor(lang);
  const [rows, setRows] = useState<MortgageScenario[] | null>(null);
  const [openChain, setOpenChain] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<'saved' | 'failed' | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<ScenarioChain | null>(null);

  const reload = useCallback(async () => {
    if (!userId) return;
    setRows(await getMyMortgageScenarios(userId));
  }, [userId]);
  useEffect(() => { void reload(); }, [reload]);

  const chains = useMemo(() => (rows ? toChains(rows) : []), [rows]);
  const current = chains.find((c) => c.rootId === openChain) ?? null;
  const money = (v: number, currency: string) => formatMoney(v, currency, locale);
  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

  const save = async (mode: 'new' | 'changes') => {
    if (!userId || !input || !result) return;
    setBusy(true);
    const saved = await saveMortgageScenario({
      userId,
      input: { ...input, draft } as StoredInput,
      result: { ...result, amortizationSchedule: [] },
      affordability,
      ruleVersionIds: activeRuleIds ?? [],
      supersedesScenarioId: mode === 'changes' && current ? current.latest.id : null,
      label: mode === 'changes' && current ? current.name : name.trim() || null,
      engineVersion: MORTGAGE_ENGINE_VERSION,
    });
    setBusy(false);
    setNotice(saved ? 'saved' : 'failed');
    if (saved) {
      setNaming(false);
      setName('');
      await reload();
      if (mode === 'new') setOpenChain(saved.id);
    }
  };

  const duplicate = async (chain: ScenarioChain) => {
    if (!userId) return;
    setBusy(true);
    const { latest } = chain;
    await saveMortgageScenario({
      userId,
      propertyId: latest.propertyId ?? null,
      input: latest.input,
      result: latest.result,
      affordability: latest.affordability ?? null,
      ruleVersionIds: latest.ruleVersionIds,
      label: t('mortgage_ws_copy_name', { name: chain.name ?? t('mortgage_ws_untitled') }),
      engineVersion: MORTGAGE_ENGINE_VERSION,
    });
    setBusy(false);
    await reload();
  };

  const remove = async (chain: ScenarioChain) => {
    setBusy(true);
    for (const id of chainRowIds(chain)) await deleteMortgageScenario(id);
    setBusy(false);
    setConfirmDelete(null);
    if (openChain === chain.rootId) setOpenChain(null);
    setCompare((c) => c.filter((id) => id !== chain.rootId));
    await reload();
  };

  const edit = (chain: ScenarioChain) => {
    const stored = chain.latest.input as StoredInput;
    onOpenDraft(stored.draft ?? {
      propertyPrice: stored.propertyPrice, currency: stored.propertyCurrency, downPayment: stored.downPayment,
      termMonths: stored.termMonths, nominalAnnualRatePercent: stored.nominalAnnualRatePercent,
    });
    setOpenChain(chain.rootId);
    requestAnimationFrame(() => document.getElementById('calculator')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const askAbout = (chain: ScenarioChain) => {
    const r = chain.latest.result;
    ask(t('mortgage_ws_ask_prompt', {
      name: chain.name ?? t('mortgage_ws_untitled'),
      payment: money(r.monthlyPayment, r.currency),
      loan: money(r.loanAmount, r.currency),
      years: Math.round(chain.latest.input.termMonths / 12),
      rate: formatPercent(chain.latest.input.nominalAnnualRatePercent, locale, 2),
    }));
  };

  if (!userId) {
    return (
      <section id="my-mortgages" aria-labelledby="ws-title" className="rounded-2xl border border-[hsl(var(--gold-border))] bg-card p-5 shadow-card sm:p-6">
        <h2 id="ws-title" className="font-display text-lg font-semibold text-foreground">{t('mortgage_ws_title')}</h2>
        <p className="mt-1.5 max-w-[60ch] text-sm text-muted-foreground">{t('mortgage_ws_signed_out')}</p>
        <button type="button" onClick={() => navigate('/auth/login?next=/mortgage')} className={cn(goldBtn, 'mt-4')}>
          {t('mortgage_ws_sign_in')}
        </button>
      </section>
    );
  }

  const compared = chains.filter((c) => compare.includes(c.rootId));

  return (
    <section id="my-mortgages" aria-labelledby="ws-title" className="rounded-2xl border border-[hsl(var(--gold-border))] bg-card p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="ws-title" className="font-display text-lg font-semibold text-foreground">{t('mortgage_ws_title')}</h2>
          {current ? <p className="mt-0.5 text-sm text-muted-foreground">{t('mortgage_ws_editing', { name: current.name ?? t('mortgage_ws_untitled') })}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => { setOpenChain(null); onNew(); }} className={btn}>
            <Plus className="h-4 w-4" aria-hidden="true" />{t('mortgage_ws_new')}
          </button>
          {result && current ? (
            <button type="button" disabled={busy} onClick={() => void save('changes')} className={goldBtn}>{t('mortgage_ws_save_changes')}</button>
          ) : null}
          {result && !naming ? (
            <button type="button" disabled={busy} onClick={() => { setNaming(true); setNotice(null); }} className={current ? btn : goldBtn}>
              {t('mortgage_ws_save')}
            </button>
          ) : null}
        </div>
      </div>

      {naming ? (
        <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void save('new'); }}>
          <label className="min-w-0 flex-1">
            <span className="mb-1.5 block text-sm font-medium text-foreground">{t('mortgage_ws_name_label')}</span>
            <input
              autoFocus
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('mortgage_ws_name_placeholder')}
              className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-[hsl(var(--gold))]"
            />
          </label>
          <button type="submit" disabled={busy} className={goldBtn}>{t('mortgage_ws_save')}</button>
          <button type="button" onClick={() => setNaming(false)} className={btn}>{t('mortgage_ws_cancel')}</button>
        </form>
      ) : null}

      {notice ? (
        <p role="status" className={cn('mt-3 flex items-center gap-2 text-sm', notice === 'saved' ? 'text-emerald-700' : 'text-[hsl(var(--destructive))]')}>
          {notice === 'saved' ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <TriangleAlert className="h-4 w-4" aria-hidden="true" />}
          {t(notice === 'saved' ? 'mortgage_ws_saved' : 'mortgage_ws_save_failed')}
        </p>
      ) : null}

      <h3 className="mt-6 text-sm font-semibold text-foreground">{t('mortgage_ws_saved_list')}</h3>
      {rows === null ? (
        <p className="mt-2 text-sm text-muted-foreground">{t('mortgage_ws_loading')}</p>
      ) : chains.length === 0 ? (
        <div className="mt-2 rounded-xl border border-dashed border-border px-4 py-6 text-center">
          <p className="text-sm font-medium text-foreground">{t('mortgage_ws_empty_title')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('mortgage_ws_empty_body')}</p>
        </div>
      ) : (
        <ul className="mt-3 grid gap-3">
          {chains.map((chain) => {
            const r = chain.latest.result;
            const stale = isStale(chain.latest, activeRuleIds);
            const open = expanded === chain.rootId;
            const selected = compare.includes(chain.rootId);
            return (
              <li key={chain.rootId} className={cn('rounded-xl border bg-background p-4', chain.rootId === openChain ? 'border-[hsl(var(--gold))]' : 'border-border')}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-display text-base font-semibold text-foreground">{chain.name ?? t('mortgage_ws_untitled')}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t('mortgage_ws_last_change')}: {date(chain.updatedAt)}</p>
                  </div>
                  <div className="text-end">
                    <p className="font-display text-lg font-semibold tabular-nums text-[hsl(var(--gold-ink))]">{money(r.monthlyPayment, r.currency)}</p>
                    <p className="text-xs text-muted-foreground">{t('mortgage_ws_per_month')}</p>
                  </div>
                </div>
                {stale ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-[hsl(var(--gold-soft))] px-3 py-2 text-xs text-[hsl(var(--gold-ink))]">
                    <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="flex-1">{t('mortgage_ws_stale')}</span>
                    <button type="button" onClick={() => edit(chain)} className="min-h-11 font-semibold underline underline-offset-4">{t('mortgage_ws_recalculate')}</button>
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" aria-expanded={open} onClick={() => setExpanded(open ? null : chain.rootId)} className={btn}><FolderOpen className="h-4 w-4" aria-hidden="true" />{t('mortgage_ws_open')}</button>
                  <button type="button" onClick={() => edit(chain)} className={btn}><Pencil className="h-4 w-4" aria-hidden="true" />{t('mortgage_ws_edit')}</button>
                  <button type="button" disabled={busy} onClick={() => void duplicate(chain)} className={btn}><Copy className="h-4 w-4" aria-hidden="true" />{t('mortgage_ws_duplicate')}</button>
                  <button type="button" aria-pressed={selected} onClick={() => setCompare((c) => selected ? c.filter((id) => id !== chain.rootId) : [...c.slice(-1), chain.rootId])} className={cn(btn, selected && 'border-[hsl(var(--gold))] bg-[hsl(var(--gold-soft))]')}>{t('mortgage_ws_compare_pick')}</button>
                  <button type="button" onClick={() => setConfirmDelete(chain)} className={cn(btn, 'hover:border-[hsl(var(--destructive)/0.5)] hover:text-[hsl(var(--destructive))]')}><Trash2 className="h-4 w-4" aria-hidden="true" />{t('mortgage_ws_delete')}</button>
                  {available ? <button type="button" onClick={() => askAbout(chain)} className={cn(btn, 'border-[hsl(var(--gold-border))] text-[hsl(var(--gold-ink))]')}>{t('mortgage_ws_ask_homi')}</button> : null}
                </div>
                {open ? <ScenarioDetail chain={chain} money={money} date={date} locale={locale} /> : null}
              </li>
            );
          })}
        </ul>
      )}

      {compared.length === 2 ? (
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-foreground">{t('mortgage_ws_compare_title')}</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[20rem] text-sm">
              <thead>
                <tr><th className="py-2 text-start" /> {compared.map((c) => <th key={c.rootId} scope="col" className="py-2 text-end font-display text-foreground">{c.name ?? t('mortgage_ws_untitled')}</th>)}</tr>
              </thead>
              <tbody>
                {[
                  ['mortgage_label_property_price', (c: ScenarioChain) => money(c.latest.input.propertyPrice, c.latest.result.currency)],
                  ['mortgage_label_down_payment', (c: ScenarioChain) => money(c.latest.input.downPayment, c.latest.result.currency)],
                  ['mortgage_result_loan_amount', (c: ScenarioChain) => money(c.latest.result.loanAmount, c.latest.result.currency)],
                  ['mortgage_label_nominal_rate', (c: ScenarioChain) => formatPercent(c.latest.input.nominalAnnualRatePercent, locale, 2)],
                  ['mortgage_ws_term_years', (c: ScenarioChain) => String(Math.round(c.latest.input.termMonths / 12))],
                  ['mortgage_result_monthly_label', (c: ScenarioChain) => money(c.latest.result.monthlyPayment, c.latest.result.currency)],
                  ['mortgage_result_total_interest', (c: ScenarioChain) => money(c.latest.result.totalInterest, c.latest.result.currency)],
                  ['mortgage_result_total_repayment', (c: ScenarioChain) => money(c.latest.result.totalRepayment, c.latest.result.currency)],
                ].map(([key, cell]) => (
                  <tr key={key as string} className="border-t border-border">
                    <th scope="row" className="py-2 text-start font-normal text-muted-foreground">{t(key as string)}</th>
                    {compared.map((c) => <td key={c.rootId} className="py-2 text-end tabular-nums text-foreground">{(cell as (c: ScenarioChain) => string)(c)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {compared[0].latest.result.currency !== compared[1].latest.result.currency ? (
            <p className="mt-2 text-xs text-[hsl(var(--gold-ink))]">{t('mortgage_offer_incomparable_currency')}</p>
          ) : null}
        </div>
      ) : compare.length === 1 ? (
        <p className="mt-4 text-sm text-muted-foreground">{t('mortgage_ws_compare_hint')}</p>
      ) : null}

      <AlertDialog open={confirmDelete !== null} onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('mortgage_ws_delete_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('mortgage_ws_delete_body', { name: confirmDelete?.name ?? t('mortgage_ws_untitled') })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('mortgage_ws_cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); if (confirmDelete) void remove(confirmDelete); }}>
              {t('mortgage_ws_delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function ScenarioDetail({ chain, money, date, locale }: {
  chain: ScenarioChain;
  money: (v: number, c: string) => string;
  date: (iso: string) => string;
  locale: string;
}) {
  const { t } = useLanguage();
  const { input, result } = chain.latest;
  const line = (labelKey: string, value: string) => (
    <div className="flex items-baseline justify-between gap-3 border-b border-border py-2 last:border-0">
      <span className="text-sm text-muted-foreground">{t(labelKey)}</span>
      <span className="text-sm tabular-nums text-foreground">{value}</span>
    </div>
  );
  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--gold-ink))]">{t('mortgage_ws_inputs')}</p>
        {line('mortgage_label_property_price', money(input.propertyPrice, result.currency))}
        {line('mortgage_label_down_payment', money(input.downPayment, result.currency))}
        {line('mortgage_label_nominal_rate', formatPercent(input.nominalAnnualRatePercent, locale, 2))}
        {line('mortgage_ws_term_years', String(Math.round(input.termMonths / 12)))}
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--gold-ink))]">{t('mortgage_ws_results')}</p>
        {line('mortgage_result_loan_amount', money(result.loanAmount, result.currency))}
        {line('mortgage_result_monthly_label', money(result.monthlyPayment, result.currency))}
        {line('mortgage_result_total_interest', money(result.totalInterest, result.currency))}
        {line('mortgage_result_total_repayment', money(result.totalRepayment, result.currency))}
      </div>
      {chain.versions.length > 1 ? (
        <div className="sm:col-span-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--gold-ink))]">
            <History className="h-3.5 w-3.5" aria-hidden="true" />{t('mortgage_ws_history')}
          </p>
          <ol className="mt-1">
            {chain.versions.map((v) => (
              <li key={v.id} className="flex items-baseline justify-between gap-3 border-b border-border py-2 text-sm last:border-0">
                <span className="text-muted-foreground">{t('mortgage_ws_version', { n: v.version })} · {date(v.calculatedAt)}</span>
                <span className="tabular-nums text-foreground">{money(v.result.monthlyPayment, v.result.currency)}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
