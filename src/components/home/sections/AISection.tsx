import React from 'react';
import {
  Building2, Calculator, FileText, Mail, PhoneCall, Search, ShieldCheck, UserSearch,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { HomatchAsk } from '@/components/home/HomatchAsk';
import { IntentCards } from '@/components/home/IntentCards';
import { FeatureGlyph } from '@/components/home/FeatureGlyph';
import { PAGE, SECTION_Y } from './primitives';
import { useSectionField } from '@/site/content';

/**
 * REGION 09 — Homatch AI.
 *
 * The hero carries a field and three questions, so the assistant is reachable
 * from the first screen. THIS is where it is explained, and where the full
 * set of starter questions lives.
 *
 * WHY THE QUESTIONS ARE THE SECTION
 *
 * The previous pass put a console here with four chips named after features,
 * and a capability list beside it. The list is still the honest part: it is
 * what separates an assistant from a chat widget. But the chips asked a
 * visitor to pick a feature, and nobody arrives thinking in features. They
 * arrive thinking "is this price normal" and "what do I check before I
 * sign". Eight of those are now the centre of the region, and each is one
 * click into the real conversation.
 */
export function AISection() {
  const sf = useSectionField();
  const { t } = useLanguage();

  const reach = [
    { key: 'match', icon: UserSearch, label: t('mp_match_title') },
    { key: 'find', icon: Search, label: t('mp_find_title') },
    { key: 'verify', icon: ShieldCheck, label: t('mp_verify_capability_title') },
    { key: 'contract', icon: FileText, label: t('mp_contract_title') },
    { key: 'mortgage', icon: Calculator, label: t('mp_mortgage_title') },
    { key: 'calls', icon: PhoneCall, label: t('call_center_title') },
    { key: 'email', icon: Mail, label: t('mp_email_title') },
    { key: 'dev', icon: Building2, label: t('mp_dev_eyebrow') },
  ];

  return (
    <section id="how" className={`${PAGE} scroll-mt-20 border-t border-border ${SECTION_Y}`}>
      <div className="flex items-center gap-3.5">
        <FeatureGlyph name="ai" size={48} className="sm:h-14 sm:w-14" />
        <p className="min-w-0 text-[13px] font-semibold uppercase tracking-[0.22em] text-gold-ink">
          {sf('eyebrow', 'mp_flow_eyebrow')}
        </p>
      </div>

      <div className="mt-6 grid gap-5 sm:mt-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:items-end lg:gap-16">
        <h2
          className="max-w-[34rem] text-balance font-semibold leading-[1.1] tracking-[-0.025em] text-foreground"
          style={{ fontSize: 'clamp(1.4rem, 5.6vw, 2.75rem)' }}
        >
          {sf('title', 'mp_flow_title')}
        </h2>
        <p className="text-pretty text-[16px] leading-[1.65] text-ink-soft sm:text-base sm:leading-[1.7]">
          {sf('body', 'mp_flow_sub')}
        </p>
      </div>

      <div className="mt-8 grid gap-8 sm:mt-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,21rem)] lg:gap-12">
        <div className="min-w-0">
          <HomatchAsk variant="console" placeholder={t('mp_hero_ai_placeholder')} actions={[]} />

          <p className="mt-7 text-[13px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {t('mp_intent_label')}
          </p>
          <IntentCards className="mt-4" />
        </div>

        {/* What a question reaches. Not decoration: this is the list that
            separates an assistant from a chat window. */}
        <div className="min-w-0 self-start rounded-[1.1rem] border border-foreground/15 bg-secondary/60 p-5 sm:p-6">
          <p className="text-[13px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {t('mp_ai_reach_label')}
          </p>
          <ul className="mt-5 grid gap-2.5">
            {reach.map(item => (
              <li key={item.key} className="flex items-start gap-3">
                <span
                  className="mt-px grid h-7 w-7 shrink-0 place-items-center rounded-[0.45rem] border border-foreground/15 bg-card text-foreground"
                  aria-hidden="true"
                >
                  <item.icon className="h-[15px] w-[15px]" strokeWidth={1.9} />
                </span>
                <span className="min-w-0 pt-1 text-[15px] leading-snug text-foreground">{item.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
