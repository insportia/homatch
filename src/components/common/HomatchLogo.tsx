// HOMATCH Logo — official H icon (brand mark) + wordmark
import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  iconOnly?: boolean;
  /**
   * Renders the reference's stacked lockup: brand mark on the left, wordmark
   * with the tagline set beneath it. The mark itself is the repository's
   * canonical asset either way — only the text block changes.
   */
  withTagline?: boolean;
  /** 'light' is the wordmark on a dark ground. The brand mark itself is the
      same asset either way — only the type changes. */
  tone?: 'dark' | 'light';
  className?: string;
}

const sizes = {
  sm: { icon: 22, text: 'text-sm', gap: 'gap-1.5', tagline: 'text-[8px]' },
  md: { icon: 30, text: 'text-lg', gap: 'gap-2', tagline: 'text-[9px]' },
  lg: { icon: 44, text: 'text-2xl', gap: 'gap-3', tagline: 'text-[11px]' },
};

export function HomatchLogo({ size = 'md', iconOnly = false, withTagline = false, tone = 'dark', className = '' }: LogoProps) {
  const s = sizes[size];
  const { t } = useLanguage();

  return (
    <div className={`flex items-center ${s.gap} ${className}`}>
      <img
        src="/images/logo/homatch-icon.png"
        width={s.icon}
        height={s.icon}
        alt="Homatch"
        className="shrink-0 select-none"
        draggable={false}
      />

      {!iconOnly && (
        <span className="flex flex-col items-start leading-none min-w-0">
          <span
            className={`font-semibold tracking-widest ${s.text} ${tone === 'light' ? 'text-white' : 'text-foreground'}`}
            style={{ letterSpacing: '0.12em', fontFamily: 'Montserrat, sans-serif' }}
          >
            HOMATCH
          </span>
          {withTagline && (
            <span
              className={`${s.tagline} mt-1 font-medium uppercase truncate max-w-full ${tone === 'light' ? 'text-white/55' : 'text-muted-foreground'}`}
              style={{ letterSpacing: '0.14em' }}
            >
              {t('brand_tagline')}
            </span>
          )}
        </span>
      )}
    </div>
  );
}
