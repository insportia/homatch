import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bot } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { shouldShowFloatingAiShortcut } from '@/lib/floatingAiShortcut';
import { useServiceVisible } from '@/lib/serviceControls';

/**
 * Floating "Ask Homatch AI" shortcut.
 *
 * WHERE it appears is not this file's decision: eligibility lives in
 * lib/floatingAiShortcut.ts as one pure rule (no shortcut inside the AI
 * product, none over a screen's own composer), tested directly. This file
 * owns only presentation.
 *
 * IT OPENS THE FULL ASSISTANT, DIRECTLY (owner, 2026-10-24).
 *
 * For a while it opened a small drawer over the page with an "open the full
 * version" link — an empty intermediate step people had to click through, and
 * one that did not behave well on phones. The owner asked for the full HOMI
 * assistant (/ai) straight away. Conversations live on the server
 * (ai_conversations), so /ai shows the person's history; screens with long
 * unsaved work either autosave (Email Studio) or do not show this shortcut
 * (lib/floatingAiShortcut.ts).
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
  const navigate = useNavigate();
  // Not offered while the assistant is paused (Admin → Service Control Center).
  const assistantVisible = useServiceVisible('ai_assistant');

  if (!assistantVisible || !shouldShowFloatingAiShortcut(location.pathname)) return null;

  return (
    <button
      type="button"
      aria-label={t('ai_floating_label')}
      onClick={() => navigate('/ai')}
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
