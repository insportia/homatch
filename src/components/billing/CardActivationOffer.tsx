// HOMATCH — the offer that replaced the registration grant.
//
// An account used to arrive with 50 credits already in it. It now arrives with
// nothing, and earns its first credits by proving a real payment method
// exists. That is a better promotion and a worse first impression, so this
// screen has one job: make the trade obvious in about four seconds.
//
// WHAT IT SAYS, AND THE ORDER IT SAYS IT IN
//
//   Get 10 free credits                 <- what they get
//   10 credits are worth $1 and can     <- what that means in money
//   be used on anything Homatch
//   charges for.
//   [ Add card & get 10 credits ]       <- the one action
//   $0 charged now.                     <- the objection, answered
//
// "$0 charged now" sits directly under the button and not in a footnote,
// because the person most likely to abandon this screen is the person most
// suspicious about being asked for a card, and they are right to be. Burying
// the answer in legal-looking copy would confirm the suspicion.
//
// WHAT DECIDES WHETHER IT APPEARS
//
// The server, on every load. Eligibility, the credit figure, the reminder
// budget and the cooldown all arrive from billing_my_activation_offer(), so
// clearing browser storage cannot conjure a second bonus and switching device
// cannot lose the offer. Once claimed, every prompt disappears permanently --
// `eligible` goes false and stays false.

import React from 'react';
import { CreditCard, Check, Loader2, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  getActivationOffer, shouldPromptActivation, recordOfferStep,
  startCardSetup, type ActivationOffer,
} from '@/services/billing';

type Phase = 'IDLE' | 'STARTING' | 'UNAVAILABLE';

/** The credits figure and its dollar value, both from the server. */
function useOfferCopy(offer: ActivationOffer | null) {
  const credits = offer?.credits ?? 0;
  const perUsd = offer?.credits_per_usd || 10;
  const usd = (credits / perUsd).toFixed(2).replace(/\.00$/, '');
  return { credits: String(credits), usd };
}

/**
 * The body of the offer. Shared by the dialog and the inline card so the two
 * can never drift into saying different things about the same promotion.
 */
function OfferBody({
  offer, onStarted, onUnavailable, phase, setPhase,
}: {
  offer: ActivationOffer;
  onStarted: () => void;
  onUnavailable: () => void;
  phase: Phase;
  setPhase: (p: Phase) => void;
}) {
  const { t } = useLanguage();
  const { credits, usd } = useOfferCopy(offer);

  const onAdd = async () => {
    setPhase('STARTING');
    void recordOfferStep('CTA_CLICKED');
    const result = await startCardSetup();
    if (result.ok && result.setupUrl) {
      onStarted();
      window.location.href = result.setupUrl;
      return;
    }
    /* The provider cannot store a card without charging it, or none is
       configured. Say so; do not leave the button spinning. */
    setPhase('UNAVAILABLE');
    onUnavailable();
  };

  if (phase === 'UNAVAILABLE') {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">{t('card_activation_unavailable')}</p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t('card_activation_unavailable_body')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-muted-foreground">
        {t('card_activation_body', { credits, usd })}
      </p>
      <div className="space-y-2">
        <Button
          type="button"
          size="lg"
          className="h-auto min-h-12 w-full whitespace-normal py-3 text-start leading-snug"
          disabled={phase === 'STARTING'}
          onClick={() => void onAdd()}
        >
          {phase === 'STARTING'
            ? <Loader2 className="me-2 h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
            : <CreditCard className="me-2 h-4 w-4 shrink-0" aria-hidden="true" />}
          {t('card_activation_cta', { credits })}
        </Button>
        {/* The objection, answered, next to the button that raises it. */}
        <p className="text-center text-xs font-medium text-foreground">
          {t('card_activation_zero_charge')}
        </p>
      </div>
    </div>
  );
}

/**
 * The prompt. Shown at most once per cooldown and never after the bonus is
 * claimed. Dismissing is recorded so the cooldown can be honoured from the
 * server rather than from this device.
 */
export function CardActivationPrompt() {
  const { t } = useLanguage();
  const [offer, setOffer] = React.useState<ActivationOffer | null>(null);
  const [open, setOpen] = React.useState(false);
  const [phase, setPhase] = React.useState<Phase>('IDLE');
  const { credits } = useOfferCopy(offer);

  React.useEffect(() => {
    let alive = true;
    void getActivationOffer().then((o) => {
      if (!alive || !shouldPromptActivation(o)) return;
      setOffer(o);
      setOpen(true);
      void recordOfferStep('OFFER_SHOWN', { surface: 'prompt' });
    });
    return () => { alive = false; };
  }, []);

  const dismiss = () => {
    setOpen(false);
    void recordOfferStep('OFFER_DISMISSED', { surface: 'prompt' });
  };

  if (!offer) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) dismiss(); }}>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-md">
        <DialogTitle className="text-balance text-xl font-semibold leading-snug">
          {t('card_activation_title', { credits })}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {t('card_activation_zero_charge')}
        </DialogDescription>
        <OfferBody
          offer={offer}
          phase={phase}
          setPhase={setPhase}
          onStarted={() => setOpen(false)}
          onUnavailable={() => undefined}
        />
        {phase === 'IDLE' && (
          <Button type="button" variant="ghost" className="w-full" onClick={dismiss}>
            {t('card_activation_dismiss')}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The persistent entry point.
 *
 * Deliberately NOT governed by the cooldown: a customer who said "not now"
 * three times has not said "never", and hiding the only remaining way to claim
 * would be punishing them for declining a popup. It disappears the moment the
 * bonus is actually claimed and not before.
 */
export function CardActivationCard({ className }: { className?: string }) {
  const { t } = useLanguage();
  const [offer, setOffer] = React.useState<ActivationOffer | null>(null);
  const [phase, setPhase] = React.useState<Phase>('IDLE');
  const { credits } = useOfferCopy(offer);

  React.useEffect(() => {
    let alive = true;
    void getActivationOffer().then((o) => {
      if (!alive) return;
      if (o?.eligible && !o.already_claimed) {
        setOffer(o);
        void recordOfferStep('OFFER_SHOWN', { surface: 'inline' });
      }
    });
    return () => { alive = false; };
  }, []);

  if (!offer) return null;

  return (
    <section
      className={className}
      aria-label={t('card_activation_claim_short', { credits })}
    >
      <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <h2 className="text-balance text-base font-semibold leading-snug text-foreground">
          {t('card_activation_title', { credits })}
        </h2>
        <div className="mt-3">
          <OfferBody
            offer={offer}
            phase={phase}
            setPhase={setPhase}
            onStarted={() => undefined}
            onUnavailable={() => undefined}
          />
        </div>
      </div>
    </section>
  );
}

/**
 * The result, shown when the customer comes back from the provider.
 *
 * `granted` is the server's answer, not an assumption: a card can be saved
 * successfully and the bonus still be declined because this account, or this
 * physical card, already claimed it. Saying "card saved" without "credits
 * added" is the honest rendering of that, and it is why these are two lines.
 */
export function CardActivationResult({
  granted, credits, cardBrand, cardLast4, failed,
}: {
  granted: boolean;
  credits: number;
  cardBrand?: string | null;
  cardLast4?: string | null;
  failed?: boolean;
}) {
  const { t } = useLanguage();

  if (failed) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{t('card_activation_failed')}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('card_activation_failed_body')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
      <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#12A06B]" aria-hidden="true" />
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground">
          {granted
            ? t('card_activation_granted_title', { credits: String(credits) })
            : t('card_activation_card_saved')}
        </p>
        {granted && (
          <p className="text-sm text-muted-foreground">{t('card_activation_granted_body')}</p>
        )}
        {cardLast4 && (
          <p className="text-2xs text-muted-foreground" dir="ltr">
            {[cardBrand, `•••• ${cardLast4}`].filter(Boolean).join(' ')}
          </p>
        )}
      </div>
    </div>
  );
}
