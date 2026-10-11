// HOMATCH Verify — the project's numbers, worked through.
//
// From the documented specifications only (projectMath.ts): the plot, the
// K-1 / K-2 / K-3 coefficients with the division that produces each, the
// split of floor area by use, and whether the documented parts add up to the
// documented total. Four kinds of area are kept apart (gross construction,
// permitted K-2, net internal, saleable); saleable area is never derived. A
// value that contradicts another is flagged, never computed with, and a
// missing input is named.

import React from 'react';
import { AlertTriangle, Check, Calculator } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { projectMath, formatArea, type ProjectMath as ProjectMathView, type MathFlag, type MissingInput } from '@/verify/intelligence/projectMath';

const dmy = (iso?: string | null): string | null => {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
};
const ltr = (s: string) => <bdi dir="ltr" className="tabular-nums">{s}</bdi>;

/** Input keys a reader is told by name when one is missing or flagged. */
const INPUT_KEY: Record<string, string> = {
  landArea: 'verify_fn_math_in_land',
  k1Area: 'verify_fn_math_in_k1area',
  k2CalculationArea: 'verify_fn_math_in_k2area',
  landscapingArea: 'verify_fn_math_in_k3area',
  totalArea: 'verify_fn_math_in_gross',
  builtUpArea: 'verify_fn_math_in_builtup',
  residentialArea: 'verify_fn_math_in_residential',
  officeArea: 'verify_fn_math_in_office',
  commercialArea: 'verify_fn_math_in_commercial',
  SALES_PLAN: 'verify_fn_math_in_salesplan',
};
const USE_KEY: Record<string, string> = {
  residentialArea: 'verify_fn_math_use_residential',
  officeArea: 'verify_fn_math_use_office',
  commercialArea: 'verify_fn_math_use_commercial',
};
const USE_TONE: Record<string, string> = {
  residentialArea: 'bg-[hsl(222_47%_11%)]',
  officeArea: 'bg-[hsl(38_92%_50%)]',
  commercialArea: 'bg-emerald-600',
};
const MEANING_KEY = { K1: 'verify_fn_math_k1_meaning', K2: 'verify_fn_math_k2_meaning', K3: 'verify_fn_math_k3_meaning' } as const;

export function hasProjectMath(specs: unknown): boolean {
  return projectMath(specs) !== null;
}

function flagText(f: MathFlag, t: (k: string, v?: Record<string, string>) => string): string {
  const v = Object.fromEntries(Object.entries(f.values).map(([k, x]) => [k, typeof x === 'number' ? formatArea(x) : String(x)]));
  return t(`verify_fn_math_flag_${f.id.toLowerCase()}`, v);
}

function missingText(m: MissingInput, t: (k: string, v?: Record<string, string>) => string): string {
  const needs = m.needs.map((k) => (INPUT_KEY[k] ? t(INPUT_KEY[k]) : k)).join(', ');
  return t(`verify_fn_math_missing_${m.id.toLowerCase()}`, { needs });
}

export const ProjectMath: React.FC<{ specs?: unknown }> = ({ specs }) => {
  const { t, lang } = useLanguage();
  const m2 = (n: number) => `${formatArea(n)} ${lang === 'ka' ? 'მ²' : 'm²'}`;
  const pm: ProjectMathView | null = React.useMemo(() => projectMath(specs), [specs]);
  if (!pm) return null;
  const basisDate = dmy(pm.basis?.date);
  const kinds: Array<{ key: string; value: number | null }> = [
    { key: 'gross', value: pm.gross?.value ?? null },
    { key: 'k2', value: pm.k2Area?.value ?? null },
    { key: 'net', value: null },
    { key: 'saleable', value: null },
  ];
  return (
    <section aria-labelledby="vrx-math" className="space-y-4" data-project-math>
      <div className="space-y-1.5">
        <h3 id="vrx-math" className="flex items-center gap-2 font-display text-lg font-semibold leading-snug tracking-tight break-words">
          <Calculator className="h-5 w-5 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
          {t('verify_v6s_scale_title')}
        </h3>
        {/* The owner's PROJECT SCALE copy, then the project's own figures. */}
        {t('verify_v6s_scale_body').split(/\n+/).map((p, i) => (
          <p key={i} className="max-w-[68ch] text-[15px] leading-7 text-foreground/90 break-words">{p}</p>
        ))}
        <p className="max-w-[62ch] text-sm leading-6 text-muted-foreground break-words">{t('verify_fn_math_lede')}</p>
        {pm.basis?.caseRef ? (
          <p className="text-xs leading-5 text-muted-foreground break-words">
            {t('verify_fn_math_basis', { ref: `⁦${pm.basis.caseRef}⁩`, date: basisDate ? `⁦${basisDate}⁩` : '' })}
          </p>
        ) : null}
      </div>

      {pm.coefficients.length ? (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {pm.coefficients.map((c) => (
            <li key={c.id} className="min-w-0 rounded-2xl border border-border bg-card p-4" data-coefficient={c.id}>
              <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-[hsl(var(--gold-ink))]">{t(`verify_fn_math_${c.id.toLowerCase()}_name`)}</p>
              <p className="mt-1 font-display text-2xl font-semibold leading-tight">{ltr(c.result.toFixed(2))}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground break-words">
                {ltr(`${m2(c.area.value)} ÷ ${m2(c.land.value)}`)}
              </p>
              <p className="mt-2 text-sm leading-6 text-foreground/85 break-words">{t(MEANING_KEY[c.id])}</p>
              {c.stated !== null ? (
                <p className={`mt-2 flex items-start gap-1.5 text-xs leading-5 ${c.consistent ? 'text-emerald-800' : 'text-amber-800'}`}>
                  {c.consistent ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                  <span className="break-words">{t(c.consistent ? 'verify_fn_math_stated_match' : 'verify_fn_math_stated_differs', { stated: String(c.stated) })}</span>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Four kinds of area, never confused with each other. */}
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
        <h4 className="text-sm font-semibold break-words">{t('verify_fn_math_kinds_title')}</h4>
        <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {kinds.map((k) => (
            <div key={k.key} className="min-w-0 space-y-0.5">
              <dt className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm font-medium break-words">
                <span>{t(`verify_fn_math_kind_${k.key}`)}</span>
                <span className="text-sm font-semibold">{k.value !== null ? ltr(m2(k.value)) : <span className="text-xs font-normal text-muted-foreground">{t('verify_fn_math_not_on_form')}</span>}</span>
              </dt>
              <dd className="text-xs leading-5 text-muted-foreground break-words">{t(`verify_fn_math_kind_${k.key}_meaning`)}</dd>
            </div>
          ))}
        </dl>
        {pm.grossMinusK2 !== null ? (
          <p className="mt-3 text-sm leading-6 text-foreground/85 break-words">
            {t(pm.parking ? 'verify_fn_math_gross_minus_k2_parking' : 'verify_fn_math_gross_minus_k2', { diff: m2(pm.grossMinusK2), parking: pm.parking ? m2(pm.parking.value) : '' })}
          </p>
        ) : null}
      </div>

      {pm.uses.length ? (
        <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
          <h4 className="text-sm font-semibold break-words">{t('verify_fn_math_uses_title', { total: m2(pm.usesTotal ?? 0) })}</h4>
          <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
            {pm.uses.map((u) => <span key={u.key} className={USE_TONE[u.key]} style={{ width: `${u.share}%` }} />)}
          </div>
          <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {pm.uses.map((u) => (
              <li key={u.key} className="flex items-center gap-2 text-sm">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${USE_TONE[u.key]}`} aria-hidden="true" />
                <span className="min-w-0 break-words">{t(USE_KEY[u.key])}</span>
                <span className="ms-auto font-semibold">{ltr(`${m2(u.area)} · ${u.share}%`)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {pm.breakdown ? (
        <p className={`flex items-start gap-2 text-sm leading-6 break-words ${pm.breakdown.consistent ? 'text-foreground/85' : 'text-amber-900'}`}>
          {pm.breakdown.consistent ? <Check className="mt-1 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" /> : <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />}
          <span>{t(pm.breakdown.consistent ? 'verify_fn_math_breakdown_ok' : 'verify_fn_math_breakdown_off', { sum: m2(pm.breakdown.sum), total: m2(pm.breakdown.total), parts: String(pm.breakdown.parts.length) })}</span>
        </p>
      ) : null}

      {pm.flags.filter((f) => f.id !== 'MIXED_STANDING' && f.id !== 'BREAKDOWN_MISMATCH').length ? (
        <ul className="space-y-2 rounded-2xl border border-amber-300/70 bg-amber-50/60 p-4 text-amber-950 dark:bg-amber-950/20 dark:text-amber-100" data-math-flags>
          {pm.flags.filter((f) => f.id !== 'MIXED_STANDING' && f.id !== 'BREAKDOWN_MISMATCH').map((f, i) => (
            <li key={`${f.id}-${i}`} className="flex items-start gap-2 text-sm leading-6">
              <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
              <span className="min-w-0 break-words">{flagText(f, t)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {pm.missing.length ? (
        <ul className="space-y-1.5">
          {pm.missing.map((m) => (
            <li key={m.id} className="text-xs leading-5 text-muted-foreground break-words">{missingText(m, t)}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
};
