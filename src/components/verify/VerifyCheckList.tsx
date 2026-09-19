/*
 * THE VERIFICATIONS SOMEBODY HAS ALREADY RUN.
 *
 * This replaces a list that was reading from the wrong table. The previous
 * „თქვენი შემოწმებები" was backed by deal rooms — the storage containers —
 * which is why uploaded DOCX and PDF files appeared among property checks in
 * a customer's verification history. A verification is a research run, so
 * this reads research_jobs, and a contract is a contract, so it appears in
 * Contracts instead.
 *
 * OPENING ONE COSTS NOTHING. Every row here opens a stored report through a
 * plain SELECT — the same read the status poll performs. No research is
 * re-run, no credit is spent, and that is a property worth stating out loud
 * because the opposite would be both expensive and invisible.
 *
 * A check is identified by the thing a buyer remembers: the property. The
 * cadastral code is the fallback rather than the headline, because people
 * remember "the flat on Krtsanisi" and not twenty-four digits.
 */
import { ChevronRight, ShieldCheck, Loader2, AlertCircle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Skeleton } from '@/components/ui/skeleton';
import type { ResearchJobRecord } from '@/types/types';

/** What to call a run, in the order a person would recognise it. */
export function checkLabel(job: ResearchJobRecord, fallback: string): string {
  const candidates = [
    job.title,
    job.address,
    job.project_name,
    job.entity_name,
    job.company_name,
    job.query,
  ];
  for (const c of candidates) {
    const v = typeof c === 'string' ? c.trim() : '';
    if (v) return v;
  }
  return fallback;
}

const RUNNING = new Set(['QUEUED', 'RUNNING', 'PENDING', 'IN_PROGRESS']);
const BROKEN = new Set(['FAILED', 'ERROR']);

export function VerifyCheckList({
  items,
  loading,
  activeId,
  onOpen,
  emptyTitle,
  emptyHint,
}: {
  items: ResearchJobRecord[] | null;
  loading?: boolean;
  activeId?: string | null;
  onOpen: (id: string) => void;
  emptyTitle: string;
  emptyHint: string;
}) {
  const { t, lang } = useLanguage();

  if (loading || items === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card px-5 py-8 text-center">
        <ShieldCheck className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <p className="mt-2 font-medium text-foreground">{emptyTitle}</p>
        <p className="mx-auto mt-1 max-w-md break-words text-sm leading-relaxed text-ink-soft">
          {emptyHint}
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((j) => {
        const status = String(j.status ?? '').toUpperCase();
        const running = RUNNING.has(status);
        const broken = BROKEN.has(status);
        const label = checkLabel(j, t('verify_untitled_case_title'));
        const showCode = j.query && j.query.trim() && j.query.trim() !== label;
        return (
          <li key={j.id}>
            <button
              type="button"
              onClick={() => onOpen(j.id)}
              aria-current={activeId === j.id ? 'true' : undefined}
              className={`flex w-full min-w-0 items-center gap-3 rounded-xl border p-4 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5 ${
                activeId === j.id
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-card hover:bg-accent/40'
              }`}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <p className="min-w-0 break-words font-medium text-foreground">{label}</p>

                {showCode ? (
                  <p className="min-w-0 break-words text-sm text-ink-soft [font-variant-numeric:tabular-nums]">
                    {j.query}
                  </p>
                ) : null}

                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5">
                  {j.created_at ? (
                    <span className="text-sm text-muted-foreground">
                      {new Date(j.created_at).toLocaleDateString(lang)}
                    </span>
                  ) : null}
                  {running ? (
                    <span className="inline-flex items-center gap-1 text-sm text-primary">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      <span className="break-words">{t('vh_state_running')}</span>
                    </span>
                  ) : null}
                  {broken ? (
                    <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="break-words">{t('vh_state_failed')}</span>
                    </span>
                  ) : null}
                </div>
              </div>

              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
