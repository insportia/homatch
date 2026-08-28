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
            Choose how you want to add your property to Homatch.
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
              <h2 className="font-semibold text-foreground mb-1">Import from URL</h2>
              <p className="text-sm text-muted-foreground">
                Paste a link from myhome.ge, ss.ge, or any public property listing. Homatch extracts all details automatically.
              </p>
              <p className="text-xs text-muted-foreground/60 mt-2">
                Supports: myhome.ge · ss.ge · agency sites · developer portals
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
                <h2 className="font-semibold text-foreground">Create Private Listing</h2>
                <span className="status-private">{t('prop_private_badge')}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Your property isn't published anywhere. Enter the details manually and keep it completely private.
              </p>
              <p className="text-xs text-muted-foreground/60 mt-2">
                No public URL required · Full privacy control
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
