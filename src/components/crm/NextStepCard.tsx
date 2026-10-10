import { Sparkles } from 'lucide-react';
import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { NextStep } from '@/crm/nextStep';
import { cn } from '@/lib/utils';
import { SECONDARY_BUTTON } from './ui';

/**
 * Suggested Next Step — a deterministic rule (src/crm/nextStep.ts), shown with the
 * approved label and disclaimer. It suggests; it never changes anything by itself.
 */
export function NextStepCard({
  step,
  onAction,
  canOpenConversation,
}: {
  step: NextStep;
  onAction: (action: NonNullable<NextStep['action']>) => void;
  canOpenConversation: boolean;
}) {
  const { t } = useLanguage();
  const action = step.action === 'conversation' && !canOpenConversation ? null : step.action;
  const actionLabel: Record<NonNullable<NextStep['action']>, string> = {
    conversation: t('crm_open_conversation'),
    follow_up: t('crm_schedule_follow_up'),
    note: t('crm_add_note'),
    status: t('crm_update_status'),
  };
  return (
    <section
      aria-labelledby="crm-next-step"
      className="rounded-2xl border border-[hsl(38_60%_78%)] bg-[linear-gradient(180deg,hsl(42_90%_97%),hsl(0_0%_100%))] p-4 sm:p-5"
      data-crm-next-step={step.code}
    >
      <p id="crm-next-step" className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.12em] text-[hsl(34_90%_31%)]">
        <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0">{t('crm_next_label')}</span>
      </p>
      <p className="mt-2 break-words font-display text-base font-semibold text-[hsl(218_45%_14%)]">{t(step.titleKey)}</p>
      <p className="mt-1 break-words text-sm leading-relaxed text-[hsl(218_28%_32%)]">{t(step.bodyKey)}</p>
      {action ? (
        <button type="button" className={cn(SECONDARY_BUTTON, 'mt-3')} onClick={() => onAction(action)}>
          {actionLabel[action]}
        </button>
      ) : null}
      <p className="mt-3 border-t border-[hsl(38_40%_86%)] pt-2.5 text-2xs leading-relaxed text-[hsl(218_15%_40%)]">
        {t('crm_next_disclaimer')}
      </p>
    </section>
  );
}
