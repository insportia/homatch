import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { PublishingOrbit } from './PublishingOrbit';
const preview = [
  'MyHome',
  'SS.ge',
  'Livo',
  'Home.ge',
  'Korter',
  'Place.ge',
].map((name) => ({ id: name, name }));
export function PublishingShowcase() {
  const { t, isRTL } = useLanguage();
  return (
    <section
      id="publishing"
      dir={isRTL ? 'rtl' : 'ltr'}
      className="pub-showcase scroll-mt-24"
      aria-labelledby="pub-showcase-title"
    >
      <div className="pub-showcase-copy">
        <p className="pub-eyebrow">
          {t('brand_name')} / {t('pub_title')}
        </p>
        <h2 id="pub-showcase-title">{t('pub_home_title')}</h2>
        <p className="pub-showcase-body">{t('pub_home_body')}</p>
        <Link to="/publishing" className="pub-button pub-button-gold">
          {t('pub_open')}
          <ArrowUpRight size={18} aria-hidden="true" />
        </Link>
      </div>
      <PublishingOrbit destinations={preview} illustrative />
    </section>
  );
}
