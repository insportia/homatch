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
import { Check, AlertTriangle, Circle, Minus, CircleDashed } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  legalRows,
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
    <div role="note" className="rounded-2xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]/60 px-4 py-3.5 sm:px-5">
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
