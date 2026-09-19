/*
 * CONTRACTS — the product, not a feature of something else.
 *
 * Having a contract read used to require understanding a workspace first: the
 * customer had to create a "deal room", enter it, find the upload inside it,
 * and then press a second button to start the analysis. Three concepts and
 * two decisions stood between a person holding a document and a person
 * understanding it, and none of the three was anything they had asked for.
 *
 * This page is the whole entry: drop a file, and it is read. The container it
 * is stored in still exists underneath (see services/contracts.ts for why it
 * must), and the customer is never shown it or asked about it.
 *
 * THE TYPE SELECTOR IS OPTIONAL AND SAYS SO. The analyser identifies the
 * document type on its own and is good at it. Asking first would be a
 * required question with a guessable answer, which is the worst kind. So the
 * selector defaults to "work it out for me", and a stated type is used to
 * label the upload and to notice — on the result page — when the analyser
 * concluded something different, which is itself worth knowing.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FileSignature, ArrowRight, ShieldCheck } from 'lucide-react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { DropZone } from '@/components/documents/DropZone';
import { ContractList } from '@/components/contracts/ContractList';
import { CONTRACT_TYPES, type ContractTypeId } from '@/components/contracts/contractTypes';
import { ALLOWED_MIME } from '@/services/dealRoomDocuments';
import { listContracts, startContractAnalysis, type ContractSummary } from '@/services/contracts';
import { rememberPendingPath } from '@/services/returnTo';

/** How many of a customer's contracts the entry page shows before "see all". */
export const RECENT_LIMIT = 6;

export default function ContractsPage() {
  const { t, lang } = useLanguage();
  const { homatchUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  /*
   * Arriving from a finished verification.
   *
   * `roomId` is the storage container that verification already has, so a
   * contract uploaded here lands against the property that was checked and
   * can be compared with it. The customer is shown the property, never the
   * container. Arriving directly, all three are simply absent.
   */
  const handoff = (location.state ?? {}) as {
    roomId?: string | null;
    cadastralCode?: string | null;
    address?: string | null;
  };
  const linkedProperty = handoff.address || handoff.cadastralCode || null;

  const [recent, setRecent] = useState<ContractSummary[] | null>(null);
  const [type, setType] = useState<ContractTypeId>('AUTO');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!homatchUser) { setRecent([]); return; }
    let alive = true;
    listContracts(RECENT_LIMIT)
      .then((r) => { if (alive) setRecent(r); })
      .catch(() => { if (alive) setRecent([]); });
    return () => { alive = false; };
  }, [homatchUser]);

  const onFile = useCallback(
    async (file: File) => {
      if (!homatchUser) {
        // Keep the intent across the sign-in round trip rather than dropping
        // the customer back on a page with no memory of what they wanted.
        rememberPendingPath('/contracts');
        navigate('/login');
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const { documentId } = await startContractAnalysis({
          file,
          roomId: handoff.roomId ?? null,
          language: lang,
        });
        // The result page owns the waiting: it polls the row, shows real
        // elapsed time, and survives a refresh. Nothing is lost by leaving.
        navigate(`/contracts/${documentId}`, { state: { startedAt: Date.now(), declaredType: type } });
      } catch (e) {
        const message = e instanceof Error ? e.message : '';
        setError(
          message.startsWith('upload_rejected:')
            ? t('ct_upload_rejected')
            : t('ct_upload_failed')
        );
        setBusy(false);
      }
    },
    [handoff.roomId, homatchUser, lang, navigate, t, type]
  );

  return (
    <AppLayout noPadding>
      <div className="hm-invest hm-invest-canvas min-h-[calc(100vh-4rem)]">
        <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 pb-24 sm:px-6 lg:px-8">
          <header className="space-y-2">
            <div className="flex items-center gap-2">
              <FileSignature className="h-5 w-5 shrink-0 text-primary sm:h-6 sm:w-6" aria-hidden="true" />
              <h1 className="min-w-0 break-words text-xl font-semibold sm:text-3xl">
                {t('ct_page_title')}
              </h1>
            </div>
            <p className="measure min-w-0 break-words text-base text-ink-soft">
              {t('ct_page_subtitle')}
            </p>
          </header>

          {linkedProperty ? (
            <p className="flex min-w-0 flex-wrap items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
              <ShieldCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span className="min-w-0 break-words text-foreground">
                {t('ct_linked_property')} {linkedProperty}
              </span>
            </p>
          ) : null}

          {/* Optional, and visibly optional: the default is already chosen. */}
          <section className="space-y-2">
            <p className="text-sm font-medium text-foreground">{t('ct_type_label')}</p>
            <div className="flex flex-wrap gap-2">
              {CONTRACT_TYPES.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={type === opt.id}
                  onClick={() => setType(opt.id)}
                  className={`min-h-9 min-w-0 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    type === opt.id
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border bg-card text-muted-foreground hover:bg-accent/40'
                  }`}
                >
                  <span className="break-words">{t(opt.labelKey)}</span>
                </button>
              ))}
            </div>
            <p className="min-w-0 break-words text-2xs leading-relaxed text-muted-foreground">
              {t('ct_type_hint')}
            </p>
          </section>

          <DropZone
            onFile={(f) => { void onFile(f); }}
            busy={busy}
            accept={ALLOWED_MIME.join(',')}
            error={error}
          />

          {homatchUser ? (
            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <h2 className="min-w-0 break-words text-base font-semibold tracking-tight">
                  {t('ct_recent_title')}
                </h2>
                {recent && recent.length >= RECENT_LIMIT ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    onClick={() => navigate('/contracts/history')}
                  >
                    {t('ct_see_all')}
                    <ArrowRight className="ms-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                ) : null}
              </div>

              <ContractList
                items={recent}
                emptyTitle={t('ct_empty_title')}
                emptyHint={t('ct_empty_hint')}
              />
            </section>
          ) : null}
        </div>
      </div>
    </AppLayout>
  );
}
