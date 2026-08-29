import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Bot } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * Floating "Ask Homatch AI" button shown on all authenticated pages
 * except the AI page itself. Respects RTL layout (AR/HE).
 * On mobile it sits just above the bottom nav bar.
 */
export function AIFloatingButton() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, isRTL } = useLanguage();

  // Don't show on the AI page itself
  if (location.pathname === '/ai') return null;

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
        // RTL: anchor to left instead of right
        isRTL
          ? 'bottom-20 left-4 md:bottom-6 md:left-6'
          : 'bottom-20 right-4 md:bottom-6 md:right-6',
      ].join(' ')}
    >
      <Bot className="h-4 w-4 shrink-0" />
      <span className="hidden md:inline whitespace-nowrap">{t('ai_floating_label')}</span>
    </button>
  );
}
