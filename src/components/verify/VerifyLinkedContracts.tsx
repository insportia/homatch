/*
 * „HAVE I ALREADY CHECKED A CONTRACT FOR THIS PROPERTY?"
 *
 * The report offered to read a contract and said nothing about the ones it
 * had already read, so the only way to find out was to leave, open Contracts,
 * and recognise a file name. That is a question about THIS property, which
 * makes it Verify's to answer.
 *
 * IT ANSWERS AND HANDS OFF. It does not render the analysis — no clauses, no
 * obligations, no money, no questions. Those are Contracts' and belong on the
 * contract's own page; repeating them here would rebuild the workspace this
 * product just got rid of, one section at a time. What it gives is the name,
 * whether it has been read, when, whether it disagrees with the verification,
 * and a way in.
 *
 * THE ONE JUDGEMENT IT MAKES, AND WHY IT IS THE RIGHT ONE.
 *
 * A contract stored against this property can still be about a DIFFERENT
 * UNIT. Proven in production: a parking space at 01.18.06.019.055.01.04.003
 * filed against a flat verified as 01.18.06.019.055.03.01.601 — same parent
 * parcel 01.18.06.019.055, same street, different property. Both are true at
 * once and a buyer needs to know it before signing, so a unit difference is
 * surfaced here rather than smoothed into "same property". The comparison is
 * the same deterministic one Contracts runs, so the two screens cannot
 * disagree about the same pair of codes.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, FileSignature, Loader2, AlertTriangle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Skeleton } from '@/components/ui/skeleton';
import { VerifySection } from '@/components/verify/ui';
import { listContractsForRoom } from '@/services/contracts';
import { compareContractToVerify, type AnalysisLike } from '@/verify/intelligence/contractMatch';

interface LinkedContract {
  id: string;
  label: string;
  uploadedAt: string | null;
  analysisState: string;
  /** True only when the document names a genuinely different unit. */
  unitMismatch: boolean;
}

const BUSY = new Set(['QUEUED', 'RUNNING']);
const BROKEN = new Set(['FAILED', 'UNSUPPORTED', 'REQUIRES_OCR']);

export function VerifyLinkedContracts({
  roomId,
  cadastralCode,
  address,
}: {
  /** The verification's own container. Null before the first contract. */
  roomId?: string | null;
  cadastralCode?: string | null;
  address?: string | null;
}) {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [rows, setRows] = useState<(LinkedContract[]) | null>(null);

  const context = useMemo(
    () => ({ cadastralCode: cadastralCode ?? null, address: address ?? null, company: null }),
    [cadastralCode, address]
  );

  useEffect(() => {
    if (!roomId) { setRows([]); return; }
    let alive = true;
    listContractsForRoom(roomId)
      .then((docs) => {
        if (!alive) return;
        setRows(
          docs.map((d) => {
            const analysis = (d.analysis ?? null) as AnalysisLike | null;
            // Only a real disagreement counts. A contract that never states a
            // cadastral code is INSUFFICIENT, which is the common case and is
            // emphatically not a finding against anyone.
            const cadastral = analysis
              ? compareContractToVerify(analysis, context).find((r) => r.field === 'CADASTRAL')
              : undefined;
            return {
              id: d.id,
              label: d.label,
              uploadedAt: d.uploadedAt,
              analysisState: d.analysisState,
              unitMismatch: cadastral?.state === 'MISMATCH',
            };
          })
        );
      })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [roomId, context]);

  if (rows === null) return <Skeleton className="h-16 w-full" />;

  /*
   * Nothing checked yet. One line, not a card: the contract upload sits
   * immediately below, so a full empty state with its own illustration and
   * call to action would be the same offer made twice.
   */
  if (rows.length === 0) {
    return (
      <p className="min-w-0 break-words px-1 text-sm text-muted-foreground">
        {t('vl_none')}
      </p>
    );
  }

  return (
    <VerifySection
      eyebrow={t('vl_eyebrow')}
      title={t('vl_title')}
      subtitle={t('vl_subtitle')}
      /* The gold hairline only when a document disagrees about the unit. */
      accent={rows.some((r) => r.unitMismatch)}
    >
      <ul className="space-y-2">
        {rows.map((r) => {
          const busy = BUSY.has(r.analysisState);
          const broken = BROKEN.has(r.analysisState);
          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => navigate(`/contracts/${r.id}`)}
                className="flex w-full min-w-0 items-center gap-3 rounded-xl border border-border bg-background/40 p-3 text-start transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <FileSignature className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />

                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="block min-w-0 break-words text-sm font-medium text-foreground">
                    {r.label || t('ct_untitled')}
                  </span>

                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {r.uploadedAt ? (
                      <span className="text-2xs text-muted-foreground">
                        {new Date(r.uploadedAt).toLocaleDateString(lang)}
                      </span>
                    ) : null}

                    {busy ? (
                      <span className="inline-flex items-center gap-1 text-2xs text-primary">
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                        <span className="break-words">{t('ct_state_reading')}</span>
                      </span>
                    ) : broken ? (
                      <span className="text-2xs text-muted-foreground">{t('ct_state_unreadable')}</span>
                    ) : (
                      <span className="text-2xs text-muted-foreground">{t('vl_state_read')}</span>
                    )}

                    {/* The only thing here allowed to look like a warning. */}
                    {r.unitMismatch ? (
                      <span className="inline-flex min-w-0 items-center gap-1 text-2xs text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span className="min-w-0 break-words">{t('vl_unit_mismatch')}</span>
                      </span>
                    ) : null}
                  </span>
                </span>

                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </VerifySection>
  );
}
