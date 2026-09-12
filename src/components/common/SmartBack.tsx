import React, { useCallback } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { canGoBackInApp, parentRouteFor } from '@/lib/backNavigation';

/**
 * The back affordance. Its RULES live in lib/backNavigation.ts, with no React
 * in them, so they can be tested directly; this file is the control.
 *
 * Quiet on purpose: a hairline text button, not a filled one, so it is
 * findable without competing with the page's own actions.
 */

export interface SmartBackProps {
  /** Overrides the computed parent when a screen knows better. */
  fallback?: string;
  /** Shown beside the arrow. Omit for an icon-only control. */
  label?: string;
  className?: string;
}

/**
 * A quiet control: it should be findable without competing with the page's
 * own actions, which is why it is a text button with a hairline rather than
 * a filled one.
 */
export function SmartBack({ fallback, label, className = '' }: SmartBackProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, isRTL } = useLanguage();

  const onClick = useCallback(() => {
    if (canGoBackInApp()) {
      navigate(-1);
      return;
    }
    navigate(fallback ?? parentRouteFor(location.pathname) ?? '/', { replace: true });
  }, [navigate, fallback, location.pathname]);

  const text = label ?? t('general_back');

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={text}
      className={
        'inline-flex min-h-[44px] items-center gap-2 rounded-full border border-border bg-card ps-3 pe-4 '
        + 'text-sm font-medium text-ink-soft transition-colors hover:border-foreground/30 hover:text-foreground '
        + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 '
        + className
      }
    >
      {/* The arrow points back, which in an RTL layout is to the right. */}
      <ArrowLeft className={`h-4 w-4 shrink-0 ${isRTL ? 'rotate-180' : ''}`} strokeWidth={2} aria-hidden="true" />
      <span className="truncate">{text}</span>
    </button>
  );
}
