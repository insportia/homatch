import { Link } from 'react-router-dom';
import { Cookie, FileText, Scale, Shield } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLanguage } from '@/contexts/LanguageContext';
import { openCookieSettings } from '@/lib/consent/cookieConsent';
import { LEGAL_OPERATOR } from '@/lib/legal/operator';

/** Profile → Security: the accepted documents, cookie choices and data requests. */
export function LegalPrivacyCard() {
  const { t } = useLanguage();
  const link = 'inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  return (
    <Card className="rounded-[0.9rem] border-foreground/15 bg-card shadow-card" data-legal-privacy-card="">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2"><Scale className="h-4 w-4 text-gold-ink" /> {t('legal_account_title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs leading-relaxed text-muted-foreground">{t('legal_account_body', { email: LEGAL_OPERATOR.privacyContact ?? '' })}</p>
        <div className="flex flex-wrap gap-2">
          <Link to="/terms" className={link}><FileText className="h-3.5 w-3.5" /> {t('home_footer_terms')}</Link>
          <Link to="/privacy" className={link}><Shield className="h-3.5 w-3.5" /> {t('home_footer_privacy')}</Link>
          <Link to="/cookies" className={link}><Cookie className="h-3.5 w-3.5" /> {t('home_footer_cookies')}</Link>
          <button type="button" onClick={openCookieSettings} className={link}>{t('home_footer_cookie_settings')}</button>
        </div>
      </CardContent>
    </Card>
  );
}
