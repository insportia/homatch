import { Link } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { PageBlocks } from '@/site/render/PageBlocks';
import { LegalContactCard, LegalLayout, LegalList, type LegalSection, useOperatorVars } from '@/components/legal/LegalLayout';
import { useLegalEdition } from '@/lib/legal/useLegalEdition';

/*
 * Terms of Service. The order follows the owner-approved structure (legal
 * nature → matching → fees → third-party listings → Verify → accounts and
 * responsibility → IP and data → limitations → complaints → law → changes →
 * contact). Operator identity comes from src/lib/legal/operator.ts.
 */
export default function TermsPage() {
  const { t } = useLanguage();
  const v = useOperatorVars('terms');
  /* 2026-10-25 (archived) priced features in credits bought through Stripe; kept word for word. */
  const archived = useLegalEdition('terms').version === '2026-10-25';
  const privacyLink = <Link to="/privacy">{t('terms_privacy_policy_link')}</Link>;

  const sections: LegalSection[] = [
    { id: 'acceptance', title: t('terms_s1_title'), content: <p>{t('terms_s1_body_pre')} {privacyLink}{t('terms_s1_body_post')}</p> },
    {
      id: 'nature', title: t('terms_nature_title'), content: <>
        <p>{t('terms_s2_body1', { operator: v.operator })}</p>
        <p>{t('terms_s2_body_tech')}</p>
        <p>{t('terms_s2_body_party')}</p>
        <p>{t('terms_s2_body2')}</p>
      </>,
    },
    {
      id: 'matching', title: t('terms_match_title'), content: <>
        <p>{t('terms_match_body1')}</p>
        <p>{t('terms_match_body2')}</p>
        <p>{t('terms_match_body3')}</p>
        <p>{t('terms_s2_body3')}</p>
      </>,
    },
    {
      id: 'communication', title: t('terms_comm_title'), content: <>
        <p>{t('terms_comm_p1')}</p>
        <p>{t('terms_comm_p2')}</p>
        <p>{t('terms_comm_p3')}</p>
        <p><strong>{t('terms_comm_p4')}</strong></p>
        <p>{t('terms_comm_p5')}</p>
      </>,
    },
    {
      id: 'listing-contact', title: t('terms_listing_contact_title'), content: <>
        <p>{t('terms_listing_contact_p1')}</p>
        <p>{t('terms_listing_contact_p2')}</p>
        <p>{t('terms_listing_contact_p3')}</p>
        <p><strong>{t('terms_listing_contact_p4')}</strong></p>
      </>,
    },
    {
      /* Monthly GEL plans (2026-10-29). Prices and allowances are admin
         settings shown on the pricing page; provider-dependent facts are
         stated as such (scripts/saas-locale-i18n-data.mjs). */
      id: 'fees', title: t(archived ? 'terms_s4_title' : 'terms_sub_title'), content: archived ? <>
        <p>{t('terms_s4_body1')}</p>
        <p>{t('terms_s4_body2')}</p>
        <p>{t('terms_s4_body3')}</p>
        <p>{t('terms_s4_stripe')}</p>
        <p><strong>{t('terms_s4_refund')}</strong></p>
      </> : <>
        <p>{t('terms_sub_plans')}</p>
        <p>{t('terms_sub_trial')}</p>
        <p>{t('terms_sub_included')}</p>
        <p>{t('terms_s4_body2')}</p>
        <p>{t('terms_sub_third_party')}</p>
        <p>{t('terms_sub_credits')}</p>
        <p>{t('terms_sub_cancel')}</p>
        <p>{t('terms_sub_provider')}</p>
        <p><strong>{t('terms_sub_refund')}</strong></p>
      </>,
    },
    {
      id: 'listings', title: t('terms_pub_title'), content: <>
        <p>{t('terms_pub_body1')}</p>
        <p>{t('terms_pub_body2')}</p>
        <p>{t('terms_pub_body3')}</p>
        <p>{t('terms_pub_body4')}</p>
      </>,
    },
    {
      id: 'verify', title: t('terms_verify_title'), content: <>
        <p>{t('terms_verify_body1')}</p>
        <p>{t('terms_verify_sources')}</p>
        <p>{t('terms_verify_body2')}</p>
        <p>{t('terms_verify_body3')}</p>
        <p>{t('terms_verify_body4')}</p>
      </>,
    },
    {
      id: 'accounts', title: t('terms_s3_title'), content: <>
        <p>{t('terms_s3_body1_pre')} <a href={`mailto:${v.support}`} dir="ltr">{v.support}</a> {t('terms_s3_body1_post')}</p>
        <p>{t('terms_s3_body2')}</p>
      </>,
    },
    {
      id: 'responsibility', title: t('terms_resp_title'), content: <>
        <p>{t('terms_resp_body1')}</p>
        <p>{t('terms_resp_body2')}</p>
        <p>{t('terms_s5_intro')}</p>
        <LegalList items={[1, 2, 3, 4, 5, 6, 7, 8].map((n) => t(`terms_s5_item${n}` as 'terms_s5_item1'))} />
        <p>{t('terms_s5_outro')}</p>
      </>,
    },
    { id: 'ip', title: t('terms_s6_title'), content: <><p>{t('terms_s6_body1')}</p><p>{t('terms_s6_body2')}</p></> },
    { id: 'data', title: t('terms_s7_title'), content: <p>{t('terms_s7_body_pre')} {privacyLink}{t('terms_s7_body_post')}</p> },
    { id: 'third-parties', title: t('terms_s8_title'), content: <p>{t('terms_s8_body')}</p> },
    {
      id: 'limitations', title: t('terms_limits_title'), content: <>
        <p>{t('terms_limits_body1')}</p>
        <p>{t('terms_s9_body2')}</p>
        <p>{t('terms_s10_body1')}</p>
        <p>{t('terms_s10_body2')}</p>
        <p><strong>{t('terms_limits_body2')}</strong></p>
      </>,
    },
    { id: 'indemnity', title: t('terms_s11_title'), content: <p>{t('terms_s11_body')}</p> },
    {
      id: 'termination', title: t('terms_s12_title'), content:
        <p>{t('terms_s12_body_pre')} <a href={`mailto:${v.support}`} dir="ltr">{v.support}</a>{t('terms_s12_body_post')}</p>,
    },
    { id: 'complaints', title: t('terms_complaints_title'), content: <p>{t('terms_complaints_body', { email: v.support })}</p> },
    { id: 'law', title: t('terms_s13_title'), content: <p>{t('terms_s13_body')}</p> },
    { id: 'changes', title: t('terms_s14_title'), content: <p>{t('terms_s14_body')}</p> },
    { id: 'contact', title: t('terms_s15_title'), content: <><p>{t('terms_s15_intro')}</p><LegalContactCard show={['legal', 'support']} doc="terms" /></> },
  ];

  return (
    <LegalLayout
      doc="terms"
      title={t('terms_title')}
      intro={<p>{t('terms_intro')} <a href="https://www.homatch.live" dir="ltr">homatch.live</a> {t('terms_intro_cont')}</p>}
      sections={sections}
      blocks={<PageBlocks slug="terms" />}
    />
  );
}
