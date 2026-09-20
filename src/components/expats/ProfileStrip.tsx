// HOMATCH FOR EXPATS — the five questions that change the plan.
//
// There are fourteen fields on an expat profile. Five are here, because
// these five are the ones that change WHICH TASKS EXIST: why you are
// coming, when you arrive, who is coming with you, whether you are renting
// or buying, and whether you already own. The other nine adjust wording
// and ordering and are asked later, where they matter.
//
// §40 says progressive, and the honest test of progressive is whether the
// screen is usable having answered none of them. It is: an empty profile
// produces a full generic plan, and every answer narrows it.
//
// WHY NATIONALITY IS NOT HERE
//
// It is the one field that can change a legal answer, and it is also the
// one that makes a form feel like a border control. It is asked on the
// topics where it actually changes the rule, in context, with the reason
// visible. A citizenship dropdown in a settings strip collects the data
// and explains nothing.

import React from 'react';
import { Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import {
  EXPAT_INTENTS,
  HOUSEHOLDS,
  HOUSING_PLANS,
  type ExpatIntent,
  type ExpatProfile,
  type Household,
  type HousingPlan,
} from '@/expats/types';

export function ProfileStrip({
  profile,
  saving,
  onChange,
}: {
  profile: ExpatProfile;
  saving: boolean;
  onChange: (next: ExpatProfile) => void | Promise<void>;
}) {
  const { t } = useLanguage();

  const toggleIntent = (intent: ExpatIntent) => {
    const next = profile.intents.includes(intent)
      ? profile.intents.filter((i) => i !== intent)
      : [...profile.intents, intent];
    void onChange({ ...profile, intents: next });
  };

  return (
    <section
      data-expat-profile-strip
      className="rounded-2xl border border-border p-5 sm:p-6"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-foreground">{t('expat_profile_title')}</h2>
        {saving ? (
          <span className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            {t('expat_profile_saving')}
          </span>
        ) : null}
      </div>
      <p className="mb-5 text-2xs leading-relaxed text-muted-foreground">
        {t('expat_profile_note')}
      </p>

      <div className="space-y-5">
        <Field label={t('expat_profile_intent_label')} hint={t('expat_profile_intent_hint')}>
          <div className="flex flex-wrap gap-2">
            {EXPAT_INTENTS.map((intent) => (
              <Chip
                key={intent}
                active={profile.intents.includes(intent)}
                onClick={() => toggleIntent(intent)}
                data-expat-intent={intent}
              >
                {t(`expat_intent_${intent.toLowerCase()}`)}
              </Chip>
            ))}
          </div>
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t('expat_profile_arrival_label')} hint={t('expat_profile_arrival_hint')}>
            <input
              type="date"
              value={profile.arrivalDate ?? ''}
              data-expat-arrival
              onChange={(e) => void onChange({ ...profile, arrivalDate: e.target.value || null })}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
            />
          </Field>

          <Field label={t('expat_profile_household_label')}>
            <div className="flex flex-wrap gap-2">
              {HOUSEHOLDS.map((h: Household) => (
                <Chip
                  key={h}
                  active={profile.household === h}
                  onClick={() =>
                    void onChange({ ...profile, household: profile.household === h ? null : h })
                  }
                >
                  {t(`expat_household_${h.toLowerCase()}`)}
                </Chip>
              ))}
            </div>
          </Field>
        </div>

        <Field label={t('expat_profile_housing_label')}>
          <div className="flex flex-wrap gap-2">
            {HOUSING_PLANS.map((p: HousingPlan) => (
              <Chip
                key={p}
                active={profile.housingPlan === p}
                onClick={() =>
                  void onChange({
                    ...profile,
                    housingPlan: profile.housingPlan === p ? null : p,
                    // "I already own" and "I do not own property here" are
                    // the same answer said twice. Keeping them in step
                    // stops the plan offering to verify a purchase that
                    // happened two years ago.
                    alreadyOwnsProperty: p === 'ALREADY_OWN' ? true : profile.alreadyOwnsProperty,
                  })
                }
              >
                {t(`expat_housing_${p.toLowerCase()}`)}
              </Chip>
            ))}
          </div>
        </Field>

        <Field label={t('expat_profile_children_label')}>
          <div className="flex flex-wrap gap-2">
            {[0, 1, 2, 3].map((n) => (
              <Chip
                key={n}
                active={profile.childrenCount === n}
                onClick={() =>
                  void onChange({
                    ...profile,
                    childrenCount: profile.childrenCount === n ? null : n,
                  })
                }
              >
                {n === 3 ? t('expat_profile_children_three_plus') : String(n)}
              </Chip>
            ))}
          </div>
        </Field>
      </div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-2 text-2xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </p>
      {children}
      {hint ? <p className="mt-2 text-2xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
  ...rest
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-full border px-3.5 py-1.5 text-2xs transition-colors',
        active
          ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]'
          : 'border-border text-muted-foreground hover:text-foreground',
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
