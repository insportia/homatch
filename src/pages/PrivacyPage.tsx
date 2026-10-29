import { Link } from 'react-router-dom';
import { LegalContactCard, LegalLayout, LegalList, type LegalSection, LegalSub, useOperatorVars } from '@/components/legal/LegalLayout';
import { useLanguage } from '@/contexts/LanguageContext';
import { editionKey } from '@/lib/legal/operator';
import { useLegalEdition } from '@/lib/legal/useLegalEdition';
import { PageBlocks } from '@/site/render/PageBlocks';

/*
 * Privacy Policy. Controller first (who is responsible), then what, from
 * where, why and on which basis, who receives it, how long, rights. The
 * controller identity comes from src/lib/legal/operator.ts.
 *
 * #matching is linked from the Home Financing opt-in; keep that id.
 */
export default function PrivacyPage() {
  const { t } = useLanguage();
  const v = useOperatorVars('privacy');
  /* 2026-10-30 removed Stripe; earlier editions render their original wording. */
  const edition = useLegalEdition('privacy');
  const k = (key: string) => editionKey(key, edition) as 'privacy_s1d_body';
  const mail = <a href={`mailto:${v.email}`} dir="ltr">{v.email}</a>;

  const sections: LegalSection[] = [
    {
      id: 'controller', title: t('privacy_controller_title'), content: <>
        <p>{t('privacy_controller_p1', { operator: v.operator, id: v.id })}</p>
        <p>{t('privacy_controller_p2')}</p>
        <p>
          {t('privacy_law_lead')}{' '}
          <a href="https://matsne.gov.ge/en/document/view/5827307" target="_blank" rel="noopener noreferrer">{t('privacy_law_link_text')}</a>
        </p>
      </>,
    },
    {
      id: 'data', title: t('privacy_s1_title'), content: <>
        <p>{t('privacy_s1_intro')}</p>
        <LegalSub>{t('privacy_s1a_title')}</LegalSub><p>{t('privacy_s1a_body')}</p>
        <LegalSub>{t('privacy_s1b_title')}</LegalSub><p>{t('privacy_s1b_body')}</p>
        <LegalSub>{t('privacy_s1c_title')}</LegalSub><p>{t('privacy_s1c_body')}</p>
        <LegalSub>{t('privacy_s1d_title')}</LegalSub><p>{t(k('privacy_s1d_body'))}</p>
        <LegalSub>{t('privacy_s1e_title')}</LegalSub><p>{t('privacy_s1e_body')}</p>
        <LegalSub>{t('privacy_s1f_title')}</LegalSub><p>{t('privacy_s1f_body')}</p>
      </>,
    },
    {
      id: 'sources', title: t('privacy_sources_title'), content:
        <LegalList items={[1, 2, 3, 4, 5].map((n) => t(k(`privacy_sources_li${n}`)))} />,
    },
    {
      id: 'purposes', title: t('privacy_s2_title'), content: <>
        <p>{t('privacy_s2_intro_p1')}</p>
        <p>{t('privacy_s2_intro_p2')}</p>
        <LegalList items={[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => t(`privacy_s2_li${n}` as 'privacy_s2_li1'))} />
        <p><strong>{t('privacy_s2_google_label')}</strong> {t('privacy_s2_google_body')}</p>
      </>,
    },
    {
      id: 'legal-bases', title: t('privacy_lb_title'), content:
        <LegalList items={[t('privacy_lb_contract'), t('privacy_lb_legal'), t('privacy_lb_legit'), t('privacy_lb_consent')]} />,
    },
    {
      id: 'interest-matching', title: t('privacy_match_title'), content: <div id="matching" className="scroll-mt-24 space-y-2.5">
        <p>{t('privacy_match_p1')}</p>
        <p>{t('privacy_match_p2')}</p>
        <p><strong>{t('privacy_match_p3')}</strong></p>
        <p>{t('privacy_match_p4')}</p>
      </div>,
    },
    {
      id: 'listing-contact', title: t('terms_listing_contact_title'), content: <>
        <p>{t('terms_listing_contact_p1')}</p>
        <p>{t('terms_listing_contact_p2')}</p>
        <p>{t('terms_listing_contact_p3')}</p>
        <p><strong>{t('terms_listing_contact_p4')}</strong></p>
        <p>{t('privacy_portal_listing')}</p>
      </>,
    },
    { id: 'public-sources', title: t('privacy_public_title'), content: <><p>{t('privacy_public_p1')}</p><p>{t('privacy_public_p2')}</p></> },
    {
      id: 'ai', title: t('privacy_profiling_title'), content: <>
        <p>{t('privacy_ai_p1')}</p>
        <p>{t('privacy_ai_p2')}</p>
        <p>{t('privacy_profiling_body')}</p>
        <p>{t('privacy_ai_p3')}</p>
      </>,
    },
    {
      id: 'recipients', title: t('privacy_s4_title'), content: <>
        <p>{t('privacy_s4_intro')}</p>
        <LegalList items={[1, 2, 3, 4, 5].map((n) => (
          <><strong>{t(`privacy_s4_li${n}_label` as 'privacy_s4_li1_label')}</strong> {t(k(`privacy_s4_li${n}_body`))}</>
        ))} />
        <p>{t('privacy_s4_vendors_p')}</p>
      </>,
    },
    { id: 'transfers', title: t('privacy_transfer_title'), content: <p>{t('privacy_transfer_body')}</p> },
    {
      id: 'security', title: t('privacy_s3_title'), content: <>
        <p>{t('privacy_s3_body_measures')}</p>
        <p>{t('privacy_s3_intro')}</p>
        <LegalList items={[1, 2, 3, 4, 5].map((n) => t(`privacy_s3_li${n}` as 'privacy_s3_li1'))} />
        <p>{t('privacy_breach')}</p>
        <p>{t('privacy_s3_notice_p1')} {mail} {t('privacy_s3_notice_p2')}</p>
      </>,
    },
    { id: 'retention', title: t('privacy_s6_title'), content: <><p>{t('privacy_s6_body')}</p><p>{t('privacy_s6_body2')}</p></> },
    {
      id: 'rights', title: t('privacy_s7_title'), content: <>
        <p>{t('privacy_s7_intro')}</p>
        <LegalList items={[1, 2, 3, 4, 5].map((n) => (
          <><strong>{t(`privacy_s7_li${n}_label` as 'privacy_s7_li1_label')}</strong> {t(`privacy_s7_li${n}_body` as 'privacy_s7_li1_body')}</>
        ))} />
        <p>{t('privacy_s7_withdraw')}</p>
        <p>{t('privacy_s7_contact_p1')} {mail}{t('privacy_s7_contact_p2')}</p>
        <p>{t('privacy_s7_complaint')}</p>
      </>,
    },
    { id: 'marketing', title: t('privacy_marketing_title'), content: <p>{t('privacy_marketing_body', { email: v.email })}</p> },
    { id: 'cookies', title: t('privacy_s5_title'), content: <p>{t('privacy_s5_body')} <Link to="/cookies">{t('home_footer_cookies')}</Link>.</p> },
    {
      id: 'google', title: t('privacy_s8_title'), content:
        <p>{t('privacy_s8_p1')} <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">{t('privacy_s8_link_text')}</a>{t('privacy_s8_p2')}</p>,
    },
    { id: 'children', title: t('privacy_s9_title'), content: <p>{t('privacy_s9_body')}</p> },
    { id: 'changes', title: t('privacy_s10_title'), content: <p>{t('privacy_s10_body')}</p> },
    { id: 'contact', title: t('privacy_s11_title'), content: <><p>{t('privacy_s11_intro')}</p><LegalContactCard show={['privacy', 'legal']} doc="privacy" /></> },
  ];

  return (
    <LegalLayout
      doc="privacy"
      title={t('privacy_title')}
      intro={<p>{t('privacy_intro_p1')} <a href="https://www.homatch.live" dir="ltr">{t('privacy_domain_text')}</a> {t('privacy_intro_p2')}</p>}
      sections={sections}
      blocks={<PageBlocks slug="privacy" />}
    />
  );
}
