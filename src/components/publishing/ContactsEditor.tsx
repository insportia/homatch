// THE LISTING'S CONTACT NUMBERS — one to three, each with its own channels.
//
// Call is on for every valid number (a phone number can always be called).
// WhatsApp and Viber are switched on only by the owner: a valid number says
// nothing about which messaging apps it has. The property's own number is
// OFFERED, never copied in silently — a listing's numbers are published on
// portals. Numbers are normalised to E.164 here for the live footer preview;
// the server normalises again and is the authority.

import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { Check, Copy, MessageCircle, Phone, Plus, X } from 'lucide-react';
import React, { useState } from 'react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { type Contact, MAX_CONTACTS, contactLinks, formatPhone, isE164 } from '@/publishing/contacts';

const INPUT = 'h-10 w-full min-w-0 rounded-lg border border-border bg-[hsl(var(--card))] px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-[hsl(var(--gold-border))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--gold))]/25 aria-[invalid=true]:border-red-400';

/** Whatever was typed → E.164 when it is a valid number (Georgian numbers may omit +995). */
export function normalizePhone(raw: string): string {
  const parsed = parsePhoneNumberFromString(raw.trim(), 'GE');
  return parsed?.isValid() ? parsed.number : raw.replace(/[^\d+]/g, '');
}

function Channel({ on, label, onClick, disabled, icon }: { on: boolean; label: string; onClick?: () => void; disabled?: boolean; icon: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={cn('inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-2xs font-semibold transition-colors disabled:cursor-default',
        on ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-border text-muted-foreground hover:text-foreground')}
    >
      {icon}{label}
    </button>
  );
}

export function ContactsEditor({ contacts, onChange, suggestion, readOnly, problemAt }: {
  contacts: Contact[];
  onChange: (next: Contact[]) => void;
  /** The property's own number, offered for one-tap reuse. */
  suggestion: string | null;
  readOnly: boolean;
  problemAt: (index: number) => boolean;
}) {
  const { t } = useLanguage();
  const [typed, setTyped] = useState<Record<number, string>>({});
  const set = (i: number, patch: Partial<Contact>) => onChange(contacts.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const offer = suggestion && isE164(suggestion) && !contacts.some((c) => c.phone === suggestion) && contacts.length < MAX_CONTACTS ? suggestion : null;

  return (
    <div className="space-y-2.5" data-testid="pubw-contacts">
      {contacts.length === 0 ? <p className="text-2xs text-muted-foreground">{t('pubw_contacts_empty')}</p> : null}
      <ol className="space-y-2.5">
        {contacts.map((c, i) => {
          const valid = isE164(c.phone);
          const links = valid ? contactLinks(c) : null;
          const invalid = problemAt(i) || (!!c.phone && !valid && typed[i] === undefined);
          return (
            <li key={i} className="rounded-xl border border-border p-3" data-testid={`pubw-contact-${i}`}>
              <div className="flex min-w-0 items-start gap-2">
                <label className="min-w-0 flex-1">
                  <span className="sr-only">{t('pubw_contact_number_n', { n: i + 1 })}</span>
                  <input
                    type="tel" inputMode="tel" autoComplete="tel" dir="ltr" disabled={readOnly}
                    value={typed[i] ?? (valid ? formatPhone(c.phone) : c.phone)}
                    aria-invalid={invalid}
                    onChange={(e) => setTyped((m) => ({ ...m, [i]: e.target.value }))}
                    onBlur={() => {
                      const raw = typed[i];
                      if (raw === undefined) return;
                      setTyped((m) => { const n = { ...m }; delete n[i]; return n; });
                      set(i, { phone: normalizePhone(raw) });
                    }}
                    className={INPUT}
                  />
                </label>
                {valid ? (
                  <button type="button" aria-label={t('pubw_copy_phone')} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground hover:text-foreground"
                    onClick={async () => { try { await navigator.clipboard.writeText(formatPhone(c.phone)); toast.success(t('pubw_copied')); } catch { toast.error(t('pubw_copy_failed')); } }}>
                    <Copy className="h-4 w-4" aria-hidden="true" />
                  </button>
                ) : null}
                {!readOnly ? (
                  <button type="button" aria-label={t('pubw_contact_remove')} onClick={() => onChange(contacts.filter((_, j) => j !== i))}
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground hover:text-red-700">
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
              {invalid ? <p className="mt-1 text-2xs font-medium text-red-700">{t('pubw_problem_invalid_phone')}</p> : null}
              <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label={t('pubw_contact_channels')}>
                <Channel on={valid} disabled label={t('pubw_channel_call')} icon={<Phone className="h-3.5 w-3.5" aria-hidden="true" />} />
                <Channel on={c.whatsapp} disabled={readOnly} onClick={() => set(i, { whatsapp: !c.whatsapp })} label="WhatsApp" icon={c.whatsapp ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />} />
                <Channel on={c.viber} disabled={readOnly} onClick={() => set(i, { viber: !c.viber })} label="Viber" icon={c.viber ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />} />
              </div>
              {links ? (
                <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-2xs" data-testid={`pubw-contact-links-${i}`}>
                  <a href={links.call} className="font-semibold text-[hsl(var(--gold-ink))] hover:underline">{t('pubw_test_call')}</a>
                  {links.whatsapp ? <a href={links.whatsapp} target="_blank" rel="noopener noreferrer" className="font-semibold text-[hsl(var(--gold-ink))] hover:underline">{t('pubw_test_whatsapp')}</a> : null}
                  {links.viber ? <a href={links.viber} className="font-semibold text-[hsl(var(--gold-ink))] hover:underline">{t('pubw_test_viber')}</a> : null}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
      {!readOnly ? (
        <div className="flex flex-wrap gap-2">
          {offer ? (
            <button type="button" data-testid="pubw-contact-use-property" onClick={() => onChange([...contacts, { phone: offer, whatsapp: false, viber: false }])}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-dashed border-[hsl(var(--gold-border))] px-3 text-2xs font-semibold text-[hsl(var(--gold-ink))]">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />{t('pubw_contact_use_property', { phone: formatPhone(offer) })}
            </button>
          ) : null}
          {contacts.length < MAX_CONTACTS ? (
            <button type="button" data-testid="pubw-contact-add" onClick={() => onChange([...contacts, { phone: '', whatsapp: false, viber: false }])}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border px-3 text-2xs font-semibold text-foreground hover:border-[hsl(var(--gold-border))]">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />{t(contacts.length ? 'pubw_contact_add_another' : 'pubw_contact_add')}
            </button>
          ) : null}
        </div>
      ) : null}
      <p className="text-2xs text-muted-foreground">{t('pubw_contacts_hint')}</p>
    </div>
  );
}
