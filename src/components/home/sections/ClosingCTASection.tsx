import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { SceneMedia } from '@/components/home/media/SceneMedia';

/**
 * REGION 11 — the closing image.
 *
 * A full-bleed cinematic band under a navy scrim, so the page ends on the
 * same register it opened on rather than on a coloured rectangle. The scrim
 * is heavy enough to hold centred type at AA contrast at every width, which
 * is why it is a flat wash plus a vertical gradient rather than a light tint.
 */
export function ClosingCTASection() {
  const { session } = useAuth();
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();

  return (
    <section className="relative isolate overflow-hidden">
      <div className="absolute inset-0" aria-hidden="true">
        <SceneMedia
          scene="closing"
          alt=""
          sizes="100vw"
          // The panorama is 2.13:1 and this band is taller than that, so the
          // crop is vertical: hold the city lights and the terrace, drop the
          // upper sky.
          position="46% 58%"
          positionMobile="58% 62%"
        />
        <div className="absolute inset-0 bg-[hsl(214_42%_12%/0.72)]" />
        <div className="absolute inset-0 bg-gradient-to-t from-[hsl(214_42%_10%/0.85)] via-transparent to-[hsl(214_42%_10%/0.55)]" />
      </div>

      <div className="relative mx-auto flex min-h-[clamp(24rem,52vh,36rem)] w-full max-w-[90rem] flex-col items-center justify-center px-5 py-20 text-center sm:px-8 lg:px-10">
        <h2
          className="max-w-[34rem] text-balance font-semibold leading-[1.1] tracking-tight text-white"
          style={{ fontSize: 'clamp(2rem, 3.6vw, 3.15rem)' }}
        >
          {t('mp_cta_title')}
        </h2>
        <p className="mt-5 max-w-[36rem] text-pretty text-[15px] leading-relaxed text-white/75 sm:text-base">
          {t('mp_cta_body')}
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Button
            className="h-[3.25rem] gap-2.5 rounded-full bg-gold px-8 text-[15px] text-primary hover:bg-gold/90"
            onClick={() => navigate(session ? '/dashboard' : '/auth/signup')}
          >
            {session ? t('nav_dashboard') : t('mp_cta_primary')}
            <ArrowRight className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            className="h-[3.25rem] rounded-full border-white/30 bg-transparent px-8 text-[15px] text-white hover:bg-white/10 hover:text-white"
            onClick={() => navigate('/verify')}
          >
            {t('mp_cap_verify_cta')}
          </Button>
        </div>
      </div>
    </section>
  );
}
