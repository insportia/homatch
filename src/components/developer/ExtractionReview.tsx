import React, { useMemo, useState } from 'react';
import { ScanLine, AlertTriangle, Check, X, Quote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  applyExtraction, rejectExtraction, type ExtractionApplyResult,
} from '@/services/developer/documents';
import { devErrorText } from '@/services/developer/client';
import { Eyebrow, GoldRule, formatMoney, formatDate } from './primitives';
import type { DevDocument } from '@/services/developer/types';

/**
 * Only the four fields a reviewer compares against. Structural rather than
 * DevDeal, because the review screen already holds ledger rows and refetching
 * the deal to satisfy a type would be a request for nothing.
 */
export interface ExtractionTarget {
  contract_number: string | null;
  contract_date: string | null;
  sale_price: number | null;
  currency: string | null;
}

/**
 * THE HUMAN GATE.
 *
 * A reading produced by a machine sits beside the value the business actually
 * holds, and a person ticks the ones they accept. What is sent is the subset
 * that was ticked — not the extraction object — which is the property that
 * makes it impossible for an unattended process to rewrite a contract by
 * calling the same function with a full payload.
 *
 * THREE THINGS EVERY ROW SHOWS, because a reviewer needs all three to decide:
 *
 *   NOW        what the deal currently says
 *   PROPOSED   what the document was read as saying
 *   EVIDENCE   the verbatim phrase it was read from
 *
 * Without the third, agreeing is faith. With it, a person can look at the
 * document and see whether the reading is right.
 *
 * DISAGREEMENT IS REFUSED, NOT RESOLVED. A field whose current value differs
 * from the proposal is not overwritten unless the reviewer explicitly says to,
 * and the server enforces that rather than this component — dev_apply_extraction
 * returns the refusal with a reason, which is rendered below.
 */
const FIELD_LABEL: Record<string, string> = {
  contract_number: 'dev_contract_number',
  contract_date: 'dev_contract_date',
  sale_price: 'dev_sale_price',
  currency: 'dev_currency',
  buyer_name: 'dev_buyer',
  unit_number: 'dev_unit',
  amount: 'dev_amount',
  paid_at: 'dev_paid_on',
  reference: 'dev_reference',
  method: 'dev_payment_method',
};

/** Fields that write onto the deal. The rest are context for the reviewer. */
const APPLICABLE = ['contract_number', 'contract_date', 'sale_price'];

const SKIP_REASON_KEY: Record<string, string> = {
  DIFFERS_FROM_EXISTING: 'dev_extract_skip_differs',
  REQUIRES_FINANCE: 'dev_extract_skip_finance',
  NOT_A_DATE: 'dev_extract_skip_not_date',
  NOT_A_NUMBER: 'dev_extract_skip_not_number',
  PAYMENT_ALREADY_RECORDED: 'dev_extract_skip_already',
};

export function ExtractionReview({
  doc, deal, onApplied,
}: {
  doc: DevDocument;
  deal: ExtractionTarget | null;
  onApplied: () => Promise<void>;
}) {
  const { t, lang: language } = useLanguage();
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExtractionApplyResult | null>(null);

  const fields = doc.extraction?.fields ?? {};

  /** What the deal says now, for the three fields that can be written. */
  const current = useMemo<Record<string, string | number | null>>(() => ({
    contract_number: deal?.contract_number ?? null,
    contract_date: deal?.contract_date ?? null,
    sale_price: deal?.sale_price ?? null,
  }), [deal]);

  const rows = useMemo(
    () => Object.entries(fields).map(([name, field]) => ({
      name,
      value: field.value,
      confidence: field.confidence,
      evidence: field.evidence,
      applicable: APPLICABLE.includes(name),
      currentValue: current[name] ?? null,
      // A value that matches what is already stored needs no decision.
      unchanged: APPLICABLE.includes(name)
        && current[name] != null
        && String(current[name]) === String(field.value),
    })),
    [fields, current],
  );

  const decidable = rows.filter((r) => r.applicable && !r.unchanged);
  const conflicts = decidable.filter(
    (r) => r.currentValue != null && String(r.currentValue) !== String(r.value),
  );

  function render(name: string, value: string | number | null): string {
    if (value === null || value === undefined || value === '') return '—';
    if (name === 'sale_price' || name === 'amount') {
      return formatMoney(Number(value), deal?.currency ?? null, language);
    }
    if (name === 'contract_date' || name === 'paid_at') {
      return formatDate(String(value), language);
    }
    return String(value);
  }

  function toggle(name: string) {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  async function apply() {
    if (accepted.size === 0) return;
    setBusy(true);
    try {
      // ONLY the ticked fields travel. This is the payload, not the extraction.
      const payload: Record<string, string | number | null> = {};
      for (const name of accepted) {
        const field = fields[name];
        if (field) payload[name] = field.value as string | number | null;
      }
      const outcome = await applyExtraction(doc.id, payload, overwrite);
      setResult(outcome);
      if (outcome.applied.length > 0) {
        toast.success(
          t('dev_extract_applied').replace('{n}', String(outcome.applied.length)),
        );
        await onApplied();
      } else {
        toast.error(t('dev_extract_nothing_applied'));
      }
    } catch (e) {
      toast.error(devErrorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    setBusy(true);
    try {
      await rejectExtraction(doc.id, t('dev_extract_rejected_reason'));
      toast.success(t('dev_extract_rejected'));
      await onApplied();
    } catch (e) {
      toast.error(devErrorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  if (Object.keys(fields).length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
        {t('dev_doc_no_extraction')}
      </p>
    );
  }

  return (
    <section className="space-y-3">
      <div>
        <Eyebrow>{t('dev_extract_title')}</Eyebrow>
        <GoldRule className="mt-2" />
      </div>

      {doc.extraction_confidence != null && (
        <p className="flex items-center gap-1.5 text-2xs text-muted-foreground">
          <ScanLine className="h-3 w-3" aria-hidden="true" />
          {t('dev_extract_confidence')
            .replace('{pct}', String(Math.round(doc.extraction_confidence * 100)))}
        </p>
      )}

      {!deal && (
        <p className="rounded-md border border-amber-600/40 bg-amber-500/[0.07] px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          {t('dev_extract_no_deal')}
        </p>
      )}

      <ul className="space-y-2">
        {rows.map((row) => {
          const conflicting = row.applicable
            && row.currentValue != null
            && String(row.currentValue) !== String(row.value);
          return (
            <li
              key={row.name}
              className={cn(
                'rounded-md border px-3 py-2.5',
                conflicting ? 'border-amber-600/40 bg-amber-500/[0.04]' : 'border-border',
              )}
            >
              <div className="flex items-start gap-2.5">
                {row.applicable && deal && !row.unchanged ? (
                  <Checkbox
                    id={`extract-${row.name}`}
                    checked={accepted.has(row.name)}
                    onCheckedChange={() => toggle(row.name)}
                    className="mt-0.5"
                  />
                ) : (
                  <span className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                )}

                <div className="min-w-0 flex-1">
                  <Label
                    htmlFor={`extract-${row.name}`}
                    className="text-2xs uppercase tracking-wider text-muted-foreground"
                  >
                    {t(FIELD_LABEL[row.name] ?? row.name)}
                  </Label>

                  <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
                    {row.applicable && (
                      <>
                        <span className="text-muted-foreground">
                          {render(row.name, row.currentValue)}
                        </span>
                        <span className="text-muted-foreground" aria-hidden="true">→</span>
                      </>
                    )}
                    <span className="font-medium">{render(row.name, row.value)}</span>
                    {row.confidence != null && (
                      <span className={cn(
                        'text-2xs',
                        row.confidence < 0.6 ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
                      )}>
                        {Math.round(row.confidence * 100)}%
                      </span>
                    )}
                    {row.unchanged && (
                      <span className="text-2xs text-muted-foreground">
                        {t('dev_extract_unchanged')}
                      </span>
                    )}
                    {!row.applicable && (
                      <span className="text-2xs text-muted-foreground">
                        {t('dev_extract_context_only')}
                      </span>
                    )}
                  </div>

                  {/* THE EVIDENCE. Without it, agreeing is faith. */}
                  {row.evidence && (
                    <p className="mt-1 flex items-start gap-1 text-2xs italic text-muted-foreground">
                      <Quote className="mt-0.5 h-2.5 w-2.5 shrink-0" aria-hidden="true" />
                      <span className="line-clamp-2">{row.evidence}</span>
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {conflicts.length > 0 && accepted.size > 0 && (
        <div className="rounded-md border border-amber-600/40 bg-amber-500/[0.07] px-3 py-2.5">
          <p className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t('dev_extract_conflict_warning')}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Checkbox
              id="extract-overwrite"
              checked={overwrite}
              onCheckedChange={(v) => setOverwrite(v === true)}
            />
            <Label htmlFor="extract-overwrite" className="text-xs font-normal">
              {t('dev_extract_overwrite')}
            </Label>
          </div>
        </div>
      )}

      {/* What the server actually did, including what it refused and why. */}
      {result && (
        <div className="space-y-1.5 rounded-md border border-border px-3 py-2.5 text-xs">
          {result.applied.map((a, i) => (
            <p key={`a-${i}`} className="flex items-start gap-1.5 text-emerald-700 dark:text-emerald-400">
              <Check className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
              {t(FIELD_LABEL[a.field] ?? a.field)}
              {a.note && <span className="text-muted-foreground">— {a.note}</span>}
            </p>
          ))}
          {(result.warnings ?? []).map((w, i) => (
            <p key={`w-${i}`} className="flex items-start gap-1.5 text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
              {t('dev_extract_schedule_mismatch')
                .replace('{price}', formatMoney(w.sale_price, deal?.currency ?? null, language))
                .replace('{total}', formatMoney(w.schedule_total, deal?.currency ?? null, language))}
            </p>
          ))}
          {result.skipped.map((sk, i) => (
            <p key={`s-${i}`} className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
              <X className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
              {t(FIELD_LABEL[sk.field] ?? sk.field)}
              {' — '}
              {t(SKIP_REASON_KEY[sk.reason] ?? 'dev_extract_skip_other')}
            </p>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={busy || accepted.size === 0 || !deal}
          onClick={() => void apply()}
        >
          {busy
            ? t('dev_saving')
            : t('dev_extract_apply').replace('{n}', String(accepted.size))}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void reject()}>
          {t('dev_extract_reject')}
        </Button>
      </div>

      {decidable.length === 0 && deal && (
        <p className="text-2xs text-muted-foreground">{t('dev_extract_nothing_to_decide')}</p>
      )}
    </section>
  );
}
