// HOMATCH Verify — the legal reality of the apartment, scope by scope.
//
// The approved introduction, then the findings at once, each with the date
// of its record (legalStatus.ts legalFindings). Today's official position of
// the project (LegalPosition) and, once, the identity notice when the records
// concern a different building of the same parcel or only the parcel itself.
// The five-stage circle widget was removed (owner, 2026-10-11).

import React from 'react';
import { Landmark, Hourglass } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { legalPosition, identityNotice, type IdentityLike } from '@/verify/reportPresentation';
import { legalFindings, type LegalFinding, type LegalFindingScope } from '@/verify/intelligence/legalStatus';
import { readProjectSignals } from '@/verify/intelligence/projectStory';
import { evolutionView, openApplications } from '@/verify/intelligence/projectEvolution';
import { apartmentCopy, copyKindOf, kindT, nounKey } from '@/verify/intelligence/kindGuard';

const day = (iso?: string | null): string | null => {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
};
const isolate = (s: string): string => `⁦${s}⁩`;

export const IdentityNotice: React.FC<{ identity?: IdentityLike | null; kind?: string }> = ({ identity, kind }) => {
  const { t } = useLanguage();
  const n = identityNotice(identity);
  if (!n) return null;
  return (
    <div role="note" className="rounded-2xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft)/0.60)] px-4 py-3.5 sm:px-5">
      <p className="text-sm font-semibold break-words">{kindT(t, 'vrx_identity_title', kind)}</p>
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

/**
 * THE LEGAL SECTION (owner, 2026-10-11): the approved introduction, then the
 * findings at once, scope by scope (the exact apartment, its parcel, its
 * building, current and earlier ownership, a cancelled mortgage, a mortgage
 * in force, other restrictions, the developer's obligations, the project's
 * financing, applications on file), each with the date of the record it
 * rests on. An extract shows its own day, never "today" (legalStatus.ts).
 *
 * The five-stage construction widget (green and grey circles repeating
 * "could not be confirmed") is gone: construction activity, completion,
 * approval and commissioning are told in the project's story instead
 * (ProjectStory.tsx). `legal` stays accepted so older mounts compile; it no
 * longer draws anything.
 */
export const LegalReality: React.FC<{ legal?: unknown; synthesis?: unknown; signals?: unknown }> = ({ synthesis, signals }) => {
  if (!synthesis) return null;
  return <LegalFindings synthesis={synthesis} signals={signals} />;
};

/* EXACT_UNIT for a non-apartment: the registry kind's own label (kindGuard.nounKey). */
const SCOPE_KEY: Record<LegalFindingScope, string> = {
  EXACT_UNIT: 'verify_v6s_scope_unit',
  PARENT_PARCEL: 'verify_v6s_scope_parcel',
  BUILDING: 'verify_v6s_scope_building',
  COMPANY: 'verify_v6s_scope_company',
  PROJECT: 'verify_v6s_scope_project',
};
const FINDING_TONE: Record<LegalFinding['tone'], string> = {
  positive: 'border-emerald-700/40',
  neutral: 'border-[hsl(var(--gold-border))]',
  attention: 'border-amber-500/60',
};

export const LegalFindings: React.FC<{ synthesis?: unknown; signals?: unknown }> = ({ synthesis, signals }) => {
  const { t } = useLanguage();
  const view = React.useMemo(() => {
    const s = (synthesis && typeof synthesis === 'object' ? synthesis : {}) as Record<string, unknown>;
    const r = (s.report && typeof s.report === 'object' ? s.report : {}) as Record<string, unknown>;
    const sig = readProjectSignals(signals ?? r.projectSignals ?? s.projectSignals);
    const history = s.officialHistory;
    const evo = evolutionView({ history, evolution: sig?.evolution ?? [] });
    return legalFindings({
      unitLegalPosition: s.unitLegalPosition,
      unitIdentity: s.unitIdentity,
      companyFinance: s.companyFinance,
      applications: history ? { open: openApplications(history, sig?.evolution ?? []), resolvedOn: (evo?.resolved ?? []).map((x) => x.decidedOn ?? '').filter(Boolean) } : null,
      kind: copyKindOf(s),
    });
  }, [synthesis, signals]);
  const kind = copyKindOf(synthesis);
  return (
    <section aria-labelledby="vrx-legal-findings" className="space-y-4" data-legal-findings>
      <div className="space-y-2">
        <h3 id="vrx-legal-findings" className="font-display text-xl font-semibold leading-snug tracking-tight break-words">{t('verify_v6s_legal_title')}</h3>
        {kindT(t, 'verify_v6s_legal_body', kind).split(/\n+/).map((p, i) => (
          <p key={i} className="max-w-[68ch] text-[15px] leading-7 text-foreground/90 break-words">{p}</p>
        ))}
      </div>
      {view ? (
        <>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {view.findings.map((f) => (
              <li key={`${f.key}-${f.observedOn ?? ''}`} className={`min-w-0 rounded-2xl border-s-4 border border-border bg-card p-4 ${FINDING_TONE[f.tone]}`} data-legal-finding={f.key} data-scope={f.scope}>
                <p className="text-2xs font-semibold uppercase tracking-[0.06em] text-[hsl(var(--gold-ink))]">{t(f.scope === 'EXACT_UNIT' && !apartmentCopy(kind) ? nounKey(kind, 'scope') : SCOPE_KEY[f.scope])}</p>
                <p className="mt-1 text-sm leading-6 text-foreground/90 break-words" dir="auto">{f.text}</p>
                <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-muted-foreground">
                  {day(f.observedOn) ? <span>{t('verify_v6s_observed', { date: isolate(day(f.observedOn)!) })}</span> : null}
                  {f.ref ? <bdi dir="ltr" className="font-mono tabular-nums">{f.ref}</bdi> : null}
                </p>
              </li>
            ))}
          </ul>
          {view.freshnessNote ? <p className="text-sm leading-6 text-muted-foreground break-words" data-legal-freshness>{view.freshnessNote}</p> : null}
        </>
      ) : null}
    </section>
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
export const LegalPosition: React.FC<{ history?: unknown; signals?: unknown }> = ({ history, signals }) => {
  const { t } = useLanguage();
  const pos = legalPosition(history);
  if (!pos) return null;
  const { effective, conflicts } = pos;
  /* An application whose own published act shows a decision is not pending
     (job eeefada9: 7869341 and 7930086 read "შედეგი: თანხმობა"). */
  const open = new Set(openApplications(history, readProjectSignals(signals)?.evolution ?? []).map((p) => p.caseRef ?? ''));
  const pending = pos.pending.filter((p) => !p.caseRef || open.has(p.caseRef));
  if (!effective && !pending.length && !conflicts) return null;
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
