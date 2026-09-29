// BROKER ONBOARDING — create or edit the professional's ONE profile.
//
// The same page serves a first-time broker (after signup as a professional)
// and an existing one editing their profile. Everything is saved through
// broker_profile_save, which owns every rule: one profile per owner, a new
// profile starts as DRAFT, nothing here can set a status, a paid period or a
// verification state, and the logo must be an upload in the owner's folder.
//
// Agency TEAMS (members under an agency) are not supported yet. An agent
// joins as an individual broker; the page says so instead of pretending.

import { ArrowLeft, Check, ImagePlus, Loader2, UserRound, Building2 } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CustomerSurface, PageHero } from '@/components/customer/surface';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';
import { brokerErrorKey } from '@/components/broker/errors';
import { cn } from '@/lib/utils';
import {
  BrokerRpcError, brokerDeskSummary, completeBrokerOnboarding, saveBrokerProfile, uploadBrokerLogo,
  type BrokerProfile,
} from '@/services/brokerDesk';
import { SUPPORTED_LANGUAGES } from '@/types/types';

const DEAL_KINDS = ['SALE', 'RENT', 'SHORT_STAY', 'INVESTMENT'] as const;
const PROPERTY_TYPES = ['APARTMENT', 'HOUSE', 'LAND', 'COMMERCIAL'] as const;
const SEGMENTS = ['RESIDENTIAL', 'COMMERCIAL', 'LAND', 'NEW_BUILD'] as const;
const LANGS = SUPPORTED_LANGUAGES.map((l) => ({ code: l.code, label: l.nativeLabel }));

type Role = 'BROKER' | 'AGENCY' | 'AGENCY_MEMBER';

const splitList = (v: string) => v.split(/[,،\n]/).map((s) => s.trim()).filter(Boolean);


function Chips<T extends string>({
  options, value, onChange, label,
}: { options: readonly T[]; value: string[]; onChange: (v: string[]) => void; label: (o: T) => string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== o) : [...value, o])}
            className={cn(
              'inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-2xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              on
                ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]'
                : 'border-border bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            {on && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
            {label(o)}
          </button>
        );
      })}
    </div>
  );
}

export default function BrokerOnboardingPage() {
  const { t } = useLanguage();
  const { session, refreshUser } = useAuth();
  const navigate = useNavigate();
  const authId = session?.user?.id ?? null;

  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [existing, setExisting] = useState<BrokerProfile | null>(null);
  const [suspended, setSuspended] = useState(false);

  const [role, setRole] = useState<Role>('BROKER');
  const [name, setName] = useState('');
  const [person, setPerson] = useState('');
  const [experience, setExperience] = useState('');
  const [cities, setCities] = useState('');
  const [districts, setDistricts] = useState('');
  const [deals, setDeals] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [segments, setSegments] = useState<string[]>([]);
  const [langs, setLangs] = useState<string[]>([]);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [telegram, setTelegram] = useState('');
  const [website, setWebsite] = useState('');
  const [about, setAbout] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!authId) return;
    let cancelled = false;
    (async () => {
      try {
        const desk = await brokerDeskSummary();
        if (cancelled) return;
        setSuspended(desk.account?.suspended === true);
        const p = desk.profile;
        setExisting(p);
        if (p) {
          setRole(p.role);
          setName(p.display_name ?? '');
          setPerson(p.contact_person ?? '');
          setExperience(p.experience_years == null ? '' : String(p.experience_years));
          setCities((p.cities ?? []).join(', '));
          setDistricts((p.districts ?? []).join(', '));
          setDeals(p.deal_kinds ?? []);
          setTypes(p.property_types ?? []);
          setSegments(p.segments ?? []);
          setLangs(p.languages ?? []);
          setPhone(p.contact_phone ?? '');
          setEmail(p.contact_email ?? '');
          setWhatsapp(p.whatsapp ?? '');
          setTelegram(p.telegram ?? '');
          setWebsite(p.website ?? '');
          setAbout(p.about ?? '');
          setLogoUrl(p.logo_url);
        } else {
          setEmail(session?.user?.email ?? '');
        }
      } catch {
        if (!cancelled) setLoadFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [authId, session?.user?.email]);

  const onLogo = async (file: File | undefined) => {
    if (!file || !authId) return;
    setError(null);
    setUploading(true);
    try {
      setLogoUrl(await uploadBrokerLogo(authId, file));
    } catch (e) {
      setError(t(brokerErrorKey(e instanceof BrokerRpcError ? e.code : 'UNKNOWN')));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (name.trim().length < 2) { setError(t('broker_apply_err_name')); return; }
    if (!phone.trim() && !email.trim() && !website.trim() && !whatsapp.trim() && !telegram.trim()) {
      setError(t('broker_apply_err_contact'));
      return;
    }
    const years = experience.trim() === '' ? null : Number(experience);
    if (years != null && (!Number.isInteger(years) || years < 0 || years > 80)) {
      setError(t('broker_err_experience'));
      return;
    }
    setSaving(true);
    try {
      await saveBrokerProfile({
        display_name: name.trim(),
        role: role === 'AGENCY' ? 'AGENCY' : 'BROKER',
        cities: splitList(cities).slice(0, 20),
        districts: splitList(districts).slice(0, 40),
        languages: langs,
        deal_kinds: deals,
        property_types: types,
        segments,
        contact_phone: phone.trim() || null,
        contact_email: email.trim() || null,
        whatsapp: whatsapp.trim() || null,
        telegram: telegram.trim() || null,
        website: website.trim() || null,
        about: about.trim() || null,
        contact_person: person.trim() || null,
        experience_years: years,
        logo_url: logoUrl,
      });
      await completeBrokerOnboarding();
      /* The account became professional server-side; the nav reads it. */
      await refreshUser().catch(() => undefined);
      navigate('/broker', { replace: true });
    } catch (err) {
      setError(t(brokerErrorKey(err instanceof BrokerRpcError ? err.code : 'UNKNOWN')));
    } finally {
      setSaving(false);
    }
  };

  const label = 'mb-1.5 block text-2xs font-semibold text-foreground';
  const section = 'hm-customer-panel space-y-4 p-5 sm:p-6';
  const h2 = 'font-display text-base font-semibold text-foreground';

  return (
    <AppLayout noPadding surfaceClass="hm-customer hm-customer-canvas min-h-[calc(100dvh-4rem)]">
      <CustomerSurface className="max-w-3xl space-y-6 pt-6 sm:pt-8">
        <Link to="/broker" className="inline-flex min-h-10 items-center gap-1.5 text-2xs font-semibold text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
          {t('broker_onb_back')}
        </Link>
        <PageHero
          compact
          eyebrow={t('broker_crm_eyebrow')}
          title={existing ? t('broker_onb_title_edit') : t('broker_onb_title_new')}
          subtitle={t('broker_onb_sub')}
        />

        {loading && <Skeleton className="h-96 rounded-2xl" />}
        {!loading && loadFailed && (
          <p role="alert" className="hm-customer-panel p-5 text-sm text-muted-foreground">{t('broker_desk_load_error')}</p>
        )}
        {!loading && !loadFailed && suspended && (
          <p role="alert" className="hm-customer-panel border-destructive/40 p-5 text-sm text-destructive">{t('broker_err_suspended')}</p>
        )}

        {!loading && !loadFailed && !suspended && (
          <form onSubmit={submit} className="space-y-5" noValidate>
            {/* 1. Who you are */}
            <section className={section} aria-labelledby="onb-role">
              <h2 id="onb-role" className={h2}>{t('broker_onb_role_heading')}</h2>
              <div className="grid gap-2.5 sm:grid-cols-3" role="radiogroup" aria-labelledby="onb-role">
                {([
                  ['BROKER', UserRound, 'broker_onb_role_broker', 'broker_onb_role_broker_hint'],
                  ['AGENCY', Building2, 'broker_onb_role_agency', 'broker_onb_role_agency_hint'],
                  ['AGENCY_MEMBER', UserRound, 'broker_onb_role_member', 'broker_onb_role_member_hint'],
                ] as const).map(([value, Icon, titleKey, hintKey]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={role === value}
                    onClick={() => setRole(value)}
                    className={cn(
                      'flex min-h-11 min-w-0 flex-col items-start gap-1 rounded-xl border p-3.5 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      role === value ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]' : 'border-border bg-card hover:border-[hsl(var(--gold-border))]',
                    )}
                  >
                    <span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      {t(titleKey)}
                    </span>
                    <span className="text-2xs leading-snug text-muted-foreground">{t(hintKey)}</span>
                  </button>
                ))}
              </div>
              {role === 'AGENCY_MEMBER' && (
                <p className="rounded-lg border border-[hsl(var(--warning)/0.45)] bg-[hsl(var(--gold-soft))] px-4 py-3 text-2xs leading-relaxed text-[hsl(var(--gold-ink))]">
                  {t('broker_onb_member_limit')}
                </p>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label htmlFor="onb-name" className={label}>
                    {role === 'AGENCY' ? t('broker_onb_agency_name') : t('broker_onb_display_name')}
                  </label>
                  <Input id="onb-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className="h-11 bg-card" required />
                </div>
                <div>
                  <label htmlFor="onb-person" className={label}>{t('broker_apply_contact_person')}</label>
                  <Input id="onb-person" value={person} onChange={(e) => setPerson(e.target.value)} maxLength={120} className="h-11 bg-card" autoComplete="name" />
                </div>
                <div>
                  <label htmlFor="onb-exp" className={label}>{t('broker_onb_experience')}</label>
                  <Input id="onb-exp" inputMode="numeric" dir="ltr" value={experience} onChange={(e) => setExperience(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))} className="h-11 bg-card" />
                </div>
                <div className="sm:col-span-2">
                  <span className={label}>{t('broker_onb_logo')}</span>
                  <div className="flex flex-wrap items-center gap-3">
                    {logoUrl ? (
                      <img src={logoUrl} alt="" className="h-14 w-14 rounded-lg border border-border object-cover" />
                    ) : (
                      <span className="grid h-14 w-14 place-items-center rounded-lg border border-dashed border-border text-muted-foreground" aria-hidden="true">
                        <ImagePlus className="h-5 w-5" />
                      </span>
                    )}
                    <input ref={fileRef} type="file" accept="image/*" className="sr-only" id="onb-logo" onChange={(e) => void onLogo(e.target.files?.[0])} />
                    <label htmlFor="onb-logo" className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-4 text-2xs font-semibold text-foreground hover:border-[hsl(var(--gold-border))]">
                      {uploading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                      {logoUrl ? t('broker_onb_logo_change') : t('broker_onb_logo_upload')}
                    </label>
                    {logoUrl && (
                      <button type="button" onClick={() => setLogoUrl(null)} className="min-h-10 px-2 text-2xs font-semibold text-muted-foreground hover:text-foreground">
                        {t('broker_onb_logo_remove')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* 2. Where and what */}
            <section className={section} aria-labelledby="onb-market">
              <h2 id="onb-market" className={h2}>{t('broker_onb_market_heading')}</h2>
              <div>
                <label htmlFor="onb-cities" className={label}>{t('broker_apply_markets')}</label>
                <Input id="onb-cities" value={cities} onChange={(e) => setCities(e.target.value)} maxLength={400} className="h-11 bg-card" aria-describedby="onb-cities-hint" />
                <p id="onb-cities-hint" className="mt-1.5 text-2xs text-muted-foreground">{t('broker_apply_markets_hint')}</p>
              </div>
              <div>
                <label htmlFor="onb-districts" className={label}>{t('broker_onb_districts')}</label>
                <Input id="onb-districts" value={districts} onChange={(e) => setDistricts(e.target.value)} maxLength={800} className="h-11 bg-card" />
              </div>
              <fieldset>
                <legend className={label}>{t('broker_apply_deal_kinds')}</legend>
                <Chips options={DEAL_KINDS} value={deals} onChange={setDeals} label={(o) => t(`broker_deal_${o.toLowerCase()}` as TranslationKey)} />
              </fieldset>
              <fieldset>
                <legend className={label}>{t('broker_apply_property_types')}</legend>
                <Chips options={PROPERTY_TYPES} value={types} onChange={setTypes} label={(o) => t(`broker_ptype_${o.toLowerCase()}` as TranslationKey)} />
              </fieldset>
              <fieldset>
                <legend className={label}>{t('broker_onb_segments')}</legend>
                <Chips options={SEGMENTS} value={segments} onChange={setSegments} label={(o) => t(`broker_segment_${o.toLowerCase()}` as TranslationKey)} />
              </fieldset>
              <fieldset>
                <legend className={label}>{t('broker_apply_languages')}</legend>
                <Chips options={LANGS.map((l) => l.code)} value={langs} onChange={setLangs} label={(c) => LANGS.find((l) => l.code === c)?.label ?? c} />
              </fieldset>
            </section>

            {/* 3. How clients reach you */}
            <section className={section} aria-labelledby="onb-contact">
              <h2 id="onb-contact" className={h2}>{t('broker_onb_contact_heading')}</h2>
              <p className="text-2xs leading-relaxed text-muted-foreground">{t('broker_onb_contact_note')}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="onb-phone" className={label}>{t('broker_apply_phone')}</label>
                  <Input id="onb-phone" type="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} className="h-11 bg-card" autoComplete="tel" />
                </div>
                <div>
                  <label htmlFor="onb-email" className={label}>{t('broker_apply_email')}</label>
                  <Input id="onb-email" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} className="h-11 bg-card" autoComplete="email" />
                </div>
                <div>
                  <label htmlFor="onb-wa" className={label}>{t('comm_channel_whatsapp')}</label>
                  <Input id="onb-wa" type="tel" dir="ltr" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} maxLength={40} className="h-11 bg-card" />
                </div>
                <div>
                  <label htmlFor="onb-tg" className={label}>{t('contact_telegram')}</label>
                  <Input id="onb-tg" dir="ltr" value={telegram} onChange={(e) => setTelegram(e.target.value)} maxLength={64} className="h-11 bg-card" />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="onb-web" className={label}>{t('broker_apply_website')}</label>
                  <Input id="onb-web" type="url" dir="ltr" value={website} onChange={(e) => setWebsite(e.target.value)} maxLength={300} className="h-11 bg-card" autoComplete="url" />
                </div>
              </div>
              <div>
                <label htmlFor="onb-about" className={label}>{t('broker_apply_about')}</label>
                <textarea
                  id="onb-about"
                  value={about}
                  onChange={(e) => setAbout(e.target.value)}
                  maxLength={4000}
                  rows={4}
                  className="w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <p className="mt-1.5 text-2xs text-muted-foreground">{t('broker_apply_about_hint')}</p>
              </div>
            </section>

            <section className="hm-customer-panel p-5 sm:p-6" aria-labelledby="onb-next">
              <h2 id="onb-next" className={h2}>{t('broker_onb_next_heading')}</h2>
              <ol className="mt-3 list-decimal space-y-1.5 ps-5 text-sm leading-relaxed text-muted-foreground">
                <li>{t('broker_onb_next_1')}</li>
                <li>{t('broker_onb_next_2')}</li>
                <li>{t('broker_onb_next_3')}</li>
              </ol>
            </section>

            {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}

            <div className="flex flex-wrap gap-3 pb-8">
              <button
                type="submit"
                disabled={saving || uploading}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {existing ? t('broker_onb_save') : t('broker_onb_create')}
              </button>
            </div>
          </form>
        )}
      </CustomerSurface>
    </AppLayout>
  );
}
