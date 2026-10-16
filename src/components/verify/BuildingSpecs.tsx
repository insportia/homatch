// HOMATCH Verify — the building's documented specifications.
//
// The figures the official project documents state (technicalSpecs), grouped
// the way a buyer thinks about a building: the site and its density, the
// volume and heights, areas by use, structure and foundation, facade and
// materials, lifts and parking. Each value carries its status — Approved,
// Proposed (in an application still under review) or Unknown — and a
// proposed value is never shown as the approved one. No scores: these are
// facts with their source, and one short line per group says what the group
// means for a buyer, only when the group has data.

import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { specGroups, SPEC_GROUP_KEY, SPEC_STATUS_KEY, type SpecStatus } from '@/verify/reportPresentation';

const dmy = (iso?: string | null): string | null => {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
};
const isolate = (s: string) => `⁦${s}⁩`;

const STATUS_TONE: Record<SpecStatus, string> = {
  APPROVED: 'bg-emerald-50 text-emerald-900 ring-emerald-700/25',
  PROPOSED: 'bg-amber-50 text-amber-900 ring-amber-600/30',
  UNKNOWN: 'bg-muted text-muted-foreground ring-border',
};

export function hasBuildingSpecs(specs: unknown): boolean {
  return specGroups(specs).length > 0;
}

export const BuildingSpecs: React.FC<{ specs?: unknown }> = ({ specs }) => {
  const { t } = useLanguage();
  const groups = React.useMemo(() => specGroups(specs), [specs]);
  if (!groups.length) return null;
  const anyProposed = groups.some((g) => g.rows.some((r) => r.status === 'PROPOSED'));
  return (
    <section aria-labelledby="vrx-specs" className="space-y-4" data-specs>
      <div className="space-y-1">
        <h3 id="vrx-specs" className="font-display text-lg font-semibold leading-snug tracking-tight break-words">{t('verify_v3_specs_title')}</h3>
        <p className="max-w-[62ch] text-sm leading-6 text-muted-foreground break-words">{t('verify_v3_specs_lede')}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {groups.map((g) => {
          const keys = SPEC_GROUP_KEY[g.group];
          return (
            <section key={g.group} aria-labelledby={`vrx-spec-${g.group}`} className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5" data-spec-group={g.group}>
              <h4 id={`vrx-spec-${g.group}`} className="text-sm font-semibold break-words">{t(keys.title)}</h4>
              {keys.meaning ? <p className="mt-1 text-xs leading-5 text-muted-foreground break-words">{t(keys.meaning)}</p> : null}
              <dl className="mt-3 divide-y divide-border">
                {g.rows.map((r, i) => {
                  const date = dmy(r.date);
                  const meta = [r.caseRef ? t('verify_v3_case_ref', { ref: isolate(r.caseRef) }) : null, date ? isolate(date) : null].filter(Boolean).join(' · ');
                  return (
                    <div key={`${r.key}-${r.status}-${i}`} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 py-2.5">
                      <dt className="min-w-0 flex-1 basis-[9rem] text-sm leading-5 text-foreground/80 break-words" dir="auto">{r.label}</dt>
                      <dd className="min-w-0 max-w-full text-end">
                        <span className="block text-sm font-semibold leading-5 break-words" dir="auto">{r.value}</span>
                        <span className={`mt-1 inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-start text-2xs font-semibold ring-1 ${STATUS_TONE[r.status]}`} data-status={r.status}>
                          {t(SPEC_STATUS_KEY[r.status])}
                        </span>
                        {meta ? <span className="mt-0.5 block text-2xs leading-4 text-muted-foreground">{meta}</span> : null}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </section>
          );
        })}
      </div>
      {anyProposed ? <p className="text-xs leading-5 text-muted-foreground break-words">{t('verify_v3_specs_proposed_note')}</p> : null}
    </section>
  );
};
