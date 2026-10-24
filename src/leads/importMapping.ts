// ADMIN — External Leads Database import: column mapping and value resolution, in the browser.
//
// Pure (no React, no Supabase), so node:test can exercise it directly.
//
//   * Headers are matched to the canonical fields the server normalises (curated_normalise_row)
//     by synonyms in English, Georgian, Russian, Turkish, Arabic and Hebrew. A field is taken by
//     the first column that names it; every mapping stays editable in the UI.
//   * Country: the server accepts ISO 3166-1 alpha-2 only. Names in any of the six languages (and
//     English), alpha-2 and alpha-3 codes are resolved here; anything unresolvable is sent AS
//     TYPED, so the server flags COUNTRY_INVALID instead of this file guessing.
//   * Languages: ISO-639 codes pass through; language names are resolved the same way. A
//     language is never derived from the country — an empty cell stays empty (unknown).
//   * Interests are sent as typed: the server owns the six-language interest synonyms.
import type { CanonicalField, CanonicalRow } from '@/services/curatedLeadsAdmin';

export const IMPORT_LOCALES = ['en', 'ka', 'ru', 'tr', 'ar', 'he'] as const;

/** Mirrors REQUIRED_FIELDS in services/curatedLeadsAdmin.ts (kept here so this module stays pure). */
export const REQUIRED_IMPORT_FIELDS: readonly CanonicalField[] = ['first_name', 'last_name', 'email', 'interests', 'country'];

/** Every canonical field, with the header words that mean it. The field code itself always matches. */
export const HEADER_SYNONYMS: Record<CanonicalField, readonly string[]> = {
  first_name: ['first name', 'firstname', 'given name', 'forename', 'სახელი', 'имя', 'ad', 'isim', 'الاسم الأول', 'الاسم', 'שם פרטי'],
  last_name: ['last name', 'lastname', 'surname', 'family name', 'გვარი', 'фамилия', 'soyad', 'soyadı', 'soyisim', 'اسم العائلة', 'الكنية', 'שם משפחה'],
  email: ['email', 'e-mail', 'mail', 'email address', 'ელფოსტა', 'ელ-ფოსტა', 'ელ. ფოსტა', 'იმეილი', 'почта', 'электронная почта', 'эл. почта', 'e-posta', 'eposta', 'البريد الإلكتروني', 'البريد', 'ايميل', 'דוא"ל', 'דואל', 'אימייל', 'מייל'],
  interests: ['interests', 'interest', 'intent', 'goal', 'ინტერესი', 'ინტერესები', 'მიზანი', 'интерес', 'интересы', 'цель', 'ilgi', 'ilgi alanı', 'amaç', 'الاهتمام', 'الاهتمامات', 'اهتمام', 'תחום עניין', 'עניין', 'מטרה'],
  country: ['country', 'country code', 'nation', 'ქვეყანა', 'страна', 'ülke', 'ulke', 'الدولة', 'البلد', 'מדינה', 'ארץ'],
  languages: ['languages', 'language', 'lang', 'spoken languages', 'ენა', 'ენები', 'язык', 'языки', 'dil', 'diller', 'اللغة', 'اللغات', 'שפה', 'שפות'],
  category: ['category', 'segment', 'client type', 'კატეგორია', 'категория', 'kategori', 'الفئة', 'קטגוריה'],
  phone: ['phone', 'telephone', 'tel', 'mobile', 'cell', 'phone number', 'ტელეფონი', 'ტელ', 'მობილური', 'телефон', 'мобильный', 'тел', 'telefon', 'cep', 'الهاتف', 'هاتف', 'جوال', 'טלפון', 'נייד'],
  whatsapp: ['whatsapp', 'wa', 'ვოთსაპი', 'ვატსაპი', 'ватсап', 'вотсап', 'واتساب', 'וואטסאפ'],
  telegram: ['telegram', 'tg', 'ტელეგრამი', 'телеграм', 'телеграмм', 'تيليجرام', 'تلغرام', 'טלגרם'],
  facebook: ['facebook', 'fb', 'ფეისბუქი', 'фейсбук', 'فيسبوك', 'פייסבוק'],
  linkedin: ['linkedin', 'ლინკედინი', 'линкедин', 'لينكدإن', 'לינקדאין'],
  other_social: ['other social', 'social', 'social media', 'instagram', 'სოციალური ქსელი', 'соцсеть', 'соцсети', 'sosyal medya', 'وسائل التواصل', 'רשת חברתית'],
  city: ['city', 'town', 'ქალაქი', 'город', 'şehir', 'sehir', 'المدينة', 'עיר'],
  region: ['region', 'state', 'province', 'რეგიონი', 'регион', 'область', 'bölge', 'المنطقة', 'אזור', 'מחוז'],
  preferred_location: ['preferred location', 'location', 'desired location', 'სასურველი ლოკაცია', 'ლოკაცია', 'მდებარეობა', 'желаемое расположение', 'локация', 'район', 'tercih edilen konum', 'konum', 'الموقع المفضل', 'الموقع', 'מיקום מועדף', 'מיקום'],
  budget_min: ['budget min', 'min budget', 'minimum budget', 'budget from', 'მინიმალური ბიუჯეტი', 'ბიუჯეტი მინ', 'бюджет от', 'мин бюджет', 'минимальный бюджет', 'min bütçe', 'minimum bütçe', 'الحد الأدنى للميزانية', 'תקציב מינימלי'],
  budget_max: ['budget max', 'max budget', 'maximum budget', 'budget', 'budget to', 'ბიუჯეტი', 'მაქსიმალური ბიუჯეტი', 'ბიუჯეტი მაქს', 'бюджет', 'бюджет до', 'макс бюджет', 'bütçe', 'max bütçe', 'الميزانية', 'الحد الأقصى للميزانية', 'תקציב', 'תקציב מקסימלי'],
  currency: ['currency', 'curr', 'ვალუტა', 'валюта', 'para birimi', 'döviz', 'العملة', 'מטבע'],
  property_type: ['property type', 'type', 'object type', 'ქონების ტიპი', 'უძრავი ქონების ტიპი', 'ტიპი', 'тип недвижимости', 'тип объекта', 'тип', 'mülk tipi', 'emlak tipi', 'نوع العقار', 'סוג נכס'],
  area_min: ['area min', 'min area', 'minimum area', 'area from', 'მინიმალური ფართი', 'ფართი მინ', 'площадь от', 'мин площадь', 'min alan', 'المساحة الدنيا', 'שטח מינימלי'],
  area_max: ['area max', 'max area', 'maximum area', 'area', 'ფართი', 'ფართობი', 'площадь', 'площадь до', 'alan', 'max alan', 'المساحة', 'שטח', 'שטח מקסימלי'],
  rooms_min: ['rooms min', 'min rooms', 'rooms from', 'ოთახები მინ', 'комнат от', 'мин комнат', 'min oda', 'الحد الأدنى للغرف', 'חדרים מינימום'],
  rooms_max: ['rooms max', 'max rooms', 'rooms', 'ოთახები', 'ოთახი', 'комнаты', 'комнат', 'oda', 'oda sayısı', 'الغرف', 'عدد الغرف', 'חדרים'],
  investment_prefs: ['investment preferences', 'investment prefs', 'ინვესტიციის პრეფერენციები', 'инвестиционные предпочтения', 'yatırım tercihleri', 'تفضيلات الاستثمار', 'העדפות השקעה'],
  description: ['description', 'comment', 'comments', 'request', 'აღწერა', 'კომენტარი', 'описание', 'комментарий', 'açıklama', 'yorum', 'الوصف', 'تعليق', 'תיאור', 'הערה'],
  source_description: ['source', 'source description', 'lead source', 'წყარო', 'источник', 'kaynak', 'المصدر', 'מקור'],
  collected_at: ['collected at', 'collected', 'date collected', 'collection date', 'შეგროვების თარიღი', 'дата сбора', 'toplama tarihi', 'تاريخ الجمع', 'תאריך איסוף'],
  last_verified_at: ['last verified', 'last verified at', 'verified at', 'verification date', 'ბოლო გადამოწმება', 'дата проверки', 'последняя проверка', 'son doğrulama', 'آخر تحقق', 'אומת לאחרונה'],
  tags: ['tags', 'tag', 'labels', 'თეგები', 'ტეგები', 'теги', 'метки', 'etiketler', 'الوسوم', 'תגיות'],
  admin_notes: ['admin notes', 'notes', 'internal notes', 'შენიშვნები', 'заметки', 'примечания', 'notlar', 'ملاحظات', 'הערות'],
};

export const IMPORT_FIELDS = Object.keys(HEADER_SYNONYMS) as CanonicalField[];

/** Case, accents, spacing and punctuation never decide a match. */
export function normaliseHeader(value: string): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[\s_\-.\/\\()[\]{}*#:"'’`«»|,;]+/g, '');
}

const HEADER_INDEX: Map<string, CanonicalField> = (() => {
  const index = new Map<string, CanonicalField>();
  for (const field of IMPORT_FIELDS) {
    for (const word of [field, ...HEADER_SYNONYMS[field]]) {
      const key = normaliseHeader(word);
      if (key && !index.has(key)) index.set(key, field);
    }
  }
  return index;
})();

export function fieldForHeader(header: string): CanonicalField | null {
  return HEADER_INDEX.get(normaliseHeader(header)) ?? null;
}

/** One entry per column: the field it feeds, or null (ignored). No field is fed twice. */
export type ColumnMapping = Array<CanonicalField | null>;

export function autoMapHeaders(headers: readonly string[]): ColumnMapping {
  const taken = new Set<CanonicalField>();
  return headers.map((h) => {
    const field = fieldForHeader(h);
    if (!field || taken.has(field)) return null;
    taken.add(field);
    return field;
  });
}

/** Assign a column; the field leaves whichever column held it before. */
export function assignColumn(mapping: ColumnMapping, column: number, field: CanonicalField | null): ColumnMapping {
  return mapping.map((f, i) => (i === column ? field : field && f === field ? null : f));
}

export function missingRequired(mapping: ColumnMapping): CanonicalField[] {
  return REQUIRED_IMPORT_FIELDS.filter((f) => !mapping.includes(f));
}

/* ── countries ───────────────────────────────────────────────────────────── */

/** ISO 3166-1 alpha-3 → alpha-2. */
const ISO3 = 'AFG:AF,ALA:AX,ALB:AL,DZA:DZ,ASM:AS,AND:AD,AGO:AO,AIA:AI,ATA:AQ,ATG:AG,ARG:AR,ARM:AM,ABW:AW,AUS:AU,AUT:AT,AZE:AZ,'
  + 'BHS:BS,BHR:BH,BGD:BD,BRB:BB,BLR:BY,BEL:BE,BLZ:BZ,BEN:BJ,BMU:BM,BTN:BT,BOL:BO,BES:BQ,BIH:BA,BWA:BW,BVT:BV,BRA:BR,'
  + 'IOT:IO,BRN:BN,BGR:BG,BFA:BF,BDI:BI,CPV:CV,KHM:KH,CMR:CM,CAN:CA,CYM:KY,CAF:CF,TCD:TD,CHL:CL,CHN:CN,CXR:CX,CCK:CC,'
  + 'COL:CO,COM:KM,COG:CG,COD:CD,COK:CK,CRI:CR,CIV:CI,HRV:HR,CUB:CU,CUW:CW,CYP:CY,CZE:CZ,DNK:DK,DJI:DJ,DMA:DM,DOM:DO,'
  + 'ECU:EC,EGY:EG,SLV:SV,GNQ:GQ,ERI:ER,EST:EE,SWZ:SZ,ETH:ET,FLK:FK,FRO:FO,FJI:FJ,FIN:FI,FRA:FR,GUF:GF,PYF:PF,ATF:TF,'
  + 'GAB:GA,GMB:GM,GEO:GE,DEU:DE,GHA:GH,GIB:GI,GRC:GR,GRL:GL,GRD:GD,GLP:GP,GUM:GU,GTM:GT,GGY:GG,GIN:GN,GNB:GW,GUY:GY,'
  + 'HTI:HT,HMD:HM,VAT:VA,HND:HN,HKG:HK,HUN:HU,ISL:IS,IND:IN,IDN:ID,IRN:IR,IRQ:IQ,IRL:IE,IMN:IM,ISR:IL,ITA:IT,JAM:JM,'
  + 'JPN:JP,JEY:JE,JOR:JO,KAZ:KZ,KEN:KE,KIR:KI,PRK:KP,KOR:KR,KWT:KW,KGZ:KG,LAO:LA,LVA:LV,LBN:LB,LSO:LS,LBR:LR,LBY:LY,'
  + 'LIE:LI,LTU:LT,LUX:LU,MAC:MO,MDG:MG,MWI:MW,MYS:MY,MDV:MV,MLI:ML,MLT:MT,MHL:MH,MTQ:MQ,MRT:MR,MUS:MU,MYT:YT,MEX:MX,'
  + 'FSM:FM,MDA:MD,MCO:MC,MNG:MN,MNE:ME,MSR:MS,MAR:MA,MOZ:MZ,MMR:MM,NAM:NA,NRU:NR,NPL:NP,NLD:NL,NCL:NC,NZL:NZ,NIC:NI,'
  + 'NER:NE,NGA:NG,NIU:NU,NFK:NF,MKD:MK,MNP:MP,NOR:NO,OMN:OM,PAK:PK,PLW:PW,PSE:PS,PAN:PA,PNG:PG,PRY:PY,PER:PE,PHL:PH,'
  + 'PCN:PN,POL:PL,PRT:PT,PRI:PR,QAT:QA,REU:RE,ROU:RO,RUS:RU,RWA:RW,BLM:BL,SHN:SH,KNA:KN,LCA:LC,MAF:MF,SPM:PM,VCT:VC,'
  + 'WSM:WS,SMR:SM,STP:ST,SAU:SA,SEN:SN,SRB:RS,SYC:SC,SLE:SL,SGP:SG,SXM:SX,SVK:SK,SVN:SI,SLB:SB,SOM:SO,ZAF:ZA,SGS:GS,'
  + 'SSD:SS,ESP:ES,LKA:LK,SDN:SD,SUR:SR,SJM:SJ,SWE:SE,CHE:CH,SYR:SY,TWN:TW,TJK:TJ,TZA:TZ,THA:TH,TLS:TL,TGO:TG,TKL:TK,'
  + 'TON:TO,TTO:TT,TUN:TN,TUR:TR,TKM:TM,TCA:TC,TUV:TV,UGA:UG,UKR:UA,ARE:AE,GBR:GB,USA:US,UMI:UM,URY:UY,UZB:UZ,VUT:VU,'
  + 'VEN:VE,VNM:VN,VGB:VG,VIR:VI,WLF:WF,ESH:EH,YEM:YE,ZMB:ZM,ZWE:ZW,XKX:XK';

/** Everyday English forms Intl does not produce. */
const COUNTRY_ALIASES: Record<string, string> = {
  usa: 'US', america: 'US', 'united states of america': 'US', uk: 'GB', england: 'GB', scotland: 'GB', wales: 'GB',
  'great britain': 'GB', britain: 'GB', turkey: 'TR', turkiye: 'TR', 'czech republic': 'CZ', holland: 'NL',
  uae: 'AE', emirates: 'AE', 'south korea': 'KR', korea: 'KR', 'north korea': 'KP', 'ivory coast': 'CI',
  russia: 'RU', 'russian federation': 'RU', persia: 'IR', burma: 'MM', 'republic of georgia': 'GE', sakartvelo: 'GE',
  macedonia: 'MK', moldova: 'MD', 'vatican city': 'VA', palestine: 'PS', swaziland: 'SZ', 'cape verde': 'CV',
};

const countryKey = (v: string) => normaliseHeader(v).replace(/^the/, '');

export type ValueResolver = (value: string) => string;

/**
 * A resolver over the given alpha-2 codes. `codes` is passed in (the UI uses the phone metadata's
 * full list, src/lib/comm/countries.ts) so this module carries no dependency.
 */
export function buildCountryResolver(codes: readonly string[], locales: readonly string[] = IMPORT_LOCALES): ValueResolver {
  const known = new Set(codes.map((c) => c.toUpperCase()));
  const index = new Map<string, string>();
  const put = (name: string | undefined, code: string) => {
    if (!name) return;
    const key = countryKey(name);
    if (key && !index.has(key)) index.set(key, code);
  };
  for (const locale of locales) {
    let names: Intl.DisplayNames | null = null;
    try { names = new Intl.DisplayNames([locale], { type: 'region' }); } catch { names = null; }
    if (!names) continue;
    for (const code of known) {
      try {
        const name = names.of(code);
        if (name && name !== code) put(name, code);
      } catch { /* a code this runtime cannot name */ }
    }
  }
  for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) put(alias, code);
  const iso3 = new Map(ISO3.split(',').map((pair) => pair.split(':') as [string, string]));

  return (value: string) => {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const upper = raw.toUpperCase();
    if (/^[A-Z]{2}$/.test(upper)) return upper === 'UK' ? 'GB' : upper;
    if (/^[A-Z]{3}$/.test(upper) && iso3.has(upper)) return iso3.get(upper) as string;
    return index.get(countryKey(raw)) ?? raw;
  };
}

/* ── languages ───────────────────────────────────────────────────────────── */

export const COMMON_LANGUAGE_CODES = [
  'en', 'ka', 'ru', 'tr', 'ar', 'he', 'uk', 'az', 'hy', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'cs', 'sk', 'hu', 'ro',
  'bg', 'el', 'sr', 'hr', 'sl', 'bs', 'mk', 'sq', 'be', 'kk', 'uz', 'ky', 'tk', 'tg', 'mn', 'lt', 'lv', 'et', 'fi', 'sv',
  'no', 'da', 'is', 'ga', 'fa', 'ku', 'ps', 'ur', 'hi', 'bn', 'pa', 'ta', 'te', 'zh', 'ja', 'ko', 'th', 'vi', 'id', 'ms',
  'tl', 'sw', 'am', 'yi',
] as const;

const LANGUAGE_CODE = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/;

/** Codes pass through (lower-cased), names become codes, anything else stays as typed. */
export function buildLanguageResolver(codes: readonly string[] = COMMON_LANGUAGE_CODES, locales: readonly string[] = IMPORT_LOCALES): ValueResolver {
  const index = new Map<string, string>();
  for (const locale of locales) {
    let names: Intl.DisplayNames | null = null;
    try { names = new Intl.DisplayNames([locale], { type: 'language' }); } catch { names = null; }
    if (!names) continue;
    for (const code of codes) {
      try {
        const name = names.of(code);
        const key = name ? normaliseHeader(name) : '';
        if (key && name !== code && !index.has(key)) index.set(key, code);
      } catch { /* unnamed */ }
    }
  }
  return (value: string) => {
    const tokens = String(value ?? '').split(/\s*[,;/|]\s*/).map((t) => t.trim()).filter(Boolean);
    return tokens.map((token) => {
      const lower = token.toLowerCase();
      if (LANGUAGE_CODE.test(lower)) return lower;
      return index.get(normaliseHeader(token)) ?? token;
    }).join(', ');
  };
}

/* ── rows ────────────────────────────────────────────────────────────────── */

export interface MappedRow {
  /** The row's number in the file (the header is row 1). */
  rowNo: number;
  data: CanonicalRow;
  /** The row as uploaded, by original header (non-empty cells only). */
  raw: Record<string, string>;
}

export function mapRows(headers: readonly string[], rows: readonly string[][], mapping: ColumnMapping,
  resolve: { country?: ValueResolver; languages?: ValueResolver } = {}): MappedRow[] {
  const out: MappedRow[] = [];
  rows.forEach((row, i) => {
    if (!row.some((c) => String(c ?? '').trim())) return;
    const data: CanonicalRow = {};
    const raw: Record<string, string> = {};
    headers.forEach((h, col) => {
      const cell = String(row[col] ?? '').trim();
      if (!cell) return;
      raw[h || `column_${col + 1}`] = cell;
      const field = mapping[col];
      if (!field) return;
      if (field === 'country' && resolve.country) data.country = resolve.country(cell);
      else if (field === 'languages' && resolve.languages) data.languages = resolve.languages(cell);
      else data[field] = cell;
    });
    out.push({ rowNo: i + 2, data, raw });
  });
  return out;
}

/** Country values that did not become an ISO-2 code (the server will mark those rows). */
export function unresolvedCountries(rows: readonly MappedRow[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) {
    const c = r.data.country;
    if (c && !/^[A-Z]{2}$/.test(c)) seen.add(c);
  }
  return [...seen];
}

/** Rows still carrying the template's example addresses. */
export function exampleRowCount(rows: readonly MappedRow[]): number {
  return rows.filter((r) => /@example\.(com|org|net)$/i.test(r.data.email ?? '')).length;
}
