import { ArrowRight, Check, Loader2, Pencil, Sparkles } from 'lucide-react';
import React, { useEffect, useId, useMemo, useState } from 'react';
import {
  type BriefEdit, type SearchIntelligenceBrief, applyEdit,
} from '@/research-core/marketplace/brief';
import { type Readiness, type RequirementKey, evaluateReadiness } from '@/research-core/marketplace/readiness';
import type {
  BuildingChoice, MarketplacePropertyType, MarketplaceTransaction, RenovationChoice,
} from '@/research-core/marketplace/taxonomy';
import { type T, criteriaChips, rangeText, requirementLabel } from './format';

const TRANSACTIONS: MarketplaceTransaction[] = ['BUY', 'MONTHLY_RENT', 'DAILY_RENT'];
const TYPES: MarketplacePropertyType[] = ['APARTMENT', 'HOUSE', 'PENTHOUSE', 'LAND', 'COMMERCIAL', 'OFFICE'];
const BUILDINGS: Array<Exclude<BuildingChoice, 'ANY'>> = ['NEW_BUILD', 'OLD_BUILD', 'UNDER_CONSTRUCTION'];
const RENOVATIONS: Array<Exclude<RenovationChoice, 'ANY'>> = ['RENOVATED', 'GREEN_FRAME', 'WHITE_FRAME', 'BLACK_FRAME', 'NEEDS_RENOVATION'];
const CITIES = ['თბილისი', 'ბათუმი', 'ქუთაისი'];

type Editing = RequirementKey | 'renovation';

const chipBase = 'inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))] focus-visible:ring-offset-1';
const optionClass = (on: boolean) => `${chipBase} ${on
  ? 'border-[#0C1119] bg-[#0C1119] text-white'
  : 'border-border bg-card text-foreground hover:border-[hsl(var(--gold-border))] hover:bg-[hsl(var(--gold)/0.06)]'}`;
const primary = 'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-[#0C1119] px-6 text-[15px] font-semibold text-white transition hover:bg-[#151d2a] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))] focus-visible:ring-offset-2';
const quiet = 'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 text-sm font-semibold text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]';
const field = 'h-12 w-full min-w-0 rounded-xl border border-border bg-card px-3.5 text-[15px] text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]';

/* ────────────────────────── First message ────────────────────────── */

export function BuilderIntro({ t, text, onText, onSubmit, busy }: {
  t: T; text: string; onText: (v: string) => void; onSubmit: () => void; busy: boolean;
}) {
  const id = useId();
  const example = t('mps_intro_example');
  return (
    <section aria-labelledby={`${id}-title`} className="hm-discovery-panel overflow-hidden">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="space-y-4 p-6 sm:p-8">
          <h2 id={`${id}-title`} className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">{t('mps_intro_title')}</h2>
          <p className="text-[15px] font-medium leading-relaxed text-foreground">{t('mps_intro_body')}</p>
          <p className="text-[15px] leading-relaxed text-muted-foreground">{t('mps_intro_description')}</p>
          <form
            className="space-y-3 pt-1"
            onSubmit={(e) => { e.preventDefault(); if (text.trim().length >= 3 && !busy) onSubmit(); }}
          >
            <label htmlFor={`${id}-input`} className="sr-only">{t('mps_intro_title')}</label>
            <textarea
              id={`${id}-input`}
              dir="auto"
              value={text}
              onChange={(e) => onText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (text.trim().length >= 3) onSubmit(); } }}
              placeholder={t('mps_intro_placeholder')}
              rows={4}
              maxLength={2000}
              className="block w-full resize-y rounded-2xl border border-border bg-card px-4 py-3.5 text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]"
            />
            <button type="submit" className={`${primary} w-full sm:w-auto`} disabled={busy || text.trim().length < 3}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              <span>{t('mps_intro_button')}</span>
              {!busy ? <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" /> : null}
            </button>
          </form>
        </div>
        <aside className="space-y-4 border-t border-border bg-[hsl(var(--gold)/0.04)] p-6 sm:p-8 lg:border-s lg:border-t-0">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--gold-ink))]">{t('mps_intro_example_label')}</p>
            <button
              type="button"
              onClick={() => onText(example)}
              className="mt-2 block w-full rounded-xl border border-dashed border-[hsl(var(--gold-border))] bg-card p-4 text-start text-sm leading-relaxed text-foreground/85 transition hover:bg-[hsl(var(--gold)/0.06)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]"
            >
              <span dir="auto">{example}</span>
            </button>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">{t('mps_intro_types')}</p>
          <p className="text-sm leading-relaxed text-muted-foreground">{t('mps_intro_help')}</p>
        </aside>
      </div>
    </section>
  );
}

/* ────────────────────────── What HOMATCH understood ────────────────────────── */

export function UnderstoodPanel({ t, brief, readiness, onEdit, editing }: {
  t: T; brief: SearchIntelligenceBrief; readiness: Readiness; onEdit: (k: Editing) => void; editing: Editing | null;
}) {
  const chips = criteriaChips(brief, t);
  const open = [...readiness.missing, ...readiness.invalid];
  return (
    <section aria-label={t('mps_understood_title')} className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t('mps_understood_title')}</p>
      {chips.length ? (
        <ul className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <li key={c.key}>
              <button
                type="button"
                onClick={() => { if (c.key !== 'parking' && c.key !== 'furnished') onEdit(c.key); }}
                aria-pressed={editing === c.key}
                aria-label={`${c.label}. ${t('mps_edit')}`}
                className={`${chipBase} ${c.proposed
                  ? 'border-dashed border-[hsl(var(--gold-border))] bg-[hsl(var(--gold)/0.06)] text-foreground'
                  : 'border-[hsl(var(--gold-border))] bg-card text-foreground'} hover:bg-[hsl(var(--gold)/0.08)]`}
              >
                {c.proposed
                  ? <Sparkles className="h-3.5 w-3.5 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
                  : <Check className="h-3.5 w-3.5 text-[hsl(var(--gold-ink))]" aria-hidden="true" />}
                <span dir="auto">{c.label}</span>
                {c.proposed ? <span className="sr-only">{t('mps_proposed')}</span> : null}
                <Pencil className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {open.length ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t('mps_missing_label')}</span>
          {open.map((k) => (
            <button key={k} type="button" onClick={() => onEdit(k)}
              className="rounded-full border border-dashed border-border px-3 py-1 text-sm text-foreground/80 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]">
              {requirementLabel(k, t)}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/* ────────────────────────── One question ────────────────────────── */

function RangeInputs({ t, unitLabel, initial, onSave, integer }: {
  t: T; unitLabel: string; initial: { min: number | null; max: number | null } | null; onSave: (min: number | null, max: number | null) => void; integer?: boolean;
}) {
  const id = useId();
  const [min, setMin] = useState(initial?.min !== null && initial?.min !== undefined ? String(initial.min) : '');
  const [max, setMax] = useState(initial?.max !== null && initial?.max !== undefined ? String(initial.max) : '');
  const parse = (v: string) => {
    const n = Number(v.replace(/[^\d.]/g, ''));
    return v.trim() === '' || !Number.isFinite(n) ? null : integer ? Math.trunc(n) : n;
  };
  const lo = parse(min);
  const hi = parse(max);
  const valid = lo !== null && hi !== null && hi > 0;
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (valid) onSave(lo, hi); }}>
      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <label htmlFor={`${id}-min`} className="mb-1 block text-xs font-medium text-muted-foreground">{t('mps_min')} · {unitLabel}</label>
          <input id={`${id}-min`} inputMode="numeric" className={field} value={min} onChange={(e) => setMin(e.target.value)} />
        </div>
        <div className="min-w-0">
          <label htmlFor={`${id}-max`} className="mb-1 block text-xs font-medium text-muted-foreground">{t('mps_max')} · {unitLabel}</label>
          <input id={`${id}-max`} inputMode="numeric" className={field} value={max} onChange={(e) => setMax(e.target.value)} />
        </div>
      </div>
      <button type="submit" className={primary} disabled={!valid}>{t('mps_continue')}</button>
    </form>
  );
}

function CountChoice({ t, values, current, onPick, what }: {
  t: T; values: number[]; current: { min: number | null; max: number | null } | null; onPick: (min: number, max: number | null) => void; what: 'rooms' | 'bedrooms';
}) {
  const [custom, setCustom] = useState('');
  const id = useId();
  const last = values[values.length - 1];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="group">
        {values.map((n) => {
          const plus = n === last;
          const on = !!current && current.min === n && (plus ? current.max === null : current.max === n);
          return (
            <button key={n} type="button" className={optionClass(on)} aria-pressed={on} onClick={() => onPick(n, plus ? null : n)}>
              {plus ? t(`mps_${what}_from`, { n }) : t(`mps_${what}_n`, { n })}
            </button>
          );
        })}
      </div>
      <form className="flex max-w-xs gap-2" onSubmit={(e) => { e.preventDefault(); const n = Math.trunc(Number(custom)); if (Number.isFinite(n) && n >= 0 && n <= 50 && custom.trim()) onPick(n, n); }}>
        <label htmlFor={id} className="sr-only">{t('mps_custom')}</label>
        <input id={id} inputMode="numeric" placeholder={t('mps_custom')} className={field} value={custom} onChange={(e) => setCustom(e.target.value)} />
        <button type="submit" className={quiet} disabled={!custom.trim()}>{t('mps_ok')}</button>
      </form>
    </div>
  );
}

function MultiChoice<V extends string>({ t, options, labelOf, current, anyLabel, onSave, multiLabel }: {
  t: T; options: V[]; labelOf: (v: V) => string; current: Array<V | 'ANY'> | null; anyLabel: string; multiLabel?: string; onSave: (v: Array<V | 'ANY'>) => void;
}) {
  const [multi, setMulti] = useState((current?.filter((c) => c !== 'ANY').length ?? 0) > 1);
  const [picked, setPicked] = useState<V[]>((current ?? []).filter((c): c is V => c !== 'ANY'));
  const toggle = (v: V) => {
    if (!multi) { onSave([v]); return; }
    setPicked((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="group">
        {options.map((o) => {
          const on = multi ? picked.includes(o) : !!current && current.length === 1 && current[0] === o;
          return <button key={o} type="button" className={optionClass(on)} aria-pressed={on} onClick={() => toggle(o)}>{labelOf(o)}</button>;
        })}
        {multiLabel ? (
          <button type="button" className={optionClass(multi)} aria-pressed={multi} onClick={() => setMulti((m) => !m)}>{multiLabel}</button>
        ) : null}
        <button type="button" className={optionClass(!!current && current[0] === 'ANY')} aria-pressed={!!current && current[0] === 'ANY'} onClick={() => onSave(['ANY'])}>{anyLabel}</button>
      </div>
      {multi ? (
        <button type="button" className={primary} disabled={!picked.length} onClick={() => onSave(picked)}>{t('mps_continue')}</button>
      ) : null}
    </div>
  );
}

function LocationQuestion({ t, brief, onSave }: { t: T; brief: SearchIntelligenceBrief; onSave: (city: string, districts: string[]) => void }) {
  const id = useId();
  const [city, setCity] = useState(brief.city?.value ?? '');
  const [districts, setDistricts] = useState((brief.districts?.value ?? []).join(', '));
  const list = districts.split(/[,،\n]/).map((d) => d.trim()).filter(Boolean).slice(0, 8);
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (city.trim()) onSave(city.trim(), list); }}>
      <div className="flex flex-wrap gap-2" role="group">
        {CITIES.map((c) => <button key={c} type="button" className={optionClass(city === c)} aria-pressed={city === c} onClick={() => setCity(c)}>{c}</button>)}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <label htmlFor={`${id}-city`} className="mb-1 block text-xs font-medium text-muted-foreground">{t('mps_city')}</label>
          <input id={`${id}-city`} dir="auto" className={field} value={city} onChange={(e) => setCity(e.target.value)} maxLength={60} />
        </div>
        <div className="min-w-0">
          <label htmlFor={`${id}-d`} className="mb-1 block text-xs font-medium text-muted-foreground">{t('mps_districts')}</label>
          <input id={`${id}-d`} dir="auto" className={field} value={districts} onChange={(e) => setDistricts(e.target.value)} maxLength={300} />
        </div>
      </div>
      <button type="submit" className={primary} disabled={!city.trim()}>{t('mps_continue')}</button>
    </form>
  );
}

export function QuestionCard({ t, question, brief, onEdit, onDone }: {
  t: T; question: Editing; brief: SearchIntelligenceBrief; onEdit: (e: BriefEdit) => void; onDone?: () => void;
}) {
  const save = (e: BriefEdit) => { onEdit(e); onDone?.(); };
  const tx = brief.transactionType?.value ?? null;
  const per = tx === 'MONTHLY_RENT' ? t('mps_per_month') : tx === 'DAILY_RENT' ? t('mps_per_day') : null;
  const proposedRange = (f: 'price' | 'area' | 'rooms' | 'bedrooms') => (brief[f]?.status === 'PROPOSED' ? brief[f]!.value : null);
  const titleKey: Record<Editing, string> = {
    transactionType: 'mps_q_transaction', propertyType: 'mps_q_type', location: 'mps_q_location', price: 'mps_q_price',
    area: 'mps_q_area', rooms: 'mps_q_rooms', bedrooms: 'mps_q_bedrooms', buildingStatus: 'mps_q_building', renovation: 'mps_q_renovation',
  };
  const help: Partial<Record<Editing, string>> = { location: 'mps_q_location_help', price: 'mps_q_price_help', area: 'mps_q_area_help' };
  const id = useId();
  return (
    <section aria-labelledby={`${id}-q`} className="hm-discovery-panel hm-discovery-focus space-y-4 p-5 sm:p-6" aria-live="polite">
      <div className="space-y-1">
        <h3 id={`${id}-q`} className="font-display text-lg font-semibold text-foreground">{t(titleKey[question])}</h3>
        {help[question] ? <p className="text-sm text-muted-foreground">{t(help[question]!)}{question === 'price' && per ? ` (${per})` : ''}</p> : null}
      </div>

      {(question === 'price' || question === 'area' || question === 'rooms' || question === 'bedrooms') && proposedRange(question) ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-[hsl(var(--gold-border))] bg-[hsl(var(--gold)/0.05)] p-3">
          <Sparkles className="h-4 w-4 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
          <span className="text-sm text-foreground">
            {t('mps_proposal', { value: rangeText(proposedRange(question)!, t, question === 'price' ? 'price' : question === 'area' ? 'area' : 'count') })}
          </span>
          <button type="button" className={quiet} onClick={() => save({ field: 'confirm', target: question })}>{t('mps_proposal_accept')}</button>
        </div>
      ) : null}

      {question === 'transactionType' && (
        <div className="flex flex-wrap gap-2" role="group">
          {TRANSACTIONS.map((v) => <button key={v} type="button" className={optionClass(tx === v)} aria-pressed={tx === v} onClick={() => save({ field: 'transactionType', value: v })}>{t(`mps_tx_${v}`)}</button>)}
        </div>
      )}
      {question === 'propertyType' && (
        <div className="flex flex-wrap gap-2" role="group">
          {TYPES.map((v) => {
            const on = brief.propertyType?.value === v;
            return <button key={v} type="button" className={optionClass(on)} aria-pressed={on} onClick={() => save({ field: 'propertyType', value: v })}>{t(`mps_pt_${v}`)}</button>;
          })}
        </div>
      )}
      {question === 'location' && (
        <LocationQuestion t={t} brief={brief} onSave={(city, districts) => { onEdit({ field: 'city', value: city }); save({ field: 'districts', value: districts.length ? districts : null }); }} />
      )}
      {question === 'price' && (
        <RangeInputs t={t} unitLabel="USD" initial={brief.price?.value ?? null} onSave={(min, max) => save({ field: 'price', value: { min, max } })} />
      )}
      {question === 'area' && (
        <RangeInputs t={t} unitLabel="m²" initial={brief.area?.value ?? null} onSave={(min, max) => save({ field: 'area', value: { min, max } })} />
      )}
      {question === 'rooms' && (
        <CountChoice t={t} what="rooms" values={[1, 2, 3, 4, 5]} current={brief.rooms?.value ?? null} onPick={(min, max) => save({ field: 'rooms', value: { min, max } })} />
      )}
      {question === 'bedrooms' && (
        <CountChoice t={t} what="bedrooms" values={[1, 2, 3, 4]} current={brief.bedrooms?.value ?? null} onPick={(min, max) => save({ field: 'bedrooms', value: { min, max } })} />
      )}
      {question === 'buildingStatus' && (
        <MultiChoice t={t} options={BUILDINGS} labelOf={(v) => t(`mps_bs_${v}`)} current={brief.buildingStatuses?.value ?? null}
          anyLabel={t('mps_bs_ANY')} multiLabel={t('mps_bs_MULTI')} onSave={(v) => save({ field: 'buildingStatuses', value: v as BuildingChoice[] })} />
      )}
      {question === 'renovation' && (
        <MultiChoice t={t} options={RENOVATIONS} labelOf={(v) => t(`mps_rn_${v}`)} current={brief.renovationPreferences?.value ?? null}
          anyLabel={t('mps_bs_ANY')} multiLabel={t('mps_bs_MULTI')} onSave={(v) => save({ field: 'renovationPreferences', value: v as RenovationChoice[] })} />
      )}
    </section>
  );
}

/* ────────────────────────── Ready ────────────────────────── */

export function ConfirmCard({ t, brief, onStart, onChange, onAddCondition, starting }: {
  t: T; brief: SearchIntelligenceBrief; onStart: () => void; onChange: () => void; onAddCondition: () => void; starting: boolean;
}) {
  const lines = criteriaChips(brief, t);
  return (
    <section aria-labelledby="mps-ready" className="hm-discovery-panel hm-discovery-focus overflow-hidden">
      <div className="space-y-5 p-6 sm:p-8">
        <div className="space-y-1.5">
          <h2 id="mps-ready" className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">{t('mps_ready_title')}</h2>
          <p className="text-[15px] leading-relaxed text-muted-foreground">{t('mps_ready_body')}</p>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {lines.map((l) => (
            <li key={l.key} className="flex min-w-0 items-center gap-2.5 rounded-xl border border-border bg-card px-4 py-3">
              <Check className="h-4 w-4 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
              <span dir="auto" className="min-w-0 break-words text-[15px] font-medium text-foreground">{l.label}</span>
            </li>
          ))}
        </ul>
        {!brief.renovationPreferences ? (
          <button type="button" onClick={onAddCondition} className="text-sm font-medium text-[hsl(var(--gold-ink))] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]">
            {t('mps_add_condition')}
          </button>
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row">
          <button type="button" className={primary} onClick={onStart} disabled={starting} data-action="mps-start">
            {starting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {t('mps_ready_start')}
          </button>
          <button type="button" className={quiet} onClick={onChange}>{t('mps_ready_change')}</button>
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────── The builder ────────────────────────── */

export function SearchBuilder({ t, brief, onBrief, onStart, starting, onReset }: {
  t: T; brief: SearchIntelligenceBrief; onBrief: (b: SearchIntelligenceBrief) => void; onStart: () => void; starting: boolean; onReset: () => void;
}) {
  const readiness = useMemo(() => evaluateReadiness(brief), [brief]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const question: Editing | null = editing ?? readiness.nextQuestion;
  useEffect(() => { if (readiness.state !== 'READY') setReviewing(false); }, [readiness.state]);
  const edit = (e: BriefEdit) => onBrief(applyEdit(brief, e));
  const showConfirm = readiness.state === 'READY' && !editing && !reviewing;
  return (
    <div className="space-y-5">
      {brief.originalText ? (
        <div className="flex max-w-3xl items-start gap-3">
          <p dir="auto" className="min-w-0 flex-1 rounded-2xl rounded-ss-md bg-[#0C1119] px-4 py-3 text-[15px] leading-relaxed text-white/90">{brief.originalText}</p>
        </div>
      ) : null}
      <UnderstoodPanel t={t} brief={brief} readiness={readiness} editing={editing} onEdit={(k) => { setEditing(k); setReviewing(false); }} />
      {showConfirm ? (
        <ConfirmCard t={t} brief={brief} onStart={onStart} starting={starting}
          onChange={() => setReviewing(true)} onAddCondition={() => setEditing('renovation')} />
      ) : question ? (
        <QuestionCard key={question} t={t} question={question} brief={brief} onEdit={edit} onDone={() => setEditing(null)} />
      ) : reviewing ? (
        <p className="text-sm text-muted-foreground">{t('mps_edit_hint')}</p>
      ) : null}
      {reviewing && readiness.state === 'READY' && !editing ? (
        <button type="button" className={primary} onClick={() => setReviewing(false)}>{t('mps_continue')}</button>
      ) : null}
      <button type="button" onClick={onReset} className="text-sm text-muted-foreground underline-offset-4 hover:underline">{t('mps_start_over')}</button>
    </div>
  );
}
