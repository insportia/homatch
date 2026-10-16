// THE PROPERTY-PORTAL PROVIDERS — pure, no Deno or network APIs.
//
// Eight Georgian portals, each described by an evidence-backed PROFILE (what is
// true of the portal itself, fixed in code) and an admin CONFIG row
// (public.publishing_providers: enabled, links, field rules). The adapter built
// from both answers every per-provider question index.ts asks.
//
// RESEARCH (2026-10-16). For all eight portals we found NO public listing API, NO
// partner / developer programme and NO OAuth or account-linking flow:
//   - MyHome.ge: docs/myhome-partnership-request.md — no developer programme is
//     published; listing creation needs the owner's own session + SMS code.
//   - SS.ge: no API or partner docs published; creation is in the owner's session.
//   - Place.ge, Home.ge, Brokeri.ge, Allhome.ge: public listing pages only, read by
//     the official worker's Find Property adapters
//     (official-worker/src/marketplace/portals/adapters/*.mjs), which also pin
//     each portal's listing-URL pattern used below.
//   - Korter.ge: developer-led new-build catalogue (listings come from developers
//     and are moderated by Korter); its terms §5.3 forbid automated access, so
//     HOMATCH never fetches its pages (docs/claude/KNOWN_RISKS.md).
//   - Binebi.ge: every public page answers with a Cloudflare challenge
//     (docs/claude/KNOWN_RISKS.md); HOMATCH never tries to pass it.
// So every provider is a MANUAL HANDOFF. Operations that would need an API
// (connect an account, test a connection, create / update / delete / import a
// listing) return an explicit CAPABILITY_NOT_SUPPORTED — never a fake success.
// Where a create-listing URL could not be confirmed, the portal's home page is
// used and `createUrlVerified` is false until an admin sets the real one.

export type ProviderId = 'myhome' | 'ssge' | 'placege' | 'homege' | 'brokeri' | 'korter' | 'binebi' | 'allhome';
export type Verification = 'PAGE_CHECK' | 'OWNER_CONFIRMED';

/**
 * How HOMATCH can publish to a portal through its own account — the four classes
 * of the central engine. Only a class backed by a verified, permitted mechanism
 * may be anything but MANUAL_ADMIN or BLOCKED; nothing is upgraded on assumption.
 *   API                API publishing supported (an authorised, documented API)
 *   BROWSER_ASSISTED   permitted browser-assisted publishing (terms allow it, no
 *                      CAPTCHA / MFA / anti-bot control is in the way)
 *   MANUAL_ADMIN       a HOMATCH administrator posts it by hand in the HOMATCH account
 *   BLOCKED            publishing blocked or unsupported for HOMATCH
 */
export type Automation = 'API' | 'BROWSER_ASSISTED' | 'MANUAL_ADMIN' | 'BLOCKED';

export interface ProviderProfile {
  id: ProviderId;
  name: string;
  /** Hosts a listing URL may live on (subdomains included). Code-only: never admin-editable. */
  domains: string[];
  siteUrl: string;
  /** Where an owner starts a new listing, when confirmed. */
  createUrl: string | null;
  /** A brand colour for the monogram shown when no logo URL is configured. */
  color: string;
  /** How a listing can be verified as allowed by the portal's own rules. */
  verification: Verification;
  /** Why automated page checks are off, when they are. */
  verificationNote: string | null;
  defaults: { maxPhotos: number | null; descriptionMax: number | null; requiredFields: FieldKey[] };
  /** The central-engine class and why — see Automation. */
  automation: Automation;
  automationNote: string;
  evidence: string[];
  externalId: (url: URL) => string | null;
}

/** Listing fields an admin may mark required for a provider. Nothing else. */
export const FIELD_KEYS = [
  'area', 'rooms', 'bedrooms', 'bathrooms', 'floor', 'totalFloors', 'condition',
  'district', 'street', 'streetNumber', 'photos', 'contactName', 'amenities',
  'description.ka', 'description.en', 'description.ru',
] as const;
export type FieldKey = typeof FIELD_KEYS[number];

const lastDigits = (url: URL, min = 5) => url.pathname.replace(/\/+$/, '').match(new RegExp(`(\\d{${min},12})(?:\\.html)?$`))?.[1] ?? null;

export const PROFILES: ProviderProfile[] = [
  {
    id: 'myhome', name: 'MyHome.ge', domains: ['myhome.ge'], siteUrl: 'https://www.myhome.ge',
    createUrl: 'https://statements.myhome.ge/ka/statement/create?referrer=myhome', color: '#F26B1D',
    verification: 'PAGE_CHECK', verificationNote: null,
    defaults: { maxPhotos: 16, descriptionMax: null, requiredFields: ['description.ka'] },
    automation: 'MANUAL_ADMIN', automationNote: 'NO_AUTHORISED_API',
    evidence: ['No public API, partner programme or OAuth (docs/myhome-partnership-request.md).', 'Listing creation requires the owner\'s own session and SMS confirmation.', 'Public listing URL: /ka/pr/<id>/…'],
    externalId: (url) => url.pathname.match(/\/pr\/(\d{5,12})(?:\/|$)/)?.[1] ?? null,
  },
  {
    id: 'ssge', name: 'SS.ge', domains: ['ss.ge'], siteUrl: 'https://home.ss.ge',
    createUrl: 'https://home.ss.ge/ka/udzravi-qoneba', color: '#1E5BD8',
    verification: 'PAGE_CHECK', verificationNote: null,
    defaults: { maxPhotos: null, descriptionMax: null, requiredFields: [] },
    automation: 'MANUAL_ADMIN', automationNote: 'API_ANNOUNCED_NOT_ONBOARDED',
    evidence: ['A 2020 SS.ge announcement describes publishing/management APIs (ss.ge blog "ss-ge-api"); no current documentation, onboarding or credentials have been provided to HOMATCH.', 'Public listing URL ends with the listing id: …-<id>'],
    externalId: (url) => url.pathname.replace(/\/+$/, '').match(/(?:^|[/-])(\d{6,12})$/)?.[1] ?? null,
  },
  {
    id: 'placege', name: 'Place.ge', domains: ['place.ge'], siteUrl: 'https://place.ge',
    createUrl: null, color: '#0E9F6E',
    verification: 'PAGE_CHECK', verificationNote: null,
    defaults: { maxPhotos: null, descriptionMax: null, requiredFields: [] },
    automation: 'MANUAL_ADMIN', automationNote: 'NO_AUTHORISED_API',
    evidence: ['No public API, partner programme or OAuth found.', 'Public listing URL: /ge/ads/view/<id> (official-worker placege adapter).'],
    externalId: (url) => url.pathname.match(/\/ads\/view\/(\d{4,12})(?:\/|$)/)?.[1] ?? null,
  },
  {
    id: 'homege', name: 'Home.ge', domains: ['home.ge'], siteUrl: 'https://www.home.ge',
    createUrl: null, color: '#D6262C',
    verification: 'PAGE_CHECK', verificationNote: null,
    defaults: { maxPhotos: null, descriptionMax: null, requiredFields: [] },
    automation: 'MANUAL_ADMIN', automationNote: 'NO_AUTHORISED_API',
    evidence: ['No public API, partner programme or OAuth found.', 'Public listing URL: /<deal>/<type>/<slug>-<id>.html (official-worker homege adapter).'],
    externalId: (url) => url.pathname.match(/-(\d{3,12})\.html$/)?.[1] ?? null,
  },
  {
    id: 'brokeri', name: 'Brokeri.ge', domains: ['brokeri.ge'], siteUrl: 'https://brokeri.ge',
    createUrl: null, color: '#6D28D9',
    verification: 'PAGE_CHECK', verificationNote: null,
    defaults: { maxPhotos: null, descriptionMax: null, requiredFields: [] },
    automation: 'MANUAL_ADMIN', automationNote: 'NO_AUTHORISED_API',
    evidence: ['No public API, partner programme or OAuth found.', 'Public listing URL: /property/<slug>/<id> (official-worker brokeri adapter).'],
    externalId: (url) => url.pathname.replace(/\/+$/, '').match(/^\/property\/[^/]+\/(\d{2,12})$/)?.[1] ?? null,
  },
  {
    id: 'korter', name: 'Korter.ge', domains: ['korter.ge'], siteUrl: 'https://korter.ge',
    createUrl: null, color: '#111827',
    verification: 'OWNER_CONFIRMED', verificationNote: 'TERMS_FORBID_AUTOMATED_ACCESS',
    defaults: { maxPhotos: null, descriptionMax: null, requiredFields: [] },
    automation: 'MANUAL_ADMIN', automationNote: 'TERMS_FORBID_AUTOMATED_ACCESS',
    evidence: ['Developer-led new-build catalogue; listings are supplied by developers and moderated by Korter.', 'Terms §5.3 forbid automated access, so HOMATCH never fetches Korter pages (KNOWN_RISKS.md).'],
    externalId: (url) => lastDigits(url, 3) ?? (url.pathname.replace(/\/+$/, '').split('/').pop() || null),
  },
  {
    id: 'binebi', name: 'Binebi.ge', domains: ['binebi.ge'], siteUrl: 'https://binebi.ge',
    createUrl: null, color: '#0F766E',
    verification: 'OWNER_CONFIRMED', verificationNote: 'BOT_CHALLENGE_ON_PUBLIC_PAGES',
    defaults: { maxPhotos: null, descriptionMax: null, requiredFields: [] },
    automation: 'MANUAL_ADMIN', automationNote: 'BOT_CHALLENGE_ON_PUBLIC_PAGES',
    evidence: ['No public API, partner programme or OAuth found.', 'Every public page answers with a Cloudflare challenge; HOMATCH never tries to pass it (KNOWN_RISKS.md).'],
    externalId: (url) => lastDigits(url, 3) ?? (url.pathname.replace(/\/+$/, '').split('/').pop() || null),
  },
  {
    id: 'allhome', name: 'Allhome.ge', domains: ['allhome.ge'], siteUrl: 'https://www.allhome.ge',
    createUrl: null, color: '#E11D48',
    verification: 'PAGE_CHECK', verificationNote: null,
    defaults: { maxPhotos: null, descriptionMax: null, requiredFields: [] },
    automation: 'MANUAL_ADMIN', automationNote: 'NO_AUTHORISED_API',
    evidence: ['No public API, partner programme or OAuth found.', 'Public listing URL: /<slug>-<id>-<category>.html; robots.txt disallows /index.php (official-worker allhome adapter).'],
    externalId: (url) => url.pathname.match(/-(\d{4,12})-\d{1,3}\.html$/)?.[1] ?? null,
  },
];

export const PROVIDER_IDS = PROFILES.map((p) => p.id);
export const profileById = (id: unknown) => PROFILES.find((p) => p.id === id) ?? null;

/** One row of public.publishing_providers, as the database returns it. */
export interface ProviderRow {
  id: string;
  enabled: boolean;
  sort: number;
  create_url: string | null;
  logo_url: string | null;
  verification: Verification | null;
  max_photos: number | null;
  description_max: number | null;
  required_fields: string[] | null;
  health_status?: string | null;
  health_checked_at?: string | null;
  health_detail?: string | null;
  updated_at?: string | null;
}

export interface Capabilities {
  accountConnection: false;
  apiPublishing: false;
  apiUpdate: false;
  apiDelete: false;
  importListing: false;
  manualHandoff: true;
  verification: Verification;
  /** The central engine: HOMATCH publishes through its own account, by this route. */
  homatchAccount: true;
  automation: Automation;
  automationNote: string;
}

export interface ProviderConfig {
  id: ProviderId;
  name: string;
  domains: string[];
  siteUrl: string;
  createUrl: string;
  createUrlVerified: boolean;
  logoUrl: string | null;
  color: string;
  enabled: boolean;
  sort: number;
  maxPhotos: number | null;
  descriptionMax: number | null;
  requiredFields: FieldKey[];
  verification: Verification;
  verificationNote: string | null;
  capabilities: Capabilities;
  evidence: string[];
  health: { status: string | null; checkedAt: string | null; detail: string | null };
}

export const isFieldKey = (v: unknown): v is FieldKey => (FIELD_KEYS as readonly string[]).includes(String(v));

/** Profile + optional admin row → the effective config. A missing row means the code defaults, enabled. */
export function configFor(profile: ProviderProfile, row?: ProviderRow | null): ProviderConfig {
  // An admin may only relax a page-check provider to owner confirmation, never
  // switch automated checks ON for a portal whose terms or bot wall rule them out.
  const verification: Verification = profile.verification === 'OWNER_CONFIRMED' ? 'OWNER_CONFIRMED' : (row?.verification ?? profile.verification);
  const createUrl = row?.create_url || profile.createUrl;
  return {
    id: profile.id, name: profile.name, domains: profile.domains, siteUrl: profile.siteUrl,
    createUrl: createUrl || profile.siteUrl,
    createUrlVerified: !!createUrl,
    logoUrl: row?.logo_url || null,
    color: profile.color,
    enabled: row ? row.enabled !== false : true,
    sort: row?.sort ?? PROFILES.indexOf(profile),
    maxPhotos: row ? row.max_photos : profile.defaults.maxPhotos,
    descriptionMax: row ? row.description_max : profile.defaults.descriptionMax,
    requiredFields: row ? (row.required_fields ?? []).filter(isFieldKey) : profile.defaults.requiredFields,
    verification,
    verificationNote: verification === 'OWNER_CONFIRMED' ? (profile.verificationNote ?? 'ADMIN_SET_OWNER_CONFIRMATION') : null,
    capabilities: {
      accountConnection: false, apiPublishing: false, apiUpdate: false, apiDelete: false, importListing: false, manualHandoff: true, verification,
      homatchAccount: true, automation: profile.automation, automationNote: profile.automationNote,
    },
    evidence: profile.evidence,
    health: { status: row?.health_status ?? null, checkedAt: row?.health_checked_at ?? null, detail: row?.health_detail ?? null },
  };
}

/** Every provider's effective config, ordered for display. */
export function configs(rows: ProviderRow[] = []): ProviderConfig[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return PROFILES.map((p) => configFor(p, byId.get(p.id))).sort((a, b) => a.sort - b.sort);
}

/* ── The adapter ─────────────────────────────────────────────────────────
 * One interface for every provider. Today every implementation is the manual
 * handoff; an adapter with a real, authorised API would replace the
 * unsupported operations without the caller changing. */

export type Unsupported = { ok: false; code: 'CAPABILITY_NOT_SUPPORTED'; capability: string; provider: ProviderId };
export type Operation = 'connectAccount' | 'testConnection' | 'createListing' | 'updateListing' | 'deleteListing' | 'importListing';
export const OPERATIONS: Operation[] = ['connectAccount', 'testConnection', 'createListing', 'updateListing', 'deleteListing', 'importListing'];

export interface ProviderAdapter {
  config: ProviderConfig;
  getCapabilities(): Capabilities;
  hostAllowed(hostname: string): boolean;
  parseListingUrl(input: unknown): { url: string; externalId: string } | { error: string };
  /** Whether HOMATCH may fetch the public page to verify it. */
  canCheckPage(): boolean;
  /** Whether a stored account credential would be used by a verified mechanism. None today. */
  acceptsCredential(): boolean;
  run(operation: Operation): Unsupported;
}

export function adapterFor(config: ProviderConfig): ProviderAdapter {
  const profile = profileById(config.id)!;
  const hostAllowed = (hostname: string) => {
    const h = hostname.toLowerCase().replace(/\.$/, '');
    return config.domains.some((d) => h === d || h.endsWith(`.${d}`));
  };
  return {
    config,
    getCapabilities: () => config.capabilities,
    hostAllowed,
    canCheckPage: () => config.verification === 'PAGE_CHECK',
    acceptsCredential: () => config.capabilities.automation === 'API' || config.capabilities.automation === 'BROWSER_ASSISTED',
    parseListingUrl(input) {
      let url: URL;
      try { url = new URL(String(input ?? '').trim()); } catch { return { error: 'INVALID_URL' }; }
      if (url.protocol !== 'https:' || url.username || url.password || url.port) return { error: 'HTTPS_PORTAL_URL_REQUIRED' };
      if (!hostAllowed(url.hostname)) return { error: 'URL_NOT_ON_PORTAL' };
      const externalId = profile.externalId(url);
      if (!externalId) return { error: 'LISTING_ID_NOT_FOUND_IN_URL' };
      url.hash = '';
      url.search = '';
      return { url: url.toString(), externalId: externalId.slice(0, 120) };
    },
    run: (operation) => ({ ok: false, code: 'CAPABILITY_NOT_SUPPORTED', capability: operation, provider: config.id }),
  };
}

/* ── Admin edits ─────────────────────────────────────────────────────── */

const httpsUrl = (v: unknown, hostOk?: (h: string) => boolean): string | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  let url: URL;
  try { url = new URL(String(v).trim()); } catch { return undefined; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return undefined;
  if (hostOk && !hostOk(url.hostname)) return undefined;
  return url.toString().slice(0, 500);
};
const bound = (v: unknown, min: number, max: number): number | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
};

/**
 * An admin's patch → the columns to write, or the first reason it is refused.
 * Domains, capabilities and evidence are not editable: they are facts about the
 * portal, not settings.
 */
export function sanitizePatch(profile: ProviderProfile, raw: Record<string, unknown>): { patch: Record<string, unknown> } | { error: string } {
  const patch: Record<string, unknown> = {};
  const a = adapterFor(configFor(profile));
  if ('enabled' in raw) {
    if (typeof raw.enabled !== 'boolean') return { error: 'INVALID_ENABLED' };
    patch.enabled = raw.enabled;
  }
  if ('createUrl' in raw) {
    const v = httpsUrl(raw.createUrl, a.hostAllowed);
    if (v === undefined) return { error: 'CREATE_URL_MUST_BE_ON_PORTAL' };
    patch.create_url = v;
  }
  if ('logoUrl' in raw) {
    const v = httpsUrl(raw.logoUrl);
    if (v === undefined) return { error: 'LOGO_URL_MUST_BE_HTTPS' };
    patch.logo_url = v;
  }
  if ('maxPhotos' in raw) {
    const v = bound(raw.maxPhotos, 1, 100);
    if (v === undefined) return { error: 'INVALID_MAX_PHOTOS' };
    patch.max_photos = v;
  }
  if ('descriptionMax' in raw) {
    const v = bound(raw.descriptionMax, 100, 50_000);
    if (v === undefined) return { error: 'INVALID_DESCRIPTION_MAX' };
    patch.description_max = v;
  }
  if ('requiredFields' in raw) {
    if (!Array.isArray(raw.requiredFields) || !raw.requiredFields.every(isFieldKey)) return { error: 'INVALID_REQUIRED_FIELDS' };
    patch.required_fields = [...new Set(raw.requiredFields)];
  }
  if ('verification' in raw) {
    if (raw.verification !== 'PAGE_CHECK' && raw.verification !== 'OWNER_CONFIRMED') return { error: 'INVALID_VERIFICATION' };
    if (raw.verification === 'PAGE_CHECK' && profile.verification === 'OWNER_CONFIRMED') return { error: 'PAGE_CHECK_NOT_PERMITTED' };
    patch.verification = raw.verification;
  }
  if ('sort' in raw) {
    const v = bound(raw.sort, 0, 99);
    if (v === undefined || v === null) return { error: 'INVALID_SORT' };
    patch.sort = v;
  }
  if (!Object.keys(patch).length) return { error: 'NOTHING_TO_UPDATE' };
  return { patch };
}

/* ── robots.txt ───────────────────────────────────────────────────────── */

/**
 * Whether robots.txt lets `agent` fetch `path`. Groups for the agent's own token
 * win over `*`; within a group the longest matching rule wins and Allow wins a
 * tie (RFC 9309). `*` and `$` in rules are honoured.
 */
export function robotsAllows(txt: string, path: string, agent = 'homatch'): boolean {
  type Group = { agents: string[]; rules: Array<{ allow: boolean; pattern: string }> };
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === 'allow' || key === 'disallow') && current) {
      lastWasAgent = false;
      if (value) current.rules.push({ allow: key === 'allow', pattern: value });
    } else {
      lastWasAgent = false;
    }
  }
  const token = agent.toLowerCase();
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes('*'));
  let best: { allow: boolean; length: number } | null = null;
  for (const g of chosen) {
    for (const r of g.rules) {
      const anchored = r.pattern.endsWith('$');
      const body = (anchored ? r.pattern.slice(0, -1) : r.pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      const re = new RegExp(`^${body}${anchored ? '$' : ''}`);
      if (!re.test(path)) continue;
      if (!best || r.pattern.length > best.length || (r.pattern.length === best.length && r.allow)) best = { allow: r.allow, length: r.pattern.length };
    }
  }
  return best ? best.allow : true;
}
