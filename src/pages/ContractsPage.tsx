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
 * THE START IS THE PRODUCT'S FIRST IMPRESSION. The owner asked for premium:
 * the hero is a page being read under a moving light with HOMI (the live 3D
 * model) beside it, then what the reading gives you, then the upload with its
 * price said BEFORE anything starts: "this month's free analysis" while the
 * monthly included analysis is unused, otherwise the fixed price from the
 * server (contract_fixed_price). A price that cannot be read is not guessed.
 *
 * THE TYPE SELECTOR IS OPTIONAL AND SAYS SO. The analyser identifies the
 * document type on its own and is good at it. Asking first would be a
 * required question with a guessable answer, which is the worst kind. So the
 * selector defaults to "work it out for me", and a stated type is used to
 * label the upload and to notice — on the result page — when the analyser
 * concluded something different, which is itself worth knowing.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { FileSignature, ArrowRight, ShieldCheck, GitCompare, FileCheck2, ListChecks, Gift, Coins } from 'lucide-react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { featureOf, useEntitlementStatus } from '@/subscriptions/useEntitlementStatus';
import { DropZone } from '@/components/documents/DropZone';
import { ContractList } from '@/components/contracts/ContractList';
import { DocumentReader } from '@/components/contracts/DocumentReader';
import { useReaderPulls } from '@/components/contracts/ContractProgress';
import { HomiHomeStage } from '@/components/homi/HomiHomeStage';
import { CONTRACT_TYPES, type ContractTypeId } from '@/components/contracts/contractTypes';
import { ALLOWED_MIME } from '@/services/dealRoomDocuments';
import { getContractPrice, listContracts, startContractAnalysis, type ContractSummary } from '@/services/contracts';
import { rememberPendingPath } from '@/services/returnTo';

/** How many of a customer's contracts the entry page shows before "see all". */
export const RECENT_LIMIT = 6;

export default function ContractsPage() {
  const { t, lang } = useLanguage();
  const { homatchUser } = useAuth();
  const ent = useEntitlementStatus();
  const navigate = useNavigate();
  const location = useLocation();
  const pulls = useReaderPulls();

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
  const [price, setPrice] = useState<{ credits: number; usd: number } | null>(null);

  useEffect(() => {
    if (!homatchUser) { setRecent([]); return; }
    let alive = true;
    listContracts(RECENT_LIMIT)
      .then((r) => { if (alive) setRecent(r); })
      .catch(() => { if (alive) setRecent([]); });
    getContractPrice()
      .then((p) => { if (alive) setPrice(p); })
      .catch(() => { /* no number rather than a guessed one */ });
    return () => { alive = false; };
  }, [homatchUser]);

  /* What the next analysis costs this customer, said before they start (server truth:
   * entitlement_status_for_me). Subscriptions (2026-10-29): the first analysis is free, then the
   * plan's allowance; the old "1 free per month" is gone. The fixed credit price is shown only to
   * an account that still holds a legacy balance; everyone else is pointed at the plans. */
  const contract = featureOf(ent.status, 'CONTRACT_ANALYSIS');
  const included = !!homatchUser && !!contract && (contract.trialAvailable || (contract.included && (contract.unlimited || (contract.remaining ?? 0) > 0)));
  const priceLabel = !homatchUser || !ent.status
    ? null
    : included
      ? (contract?.trialAvailable ? t('sub_badge_first_free')
        : contract?.unlimited ? t('sub_badge_included_unlimited')
        : t('sub_badge_included', { remaining: String(contract?.remaining ?? '') }))
      : ent.status.hasLegacyBalance && price
        ? t('ux_ct_price_paid', {
            credits: price.credits.toLocaleString(lang, { maximumFractionDigits: 2 }),
            usd: price.usd.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }),
          })
        : t('sub_prompt_subscribe');

  const onFile = useCallback(
    async (file: File) => {
      if (!homatchUser) {
        // Keep the intent across the sign-in round trip rather than dropping
        // the customer back on a page with no memory of what they wanted.
        rememberPendingPath('/contracts');
        navigate('/auth/login');
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

  const gains: Array<{ icon: React.ReactNode; title: string; body: string }> = [
    { icon: <ListChecks className="h-5 w-5" />, title: t('ux_ct_gain1_t'), body: t('ux_ct_gain1_b') },
    { icon: <GitCompare className="h-5 w-5" />, title: t('ux_ct_gain2_t'), body: t('ux_ct_gain2_b') },
    { icon: <FileCheck2 className="h-5 w-5" />, title: t('ux_ct_gain3_t'), body: t('ux_ct_gain3_b') },
  ];

  return (
    <AppLayout noPadding>
      <div className="hm-invest hm-invest-canvas min-h-[calc(100vh-4rem)]">
        <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8">
          {/* The document product's navy identity band: a page being read, HOMI beside it. */}
          <header className="relative overflow-hidden rounded-3xl bg-[#0C1119] px-5 pb-6 pt-6 text-white shadow-hover sm:px-8 sm:pt-8">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(100%_70%_at_0%_0%,hsl(38_92%_56%/0.16),transparent_60%),radial-gradient(70%_60%_at_100%_100%,hsl(215_70%_45%/0.18),transparent_60%)]" aria-hidden="true" />
            {/* The title gets the full width: a long Georgian word must never break mid-word. */}
            <div className="relative flex items-center gap-2.5">
              <FileSignature className="h-5 w-5 shrink-0 text-[hsl(38_92%_60%)] sm:h-6 sm:w-6" aria-hidden="true" />
              <h1 className="min-w-0 font-display text-2xl font-bold text-white [overflow-wrap:normal] sm:text-4xl">
                {t('ct_page_title')}
              </h1>
            </div>
            <div className="relative mt-2 flex min-w-0 items-start gap-3">
              <p className="measure min-w-0 flex-1 break-words text-[15px] leading-relaxed text-white/80 sm:text-base">
                {t('ux_ct_hero_sub')}
              </p>
              <HomiHomeStage gesture="greeting" framing="upper" className="-me-1 -mt-2 h-24 w-20 shrink-0 sm:h-32 sm:w-28" />
            </div>
            <DocumentReader mode="idle" pulls={pulls} pullsTitle={t('ux_ct_pull_title')} className="relative mt-6" />
          </header>

          {/* What the reading gives you, before you give it anything. */}
          <section aria-label={t('ux_ct_gains_label')} className="grid gap-3 sm:grid-cols-3">
            {gains.map((g, i) => (
              <div key={i} className="ct-rise min-w-0 rounded-2xl border border-border bg-card p-4 shadow-card" style={{ ['--i' as string]: i } as React.CSSProperties}>
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))] ring-1 ring-[hsl(var(--gold-border))]/50" aria-hidden="true">{g.icon}</span>
                <p className="mt-3 min-w-0 break-words font-semibold text-foreground">{g.title}</p>
                <p className="mt-1 min-w-0 break-words text-sm leading-relaxed text-ink-soft">{g.body}</p>
              </div>
            ))}
          </section>

          {linkedProperty ? (
            <p className="flex min-w-0 flex-wrap items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
              <ShieldCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span className="min-w-0 break-words text-foreground">
                {t('ct_linked_property')} {linkedProperty}
              </span>
            </p>
          ) : null}

          <section className="space-y-4 rounded-3xl border border-border bg-card p-4 shadow-card sm:p-6" aria-labelledby="ct-upload-title">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="ct-upload-title" className="min-w-0 break-words font-display text-lg font-semibold text-foreground">{t('ux_ct_upload_title')}</h2>
              {priceLabel ? (
                <span
                  data-testid="contract-price"
                  className={included
                    ? 'inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-800 ring-1 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-200'
                    : 'inline-flex items-center gap-1.5 rounded-full bg-[#0C1119] px-3 py-1 text-sm font-semibold text-white'}
                >
                  {included ? <Gift className="h-4 w-4" aria-hidden="true" /> : <Coins className="h-4 w-4 text-[hsl(38_92%_60%)]" aria-hidden="true" />}
                  {priceLabel}
                </span>
              ) : null}
            </div>
            {priceLabel ? (
              <p className="-mt-2 text-sm leading-relaxed text-ink-soft">{included ? t('ux_ct_price_free_hint') : ent.status?.hasLegacyBalance ? t('ux_ct_price_paid_hint') : <Link className="font-medium underline" to="/pricing">{t('sub_see_plans')}</Link>}</p>
            ) : null}

            {/* Optional, and visibly optional: the default is already chosen. */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">{t('ct_type_label')}</p>
              <div className="flex flex-wrap gap-2">
                {CONTRACT_TYPES.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    aria-pressed={type === opt.id}
                    onClick={() => setType(opt.id)}
                    className={`min-h-9 min-w-0 rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
                      type === opt.id
                        /* Selected must be unmistakable: solid navy with white
                           text, never a pale tint that reads as disabled. */
                        ? 'border-[#0C1119] bg-[#0C1119] font-semibold text-white shadow-card'
                        : 'border-border bg-card text-foreground/80 hover:border-[hsl(var(--gold-border))] hover:text-foreground'
                    }`}
                  >
                    <span className="break-words">{t(opt.labelKey)}</span>
                  </button>
                ))}
              </div>
              <p className="min-w-0 break-words text-xs leading-relaxed text-muted-foreground">
                {t('ct_type_hint')}
              </p>
            </div>

            <DropZone
              onFile={(f) => { void onFile(f); }}
              busy={busy}
              accept={ALLOWED_MIME.join(',')}
              error={error}
            />
          </section>

          {homatchUser ? (
            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <h2 className="min-w-0 break-words font-display text-lg font-semibold tracking-tight">
                  {t('ct_recent_title')}
                </h2>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  onClick={() => navigate('/contracts/history')}
                >
                  {t('ux_ct_open_history')}
                  <ArrowRight className="ms-1.5 h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
                </Button>
              </div>

              <ContractList
                items={recent}
                emptyTitle={t('ct_empty_title')}
                emptyHint={t('ct_empty_hint')}
                onDeleted={(id) => setRecent((cur) => (cur ? cur.filter((c) => c.id !== id) : cur))}
              />
            </section>
          ) : null}
        </div>
      </div>
    </AppLayout>
  );
}
