// HOMATCH Verify — the legal reality of the building, state by state.
//
// Five distinct legal states, in the order a building lives through them,
// each shown with exactly the status the records establish
// (src/verify/intelligence/legalStatus.ts). The presentation lives in
// LEGAL_STATUS_VIEW (src/verify/reportPresentation.ts) and has no negative
// tone at all: NOT_VERIFIED reads "could not be confirmed from the records
// read" — never "no" — because a record HOMATCH did not read is not evidence
// that something did not happen.
//
// Also here, once: the identity notice, when the records concern a different
// building of the same parcel or only the parcel itself.

import React from 'react';
import { Check, AlertTriangle, Circle, Minus, CircleDashed, Landmark, Hourglass } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  legalRows,
  legalPosition,
  identityNotice,
  LEGAL_CLAIM_KEY,
  LEGAL_STATUS_VIEW,
  type IdentityLike,
  type LegalTone,
} from '@/verify/reportPresentation';

const day = (iso?: string | null): string | null => {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
};
const isolate = (s: string): string => `⁦${s}⁩`;

const TONE: Record<LegalTone, { dot: string; text: string; line: string }> = {
  confirmed: { dot: 'bg-emerald-600 text-white ring-emerald-600/20', text: 'text-emerald-800', line: 'bg-emerald-600/50' },
  partial: { dot: 'bg-[hsl(var(--gold))] text-[hsl(222_47%_11%)] ring-[hsl(var(--gold-border))]', text: 'text-[hsl(var(--gold-ink))]', line: 'bg-[hsl(var(--gold-border))]' },
  attention: { dot: 'bg-amber-100 text-amber-800 ring-amber-500/40', text: 'text-amber-800', line: 'bg-border' },
  neutral: { dot: 'bg-card text-muted-foreground ring-border', text: 'text-muted-foreground', line: 'bg-border' },
};

const ICON = {
  check: Check,
  half: Circle,
  alert: AlertTriangle,
  open: CircleDashed,
  dash: Minus,
} as const;

export const IdentityNotice: React.FC<{ identity?: IdentityLike | null }> = ({ identity }) => {
  const { t } = useLanguage();
  const n = identityNotice(identity);
  if (!n) return null;
  return (
    <div role="note" className="rounded-2xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft)/0.60)] px-4 py-3.5 sm:px-5">
      <p className="text-sm font-semibold break-words">{t('vrx_identity_title')}</p>
      <p className="mt-1 text-sm leading-6 text-foreground/85 break-words">
        {t(n.key, Object.fromEntries(Object.entries(n.vars).map(([k, v]) => [k, isolate(v)])))}
      </p>
      {n.codes.length ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {n.codes.map((c) => (
            <li key={c}>
              <bdi dir="ltr" className="inline-block rounded-md bg-card px-2 py-0.5 font-mono text-2xs tabular-nums ring-1 ring-border">{c}</bdi>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
};

export const LegalReality: React.FC<{ legal?: unknown }> = ({ legal }) => {
  const { t } = useLanguage();
  const rows = legalRows(legal);
  if (!rows.length) return null;
  return (
    <div className="space-y-3">
      <ol className="relative grid grid-cols-1 gap-0 lg:grid-cols-5 lg:gap-3" aria-label={t('vrx_legal_states_label')}>
        {rows.map((r, i) => {
          const view = LEGAL_STATUS_VIEW[r.status];
          const tone = TONE[view.tone];
          const Icon = ICON[view.icon];
          const basis = r.basis
            .map((b) => [day(b.date), b.decisionNumber ? `№ ${b.decisionNumber}` : null, b.block ? t('vrx_visual_block', { block: b.block }) : null].filter(Boolean).join(' · '))
            .filter(Boolean)
            .slice(0, 2);
          return (
            <li key={r.key} className="relative flex gap-3 pb-5 last:pb-0 lg:flex-col lg:gap-2 lg:pb-0" data-status={r.status}>
              {/* the connector between states */}
              {i < rows.length - 1 ? (
                <span className={`absolute start-[15px] top-8 bottom-0 w-px lg:hidden ${tone.line}`} aria-hidden="true" />
              ) : null}
              <span className={`relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ${tone.dot}`} aria-hidden="true">
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-semibold leading-5 break-words">{t(LEGAL_CLAIM_KEY[r.key])}</p>
                <p className={`text-xs font-medium leading-5 break-words ${tone.text}`}>{t(view.labelKey)}</p>
                {basis.map((b, n) => (
                  <p key={n} className="text-2xs leading-4 text-muted-foreground"><bdi dir="ltr" className="tabular-nums">{b}</bdi></p>
                ))}
              </div>
            </li>
          );
        })}
      </ol>
      {rows.some((r) => r.status === 'NOT_VERIFIED') ? (
        <p className="text-xs leading-5 text-muted-foreground break-words">{t('vrx_legal_not_verified_note')}</p>
      ) : null}
    </div>
  );
};

/**
 * TODAY'S OFFICIAL POSITION, BEFORE THE FIVE STATES.
 *
 * The decision in force first (kind, date, decision number), then every
 * application still under review — and an application under review is shown
 * as exactly that: "under review — not yet decided", with its deadline. It is
 * never painted green, never called approved, and never merged into the
 * effective decision above it.
 */
export const LegalPosition: React.FC<{ history?: unknown }> = ({ history }) => {
  const { t } = useLanguage();
  const pos = legalPosition(history);
  if (!pos) return null;
  const { effective, pending, conflicts } = pos;
  return (
    <div className="space-y-3" data-legal-position>
      {effective ? (
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-700/20 bg-emerald-50/60 p-4 sm:p-5" data-effective>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-700 text-white" aria-hidden="true">
            <Landmark className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 space-y-0.5">
            <p className="text-2xs font-semibold uppercase tracking-[0.06em] text-emerald-800">{t('verify_v3_position_effective')}</p>
            <p className="text-[15px] font-semibold leading-6 break-words">{t(effective.kindKey)}</p>
            <p className="text-xs leading-5 text-foreground/75 break-words">
              {[
                day(effective.date) ? t('verify_v3_position_since', { date: isolate(day(effective.date)!) }) : null,
                effective.decisionNumber ? t('verify_v3_position_decision', { number: isolate(effective.decisionNumber) }) : null,
                effective.caseRef ? t('verify_v3_case_ref', { ref: isolate(effective.caseRef) }) : null,
              ].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
      ) : null}

      {pending.length ? (
        <section aria-labelledby="vrx-pending" className="rounded-2xl border border-amber-500/40 bg-amber-50/50 p-4 sm:p-5" data-pending>
          <h3 id="vrx-pending" className="flex items-center gap-2 text-sm font-semibold break-words">
            <Hourglass className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
            {t('verify_v3_pending_title', { count: String(pending.length) })}
          </h3>
          <ul className="mt-3 space-y-3">
            {pending.map((p, i) => (
              <li key={p.caseRef ?? i} className="border-s-2 border-amber-500/60 ps-3">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex max-w-full items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-2xs font-semibold text-amber-900 ring-1 ring-amber-600/30">
                    {t('verify_v3_pending_chip')}
                  </span>
                  {p.caseRef ? <span className="text-xs text-muted-foreground">{t('verify_v3_case_ref', { ref: isolate(p.caseRef) })}</span> : null}
                </p>
                {p.subject ? <p className="mt-1 text-sm leading-6 break-words" dir="auto">{p.subject}</p> : null}
                <p className="text-xs leading-5 text-muted-foreground break-words">
                  {[
                    day(p.date) ? t('verify_v3_pending_filed', { date: isolate(day(p.date)!) }) : null,
                    day(p.deadline) ? t('verify_v3_pending_deadline', { date: isolate(day(p.deadline)!) }) : null,
                  ].filter(Boolean).join(' · ')}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-5 text-foreground/75 break-words">{t(effective ? 'verify_v3_pending_note' : 'verify_v3_pending_note_plain')}</p>
        </section>
      ) : null}

      {conflicts ? (
        <p className="text-xs leading-5 text-muted-foreground break-words">{t('verify_v3_position_conflicts', { count: String(conflicts) })}</p>
      ) : null}
    </div>
  );
};
