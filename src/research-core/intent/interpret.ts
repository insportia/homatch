// READING WHAT SOMEBODY MEANT, WITHOUT GUESSING WHO THEY MEANT IT ABOUT.
//
// This is the deterministic half of native intent. It decides the four things that make
// a signal safe to act on, and it decides them from structure rather than from a model:
//
//   ATTRIBUTION  whose intent is this — the author's, or somebody they mentioned
//   POLARITY     are they saying yes or no
//   STRENGTH     did they mean it as a rule or a preference
//   SCOPE        is this about one property or about everything they want
//
// WHY THESE FOUR ARE NOT LEFT TO A MODEL
//
// Each of them, got wrong, produces a specific harm that a customer sees:
//
//   "My brother is looking for a flat in Vake" read as SELF tells an owner that this
//   person is personally interested. They are not. They were talking about their brother.
//
//   "I'm not interested in this one any more" read as POSITIVE keeps a dead relationship
//   alive; read with the wrong SCOPE it cancels the customer's entire search.
//
//   "I'd prefer Vake" read as REQUIRED silently hides every flat outside one district
//   from somebody who said they had a preference.
//
// A language model is good at the semantics underneath these and bad at being audited.
// The structural markers ARE the semantics here — Georgian marks the first person in the
// verb, "აღარ" means "no longer", "აუცილებლად" means "necessarily" — so the reading is
// available without inference, and what is available without inference should not be
// inferred. Whatever a model contributes afterwards passes through validate() below,
// which is what makes model output non-authoritative in practice rather than in a comment.
//
// SCRIPT BOUNDARIES ARE NOT ASCII BOUNDARIES
//
// `\b` is defined on ASCII word characters and never matches between Georgian letters, so
// a `\b`-anchored pattern silently matches nothing in Georgian. Plain containment is the
// opposite trap: Russian "дом" sits inside "рядом". Every phrase test here uses Unicode
// letter lookaround, which is correct in both directions and in every script the product
// speaks.

/** Whose intent a sentence expresses. */
export type Attribution = 'SELF' | 'THIRD_PARTY' | 'QUOTED' | 'UNKNOWN';

/**
 * What kind of thing was said.
 *
 * Six, composed with a polarity and a dimension rather than enumerated per phrase. The
 * one that earns its place is OBJECTION: a complaint about a price is neither interest
 * nor rejection, and a model with only those two has to file it as one of them.
 */
export type IntentAct =
  /** States what somebody wants. Firmness says how hard; the resolver decides whether a
      later one refines an earlier one. */
  | 'REQUIREMENT'
  /** Positive about one specific thing. */
  | 'INTEREST'
  /** No longer wants one specific thing. */
  | 'REJECTION'
  /** A complaint about a dimension. Not interest, not rejection. */
  | 'OBJECTION'
  /** A question. Worth recording, worth nothing as evidence of commitment. */
  | 'INQUIRY'
  /** An explicit intent to transact. */
  | 'TRANSACTION_INTENT';

/** Which way an act points. Derived from the act, never from the sentence. */
export type Polarity = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';

/**
 * What a statement was about, in the matcher's own vocabulary.
 *
 * The same words assessMatch() reports agreements and misses in. A second vocabulary for
 * the same concepts is how two halves of one system stop being able to discuss a fact.
 */
export type IntentDimension =
  | 'PARTICIPANTS' | 'TRANSACTION' | 'CITY' | 'DISTRICT'
  | 'PROPERTY_TYPE' | 'PRICE' | 'AREA' | 'BEDROOMS';

/** One thing a message said. */
export interface Reading {
  act: IntentAct;
  polarity: Polarity;
  dimension: IntentDimension | null;
}

/** The sign every act carries. Fixed, so a row can never contradict itself. */
export function polarityFor(act: IntentAct): Polarity {
  if (act === 'INQUIRY') return 'NEUTRAL';
  if (act === 'REJECTION' || act === 'OBJECTION') return 'NEGATIVE';
  return 'POSITIVE';
}

/** How wide a statement reaches. */
export type IntentScope = 'PROPERTY' | 'SEARCH' | 'GENERAL';

/** The matcher's own vocabulary, repeated rather than imported to keep this module pure. */
export type Firmness = 'REQUIRED' | 'PREFERRED' | 'FLEXIBLE';

/**
 * A phrase, matched the way a reader would.
 *
 * Not preceded or followed by a letter, in any script. This is what `\b` would do if it
 * knew about Georgian, and what containment fails to do in Russian.
 */
function hasPhrase(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /*
   * ARABIC AND HEBREW WRITE SOME WORDS ONTO THE NEXT ONE.
   *
   * "and", "in", "to", "the" are single letters prefixed to the word they govern —
   * "وأبحث" is "and I am looking", "בוואקה" is "in Vake". A letter-boundary test on the
   * bare phrase would miss every one of them, so a phrase in either script may be
   * preceded by up to two of that script's clitic letters and nothing else.
   */
  const clitics = /^[\u0600-\u06FF]/.test(phrase)
    ? '(?:[وفبلك]{1,2})?'
    : /^[\u0590-\u05FF]/.test(phrase) ? '(?:[והשבלמכ]{1,2})?' : '';
  try {
    return new RegExp(`(?<!\\p{L})${clitics}${escaped}(?!\\p{L})`, 'iu').test(haystack);
  } catch {
    /* A runtime without lookbehind. Fall back to containment, which is wrong in the
       "дом in рядом" direction but never silently matches nothing. */
    return haystack.toLowerCase().includes(phrase.toLowerCase());
  }
}

const hasAny = (text: string, phrases: readonly string[]): boolean =>
  phrases.some((phrase) => hasPhrase(text, phrase));

/* ────────────────────────────────────────────────────────────────────────
 * Attribution
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Somebody else is the subject.
 *
 * Georgian and Russian both mark possession before the relation — "ჩემი მეგობარი",
 * "мой друг" — so the marker is the pair, not the noun. "მეგობარი" alone appears in
 * plenty of sentences that are about the author.
 */
const THIRD_PARTY_MARKERS: readonly string[] = [
  /* ka — my friend / my brother / my sister / an acquaintance of mine */
  'ჩემი მეგობარი', 'ჩემს მეგობარს', 'ჩემი ძმა', 'ჩემს ძმას', 'ჩემი და', 'ჩემს დას',
  'ჩემი ნაცნობი', 'ჩემს ნაცნობს', 'ჩემი კოლეგა', 'ნათესავი', 'მეგობარი ეძებს',
  /* ka — somebody, a person; a statement about the room rather than the speaker */
  'ვიღაც ეძებს', 'ერთი კაცი', 'ერთი გოგო',
  /* ru */
  'мой друг', 'моего друга', 'моему другу', 'мой брат', 'моя сестра', 'мой знакомый',
  'знакомому', 'коллега ищет', 'кто-то ищет',
  /* en */
  'my friend', 'my brother', 'my sister', 'my colleague', 'a friend of mine',
  'someone i know', 'my client', 'my mother', 'my father', 'my parents',
  /* tr */
  'arkadaşım', 'kardeşim', 'bir tanıdığım', 'annem', 'babam', 'müşterim', 'birisi arıyor',
  /* ar — my friend / my brother / my sister / my colleague / my client / somebody */
  'صديقي', 'صديق لي', 'أخي', 'اخي', 'أختي', 'اختي', 'زميلي', 'قريبي', 'أحد معارفي',
  'موكلي', 'عميلي', 'والدي', 'والدتي', 'أمي', 'أبي', 'شخص يبحث', 'أحدهم يبحث',
  /* he — my friend / my brother / my sister / my client / my parents / somebody */
  'חבר שלי', 'חברה שלי', 'אחי', 'אחותי', 'מכר שלי', 'הלקוח שלי', 'לקוח שלי',
  'אבא שלי', 'אמא שלי', 'ההורים שלי', 'קולגה שלי', 'מישהו מחפש',
];

/**
 * The author is the subject.
 *
 * Georgian marks the first person in the verb itself — ვ- prefixes and მ- objects — which
 * is a stronger signal than any pronoun, because Georgian routinely drops pronouns.
 */
const SELF_MARKERS: readonly string[] = [
  /* ka — I am looking / I want / I will buy / I will rent / it interests me */
  'ვეძებ', 'მინდა', 'მჭირდება', 'ვიყიდი', 'ვიქირავებ', 'მაინტერესებს', 'დამაინტერესა',
  'ვყიდი', 'ვაქირავებ', 'გავყიდი', 'ვნახავდი', 'ვიქნებოდი',
  /* ru */
  'ищу', 'хочу', 'мне нужна', 'мне нужен', 'куплю', 'сниму', 'меня интересует',
  'интересует меня', 'продаю', 'сдаю',
  /* en */
  "i'm looking", 'i am looking', 'looking for', 'i want', 'i need', "i'd like",
  'i am interested', "i'm interested", 'interested in', 'i am selling', "i'm selling",
  'i will buy', 'i will rent',
  /* tr */
  'arıyorum', 'istiyorum', 'satıyorum', 'kiralıyorum', 'ilgileniyorum', 'arıyoruz',
  /* ka / ru / en — the household "we" is the author speaking for their own purchase */
  'ვეძებთ', 'გვინდა', 'გვჭირდება', 'мы ищем', 'нам нужна', 'нам нужен',
  'we are looking', "we're looking", 'we want', 'we need',
  /* ar — I am looking for / I want / I need / I will buy / I am interested */
  'أبحث عن', 'ابحث عن', 'أبحث', 'نبحث عن', 'أريد', 'اريد', 'أحتاج', 'احتاج', 'نحتاج',
  'أرغب', 'ارغب', 'سأشتري', 'سأستأجر', 'أبيع', 'أؤجر', 'أنا مهتم', 'أنا مهتمة', 'يهمني',
  /* he — I am looking / I want / I need / I will buy / I will rent / I am interested */
  'אני מחפש', 'אני מחפשת', 'מחפש', 'מחפשת', 'אנחנו מחפשים', 'אני רוצה', 'אני צריך',
  'אני צריכה', 'אקנה', 'אשכור', 'אני מעוניין', 'אני מעוניינת', 'אני מוכר', 'אני מוכרת',
  /* "I can go to 180" — a first-person statement of what the author can do, in each language */
  'შემიძლია', 'შემეძლება', 'могу', 'смогу', 'i can', 'i could', "i can go", 'yapabilirim',
  'ödeyebilirim', 'أستطيع', 'يمكنني', 'بإمكاني', 'אני יכול', 'אני יכולה',
];

/**
 * Whose intent this is.
 *
 * THIRD_PARTY WINS OVER SELF, DELIBERATELY. "My brother is looking for a flat and I want
 * to help him" carries both markers, and the safe reading of an ambiguous sentence is the
 * one that does not tell an owner somebody is personally interested. The cost of being
 * wrong in this direction is a missed signal; in the other it is a false claim about a
 * person.
 *
 * `isQuoted` is not inferred from the text at all — the messaging schema knows. A live
 * chat message carries `reply_to_id`, and quoting somebody is a structural fact, not a
 * linguistic one.
 */
export function attributionOf(
  text: string,
  options: { isQuoted?: boolean } = {},
): Attribution {
  if (options.isQuoted) return 'QUOTED';
  const body = String(text ?? '');
  if (!body.trim()) return 'UNKNOWN';
  if (hasAny(body, THIRD_PARTY_MARKERS)) return 'THIRD_PARTY';
  if (hasAny(body, SELF_MARKERS)) return 'SELF';
  return 'UNKNOWN';
}

/* ────────────────────────────────────────────────────────────────────────
 * Polarity
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Saying no.
 *
 * Georgian has a dedicated word for "no longer" — აღარ — which is exactly the retraction
 * this needs to catch, and it is unambiguous in a way that English "not" is not.
 *
 * NOT INCLUDED, on purpose: "ძვირია" / "too expensive" / "дорого". A complaint about a
 * price is a real preference signal and it is not a withdrawal — somebody who says a flat
 * is expensive may still buy it, and reading that as a rejection would quietly delete a
 * live relationship.
 */
const NEGATIVE_MARKERS: readonly string[] = [
  /* ka — no longer wants / no longer interests me / does not interest me */
  'აღარ', 'არ მაინტერესებს', 'აღარ მაინტერესებს', 'აღარ მინდა', 'არ მინდა',
  'გავაუქმე', 'შევწყვიტე',
  /* ru */
  'больше не', 'уже не', 'не интересует', 'не нужна', 'не нужен', 'отменяю',
  /* en */
  'no longer', 'not interested', 'not anymore', 'not any more', 'never mind', 'cancel',
  /* tr */
  'artık', 'ilgilenmiyorum', 'istemiyorum', 'iptal',
  /* ar — no longer / not interested / I do not want / cancel */
  'لم أعد', 'لم يعد', 'لست مهتما', 'لست مهتمًا', 'لست مهتمة', 'غير مهتم', 'غير مهتمة',
  'لا أريد', 'لا يهمني', 'ألغي', 'إلغاء', 'الغاء',
  /* he — no longer / not interested / not relevant any more / I do not want / cancelling */
  'כבר לא', 'לא מעוניין', 'לא מעוניינת', 'לא רלוונטי', 'לא רוצה', 'מבטל', 'מבטלת',
];

/** Saying they like this particular thing. */
const INTEREST_MARKERS: readonly string[] = [
  /* ka */ 'მაინტერესებს', 'მომწონს', 'დამაინტერესა', 'მინდა ნახვა', 'ვნახავდი',
  /* ru */ 'интересует', 'нравится', 'хочу посмотреть',
  /* en */ 'interested', 'i like it', 'i like this', 'want to see', 'want to view',
  /* tr */ 'ilgileniyorum', 'beğendim', 'görmek istiyorum',
  /* ar */ 'يعجبني', 'أعجبني', 'اعجبني', 'تعجبني', 'أعجبتني', 'مهتم', 'مهتمة', 'أود رؤية', 'أريد رؤية', 'أريد مشاهدة',
  /* he */ 'מעוניין', 'מעוניינת', 'מוצא חן', 'מוצאת חן', 'אהבתי', 'רוצה לראות', 'אשמח לראות',
];

/** Asking a question. Worth recording; worth nothing as evidence of commitment. */
const INQUIRY_MARKERS: readonly string[] = [
  /* ka — how much is it / is it still for sale / what is the price */
  'რა ღირს', 'რამდენია', 'ჯერ კიდევ იყიდება', 'ჯერ კიდევ ხელმისაწვდომია', 'შესაძლებელია',
  /* ru */ 'сколько стоит', 'какая цена', 'ещё продаётся', 'еще продается', 'актуально',
  /* en */ 'how much', 'what is the price', 'still available', 'is it still',
  /* tr */ 'ne kadar', 'fiyatı ne', 'hâlâ satılık', 'hala satılık', 'hâlâ müsait',
  /* ar */ 'كم السعر', 'كم سعر', 'ما السعر', 'ما هو السعر', 'بكم', 'هل لا يزال', 'هل ما زال',
  'هل ما زالت', 'هل لا تزال',
  /* he */ 'כמה עולה', 'כמה זה עולה', 'כמה היא עולה', 'מה המחיר', 'עדיין רלוונטי', 'עדיין זמין', 'עדיין זמינה',
  'עדיין למכירה', 'עדיין פנוי', 'עדיין פנויה',
];

/** Saying they will transact. Stronger than interest and rarer than either. */
const TRANSACTION_MARKERS: readonly string[] = [
  /* ka — I will buy / I will rent / I am ready */
  'ვიყიდი', 'ვიქირავებ', 'მზად ვარ', 'გავაფორმებ',
  /* ru */ 'куплю', 'сниму', 'готов купить', 'готова купить',
  /* en */ 'i will buy', 'i will rent', 'ready to buy', 'ready to proceed',
  /* tr */ 'satın alacağım', 'kiralayacağım', 'hazırım',
  /* ar */ 'سأشتري', 'سأستأجر', 'جاهز للشراء', 'جاهزة للشراء', 'مستعد للشراء', 'مستعدة للشراء',
  /* he */ 'אקנה', 'אשכור', 'מוכן לקנות', 'מוכנה לקנות', 'מוכן לחתום', 'מוכנה לחתום',
];

/**
 * A complaint, and what it is about.
 *
 * PRICE is the one that actually occurs in the market and the one that was being
 * misread. The others are here because the shape has to be able to hold them — a
 * complaint about a district or a size is the same kind of statement.
 */
const OBJECTION_MARKERS: ReadonlyArray<readonly [IntentDimension, readonly string[]]> = [
  ['PRICE', [
    /* ka — it is expensive / too expensive / over my budget */
    'ძვირია', 'ძალიან ძვირი', 'ძვირად', 'ბიუჯეტს აღემატება',
    /* ru */ 'дорого', 'дороговато', 'слишком дорого', 'не по бюджету',
    /* en */ 'expensive', 'too expensive', 'over budget', 'pricey', 'too much money',
    /* tr */ 'pahalı', 'çok pahalı', 'bütçemi aşıyor',
    /* ar */ 'غالي', 'غالية', 'غالي جدا', 'السعر مرتفع', 'سعرها مرتفع', 'فوق ميزانيتي',
    'أعلى من ميزانيتي',
    /* he */ 'יקר', 'יקרה', 'יקר מדי', 'יקרה מדי', 'מעל התקציב', 'מעל התקציב שלי',
  ]],
  ['AREA', [
    /* ka — it is small / too small */
    'პატარაა', 'ძალიან პატარა', 'ვიწროა',
    /* ru */ 'маленькая', 'слишком маленькая', 'тесно',
    /* en */ 'too small', 'quite small', 'cramped',
    /* tr */ 'küçük', 'çok küçük',
    /* ar */ 'صغيرة', 'صغيرة جدا', 'صغير جدا', 'ضيقة',
    /* he */ 'קטנה', 'קטנה מדי', 'קטן מדי', 'צפופה',
  ]],
  ['DISTRICT', [
    /* ka — the district does not suit me / far */
    'რაიონი არ მომწონს', 'შორსაა', 'ძალიან შორს',
    /* ru */ 'район не нравится', 'далеко',
    /* en */ 'wrong area', 'too far', 'bad location',
    /* tr */ 'çok uzak', 'konum kötü',
    /* ar */ 'بعيدة جدا', 'بعيد جدا', 'المنطقة لا تعجبني', 'الموقع سيء',
    /* he */ 'רחוק מדי', 'רחוקה מדי', 'מיקום גרוע', 'השכונה לא מתאימה',
  ]],
];

/**
 * Everything one message said.
 *
 * PLURAL, AND THAT IS THE POINT. "მომწონს, მაგრამ ძვირია" — I like it, but it is
 * expensive — is an interest and a price objection. A reading that returned one act would
 * have to drop half the sentence, and whichever half it dropped would be wrong for
 * somebody.
 *
 * REJECTION SUPPRESSES INTEREST, because "ეს ძვირია, აღარ მაინტერესებს" ends with a
 * withdrawal and the earlier clause does not survive it. An objection does NOT suppress
 * interest and is not evidence of it either: the two are independent facts about the
 * same message, which is the whole correction this vocabulary exists to make.
 */
export function readingsOf(text: string): Reading[] {
  const body = String(text ?? '');
  const readings: Reading[] = [];
  const add = (act: IntentAct, dimension: IntentDimension | null = null) => {
    if (readings.some((r) => r.act === act && r.dimension === dimension)) return;
    readings.push({ act, polarity: polarityFor(act), dimension });
  };

  const rejected = hasAny(body, NEGATIVE_MARKERS);

  for (const [dimension, markers] of OBJECTION_MARKERS) {
    if (hasAny(body, markers)) add('OBJECTION', dimension);
  }
  if (rejected) add('REJECTION');
  /* An interest clause does not survive a withdrawal in the same message. */
  if (!rejected && hasAny(body, INTEREST_MARKERS)) add('INTEREST');
  if (!rejected && hasAny(body, TRANSACTION_MARKERS)) add('TRANSACTION_INTENT');
  if (hasAny(body, INQUIRY_MARKERS) || /\?\s*$/.test(body.trim())) add('INQUIRY');

  return readings;
}

/**
 * The sign of a message read as a single act.
 *
 * Kept because the validator needs a polarity and because a caller that has already
 * decided which act it is dealing with should not have to re-derive the sign. It is the
 * ACT's polarity, never a guess from the sentence — see polarityFor.
 */
export function polarityOf(text: string): Polarity {
  const readings = readingsOf(text);
  /* A withdrawal decides the message. Then a complaint. An inquiry with nothing else in
     it is neutral, which is the honest reading of a question. */
  const rejection = readings.find((r) => r.act === 'REJECTION');
  if (rejection) return rejection.polarity;
  const objection = readings.find((r) => r.act === 'OBJECTION');
  if (objection) return objection.polarity;
  const positive = readings.find((r) => r.polarity === 'POSITIVE');
  if (positive) return positive.polarity;
  return readings.length > 0 ? readings[0].polarity : 'POSITIVE';
}

/* ────────────────────────────────────────────────────────────────────────
 * Firmness — and it is not confidence
 * ──────────────────────────────────────────────────────────────────────── */

const REQUIRED_MARKERS: readonly string[] = [
  /* ka — necessarily / it is necessary / only / must */
  'აუცილებლად', 'აუცილებელია', 'მხოლოდ', 'უნდა იყოს', 'სხვა არ',
  /* ru */ 'обязательно', 'только', 'строго',
  /* en */ 'must', 'must be', 'only', 'definitely', 'strictly', 'required',
  /* tr */ 'kesinlikle', 'mutlaka', 'sadece',
  /* ar — necessarily / only / must */ 'ضروري', 'بالضرورة', 'فقط', 'يجب أن', 'لازم',
  /* he — must / only / necessarily / mandatory */ 'חייב', 'חייבת', 'רק', 'בהכרח', 'חובה',
];

const PREFERRED_MARKERS: readonly string[] = [
  /* ka — I prefer / it is desirable / if possible */
  'მირჩევნია', 'სასურველია', 'სასურველი', 'თუ შეიძლება', 'უკეთესი იქნება',
  /* ru */ 'желательно', 'предпочитаю', 'лучше', 'по возможности',
  /* en */ 'prefer', 'preferably', 'ideally', 'would like', 'nice to have',
  /* tr */ 'tercihen', 'tercih ederim', 'ideal olarak',
  /* ar — preferably / I prefer / if possible */ 'يفضل', 'ويفضل', 'أفضل', 'من الأفضل', 'إن أمكن', 'ان أمكن',
  /* he — preferably / I prefer / desirable / if possible */ 'עדיף', 'מעדיף', 'מעדיפה', 'רצוי', 'אם אפשר',
];

const FLEXIBLE_MARKERS: readonly string[] = [
  /* ka — does not matter to me / any / I am flexible */
  'არ მაქვს მნიშვნელობა', 'არ მაინტერესებს რომელი', 'ნებისმიერი', 'მოქნილი ვარ',
  /* ru */ 'не важно', 'неважно', 'любой', 'любая', 'без разницы',
  /* en */ 'does not matter', "doesn't matter", 'any', 'flexible', 'no preference',
  /* tr */ 'fark etmez', 'önemli değil', 'esnek',
  /* ar — it does not matter / flexible / no difference */ 'لا يهم', 'مرن', 'مرنة', 'لا فرق',
  /* he — does not matter / flexible / not important */ 'לא משנה', 'גמיש', 'גמישה', 'לא חשוב',
];

/**
 * How firmly somebody meant a requirement.
 *
 * THIS IS NOT HOW SURE WE ARE THAT THEY SAID IT. We can be certain — 0.99 confidence —
 * that a customer wrote "I'd prefer Vake", and Vake is still PREFERRED. Confidence is a
 * property of the reading; firmness is a property of the requirement. A pipeline that
 * multiplies one by the other, or stores one in the other's column, turns a confident
 * reading of a soft preference into a hard filter — and the customer never finds out why
 * they stopped being shown the right flats.
 *
 * REQUIRED is the default because that is what the matcher already assumes for a stated
 * constraint, and because the failure is visible: too few results is something a customer
 * reports, and silently too many is not.
 */
export function firmnessOf(text: string): Firmness {
  const body = String(text ?? '');
  /* Order matters. "I'd prefer three bedrooms, but I definitely need two" is preference
     about one thing and a rule about another; at sentence granularity the safe reading of
     a sentence carrying both is the softer one, because a wrong REQUIRED hides flats. */
  if (hasAny(body, FLEXIBLE_MARKERS)) return 'FLEXIBLE';
  if (hasAny(body, PREFERRED_MARKERS)) return 'PREFERRED';
  if (hasAny(body, REQUIRED_MARKERS)) return 'REQUIRED';
  return 'REQUIRED';
}

/* ────────────────────────────────────────────────────────────────────────
 * What it is about
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Six-digit sequences that could be a Homatch property reference.
 *
 * CANDIDATES, NOT RESOLUTIONS. A six-digit number in a sentence is a candidate and
 * nothing more — it could be a price, a postcode, a phone fragment or a date. The caller
 * verifies every one against the reference registry and discards what does not resolve.
 * Treating any six-digit number as a property id would let "I can go up to 220000" open
 * somebody else's listing.
 *
 * Bounded at four so a message of digits cannot turn into a hundred lookups.
 */
export function propertyReferenceCandidates(text: string): number[] {
  const body = String(text ?? '');
  const found: number[] = [];
  for (const match of body.matchAll(/(?<!\d)(\d{6})(?!\d)/g)) {
    const value = Number(match[1]);
    if (value >= 100000 && value <= 999999 && !found.includes(value)) found.push(value);
    if (found.length >= 4) break;
  }
  return found;
}

/**
 * How wide a statement reaches.
 *
 * DETERMINISTIC CONTEXT WINS. A message written inside a conversation that names a
 * property is about that property, and no amount of reading the sentence beats the
 * column that says so. Only when there is no such context does the text get a vote.
 */
export function scopeOf(
  text: string,
  context: { propertyId?: string | null; intentProfileId?: string | null } = {},
): IntentScope {
  if (context.propertyId) return 'PROPERTY';
  const body = String(text ?? '');
  /* "this flat", "this one" — a demonstrative with no property context is still about
     something specific, but we do not know what, so it cannot be promoted to GENERAL. */
  const demonstratives = [
    'ეს ბინა', 'ეს ქონება', 'эта квартира', 'this flat', 'this apartment', 'this property',
    'bu daire', 'bu ev', 'هذه الشقة', 'هذا العقار', 'הדירה הזאת', 'הדירה הזו', 'הנכס הזה',
  ];
  if (hasAny(body, demonstratives)) return 'PROPERTY';
  if (context.intentProfileId) return 'SEARCH';
  return 'GENERAL';
}

/* ────────────────────────────────────────────────────────────────────────
 * The gate
 * ──────────────────────────────────────────────────────────────────────── */

/** The taxonomies a candidate must speak. Wider than one surface, closed all the same. */
const SIDES = ['DEMAND', 'SUPPLY', 'PROPERTY_INTEREST'] as const;
const SCOPES = ['PROPERTY', 'SEARCH', 'GENERAL'] as const;
const ATTRIBUTIONS = ['SELF', 'THIRD_PARTY', 'QUOTED', 'UNKNOWN'] as const;
const POLARITIES = ['POSITIVE', 'NEGATIVE', 'NEUTRAL'] as const;
const ACTS = [
  'REQUIREMENT', 'INTEREST', 'REJECTION', 'OBJECTION', 'INQUIRY', 'TRANSACTION_INTENT',
] as const;
const DIMENSIONS = [
  'PARTICIPANTS', 'TRANSACTION', 'CITY', 'DISTRICT',
  'PROPERTY_TYPE', 'PRICE', 'AREA', 'BEDROOMS',
] as const;
const FIRMNESS = ['REQUIRED', 'PREFERRED', 'FLEXIBLE'] as const;
const SURFACES = ['LIVE_CHAT', 'PRIVATE_MESSAGE', 'VIEWING_REQUEST', 'SEARCH_PLAN', 'AI_CHAT'] as const;

export interface IntentCandidate {
  actorUserId?: unknown;
  sourceSurface?: unknown;
  sourceEventId?: unknown;
  sourceAt?: unknown;
  side?: unknown;
  act?: unknown;
  dimension?: unknown;
  polarity?: unknown;
  attribution?: unknown;
  explicit?: unknown;
  confidence?: unknown;
  scope?: unknown;
  propertyId?: unknown;
  intentProfileId?: unknown;
  conversationId?: unknown;
  constraints?: unknown;
  strength?: unknown;
}

export interface ValidatedIntent {
  actorUserId: string;
  sourceSurface: string;
  sourceEventId: string;
  sourceAt: string;
  side: string;
  act: IntentAct;
  dimension: IntentDimension | null;
  polarity: Polarity;
  attribution: Attribution;
  explicit: boolean;
  confidence: number;
  scope: IntentScope;
  propertyId: string | null;
  intentProfileId: string | null;
  conversationId: string | null;
  constraints: Record<string, unknown>;
  strength: Record<string, Firmness>;
}

export interface Validation {
  intent: ValidatedIntent | null;
  /** Why not. Plain words, for an operator reading a log — never shown to a customer. */
  rejected: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isOneOf = <T extends string>(value: unknown, allowed: readonly T[]): value is T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value);

/**
 * Nothing becomes an intent by claiming to be one.
 *
 * WHAT THIS IS FOR. A language model asked for structure returns structure — including
 * when it has misread, hallucinated a currency, invented a side, or answered in a
 * vocabulary nobody uses. Downstream of here a signal is trusted: it reaches the matcher,
 * it can produce a notification, and it can tell an owner that somebody is interested. So
 * the boundary is here, it is total, and it fails closed.
 *
 * Every rejection is reported rather than silently dropped. A validator that quietly
 * returns null is indistinguishable from a model that returned nothing.
 */
export function validate(candidate: IntentCandidate): Validation {
  const rejected: string[] = [];
  const c = candidate ?? {};

  const actorUserId = typeof c.actorUserId === 'string' && UUID.test(c.actorUserId)
    ? c.actorUserId : null;
  if (!actorUserId) rejected.push('actor is not a user id');

  const sourceEventId = typeof c.sourceEventId === 'string' && UUID.test(c.sourceEventId)
    ? c.sourceEventId : null;
  if (!sourceEventId) rejected.push('source event is not an id');

  if (!isOneOf(c.sourceSurface, SURFACES)) rejected.push('unknown source surface');
  if (!isOneOf(c.side, SIDES)) rejected.push('unknown side');
  if (!isOneOf(c.scope, SCOPES)) rejected.push('unknown scope');
  if (!isOneOf(c.attribution, ATTRIBUTIONS)) rejected.push('unknown attribution');

  if (!isOneOf(c.act, ACTS)) rejected.push('unknown act');
  const dimension = isOneOf(c.dimension, DIMENSIONS) ? c.dimension : null;
  if (c.dimension !== null && c.dimension !== undefined && !dimension) {
    rejected.push(`dimension ${JSON.stringify(String(c.dimension))} is not one the matcher knows`);
  }
  /*
   * A COMPLAINT ABOUT NOTHING IN PARTICULAR IS A MOOD. "It's expensive" is about the
   * price; an objection with no dimension cannot be acted on and must not be stored as
   * though it could.
   */
  if (c.act === 'OBJECTION' && !dimension) {
    rejected.push('an objection that names no dimension');
  }

  /*
   * THE SIGN FOLLOWS THE ACT. Taken rather than trusted: a caller that sends a POSITIVE
   * rejection has made a mistake, and storing what they sent would let the two fields
   * drift apart one insert at a time.
   */
  const polarity = isOneOf(c.act, ACTS) ? polarityFor(c.act) : 'POSITIVE';

  const sourceAt = typeof c.sourceAt === 'string' && Number.isFinite(Date.parse(c.sourceAt))
    ? new Date(c.sourceAt).toISOString() : null;
  if (!sourceAt) rejected.push('source has no readable timestamp');

  const confidenceRaw = Number(c.confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.min(1, Math.max(0, confidenceRaw))
    : null;
  if (confidence === null) rejected.push('confidence is not a number');

  /*
   * A PROPERTY-SCOPED SIGNAL THAT NAMES NO PROPERTY IS NOT ONE.
   *
   * "I'm not interested in this one any more", with nothing saying which one, cannot be
   * stored as a property rejection — there is nothing to reject. Letting it through with
   * a null property_id would produce a signal that matches everything or nothing
   * depending on which query read it.
   */
  const propertyId = typeof c.propertyId === 'string' && UUID.test(c.propertyId)
    ? c.propertyId : null;
  if (c.scope === 'PROPERTY' && !propertyId) {
    rejected.push('a property-scoped signal names no property');
  }
  if (c.side === 'PROPERTY_INTEREST' && !propertyId) {
    rejected.push('interest in a property that was not resolved');
  }

  /*
   * ONLY THE AUTHOR'S OWN WORDS BECOME THE AUTHOR'S OWN REQUIREMENTS.
   *
   * Third-party and quoted statements are kept — they are real market intelligence — but
   * never as this person's demand or supply. A sentence about somebody's brother must not
   * be able to arrive as that person's search.
   */
  if ((c.side === 'DEMAND' || c.side === 'SUPPLY') && c.attribution !== 'SELF') {
    rejected.push('demand or supply attributed to somebody other than the author');
  }

  /*
   * A QUESTION IS NOT A REQUIREMENT, AND A COMPLAINT IS NOT ONE EITHER.
   *
   * "How much is it?" tells us somebody is engaged and tells us nothing about what they
   * want; "it's expensive" tells us about one dimension of one thing. Letting either
   * arrive as DEMAND would create a search out of a sentence that stated no requirements
   * — and that search would then match things and notify people.
   */
  if ((c.side === 'DEMAND' || c.side === 'SUPPLY')
      && (c.act === 'INQUIRY' || c.act === 'OBJECTION')) {
    rejected.push('a question or a complaint is being stored as a statement of requirements');
  }

  const constraints = c.constraints && typeof c.constraints === 'object' && !Array.isArray(c.constraints)
    ? c.constraints as Record<string, unknown>
    : {};

  /*
   * FIRMNESS IS A CLOSED VOCABULARY. A model that answers "very important" or "high" for
   * a strength has not answered the question, and storing it would give the matcher a
   * word it does not know — which it would then treat as the default, REQUIRED.
   */
  const strength: Record<string, Firmness> = {};
  const strengthRaw = c.strength && typeof c.strength === 'object' && !Array.isArray(c.strength)
    ? c.strength as Record<string, unknown>
    : {};
  for (const [dimension, value] of Object.entries(strengthRaw)) {
    if (isOneOf(value, FIRMNESS)) strength[dimension] = value;
    else rejected.push(`strength ${JSON.stringify(String(value))} is not one of ${FIRMNESS.join(', ')}`);
  }

  if (rejected.length > 0) return { intent: null, rejected };

  return {
    intent: {
      actorUserId: actorUserId as string,
      sourceSurface: c.sourceSurface as string,
      sourceEventId: sourceEventId as string,
      sourceAt: sourceAt as string,
      side: c.side as string,
      act: c.act as IntentAct,
      dimension,
      polarity,
      attribution: c.attribution as Attribution,
      explicit: c.explicit === true,
      confidence: confidence as number,
      scope: c.scope as IntentScope,
      propertyId,
      intentProfileId: typeof c.intentProfileId === 'string' && UUID.test(c.intentProfileId)
        ? c.intentProfileId : null,
      conversationId: typeof c.conversationId === 'string' && UUID.test(c.conversationId)
        ? c.conversationId : null,
      constraints,
      strength,
    },
    rejected: [],
  };
}
