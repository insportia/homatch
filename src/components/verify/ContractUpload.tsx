/*
 * UPLOAD A CONTRACT.
 *
 * One action, one tap, and Homatch does the rest.
 *
 * WHAT THIS REPLACES
 *
 * There were three ways to give Homatch a contract and only one of them
 * worked:
 *
 *   - the Verification Center card uploaded the file and then simply stopped.
 *     Nothing requested an analysis, so the contract sat in the case unread,
 *     no job existed, and it never appeared in Running tasks. The customer
 *     had to find the card's overflow menu and choose "Read it again" — for a
 *     document that had never been read once.
 *   - the "Upload the contract" button on a finished report uploaded nothing
 *     at all. It navigated to `/verify/<case>?tab=documents` and left the
 *     customer to locate an upload control on the page it landed on.
 *   - the case's own drop zone did work, and was two navigations deep.
 *
 * All three now go through this component, so there is exactly one answer to
 * "how do I get my contract checked".
 *
 * WHY THERE IS NO SECOND BUTTON
 *
 * Choosing the file IS the instruction. Nothing else is asked — no category,
 * no title, no analysis mode — because every one of those is either derivable
 * from the document or an internal concern the customer should never meet.
 * So selection starts the work immediately, and the only control after it is
 * the one that undoes it.
 *
 * WHAT IT OFFERS, AND WHY ONLY THAT
 *
 * PDF and DOCX, because those are the only two formats
 * deal-room-document-analyze can actually read. The bucket accepts JPEG, PNG,
 * WEBP and legacy .doc as well, and a photographed contract therefore used to
 * upload perfectly, show a reading state, and then terminate as UNSUPPORTED —
 * which the retry path explicitly refuses to re-run. Offering a format we
 * cannot read is a promise broken a minute later, so the picker does not
 * offer it. No camera capture for the same reason: there is no OCR path.
 */
import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { FileText, Loader2, X, AlertTriangle } from 'lucide-react';
import { createDocumentVerificationCase, deleteDealRoom } from '@/services/dealRooms';
import { uploadDocument } from '@/services/dealRoomDocuments';
import { requestAnalysis } from '@/services/documentWorkspace';
import {
  validateContractUpload, CONTRACT_ACCEPT, CONTRACT_FORMATS, MAX_MB,
} from '@/services/uploadValidation';

/** Why a file was refused, in the customer's own terms. Every one of these
 *  says what to do next rather than only what went wrong. */
const REJECTION_KEY: Record<string, string> = {
  TOO_LARGE: 'contract_err_too_large',
  UNSUPPORTED_TYPE: 'contract_err_bad_type',
  SUSPICIOUS_NAME: 'contract_err_bad_name',
  EMPTY: 'contract_err_empty',
};

type Phase = 'idle' | 'working' | 'error';

/** Bytes as something a person reads, without a library. */
function readableSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const ContractUpload: React.FC<{
  /** Upload into this existing verification case. Omitted → a case is made. */
  caseId?: string | null;
  /** `full` is the Center's card; `inline` is a button inside a finished report. */
  variant?: 'full' | 'inline';
  className?: string;
}> = ({ caseId = null, variant = 'full', className }) => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  /*
   * DOUBLE SUBMIT.
   *
   * `phase` drives rendering and therefore lags a synchronous second event by
   * a render. A ref flips immediately, so a double-tap on a phone — two
   * `change` events before React commits — cannot start two uploads and
   * create two cases. The disabled attribute is the courtesy; this is the
   * control.
   */
  const running = useRef(false);

  const reset = () => {
    setFile(null);
    setError(null);
    setPhase('idle');
    if (inputRef.current) inputRef.current.value = '';
  };

  const onPick = async (picked: File | undefined) => {
    if (!picked || running.current) return;
    setError(null);

    const check = validateContractUpload({ name: picked.name, size: picked.size, type: picked.type });
    if (!check.ok) {
      setFile(picked);
      setPhase('error');
      setError(
        t(REJECTION_KEY[check.reason] ?? 'contract_err_bad_type')
          .replace('{formats}', CONTRACT_FORMATS)
          .replace('{max}', String(MAX_MB))
      );
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    running.current = true;
    setFile(picked);
    setPhase('working');

    // Only a case THIS call created may be cleaned up on failure; an existing
    // one belongs to the customer and is never touched.
    let createdCaseId: string | null = null;
    try {
      let targetCase = caseId;
      if (!targetCase) {
        const created = await createDocumentVerificationCase(picked.name);
        createdCaseId = created.id;
        targetCase = created.id;
      }

      const { documentId } = await uploadDocument({ roomId: targetCase, file: picked });

      /*
       * THE STEP THAT WAS MISSING.
       *
       * Queues the analysis on the existing pipeline, which creates the
       * background job (so the contract appears in Running tasks), writes the
       * result_ref the task CTA navigates back to, and kicks the function so
       * it starts within seconds instead of on the next worker tick. It is
       * idempotent on `document:<id>`, so a retry cannot buy the same read
       * twice.
       */
      await requestAnalysis({ id: documentId, caseId: targetCase, name: picked.name });

      /*
       * Straight to the contract's own page.
       *
       * This used to land on /verify/:id?tab=documents — the Verification
       * Case's Documents tab, which is the Deal Room workspace the customer
       * no longer sees. Contracts is a product now, and its result page is
       * where a contract's progress and result live. `startedAt` is passed
       * because this call KNOWS when the upload finished; a deep link later
       * cannot, and falls back to the row's own timestamp.
       */
      navigate(`/contracts/${documentId}`, { state: { startedAt: Date.now() } });
    } catch {
      if (createdCaseId) {
        // An empty case is worse than no case — it would sit in the list
        // claiming a verification that never started.
        try {
          await deleteDealRoom(createdCaseId);
        } catch {
          /* best effort; the case is empty either way */
        }
      }
      setPhase('error');
      setError(t('contract_err_upload_failed'));
    } finally {
      running.current = false;
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const busy = phase === 'working';

  return (
    <div className={className}>
      {/*
        * A real file input with a real accessible name, visually hidden but
        * focusable-by-label. The button below owns the tap target.
        */}
      <input
        ref={inputRef}
        type="file"
        accept={CONTRACT_ACCEPT}
        className="sr-only"
        aria-label={t('contract_upload_cta')}
        disabled={busy}
        onChange={(e) => void onPick(e.target.files?.[0])}
      />

      {variant === 'full' ? (
        <div className="space-y-2">
          <div className="flex items-start gap-3">
            <FileText className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="break-words text-sm font-medium">{t('contract_upload_title')}</p>
              <p className="measure mt-1 break-words text-base leading-relaxed text-ink-soft">
                {t('contract_upload_hint')}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <Button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        /* Full width and a real touch target on a phone; wraps rather than
           clips, because the translated label is long in several languages. */
        className="mt-3 h-auto min-h-12 w-full gap-2 whitespace-normal py-3 text-start leading-snug sm:w-auto"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
        ) : (
          <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
        )}
        <span className="min-w-0 break-words">
          {busy ? t('contract_upload_working') : t('contract_upload_cta')}
        </span>
      </Button>

      {/* The chosen file, with one obvious way to undo it. */}
      {file ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card/60 p-3">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1 basis-full break-all text-sm sm:basis-0">{file.name}</span>
          <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
            {readableSize(file.size)}
          </span>
          {!busy ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={reset}
              /* 44px minimum: a 16px icon is not a tap target on a phone. */
              className="h-11 w-11 shrink-0 p-0"
              aria-label={t('contract_remove_file')}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      ) : null}

      {/*
        * The failure, said usefully.
        *
        * role="alert" so a screen reader hears it without moving focus, and
        * the retry keeps the customer exactly where they are rather than
        * making them rediscover the flow.
        */}
      {error ? (
        <div role="alert" className="mt-3 flex items-start gap-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 space-y-2">
            <p className="break-words">{error}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => inputRef.current?.click()}
              className="h-auto min-h-11 whitespace-normal py-2 text-start leading-snug"
            >
              {t('contract_err_retry')}
            </Button>
          </div>
        </div>
      ) : null}

      {/* A live region, so progress is announced rather than only animated. */}
      <p aria-live="polite" className="sr-only">
        {busy ? t('contract_upload_working') : ''}
      </p>
    </div>
  );
};

export default ContractUpload;
