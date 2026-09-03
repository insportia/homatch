import React from 'react';
import { Link } from 'react-router-dom';
import { HomatchLogo } from '@/components/common/HomatchLogo';
import { Shield, Info } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

const LAST_UPDATED = 'August 28, 2026';

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
  const { t, lang } = useLanguage();
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* ── Nav ──────────────────────────────────────────────── */}
      <header className="border-b border-border/50 px-4 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Link to="/">
            <HomatchLogo size="sm" />
          </Link>
          <Link
            to="/terms"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {t('privacy_terms_nav_link')}
          </Link>
        </div>
      </header>

      {/* ── Content ──────────────────────────────────────────── */}
      <main className="flex-1 px-4 py-12">
        <div className="max-w-3xl mx-auto space-y-10">
          {/* Header */}
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg border border-border bg-secondary">
              <Shield className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-semibold text-primary uppercase tracking-wide">{t('privacy_badge')}</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-semibold text-foreground text-balance">
              {t('privacy_title')}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t('privacy_last_updated', { date: LAST_UPDATED })}
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t('privacy_intro_p1')}{' '}
              <a href="https://homatch.live" className="text-primary hover:underline">
                {t('privacy_domain_text')}
              </a>{' '}
              {t('privacy_intro_p2')}
            </p>
            {lang !== 'en' && (
              <div className="flex items-start gap-2 p-3 rounded-xl border border-border bg-secondary/40">
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
          </Section>

          <Section title={t('privacy_s2_title')}>
            <ul className="list-disc list-inside space-y-1.5">
              <li>{t('privacy_s2_li1')}</li>
              <li>{t('privacy_s2_li2')}</li>
              <li>{t('privacy_s2_li3')}</li>
              <li>{t('privacy_s2_li4')}</li>
              <li>{t('privacy_s2_li5')}</li>
              <li>{t('privacy_s2_li6')}</li>
              <li>{t('privacy_s2_li7')}</li>
              <li>{t('privacy_s2_li8')}</li>
            </ul>
            <p className="mt-3">
              <span className="font-medium text-foreground">{t('privacy_s2_google_label')}</span> {t('privacy_s2_google_body')}
            </p>
          </Section>

          <Section title={t('privacy_s3_title')}>
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
              <a href="mailto:privacy@homatch.live" className="text-primary hover:underline">
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
            </ul>
          </Section>

          <Section title={t('privacy_s5_title')}>
            <p>
              {t('privacy_s5_body')}
            </p>
          </Section>

          <Section title={t('privacy_s6_title')}>
            <p>
              {t('privacy_s6_body')}
            </p>
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
              <a href="mailto:privacy@homatch.live" className="text-primary hover:underline">
                {t('privacy_email_text')}
              </a>
              {t('privacy_s7_contact_p2')}
            </p>
          </Section>

          <Section title={t('privacy_s8_title')}>
            <p>
              {t('privacy_s8_p1')}{' '}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
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
            <div className="mt-2 p-4 rounded-xl border border-border bg-card space-y-1">
              <p className="font-medium text-foreground">Homatch</p>
              <p>
                {t('privacy_s11_email_label')}{' '}
                <a href="mailto:privacy@homatch.live" className="text-primary hover:underline">
                  {t('privacy_email_text')}
                </a>
              </p>
              <p>
                {t('privacy_s11_website_label')}{' '}
                <a href="https://homatch.live" className="text-primary hover:underline">
                  {t('privacy_domain_text')}
                </a>
              </p>
            </div>
          </Section>
        </div>
      </main>

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer className="border-t border-border/50 px-4 py-5">
        <div className="max-w-3xl mx-auto flex flex-col md:flex-row items-center justify-between gap-2">
          <Link to="/">
            <HomatchLogo size="sm" />
          </Link>
          <div className="flex items-center gap-4">
            <Link to="/privacy" className="text-xs text-primary">{t('privacy_footer_privacy_link')}</Link>
            <Link to="/terms" className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors">{t('privacy_footer_terms_link')}</Link>
          </div>
          <p className="text-xs text-muted-foreground/50">
            © {new Date().getFullYear()} {t('privacy_footer_tagline')}
          </p>
        </div>
      </footer>
    </div>
  );
}
