import React from 'react';
import { Link } from 'react-router-dom';
import { useSurfaceTheme } from '@/hooks/useSurfaceTheme';
import { PublicHeader, HeaderSpacer } from '@/components/home/PublicHeader';
import { usePublicNavLinks } from '@/site/publicNav';
import { SiteFooter } from '@/components/home/sections/SiteFooter';
import { PageBlocks } from '@/site/render/PageBlocks';
import { PAGE } from '@/components/home/sections/primitives';
import { Shield, Info } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

const LAST_UPDATED = 'October 25, 2026';

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

function Section({ title, children }: SectionProps) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <div className="text-sm text-muted-foreground leading-relaxed space-y-2">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  useSurfaceTheme('light');
  const { t, lang } = useLanguage();

  const headerLinks = usePublicNavLinks();

  return (
    <div className="hm-public min-h-screen bg-background text-foreground flex flex-col">
      <PublicHeader links={headerLinks} solid />
      <HeaderSpacer />

      {/* ── Content ──────────────────────────────────────────── */}
      <main className={`flex-1 ${PAGE} py-14 sm:py-20`}>
        <div className="max-w-[48rem] space-y-10">
          {/* Header */}
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border border-foreground/20 bg-secondary">
              <Shield className="h-3.5 w-3.5 text-gold-ink" />
              <span className="text-[14px] font-semibold uppercase tracking-[0.16em] text-gold-ink">{t('privacy_badge')}</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-semibold text-foreground text-balance">
              {t('privacy_title')}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t('privacy_last_updated', { date: LAST_UPDATED })}
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t('privacy_intro_p1')}{' '}
              <a href="https://homatch.live" className="font-medium text-gold-ink hover:text-foreground">
                {t('privacy_domain_text')}
              </a>{' '}
              {t('privacy_intro_p2')}
            </p>
            {lang !== 'en' && (
              <div className="flex items-start gap-2 p-3 rounded-[0.9rem] border border-border bg-secondary/60">
                <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground leading-relaxed">{t('legal_translation_notice')}</p>
              </div>
            )}
          </div>

          <div className="w-full h-px bg-border/50" />

          <Section title={t('privacy_s1_title')}>
            <p>{t('privacy_s1_intro')}</p>
            <p className="font-medium text-foreground mt-3">{t('privacy_s1a_title')}</p>
            <p>
              {t('privacy_s1a_body')}
            </p>
            <p className="font-medium text-foreground mt-3">{t('privacy_s1b_title')}</p>
            <p>
              {t('privacy_s1b_body')}
            </p>
            <p className="font-medium text-foreground mt-3">{t('privacy_s1c_title')}</p>
            <p>
              {t('privacy_s1c_body')}
            </p>
            <p className="font-medium text-foreground mt-3">{t('privacy_s1d_title')}</p>
            <p>
              {t('privacy_s1d_body')}
            </p>
            <p className="font-medium text-foreground mt-3">{t('privacy_s1e_title')}</p>
            <p>{t('privacy_s1e_body')}</p>
            <p className="font-medium text-foreground mt-3">{t('privacy_s1f_title')}</p>
            <p>{t('privacy_s1f_body')}</p>
          </Section>

          <Section title={t('privacy_s2_title')}>
            <p>{t('privacy_s2_intro_p1')}</p>
            <p>{t('privacy_s2_intro_p2')}</p>
            <ul className="list-disc list-inside space-y-1.5">
              <li>{t('privacy_s2_li1')}</li>
              <li>{t('privacy_s2_li2')}</li>
              <li>{t('privacy_s2_li3')}</li>
              <li>{t('privacy_s2_li4')}</li>
              <li>{t('privacy_s2_li5')}</li>
              <li>{t('privacy_s2_li6')}</li>
              <li>{t('privacy_s2_li7')}</li>
              <li>{t('privacy_s2_li8')}</li>
              <li>{t('privacy_s2_li9')}</li>
            </ul>
            <p className="mt-3">
              <span className="font-medium text-foreground">{t('privacy_s2_google_label')}</span> {t('privacy_s2_google_body')}
            </p>
            <p className="font-medium text-foreground mt-3">{t('privacy_lb_title')}</p>
            <ul className="list-disc list-inside space-y-1.5">
              <li>{t('privacy_lb_contract')}</li>
              <li>{t('privacy_lb_legal')}</li>
              <li>{t('privacy_lb_legit')}</li>
              <li>{t('privacy_lb_consent')}</li>
            </ul>
          </Section>

          <Section title={t('privacy_s3_title')}>
            <p>{t('privacy_s3_body_measures')}</p>
            <p>
              {t('privacy_s3_intro')}
            </p>
            <ul className="list-disc list-inside space-y-1.5 mt-2">
              <li>{t('privacy_s3_li1')}</li>
              <li>{t('privacy_s3_li2')}</li>
              <li>{t('privacy_s3_li3')}</li>
              <li>{t('privacy_s3_li4')}</li>
              <li>{t('privacy_s3_li5')}</li>
            </ul>
            <p className="mt-3">
              {t('privacy_s3_notice_p1')}{' '}
              <a href="mailto:privacy@homatch.live" className="font-medium text-gold-ink hover:text-foreground">
                {t('privacy_email_text')}
              </a>{' '}
              {t('privacy_s3_notice_p2')}
            </p>
          </Section>

          <Section title={t('privacy_s4_title')}>
            <p>{t('privacy_s4_intro')}</p>
            <ul className="list-disc list-inside space-y-1.5 mt-2">
              <li>
                <span className="font-medium text-foreground">{t('privacy_s4_li1_label')}</span> {t('privacy_s4_li1_body')}
              </li>
              <li>
                <span className="font-medium text-foreground">{t('privacy_s4_li2_label')}</span> {t('privacy_s4_li2_body')}
              </li>
              <li>
                <span className="font-medium text-foreground">{t('privacy_s4_li3_label')}</span> {t('privacy_s4_li3_body')}
              </li>
              <li>
                <span className="font-medium text-foreground">{t('privacy_s4_li4_label')}</span> {t('privacy_s4_li4_body')}
              </li>
              {/* Linked from the Home Financing opt-in (/privacy#matching). */}
              <li id="matching" className="scroll-mt-24">
                <span className="font-medium text-foreground">{t('privacy_s4_li5_label')}</span> {t('privacy_s4_li5_body')}
              </li>
            </ul>
            <p className="mt-3">{t('privacy_s4_vendors_p')}</p>
            <p className="font-medium text-foreground mt-3">{t('privacy_match_title')}</p>
            <p>{t('privacy_match_p1')}</p>
            <p>{t('privacy_match_p2')}</p>
            <p>{t('privacy_match_p3')}</p>
          </Section>

          <Section title={t('privacy_transfer_title')}>
            <p>{t('privacy_transfer_body')}</p>
          </Section>

          <Section title={t('privacy_profiling_title')}>
            <p>{t('privacy_profiling_body')}</p>
          </Section>

          <Section title={t('privacy_s5_title')}>
            <p>
              {t('privacy_s5_body')}{' '}
              <Link to="/cookies" className="font-medium text-gold-ink hover:text-foreground">
                {t('home_footer_cookies')}
              </Link>
              .
            </p>
          </Section>

          <Section title={t('privacy_s6_title')}>
            <p>
              {t('privacy_s6_body')}
            </p>
            <p>{t('privacy_s6_body2')}</p>
          </Section>

          <Section title={t('privacy_s7_title')}>
            <p>{t('privacy_s7_intro')}</p>
            <ul className="list-disc list-inside space-y-1.5 mt-2">
              <li><span className="font-medium text-foreground">{t('privacy_s7_li1_label')}</span> {t('privacy_s7_li1_body')}</li>
              <li><span className="font-medium text-foreground">{t('privacy_s7_li2_label')}</span> {t('privacy_s7_li2_body')}</li>
              <li><span className="font-medium text-foreground">{t('privacy_s7_li3_label')}</span> {t('privacy_s7_li3_body')}</li>
              <li><span className="font-medium text-foreground">{t('privacy_s7_li4_label')}</span> {t('privacy_s7_li4_body')}</li>
              <li><span className="font-medium text-foreground">{t('privacy_s7_li5_label')}</span> {t('privacy_s7_li5_body')}</li>
            </ul>
            <p className="mt-3">
              {t('privacy_s7_contact_p1')}{' '}
              <a href="mailto:privacy@homatch.live" className="font-medium text-gold-ink hover:text-foreground">
                {t('privacy_email_text')}
              </a>
              {t('privacy_s7_contact_p2')}
            </p>
            <p>{t('privacy_s7_complaint')}</p>
          </Section>

          <Section title={t('privacy_s8_title')}>
            <p>
              {t('privacy_s8_p1')}{' '}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-gold-ink hover:text-foreground"
              >
                {t('privacy_s8_link_text')}
              </a>
              {t('privacy_s8_p2')}
            </p>
          </Section>

          <Section title={t('privacy_s9_title')}>
            <p>
              {t('privacy_s9_body')}
            </p>
          </Section>

          <Section title={t('privacy_s10_title')}>
            <p>
              {t('privacy_s10_body')}
            </p>
          </Section>

          <Section title={t('privacy_s11_title')}>
            <p>
              {t('privacy_s11_intro')}
            </p>
            <div className="mt-2 p-4 rounded-[0.9rem] border border-border bg-card space-y-1">
              <p className="font-medium text-foreground">Homatch</p>
              <p>
                {t('privacy_s11_email_label')}{' '}
                <a href="mailto:privacy@homatch.live" className="font-medium text-gold-ink hover:text-foreground">
                  {t('privacy_email_text')}
                </a>
              </p>
              <p>
                {t('privacy_s11_website_label')}{' '}
                <a href="https://homatch.live" className="font-medium text-gold-ink hover:text-foreground">
                  {t('privacy_domain_text')}
                </a>
              </p>
            </div>
          </Section>
        </div>
      </main>

      {/* Blocks added in Site Studio. Renders nothing until
          somebody adds one. */}
      <PageBlocks slug="privacy" />

      <SiteFooter />
    </div>
  );
}
