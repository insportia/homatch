/*
 * WHAT OWNERS MAY DO WITH ME, AS A LEAD.
 *
 * A member who is searching can be found by owners whose property matches. These four
 * switches are that member's own consent (lead_contact_preferences), re-checked by the
 * server on every read, so turning one off applies immediately.
 *
 * Plain sentences, because each switch is a consent decision: what it allows, and what
 * it does not. An unlock never equals marketing consent, and the copy says so.
 */

import { Building2, Loader2, Mail, Megaphone, Phone, ShieldCheck } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  DEFAULT_LEAD_CONTACT_PREFERENCES, getMyLeadContactPreferences, setMyLeadContactPreferences,
  type LeadContactPreferences as Prefs,
} from '@/services/leadContactPreferences';

const ROWS: Array<{ key: keyof Prefs; icon: React.ComponentType<{ className?: string }>; label: string; hint: string }> = [
  { key: 'acceptPropertyOffers', icon: Building2, label: 'crm_pref_offers_label', hint: 'crm_pref_offers_hint' },
  { key: 'sharePhoneOnUnlock', icon: Phone, label: 'crm_pref_phone_label', hint: 'crm_pref_phone_hint' },
  { key: 'shareEmailOnUnlock', icon: Mail, label: 'crm_pref_email_label', hint: 'crm_pref_email_hint' },
  { key: 'acceptMarketingEmail', icon: Megaphone, label: 'crm_pref_marketing_label', hint: 'crm_pref_marketing_hint' },
];

export function LeadContactPreferences() {
  const { t } = useLanguage();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_LEAD_CONTACT_PREFERENCES);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState<keyof Prefs | null>(null);

  useEffect(() => {
    let alive = true;
    getMyLeadContactPreferences()
      .then((p) => { if (alive) { setPrefs(p); setLoaded(true); } })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  const change = async (key: keyof Prefs, on: boolean) => {
    const before = prefs;
    setPrefs({ ...prefs, [key]: on });
    setSaving(key);
    try {
      setPrefs(await setMyLeadContactPreferences({ [key]: on }));
    } catch {
      setPrefs(before);
      toast.error(t('crm_pref_failed'));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="border-b border-border p-5" data-lead-contact-preferences>
      <p className="text-[15px] font-medium text-foreground">{t('crm_pref_title')}</p>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t('crm_pref_sub')}</p>
      {failed ? (
        <p role="alert" className="mt-3 text-sm text-destructive">{t('crm_pref_load_failed')}</p>
      ) : (
        <ul className="mt-3 space-y-4">
          {ROWS.map(({ key, icon: Icon, label, hint }) => {
            const id = `lead-pref-${key}`;
            return (
              <li key={key} className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <Label htmlFor={id} className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0">{t(label)}</span>
                    {saving === key ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
                  </Label>
                  <p id={`${id}-hint`} className="mt-0.5 text-2xs leading-relaxed text-muted-foreground">{t(hint)}</p>
                </div>
                {/* The switch's own hit area is small; the padded wrapper keeps a 44px target. */}
                <span className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center">
                  <Switch
                    id={id}
                    aria-describedby={`${id}-hint`}
                    disabled={!loaded || saving !== null}
                    checked={prefs[key]}
                    onCheckedChange={(on) => void change(key, on)}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-4 flex items-start gap-2.5 rounded-lg border border-border bg-[hsl(var(--secondary))]/60 p-3 text-2xs leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-foreground/70" aria-hidden="true" />
        <span className="min-w-0">{t('crm_pref_unlock_note')}</span>
      </p>
    </div>
  );
}
