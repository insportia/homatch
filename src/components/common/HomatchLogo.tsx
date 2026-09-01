// HOMATCH Logo — official H icon (brand mark) + wordmark
import React from 'react';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  iconOnly?: boolean;
  className?: string;
}

const sizes = {
  sm: { icon: 22, text: 'text-sm', gap: 'gap-1.5' },
  md: { icon: 30, text: 'text-lg', gap: 'gap-2' },
  lg: { icon: 44, text: 'text-2xl', gap: 'gap-3' },
};

export function HomatchLogo({ size = 'md', iconOnly = false, className = '' }: LogoProps) {
  const s = sizes[size];
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
        <span
          className={`font-semibold tracking-widest ${s.text} text-foreground`}
          style={{ letterSpacing: '0.12em', fontFamily: 'Montserrat, sans-serif' }}
        >
          HOMATCH
        </span>
      )}
    </div>
  );
}
