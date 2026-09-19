/*
 * ONE CONTRACT, READ, ON ITS OWN PAGE.
 *
 * A contract analysis used to open inside a panel inside a workspace, which
 * meant the most substantial thing Homatch produces about a document was
 * shown in the smallest space on the screen, and could not be linked to,
 * refreshed, or moved between. This is a page: it has a URL, it survives a
 * reload, the browser's own Back button does the obvious thing, and Previous
 * and Next move through the customer's contracts without returning to a list
 * each time.
 *
 * WAITING IS PART OF THE PAGE, NOT A DIFFERENT SCREEN. An analysis that is
 * still running renders the same page with progress where the result will be,
 * so nothing jumps when it finishes and a customer who refreshes mid-analysis
 * is not told their contract is missing.
 *
 * THE POLL STOPS. Every terminal state ends it — including the ones that are
 * not success. A page that polls forever because the analyser said
 * UNSUPPORTED is a battery bug on a phone and a cost on the server.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ChevronLeft, AlertCircle, ShieldCheck } from 'lucide-react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { Skeleton } from '@/components/ui/skeleton';
import { ContractProgress } from '@/components/contracts/ContractProgress';
import { ContractResult } from '@/components/contracts/ContractResult';
import { typesDisagree, type ContractTypeId } from '@/components/contracts/contractTypes';
import { getContract, listContracts, type ContractSummary } from '@/services/contracts';
import {
  getDocumentAnalysis, analyzeDocument,
  type AnalysisState, type DocumentAnalysis,
} from '@/services/dealRoomDocuments';
import { getVerifyCompany } from '@/services/verifyResult';
import { compareContractToVerify, type ComparisonRow } from '@/verify/intelligence/contractMatch';
import type { CompanyIntelligence } from '@/verify/intelligence/companyIntelligence';

const TERMINAL = new Set<AnalysisState>(['DONE', 'FAILED', 'UNSUPPORTED', 'REQUIRES_OCR']);
const POLL_MS = 3_000;

export default function ContractResultPage() {
  const { id } = useParams<{ id: string }>();
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();

  const nav = (location.state ?? {}) as { startedAt?: number; declaredType?: ContractTypeId };
  // Only trustworthy when this page was opened by the upload itself. On a
  // deep link or a refresh there is no honest start time, so the progress
  // falls back to the row's own upload timestamp below.
  const startedAtHint = nav.startedAt;

  const [contract, setContract] = useState<ContractSummary | null | undefined>(undefined);
  const [state, setState] = useState<AnalysisState>('NONE');
  const [analysis, setAnalysis] = useState<DocumentAnalysis | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [company, setCompany] = useState<CompanyIntelligence | null>(null);
  const [siblings, setSiblings] = useState<ContractSummary[]>([]);
  const [retrying, setRetrying] = useState(false);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopPolling = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, []);

  /* ---- the contract row itself, and its neighbours for Previous/Next ---- */

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setContract(undefined);
    setAnalysis(null);
    setCompany(null);
    setFailure(null);
    getContract(id)
      .then((c) => { if (alive) setContract(c); })
      .catch(() => { if (alive) setContract(null); });
    return () => { alive = false; };
  }, [id]);

  useEffect(() => {
    let alive = true;
    listContracts()
      .then((all) => { if (alive) setSiblings(all); })
      .catch(() => { /* Previous/Next simply does not appear. */ });
    return () => { alive = false; };
  }, []);

  /* ---- the analysis, polled until it settles ---- */

  useEffect(() => {
    if (!id) return;
    let alive = true;

    const read = async () => {
      try {
        const r = await getDocumentAnalysis(id);
        if (!alive) return;
        setState(r.state);
        setAnalysis(r.analysis);
        setFailure(r.error);
        if (TERMINAL.has(r.state)) { stopPolling(); return; }
      } catch {
        // A transient read failure must not end the wait: the analysis is
        // running server-side regardless of whether this poll succeeded.
      }
      if (alive) timer.current = setTimeout(() => { void read(); }, POLL_MS);
    };

    void read();
    return () => { alive = false; stopPolling(); };
  }, [id, stopPolling]);

  /* ---- what the verification knows, when there is one ---- */

  useEffect(() => {
    const jobId = contract?.verifyJobId;
    if (!jobId) return;
    let alive = true;
    getVerifyCompany(jobId)
      .then((c) => { if (alive) setCompany(c); })
      .catch(() => { /* the cross-check section simply does not render */ });
    return () => { alive = false; };
  }, [contract?.verifyJobId]);

  const comparison: ComparisonRow[] = useMemo(() => {
    if (!analysis || !contract) return [];
    // Nothing to compare against unless this contract belongs to a property
    // Homatch actually checked.
    if (!contract.cadastralCode && !contract.address && !company) return [];
    return compareContractToVerify(analysis, {
      cadastralCode: contract.cadastralCode,
      address: contract.address,
      company,
    });
  }, [analysis, contract, company]);

  /* ---- neighbours ---- */

  const index = siblings.findIndex((c) => c.id === id);
  // The list is newest first, so "previous" is the newer one: the direction a
  // reader expects from the arrow, not the direction of the array.
  const newer = index > 0 ? siblings[index - 1] : null;
  const older = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null;

  const retry = useCallback(async () => {
    if (!id) return;
    setRetrying(true);
    try {
      await analyzeDocument(id, { force: true, language: lang });
      setState('QUEUED');
      setFailure(null);
      // Restart the poll the effect above owns by re-reading immediately.
      const r = await getDocumentAnalysis(id);
      setState(r.state);
      setAnalysis(r.analysis);
    } catch {
      setFailure('retry_failed');
    } finally {
      setRetrying(false);
    }
  }, [id, lang]);

  const startedAt =
    startedAtHint ??
    (contract?.uploadedAt ? new Date(contract.uploadedAt).getTime() : Date.now());

  const mismatchedType = typesDisagree(nav.declaredType, analysis?.documentType);

  return (
    <AppLayout noPadding>
      <div className="hm-invest hm-invest-canvas min-h-[calc(100vh-4rem)]">
        <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 pb-24 sm:px-6 lg:px-8">
          <Button
            variant="ghost"
            size="sm"
            className="-ms-2"
            onClick={() => navigate('/contracts')}
          >
            <ChevronLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
            {t('ct_back')}
          </Button>

          <header className="min-w-0 space-y-1">
            <h1 className="min-w-0 break-words text-xl font-semibold sm:text-2xl">
              {contract?.label || t('ct_untitled')}
            </h1>
            {contract?.address || contract?.cadastralCode ? (
              <p className="flex flex-wrap items-center gap-1.5 text-sm text-ink-soft">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0 break-words">
                  {contract.address || contract.cadastralCode}
                </span>
              </p>
            ) : null}
          </header>

          {contract === null ? (
            <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
              {t('ct_not_found')}
            </p>
          ) : contract === undefined ? (
            <Skeleton className="h-32 w-full" />
          ) : null}

          {/* Still being read — progress sits exactly where the result will. */}
          {contract && !TERMINAL.has(state) ? (
            <ContractProgress state={state} startedAt={startedAt} />
          ) : null}

          {/* Could not be read. Says which, and offers the one useful action. */}
          {contract && TERMINAL.has(state) && state !== 'DONE' ? (
            <div className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-5">
              <p className="flex items-start gap-2 text-sm font-medium text-foreground">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 break-words">
                  {state === 'REQUIRES_OCR' ? t('ct_fail_scanned')
                    : state === 'UNSUPPORTED' ? t('ct_fail_unsupported')
                    : t('ct_fail_generic')}
                </span>
              </p>
              {failure ? (
                <p className="min-w-0 break-words text-2xs text-muted-foreground">{failure}</p>
              ) : null}
              {state === 'FAILED' ? (
                <Button size="sm" variant="outline" disabled={retrying} onClick={() => { void retry(); }}>
                  {t('ct_retry')}
                </Button>
              ) : null}
            </div>
          ) : null}

          {/* The customer said one thing, the document says another. */}
          {mismatchedType && analysis ? (
            <p className="min-w-0 break-words rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm leading-relaxed text-foreground">
              {t('ct_type_mismatch')}
            </p>
          ) : null}

          {state === 'DONE' && analysis ? (
            <ContractResult analysis={analysis} comparison={comparison} />
          ) : null}

          {/* Move between contracts without going back to a list each time. */}
          {newer || older ? (
            <nav className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              {newer ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="min-w-0 max-w-full"
                  onClick={() => navigate(`/contracts/${newer.id}`)}
                >
                  <ArrowLeft className="me-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 truncate">{t('ct_prev')}</span>
                </Button>
              ) : <span />}
              {older ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="ms-auto min-w-0 max-w-full"
                  onClick={() => navigate(`/contracts/${older.id}`)}
                >
                  <span className="min-w-0 truncate">{t('ct_next')}</span>
                  <ArrowRight className="ms-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                </Button>
              ) : null}
            </nav>
          ) : null}
        </div>
      </div>
    </AppLayout>
  );
}
