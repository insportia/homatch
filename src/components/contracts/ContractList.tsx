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
 * Every row says its state in one chip (ready, being read, could not be read)
 * and can be deleted. DELETION IS THE SERVER'S DECISION: deleteContract calls
 * contract_document_delete, which checks ownership and refuses a contract that
 * is still being read or is under a retention hold; the row disappears only
 * after the server said yes, and a refusal is said in words.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, ChevronRight, FileText, Loader2, Trash2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { deleteContract, type ContractSummary } from '@/services/contracts';

const BUSY = new Set(['QUEUED', 'RUNNING']);
const BROKEN = new Set(['FAILED', 'UNSUPPORTED', 'REQUIRES_OCR']);

export function ContractList({
  items,
  loading,
  emptyTitle,
  emptyHint,
  onDeleted,
}: {
  items: ContractSummary[] | null;
  loading?: boolean;
  emptyTitle: string;
  emptyHint: string;
  /** Present = rows can be deleted; called with the id once the server deleted it. */
  onDeleted?: (id: string) => void;
}) {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState<ContractSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (loading || items === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full rounded-2xl" />
        <Skeleton className="h-20 w-full rounded-2xl" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card px-5 py-8 text-center shadow-card">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--gold-soft))] ring-1 ring-[hsl(var(--gold-border))]/60" aria-hidden="true"><FileText className="h-6 w-6 text-foreground" /></span>
        <p className="mt-2 font-medium text-foreground">{emptyTitle}</p>
        <p className="mx-auto mt-1 max-w-md break-words text-sm leading-relaxed text-ink-soft">
          {emptyHint}
        </p>
      </div>
    );
  }

  const confirmDelete = async () => {
    if (!confirming) return;
    setDeleting(true);
    setMessage(null);
    const target = confirming;
    const r = await deleteContract(target.id);
    setDeleting(false);
    setConfirming(null);
    if (r.ok) {
      setMessage(t('ux_ct_deleted'));
      onDeleted?.(target.id);
    } else {
      setMessage(t(`ux_ct_delete_${r.reason}`));
    }
  };

  return (
    <>
      {message ? <p role="status" className="mb-3 rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground">{message}</p> : null}
      <ul className="space-y-3">
        {items.map((c) => {
          const busy = BUSY.has(c.analysisState);
          const broken = BROKEN.has(c.analysisState);
          const ready = c.analysisState === 'DONE';
          const property = c.address || c.cadastralCode;
          return (
            <li key={c.id} className="group flex min-w-0 items-stretch overflow-hidden rounded-2xl border border-border bg-card shadow-card transition-colors hover:border-[hsl(var(--gold-border))]/70">
              <button
                type="button"
                onClick={() => navigate(`/contracts/${c.id}`)}
                className="flex min-w-0 flex-1 items-center gap-3 p-4 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-5"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#0C1119] text-[hsl(38_92%_60%)]" aria-hidden="true">
                  <FileText className="h-5 w-5" />
                </span>
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
                        {new Date(c.uploadedAt).toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                    ) : null}
                    {ready ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span className="break-words">{t('ux_ct_state_ready')}</span>
                      </span>
                    ) : null}
                    {busy ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--gold-soft))] px-2 py-0.5 text-xs font-medium text-[hsl(var(--gold-ink))]">
                        <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                        <span className="break-words">{t('ct_state_reading')}</span>
                      </span>
                    ) : null}
                    {broken ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span className="break-words">{t('ct_state_unreadable')}</span>
                      </span>
                    ) : null}
                  </div>
                </div>
                <ChevronRight
                  className="h-5 w-5 shrink-0 text-foreground/70 transition-colors group-hover:text-[hsl(var(--gold-ink))] rtl:rotate-180"
                  aria-hidden="true"
                />
              </button>
              {onDeleted ? (
                <button
                  type="button"
                  onClick={() => { setMessage(null); setConfirming(c); }}
                  disabled={busy}
                  title={busy ? t('ux_ct_delete_busy') : undefined}
                  aria-label={t('ux_ct_delete_aria', { name: c.label || t('ct_untitled') })}
                  className={cn('flex w-12 shrink-0 items-center justify-center border-s border-border text-muted-foreground transition-colors sm:w-14',
                    busy ? 'cursor-not-allowed opacity-40' : 'hover:bg-destructive/5 hover:text-[hsl(var(--destructive))]')}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>

      <AlertDialog open={!!confirming} onOpenChange={(open) => { if (!open && !deleting) setConfirming(null); }}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="break-words">{t('ux_ct_delete_title')}</AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              {t('ux_ct_delete_body', { name: confirming?.label || t('ct_untitled') })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t('ct_rev_cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => { e.preventDefault(); void confirmDelete(); }}
              className="bg-[hsl(var(--destructive))] text-white hover:bg-[hsl(var(--destructive))]/90"
            >
              {deleting ? <Loader2 className="me-1.5 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Trash2 className="me-1.5 h-4 w-4" aria-hidden="true" />}
              {t('ux_ct_delete_confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
