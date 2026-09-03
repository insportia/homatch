import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { RouteGuard } from '@/components/common/RouteGuard';
import { Link2, Lock, ArrowRight } from 'lucide-react';

function AddPropertyContent() {
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();

  return (
    <AppLayout>
      <div className="max-w-xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{t('dash_add_property')}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t('addprop_subtitle')}
          </p>
        </div>

        {/* URL Import */}
        <div
          className="rounded-xl border border-border bg-card card-hover p-6 cursor-pointer group"
          onClick={() => navigate('/property/import')}
          role="button"
          tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && navigate('/property/import')}
        >
          <div className="flex items-start gap-4">
            <div className="shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Link2 className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold text-foreground mb-1">{t('addprop_url_title')}</h2>
              <p className="text-sm text-muted-foreground">
                {t('addprop_url_desc')}
              </p>
              <p className="text-xs text-muted-foreground/60 mt-2">
                {t('addprop_url_supports')}
              </p>
            </div>
            <ArrowRight className={`h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0 mt-1 ${isRTL ? 'rotate-180' : ''}`} />
          </div>
        </div>

        {/* Private listing */}
        <div
          className="rounded-xl border border-border bg-card card-hover p-6 cursor-pointer group"
          onClick={() => navigate('/property/create')}
          role="button"
          tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && navigate('/property/create')}
        >
          <div className="flex items-start gap-4">
            <div className="shrink-0 w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
              <Lock className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h2 className="font-semibold text-foreground">{t('addprop_private_title')}</h2>
                <span className="status-private">{t('prop_private_badge')}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {t('addprop_private_desc')}
              </p>
              <p className="text-xs text-muted-foreground/60 mt-2">
                {t('addprop_private_note')}
              </p>
            </div>
            <ArrowRight className={`h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0 mt-1 ${isRTL ? 'rotate-180' : ''}`} />
          </div>
        </div>
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
