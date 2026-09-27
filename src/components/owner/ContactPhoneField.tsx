// THE NUMBER A PROPERTY IS REACHED ON.
//
// One field, used by the private-listing form, the import review and the edit screen, so
// that what counts as a usable number is decided once and the same message comes back
// wherever somebody types one.
//
// WHY IT SHOWS WHAT IT UNDERSTOOD
//
// The number is normalised before it is stored — "+995 555 123 456" and "+995555123456"
// are the same contact and must not become two — which means what gets saved is not
// always character-for-character what was typed. A field that silently rewrites its own
// value is unsettling; a field that says "we read this as +995555123456" is telling the
// owner the one thing they need in order to spot a wrong digit.
//
// WHY THERE IS AN ACCOUNT-NUMBER OFFER AND NOT AN ACCOUNT-NUMBER DEFAULT
//
// Most owners will use their own number and it is rude to make them type it again. But an
// agent listing a client's flat, or somebody listing their mother's, is the ordinary case
// rather than the exotic one — so the account number is offered as one tap and never
// assumed. Nothing here writes back to the account either: a property's contact and an
// account's contact are two facts about two different things.
//
// WHY IT LOOKS LIKE THE OWNER WORKSPACE
//
// It reads `--primary`, `--border`, `--input` and friends and names no colour of its own,
// so it is dark navy on the owner surface and correct anywhere else the family goes. It
// imports no shadcn Card, Badge or Button — see src/components/customer/surface.tsx for
// why that matters.

import { Check, Phone } from 'lucide-react';
import React, { useId, useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { type ContactPhoneProblem, readContactPhone } from '@/lib/propertyContact';
import { cn } from '@/lib/utils';

/** The message for each way a number can fail to be one. */
const PROBLEM_KEYS: Readonly<Record<ContactPhoneProblem, string>> = {
  /* Not an error yet — the field is simply empty, and an empty required field is told
     about at submit rather than scolded about while somebody is still typing. */
  EMPTY: 'contact_phone_required',
  /* A different message on purpose: "555123456" is not wrong, it is incomplete, and
     telling somebody their number is invalid sends them to check the digits. */
  NO_COUNTRY: 'contact_phone_needs_country',
  UNREACHABLE: 'contact_phone_unreachable',
};

export function ContactPhoneField({
  value,
  onChange,
  defaultCountry,
  accountPhone,
  showProblem,
  label,
}: {
  /** The raw text, owned by the form. */
  value: string;
  onChange: (next: string) => void;
  /** Used only for a number written without an international prefix. */
  defaultCountry?: string | null;
  /** The number on the account, offered rather than assumed. */
  accountPhone?: string | null;
  /** Show the failure. False while the field has not been submitted or blurred yet. */
  showProblem?: boolean;
  label?: string;
}) {
  const { t } = useLanguage();
  const fieldId = useId();
  const reading = useMemo(
    () => readContactPhone(value, defaultCountry),
    [value, defaultCountry],
  );

  const problem = showProblem ? reading.problem : null;
  const accepted = reading.contact;
  /* Only worth offering when it is a number and it is not already the one in the box. */
  const offer = accountPhone?.trim() && accountPhone.trim() !== value.trim()
    ? accountPhone.trim()
    : null;

  return (
    <div className="space-y-1.5">
      <label htmlFor={fieldId} className="block break-words text-2xs text-muted-foreground">
        {label ?? t('contact_phone_label')}
      </label>

      <div
        className={cn(
          'flex min-h-10 items-center gap-2 rounded-lg border bg-[hsl(var(--input))] px-3',
          'focus-within:ring-2 focus-within:ring-[hsl(var(--ring))]',
          problem ? 'border-[hsl(var(--destructive))]' : 'border-border',
        )}
      >
        <Phone className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          id={fieldId}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          /* A phone number is digits and runs left to right inside an Arabic or Hebrew
             page, where the label beside it does not. */
          dir="ltr"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t('contact_phone_placeholder')}
          aria-invalid={problem ? true : undefined}
          aria-describedby={`${fieldId}-note`}
          className="min-w-0 flex-1 bg-transparent py-2 text-2xs text-foreground outline-none placeholder:text-muted-foreground/60"
        />
        {accepted && (
          <Check
            className="h-4 w-4 shrink-0 text-[hsl(var(--success))]"
            aria-hidden="true"
          />
        )}
      </div>

      <p id={`${fieldId}-note`} className="min-h-4 break-words text-2xs">
        {problem ? (
          <span className="text-[hsl(var(--destructive))]">{t(PROBLEM_KEYS[problem] as never)}</span>
        ) : accepted ? (
          /*
            WHAT WILL BE SAVED, SAID OUT LOUD. The stored value is the canonical form
            rather than the typed one, and an owner who cannot see that cannot notice a
            digit we read differently from the way they meant it.
          */
          <span className="text-muted-foreground">
            {t('contact_phone_reading')}{' '}
            <span dir="ltr" className="font-semibold text-foreground">
              {accepted.contact_phone_e164}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground/75">{t('contact_phone_help')}</span>
        )}
      </p>

      {offer && (
        /*
          OFFERED, NEVER ASSUMED. One tap for the common case; nothing at all for the
          agent listing somebody else's flat, who would otherwise have to notice and
          undo a value they never chose.
        */
        <button
          type="button"
          onClick={() => onChange(offer)}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-border bg-[hsl(var(--secondary))] px-2.5 text-2xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
        >
          <span className="break-words text-start">{t('contact_phone_use_account')}</span>
          <span dir="ltr" className="font-semibold text-foreground">{offer}</span>
        </button>
      )}
    </div>
  );
}

/**
 * The six-digit reference, where somebody might want to quote it.
 *
 * Quiet on purpose. It is the most COPYABLE thing on the page and close to the least
 * important: the title, the price and the location are what an owner came to read, and a
 * reference number set in anything but 13px muted would be shouting an index at them.
 *
 * Selectable rather than a copy button: `select-all` means one click takes the whole
 * number, which is what somebody reading it out or pasting it into a support message
 * actually wants, and it works without a clipboard permission.
 */
export function PropertyReference({ id }: { id: number | null | undefined }) {
  const { t } = useLanguage();
  if (!id) return null;
  return (
    <span className="inline-flex items-baseline gap-1.5 text-2xs text-muted-foreground">
      <span className="break-words">{t('prop_reference_label')}</span>
      <span dir="ltr" className="select-all font-semibold tabular-nums text-foreground">
        {id}
      </span>
    </span>
  );
}
