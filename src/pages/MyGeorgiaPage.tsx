// MY GEORGIA BY HOMI — "ჩემი საქართველო", For Expats itself.
//
// For Expats opens here (owner, 2026-10-25): three tabs, the person's plan,
// the living guide and Places in Georgia. The guide and the places are public
// and readable signed out (§66); the personal sections render only for the
// owner, from their own rows (expat_profiles, expat_tasks under owner-only
// RLS). The plan is the existing roadmap (PlanBoard), the guides are the
// sourced topics (GuideHub), and HOMI is the existing assistant.

import React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Compass, ListChecks, Map as MapIcon, MessageCircle, Pencil } from 'lucide-react';
import PageMeta from '@/components/common/PageMeta';
import { AppLayout } from '@/components/layouts/AppLayout';
import { HomiAvatar } from '@/components/homi/HomiAvatar';
import { HomatchAsk } from '@/components/home/HomatchAsk';
import { GuideHub } from '@/components/expats/GuideHub';
import { ExpatSeo } from '@/components/expats/ExpatSeo';
import { MyGeorgiaGuide } from '@/components/expats/MyGeorgiaGuide';
import { PlacesInGeorgia, SeasonalPlaces } from '@/components/expats/PlacesInGeorgia';
import { PlanBoard } from '@/components/expats/PlanBoard';
import { ReminderSettings } from '@/components/expats/ReminderSettings';
import { countryName } from '@/components/matching/workspace/format';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { formatExpatDate } from '@/expats/display';
import type { PlanTask } from '@/expats/plan/tasks';
import { GUIDE_CATEGORIES, orderedCategories, type GuideCategoryKey } from '@/myGeorgia/answers';
import { getReminderPreferences, getTasks, getUpdates, listTopics, type ExpatTopic, type ExpatUpdate, type ReminderPreferenceRow } from '@/services/expats';
import { loadMyGeorgia, type MyGeorgiaState } from '@/services/myGeorgia';
import '@/components/expats/expats.css';

type Status = 'NOT_STARTED' | 'IN_PROGRESS' | 'DONE' | 'REVIEW';
type Tab = 'plan' | 'guide' | 'places';
const TABS: { key: Tab; label: string; icon: typeof Compass }[] = [
  { key: 'plan', label: 'mg_tab_plan', icon: ListChecks },
  { key: 'guide', label: 'mg_tab_guide', icon: Compass },
  { key: 'places', label: 'mg_tab_places', icon: MapIcon },
];

function StatusPill({ status }: { status: Status }) {
  const { t } = useLanguage();
  const key = { NOT_STARTED: 'mg_status_not_started', IN_PROGRESS: 'mg_status_in_progress', DONE: 'mg_status_done', REVIEW: 'mg_status_review' }[status];
  return (
    <span className={cn('rounded-full border px-2.5 py-1 text-xs font-medium',
      status === 'DONE' ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
        : status === 'REVIEW' ? 'border-amber-300 bg-amber-50 text-amber-900'
          : status === 'IN_PROGRESS' ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]'
            : 'border-border text-muted-foreground')}>
      {t(key)}
    </span>
  );
}

function Section({ id, title, status, children, action }: { id: string; title: string; status?: Status; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-24 rounded-3xl border border-border bg-card p-5 shadow-card sm:p-7">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id={`${id}-h`} className="font-display text-xl font-semibold text-foreground">{title}</h2>
        <div className="flex items-center gap-2">{status ? <StatusPill status={status} /> : null}{action}</div>
      </div>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-b border-border py-2.5 last:border-b-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}

const tasksStatus = (tasks: readonly PlanTask[]): Status => {
  if (tasks.length === 0) return 'NOT_STARTED';
  const open = tasks.filter((x) => x.status !== 'DONE' && x.status !== 'NOT_APPLICABLE');
  if (open.length === 0) return 'DONE';
  return open.length < tasks.length ? 'IN_PROGRESS' : 'NOT_STARTED';
};

export default function MyGeorgiaPage() {
  const { t, lang } = useLanguage();
  const { homatchUser, status } = useAuth();
  const navigate = useNavigate();
  const userId = homatchUser?.id ?? null;

  const [state, setState] = React.useState<MyGeorgiaState | null>(null);
  const [tasks, setTasks] = React.useState<PlanTask[]>([]);
  const [topics, setTopics] = React.useState<ExpatTopic[]>([]);
  const [updates, setUpdates] = React.useState<ExpatUpdate[]>([]);
  const [prefs, setPrefs] = React.useState<ReminderPreferenceRow | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [params] = useSearchParams();
  const tab: Tab = params.get('tab') === 'guide' ? 'guide' : params.get('tab') === 'places' ? 'places' : 'plan';
  const guest = status === 'UNAUTHENTICATED';

  /* The public content loads for everyone, at once; the owner's rows only with a session. */
  React.useEffect(() => {
    let live = true;
    void Promise.all([listTopics(), getUpdates(4)]).then(([tp, up]) => { if (live) { setTopics(tp); setUpdates(up); } });
    return () => { live = false; };
  }, []);
  const reload = React.useCallback(async () => {
    if (!userId) return;
    const [s, ts, pr] = await Promise.all([loadMyGeorgia(userId), getTasks(userId), getReminderPreferences(userId)]);
    setState(s); setTasks(ts); setPrefs(pr); setLoading(false);
  }, [userId]);
  React.useEffect(() => { void reload(); }, [reload]);
  React.useEffect(() => { if (guest) setLoading(false); }, [guest]);

  const a = state?.answers;
  const done = Boolean(state?.completedAt);
  const ordered = orderedCategories(a?.supportTopics ?? [], a?.propertyIntent ?? null);
  const picked = ordered.slice(0, 3).map((c) => c.key as GuideCategoryKey);
  const reviewIn = (keys: GuideCategoryKey[]) =>
    ordered.filter((c) => keys.includes(c.key)).some((c) => c.topics.some((slug) => topics.find((tp) => tp.slug === slug)?.needsReview));
  const guideStatus = (keys: GuideCategoryKey[]): Status => (reviewIn(keys) ? 'REVIEW' : done ? 'IN_PROGRESS' : 'NOT_STARTED');
  const edit = (
    <Link to="/my-georgia/start" className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border px-4 text-sm font-medium">
      <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> {t('mg_edit')}
    </Link>
  );
  const askContext = {
    type: 'workspace',
    data: { surface: 'my-georgia', openTasks: tasks.filter((x) => x.status !== 'DONE').slice(0, 8).map((x) => t(x.titleKey)) },
  };
  const askHomi = () => navigate('/ai', { state: { prompt: t('mg_homi_prompt'), context: askContext } });
  const none = <span className="text-muted-foreground">{t('mg_empty')}</span>;
  /* A guide section never renders as an empty frame: with no published topic for it yet,
     it offers HOMI on that subject instead. */
  const hasGuides = (keys: GuideCategoryKey[]) =>
    GUIDE_CATEGORIES.some((c) => keys.includes(c.key) && c.topics.some((slug) => topics.some((tp) => tp.slug === slug)));
  const guidesOr = (keys: GuideCategoryKey[], title: string, hub: React.ReactNode) => (hasGuides(keys) ? hub : (
    <div className="rounded-2xl border border-border bg-muted/40 p-5">
      <p className="max-w-[60ch] text-sm leading-relaxed text-foreground">{t('mg_guide_ask_body', { topic: title })}</p>
      <button type="button" onClick={() => navigate('/ai', { state: { prompt: t('mg_ask_about', { topic: title }), context: askContext } })}
        className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-[#0C1119] px-5 text-sm font-semibold text-white">
        <MessageCircle className="h-4 w-4" aria-hidden="true" /> {t('mg_ask_homi')}
      </button>
    </div>
  ));

  const legalTitle = t('mg_sec_legal');
  const dailyTitle = t('mg_sec_daily');
  const citiesTitle = t('mg_sec_cities');

  return (
    <AppLayout noPadding>
      <PageMeta title={t('mg_dash_title')} description={t('mg_dash_sub')} />
      <ExpatSeo path="/my-georgia" />
      <div className="expat-page overflow-x-hidden bg-background">
        <header className="bg-[#0C1119] px-4 pb-6 pt-10 text-white sm:pt-14">
          <div className="mx-auto flex w-full max-w-[64rem] flex-wrap items-end justify-between gap-6">
            <div>
              <p className="mb-2 text-sm font-semibold text-[hsl(var(--gold))]">{t('mg_product')}</p>
              <h1 className="font-display text-3xl font-semibold sm:text-4xl">{t('mg_dash_title')}</h1>
              <p className="mt-2 max-w-[48ch] text-base text-white/75">{t('mg_dash_sub')}</p>
            </div>
            <button type="button" onClick={askHomi} className="inline-flex min-h-12 items-center gap-2 rounded-full bg-[hsl(var(--gold))] px-6 text-sm font-semibold text-[#0C1119]">
              <HomiAvatar state="happy" size={26} animate={false} /> {t('mg_ask_homi')}
            </button>
          </div>
          {/* The three parts of My Georgia. Real links, so back, share and middle click all work. */}
          <nav aria-label={t('mg_tabs_aria')} className="mx-auto mt-8 w-full max-w-[64rem]" data-mg-tabs>
            <ul className="grid grid-cols-3 gap-1 rounded-2xl border border-white/10 bg-white/[0.04] p-1">
              {TABS.map(({ key, label, icon: Icon }) => (
                <li key={key} className="min-w-0">
                  <Link
                    to={key === 'plan' ? '/my-georgia' : `/my-georgia?tab=${key}`}
                    aria-current={tab === key ? 'page' : undefined}
                    data-mg-tab={key}
                    className={cn(
                      'flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-center text-xs font-semibold leading-tight transition-colors motion-reduce:transition-none sm:flex-row sm:gap-2 sm:text-sm',
                      tab === key ? 'bg-[hsl(var(--gold))] text-[#0C1119]' : 'text-white/80 hover:bg-white/10 hover:text-white',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 break-words">{t(label)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </header>

        <div className="mx-auto grid w-full max-w-[64rem] gap-6 px-4 py-8 sm:py-12">
          {tab === 'guide' ? (
            <MyGeorgiaGuide topics={topics} updates={updates} categories={done ? ordered : undefined} />
          ) : tab === 'places' ? (
            <PlacesInGeorgia />
          ) : loading || status === 'UNKNOWN' ? (
            <div aria-hidden="true" className="h-48 animate-pulse rounded-3xl bg-muted motion-reduce:animate-none" />
          ) : (
            <>
              {!done ? (
                <section className="rounded-3xl bg-[#0C1119] p-6 text-white sm:p-8" data-mg-resume>
                  <h2 className="font-display text-2xl font-semibold">{t('mg_welcome_title')}</h2>
                  <p className="mt-2 max-w-[52ch] text-white/75">{t('mg_welcome_body')}</p>
                  {guest ? <p className="mt-3 max-w-[52ch] text-sm text-white/60">{t('mg_guest_note')}</p> : null}
                  <Link to="/my-georgia/start" className="mt-5 inline-flex min-h-12 items-center gap-2 rounded-full bg-[hsl(var(--gold))] px-6 text-sm font-semibold text-[#0C1119]">
                    {state && state.step > 0 ? t('mg_continue') : t('mg_start')} <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
                  </Link>
                </section>
              ) : null}

              <Section id="mg-reco" title={t('mg_sec_reco')}>
                <p className="mb-3 text-sm font-semibold text-foreground">{t('mg_reco_heading')}</p>
                {guidesOr(picked, picked.map((k) => t(`mg_cat_${k.toLowerCase()}`)).join(', '), <GuideHub topics={topics} categories={ordered} only={picked} compact />)}
              </Section>

              {!guest ? (
                <div className="grid gap-6 lg:grid-cols-2">
                  <Section id="mg-info" title={t('mg_sec_info')} status={a?.firstName && a.country ? 'DONE' : a?.firstName ? 'IN_PROGRESS' : 'NOT_STARTED'} action={edit}>
                    <dl>
                      <Row label={t('mg_first_name')} value={a?.firstName || none} />
                      <Row label={t('mg_last_name')} value={a?.lastName || none} />
                      <Row label={t('mg_country')} value={a?.country ? countryName(a.country, lang) : none} />
                      {homatchUser?.email ? <Row label={t('mg_email')} value={<span dir="ltr">{homatchUser.email}</span>} /> : null}
                    </dl>
                  </Section>

                  <Section id="mg-plans" title={t('mg_sec_plans')} status={done ? 'DONE' : state && state.step > 1 ? 'IN_PROGRESS' : 'NOT_STARTED'} action={edit}>
                    <dl>
                      <Row label={t('mg_s2_title')} value={a?.propertyIntent ? t(`mg_intent_${a.propertyIntent.toLowerCase()}`) : none} />
                      <Row label={t('mg_cities_q')} value={a?.cities.length ? a.cities.map((c) => t(`mg_city_${c.toLowerCase()}`)).join(', ') : none} />
                      <Row label={t('mg_budget_q')} value={a?.budgetBand ? t(`mg_budget_${a.budgetBand.toLowerCase()}`)
                        : a?.rentBand === 'CUSTOM' && a.rentAmount ? `${a.rentAmount} ${a.rentCurrency} · ${t('mg_rent_per_month')}`
                          : a?.rentBand ? `${t(a.rentBand === 'UNDECIDED' ? 'mg_budget_undecided' : 'mg_intent_rent')} · ${a.rentCurrency}` : none} />
                      <Row label={t('mg_visit_q')} value={a?.visitStatus ? t(`mg_visit_${a.visitStatus.toLowerCase()}`) : none} />
                      <Row label={t('mg_arrival_q')} value={a?.arrivalUnknown ? t('mg_arrival_unknown') : a?.arrivalDate ? formatExpatDate(a.arrivalDate, lang) : none} />
                      <Row label={t('mg_stay_q')} value={a?.stayLength ? t(`mg_stay_${a.stayLength.toLowerCase()}`) : none} />
                    </dl>
                  </Section>
                </div>
              ) : null}

              <Section id="mg-property" title={t('mg_sec_property')}
                status={guest ? undefined : !a?.propertyIntent ? 'NOT_STARTED' : done ? 'IN_PROGRESS' : 'NOT_STARTED'}>
                <p className="max-w-[60ch] text-sm leading-relaxed text-muted-foreground">
                  {guest || !a?.propertyIntent ? t('mg_property_guest') : a.propertyIntent === 'BROWSING' ? t('mg_property_browsing') : t('mg_property_in_matching')}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link to="/find-property" className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[#0C1119] px-5 text-sm font-semibold text-white">
                    {t('mg_find_property')} <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
                  </Link>
                </div>
                <div className="mt-5"><GuideHub topics={topics} only={['RENTING', 'BUYING']} compact /></div>
              </Section>

              {!guest ? (
                <Section id="mg-documents" title={t('mg_sec_documents')} status={tasksStatus(tasks)}>
                  <p className="mb-3 text-sm font-semibold text-foreground">{t('mg_docs_heading')}</p>
                  {tasks.length > 0 ? <PlanBoard tasks={tasks} onChanged={reload} /> : (
                    <div>
                      <p className="max-w-[60ch] text-sm leading-relaxed text-muted-foreground">{done ? t('mg_docs_none_done') : t('mg_docs_none')}</p>
                      {done ? <div className="mt-4"><GuideHub topics={topics} only={['RESIDENCE']} compact /></div> : (
                        <Link to="/my-georgia/start" className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-[#0C1119] px-5 text-sm font-semibold text-white">
                          {state && state.step > 0 ? t('mg_continue') : t('mg_start')} <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
                        </Link>
                      )}
                    </div>
                  )}
                  {prefs && tasks.length > 0 ? <div className="mt-5"><ReminderSettings userId={userId as string} preferences={prefs} onSaved={reload} /></div> : null}
                </Section>
              ) : null}

              <Section id="mg-legal" title={legalTitle} status={guest ? undefined : guideStatus(['RESIDENCE', 'BUSINESS'])}>
                {guidesOr(['RESIDENCE', 'BUSINESS'], legalTitle, <GuideHub topics={topics} only={['RESIDENCE', 'BUSINESS']} compact />)}
              </Section>

              <Section id="mg-daily" title={dailyTitle} status={guest ? undefined : guideStatus(['LIVING', 'TRANSPORT', 'BANKING', 'CONNECTIVITY', 'HEALTH', 'TIPS'])}>
                {guidesOr(['LIVING', 'TRANSPORT', 'BANKING', 'CONNECTIVITY', 'HEALTH', 'TIPS'], dailyTitle,
                  <GuideHub topics={topics} categories={ordered} only={['LIVING', 'TRANSPORT', 'BANKING', 'CONNECTIVITY', 'HEALTH', 'TIPS']} />)}
              </Section>

              <Section id="mg-cities" title={citiesTitle} status={guest ? undefined : guideStatus(['CITIES', 'TRAVEL'])}>
                {guidesOr(['CITIES', 'TRAVEL'], citiesTitle, <GuideHub topics={topics} only={['CITIES', 'TRAVEL']} compact />)}
              </Section>

              <Section id="mg-places" title={t('mg_places_season_title')}>
                <SeasonalPlaces placesHref="/my-georgia?tab=places" />
              </Section>

              <Section id="mg-homi" title={t('mg_sec_homi')}>
                <HomatchAsk
                  variant="card"
                  tone="light"
                  placeholder={t('expat_ask_placeholder')}
                  actions={[
                    { key: 'first', label: t('mg_homi_prompt') },
                    { key: 'stay', label: t('expat_ask_stay') },
                    { key: 'bank', label: t('expat_ask_bank') },
                  ]}
                />
              </Section>
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
