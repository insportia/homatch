import React from 'react';
import { Link } from 'react-router-dom';
import { HomatchLogo } from '@/components/common/HomatchLogo';
import { FileText, Info } from 'lucide-react';
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

export default function TermsPage() {
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
            to="/privacy"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {t('terms_nav_privacy_link')}
          </Link>
        </div>
      </header>

      {/* ── Content ──────────────────────────────────────────── */}
      <main className="flex-1 px-4 py-12">
        <div className="max-w-3xl mx-auto space-y-10">
          {/* Header */}
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg border border-border bg-secondary">
              <FileText className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-semibold text-primary uppercase tracking-wide">{t('terms_badge')}</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-semibold text-foreground text-balance">
              {t('terms_title')}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t('terms_last_updated')} {LAST_UPDATED}
            </p>
            {lang !== 'en' && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-muted/50 border border-border">
                <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground">
                  {t('legal_translation_notice')}
                </p>
              </div>
            )}
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t('terms_intro')}{' '}
              <a href="https://homatch.live" className="text-primary hover:underline">
                homatch.live
              </a>{' '}
              {t('terms_intro_cont')}
            </p>
          </div>

          <div className="w-full h-px bg-border/50" />

          <Section title={t('terms_s1_title')}>
            <p>
              {t('terms_s1_body_pre')}{' '}
              <Link to="/privacy" className="text-primary hover:underline">
                {t('terms_privacy_policy_link')}
              </Link>
              {t('terms_s1_body_post')}
            </p>
          </Section>

          <Section title={t('terms_s2_title')}>
            <p>
              {t('terms_s2_body1')}
            </p>
            <p>
              {t('terms_s2_body2')}
            </p>
          </Section>

          <Section title={t('terms_s3_title')}>
            <p>
              {t('terms_s3_body1_pre')}{' '}
              <a href="mailto:support@homatch.live" className="text-primary hover:underline">
                support@homatch.live
              </a>{' '}
              {t('terms_s3_body1_post')}
            </p>
            <p>
              {t('terms_s3_body2')}
            </p>
          </Section>

          <Section title={t('terms_s4_title')}>
            <p>
              {t('terms_s4_body1')}
            </p>
            <p>
              {t('terms_s4_body2')}
            </p>
          </Section>

          <Section title={t('terms_s5_title')}>
            <p>{t('terms_s5_intro')}</p>
            <ul className="list-disc list-inside space-y-1.5 mt-2">
              <li>{t('terms_s5_item1')}</li>
              <li>{t('terms_s5_item2')}</li>
              <li>{t('terms_s5_item3')}</li>
              <li>{t('terms_s5_item4')}</li>
              <li>{t('terms_s5_item5')}</li>
              <li>{t('terms_s5_item6')}</li>
              <li>{t('terms_s5_item7')}</li>
            </ul>
            <p className="mt-3">
              {t('terms_s5_outro')}
            </p>
          </Section>

          <Section title={t('terms_s6_title')}>
            <p>
              {t('terms_s6_body1')}
            </p>
            <p>
              {t('terms_s6_body2')}
            </p>
          </Section>

          <Section title={t('terms_s7_title')}>
            <p>
              {t('terms_s7_body_pre')}{' '}
              <Link to="/privacy" className="text-primary hover:underline">
                {t('terms_privacy_policy_link')}
              </Link>
              {t('terms_s7_body_post')}
            </p>
          </Section>

          <Section title={t('terms_s8_title')}>
            <p>
              {t('terms_s8_body')}
            </p>
          </Section>

          <Section title={t('terms_s9_title')}>
            <p>
              {t('terms_s9_body1')}
            </p>
            <p>
              {t('terms_s9_body2')}
            </p>
          </Section>

          <Section title={t('terms_s10_title')}>
            <p>
              {t('terms_s10_body1')}
            </p>
            <p>
              {t('terms_s10_body2')}
            </p>
          </Section>

          <Section title={t('terms_s11_title')}>
            <p>
              {t('terms_s11_body')}
            </p>
          </Section>

          <Section title={t('terms_s12_title')}>
            <p>
              {t('terms_s12_body_pre')}{' '}
              <a href="mailto:support@homatch.live" className="text-primary hover:underline">
                support@homatch.live
              </a>
              {t('terms_s12_body_post')}
            </p>
          </Section>

          <Section title={t('terms_s13_title')}>
            <p>
              {t('terms_s13_body')}
            </p>
          </Section>

          <Section title={t('terms_s14_title')}>
            <p>
              {t('terms_s14_body')}
            </p>
          </Section>

          <Section title={t('terms_s15_title')}>
            <p>
              {t('terms_s15_intro')}
            </p>
            <div className="mt-2 p-4 rounded-xl border border-border bg-card space-y-1">
              <p className="font-medium text-foreground">Homatch</p>
              <p>
                {t('terms_contact_email_label')}{' '}
                <a href="mailto:legal@homatch.live" className="text-primary hover:underline">
                  legal@homatch.live
                </a>
              </p>
              <p>
                {t('terms_contact_website_label')}{' '}
                <a href="https://homatch.live" className="text-primary hover:underline">
                  homatch.live
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
            <Link to="/privacy" className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors">{t('terms_footer_privacy')}</Link>
            <Link to="/terms" className="text-xs text-primary">{t('terms_footer_terms')}</Link>
          </div>
          <p className="text-xs text-muted-foreground/50">
            © {new Date().getFullYear()} {t('terms_footer_copyright')}
          </p>
        </div>
      </footer>
    </div>
  );
}
