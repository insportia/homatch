// HOMATCH Communications — add one contact by hand.
//
// There was an importer and a profile page and nothing in between, so the only
// way to get a single person into the product was to build a spreadsheet for
// them. This is the missing middle.
//
// The number is parsed BEFORE it is sent, with the same parser the import path
// uses. That matters for two reasons: the customer finds out here that their
// number is unreadable, rather than later from a call that never connected;
// and a number typed here and the same number imported from a sheet resolve to
// one identity, so they do not become two people who both get dialled.

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { UserPlus, Loader2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useLanguage } from '@/contexts/LanguageContext';
import { createContact } from '@/services/communications';
import { parsePhone } from '@/lib/comm/phone';

/** Countries the product actually operates in, plus the ones its customers call. */
const COUNTRIES = ['GE', 'US', 'GB', 'DE', 'TR', 'RU', 'UA', 'IL', 'AE', 'AM', 'AZ'];
const LANGUAGES = ['ka', 'en', 'ru', 'tr', 'ar', 'he'];

export function AddContactDialog({
  open, onOpenChange, onAdded,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onAdded: () => void;
}) {
  const { t } = useLanguage();
  const [phone, setPhone] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [country, setCountry] = useState('GE');
  const [language, setLanguage] = useState('ka');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  /* Live, so the customer sees the number resolve as they type rather than
   * finding out it was unusable after pressing Save. */
  const parsed = useMemo(
    () => (phone.trim() ? parsePhone(phone, country) : null),
    [phone, country],
  );
  const canSave = !!parsed?.e164 && !saving;

  const reset = () => {
    setPhone(''); setFullName(''); setEmail(''); setNotes('');
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await createContact({
        phone, full_name: fullName, email, country, language, notes,
      });
      if (res.ok) {
        toast.success(t('comms_contact_added'));
        reset();
        onOpenChange(false);
        onAdded();
        return;
      }
      toast.error(t(
        res.reason === 'BAD_PHONE' ? 'comms_contact_bad_phone'
          : res.reason === 'DUPLICATE' ? 'comms_contact_exists'
          : res.reason === 'DENIED' ? 'comm_save_denied'
          : res.reason === 'NOT_SIGNED_IN' ? 'comm_save_signed_out'
          : res.reason === 'INVALID' ? 'comm_save_invalid'
          : 'comm_save_failed',
      ));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <UserPlus className="h-4 w-4 shrink-0" aria-hidden="true" />
            {t('comms_contact_add')}
          </DialogTitle>
          <DialogDescription className="text-[13px] leading-snug [overflow-wrap:anywhere]">
            {t('comms_contact_add_sub')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ac-phone" className="text-xs">{t('comm_field_phone')}</Label>
            <Input
              id="ac-phone" value={phone} onChange={(e) => setPhone(e.target.value)}
              inputMode="tel" autoComplete="tel" className="h-9 font-mono text-sm"
              placeholder="+995 555 01 02 03"
            />
            <p className="text-2xs leading-snug text-muted-foreground [overflow-wrap:anywhere]">
              {parsed?.e164
                ? parsed.e164
                : t('comms_contact_phone_help')}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ac-name" className="text-xs">{t('comms_contact_full_name')}</Label>
              <Input id="ac-name" value={fullName} onChange={(e) => setFullName(e.target.value)} className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ac-email" className="text-xs">{t('comm_field_email')}</Label>
              <Input id="ac-email" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ac-country" className="text-xs">{t('comms_contacts_country')}</Label>
              <select
                id="ac-country" value={country} onChange={(e) => setCountry(e.target.value)}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ac-lang" className="text-xs">{t('comm_field_language')}</Label>
              <select
                id="ac-lang" value={language} onChange={(e) => setLanguage(e.target.value)}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                {LANGUAGES.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ac-notes" className="text-xs">{t('comm_field_notes')}</Label>
            <Textarea id="ac-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="resize-none text-sm" />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('comm_cancel')}
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={!canSave}>
            {saving ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
            {t('comm_save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
