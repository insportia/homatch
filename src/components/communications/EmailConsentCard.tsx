// Marketing-email consent for one contact, on the contact profile.
//
// HOMATCH sends marketing email only to contacts whose consent is recorded
// (consent_status = CONSENTED). Being found by Find Buyers, or imported, is not
// consent: the owner records it here with a lawful basis and their own
// attestation, or withdraws it. An opted-out or suppressed address cannot be
// re-consented by the owner — the server refuses it.
import React, { useState } from 'react';
import { Mail, MessageSquare } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { EmailMarketingError, type LawfulBasis, setContactEmailConsent } from '@/services/emailMarketing';
import type { CommContact } from '@/types/communications';

const BASES: Array<{ value: LawfulBasis; key: 'emc_basis_consent' | 'emc_basis_contract' | 'emc_basis_customer' }> = [
  { value: 'CONSENT', key: 'emc_basis_consent' },
  { value: 'CONTRACT', key: 'emc_basis_contract' },
  { value: 'LEGITIMATE_INTEREST_EXISTING_CUSTOMER', key: 'emc_basis_customer' },
];

const ERROR_KEYS = {
  CONTACT_OPTED_OUT: 'emc_err_opted_out',
  CONTACT_HAS_NO_EMAIL: 'emc_err_no_email',
} as const;

export function EmailConsentCard({ contact, onChanged }: { contact: CommContact; onChanged: () => void }) {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [basis, setBasis] = useState<LawfulBasis>('CONSENT');
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false);

  const consented = contact.consent_status === 'CONSENTED';
  const optedOut = Boolean(contact.unsubscribed || contact.suppressed || contact.do_not_contact);
  const basisKey = BASES.find((b) => b.value === contact.consent_lawful_basis)?.key;
  const recorded = contact.consent_recorded_at
    ? new Date(contact.consent_recorded_at).toLocaleDateString(lang, { dateStyle: 'medium' })
    : null;

  const save = async (grant: boolean) => {
    setBusy(true);
    try {
      await setContactEmailConsent(contact.id, grant, grant ? basis : null);
      toast.success(t(grant ? 'emc_saved' : 'emc_withdrawn_toast'));
      setOpen(false);
      setAttested(false);
      onChanged();
    } catch (e) {
      const code = e instanceof EmailMarketingError ? e.code : '';
      toast.error(t(ERROR_KEYS[code as keyof typeof ERROR_KEYS] ?? 'emc_err_failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card><CardContent className="space-y-3 p-4">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold">
        <Mail className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        {t('emc_section')}
      </h2>
      <dl className="space-y-1.5 text-[13px]">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">{t('emc_address')}</dt>
          <dd className="min-w-0 truncate font-medium" dir="ltr">{contact.email ?? '·'}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">{t('emc_status')}</dt>
          <dd>
            <Badge variant={consented && !optedOut ? 'default' : 'outline'} className="text-2xs">
              {t(optedOut ? 'emc_status_opted_out' : consented ? 'emc_status_consented'
                : contact.consent_status === 'WITHDRAWN' ? 'emc_status_withdrawn' : 'emc_status_none')}
            </Badge>
          </dd>
        </div>
        {consented && basisKey ? (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">{t('emc_basis_label')}</dt>
            <dd className="text-end font-medium">{t(basisKey)}</dd>
          </div>
        ) : null}
        {recorded ? (
          <p className="text-2xs text-muted-foreground">{t('emc_recorded_on', { date: recorded })}</p>
        ) : null}
      </dl>
      <p className="text-2xs text-muted-foreground">{t('emc_explainer')}</p>
      <div className="flex flex-wrap gap-2">
        {!consented ? (
          <Button size="sm" disabled={busy || optedOut || !contact.email} onClick={() => setOpen(true)}>
            {t('emc_record')}
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void save(false)}>
            {t('emc_withdraw')}
          </Button>
        )}
        {contact.email ? (
          <Button size="sm" variant="ghost" onClick={() => navigate('/inbox/email')}>
            <MessageSquare className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />{t('emc_open_inbox')}
          </Button>
        ) : null}
      </div>

      <AlertDialog open={open} onOpenChange={(o) => { if (!o) { setOpen(false); setAttested(false); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('emc_dialog_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('emc_dialog_body')}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <p className="text-sm font-medium">{t('emc_basis_label')}</p>
            <RadioGroup value={basis} onValueChange={(v) => setBasis(v as LawfulBasis)}>
              {BASES.map((b) => (
                <div key={b.value} className="flex items-center gap-2">
                  <RadioGroupItem value={b.value} id={`emc-basis-${b.value}`} />
                  <Label htmlFor={`emc-basis-${b.value}`} className="text-sm font-normal">{t(b.key)}</Label>
                </div>
              ))}
            </RadioGroup>
            <div className="flex items-start gap-2">
              <Checkbox id="emc-attest" checked={attested} onCheckedChange={(v) => setAttested(v === true)} className="mt-0.5" />
              <Label htmlFor="emc-attest" className="text-sm font-normal leading-snug">{t('emc_attest')}</Label>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t('emc_cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={busy || !attested} onClick={(e) => { e.preventDefault(); void save(true); }}>
              {t('emc_save')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CardContent></Card>
  );
}
