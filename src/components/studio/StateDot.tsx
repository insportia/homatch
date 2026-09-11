import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { LocaleState } from '@/site/model';

/**
 * One locale's translation state, as a dot.
 *
 * Colour alone is never the message: every dot carries a title and an
 * accessible label naming the state in words, because "the amber one" is not
 * a usable instruction for a reviewer who cannot distinguish amber from grey.
 */
const STYLES: Record<LocaleState, { className: string; labelKey: string }> = {
  current: { className: 'bg-transparent ring-1 ring-border', labelKey: 'studio_state_current' },
  needs_update: { className: 'bg-amber-500', labelKey: 'studio_state_needs_update' },
  ai_suggested: { className: 'bg-sky-500', labelKey: 'studio_state_ai_suggested' },
  reviewed: { className: 'bg-emerald-600', labelKey: 'studio_state_reviewed' },
};

export function StateDot({ state, className = '' }: { state: LocaleState; className?: string }) {
  const { t } = useLanguage();
  const style = STYLES[state];
  const label = t(style.labelKey);

  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${style.className} ${className}`}
      title={label}
      role="img"
      aria-label={label}
    />
  );
}

export function StateBadge({ state }: { state: LocaleState }) {
  const { t } = useLanguage();
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
      <StateDot state={state} />
      {t(STYLES[state].labelKey)}
    </span>
  );
}
