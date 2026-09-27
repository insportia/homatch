import { ArrowRight, Link2, Lock } from 'lucide-react';
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { RouteGuard } from '@/components/common/RouteGuard';
import { OWNER_SURFACE } from '@/components/customer/surface';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useLanguage } from '@/contexts/LanguageContext';

function AddPropertyContent() {
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();

  /*
   * ONE CHOICE, TWICE. Both options were a <div role="button"> with an onKeyDown that
   * handled Enter and not Space — a real <button> handles both, is focusable without
   * tabIndex and announces itself without being told to. The dark owner surface is the
   * same one the portfolio and the property page wear, because this is the first step of
   * that flow rather than a page of its own.
   */
  const option = 'hm-owner-panel group flex w-full items-start gap-4 p-5 text-start transition-colors hover:border-[hsl(var(--primary))]/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))]';

  return (
    <AppLayout noPadding surfaceClass={OWNER_SURFACE}>
      <div className="mx-auto w-full max-w-2xl space-y-5 px-4 py-4 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-6">
        <div className="min-w-0 space-y-1">
          <h1 className="font-display text-xl font-semibold leading-tight tracking-[-0.015em] text-foreground">
            {t('dash_add_property')}
          </h1>
          <p className="text-2xs text-muted-foreground">{t('addprop_subtitle')}</p>
        </div>

        {/* Import from a link */}
        <button type="button" onClick={() => navigate('/property/import')} className={option}>
          <span
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[hsl(var(--primary))]/12 text-[hsl(var(--primary))] ring-1 ring-inset ring-[hsl(var(--primary))]/25 transition-colors group-hover:bg-[hsl(var(--primary))]/20"
            aria-hidden="true"
          >
            <Link2 className="h-[18px] w-[18px]" strokeWidth={1.6} />
          </span>
          <span className="min-w-0 flex-1 space-y-1">
            <span className="block font-display text-base font-semibold text-foreground">
              {t('addprop_url_title')}
            </span>
            <span className="block text-2xs leading-relaxed text-muted-foreground">
              {t('addprop_url_desc')}
            </span>
            <span className="block pt-1 text-2xs text-muted-foreground/75">
              {t('addprop_url_supports')}
            </span>
          </span>
          <ArrowRight
            className={`mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 ${isRTL ? 'rotate-180 group-hover:-translate-x-0.5' : ''}`}
            aria-hidden="true"
          />
        </button>

        {/* Enter it by hand */}
        <button type="button" onClick={() => navigate('/property/create')} className={option}>
          <span
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[hsl(var(--secondary))] text-muted-foreground ring-1 ring-inset ring-border"
            aria-hidden="true"
          >
            <Lock className="h-[18px] w-[18px]" strokeWidth={1.6} />
          </span>
          <span className="min-w-0 flex-1 space-y-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-display text-base font-semibold text-foreground">
                {t('addprop_private_title')}
              </span>
              <span className="status-private">{t('prop_private_badge')}</span>
            </span>
            <span className="block text-2xs leading-relaxed text-muted-foreground">
              {t('addprop_private_desc')}
            </span>
            <span className="block pt-1 text-2xs text-muted-foreground/75">
              {t('addprop_private_note')}
            </span>
          </span>
          <ArrowRight
            className={`mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 ${isRTL ? 'rotate-180 group-hover:-translate-x-0.5' : ''}`}
            aria-hidden="true"
          />
        </button>
      </div>
    </AppLayout>
  );
}

export default function AddPropertyPage() {
  return (
    <RouteGuard>
      <AddPropertyContent />
    </RouteGuard>
  );
}
