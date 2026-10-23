// Where a CRM contact came from, how far it has come, and how the owner can reach it.
//
// For a contact saved from Find Buyers: the platform, the original post and public profile, the
// matched property, and the ladder Discovered → Qualified → Contactable → Email-eligible. The
// owner can add a contact detail the person gave them; its origin is recorded, and a detail never
// grants consent — that stays with the consent card below.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Fingerprint, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLanguage } from '@/contexts/LanguageContext';
import { CrmLadder } from '@/components/findBuyers/LeadCrmCard';
import { type ContactDetailOrigin, FindBuyersCrmError, crmLadder, setContactDetails } from '@/services/findBuyersCrm';
import type { CommContact } from '@/types/communications';

const ORIGINS: ContactDetailOrigin[] = ['PERSON_PROVIDED', 'OWNER_ENTERED', 'PUBLIC_POST'];
const safe = (u: string | null | undefined) => (u && /^https?:\/\//i.test(u) ? u : null);

export function ContactSourceCard({ contact, onChanged }: { contact: CommContact; onChanged: () => void }) {
  const { t } = useLanguage();
  const [email, setEmail] = useState(contact.email ?? '');
  const [phone, setPhone] = useState(contact.phone ?? '');
  const [origin, setOrigin] = useState<ContactDetailOrigin>((contact.contact_detail_origin as ContactDetailOrigin | null) ?? 'PERSON_PROVIDED');
  const [busy, setBusy] = useState(false);
  const fromFindBuyers = contact.source_kind === 'FIND_BUYERS';
  const dirty = email.trim() !== (contact.email ?? '') || phone.trim() !== (contact.phone ?? '') || origin !== (contact.contact_detail_origin ?? 'PERSON_PROVIDED');

  const save = async () => {
    setBusy(true);
    try {
      const r = await setContactDetails(contact.id, email.trim() || null, phone.trim() || null, email.trim() || phone.trim() ? origin : null);
      toast.success(t(r.consentStatus !== contact.consent_status ? 'fbcrm_details_saved_consent_reset' : 'fbcrm_details_saved'));
      onChanged();
    } catch (e) {
      const code = e instanceof FindBuyersCrmError ? e.code : '';
      toast.error(t(code === 'INVALID_EMAIL' ? 'fbcrm_err_email' : code === 'INVALID_PHONE' ? 'fbcrm_err_phone' : 'fbcrm_err_failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card><CardContent className="space-y-3 p-4">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold">
        <Fingerprint className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />{t('fbcrm_source_title')}
      </h2>
      {fromFindBuyers ? (
        <>
          <CrmLadder reached={crmLadder({
            matchCategory: contact.source_match_category, email: contact.email, phone: contact.phone, consentStatus: contact.consent_status,
            suppressed: contact.suppressed, unsubscribed: contact.unsubscribed, doNotContact: contact.do_not_contact,
          })} />
          <dl className="grid gap-1.5 text-[13px] sm:grid-cols-2">
            <div className="flex items-center justify-between gap-2 sm:block">
              <dt className="text-muted-foreground">{t('fbcrm_source_platform')}</dt>
              <dd className="font-medium">{contact.source_platform ?? '·'}</dd>
            </div>
            <div className="flex items-center justify-between gap-2 sm:block">
              <dt className="text-muted-foreground">{t('fbcrm_source_match')}</dt>
              <dd className="font-medium">{contact.source_match_category ? t(`fbr_cat_${contact.source_match_category}`) : t('fbr_cat_UNCATEGORISED')}</dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-2">
            {safe(contact.source_url) ? (
              <a href={safe(contact.source_url)!} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-[13px] font-medium underline underline-offset-2">
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />{t('fbcrm_open_post')}
              </a>
            ) : null}
            {safe(contact.source_profile_url) ? (
              <a href={safe(contact.source_profile_url)!} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-[13px] font-medium underline underline-offset-2">
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />{t('fbcrm_open_profile')}
              </a>
            ) : null}
            {contact.source_property_id ? (
              <Link to={`/property/${contact.source_property_id}/buyers/external`} className="inline-flex items-center gap-1 text-[13px] font-medium underline underline-offset-2">
                {t('fbcrm_open_results')}
              </Link>
            ) : null}
          </div>
          {contact.notes ? <p className="rounded-lg bg-muted/40 p-2.5 text-[13px] leading-snug" dir="auto">{contact.notes}</p> : null}
        </>
      ) : (
        <p className="text-[13px] text-muted-foreground">{t(contact.source_kind === 'MANUAL' ? 'fbcrm_source_manual' : 'fbcrm_source_import')}</p>
      )}

      <form className="space-y-2 border-t pt-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <p className="text-[13px] font-semibold">{t('fbcrm_details_title')}</p>
        <p className="text-2xs leading-snug text-muted-foreground">{t('fbcrm_details_note')}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="crm-email" className="text-2xs">{t('emc_address')}</Label>
            <Input id="crm-email" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="crm-phone" className="text-2xs">{t('comm_field_phone')}</Label>
            <Input id="crm-phone" type="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" />
          </div>
        </div>
        <fieldset className="space-y-1">
          <legend className="text-2xs font-medium">{t('fbcrm_origin_label')}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {ORIGINS.map((o) => (
              <label key={o} className="inline-flex items-center gap-1.5 text-[13px]">
                <input type="radio" name="crm-origin" value={o} checked={origin === o} onChange={() => setOrigin(o)} className="h-4 w-4 accent-[hsl(38_92%_50%)]" />
                {t(`fbcrm_origin_${o}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <Button type="submit" size="sm" disabled={busy || !dirty} className="gap-1.5">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}{t('fbcrm_details_save')}
        </Button>
      </form>
    </CardContent></Card>
  );
}
