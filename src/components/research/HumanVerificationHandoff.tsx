// HOMATCH — user-side human verification handoff.
//
// Shown INSTEAD of the server-browser CAPTCHA screen when the source has
// refused our network outright ("your computer or network may be sending
// automated queries"). A screenshot of Railway's browser cannot solve that,
// because a screenshot does not change the source IP — so asking the customer
// to solve it there would be asking for something impossible.
//
// What the customer is asked to do is ordinary: open the official site in
// their own browser, complete the same public lookup they could have done
// themselves, and tell us it is done. Nothing is transferred in either
// direction except the public reference they choose to type.
//
// Declining is a first-class outcome, not a failure. Skipping a source
// produces no evidence, and no evidence can never become a negative finding
// or move the verdict.
import React, { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ExternalLink, ShieldQuestion } from 'lucide-react';

export interface HandoffOffer {
  handoffId: string;
  nonce: string | null;
  targetUrl: string | null;
  sourceName: string;
  expiresAt: string;
}

export function HumanVerificationHandoff({
  offer,
  onComplete,
  onCancel,
  onOpen,
  busy,
  error,
}: {
  offer: HandoffOffer;
  onComplete: (reference: string) => void;
  onCancel: () => void;
  /** Fired when the customer actually opens the official site, so the
   * handoff can move PENDING -> OPENED and the audit trail is truthful. */
  onOpen?: () => void;
  busy?: boolean;
  error?: string | null;
}) {
  const { t } = useLanguage();
  const [reference, setReference] = useState('');
  const [opened, setOpened] = useState(false);

  return (
    <Card className="border-amber-300 dark:border-amber-800">
      <CardContent className="pt-5 space-y-4">
        <div className="flex gap-3">
          <ShieldQuestion className="h-5 w-5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <div className="min-w-0 space-y-1">
            <h3 className="text-base font-semibold">{t('handoff_title')}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{t('handoff_body')}</p>
          </div>
        </div>

        {offer.targetUrl ? (
          <Button
            asChild
            variant="outline"
            className="w-full sm:w-auto gap-2"
            onClick={() => { setOpened(true); onOpen?.(); }}
          >
            {/* noopener/noreferrer: the official site must never receive a
                referrer from, or a handle on, the Homatch tab. */}
            <a href={offer.targetUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" />
              {t('handoff_open')}
            </a>
          </Button>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="handoff-ref">{t('handoff_reference')}</Label>
          <Input
            id="handoff-ref"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            inputMode="text"
            autoComplete="off"
          />
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            disabled={busy || (!opened && !!offer.targetUrl)}
            onClick={() => onComplete(reference)}
            className="w-full sm:w-auto"
          >
            {t('handoff_done')}
          </Button>
          {/* Always available. A customer who cannot or does not want to do
              this must be able to move on immediately. */}
          <Button variant="ghost" disabled={busy} onClick={onCancel} className="w-full sm:w-auto">
            {t('handoff_cancel')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
