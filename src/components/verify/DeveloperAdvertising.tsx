/*
 * DEVELOPER ADVERTISING — A MARKETING SIGNAL, NEVER OFFICIAL EVIDENCE.
 *
 * The last research stage of Verify reads the developer's / project's public
 * ads in the Meta Ad Library (memo23 Actor, run by research-agent; see
 * src/verify/developerAds.ts). This section shows what was found, as counts,
 * themes and at most three examples, and says plainly that an ad is the
 * developer's own claim.
 *
 * LINKS. The primary report (VerifyReport.tsx) renders no URL at all. This
 * section is the one, deliberate exception the owner asked for ("verified
 * social links"), and it is narrow:
 *   - an ad's own Ad Library page and the public Ad Library search, both on
 *     https://www.facebook.com/ads/library/ only;
 *   - a social profile only when it is OFFICIAL (the advertiser page of a
 *     matched ad, or the developer's own website), https only.
 * A POSSIBLE profile (name similarity) is named, never linked. An ad's
 * landing page is never rendered: it is an advertiser-controlled
 * destination, not something HOMATCH verified.
 */
import type { ReactNode } from 'react';
import { ExternalLink, Megaphone } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { VerifySection } from '@/components/verify/ui';
import { safeLibraryHref, safeProfileHref, type DeveloperAdsView } from '@/verify/developerAds';

export interface AdvertisingAssessmentView {
  statement?: string;
  points?: string[];
}

/** First-strong isolates keep a date or name in reading order inside RTL text. */
const isolate = (s: string): string => `⁦${s}⁩`;
const day = (s: string | null | undefined): string | null => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

const PLATFORM_NAME: Record<string, string> = {
  FACEBOOK: 'Facebook',
  INSTAGRAM: 'Instagram',
  MESSENGER: 'Messenger',
  AUDIENCE_NETWORK: 'Audience Network',
  THREADS: 'Threads',
  TIKTOK: 'TikTok',
  YOUTUBE: 'YouTube',
  LINKEDIN: 'LinkedIn',
  X: 'X',
  TELEGRAM: 'Telegram',
  WEBSITE: 'Web',
};
const platformName = (p: string) => PLATFORM_NAME[p.toUpperCase()] ?? p;

/** The country's name in the reader's language (GE → Georgia / საქართველო); the code if the runtime cannot name it. */
function countryName(code: string, lang: string): string {
  try {
    return new Intl.DisplayNames([lang], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** A label for a profile: its own label, else the host of a website. */
function profileName(p: { platform: string; label: string | null; url: string }): string {
  if (p.label) return `${platformName(p.platform)} — ${p.label}`;
  if (p.platform === 'WEBSITE') {
    try {
      return new URL(p.url).hostname.replace(/^www\./, '');
    } catch {
      /* fall through */
    }
  }
  return platformName(p.platform);
}

const clip = (s: string | null | undefined, n: number): string | null => {
  const v = (s ?? '').replace(/\s+/g, ' ').trim();
  if (!v) return null;
  return v.length > n ? `${v.slice(0, n - 1).trimEnd()}…` : v;
};

function OutLink({ href, children }: { href: string; children: ReactNode }) {
  const { t } = useLanguage();
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      referrerPolicy="no-referrer"
      className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
    >
      {children}
      <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="sr-only">{t('verify_ads_opens_new')}</span>
    </a>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border/60 px-3 py-2.5">
      <dt className="text-xs text-muted-foreground break-words">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

export function DeveloperAdvertising({
  view,
  assessment,
}: {
  view: DeveloperAdsView | null | undefined;
  assessment?: AdvertisingAssessmentView | null;
}) {
  const { t, lang } = useLanguage();
  if (!view || (view.outcome !== 'COMPLETE' && view.outcome !== 'CACHED')) return null;

  const checked = day(view.verifiedAt);
  const total = view.activeCount + view.historicalCount + view.unknownStatusCount;
  const search = safeLibraryHref(view.librarySearchUrl);
  const profiles = (view.socialProfiles ?? []).slice(0, 8);
  const points = (assessment?.points ?? []).filter((p) => typeof p === 'string' && p.trim()).slice(0, 4);

  return (
    <VerifySection
      id="developer-advertising"
      eyebrow={t('verify_ads_eyebrow')}
      title={t('verify_ads_title')}
      subtitle={t('verify_ads_subtitle')}
    >
      <div className="space-y-5">
        {checked ? (
          <p className="text-xs text-muted-foreground">{t('verify_ads_checked', { date: isolate(checked) })}</p>
        ) : null}

        {total === 0 ? (
          <p className="text-sm leading-6 break-words">{t('verify_ads_none', { country: isolate(countryName(view.country, lang)) })}</p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat label={t('verify_ads_active')} value={String(view.activeCount)} />
              <Stat label={t('verify_ads_historical')} value={String(view.historicalCount)} />
              {view.platforms.length ? (
                <div className="col-span-2 min-w-0 rounded-lg border border-border/60 px-3 py-2.5 sm:col-span-1">
                  <dt className="text-xs text-muted-foreground">{t('verify_ads_platforms')}</dt>
                  <dd className="mt-0.5 text-sm font-medium break-words">{view.platforms.map(platformName).join(' · ')}</dd>
                </div>
              ) : null}
            </dl>

            {view.projectsAdvertised.length ? (
              <div className="space-y-1">
                <h3 className="text-sm font-semibold">{t('verify_ads_projects')}</h3>
                <p className="text-sm break-words" dir="auto">{view.projectsAdvertised.slice(0, 6).join(' · ')}</p>
              </div>
            ) : null}

            {view.themes.length ? (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">{t('verify_ads_themes')}</h3>
                <ul className="flex flex-wrap gap-2">
                  {view.themes.slice(0, 7).map((th) => (
                    <li key={th.theme} className="rounded-full border border-border/70 px-3 py-1 text-xs">
                      {t(`verify_ads_theme_${th.theme.toLowerCase()}`)}
                      <span className="ms-1 tabular-nums text-muted-foreground">{th.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {view.examples.length ? (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold">{t('verify_ads_examples')}</h3>
                <ul className="space-y-3">
                  {view.examples.slice(0, 3).map((ad) => {
                    const href = safeLibraryHref(ad.libraryUrl);
                    const started = day(ad.startDate);
                    return (
                      <li key={ad.adArchiveId} className="rounded-lg border border-border/60 p-3 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span
                            className={
                              ad.active === true
                                ? 'rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-400'
                                : 'rounded-full bg-muted px-2 py-0.5 font-medium'
                            }
                          >
                            {ad.active === true ? t('verify_ads_badge_active') : t('verify_ads_badge_ended')}
                          </span>
                          {ad.pageName ? <span className="break-words" dir="auto">{ad.pageName}</span> : null}
                          {started ? <span>{t('verify_ads_started', { date: isolate(started) })}</span> : null}
                        </div>
                        {clip(ad.title, 120) ? (
                          <p className="text-sm font-medium break-words" dir="auto">{clip(ad.title, 120)}</p>
                        ) : null}
                        {clip(ad.text, 280) ? (
                          <p className="text-sm leading-6 text-muted-foreground break-words" dir="auto">{clip(ad.text, 280)}</p>
                        ) : null}
                        {href ? <OutLink href={href}>{t('verify_ads_view_library')}</OutLink> : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            {view.otherAdvertiserAds > 0 ? (
              <p className="text-xs leading-5 text-muted-foreground">
                {t('verify_ads_other_excluded', { count: String(view.otherAdvertiserAds) })}
              </p>
            ) : null}
          </>
        )}

        {profiles.length ? (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">{t('verify_ads_profiles')}</h3>
            <ul className="space-y-1">
              {profiles.map((p, i) => {
                const href = safeProfileHref(p);
                const name = profileName(p);
                return (
                  <li key={`${p.platform}-${i}`} className="text-sm break-words">
                    {href ? (
                      <OutLink href={href}>
                        <span dir="auto">{name}</span>
                      </OutLink>
                    ) : (
                      <span dir="auto">{name}</span>
                    )}
                    <span className="block text-xs text-muted-foreground">
                      {p.status === 'OFFICIAL'
                        ? p.basis === 'OFFICIAL_WEBSITE'
                          ? t('verify_ads_profile_website')
                          : t('verify_ads_profile_official')
                        : t('verify_ads_profile_possible')}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {assessment?.statement || points.length ? (
          <div className="space-y-2 border-s-2 border-[hsl(var(--gold-ink))]/50 ps-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Megaphone className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              {t('verify_ads_assessment')}
            </h3>
            {assessment?.statement ? <p className="text-[15px] leading-7 break-words" dir="auto">{assessment.statement}</p> : null}
            {points.length ? (
              <ul className="list-disc space-y-1 ps-5 text-sm leading-6">
                {points.map((p, i) => (
                  <li key={i} className="break-words" dir="auto">{p}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {search ? <OutLink href={search}>{t('verify_ads_search_library')}</OutLink> : null}

        <p className="text-xs leading-5 text-muted-foreground">{t('verify_ads_marketing_note')}</p>
      </div>
    </VerifySection>
  );
}
