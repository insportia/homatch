// HOMATCH Communications — working out what a customer's spreadsheet columns mean.
//
// §14: phone is the only required field, and Homatch "automatically detects
// names, surnames, emails and phone numbers and ignores unrelated columns
// unless you choose to keep them". A Georgian agency's export has headers in
// Georgian; a Russian-speaking one's has them in Russian; a developer's CRM
// export has them in English with underscores. All three must land correctly
// with nobody mapping columns by hand.
//
// HOW IT DECIDES, AND WHY IT IS NOT A MODEL
//
// Three deterministic passes per column, strongest first: an exact match on a
// known label, a match after normalisation, then a contains-match on a
// distinctive token. That is §7's rule applied literally — this is a lookup
// problem with a known answer set, and an LLM here would cost money per import
// to be less predictable than a dictionary.
//
// The fourth pass is the one that earns its keep: when the HEADER is
// unrecognised, the column's DATA is inspected. A column called "მობ." with
// 400 values that all parse as phone numbers is a phone column, whatever it is
// called. That is also what catches a sheet with no header row at all.

export type ContactField =
  | 'phone' | 'first_name' | 'last_name' | 'full_name' | 'email' | 'company'
  | 'country' | 'language' | 'city' | 'budget_min' | 'budget_max' | 'notes';

export interface DetectedColumn {
  index: number;
  header: string;
  field: ContactField | null;
  confidence: 'EXACT' | 'STRONG' | 'LIKELY' | 'FROM_DATA' | 'NONE';
  /** Kept as a custom field rather than dropped, if the user asks for it. */
  keepAsCustom: boolean;
}

/**
 * Known labels, per field, across Homatch's locales plus the shapes CRM
 * exports actually use. Lowercased and normalised at match time, so
 * "First Name", "first_name" and "FIRSTNAME" are one entry.
 */
const LABELS: Record<ContactField, string[]> = {
  phone: [
    'phone', 'phonenumber', 'phone number', 'mobile', 'mobilephone', 'cell', 'cellphone',
    'tel', 'telephone', 'msisdn', 'whatsapp', 'whatsappnumber', 'contactnumber', 'number',
    // Georgian
    'ტელეფონი', 'მობილური', 'ტელ', 'მობ', 'ნომერი', 'ტელეფონისნომერი', 'მობილურისნომერი',
    // Russian
    'телефон', 'мобильный', 'моб', 'тел', 'номер', 'номертелефона', 'сотовый',
    // Turkish / Arabic / Hebrew
    'telefon', 'cep', 'ceptelefonu', 'هاتف', 'جوال', 'رقمالهاتف', 'טלפון', 'נייד',
  ],
  first_name: [
    'firstname', 'first name', 'first', 'givenname', 'given name', 'forename', 'fname',
    'სახელი', 'имя', 'ad', 'isim', 'الاسم', 'الاسمالاول', 'שםפרטי',
  ],
  last_name: [
    'lastname', 'last name', 'last', 'surname', 'familyname', 'family name', 'lname', 'secondname',
    'გვარი', 'фамилия', 'soyad', 'soyadi', 'اللقب', 'اسمالعائلة', 'שםמשפחה',
  ],
  full_name: [
    'name', 'fullname', 'full name', 'contact', 'contactname', 'client', 'customer', 'clientname',
    'სრულისახელი', 'სახელიდაგვარი', 'კლიენტი', 'კონტაქტი',
    'фио', 'полноеимя', 'имяифамилия', 'клиент', 'контакт',
    'adsoyad', 'isimsoyisim', 'الاسمالكامل', 'שםמלא',
  ],
  email: [
    'email', 'e-mail', 'emailaddress', 'email address', 'mail', 'mailaddress',
    'ელფოსტა', 'ელ.ფოსტა', 'ელფოსტისმისამართი', 'მეილი',
    'почта', 'электроннаяпочта', 'емейл', 'эл.почта',
    'eposta', 'e-posta', 'البريدالالكتروني', 'ايميل', 'אימייל', 'דואראלקטרוני',
  ],
  company: [
    'company', 'companyname', 'organisation', 'organization', 'org', 'business', 'firm', 'agency',
    'კომპანია', 'ორგანიზაცია', 'ფირმა',
    'компания', 'организация', 'фирма',
    'sirket', 'şirket', 'firma', 'الشركة', 'חברה',
  ],
  country: [
    'country', 'countrycode', 'nation',
    'ქვეყანა', 'страна', 'ulke', 'ülke', 'الدولة', 'מדינה',
  ],
  language: [
    'language', 'lang', 'locale', 'preferredlanguage',
    'ენა', 'язык', 'dil', 'اللغة', 'שפה',
  ],
  city: [
    'city', 'town', 'location', 'region', 'district', 'area',
    'ქალაქი', 'რაიონი', 'ლოკაცია', 'უბანი',
    'город', 'регион', 'район', 'sehir', 'şehir', 'المدينة', 'עיר',
  ],
  budget_min: [
    'budgetmin', 'minbudget', 'budget from', 'budgetfrom', 'pricefrom', 'minprice',
    'ბიუჯეტიდან', 'мин.бюджет', 'бюджетот',
  ],
  budget_max: [
    'budget', 'budgetmax', 'maxbudget', 'budget to', 'budgetto', 'priceto', 'maxprice', 'price',
    'ბიუჯეტი', 'ფასი', 'бюджет', 'цена', 'butce', 'bütçe', 'الميزانية', 'תקציב',
  ],
  notes: [
    'notes', 'note', 'comment', 'comments', 'remark', 'remarks', 'description',
    'შენიშვნა', 'კომენტარი', 'აღწერა',
    'заметка', 'комментарий', 'примечание', 'описание',
    'not', 'aciklama', 'ملاحظات', 'הערות',
  ],
};

/**
 * Tokens distinctive enough that finding one INSIDE a longer header is
 * evidence. Deliberately excludes short, ambiguous words: "name" is not here
 * because "Company name" would then be a full_name, and "no" is not here
 * because it appears in half the Turkish alphabet.
 */
const CONTAINS: Array<[ContactField, string[]]> = [
  ['phone', ['phone', 'mobile', 'whatsapp', 'ტელეფონ', 'მობილურ', 'телефон', 'мобильн', 'telefon', 'هاتف', 'טלפון']],
  ['email', ['email', 'e-mail', 'ელფოსტ', 'почт', 'posta', 'بريد', 'אימייל']],
  ['first_name', ['firstname', 'first_name', 'given', 'სახელი', 'имя']],
  ['last_name', ['lastname', 'last_name', 'surname', 'გვარი', 'фамили', 'soyad']],
  ['company', ['company', 'კომპან', 'компан', 'şirket', 'sirket']],
  ['country', ['country', 'ქვეყან', 'стран', 'ülke', 'ulke']],
  ['city', ['city', 'ქალაქ', 'город', 'şehir', 'sehir']],
  ['budget_max', ['budget', 'ბიუჯეტ', 'бюджет', 'bütçe', 'butce']],
];

/**
 * Normalise a header for comparison: lowercase, drop separators and
 * punctuation, collapse whitespace. Georgian, Cyrillic, Arabic and Hebrew
 * letters survive; "First Name", "first_name" and "first-name" become one
 * string.
 */
export function normalizeHeader(raw: string): string {
  return String(raw ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\s_\-.()[\]{}:;,/\\*#'"`]+/g, '')
    .trim();
}

const EXACT_INDEX: Map<string, ContactField> = (() => {
  const m = new Map<string, ContactField>();
  // Built in declaration order, and first writer wins, so a label listed under
  // two fields resolves to the earlier one deterministically rather than to
  // whichever happened to be iterated last.
  for (const field of Object.keys(LABELS) as ContactField[]) {
    for (const label of LABELS[field]) {
      const key = normalizeHeader(label);
      if (!m.has(key)) m.set(key, field);
    }
  }
  return m;
})();

/** Match one header on its text alone. */
export function detectHeader(header: string): { field: ContactField | null; confidence: DetectedColumn['confidence'] } {
  const norm = normalizeHeader(header);
  if (!norm) return { field: null, confidence: 'NONE' };

  const exact = EXACT_INDEX.get(norm);
  if (exact) return { field: exact, confidence: 'EXACT' };

  for (const [field, tokens] of CONTAINS) {
    for (const token of tokens) {
      if (norm.includes(normalizeHeader(token))) return { field, confidence: 'STRONG' };
    }
  }
  return { field: null, confidence: 'NONE' };
}

/** Is this single cell a phone number or an email address? */
function looksLikeContactValue(cell: string): boolean {
  const v = String(cell ?? '').trim();
  if (!v) return false;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return true;
  const digits = v.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 && /^[+\d\s()\-.]+$/.test(v);
}

/** Does this column's DATA look like phone numbers / emails, whatever it is called? */
export function detectFromSample(values: string[]): ContactField | null {
  const sample = values.map((v) => String(v ?? '').trim()).filter(Boolean).slice(0, 50);
  if (sample.length < 3) return null;

  const emailish = sample.filter((v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)).length;
  if (emailish / sample.length >= 0.7) return 'email';

  // Phone-shaped: mostly digits, 7-15 of them, not a date, not a price.
  const phoneish = sample.filter((v) => {
    if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(v)) return false;   // a date
    if (/[$€₾]|usd|gel|eur/i.test(v)) return false;                   // a price
    const digits = v.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) return false;
    // Anything that is not a digit or ordinary phone punctuation disqualifies it.
    return /^[+\d\s()\-.]+$/.test(v);
  }).length;
  if (phoneish / sample.length >= 0.7) return 'phone';

  return null;
}

export interface DetectionResult {
  columns: DetectedColumn[];
  /** True when no column could be resolved to a phone. The import cannot proceed. */
  missingPhone: boolean;
  /** Headers that looked like data, i.e. the sheet probably has no header row. */
  headerRowLooksLikeData: boolean;
}

/**
 * Map a whole sheet.
 *
 * `rows` are the data rows under `headers`, used only for the data-shape pass
 * and only for columns the header pass could not place.
 */
export function detectColumns(headers: string[], rows: string[][] = []): DetectionResult {
  const taken = new Set<ContactField>();
  const columns: DetectedColumn[] = headers.map((header, index) => ({
    index, header: String(header ?? ''), field: null, confidence: 'NONE' as const, keepAsCustom: false,
  }));

  // Pass 1 and 2: the header text. Exact wins over contains, and a field is
  // claimed once — a sheet with "Phone" and "Phone 2" must not produce two
  // phone columns silently overwriting each other.
  for (const pass of ['EXACT', 'STRONG'] as const) {
    for (const col of columns) {
      if (col.field) continue;
      const { field, confidence } = detectHeader(col.header);
      if (field && confidence === pass && !taken.has(field)) {
        col.field = field;
        col.confidence = confidence;
        taken.add(field);
      }
    }
  }

  // Pass 3: the data. Only for columns still unplaced, and only for the two
  // fields whose shape is genuinely recognisable.
  for (const col of columns) {
    if (col.field) continue;
    const values = rows.map((r) => r?.[col.index] ?? '');
    const guessed = detectFromSample(values);
    if (guessed && !taken.has(guessed)) {
      col.field = guessed;
      col.confidence = 'FROM_DATA';
      taken.add(guessed);
    }
  }

  // Anything left is an unrelated column. §14 says ignore it unless the user
  // chooses to keep it, so it is offered, not dropped and not imported.
  for (const col of columns) {
    if (!col.field && col.header.trim()) col.keepAsCustom = false;
  }

  // A "header" row whose own cells ARE contact data means the file has no
  // header row, and row 1 is a real contact that would otherwise be eaten.
  //
  // Asked per CELL, not over the row as a whole. Handing the header row to
  // detectFromSample treats it as one column and needs 70% of its cells to
  // look alike — which a normal three-column sheet, with one phone cell among
  // three, can never reach. So the check could not fire at all.
  const headerRowLooksLikeData =
    headers.some(looksLikeContactValue) && columns.every((c) => c.confidence !== 'EXACT');

  return { columns, missingPhone: !taken.has('phone'), headerRowLooksLikeData };
}

/**
 * Build a contact from a row using a resolved mapping.
 *
 * full_name is split only when there is no first/last pair, and only on the
 * last space — "ნინო ბერიძე" gives Nino / Beridze, and "Anna Maria Rossi"
 * gives "Anna Maria" / "Rossi" rather than inventing a middle-name field
 * Homatch does not have.
 */
export function applyMapping(
  row: string[],
  columns: DetectedColumn[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const col of columns) {
    const value = String(row[col.index] ?? '').trim();
    if (!value) continue;
    if (col.field) out[col.field] = value;
    else if (col.keepAsCustom && col.header.trim()) out[`custom:${col.header.trim()}`] = value;
  }

  if (!out.first_name && !out.last_name && out.full_name) {
    const parts = out.full_name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      out.last_name = parts[parts.length - 1];
      out.first_name = parts.slice(0, -1).join(' ');
    } else {
      out.first_name = out.full_name;
    }
  }
  if (!out.full_name && (out.first_name || out.last_name)) {
    out.full_name = [out.first_name, out.last_name].filter(Boolean).join(' ');
  }
  return out;
}
