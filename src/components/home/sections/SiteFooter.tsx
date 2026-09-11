import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { HomatchLogo } from '@/components/common/HomatchLogo';
import { PAGE } from './primitives';

/** REGION 12 — the footer. Quiet, hairline top, no card anywhere in it. */
export function SiteFooter() {
  const { session } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const columns = [
    {
      key: 'product',
      heading: t('mp_footer_product'),
      links: [
        { key: 'verify', label: t('nav_verify'), path: '/verify' },
        { key: 'contract', label: t('mp_contract_title'), path: session ? '/verify' : '/auth/signup' },
        { key: 'mortgage', label: t('nav_mortgage'), path: '/mortgage' },
        { key: 'ai', label: t('ai_title'), path: session ? '/ai' : '/auth/signup' },
        { key: 'calls', label: t('call_center_title'), path: session ? '/outreach/calls' : '/auth/signup' },
        { key: 'email', label: t('mp_email_title'), path: session ? '/outreach/email' : '/auth/signup' },
      ],
    },
    {
      key: 'company',
      heading: t('mp_footer_company'),
      links: [
        { key: 'about', label: t('nav_about'), path: '/about' },
        { key: 'partners', label: t('home_nav_partners'), path: '/partners' },
      ],
    },
    {
      key: 'legal',
      heading: t('mp_footer_legal'),
      links: [
        { key: 'privacy', label: t('home_footer_privacy'), path: '/privacy' },
        { key: 'terms', label: t('home_footer_terms'), path: '/terms' },
      ],
    },
  ];

  return (
    <footer className="border-t border-border">
      <div className={`${PAGE} grid gap-12 py-16 sm:grid-cols-2 lg:grid-cols-4`}>
        <div className="sm:col-span-2 lg:col-span-1">
          <HomatchLogo size="md" withTagline />
          <p className="mt-5 max-w-xs text-pretty text-xs leading-relaxed text-muted-foreground">
            {t('mp_footer_tagline')}
          </p>
        </div>

        {columns.map(column => (
          <nav key={column.key} aria-label={column.heading}>
            <p className="text-[14px] font-semibold uppercase tracking-[0.22em] text-foreground">{column.heading}</p>
            <ul className="mt-5 space-y-3">
              {column.links.map(link => (
                <li key={link.key}>
                  <button
                    type="button"
                    onClick={() => navigate(link.path)}
                    className="min-h-0 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {link.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="border-t border-border">
        <p className={`${PAGE} py-6 text-xs text-muted-foreground`}>
          {t('home_footer_copyright', { year: new Date().getFullYear() })}
        </p>
      </div>
    </footer>
  );
}
