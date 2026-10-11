// HOMATCH Verify — a link to an official public record, opened in a new tab.
// Only hrefs that pass safeHref() (src/verify/reportPresentation.ts) render.
//
// A TAS file (docs.tbilisi.gov.ge/DownloadServlet?…attachedFileId=…) is NEVER
// rendered as a raw link: that servlet answers many customer browsers with
// "Access Denied". Inside a report (VerifyJobProvider supplies the job id) it
// becomes a button that opens the file through HOMATCH's secure viewer
// (research-agent `document_file`: owner-checked, cached privately, signed
// for minutes). Outside a report context it renders nothing.

import React from 'react';
import { ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { safeHref } from '@/verify/reportPresentation';
import { attachedFileIdOf } from '@/verify/officialDocumentLibrary';
import { openDocumentFile, type DocumentFileError } from '@/services/verifyDocumentFile';

const VerifyJobContext = React.createContext<string | null>(null);

/** The report's job id, so official file links can open through the secure viewer. */
export function VerifyJobProvider({ jobId, children }: { jobId?: string | null; children: React.ReactNode }) {
  return <VerifyJobContext.Provider value={jobId && /^[0-9a-f-]{36}$/i.test(jobId) ? jobId : null}>{children}</VerifyJobContext.Provider>;
}
export const useVerifyJobId = (): string | null => React.useContext(VerifyJobContext);

/** A raw TAS DownloadServlet file URL (never a usable link by itself). */
export const isTasFileUrl = (href: string): boolean => /^https:\/\/docs\.tbilisi\.gov\.ge\/DownloadServlet\b/i.test(href);

export const DOCUMENT_ERROR_KEY: Record<DocumentFileError, string> = {
  sign_in_required: 'verify_fdocs_err_sign_in',
  not_found: 'verify_fdocs_err_unavailable',
  not_viewable: 'verify_fdocs_technical',
  source_unavailable: 'verify_fdocs_err_source',
  failed: 'verify_fdocs_err_source',
};

const tone = (t: 'light' | 'dark') => t === 'dark'
  ? 'text-[hsl(38_92%_66%)] focus-visible:ring-[hsl(38_92%_60%)]'
  : 'text-[hsl(var(--gold-ink))] focus-visible:ring-[hsl(var(--gold-ink))]';

/** "გახსნა" — opens one ledger file through the secure viewer. */
export function SecureFileButton({ jobId, attachedFileId, label, tone: tn = 'light' }: { jobId: string; attachedFileId: string; label?: string; tone?: 'light' | 'dark' }) {
  const { t } = useLanguage();
  const [busy, setBusy] = React.useState(false);
  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const err = await openDocumentFile(jobId, attachedFileId);
      if (err) toast.error(t(DOCUMENT_ERROR_KEY[err]));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={() => void onClick()}
      aria-busy={busy}
      className={`-mx-1 inline-flex min-h-[44px] items-center gap-1 rounded px-1 text-xs font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 disabled:opacity-60 ${tone(tn)}`}
    >
      {busy ? t('verify_fdocs_opening') : label ?? t('verify_fdocs_open')}
      <ExternalLink className="h-3.5 w-3.5 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
      <span className="sr-only">{t('verify_v3_opens_new_tab')}</span>
    </button>
  );
}

export function OfficialLink({ href, label, tone: tn = 'light' }: { href: string; label?: string; tone?: 'light' | 'dark' }) {
  const { t } = useLanguage();
  const jobId = useVerifyJobId();
  // Only an official https page ever becomes a link (safeHref); anything else renders nothing.
  const safe = safeHref(href);
  if (!safe) return null;
  if (isTasFileUrl(safe)) {
    const id = attachedFileIdOf({ sourceUrl: safe });
    return jobId && id ? <SecureFileButton jobId={jobId} attachedFileId={id} label={label} tone={tn} /> : null;
  }
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      className={`-mx-1 inline-flex min-h-[44px] items-center gap-1 rounded px-1 text-xs font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 ${tone(tn)}`}
    >
      {label ?? t('verify_v3_official_source')}
      <ExternalLink className="h-3.5 w-3.5 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
      <span className="sr-only">{t('verify_v3_opens_new_tab')}</span>
    </a>
  );
}
