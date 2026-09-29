import React from 'react';
import { useLocation } from 'react-router-dom';
import { Bot } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAssistant } from '@/components/assistant/AssistantContext';
import { shouldShowFloatingAiShortcut } from '@/lib/floatingAiShortcut';

/**
 * Floating "Ask Homatch AI" shortcut.
 *
 * WHERE it appears is not this file's decision: eligibility lives in
 * lib/floatingAiShortcut.ts as one pure rule (no shortcut inside the AI
 * product, none over a screen's own composer), tested directly. This file
 * owns only presentation.
 *
 * IT OPENS, IT DOES NOT NAVIGATE.
 *
 * This used to call navigate('/ai'). Inside the agent wizard or the campaign
 * builder that unmounted the route, so asking a question threw away every
 * unsaved field and reset the step — which made the button something to avoid
 * precisely where it was most useful. It now opens the assistant over the
 * current page, which stays mounted and therefore stays filled in.
 *
 * POSITIONING CONTRACT (mobile): the bottom offset is derived from the
 * MobileBottomNav's real geometry — its 3.75rem bar plus the safe-area
 * inset it already pads itself with — plus a 0.75rem breathing gap. Not a
 * magic number that happens to clear one phone: a device with a home
 * indicator raises the bar and the shortcut together.
 */
export function AIFloatingButton() {
  const location = useLocation();
  const { t, isRTL } = useLanguage();
  const { setOpen } = useAssistant();

  if (!shouldShowFloatingAiShortcut(location.pathname)) return null;

  return (
    <button
      type="button"
      aria-label={t('ai_floating_label')}
      onClick={() => setOpen(true)}
      className={[
        'fixed z-40 flex items-center gap-2',
        'bg-primary text-primary-foreground shadow-hover',
        'rounded-full px-4 py-2.5 text-sm font-medium',
        'hover:bg-primary/90 transition-all duration-200',
        'hover:scale-105 active:scale-95',
        // Above the mobile bottom nav (3.75rem + its safe-area padding) with
        // a 0.75rem gap; from md the nav is gone and the inset is ordinary.
        'bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] md:bottom-6',
        // RTL: anchor to left instead of right
        isRTL ? 'left-4 md:left-6' : 'right-4 md:right-6',
      ].join(' ')}
    >
      <Bot className="h-4 w-4 shrink-0" />
      <span className="hidden md:inline whitespace-nowrap">{t('ai_floating_label')}</span>
    </button>
  );
}
