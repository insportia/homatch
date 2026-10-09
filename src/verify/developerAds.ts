// developerAds.ts — Developer Advertising Intelligence, the pure part.
//
// Verify's last research stage looks for the developer's PUBLIC advertising
// in the Meta Ad Library (memo23~facebook-ads-library-scraper-ppe through the
// shared Apify client). Everything here is deterministic and side-effect free:
//
//   resolveDeveloperIdentity  who to search for, from Verify's own evidence
//   buildActorInput           only input fields the Actor's live schema lists
//   normalizeAds              tolerant mapping of the Actor's documented output
//   matchAdvertiser           an ad counts only when its advertiser IS the
//                             developer/project — never a similarly named page
//   socialProfiles            official (confirmed by the Ad Library advertiser)
//                             vs possible matches (name similarity only)
//   summarizeAds              active vs historical, platforms, projects,
//                             messaging themes, examples, limitations
//
// Advertising is a marketing signal. It never proves financial strength,
// construction progress, legal compliance, sales or trustworthiness, and no
// ads found never proves inactivity. Impressions, spend and reach are never
// estimated: they are shown only when the source itself reports them.

export const DEFAULT_ADS_ACTOR = 'memo23~facebook-ads-library-scraper-ppe';

export interface DeveloperAdsPolicy {
  enabled: boolean;
  actorId: string;
  country: string;
  maxTerms: number;
  maxItems: number;
  maxChargeUsd: number;
  timeoutSeconds: number;
  cacheHours: number;
}

/** Admin setting verify_developer_ads → policy. Paid runs need enabled:true (owner approval). */
export function parseDeveloperAdsPolicy(raw: unknown): DeveloperAdsPolicy {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {};
  const n = (v: unknown, lo: number, hi: number, d: number) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
  const actor = typeof o.actorId === 'string' && /^memo23[~/][a-z0-9-]+$/i.test(o.actorId.trim()) ? o.actorId.trim().replace('/', '~') : DEFAULT_ADS_ACTOR;
  return {
    enabled: o.enabled === true,
    actorId: actor,
    country: typeof o.country === 'string' && /^[A-Z]{2}$/.test(o.country) ? o.country : 'GE',
    maxTerms: Math.round(n(o.maxTerms, 1, 3, 2)),
    maxItems: Math.round(n(o.maxItems, 5, 100, 50)),
    maxChargeUsd: n(o.maxChargeUsd, 0.01, 1, 0.5),
    timeoutSeconds: Math.round(n(o.timeoutSeconds, 30, 300, 180)),
    cacheHours: Math.round(n(o.cacheHours, 1, 168, 24)),
  };
}

const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});
const arr = <T = any>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const s = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v == null ? '' : String(v).trim());

// ───────────────────────── identity ─────────────────────────

const LEGAL_FORM = /^(?:შპს|სს|ი\/მ|ააიპ|ltd\.?|llc|jsc|ооо|ао|зао)\s+|\s+(?:ltd\.?|llc|jsc|inc\.?|group)$/giu;
const QUOTES = /["'«»„“”‘’]/g;

/** Comparable form: lowercase, no legal form, no quotes/punctuation. Georgian kept. */
export function nameKey(name: string): string {
  return s(name).toLowerCase().replace(QUOTES, '').replace(LEGAL_FORM, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export interface DeveloperIdentity {
  developerNames: string[];
  legalName: string | null;
  legalId: string | null;
  projectNames: string[];
  website: string | null;
  /** What the Ad Library is searched for (brand/project names, never a bare legal form). */
  searchTerms: string[];
  /** Registry-confirmed legal entity, or web research only. */
  basis: 'REGISTRY_CONFIRMED' | 'WEB_RESEARCH_ONLY' | 'NONE';
}

const GENERIC = new Set(['developer', 'development', 'construction', 'company', 'group', 'მშენებლობა', 'კომპანია', 'დეველოპერი']);

/** Who to search for — only from identity Verify already established. */
export function resolveDeveloperIdentity(result: unknown, maxTerms = 2): DeveloperIdentity {
  const r = obj(result);
  const project = { ...obj(obj(r.identity).project), ...obj(r.projectProfile) };
  const company = obj(r.companyProfile);
  const pub = obj(r.publicResearch);
  const rec = obj(r.reconciledIdentity);
  const dev = [project.developer, project.developerCompany, company.name, pub.developer, pub.legalCompany, rec.developer, rec.company]
    .map(s)
    .filter(Boolean);
  const projects = [project.name, ...arr(project.aliases), pub.project].map(s).filter(Boolean);
  const uniq = (xs: string[]) => {
    const seen = new Set<string>();
    return xs.filter((x) => {
      const k = nameKey(x);
      if (!k || k.length < 3 || GENERIC.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  const developerNames = uniq(dev);
  const projectNames = uniq(projects);
  const website = /^https?:\/\//i.test(s(project.website)) ? s(project.website) : null;
  const legalName = s(company.name) || s(pub.legalCompany) || null;
  const legalId = s(company.idCode) || s(pub.companyId) || null;
  // Brand first (how a developer advertises), then the project. Legal forms stripped.
  const brands = developerNames.map((x) => x.replace(QUOTES, '').replace(LEGAL_FORM, '').trim());
  // Ads run under a brand and a project name: brand, then project, then the rest.
  const terms = uniq([brands[0], projectNames[0], ...brands.slice(1), ...projectNames.slice(1)].filter(Boolean) as string[]).slice(0, maxTerms);
  return {
    developerNames,
    legalName,
    legalId,
    projectNames,
    website,
    searchTerms: terms,
    basis: s(company.sourceBasis) === 'REGISTRY_CONFIRMED' ? 'REGISTRY_CONFIRMED' : developerNames.length ? 'WEB_RESEARCH_ONLY' : 'NONE',
  };
}

// ───────────────────────── actor input ─────────────────────────

/**
 * Input built ONLY from properties the Actor's live input schema declares
 * (memo23Client.actorDefinition → schemaProperties). No search term field →
 * null: the capability is not there, nothing is run, nothing is spent.
 */
export function buildActorInput(schemaProperties: string[], identity: DeveloperIdentity, policy: DeveloperAdsPolicy): Record<string, unknown> | null {
  const has = new Set(schemaProperties);
  if (!has.has('searchTerms') || !identity.searchTerms.length) return null;
  const input: Record<string, unknown> = { searchTerms: identity.searchTerms.slice(0, policy.maxTerms) };
  if (has.has('searchCountries')) input.searchCountries = [policy.country];
  if (has.has('maxItems')) input.maxItems = policy.maxItems;
  // Active status is NOT filtered: active and historical ads are both needed,
  // and the status comes from each ad's own is_active field.
  return input;
}

/** Cache key: the same actor + terms + country inside the freshness window is the same search. */
export function adsCacheKey(policy: DeveloperAdsPolicy, identity: DeveloperIdentity): string {
  return [policy.actorId, policy.country, ...identity.searchTerms.map(nameKey).sort()].join('|');
}

// ───────────────────────── output ─────────────────────────

export interface NormalizedAd {
  adArchiveId: string;
  pageId: string | null;
  pageName: string | null;
  pageUrl: string | null;
  active: boolean | null;
  startDate: string | null;
  endDate: string | null;
  platforms: string[];
  text: string | null;
  title: string | null;
  linkUrl: string | null;
  cta: string | null;
  /** Public Meta Ad Library permalink for this ad. */
  libraryUrl: string;
  /** Reported by the source only; never estimated. */
  reported: { spend: string | null; impressions: string | null; reach: string | null };
}

const pick = (o: Record<string, any>, ...keys: string[]) => {
  for (const k of keys) if (o[k] != null && o[k] !== '') return o[k];
  return null;
};

function isoDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  const d = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const httpUrl = (v: unknown): string | null => (typeof v === 'string' && /^https?:\/\/[^\s]+$/i.test(v.trim()) ? v.trim() : null);

/**
 * Map one dataset item. Field names follow the Actor's public listing
 * (ad_archive_id, page_id, page_name, is_active, start_date, end_date,
 * publisher_platform, snapshot{body,title,link_url,cta_text,page_profile_uri});
 * camelCase variants are accepted. An item without an archive id is not an ad.
 */
export function normalizeAd(item: unknown): NormalizedAd | null {
  const o = obj(item);
  const id = s(pick(o, 'ad_archive_id', 'adArchiveID', 'adArchiveId', 'adId'));
  if (!/^\d{5,25}$/.test(id)) return null;
  const snap = obj(pick(o, 'snapshot'));
  const body = pick(snap, 'body');
  const text = typeof body === 'string' ? body : s(pick(obj(body), 'text')) || s(pick(obj(obj(body).markup), '__html')).replace(/<[^>]+>/g, ' ');
  const activeRaw = pick(o, 'is_active', 'isActive');
  const platforms = arr(pick(o, 'publisher_platform', 'publisherPlatform', 'publisherPlatforms')).map((p) => s(p).toUpperCase()).filter(Boolean);
  const pageId = s(pick(o, 'page_id', 'pageID', 'pageId')) || null;
  return {
    adArchiveId: id,
    pageId,
    pageName: s(pick(o, 'page_name', 'pageName')) || s(pick(snap, 'page_name')) || null,
    pageUrl: httpUrl(pick(snap, 'page_profile_uri')) ?? (pageId ? `https://www.facebook.com/${pageId}` : null),
    active: activeRaw == null ? null : activeRaw === true || activeRaw === 'true' || activeRaw === 1,
    startDate: isoDate(pick(o, 'start_date', 'startDate', 'start_date_formatted')),
    endDate: isoDate(pick(o, 'end_date', 'endDate', 'end_date_formatted')),
    platforms: [...new Set(platforms)],
    text: s(text).slice(0, 600) || null,
    title: s(pick(snap, 'title')) || null,
    linkUrl: httpUrl(pick(snap, 'link_url', 'linkUrl')),
    cta: s(pick(snap, 'cta_text', 'ctaText')) || null,
    libraryUrl: `https://www.facebook.com/ads/library/?id=${id}`,
    reported: {
      spend: s(pick(o, 'spend')) || null,
      impressions: s(pick(o, 'impressions', 'impressions_with_index')) || null,
      reach: s(pick(o, 'reach_estimate', 'reach')) || null,
    },
  };
}

/** Unique ads (by archive id) plus how many duplicates were dropped. */
export function normalizeAds(items: unknown[]): { ads: NormalizedAd[]; duplicates: number; unparsed: number; unmappedKeys: string[] } {
  const byId = new Map<string, NormalizedAd>();
  let duplicates = 0;
  let unparsed = 0;
  const known = new Set(['ad_archive_id', 'adArchiveID', 'adArchiveId', 'adId', 'page_id', 'pageID', 'pageId', 'page_name', 'pageName', 'is_active', 'isActive', 'start_date', 'startDate', 'start_date_formatted', 'end_date', 'endDate', 'end_date_formatted', 'publisher_platform', 'publisherPlatform', 'publisherPlatforms', 'snapshot', 'spend', 'impressions', 'impressions_with_index', 'reach_estimate', 'reach']);
  const unmapped = new Set<string>();
  for (const it of items) {
    for (const k of Object.keys(obj(it))) if (!known.has(k)) unmapped.add(k);
    const ad = normalizeAd(it);
    if (!ad) {
      unparsed++;
      continue;
    }
    if (byId.has(ad.adArchiveId)) {
      duplicates++;
      continue;
    }
    byId.set(ad.adArchiveId, ad);
  }
  return { ads: [...byId.values()], duplicates, unparsed, unmappedKeys: [...unmapped].slice(0, 60) };
}

/**
 * Is this advertiser the developer (or the project)? Exact-name containment
 * on normalized names — a keyword hit on another company's page does not count.
 */
export function matchAdvertiser(pageName: string | null, identity: DeveloperIdentity): 'DEVELOPER' | 'PROJECT' | null {
  const p = nameKey(pageName ?? '');
  if (!p) return null;
  const hits = (names: string[]) =>
    names.some((n) => {
      const k = nameKey(n);
      // Whole words only: "archi" must not match "archive", and a page must carry the full name.
      return k.length >= 3 && (p === k || ` ${p} `.includes(` ${k} `) || (p.length >= 4 && ` ${k} `.includes(` ${p} `)));
    });
  if (hits(identity.developerNames)) return 'DEVELOPER';
  if (hits(identity.projectNames)) return 'PROJECT';
  return null;
}

// ───────────────────────── social profiles ─────────────────────────

export interface SocialProfile {
  platform: 'FACEBOOK' | 'INSTAGRAM' | 'TIKTOK' | 'YOUTUBE' | 'LINKEDIN' | 'X' | 'TELEGRAM' | 'WEBSITE';
  url: string;
  label: string | null;
  owner: 'DEVELOPER' | 'PROJECT' | null;
  /** OFFICIAL: confirmed as the advertiser page of a matched ad, or the developer's own website. POSSIBLE: name similarity only. */
  status: 'OFFICIAL' | 'POSSIBLE';
  basis: 'AD_LIBRARY_ADVERTISER' | 'OFFICIAL_WEBSITE' | 'NAME_MATCH';
}

const PLATFORM_OF: Array<[RegExp, SocialProfile['platform']]> = [
  [/(^|\.)facebook\.com$|(^|\.)fb\.com$/, 'FACEBOOK'],
  [/(^|\.)instagram\.com$/, 'INSTAGRAM'],
  [/(^|\.)tiktok\.com$/, 'TIKTOK'],
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, 'YOUTUBE'],
  [/(^|\.)linkedin\.com$/, 'LINKEDIN'],
  [/(^|\.)x\.com$|(^|\.)twitter\.com$/, 'X'],
  [/(^|\.)t\.me$/, 'TELEGRAM'],
];

function hostOf(u: string): string {
  return (/^https?:\/\/([^/?#]+)/i.exec(u)?.[1] ?? '').toLowerCase().replace(/^www\./, '');
}

/** Normalized profile URL (no query/fragment, no trailing slash) for de-duplication. */
const profileKey = (u: string) => u.split(/[?#]/)[0].replace(/\/+$/, '').toLowerCase().replace('://www.', '://');

export function socialProfiles(result: unknown, identity: DeveloperIdentity, matchedAds: Array<NormalizedAd & { owner: 'DEVELOPER' | 'PROJECT' }>): SocialProfile[] {
  const out = new Map<string, SocialProfile>();
  // 1. Advertiser pages of ads whose advertiser IS the developer/project: official.
  //    One entry per advertiser page: ads of the same page may carry its
  //    profile URI or only its numeric id — the named profile wins.
  const pageKey = new Map<string, string>();
  for (const ad of matchedAds) {
    if (!ad.pageUrl) continue;
    const page = ad.pageId ? `fbpage:${ad.pageId}` : profileKey(ad.pageUrl);
    const prior = pageKey.get(page);
    const numericOnly = (u: string) => /facebook\.com\/\d+\/?$/.test(u);
    if (prior && !(numericOnly(out.get(prior)!.url) && !numericOnly(ad.pageUrl))) continue;
    if (prior) out.delete(prior);
    pageKey.set(page, profileKey(ad.pageUrl));
    out.set(profileKey(ad.pageUrl), { platform: 'FACEBOOK', url: ad.pageUrl, label: ad.pageName, owner: ad.owner, status: 'OFFICIAL', basis: 'AD_LIBRARY_ADVERTISER' });
  }
  // 2. The developer's own website (already established by Verify).
  if (identity.website && !out.has(profileKey(identity.website)))
    out.set(profileKey(identity.website), { platform: 'WEBSITE', url: identity.website, label: null, owner: 'DEVELOPER', status: 'OFFICIAL', basis: 'OFFICIAL_WEBSITE' });
  // 3. Social URLs Verify's research saw: possible matches unless confirmed above.
  const r = obj(result);
  for (const src of [...arr(r.sources), ...arr(r.evidence_bundle)]) {
    const url = httpUrl(obj(src).url);
    if (!url) continue;
    const platform = PLATFORM_OF.find(([re]) => re.test(hostOf(url)))?.[1];
    if (!platform || out.has(profileKey(url))) continue;
    const label = s(obj(src).label ?? obj(src).title) || null;
    const path = decodeURIComponent(url.split(/[?#]/)[0]).toLowerCase();
    const owner = matchAdvertiser(label, identity) ?? (identity.developerNames.concat(identity.projectNames).some((n) => {
      const k = nameKey(n).replace(/ /g, '');
      return k.length >= 4 && path.replace(/[^\p{L}\p{N}]+/gu, '').includes(k);
    }) ? 'DEVELOPER' : null);
    if (!owner) continue; // unrelated pages are not shown at all
    out.set(profileKey(url), { platform, url, label, owner, status: 'POSSIBLE', basis: 'NAME_MATCH' });
  }
  return [...out.values()].slice(0, 12);
}

// ───────────────────────── summary ─────────────────────────

export type AdTheme = 'PRICE' | 'PAYMENT_TERMS' | 'LOCATION' | 'AMENITIES' | 'INVESTMENT' | 'COMPLETION' | 'DISCOUNT';

const THEMES: Array<[AdTheme, RegExp]> = [
  ['PAYMENT_TERMS', /განვადებ|installment|instalment|рассрочк|0\s?%|წინასწარი\s+შენატან|down\s?payment|ипотек|mortgage/iu],
  ['DISCOUNT', /ფასდაკლებ|discount|скидк|акци|special\s+offer|sale\b/iu],
  ['PRICE', /ფასი|\$\s?\d|\d\s?\$|₾|ლარ|usd|price|цена|from\s+\d|დან\s/iu],
  ['INVESTMENT', /ინვესტ|invest|roi|yield|შემოსავ|income|доход|инвест/iu],
  ['LOCATION', /ცენტრ|მეტრო|ლოკაცი|location|metro|near|district|ზღვ|sea\s?view|центр|метро|район/iu],
  ['AMENITIES', /აუზ|ფიტნეს|პარკინგ|ავტოსადგომ|ეზო|pool|gym|fitness|parking|playground|spa|бассейн|парковк|двор/iu],
  ['COMPLETION', /ჩაბარებ|დასრულებ|ექსპლუატაცი|completion|ready\s+to\s+move|handover|сдача|сдан/iu],
];

export function themesOf(texts: string[]): Array<{ theme: AdTheme; count: number }> {
  const counts = new Map<AdTheme, number>();
  for (const t of texts) for (const [theme, re] of THEMES) if (re.test(t)) counts.set(theme, (counts.get(theme) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([theme, count]) => ({ theme, count }));
}

export type AdsOutcome = 'COMPLETE' | 'CACHED' | 'DISABLED' | 'PROVIDER_OFF' | 'NOT_CONFIGURED' | 'NO_IDENTITY' | 'UNSUPPORTED' | 'TIMEOUT' | 'FAILED';

/** The customer-safe view stored as result_json.developerAds (no run ids, no costs). */
export interface DeveloperAdsView {
  outcome: AdsOutcome;
  verifiedAt: string | null;
  platformSearched: 'META_AD_LIBRARY';
  country: string;
  searchedFor: string[];
  identity: { developerNames: string[]; legalName: string | null; projectNames: string[]; basis: DeveloperIdentity['basis'] };
  activeCount: number;
  historicalCount: number;
  unknownStatusCount: number;
  platforms: string[];
  advertisers: Array<{ pageName: string | null; owner: 'DEVELOPER' | 'PROJECT'; url: string | null; activeAds: number }>;
  projectsAdvertised: string[];
  themes: Array<{ theme: AdTheme; count: number }>;
  concentration: 'NONE' | 'SINGLE_PLATFORM' | 'MULTI_PLATFORM';
  examples: Array<Pick<NormalizedAd, 'adArchiveId' | 'pageName' | 'active' | 'startDate' | 'endDate' | 'platforms' | 'title' | 'linkUrl' | 'cta' | 'libraryUrl'> & { text: string | null }>;
  socialProfiles: SocialProfile[];
  /** Public Ad Library search for the first term (a real, unfiltered destination). */
  librarySearchUrl: string | null;
  /** Ads returned for the keywords whose advertiser is NOT the developer/project — excluded, counted. */
  otherAdvertiserAds: number;
  duplicatesRemoved: number;
  limitations: string[];
}

// ───────────────────────── customer links ─────────────────────────

const LIBRARY_HREF = /^https:\/\/www\.facebook\.com\/ads\/library\/\?/;

/** Only an Ad Library address on Meta's own host may be linked as an ad. */
export function safeLibraryHref(url: string | null | undefined): string | null {
  return typeof url === 'string' && LIBRARY_HREF.test(url) && url.length < 600 && !/[\s"'<>]/.test(url) ? url : null;
}

/** Only an OFFICIAL profile, over https, without credentials, may be linked. A POSSIBLE one is named, never linked. */
export function safeProfileHref(p: Pick<SocialProfile, 'status' | 'url'>): string | null {
  if (p.status !== 'OFFICIAL' || typeof p.url !== 'string' || p.url.length > 600) return null;
  try {
    const u = new URL(p.url);
    return u.protocol === 'https:' && !u.username && !u.password ? u.toString() : null;
  } catch {
    return null;
  }
}

export function librarySearchUrl(term: string | undefined, country: string): string | null {
  if (!term) return null;
  return `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=${encodeURIComponent(country)}&q=${encodeURIComponent(term)}&search_type=keyword_unordered`;
}

export function summarizeAds(args: {
  outcome: AdsOutcome;
  verifiedAt: string | null;
  policy: Pick<DeveloperAdsPolicy, 'country'>;
  identity: DeveloperIdentity;
  normalized: { ads: NormalizedAd[]; duplicates: number };
  result: unknown;
}): DeveloperAdsView {
  const { identity, normalized } = args;
  const matched = normalized.ads
    .map((ad) => ({ ...ad, owner: matchAdvertiser(ad.pageName, identity) }))
    .filter((a): a is NormalizedAd & { owner: 'DEVELOPER' | 'PROJECT' } => a.owner !== null);
  const other = normalized.ads.length - matched.length;
  const active = matched.filter((a) => a.active === true);
  const historical = matched.filter((a) => a.active === false);
  const platforms = [...new Set(matched.flatMap((a) => a.platforms))].sort();
  const advertisers = new Map<string, DeveloperAdsView['advertisers'][number]>();
  for (const a of matched) {
    const k = a.pageId ?? a.pageName ?? '?';
    const cur = advertisers.get(k) ?? { pageName: a.pageName, owner: a.owner, url: a.pageUrl, activeAds: 0 };
    if (a.active === true) cur.activeAds++;
    advertisers.set(k, cur);
  }
  const texts = matched.map((a) => [a.title, a.text].filter(Boolean).join(' '));
  const projectsAdvertised = identity.projectNames.filter((p) => {
    const k = nameKey(p);
    return k.length >= 3 && texts.some((t) => nameKey(t).includes(k));
  });
  const limitations: string[] = ['META_ONLY'];
  if (args.outcome !== 'COMPLETE' && args.outcome !== 'CACHED') limitations.push(`NOT_SEARCHED_${args.outcome}`);
  if (identity.basis !== 'REGISTRY_CONFIRMED') limitations.push('IDENTITY_FROM_WEB_RESEARCH');
  if (matched.length && matched.every((a) => !a.reported.spend && !a.reported.impressions)) limitations.push('NO_SPEND_OR_REACH_REPORTED');
  if (other > 0) limitations.push('OTHER_ADVERTISERS_EXCLUDED');
  const examples = [...active, ...historical]
    .sort((a, b) => Number(b.active === true) - Number(a.active === true) || (b.startDate ?? '').localeCompare(a.startDate ?? ''))
    .slice(0, 3)
    .map((a) => ({ adArchiveId: a.adArchiveId, pageName: a.pageName, active: a.active, startDate: a.startDate, endDate: a.endDate, platforms: a.platforms, title: a.title, linkUrl: a.linkUrl, cta: a.cta, libraryUrl: a.libraryUrl, text: a.text ? a.text.slice(0, 240) : null }));
  return {
    outcome: args.outcome,
    verifiedAt: args.verifiedAt,
    platformSearched: 'META_AD_LIBRARY',
    country: args.policy.country,
    searchedFor: identity.searchTerms,
    identity: { developerNames: identity.developerNames, legalName: identity.legalName, projectNames: identity.projectNames, basis: identity.basis },
    activeCount: active.length,
    historicalCount: historical.length,
    unknownStatusCount: matched.length - active.length - historical.length,
    platforms,
    advertisers: [...advertisers.values()],
    projectsAdvertised,
    themes: themesOf(texts),
    concentration: platforms.length === 0 ? 'NONE' : platforms.length === 1 ? 'SINGLE_PLATFORM' : 'MULTI_PLATFORM',
    examples,
    socialProfiles: socialProfiles(args.result, identity, matched),
    librarySearchUrl: librarySearchUrl(identity.searchTerms[0], args.policy.country),
    otherAdvertiserAds: other,
    duplicatesRemoved: normalized.duplicates,
    limitations,
  };
}

/** Compact, deterministic evidence lines for the synthesis prompt (no raw dumps). */
export function adsPromptDigest(v: DeveloperAdsView | null | undefined): string {
  if (!v) return '';
  const lines = [
    `DEVELOPER ADVERTISING (Meta Ad Library, ${v.country}; outcome ${v.outcome}; verified ${v.verifiedAt ?? 'n/a'}; searched for: ${v.searchedFor.join(', ') || 'nothing'}).`,
    `Matched advertisers: ${v.advertisers.map((a) => `${a.pageName ?? '?'} (${a.owner}, ${a.activeAds} active)`).join('; ') || 'none'}.`,
    `Active ads: ${v.activeCount}; historical: ${v.historicalCount}; status unknown: ${v.unknownStatusCount}; platforms: ${v.platforms.join(', ') || 'none'}; projects named in ads: ${v.projectsAdvertised.join(', ') || 'none'}.`,
    `Messaging themes (ads mentioning): ${v.themes.map((t) => `${t.theme} ${t.count}`).join(', ') || 'none'}.`,
    ...v.examples.map((e, i) => `Ad ${i + 1} (${e.active ? 'ACTIVE' : e.active === false ? 'INACTIVE' : 'UNKNOWN'}, since ${e.startDate ?? '?'}): ${[e.title, e.text].filter(Boolean).join(' — ').slice(0, 240)}`),
    `Limitations: ${v.limitations.join(', ')}. RULES: advertising is a marketing signal only — never evidence of financial strength, construction progress, legal compliance, sales or trustworthiness; no ads found never means the developer is inactive; never state spend, impressions or reach unless listed above.`,
  ];
  return lines.join('\n');
}
