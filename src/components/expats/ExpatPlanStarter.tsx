// HOMATCH FOR EXPATS — the page's front door: My Georgia by HOMI.
//
// Owner direction (2026-10-24): the page leads with something you do. The
// approved welcome opens the five-step My Georgia onboarding (no account
// needed to start; answers wait on the device until sign up), and the ask
// box under it carries a question straight to HOMI, through sign-in if needed.

import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { HomiAvatar } from '@/components/homi/HomiAvatar';
import { HomatchAsk } from '@/components/home/HomatchAsk';

export function ExpatPlanStarter() {
  const { t } = useLanguage();
  const { homatchUser } = useAuth();

  return (
    <section aria-labelledby="mg-start-title" className="space-y-6" data-expat-plan-starter>
      <div className="rounded-3xl bg-[#0C1119] p-6 text-white sm:p-10">
        <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-[hsl(var(--gold))]">
          <HomiAvatar state="greeting" size={40} animate={false} /> {t('mg_product')}
        </p>
        <h2 id="mg-start-title" className="max-w-[24ch] font-display text-2xl font-semibold leading-tight sm:text-3xl">
          {t('mg_welcome_title')}
        </h2>
        <p className="mt-3 max-w-[56ch] text-base leading-relaxed text-white/75">{t('mg_welcome_body')}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to="/my-georgia/start" data-mg-start
            className="inline-flex min-h-12 items-center gap-2 rounded-full bg-[hsl(var(--gold))] px-7 text-sm font-semibold text-[#0C1119]">
            {t('mg_start')} <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
          </Link>
          {homatchUser ? (
            <Link to="/my-georgia" className="inline-flex min-h-12 items-center rounded-full border border-white/20 px-6 text-sm font-medium text-white/85">
              {t('mg_dash_title')}
            </Link>
          ) : null}
        </div>
      </div>

      <HomatchAsk
        variant="card"
        tone="light"
        heading={t('expat_ask_title')}
        placeholder={t('expat_ask_placeholder')}
        actions={[
          { key: 'stay', label: t('expat_ask_stay') },
          { key: 'bank', label: t('expat_ask_bank') },
          { key: 'buy', label: t('expat_ask_buy') },
        ]}
      />
    </section>
  );
}

export default ExpatPlanStarter;
