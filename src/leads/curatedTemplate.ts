// ADMIN — External Leads Database: the downloadable Excel import template.
//
// Pure: it describes the workbook (SheetSpec[]) and builds it with src/lib/xlsx.ts. No React.
//
// The "Leads" sheet is FIRST on purpose: the importer reads a workbook's first sheet, so a filled
// copy of this template uploads as it is. Its headers are the canonical field codes the server
// normalises (curated_normalise_row, migration 20261129090000). The five example rows use
// @example.com addresses; the importer warns while any of them are still present.
//
// Column descriptions are a technical reference keyed by field code and stay in English; the
// instructions, consent guidance and sheet headings follow the admin's language.

import { buildWorkbook, type CellValue, type SheetSpec } from '@/lib/xlsx';
import type { CanonicalField } from '@/services/curatedLeadsAdmin';
import { IMPORT_FIELDS, REQUIRED_IMPORT_FIELDS } from './importMapping';

/**
 * Translates a key SUFFIX: the admin page prepends its own admin-only prefix. That prefix
 * stays in the admin console (tests/matrix/adminStringSplit.test.mjs), never in src/leads.
 */
export type Translate = (keySuffix: string, vars?: Record<string, string | number>) => string;

/** Interest words the server accepts (curated_normalise_row), by language. Case-insensitive. */
export const INTEREST_WORDS: Record<'BUY' | 'RENT' | 'INVEST', Record<'en' | 'ka' | 'ru' | 'tr' | 'ar' | 'he', string[]>> = {
  BUY: {
    en: ['buy', 'buyer', 'buyers', 'purchase', 'sale'], ka: ['ყიდვა', 'მყიდველი'], ru: ['купить', 'покупка', 'покупатель'],
    tr: ['satın al', 'satin al', 'alıcı'], ar: ['شراء'], he: ['קנייה'],
  },
  RENT: {
    en: ['rent', 'renter', 'tenant', 'tenants', 'lease', 'rental'], ka: ['ქირა', 'მოიჯარე'], ru: ['аренда', 'арендатор', 'снять'],
    tr: ['kiralık', 'kira', 'kiracı'], ar: ['إيجار', 'استئجار'], he: ['שכירות'],
  },
  INVEST: {
    en: ['invest', 'investor', 'investors', 'investment'], ka: ['ინვესტიცია', 'ინვესტორი'], ru: ['инвестиция', 'инвестиции', 'инвестор'],
    tr: ['yatırım', 'yatirim', 'yatırımcı'], ar: ['استثمار', 'مستثمر'], he: ['השקעה', 'משקיע'],
  },
};

const COLUMN_DOCS: Record<CanonicalField, [string, string]> = {
  first_name: ['Given name, as the person wrote it (1–120 characters).', 'Nino; Daniel'],
  last_name: ['Family name (1–120 characters).', 'Beridze; Cohen'],
  email: ['Personal email. Unique in the catalog: an address already present is reported as a duplicate, never merged by name.', 'nino.beridze@example.com'],
  interests: ['One to three of BUY, RENT, INVEST, separated by comma, semicolon, slash, "+" or "and". Synonyms in six languages are accepted (see the Interests sheet).', 'BUY; BUY, INVEST; ქირა'],
  country: ['Country of residence: ISO 3166-1 alpha-2 code. Country names in English, Georgian, Russian, Turkish, Arabic or Hebrew and alpha-3 codes are converted on upload.', 'GE; IL; Georgia; საქართველო'],
  languages: ['Languages the person speaks: ISO 639 codes, comma-separated. Leave empty when unknown — never infer it from the country.', 'ka, en; ru'],
  category: ['Optional: PRIVATE, CORPORATE, DIASPORA, EXPAT or OTHER.', 'PRIVATE'],
  phone: ['Optional phone, ideally international format with +. Formatted as text so Excel keeps the + and leading zeros.', '+995 599 00 01 01'],
  whatsapp: ['Optional WhatsApp number or link.', '+972 50 000 0102'],
  telegram: ['Optional Telegram username or link.', '@olga_s'],
  facebook: ['Optional Facebook profile URL.', 'https://facebook.com/…'],
  linkedin: ['Optional LinkedIn profile URL.', 'https://linkedin.com/in/…'],
  other_social: ['Optional other social profile (Instagram, VK, …).', 'https://instagram.com/…'],
  city: ['Optional city of residence.', 'Tbilisi; Tel Aviv'],
  region: ['Optional region / state of residence.', 'Tbilisi; Central District'],
  preferred_location: ['Where in Georgia they are looking.', 'Vake, Tbilisi; Batumi seafront'],
  budget_min: ['Optional minimum budget, digits only.', '120000'],
  budget_max: ['Optional maximum budget, digits only.', '180000'],
  currency: ['ISO 4217 code of the budget.', 'USD; EUR; GEL'],
  property_type: ['Optional property type, free text.', 'Apartment; House; Land'],
  area_min: ['Optional minimum area in m², digits only.', '70'],
  area_max: ['Optional maximum area in m², digits only.', '110'],
  rooms_min: ['Optional minimum rooms.', '2'],
  rooms_max: ['Optional maximum rooms.', '3'],
  investment_prefs: ['Optional investment preferences (≤ 500 characters).', 'Rental yield above 7%'],
  description: ['Optional short description of the request (≤ 600 characters). Shown to customers after unlock.', 'Family of four, moving in spring'],
  source_description: ['Optional note on where this person came from (≤ 600 characters).', 'Tbilisi property fair, Oct 2026'],
  collected_at: ['Optional date the contact was collected, YYYY-MM-DD.', '2026-09-14'],
  last_verified_at: ['Optional date the contact was last confirmed, YYYY-MM-DD.', '2026-10-01'],
  tags: ['Optional comma-separated tags.', 'vip, fair-2026'],
  admin_notes: ['Optional internal note, never shown to customers or exported.', 'Prefers WhatsApp'],
};

const EXAMPLE_ROWS: Array<Partial<Record<CanonicalField, CellValue>>> = [
  {
    first_name: 'Nino', last_name: 'Beridze', email: 'nino.beridze@example.com', interests: 'BUY', country: 'GE', languages: 'ka, en',
    category: 'PRIVATE', phone: '+995 599 00 01 01', city: 'Tbilisi', region: 'Tbilisi', preferred_location: 'Vake, Tbilisi',
    budget_min: 120000, budget_max: 180000, currency: 'USD', property_type: 'Apartment', area_min: 70, area_max: 110, rooms_min: 2, rooms_max: 3,
    description: 'Family apartment near schools', source_description: 'Partner agency referral', collected_at: '2026-09-14', last_verified_at: '2026-10-01',
    tags: 'family',
  },
  {
    first_name: 'Daniel', last_name: 'Cohen', email: 'daniel.cohen@example.com', interests: 'BUY, INVEST', country: 'IL', languages: 'he, en',
    category: 'DIASPORA', whatsapp: '+972 50 000 0102', city: 'Tel Aviv', preferred_location: 'Batumi seafront', budget_min: 90000, budget_max: 150000,
    currency: 'USD', property_type: 'Apartment', investment_prefs: 'Short-term rental income', collected_at: '2026-08-30', tags: 'investor',
  },
  {
    first_name: 'Olga', last_name: 'Smirnova', email: 'olga.smirnova@example.com', interests: 'RENT', country: 'RU', languages: 'ru',
    category: 'EXPAT', telegram: '@olga_s', preferred_location: 'Saburtalo, Tbilisi', budget_max: 900, currency: 'USD', property_type: 'Apartment',
    rooms_min: 1, rooms_max: 2, description: 'Long-term rent from December', collected_at: '2026-10-05',
  },
  {
    first_name: 'Mehmet', last_name: 'Yılmaz', email: 'mehmet.yilmaz@example.com', interests: 'yatırım', country: 'Türkiye', languages: 'tr, en',
    category: 'CORPORATE', linkedin: 'https://www.linkedin.com/in/example', city: 'Istanbul', preferred_location: 'Batumi; Kutaisi',
    budget_min: 250000, budget_max: 600000, currency: 'EUR', property_type: 'Commercial', investment_prefs: 'Hotel or commercial space',
    source_description: 'Investment forum', collected_at: '2026-09-20',
  },
  {
    first_name: 'Layla', last_name: 'Haddad', email: 'layla.haddad@example.com', interests: 'RENT, BUY, INVEST', country: 'AE', languages: '',
    category: 'PRIVATE', phone: '+971 50 000 0105', city: 'Dubai', preferred_location: 'Tbilisi or Batumi', budget_max: 300000, currency: 'USD',
    property_type: 'House', description: 'Rent first, then buy', collected_at: '2026-10-10', admin_notes: 'Language unknown: left empty on purpose',
  },
];

export function curatedTemplateSheets(label: Translate): SheetSpec[] {
  const required = new Set<CanonicalField>(REQUIRED_IMPORT_FIELDS);
  const numeric = new Set<CanonicalField>(['budget_min', 'budget_max', 'area_min', 'area_max', 'rooms_min', 'rooms_max']);

  const leads: SheetSpec = {
    name: 'Leads',
    columns: IMPORT_FIELDS.map((f) => ({ header: f, field: f, format: numeric.has(f) ? 'number' : 'text', width: Math.max(14, f.length + 4) })),
    rows: EXAMPLE_ROWS as Array<Record<string, CellValue>>,
  };

  const instructions: SheetSpec = {
    name: label('tpl_sheet_instructions'),
    title: label('tpl_doc_title'),
    columns: [{ header: '#', field: 'n', format: 'integer', width: 5 }, { header: label('tpl_col_step'), field: 'text', width: 120 }],
    rows: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ n, text: label(`tpl_i${n}`) })),
  };

  const columns: SheetSpec = {
    name: label('tpl_sheet_columns'),
    columns: [
      { header: label('tpl_col_field'), field: 'field', width: 22 },
      { header: label('tpl_col_required'), field: 'required', width: 14 },
      { header: label('tpl_col_description'), field: 'description', width: 90 },
      { header: label('tpl_col_examples'), field: 'examples', width: 40 },
    ],
    rows: IMPORT_FIELDS.map((f) => ({
      field: f, required: required.has(f) ? label('required') : label('optional'),
      description: COLUMN_DOCS[f][0], examples: COLUMN_DOCS[f][1],
    })),
  };

  const interests: SheetSpec = {
    name: label('tpl_sheet_interests'),
    subtitles: [label('tpl_interests_note')],
    columns: [
      { header: label('tpl_col_code'), field: 'code', width: 10 },
      { header: label('tpl_col_meaning'), field: 'meaning', width: 34 },
      ...(['en', 'ka', 'ru', 'tr', 'ar', 'he'] as const).map((l) => ({ header: l.toUpperCase(), field: l, width: 30 })),
    ],
    rows: (['BUY', 'RENT', 'INVEST'] as const).map((code) => ({
      code, meaning: label(`int_${code}`),
      ...Object.fromEntries(Object.entries(INTEREST_WORDS[code]).map(([l, words]) => [l, words.join(', ')])),
    })),
  };

  const geo: SheetSpec = {
    name: label('tpl_sheet_geo'),
    subtitles: [label('tpl_geo_country_note'), label('tpl_geo_language_note')],
    columns: [
      { header: label('tpl_col_kind'), field: 'kind', width: 14 },
      { header: label('tpl_col_code'), field: 'code', width: 10 },
      { header: label('tpl_col_examples'), field: 'example', width: 60 },
    ],
    rows: [
      ...[['GE', 'Georgia · საქართველო · Грузия · GEO'], ['IL', 'Israel · ისრაელი · Израиль · ISR'], ['TR', 'Türkiye · Turkey · Türkiye · TUR'],
        ['RU', 'Russia · რუსეთი · Россия · RUS'], ['UA', 'Ukraine · უკრაინა · Украина · UKR'], ['AE', 'United Arab Emirates · UAE · الإمارات · ARE'],
        ['US', 'United States · USA'], ['GB', 'United Kingdom · UK'], ['DE', 'Germany · Deutschland · DEU'], ['AZ', 'Azerbaijan · AZE'],
        ['AM', 'Armenia · ARM'], ['KZ', 'Kazakhstan · KAZ']]
        .map(([code, example]) => ({ kind: label('tpl_kind_country'), code, example })),
      ...[['ka', 'Georgian · ქართული'], ['en', 'English'], ['ru', 'Russian · русский'], ['tr', 'Turkish · Türkçe'], ['ar', 'Arabic · العربية'],
        ['he', 'Hebrew · עברית'], ['uk', 'Ukrainian · українська'], ['de', 'German · Deutsch'], ['fr', 'French · français'], ['', label('tpl_language_empty')]]
        .map(([code, example]) => ({ kind: label('tpl_kind_language'), code, example })),
    ],
  };

  const consent: SheetSpec = {
    name: label('tpl_sheet_consent'),
    columns: [
      { header: label('tpl_col_topic'), field: 'topic', width: 34 },
      { header: label('tpl_col_guidance'), field: 'text', width: 110 },
    ],
    rows: [
      ...(['CONSENT_PARTNER_OFFERS', 'CONSENT_HOMATCH_ONLY', 'LEGITIMATE_INTEREST', 'UNVERIFIED'] as const)
        .map((lb) => ({ topic: label(`lb_${lb}`), text: label(`lb_${lb}_desc`) })),
      ...[1, 2, 3, 4].map((n) => ({ topic: label(`tpl_c${n}_topic`), text: label(`tpl_c${n}`) })),
    ],
  };

  return [leads, instructions, columns, interests, geo, consent];
}

export function buildCuratedTemplate(label: Translate): Blob {
  return buildWorkbook(curatedTemplateSheets(label));
}
