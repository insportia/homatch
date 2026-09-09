import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Building2, HardHat, LineChart, Mail, PhoneCall } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { Icon, PAGE, SECTION_Y, SectionIntro } from './primitives';

/**
 * REGION 07 — the professional surface.
 *
 * The five capabilities that matter to brokers, developers and agencies, at
 * their true weight: hairline rows, not cards, and deliberately below
 * matching and verification. Nine equal cards was the thing to avoid; this
 * is where the tail of the capability list goes so the head of it can stay
 * dominant.
 *
 * Market intelligence links to Verify rather than to a page of its own,
 * because that is where it actually lives today — comparables and public
 * evidence are gathered as part of a property check, not as a separate
 * product. Naming it here without inventing a route for it is the honest
 * way to represent it.
 */
export function ProfessionalToolsSection() {
  const { session } = useAuth();
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();

  const gated = (path: string) => () => navigate(session ? path : '/auth/signup');

  const rows = [
    { key: 'calls', icon: PhoneCall, title: t('call_center_title'), desc: t('mp_sec_calls_desc'), go: gated('/outreach/calls') },
    { key: 'email', icon: Mail, title: t('mp_sec_email_title'), desc: t('mp_sec_email_desc'), go: gated('/outreach/email') },
    { key: 'broker', icon: Building2, title: t('mp_sec_broker_title'), desc: t('mp_sec_broker_desc'), go: () => navigate('/partners') },
    { key: 'developer', icon: HardHat, title: t('mp_sec_developer_title'), desc: t('mp_sec_developer_desc'), go: () => navigate('/partners') },
    { key: 'market', icon: LineChart, title: t('mp_sec_market_title'), desc: t('mp_sec_market_desc'), go: () => navigate('/verify') },
  ];

  return (
    <section className={`${PAGE} ${SECTION_Y}`}>
      <div className="grid gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,0.65fr)_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <SectionIntro eyebrow={t('mp_pro_eyebrow')} title={t('mp_pro_title')} body={t('mp_pro_sub')} />
        </div>

        <ul className="border-t border-border">
          {rows.map(row => (
            <li key={row.key} className="border-b border-border">
              <button
                type="button"
                onClick={row.go}
                className="group flex w-full items-center gap-5 py-7 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Icon icon={row.icon} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block text-balance text-[17px] font-semibold leading-snug text-foreground transition-colors group-hover:text-gold-ink">
                    {row.title}
                  </span>
                  <span className="mt-1.5 block max-w-[36rem] text-pretty text-sm leading-relaxed text-ink-soft">{row.desc}</span>
                </span>
                <ArrowRight
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transform-none ${isRTL ? 'rotate-180 group-hover:-translate-x-1' : ''}`}
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
