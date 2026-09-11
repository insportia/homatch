// HOMATCH — the second way into a verification: a contract.
//
// A buyer often has the contract before they have the cadastral code, so the
// Verification Center accepts either. Choosing a file here creates the
// Verification Case, stores the document privately against it, and opens the
// case on its Documents tab — the same case a cadastral verification would
// have produced, not a separate flow.
//
// The file is validated BEFORE the case is created, so a rejected file never
// leaves an empty case behind.
import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FileText, Loader2 } from 'lucide-react';
import { createDocumentVerificationCase, deleteDealRoom } from '@/services/dealRooms';
import { uploadDocument, validateUpload } from '@/services/dealRoomDocuments';

// Same mapping as DocumentsPanel: the two entry points must reject a file for
// the same stated reason, or the Center and the case would disagree about the
// same file.
const REJECTION_KEY: Record<string, string> = {
  TOO_LARGE: 'dr_docs_too_large',
  UNSUPPORTED_TYPE: 'dr_docs_bad_type',
  SUSPICIOUS_NAME: 'dr_docs_bad_name',
  EMPTY: 'dr_docs_bad_type',
};

export const StartFromDocument: React.FC = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);

    const check = validateUpload({ name: file.name, size: file.size, type: file.type });
    if (!check.ok) {
      setError(t(REJECTION_KEY[check.reason] ?? 'dr_docs_bad_type'));
      return;
    }

    setBusy(true);
    let caseId: string | null = null;
    try {
      const created = await createDocumentVerificationCase(file.name);
      caseId = created.id;
      await uploadDocument({ roomId: created.id, file });
      navigate(`/verify/${created.id}?tab=documents`);
    } catch {
      // A case with nothing in it is worse than no case: it would sit in the
      // customer's list forever claiming a verification that never started.
      if (caseId) {
        try {
          await deleteDealRoom(caseId);
        } catch {
          /* best effort — the case is empty either way */
        }
      }
      setError(t('dr_error_generic'));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <Card>
      <CardContent className="pt-5 space-y-3">
        <div className="flex items-start gap-3">
          <FileText className="h-5 w-5 shrink-0 text-muted-foreground mt-0.5" aria-hidden="true" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-medium break-words">{t('vc_start_document')}</p>
            <p className="measure text-base leading-relaxed text-ink-soft break-words">
              {t('vc_start_document_hint')}
            </p>
          </div>
        </div>

        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          aria-label={t('vc_start_document')}
          onChange={(e) => void onPick(e.target.files?.[0])}
        />
        <Button
          variant="outline"
          className="w-full sm:w-auto gap-2"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
          {busy ? t('vc_creating') : t('dr_docs_upload')}
        </Button>

        {error ? <p className="text-sm text-destructive break-words">{error}</p> : null}
      </CardContent>
    </Card>
  );
};

export default StartFromDocument;
