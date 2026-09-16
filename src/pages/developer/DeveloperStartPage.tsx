import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { useSurfaceTheme } from '@/hooks/useSurfaceTheme';
import { useDeveloperWorkspace } from '@/contexts/DeveloperWorkspaceContext';
import { createWorkspace } from '@/services/developer/workspace';
import { devErrorText } from '@/services/developer/client';
import { rememberPendingPath } from '@/services/returnTo';
import { Panel, Eyebrow, GoldRule, LoadingRows } from '@/components/developer/primitives';

/**
 * THE FIRST SCREEN, AND THE SHORTEST ONE.
 *
 * §108 lists ten onboarding steps — company, brand, project, inventory, team,
 * pipeline, communications, documents, walkthrough, launch. This screen asks
 * for ONE of them: the company's name, and where it works.
 *
 * The other nine are real and they are not a wizard. A developer signing up
 * has an Excel file and a question ("can this thing hold my building?"), and
 * a ten-step form is what stands between them and the answer. Everything else
 * is asked for at the moment it is needed, by the screen that needs it — the
 * project form asks about the project, the import asks about the inventory,
 * the team screen asks who else works here. Each of those is one decision in
 * its own context rather than ten decisions in a row about nothing yet.
 */

const CURRENCIES = ['USD', 'EUR', 'GEL', 'GBP', 'AED', 'TRY'];

export default function DeveloperStartPage() {
  useSurfaceTheme('light');
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { homatchUser, loading: authLoading } = useAuth();
  const { memberships, loading, refresh, selectWorkspace } = useDeveloperWorkspace();

  const [name, setName] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!authLoading && !homatchUser) {
      rememberPendingPath('/developers/start');
      navigate('/auth/login', { replace: true });
    }
  }, [authLoading, homatchUser, navigate]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const id = await createWorkspace({
        name: name.trim(),
        country: country.trim() || null,
        city: city.trim() || null,
        currency,
      });
      await refresh();
      selectWorkspace(id);
      navigate('/developers/projects', { replace: true });
    } catch (error) {
      toast.error(devErrorText(error, t));
      setSaving(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-background">
        <LoadingRows rows={5} className="mx-auto max-w-lg pt-32" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-16">
        <div className="mb-7">
          <Eyebrow>{t('dev_badge')}</Eyebrow>
          <GoldRule className="my-3" />
          <h1 className="text-3xl font-semibold tracking-tight">
            {memberships.length > 0 ? t('dev_start_another_title') : t('dev_start_title')}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{t('dev_start_body')}</p>
        </div>

        <Panel className="p-5">
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="dev-ws-name">{t('dev_start_company_label')}</Label>
              <Input
                id="dev-ws-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('dev_start_company_placeholder')}
                required
                autoFocus
                maxLength={120}
              />
              <p className="text-2xs text-muted-foreground">{t('dev_start_company_hint')}</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="dev-ws-country">{t('dev_start_country_label')}</Label>
                <Input
                  id="dev-ws-country"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  maxLength={60}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dev-ws-city">{t('dev_start_city_label')}</Label>
                <Input
                  id="dev-ws-city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  maxLength={60}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dev-ws-currency">{t('dev_start_currency_label')}</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="dev-ws-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((code) => (
                    <SelectItem key={code} value={code}>{code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-2xs text-muted-foreground">{t('dev_start_currency_hint')}</p>
            </div>

            <Button type="submit" disabled={saving || !name.trim()} className="w-full">
              {saving ? t('dev_saving') : t('dev_start_submit')}
              {!saving && <ArrowRight className="ml-2 h-4 w-4" />}
            </Button>
          </form>
        </Panel>

        {memberships.length > 0 && (
          <div className="mt-6 space-y-2">
            <p className="text-2xs uppercase tracking-wider text-muted-foreground">
              {t('dev_start_existing')}
            </p>
            {memberships.map((m) => (
              <button
                key={m.workspace.id}
                type="button"
                onClick={() => { selectWorkspace(m.workspace.id); navigate('/developers/home'); }}
                className="flex w-full items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors hover:border-gold-border/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.workspace.name}</span>
                <span className="shrink-0 text-2xs text-muted-foreground">
                  {t(`dev_role_${m.role.toLowerCase()}`)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
