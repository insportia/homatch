/**
 * Sample Page
 */

import PageMeta from "../components/common/PageMeta";
import { useLanguage } from '@/contexts/LanguageContext';

export default function SamplePage() {
  const { t } = useLanguage();
  return (
    <>
      <PageMeta title={t('sample_page_title')} description="Home Page Introduction" />
      <div>
        <h3>{t('sample_page_heading')}</h3>
      </div>
    </>
  );
}
