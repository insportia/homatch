// CONTACT US — the public site's front door for a message.
//
// A public page in the public identity (the Partners pattern: header,
// light surface, footer), not an authenticated workspace. Everything on it
// is real: the form writes through contact_submit — a validated,
// rate-limited RPC that persists the message and rings every admin's
// notification centre in the same transaction — and nothing here invents an
// email address, a phone number or an office that does not exist. The topics
// are the audiences the product actually has.
//
// The PageBlocks band at the bottom is the CMS: whatever an admin adds in
// Site Studio renders between the form and the footer, so the page's prose
// can grow without a deploy.

import React, { useState } from 'react';
import { CheckCircle2, Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSurfaceTheme } from '@/hooks/useSurfaceTheme';
import { PublicHeader, HeaderSpacer } from '@/components/home/PublicHeader';
import { usePublicNavLinks } from '@/site/publicNav';
import { SiteFooter } from '@/components/home/sections/SiteFooter';
import { PageBlocks } from '@/site/render/PageBlocks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/db/supabase';
import type { TranslationKey } from '@/i18n/translations';
import { cn } from '@/lib/utils';

const TOPICS = [
  { value: 'GENERAL', labelKey: 'contact_topic_general' },
  { value: 'SUPPORT', labelKey: 'contact_topic_support' },
  { value: 'BROKER', labelKey: 'contact_topic_broker' },
  { value: 'B2B', labelKey: 'contact_topic_b2b' },
  { value: 'PARTNERSHIP', labelKey: 'contact_topic_partnership' },
] as const;

export default function ContactPage() {
  useSurfaceTheme('light');
  const { t, lang } = useLanguage();
  const headerLinks = usePublicNavLinks();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [topic, setTopic] = useState<(typeof TOPICS)[number]['value']>('GENERAL');
  const [message, setMessage] = useState('');
  /* The honeypot: a field no person sees or fills. A submission that
     carries it is dropped client-side without a round trip. */
  const [company, setCompany] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (company.trim()) return; // honeypot tripped: silently ignore
    if (name.trim().length < 2) { setError(t('contact_err_name')); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setError(t('contact_err_email')); return; }
    if (message.trim().length < 10) { setError(t('contact_err_message')); return; }

    setSubmitting(true);
    const { error: rpcError } = await supabase.rpc('contact_submit', {
      p_name: name.trim(),
      p_email: email.trim(),
      p_topic: topic,
      p_message: message.trim(),
      p_locale: lang,
    });
    setSubmitting(false);
    if (rpcError) {
      const code = rpcError.message ?? '';
      setError(
        code.includes('RATE_LIMITED') ? t('contact_err_rate')
          : code.includes('INVALID_EMAIL') ? t('contact_err_email')
            : code.includes('INVALID_MESSAGE') ? t('contact_err_message')
              : t('contact_err_generic'),
      );
      return;
    }
    setSent(true);
    toast.success(t('contact_success_title'));
  };

  const label = 'mb-1.5 block text-sm font-semibold text-foreground';

  return (
    <div className="hm-public min-h-screen overflow-x-hidden bg-background text-foreground">
      <PublicHeader links={headerLinks} solid />
      <HeaderSpacer />

      <main>
        {/* Hero, in the public page grammar Partners established. */}
        <section className="relative border-b border-border px-4 py-14 sm:py-16">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-[13px] font-semibold uppercase tracking-[0.22em] text-gold-ink">
              {t('contact_eyebrow')}
            </p>
            <h1 className="mt-3 text-balance text-3xl font-bold tracking-tight text-foreground md:text-4xl">
              {t('contact_title')}
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground">
              {t('contact_lead')}
            </p>
          </div>
        </section>

        {/* The form. One column, reading width: a message, not a wizard. */}
        <section className="px-4 py-12 sm:py-16" aria-labelledby="contact-form-heading">
          <div className="mx-auto max-w-2xl">
            <h2 id="contact-form-heading" className="sr-only">{t('contact_title')}</h2>

            {sent ? (
              <div
                className="rounded-2xl border border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/5 p-8 text-center"
                role="status"
              >
                <CheckCircle2 className="mx-auto h-10 w-10 text-[hsl(var(--success))]" aria-hidden="true" />
                <p className="mt-4 font-display text-xl font-semibold text-foreground">
                  {t('contact_success_title')}
                </p>
                <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                  {t('contact_success_body')}
                </p>
              </div>
            ) : (
              <form onSubmit={submit} noValidate className="rounded-2xl border border-foreground/15 bg-card p-6 shadow-hover sm:p-8">
                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <label htmlFor="contact-name" className={label}>{t('contact_field_name')}</label>
                    <Input
                      id="contact-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={120}
                      autoComplete="name"
                      className="h-12 bg-card"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="contact-email" className={label}>{t('contact_field_email')}</label>
                    <Input
                      id="contact-email"
                      type="email"
                      dir="ltr"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      maxLength={200}
                      autoComplete="email"
                      className="h-12 bg-card"
                      required
                    />
                  </div>
                </div>

                <fieldset className="mt-5">
                  <legend className={label}>{t('contact_field_topic')}</legend>
                  <div className="flex flex-wrap gap-2">
                    {TOPICS.map(({ value, labelKey }) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={topic === value}
                        onClick={() => setTopic(value)}
                        className={cn(
                          'min-h-10 rounded-full border px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          topic === value
                            ? 'border-foreground bg-primary text-primary-foreground'
                            : 'border-foreground/20 bg-card text-muted-foreground hover:border-foreground/45 hover:text-foreground',
                        )}
                      >
                        {t(labelKey as TranslationKey)}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <div className="mt-5">
                  <label htmlFor="contact-message" className={label}>{t('contact_field_message')}</label>
                  <textarea
                    id="contact-message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    maxLength={4000}
                    rows={6}
                    required
                    className="w-full rounded-lg border border-input bg-card px-3.5 py-3 text-base leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <p className="mt-1.5 text-xs text-muted-foreground">{t('contact_field_message_hint')}</p>
                </div>

                {/* Honeypot: visually and semantically removed from humans. */}
                <div aria-hidden="true" className="fixed -left-[9999px] top-auto h-px w-px overflow-hidden">
                  <input
                    type="text"
                    name="company"
                    tabIndex={-1}
                    autoComplete="off"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                  />
                </div>

                {error && (
                  <p className="mt-4 text-sm font-medium text-destructive" role="alert">{error}</p>
                )}

                <Button
                  type="submit"
                  disabled={submitting}
                  className="mt-6 h-12 w-full gap-2 bg-primary text-base font-semibold text-primary-foreground hover:bg-gold-ink sm:w-auto sm:px-8"
                >
                  {submitting
                    ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    : <Send className="h-4 w-4" aria-hidden="true" />}
                  {submitting ? t('contact_submitting') : t('contact_submit')}
                </Button>

                <p className="mt-4 max-w-xl text-xs leading-relaxed text-muted-foreground">
                  {t('contact_privacy_note')}
                </p>
              </form>
            )}
          </div>
        </section>

        {/* The CMS band: whatever an admin adds in Site Studio renders here. */}
        <PageBlocks slug="contact" />
      </main>

      <SiteFooter />
    </div>
  );
}
