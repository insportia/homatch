// HOMATCH Logo — minimal geometric icon + wordmark
import React from 'react';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  iconOnly?: boolean;
  className?: string;
}

const sizes = {
  sm: { icon: 20, text: 'text-sm', gap: 'gap-1.5' },
  md: { icon: 28, text: 'text-lg', gap: 'gap-2' },
  lg: { icon: 40, text: 'text-2xl', gap: 'gap-3' },
};

export function HomatchLogo({ size = 'md', iconOnly = false, className = '' }: LogoProps) {
  const s = sizes[size];
  return (
    <div className={`flex items-center ${s.gap} ${className}`}>
      {/* Geometric icon: home + signal/connection */}
      <svg
        width={s.icon}
        height={s.icon}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Homatch icon"
      >
        {/* House outline */}
        <path
          d="M4 14L16 4L28 14V27C28 27.5523 27.5523 28 27 28H20V20H12V28H5C4.44772 28 4 27.5523 4 27V14Z"
          stroke="hsl(38 92% 55%)"
          strokeWidth="1.8"
          fill="none"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Signal arc 1 — matching / signal */}
        <path
          d="M19 11.5C20.5 12.5 21.5 14 21.5 16C21.5 18 20.5 19.5 19 20.5"
          stroke="hsl(38 92% 55%)"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.7"
        />
        {/* Signal arc 2 */}
        <path
          d="M22 9C24.5 10.5 26 13 26 16C26 19 24.5 21.5 22 23"
          stroke="hsl(38 92% 55%)"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.4"
        />
        {/* Center dot */}
        <circle cx="16" cy="16" r="1.5" fill="hsl(38 92% 55%)" />
      </svg>

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
