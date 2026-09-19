/*
 * THE CONTRACTS SOMEBODY HAS ALREADY HAD READ.
 *
 * One list, two placements: the entry page asks for the recent few, the
 * history page asks for all of them. They must look identical, because they
 * are the same thing at two lengths — a customer who learns to read this list
 * on one screen should not have to learn it again on the other.
 *
 * A contract is identified by the thing a person remembers: what they called
 * the file, and when they uploaded it. Where the upload was made against a
 * verified property, the property is shown too, because "the contract for the
 * Krtsanisi flat" is how people actually hold these in their heads.
 *
 * Internal state is not a list-screen concern. The only state shown is the
 * one that changes what tapping the row will do: a contract still being read,
 * and a contract that could not be read.
 */
import { useNavigate } from 'react-router-dom';
import { ChevronRight, FileText, Loader2, AlertCircle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Skeleton } from '@/components/ui/skeleton';
import type { ContractSummary } from '@/services/contracts';

const BUSY = new Set(['QUEUED', 'RUNNING']);
const BROKEN = new Set(['FAILED', 'UNSUPPORTED', 'REQUIRES_OCR']);

export function ContractList({
  items,
  loading,
  emptyTitle,
  emptyHint,
}: {
  items: ContractSummary[] | null;
  loading?: boolean;
  emptyTitle: string;
  emptyHint: string;
}) {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();

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
        <FileText className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <p className="mt-2 font-medium text-foreground">{emptyTitle}</p>
        <p className="mx-auto mt-1 max-w-md break-words text-sm leading-relaxed text-ink-soft">
          {emptyHint}
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((c) => {
        const busy = BUSY.has(c.analysisState);
        const broken = BROKEN.has(c.analysisState);
        const property = c.address || c.cadastralCode;
        return (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => navigate(`/contracts/${c.id}`)}
              className="flex w-full min-w-0 items-center gap-3 rounded-xl border border-border bg-card p-4 text-start transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <p className="min-w-0 break-words font-medium text-foreground">
                  {c.label || t('ct_untitled')}
                </p>

                {property ? (
                  <p className="min-w-0 break-words text-sm text-ink-soft">{property}</p>
                ) : null}

                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5">
                  {c.uploadedAt ? (
                    <span className="text-sm text-muted-foreground">
                      {new Date(c.uploadedAt).toLocaleDateString(lang)}
                    </span>
                  ) : null}

                  {busy ? (
                    <span className="inline-flex items-center gap-1 text-sm text-primary">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      <span className="break-words">{t('ct_state_reading')}</span>
                    </span>
                  ) : null}

                  {broken ? (
                    <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="break-words">{t('ct_state_unreadable')}</span>
                    </span>
                  ) : null}
                </div>
              </div>

              <ChevronRight
                className="h-5 w-5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
