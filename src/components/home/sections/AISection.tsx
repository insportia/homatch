import React from 'react';
import {
  Building2, Calculator, FileText, Mail, PhoneCall, Search, ShieldCheck, UserSearch,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { HomatchAsk, type AskAction } from '@/components/home/HomatchAsk';
import { FeatureGlyph } from '@/components/home/FeatureGlyph';
import { PAGE } from './primitives';

/**
 * REGION 07 — Homatch AI.
 *
 * The hero carries a single-line assistant field so the product is reachable
 * from the first screen. THIS is where the assistant is explained, and it is
 * the one place on the page with the full console: the field, the prepared
 * questions, and the list of what a question can actually reach.
 *
 * The reach list is the substance of the section. Every chip is a capability
 * that exists in the product today with a route behind it — which is the
 * difference between an assistant and a chat widget.
 */
export function AISection() {
  const { t } = useLanguage();

  const actions: AskAction[] = [
    { key: 'client', icon: UserSearch, label: t('mp_hero_action_client'), prompt: t('mp_hero_action_client_prompt') },
    { key: 'property', icon: Building2, label: t('mp_hero_action_property'), prompt: t('mp_hero_action_property_prompt') },
    { key: 'verify', icon: ShieldCheck, label: t('mp_hero_action_verify'), prompt: t('mp_hero_action_verify_prompt') },
    { key: 'mortgage', icon: Calculator, label: t('mp_hero_action_mortgage'), prompt: t('mp_hero_action_mortgage_prompt') },
  ];

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
    <section id="how" className={`${PAGE} scroll-mt-24 py-20 sm:py-24 lg:py-28`}>
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-16">
        <div className="min-w-0">
          <div className="flex items-center gap-4">
            <FeatureGlyph name="ai" size={56} />
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-gold-ink">{t('mp_flow_eyebrow')}</p>
          </div>

          <h2
            className="mt-7 text-balance font-semibold leading-[1.08] tracking-[-0.025em] text-foreground"
            style={{ fontSize: 'clamp(1.75rem, 3.2vw, 2.75rem)' }}
          >
            {t('mp_flow_title')}
          </h2>
          <p className="mt-5 max-w-[36rem] text-pretty text-[15px] leading-[1.7] text-ink-soft sm:text-base">
            {t('mp_flow_sub')}
          </p>

          <HomatchAsk
            className="mt-9 max-w-[40rem]"
            variant="console"
            placeholder={t('mp_hero_ai_placeholder')}
            actions={actions}
          />
        </div>

        {/* What a question reaches. Not decoration — this is the list that
            separates an assistant from a chat window. */}
        <div className="min-w-0 self-start rounded-[1.1rem] border border-foreground/15 bg-secondary/60 p-6 sm:p-7">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {t('mp_ai_reach_label')}
          </p>
          <ul className="mt-5 grid gap-2.5">
            {reach.map(item => (
              <li key={item.key} className="flex items-start gap-3">
                <span className="mt-px grid h-7 w-7 shrink-0 place-items-center rounded-[0.45rem] border border-foreground/15 bg-card text-foreground" aria-hidden="true">
                  <item.icon className="h-[15px] w-[15px]" strokeWidth={1.9} />
                </span>
                <span className="min-w-0 pt-1 text-[13.5px] leading-snug text-foreground">{item.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
