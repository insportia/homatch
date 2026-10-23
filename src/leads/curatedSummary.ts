// EXTERNAL LEADS DATABASE — the one-line summary of a curated lead.
//
// Deterministic and built from KNOWN attributes only: the role comes from the recorded
// interests, the country and languages from their own fields (a language is never inferred
// from a country), the contact line from the channels the record actually holds. Nothing is
// invented: no budget, city, timing or readiness that the record does not state — an absent
// budget is said to be absent. When an administrator wrote a description it leads, and the
// facts still follow it.
//
// Pure (no React, no bundle): the caller passes `t` and the display-name lookups, so the
// module runs under node --test with the real i18n data (src/leads/__tests__).

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

export type SummaryInterest = 'BUY' | 'RENT' | 'INVEST';

export interface SummaryLead {
  country: string | null;
  languages: string[] | null;
  interests: string[] | null;
  city?: string | null;
  region?: string | null;
  preferredLocation?: string | null;
  budget?: { min: number | null; max: number | null; currency: string | null } | null;
  propertyType?: string | null;
  description?: string | null;
  channels?: Partial<Record<'email' | 'phone' | 'whatsapp' | 'telegram' | 'facebook' | 'linkedin' | 'otherSocial', boolean>> | null;
}

export interface SummaryContext {
  t: Translate;
  /** UI language (en/ka/ru/tr/ar/he). */
  lang: string;
  /** ISO-3166 alpha-2 → name in the UI language. */
  countryName: (code: string) => string;
  /** ISO-639 → name in the UI language. */
  languageName: (code: string) => string;
  /** A money amount in the UI locale. */
  money: (amount: number, currency: string | null) => string;
  /** "A, B and C" in the UI locale. */
  list: (items: string[]) => string;
}

const ORDER: SummaryInterest[] = ['BUY', 'RENT', 'INVEST'];

/** The interests the record holds, de-duplicated, in one stable order. */
export function knownInterests(interests: string[] | null | undefined): SummaryInterest[] {
  const set = new Set((interests ?? []).map((x) => String(x).toUpperCase()));
  return ORDER.filter((x) => set.has(x));
}

/** mw_sum_role_<KEY>: BUY, RENT, INVEST, BUY_RENT, BUY_INVEST, RENT_INVEST, ALL, NONE. */
export function roleKey(interests: string[] | null | undefined): string {
  const k = knownInterests(interests);
  if (k.length === 0) return 'mw_sum_role_NONE';
  if (k.length === 3) return 'mw_sum_role_ALL';
  return `mw_sum_role_${k.join('_')}`;
}

/* English reads "from the United States"; every other locale uses "· country" (no case grammar). */
const ENGLISH_THE = new Set(['AE', 'US', 'GB', 'NL', 'PH', 'BS', 'GM', 'MV', 'DO', 'CF', 'KM', 'SC', 'SB', 'MH', 'VA', 'CK', 'CZ', 'CD', 'KY', 'VG', 'VI', 'TC', 'FO', 'FK']);

const CHANNELS: Array<[keyof NonNullable<SummaryLead['channels']>, string]> = [
  ['email', 'mw_ch_EMAIL'], ['phone', 'mw_ch_PHONE'], ['whatsapp', 'mw_ch_WHATSAPP'], ['telegram', 'mw_ch_TELEGRAM'],
  ['facebook', 'mw_ch_FACEBOOK'], ['linkedin', 'mw_ch_LINKEDIN'], ['otherSocial', 'mw_ch_SOCIAL'],
];

/** The channel labels a record actually holds, in a fixed order. */
export function channelLabels(channels: SummaryLead['channels'], t: Translate): string[] {
  if (!channels) return [];
  return CHANNELS.filter(([k]) => channels[k] === true).map(([, key]) => t(key));
}

function clean(s: string | null | undefined): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/** One sentence per known fact, in reading order. */
export function curatedSummaryParts(lead: SummaryLead, ctx: SummaryContext): string[] {
  const { t } = ctx;
  const parts: string[] = [];
  const description = clean(lead.description);
  const interests = knownInterests(lead.interests);

  const code = clean(lead.country).toUpperCase();
  const role = t(roleKey(interests));
  let country = code ? clean(ctx.countryName(code)) || code : '';
  if (country && ctx.lang === 'en' && ENGLISH_THE.has(code) && !/^the\s/i.test(country)) country = `the ${country}`;
  const head = country ? t('mw_sum_head', { role, country }) : role;
  const sentence = interests.includes('INVEST')
    ? t('mw_sum_sentence', { head, interest: t('mw_sum_int_INVEST') })
    : `${head}.`;

  if (description) {
    parts.push(/[.!?…]$/.test(description) ? description : `${description}.`);
    parts.push(sentence);
  } else {
    parts.push(sentence);
  }

  const langs = [...new Set((lead.languages ?? []).map((l) => clean(l).toLowerCase()).filter((l) => l && l !== 'unknown'))];
  if (langs.length === 1) parts.push(t('mw_sum_lang_one', { language: ctx.languageName(langs[0]) }));
  else if (langs.length > 1) parts.push(t('mw_sum_lang_many', { languages: ctx.list(langs.map(ctx.languageName)) }));

  const channels = channelLabels(lead.channels, t);
  if (channels.length) parts.push(t(channels.length === 1 ? 'mw_sum_channel_one' : 'mw_sum_channel_many', { channels: ctx.list(channels) }));

  const place = clean(lead.preferredLocation) || [clean(lead.city), clean(lead.region)].filter(Boolean).join(', ');
  if (place) parts.push(t('mw_sum_location', { place }));

  const type = clean(lead.propertyType);
  if (type) parts.push(t('mw_sum_type', { type }));

  const b = lead.budget;
  const min = b?.min != null && b.min > 0 ? b.min : null;
  const max = b?.max != null && b.max > 0 ? b.max : null;
  if (min != null && max != null && min !== max) parts.push(t('mw_sum_budget_range', { min: ctx.money(min, b?.currency ?? null), max: ctx.money(max, b?.currency ?? null) }));
  else if (max != null) parts.push(t('mw_sum_budget_up_to', { amount: ctx.money(max, b?.currency ?? null) }));
  else if (min != null) parts.push(t('mw_sum_budget_from', { amount: ctx.money(min, b?.currency ?? null) }));
  else parts.push(t('mw_sum_budget_none'));

  return parts;
}

export function curatedSummary(lead: SummaryLead, ctx: SummaryContext): string {
  return curatedSummaryParts(lead, ctx).join(' ');
}
