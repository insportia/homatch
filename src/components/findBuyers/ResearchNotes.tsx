// RESEARCH NOTES — what this search's records say, in plain sentences.
//
// Each note is a code the server computed from the campaign's rows
// (find_buyers_campaign_report → notes) with the numbers behind it; this
// component only words it in the reader's language. A code the screen does
// not know is skipped, never guessed at.
import React from 'react';
import { NotebookPen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { GOLD_TEXT, sourceStyle } from '@/components/findBuyers/brand';
import { researchNotes, type CampaignReport, type Formatters } from '@/findBuyers/campaignReport';

export function useReportFormatters(): Formatters {
  const { t } = useLanguage();
  return React.useMemo(() => ({
    sources: (codes: string[]) => codes.map((c) => sourceStyle(c).label).join(', '),
    languages: (codes: string[]) => codes.map((c) => {
      const k = `fbx_lang_${c}`;
      const s = t(k);
      return s === k ? c.toUpperCase() : s;
    }).join(', '),
  }), [t]);
}

export function ResearchNotes({ report, className }: { report: CampaignReport; className?: string }) {
  const { t } = useLanguage();
  const fmt = useReportFormatters();
  const notes = researchNotes(report, fmt);
  if (notes.length === 0) return null;
  return (
    <section aria-labelledby="fbr-notes-title" data-testid="fbr-research-notes"
      className={cn('rounded-xl bg-[hsl(218_55%_8%/0.55)] p-3.5 ring-1 ring-inset ring-[hsl(40_80%_55%/0.3)]', className)}>
      <h3 id="fbr-notes-title" className="flex items-center gap-2 text-sm font-semibold text-white">
        <NotebookPen className={cn('h-4 w-4 shrink-0', GOLD_TEXT)} aria-hidden="true" />
        {t('fbr_sec_notes')}
      </h3>
      <p className="mt-0.5 text-2xs text-[hsl(218_40%_80%)]">{t('fbr_notes_intro')}</p>
      <ol className="mt-2.5 space-y-2">
        {notes.map((m, i) => (
          <li key={`${m.key}-${i}`} data-note={m.key}
            className="flex gap-2.5 text-2xs leading-relaxed text-[hsl(218_40%_92%)]">
            <span className={cn('mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[hsl(40_94%_64%/0.14)] text-[0.65rem] font-bold tabular-nums ring-1 ring-inset ring-[hsl(40_80%_60%/0.45)]', GOLD_TEXT)}>
              {i + 1}
            </span>
            <span className="min-w-0 break-words">{t(m.key, m.vars)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default ResearchNotes;
