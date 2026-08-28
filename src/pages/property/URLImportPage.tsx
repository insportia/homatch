import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { supabase } from '@/db/supabase';
import {
  createImport, createProperty, upsertPropertyFacts,
  createSearchProfile, logActivity, updateProperty
} from '@/services/api';
import type { PropertyFacts } from '@/types/types';
import { ArrowRight, CheckCircle2, AlertCircle, Loader2, ExternalLink, ArrowLeft } from 'lucide-react';
import { ReviewExtractedProperty } from '@/components/property/ReviewExtractedProperty';
import type { ReviewSavePayload } from '@/components/property/ReviewExtractedProperty';

type PipelineStep = 'idle' | 'validating' | 'fetching' | 'extracting' | 'normalizing' | 'done' | 'error';

const STEPS: { key: PipelineStep; label: string }[] = [
  { key: 'validating', label: 'Validating URL' },
  { key: 'fetching', label: 'Fetching listing' },
  { key: 'extracting', label: 'Extracting data' },
  { key: 'normalizing', label: 'Normalising' },
  { key: 'done', label: 'Done' },
];

const STEP_ORDER: PipelineStep[] = ['validating', 'fetching', 'extracting', 'normalizing', 'done'];

function ImportPipelineVisual({ step, error }: { step: PipelineStep; error?: string | null }) {
  const currentIdx = STEP_ORDER.indexOf(step);
  return (
    <div className="space-y-3">
      {STEPS.map((s, i) => {
        const done = currentIdx > i || step === 'done';
        const active = currentIdx === i && step !== 'done' && step !== 'error';
        const failed = step === 'error' && currentIdx === i;
        return (
          <div key={s.key} className="flex items-center gap-3">
            <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-all ${
              done ? 'bg-green-500/20' : active ? 'bg-primary/20' : 'bg-secondary'
            }`}>
              {done ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
              ) : active ? (
                <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
              ) : (
                <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
              )}
            </div>
            <span className={`text-sm ${done ? 'text-foreground' : active ? 'text-foreground' : 'text-muted-foreground/50'}`}>
              {s.label}
            </span>
          </div>
        );
      })}
      {step === 'error' && error && (
        <div className="flex items-start gap-2 mt-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}
    </div>
  );
}

function URLImportContent() {
  const { homatchUser } = useAuth();
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [url, setUrl] = useState(searchParams.get('url') ?? '');
  const [step, setStep] = useState<PipelineStep>('idle');
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [importId, setImportId] = useState<string | null>(null);
  const [extractedFacts, setExtractedFacts] = useState<Partial<PropertyFacts> | null>(null);
  const [extractedTitle, setExtractedTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-start if URL provided via query param
  useEffect(() => {
    const paramUrl = searchParams.get('url');
    if (paramUrl && homatchUser) {
      handleAnalyse(paramUrl);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homatchUser]);

  const getErrorMessage = (code: string): string => {
    const map: Record<string, string> = {
      INVALID_URL: t('import_error_invalid_url'),
      NOT_A_LISTING: t('import_error_not_listing'),
      SOURCE_BLOCKED: t('import_error_blocked'),
      JS_RENDER_REQUIRED: t('import_error_js_required'),
      RENDER_PROVIDER_UNAVAILABLE: t('import_error_provider_unavailable'),
      EXTRACTION_FAILED: t('import_error_extraction_failed'),
      LOGIN_REQUIRED: t('import_error_login_required'),
      RATE_LIMITED: t('import_error_rate_limited'),
    };
    return map[code] ?? t('general_error');
  };

  const handleAnalyse = async (targetUrl?: string) => {
    const rawUrl = (targetUrl ?? url).trim();
    if (!rawUrl || !homatchUser) return;

    setStep('validating');
    setError(null);
    setErrorCode(null);
    setExtractedFacts(null);

    // Create import record
    const iId = await createImport({ userId: homatchUser.id, sourceUrl: rawUrl });
    setImportId(iId);
    await logActivity(homatchUser.id, 'IMPORT_STARTED');

    // Call edge function
    setStep('fetching');
    try {
      const { data, error: fnError } = await supabase.functions.invoke('import-property', {
        body: { url: rawUrl, importId: iId },
      });

      if (fnError) {
        const msg = await fnError?.context?.text?.() ?? fnError.message;
        let parsed: { error?: string; error_code?: string } = {};
        try { parsed = JSON.parse(msg); } catch { /* ignore */ }
        setStep('error');
        setErrorCode(parsed.error_code ?? 'EXTRACTION_FAILED');
        setError(getErrorMessage(parsed.error_code ?? 'EXTRACTION_FAILED'));
        await logActivity(homatchUser.id, 'IMPORT_FAILED');
        return;
      }

      setStep('extracting');
      await new Promise(r => setTimeout(r, 400));

      if (!data?.success) {
        setStep('error');
        setErrorCode(data?.error_code ?? 'EXTRACTION_FAILED');
        setError(getErrorMessage(data?.error_code ?? 'EXTRACTION_FAILED'));
        await logActivity(homatchUser.id, 'IMPORT_FAILED');
        return;
      }

      setStep('normalizing');
      await new Promise(r => setTimeout(r, 300));

      setExtractedFacts(data.facts ?? {});
      setExtractedTitle(data.title ?? '');
      setStep('done');
    } catch (err) {
      setStep('error');
      setError(t('import_error_extraction_failed'));
      await logActivity(homatchUser.id, 'IMPORT_FAILED');
    }
  };

  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async (facts: ReviewSavePayload, title: string) => {
    if (!homatchUser) return;
    // Idempotency guard — prevent double-submit on rapid taps
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const { transaction_type, property_type, ...pureFactFields } = facts;
      const propertyId = await createProperty({
        userId: homatchUser.id,
        sourceType: 'URL_IMPORT',
        title: title || (facts.city ? `Property in ${facts.city}` : 'Imported Property'),
        transactionType: transaction_type,
        propertyType: property_type,
      });
      if (!propertyId) {
        toast.error('Failed to save property. Please try again.');
        // NOTE: fall through to finally — do NOT return here (spinner would stick)
        return;
      }
      // Persist facts (includes cover_image + gallery_images)
      await upsertPropertyFacts({ ...pureFactFields, property_id: propertyId });
      if (pureFactFields.cover_image) {
        await updateProperty(propertyId, { cover_photo_url: pureFactFields.cover_image });
      }
      await createSearchProfile(propertyId, homatchUser.id, pureFactFields);
      await logActivity(homatchUser.id, 'PROPERTY_ADDED', propertyId);
      toast.success('Property added successfully!');
      navigate(`/property/${propertyId}`);
    } catch (err: any) {
      console.error('[URLImport] save error:', err);
      toast.error(err?.message ?? 'Failed to save property. Please try again.');
    } finally {
      // Always clear saving state — prevents infinite spinner on any code path
      savingRef.current = false;
      setSaving(false);
    }
  };

  // Show review form when extraction done
  if (step === 'done' && extractedFacts) {
    return (
      <AppLayout>
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => { setStep('idle'); setExtractedFacts(null); }}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-sm"
            >
              <ArrowLeft className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} />
              Back
            </button>
            <h1 className="text-lg font-semibold text-foreground">{t('import_review_title')}</h1>
          </div>
          <ReviewExtractedProperty
            facts={extractedFacts}
            title={extractedTitle}
            sourceUrl={url}
            saving={saving}
            onSave={handleSave}
            onBack={() => { setStep('idle'); setExtractedFacts(null); }}
          />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-xl mx-auto space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-xl font-semibold text-foreground">{t('import_title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Paste a link from any public property listing and Homatch will extract the details.
          </p>
        </div>

        {/* URL input */}
        {step === 'idle' || step === 'error' ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="import-url">{t('import_url_label')}</Label>
              <div className="flex gap-2">
                <Input
                  ref={inputRef}
                  id="import-url"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAnalyse()}
                  placeholder={t('import_url_placeholder')}
                  className="bg-secondary border-border flex-1"
                  dir="ltr"
                />
                <Button
                  onClick={() => handleAnalyse()}
                  disabled={!url.trim()}
                  className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold px-5"
                >
                  {t('import_analyse_btn')}
                  <ArrowRight className={`h-4 w-4 ${isRTL ? 'mr-1.5 rotate-180' : 'ml-1.5'}`} />
                </Button>
              </div>
            </div>

            {step === 'error' && (
              <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  <p className="text-sm text-destructive">{error}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setStep('idle'); setError(null); }}
                    className="border border-border text-sm"
                  >
                    {t('import_try_again')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate('/property/create')}
                    className="border border-border text-sm"
                  >
                    {t('import_create_private')}
                  </Button>
                </div>
              </div>
            )}

            {/* Supported sites hint */}
            <div className="rounded-lg border border-border/50 bg-secondary/30 p-3">
              <p className="text-xs text-muted-foreground/70 flex items-center gap-1.5">
                <ExternalLink className="h-3 w-3" />
                Supports myhome.ge, ss.ge, agency sites, and most public property listings.
              </p>
            </div>
          </div>
        ) : (
          /* Pipeline progress */
          <div className="rounded-xl border border-border bg-card p-6 space-y-6">
            <div className="space-y-1">
              <p className="font-medium text-foreground text-sm">{t('import_analysing')}</p>
              <p className="text-xs text-muted-foreground truncate" dir="ltr">{url}</p>
            </div>
            <ImportPipelineVisual step={step} error={error} />
          </div>
        )}
      </div>
    </AppLayout>
  );
}

export default function URLImportPage() {
  return (
    <RouteGuard>
      <URLImportContent />
    </RouteGuard>
  );
}
