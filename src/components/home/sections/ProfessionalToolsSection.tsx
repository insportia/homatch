import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { Eyebrow, PAGE, SECTION_Y } from './primitives';

/**
 * REGION 09 — the professional surface.
 *
 * Four workflows that matter to brokers, developers and agencies, and that
 * must NOT compete with the two doors at the top of the page. Hairline rows
 * rather than cards: they are a directory, and a directory that shouts is a
 * badly designed directory.
 */
export function ProfessionalToolsSection() {
  const { session } = useAuth();
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();

  const gated = (path: string) => () => navigate(session ? path : '/auth/signup');

  const rows = [
    { key: 'mortgage', title: t('mp_cap_mortgage_title'), desc: t('mp_cap_short_mortgage'), go: () => navigate('/mortgage') },
    { key: 'calls', title: t('call_center_title'), desc: t('mp_sec_calls_desc'), go: gated('/outreach/calls') },
    { key: 'email', title: t('mp_sec_email_title'), desc: t('mp_sec_email_desc'), go: gated('/outreach/email') },
    { key: 'partners', title: t('mp_sec_partners_title'), desc: t('mp_sec_partners_desc'), go: () => navigate('/partners') },
  ];

  return (
    <section className={`${PAGE} ${SECTION_Y}`}>
      <div className="grid gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <Eyebrow>{t('mp_pro_eyebrow')}</Eyebrow>
          <h2
            className="mt-4 text-balance font-semibold leading-[1.14] tracking-tight text-foreground"
            style={{ fontSize: 'clamp(1.6rem, 2.7vw, 2.5rem)' }}
          >
            {t('mp_pro_title')}
          </h2>
        </div>

        <ul className="border-t border-border">
          {rows.map(row => (
            <li key={row.key} className="border-b border-border">
              <button
                type="button"
                onClick={row.go}
                className="group flex w-full items-center gap-6 py-7 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-balance text-lg font-semibold leading-snug text-foreground transition-colors group-hover:text-gold sm:text-xl">
                    {row.title}
                  </span>
                  <span className="mt-2 block max-w-[36rem] text-pretty text-sm leading-relaxed text-ink-soft">{row.desc}</span>
                </span>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border text-muted-foreground transition-colors group-hover:border-gold/60 group-hover:text-gold">
                  <ArrowRight className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} aria-hidden="true" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
