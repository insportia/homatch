// ExternalContactUnlockModal — shown from MatchesPage for external signals
import React, { useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Lock, Unlock, Phone, Mail, MessageCircle, AlertTriangle, CheckCircle,
  MapPin, DollarSign, Clock, BarChart3, Globe, Coins,
} from 'lucide-react';
import { previewExternalUnlock, confirmExternalUnlock } from '@/services/api3';
import type { ExternalUnlockPreview } from '@/types/phase3';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onClose: () => void;
  matchId: string;
  creditBalance: number;
  onUnlocked?: () => void;
}

type Step = 'loading' | 'preview' | 'confirm' | 'revealed' | 'error';

export function ExternalContactUnlockModal({ open, onClose, matchId, creditBalance, onUnlocked }: Props) {
  const { t } = useLanguage();
  const [step, setStep] = useState<Step>('loading');
  const [preview, setPreview] = useState<ExternalUnlockPreview | null>(null);
  const [contact, setContact] = useState<Record<string, string> | null>(null);
  const [creditsCharged, setCreditsCharged] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [confirming, setConfirming] = useState(false);

  // Stable idempotency key per match
  const idempotencyKey = `unlock_${matchId}_${Date.now().toString(36)}`;

  useEffect(() => {
    if (!open || !matchId) return;
    setStep('loading');
    setPreview(null);
    setContact(null);
    setErrorMsg('');

    previewExternalUnlock(matchId, idempotencyKey)
      .then(({ preview: p }) => {
        if (p.already_unlocked) {
          setStep('revealed');
        } else {
          setPreview(p);
          setStep('preview');
        }
      })
      .catch(err => {
        setErrorMsg(String(err));
        setStep('error');
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, matchId]);

  const handleConfirm = async () => {
    if (!preview) return;
    setConfirming(true);
    try {
      const result = await confirmExternalUnlock(matchId, idempotencyKey);
      setContact(result.contact ?? null);
      setCreditsCharged(result.credits_charged ?? preview.customer_price);
      setStep('revealed');
      onUnlocked?.();
      toast.success(`Contact unlocked — ${result.credits_charged ?? preview.customer_price} credits charged`);
    } catch (err) {
      const msg = String(err);
      if (msg.includes('Insufficient')) {
        toast.error(t('unlock_insufficient'));
      } else {
        toast.error(msg);
      }
      setConfirming(false);
    }
  };

  const balanceAfter = preview ? creditBalance - preview.customer_price : creditBalance;
  const canAfford = preview ? creditBalance >= preview.customer_price : false;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step === 'revealed'
              ? <><Unlock className="h-5 w-5 text-primary" /> {t('unlock_reveal_title')}</>
              : <><Lock className="h-5 w-5 text-primary" /> {t('unlock_title')}</>
            }
          </DialogTitle>
          {step === 'preview' && (
            <DialogDescription>{t('unlock_preview_title')}</DialogDescription>
          )}
        </DialogHeader>

        {/* Loading */}
        {step === 'loading' && (
          <div className="py-8 flex flex-col items-center gap-3">
            <div className="h-8 w-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
            <p className="text-sm text-muted-foreground">Loading lead details…</p>
          </div>
        )}

        {/* Error */}
        {step === 'error' && (
          <div className="py-6 text-center space-y-2">
            <AlertTriangle className="h-10 w-10 text-yellow-400 mx-auto" />
            <p className="text-sm text-muted-foreground">{errorMsg}</p>
          </div>
        )}

        {/* Preview */}
        {step === 'preview' && preview && (
          <div className="space-y-4">
            {/* Lead type + score */}
            <div className="flex items-center gap-3 p-3 bg-secondary rounded-xl">
              <div className="h-12 w-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                <span className="text-lg font-bold text-primary">{preview.match_score}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-xs border',
                      preview.is_confirmed
                        ? 'text-green-400 bg-green-400/10 border-green-400/30'
                        : 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
                    )}
                  >
                    {preview.is_confirmed ? <CheckCircle className="h-3 w-3 mr-1" /> : <AlertTriangle className="h-3 w-3 mr-1" />}
                    {preview.lead_label}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{t('unlock_match_score')}: {preview.match_score}/100</span>
                </div>
                {!preview.is_confirmed && (
                  <p className="text-xs text-yellow-400 mt-1">{t('unlock_warning_possible')}</p>
                )}
              </div>
            </div>

            {/* Details grid */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { icon: MapPin, label: t('unlock_location'), value: preview.location },
                { icon: Globe, label: t('unlock_transaction'), value: preview.transaction },
                preview.budget_min || preview.budget_max
                  ? { icon: DollarSign, label: t('unlock_budget'), value: `${preview.budget_currency ?? 'USD'} ${preview.budget_min ? `${preview.budget_min.toLocaleString()}` : ''}${preview.budget_min && preview.budget_max ? '–' : ''}${preview.budget_max ? preview.budget_max.toLocaleString() : ''}` }
                  : null,
                preview.freshness_days != null
                  ? { icon: Clock, label: t('unlock_freshness'), value: `${preview.freshness_days}d ago` }
                  : null,
                { icon: BarChart3, label: t('unlock_confidence'), value: `${Math.round((preview.confidence ?? 0) * 100)}%` },
                { icon: Globe, label: t('unlock_source'), value: preview.source },
              ].filter(Boolean).map((item) => item && (
                <div key={item.label} className="flex items-start gap-2 p-2 bg-secondary/50 rounded-lg">
                  <item.icon className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-[10px] text-muted-foreground">{item.label}</p>
                    <p className="text-xs font-medium text-foreground truncate">{item.value}</p>
                  </div>
                </div>
              ))}
            </div>

            {preview.requirements && (
              <div className="p-3 bg-secondary/40 rounded-lg border border-border">
                <p className="text-[10px] text-muted-foreground mb-0.5">{t('unlock_requirements')}</p>
                <p className="text-xs text-foreground">{preview.requirements}</p>
              </div>
            )}

            <Separator />

            {/* Price */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">{t('unlock_price_label')}</p>
                <p className="text-xl font-bold text-primary">{preview.customer_price} {preview.currency}</p>
                <p className="text-xs text-muted-foreground">
                  {t('payg_balance_after')}: <span className={balanceAfter < 0 ? 'text-destructive' : 'text-foreground'}>{balanceAfter.toFixed(2)}</span>
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-secondary px-3 py-1.5 rounded-full">
                <Coins className="h-3.5 w-3.5" />
                Balance: <span className="font-medium text-foreground">{creditBalance}</span>
              </div>
            </div>

            {!canAfford && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-xs text-destructive flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {t('unlock_insufficient')} — need {preview.customer_price}, have {creditBalance}
              </div>
            )}
          </div>
        )}

        {/* Revealed */}
        {step === 'revealed' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-3 bg-primary/10 border border-primary/20 rounded-xl">
              <Unlock className="h-5 w-5 text-primary shrink-0" />
              <div>
                <p className="text-sm font-semibold text-foreground">Contact revealed</p>
                {creditsCharged > 0 && (
                  <p className="text-xs text-muted-foreground">{creditsCharged} credits charged</p>
                )}
              </div>
            </div>

            {contact && (contact.phone || contact.email || contact.whatsapp || contact.telegram)
              ? (
                <div className="space-y-2">
                  {contact.phone && (
                    <div className="flex items-center gap-3 p-3 bg-secondary rounded-lg">
                      <Phone className="h-4 w-4 text-primary shrink-0" />
                      <div>
                        <p className="text-[10px] text-muted-foreground">Phone</p>
                        <p className="text-sm font-medium">{contact.phone}</p>
                      </div>
                    </div>
                  )}
                  {contact.email && (
                    <div className="flex items-center gap-3 p-3 bg-secondary rounded-lg">
                      <Mail className="h-4 w-4 text-primary shrink-0" />
                      <div>
                        <p className="text-[10px] text-muted-foreground">Email</p>
                        <p className="text-sm font-medium">{contact.email}</p>
                      </div>
                    </div>
                  )}
                  {contact.whatsapp && (
                    <div className="flex items-center gap-3 p-3 bg-secondary rounded-lg">
                      <MessageCircle className="h-4 w-4 text-primary shrink-0" />
                      <div>
                        <p className="text-[10px] text-muted-foreground">WhatsApp</p>
                        <p className="text-sm font-medium">{contact.whatsapp}</p>
                      </div>
                    </div>
                  )}
                  {contact.telegram && (
                    <div className="flex items-center gap-3 p-3 bg-secondary rounded-lg">
                      <MessageCircle className="h-4 w-4 text-primary shrink-0" />
                      <div>
                        <p className="text-[10px] text-muted-foreground">Telegram</p>
                        <p className="text-sm font-medium">{contact.telegram}</p>
                      </div>
                    </div>
                  )}
                </div>
              )
              : (
                <div className="p-4 bg-secondary rounded-xl text-center">
                  <p className="text-sm text-muted-foreground">{t('unlock_no_contact')}</p>
                </div>
              )
            }
          </div>
        )}

        <DialogFooter>
          {step === 'preview' && preview && (
            <>
              <Button variant="outline" onClick={onClose} disabled={confirming}>
                {t('unlock_cancel_btn')}
              </Button>
              <Button onClick={handleConfirm} disabled={confirming || !canAfford}>
                {confirming
                  ? <><div className="h-4 w-4 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground animate-spin mr-2" /> Unlocking…</>
                  : <><Unlock className="h-4 w-4 mr-2" /> {t('unlock_confirm_btn')}</>
                }
              </Button>
            </>
          )}
          {(step === 'revealed' || step === 'error') && (
            <Button onClick={onClose}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
