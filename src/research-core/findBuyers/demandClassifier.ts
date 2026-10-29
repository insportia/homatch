// DEMAND CLASSIFIER — what a public post/comment/message actually is, in
// the six languages (ka, ru, en, ar, he, tr). Pure and deterministic.
//
// The first production campaign (VILLION, 2026-10-09) showed why a phrase
// is never enough: "ищу работу" (job), "ищу нянечку" (hiring a nanny),
// "ищу квартиру … до 500$" (renting), "Apartment for Sale" (a seller) were
// all labelled buyers because "ищу / looking for / ვეძებ" matched. Here a
// reading is built from independent evidence:
//
//   domain        is this about residential real estate at all?
//                 (a property noun or a room spec — never a seeker verb alone)
//   job/service   job seeking, hiring, service ads → never property demand
//   direction     seeking (first person) vs offering (listing structure,
//                 "for sale", "сдаётся", "იყიდება" …), by which comes first
//   transaction   BUY vs RENT from explicit words, then from the money scale
//                 (a $500 budget is a monthly rent, a $53,000 one a purchase)
//   constraints   budget (range, currency, monthly vs total, a down payment
//                 is NOT a budget), places, rooms/bedrooms, area, type
//
// Unclear text is UNCLEAR (needsModel) — never promoted to demand by default.
// The model may resolve an UNCLEAR reading but cannot overturn a rule that
// found job/service/offer evidence (see boundModelReading).

import type { AiVerdict } from './aiClassifier.ts';
import { CITY_NAMES, cityMentioned, placesMentioned } from './places.ts';
import { isParkingText, type PropertySubtype, statedSubtypes } from './propertyFamily.ts';

export type DemandRole =
  | 'BUY_SEEKER' | 'RENT_SEEKER' | 'SALE_OFFER' | 'RENT_OFFER'
  | 'AGENT' | 'SERVICE' | 'JOB' | 'IRRELEVANT' | 'UNCLEAR';

export const DEMAND_ROLES: readonly DemandRole[] = ['BUY_SEEKER', 'RENT_SEEKER', 'SALE_OFFER', 'RENT_OFFER', 'AGENT', 'SERVICE', 'JOB', 'IRRELEVANT', 'UNCLEAR'];

export type Money = { amount: number; currency: 'USD' | 'GEL' | 'EUR' };

export interface Budget {
  min: number | null;
  max: number | null;
  currency: 'USD' | 'GEL' | 'EUR';
  period: 'TOTAL' | 'MONTHLY' | null;
  /** The literal text the numbers came from (evidence, never invented). */
  evidence: string;
  /** No currency was written ("60 ათასამდე", "до 70 тыс"): the amount is evidence, the
   *  currency is not; qualification compares it under each plausible currency. */
  currencyStated?: boolean;
}

export interface DemandReading {
  role: DemandRole;
  /** BUY / RENT for seekers and offers; null when the text does not say. */
  transaction: 'BUY' | 'RENT' | null;
  realEstate: boolean;
  residential: boolean;
  propertyType: 'APARTMENT' | 'HOUSE' | 'LAND' | 'COMMERCIAL' | 'PARKING' | null;
  /** Seeking on someone else's behalf ("for my client"). */
  intermediary: boolean;
  budget: Budget | null;
  downPayment: Money | null;
  /** How the seeker says they will pay, when they say it: paying the seller over time
   *  ("ეტაპობრივი გადახდით", "рассрочка") or a bank mortgage. Absent = not stated. */
  financing?: 'INSTALMENTS' | 'MORTGAGE' | null;
  cities: string[];
  /** Districts and micro-areas the writer wants (excluded ones are in excludedPlaces). */
  districts: string[];
  /** Streets the writer names as wanted ("კრწანისის ქუჩაზე"). Absent on readings stored before v6. */
  streets?: string[];
  /** Places the writer explicitly excluded ("not Vake", "ვაკის გარდა"); streets as "street:<key>". */
  excludedPlaces?: string[];
  /** "district doesn't matter" / "any area". */
  locationFlexible: boolean;
  rooms: number | null;
  bedrooms: number | null;
  areaSqm: number | null;
  /**
   * The stated size as a range (v7): "60 კვადრატამდე" → max 60, "от 60 до 70 м²" → 60–70,
   * "50კვ/მ ზე მეტი" → min 50, "about 80 square meters" → 80–80 (approximate). null = not stated.
   */
  area?: { min: number | null; max: number | null; approx: boolean } | null;
  /** Subtypes the text names within its family ("office", "warehouse", "дача"); [] = not stated (v9). */
  subtypes?: PropertySubtype[];
  /** The AI classification that decided the role (aiClassifier.ts), when one ran. */
  aiVerdict?: AiVerdict & { model?: string };
  /** Rule ids that decided the reading (explainable). */
  evidence: string[];
  confidence: number;
  needsModel: boolean;
}

/* ── lexicons ──────────────────────────────────────────────────────────── */

const L = (parts: string[]) => new RegExp(parts.join('|'), 'iu');
const B = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';

/** Residential property nouns. */
const RESIDENTIAL = L([
  `${B}(apartment|apartments|appartment|flat|flats|condo|studio|penthouse|duplex|house|villa|cottage|townhouse|home to buy|property|real estate)`,
  'квартир', 'жиль', 'недвижим', `${B}дом(?![\\p{L}])`, `${B}дома${E}`, 'коттедж', 'студи', 'пентхаус', 'однушк', 'двушк', 'трешк', 'трёшк', 'комнатн',
  /* v10 taxonomy: villas, dachas, townhouses, duplexes in every language. */
  'вилл', `${B}дач[аиуеё]${E}`, 'дачн\\S* дом', 'таунхаус', 'дуплекс', 'двухуровнев', `${B}(chalet|bungalow|farmhouse|summer house)`, 'კოტეჯ', 'ვილა', 'თაუნჰაუს', 'პენტჰაუს', 'დუპლექს',
  'yazlık', 'dubleks', 'çatı katı', 'شاليه', 'بنتهاوس', 'دوبلكس', 'קוטג', 'דופלקס', 'צימר',
  /* ბინა only at a word start: კაბინეტი (an office room) contains ბინ (VILLION lead 37, 2026-10-16). */
  `${B}ბინ(?!ძ)`, 'სახლ', 'უძრავ', 'აპარტამენტ', 'ოთახიან', 'სტუდიო', 'აგარაკ',
  `${B}(daire|konut|emlak|stüdyo|villa|müstakil|rezidans)`, `${B}ev${E}`,
  'شقة', 'شقق', 'منزل', 'بيت', 'فيلا', 'عقار', 'سكن',
  'דירה', 'דירות', 'נכס', 'נדל', 'וילה', 'פנטהאוז', 'סטודיו', `${B}בית${E}`,
]);
const COMMERCIAL_ONLY = L(['офис', 'кабинет', 'магазин', 'склад', 'помещени', 'коммерческ', 'ოფის', 'კაბინეტ', 'მაღაზი', 'საწყობ', 'კომერციულ', `${B}(office|shop|warehouse|retail|salon space|commercial)`, 'dükkan', 'ofis', 'depo', 'işyeri', 'تجاري', 'مكتب', 'محل', 'مستودع', 'משרד', 'חנות', 'מחסן', 'מסחרי',
  /* v10 taxonomy: premises words only — "кафе" or "hotel" alone is a night out, not real estate;
     the subtype (café, hotel, clinic …) is read from the text once a premises word made it one. */
  'საწარმო', 'ქარხან', 'ანგარ', 'სახელოსნო', 'შოურუმ', 'ქოვორქინგ', 'ფართ', 'შენობ', 'завод', `${B}цех`, 'ангар', 'шоурум', 'коворкинг', 'мастерск', 'здани', 'производственн',
  `${B}(premises|factory|hangar|showroom|coworking|workshop|building|cold storage)${E}`, 'fabrika', 'atölye', `${B}bina(sı)?${E}`, 'مصنع', 'مبنى', 'ورشة', 'מפעל', 'בניין', 'מרלו"ג']);
const HOUSE = L([`${B}(house|villa|cottage|townhouse|chalet|bungalow|farmhouse)`, `${B}дом(?![\\p{L}])`, 'коттедж', 'вилл', `${B}дач[аиуеё]${E}`, 'таунхаус', 'სახლ', 'აგარაკ', 'კოტეჯ', 'ვილა', 'თაუნჰაუს', `${B}(müstakil|villa|yazlık)`, 'sıra ev', 'منزل', 'فيلا', 'شاليه', 'וילה', 'קוטג', 'צימר', `${B}בית${E}`]);
const LAND = L([`${B}(land|plot|farmland|acres?)`, 'участ', `${B}земл[яиюе]${E}`, 'მიწ', 'ნაკვეთ', `${B}(arsa|arazi|tarla)`, 'أرض', 'أراضي', 'מגרש', 'קרקע']);
/** "2 bedroom", "3-room", "1+1", "სამ ოთახიან", "трёхкомнатн". */
const ROOM_SPEC = L([
  '\\d\\s*\\+\\s*1', '\\d\\s*-?\\s*(room|rooms|bedroom|bedrooms|br)\\b', '\\d\\s*-?\\s*(комн|спальн|к\\.)', '\\d\\s*-?\\s*(ოთახ|საძინებ)',
  `${B}(one|two|three|four)[- ]?(room|bedroom)`, '(одно|двух|трех|трёх|четырех|четырёх)комнат', '(ერთ|ორ|სამ|ოთხ)\\s*ოთახ', '\\d\\s*(oda|yatak odası)', 'غرف', 'חדרים', 'חדר',
]);

const JOB = L([
  'работ', 'ваканси', 'подработк', 'резюме', 'трудоустро', 'ищу работу', 'няня', 'нянечк', 'нянь', 'сиделк', 'гувернант', 'домработниц',
  `${B}(job|jobs|vacancy|vacancies|hiring|resume|cv|employment|babysitter|nanny|caregiver|work permit)`,
  'სამუშაო', 'ვაკანსი', 'დასაქმ', 'ძიძ', 'მომვლელ', 'რეზიუმე', 'ვეძებ სამსახურ', 'სამსახურს ვეძებ', 'სამსახური მჭირდება',
  `${B}(iş arıyorum|iş ilanı|eleman|bakıcı|özgeçmiş)`, 'وظيفة', 'وظائف', 'توظيف', 'مربية', '(أبحث|ابحث|نبحث) عن عمل', 'עבודה', 'משרה', 'מטפלת', 'בייביסיטר',
]);
const SERVICE = L([
  'ремонт', 'мебел', 'перевоз', 'грузчик', 'уборк', 'клининг', 'юрист', 'нотариус', 'дизайн интерьер', 'массаж', 'маникюр', 'ипотечн брокер',
  `${B}(renovation|repair|furniture|moving company|movers|cleaning service|lawyer|notary|interior design|massage|manicure|we offer|our services)`,
  'რემონტ', 'ავეჯ', 'გადაზიდ', 'დალაგებ', 'ადვოკატ', 'ნოტარ', 'დიზაინ', 'მასაჟ', 'მანიკიურ',
  `${B}(tadilat|mobilya|nakliyat|temizlik|avukat|noter)`, 'ترميم', 'أثاث', 'نقل عفش', 'تنظيف', 'محامي', 'שיפוץ', 'רהיטים', 'הובלות', 'ניקיון', 'עורך דין',
]);
const AGENT = L([
  `${B}(i am an? (agent|realtor|broker)|i'm an? (agent|realtor|broker)|real estate agent|our agency|for my client|my client|on behalf of (a|my) client|i have an? (client|customer)s? (who|that|looking)|a client of mine)`,
  'риелтор', 'риэлтор', 'агентство недвижим', 'агент по недвижим', 'мой клиент', 'для клиента', 'моего клиента', 'у меня (есть )?клиент',
  'აგენტი ვარ', 'სააგენტო', 'მყავს კლიენტი', 'ჩემი კლიენტ', 'კლიენტისთვის',
  `${B}(emlakçı|emlak ofisi|müşterim için)`, 'وسيط عقاري', 'مكتب عقار', 'لعميلي', 'מתווך', 'משרד תיווך', 'ללקוח שלי',
]);

/**
 * A buyer refusing intermediaries ("риелторов не беспокоить", "no agents please", "აგენტებმა არ
 * შემაწუხოთ"): the broker word is the opposite of a broker (owner, 2026-10-18: "do not reject a
 * legitimate buyer simply because the post contains a broker-related word"). Removed before the
 * AGENT test.
 */
const NO_AGENTS = L([
  `${B}(no|without) (agents?|agencies|brokers?|realtors?|intermediaries)`, 'agents? (please )?(do not|don\'t) (call|message|contact)', 'only (from )?owners?',
  'без посредник', 'без риел', 'без риэл', 'без агент', '(риелтор|риэлтор|агент|посредник)\\S* (просьба )?не (беспокоить|писать|звонить|предлагать)', 'только (от )?собственник',
  'აგენტებ\\S* (ნუ|არ) ', 'შუამავლ\\S* (გარეშე|ნუ|არ)', 'მხოლოდ მეპატრონ', 'სააგენტოებ\\S* (ნუ|არ) ',
  'emlakçı\\S* (aramasın|rahatsız etmesin|değil)', 'sadece sahibinden', 'بدون (وسطاء|وسيط|سمسار)', 'بلا وسطاء', 'בלי מתווכים', 'ללא תיווך', 'ללא מתווכים',
]);

/**
 * A broker or agency recruiting SELLERS: "თუ გაქვთ ბინა გასაყიდი … დაგეხმარებით … ვიპოვო მყიდველი",
 * "თქვენ გაქვთ გასაყიდი უძრავი ქონება? … ვიღებთ ექსკლუზიურ გაყიდვაში", "помогу продать".
 * Supply-side, never a buyer (production leads 7bfc19dd, d205058f, 2026-10-16). A buyer asking
 * sellers ("თუ გაქვთ ბინა გასაყიდი, მომწერეთ") has no service promise and stays a seeker.
 */
const SELLER_SERVICE = L([
  'დაგეხმარებით', 'დაგეხმარებათ', 'დაგეხმაროთ', 'ბროკერი', 'ვიპოვო (რეალური |სანდო )?(მყიდველ|დამქირავებ)', 'მოგიძებნით (მყიდველ|დამქირავებ)', 'ექსკლუზიურ',
  'ჩაგვაბარეთ', 'გავყიდით', 'მომსახურების საფასურ', 'მაკლერი ვარ', 'ვარ მაკლერი', 'ვარ აგენტი',
  '(помогу|поможем) (вам )?(продать|сдать)', 'найд(у|ем) покупател', 'эксклюзивн(ый|ую|ое) (договор|продаж)', 'примем (вашу )?недвижимость',
  `${B}(help you (sell|rent out)|we('ll| will)? sell your|find (you )?a buyer for|exclusive listing|list your (property|apartment|home))`,
  `${B}(satmanıza yardımcı|alıcı buluyoruz|portföyümüze)`, 'نساعدك (في|على) بيع', 'نبيع عقارك', 'נעזור לכם (למכור|להשכיר)', 'נמכור את הנכס',
]);
/** Speaking to owners who sell: "თქვენ გაქვთ გასაყიდი …?", "თუ … გაყიდვა გსურთ", "хотите продать". */
const ADDRESSES_SELLERS = L([
  '(თუ |თქვენ )?გაქვთ[^.!?\n]{0,80}(გასაყიდ|გასაქირავებ)', '(გაყიდვა|გაქირავება) გსურთ', 'გსურთ (გაყიდვა|გაქირავება)',
  'მეპატრონეებ', 'მესაკუთრეებ', '(გასაყიდი|გასაქირავებელი) ბინები გამომიგზავნეთ', 'собственник(ам|и,)', `${B}(owners|landlords),`,
  '(если )?(у вас есть|хотите (продать|сдать))', `${B}(do you have (a |an )?(property|apartment|house|flat)[^.!?\n]{0,40}(to sell|for sale|to rent)|want to sell your)`,
  `${B}(satmak istiyorsanız|evinizi satmak)`, 'هل تريد بيع', 'רוצים למכור',
]);
/** A buyer asking whoever sells: "ბენდუქიძეში თუ ყიდით ვინმე ბინას მომწერეთ", "кто продаёт квартиру", "anyone selling". */
const ASKS_SELLERS = L([
  'თუ (ვინმე )?ყიდით', 'ვინც ყიდით', 'ვინც ყიდის', 'თუ ვინმე ყიდის', 'ვინმე ყიდის', 'ვინ ყიდის', 'кто (-то |нибудь )?прода[её]т', 'кто-то прода[её]т',
  `${B}(anyone selling|is anyone selling|who is selling|who's selling)`, `${B}(satan var mı|satan varsa)`, 'من يبيع', 'מישהו מוכר',
]);

/**
 * An advertiser speaking TO buyers: "ბინის შეძენა გსურთ? … გთავაზობთ", "Want to buy an
 * apartment? We offer…", "Хотите купить квартиру? Предлагаем…". Second-person address
 * plus an offer verb is a sales ad — never a buyer (production lead be7d9baa, 2026-10-13).
 */
const SECOND_PERSON_ADDRESS = L([
  'გსურთ', 'გინდათ', 'ეძებთ', 'გაინტერესებთ', 'ხომ არ',
  `${B}(do you want|want to buy\?|looking to buy\?|are you looking|planning to buy|thinking of buying|dreaming of)`,
  'хотите', 'ищете', 'мечтаете', 'планируете купить',
  `${B}(istiyor musunuz|arıyor musunuz|düşünüyor musunuz)`, 'هل تريد', 'هل تبحث', 'تبحث عن', 'רוצים לקנות', 'מחפשים דירה\?', 'מתכננים לקנות',
]);
const OFFER_VERB = L([
  'გთავაზობთ', 'შემოგთავაზებთ', 'გთავაზობს', 'ეს ვარიანტი', 'ვარიანტი ნახეთ', 'შეთავაზება თქვენთვის', 'ეს შეთავაზება', 'ჩვენთან', 'ჩვენი კომპანი', 'დეველოპერ', 'მწვანე კარკას', 'თეთრი კარკას', 'შავი კარკას', 'გადახდის მოქნილი',
  `${B}(we offer|we provide|our (company|project|apartments)|developer|flexible payment|payment plan|contact us|call us)`,
  'предлагаем', 'наша компания', 'застройщик', 'рассрочка от', 'звоните нам',
  `${B}(sunuyoruz|firmamız|projemiz)`, 'نقدم', 'نوفر', 'شركتنا', 'אנו מציעים', 'אנחנו מציעים', 'החברה שלנו',
]);
/** "Want to buy an apartment in Tbilisi? …" — a bare question to the reader, not a first-person statement. */
const QUESTION_TO_READER = /(?:^|[.!?\n]\s*)(?:want|looking|planning|ready) to (?:buy|rent|purchase)\b[^.!?\n]*\?/iu;
/** The person already has one: not an active buyer/tenant. */
const ALREADY_DONE = L([
  `${B}(already (bought|purchased|rented|found)|we bought|i bought|just bought|found one already)`,
  'уже купил', 'уже купили', 'уже нашл', 'уже снял', 'уже сняли', 'купил квартиру',
  'უკვე ვიყიდე', 'უკვე ვიყიდეთ', 'უკვე ვიპოვე', 'უკვე ვიპოვეთ', 'უკვე ვიქირავე', 'ვიყიდე ბინა',
  `${B}(zaten (aldım|aldık|buldum|bulduk|kiraladım))`, 'اشتريت', 'اشترينا', 'وجدت شقة', 'כבר קניתי', 'כבר קנינו', 'כבר מצאתי', 'כבר שכרנו',
]);
/** Negated intent: "not looking", "don't want to buy". */
const NOT_LOOKING = L([
  `${B}(not looking|no longer looking|don'?t want to (buy|rent)|do not want to (buy|rent)|not interested|not buying)`,
  'не ищу', 'не ищем', 'уже не ищ', 'не хочу (покупать|купить|снимать)', 'не интересует', 'не актуально',
  'აღარ ვეძებ', 'არ ვეძებ', 'არ მინდა (ყიდვა|ყიდვ|შეძენ|ქირ)', 'არ მაინტერესებს', 'აღარ არის აქტუალური',
  `${B}(aramıyorum|artık aramıyoruz|almak istemiyorum|ilgilenmiyorum)`, 'لا أبحث', 'لم أعد أبحث', 'لا أريد شراء', 'غير مهتم', 'לא מחפש', 'כבר לא מחפשים', 'לא מעוניין',
]);
/** Someone who does renovation work: a company, master, contractor, or a request to recommend one. */
const RENOVATION_PROVIDER = L([
  `${B}(company|companies|contractor|contractors|builder|builders|master|team|firm|recommend|who can|anyone know)`,
  'компани', 'фирм', 'мастер', 'бригад', 'подрядчик', 'посоветуйте', 'кто может',
  'კომპანი', 'ფირმ', 'ხელოსან', 'ოსტატ', 'ბრიგად', 'მირჩიეთ', 'ურჩიეთ', 'ვინ გააკეთებს', 'რომელ კომპანი',
  `${B}(firma|şirket|usta|tavsiye)`, 'شركة', 'مقاول', 'تنصحوني', 'קבלן', 'חברת', 'ממליצים', 'מי יכול',
]);
/** Renovation / repair / finishing work requested for a home — a service request, not demand. */
const RENOVATION = L([
  `${B}(renovation|renovate|refurbish|repair|remodel|interior design|contractor|builder|finishing works?)`,
  'ремонт', 'отделк', 'дизайн интерьер', 'строител', 'бригад',
  'რემონტ', 'შეკეთებ', 'მოპირკეთებ', 'ხელოსან', 'ბრიგად', 'დიზაინ',
  `${B}(tadilat|tamirat|dekorasyon|usta)`, 'ترميم', 'تشطيب', 'ديكور', 'مقاول', 'שיפוץ', 'שיפוצניק', 'קבלן',
]);

/** First-person seeking (never "for those looking for"). */
const SEEK = L([
  `${B}(i'?m looking|i am looking|we are looking|we're looking|looking for|looking to|searching for|in search of|i need|we need|need an?|needed|want to (buy|rent)|wanted|send me|please send|dm me with options|is looking for|are looking for)`,
  'ищу', 'ищем', 'нужн[аоы]', 'нужен', 'хочу (купить|снять)', 'куплю', 'сниму', 'присмотр', 'пришлите', 'предложите варианты',
  'ვეძებ', 'ვეძებთ', 'ეძებს', 'ищет(?!е)', 'ищут', 'arıyor', 'يبحث', 'მჭირდება', 'გვჭირდება', 'მინდა', 'გამომიგზავნეთ', 'შემომთავაზეთ', 'ვიყიდი', 'შევიძენ', 'ვყიდულობ', 'ვიქირავებ', 'ვქირაობ',
  `${B}(arıyorum|arıyoruz|almak istiyorum|kiralamak istiyorum|lazım)`, 'أبحث', 'ابحث', 'نبحث', 'أريد', 'اريد', 'محتاج', 'مطلوب',
  'מחפש', 'מחפשת', 'מחפשים', 'רוצה לקנות', 'רוצה לשכור', 'צריך', 'צריכה',
]);
/** First-person purchase/rent phrases that outrank an adjective like "satılık daire". */
const STRONG_SEEK = L([
  `${B}(want to buy|looking to buy|we want to buy|i want to buy|looking to rent|want to rent)`, 'хочу купить', 'хотим купить', 'куплю', 'сниму', 'хочу снять',
  'ვიყიდი', 'შევიძენ', 'ვყიდულობ', 'ვიქირავებ', 'almak istiyorum', 'satın almak istiyorum', 'kiralamak istiyorum', 'أريد شراء', 'أريد استئجار', 'רוצה לקנות', 'רוצה לשכור',
]);
/** Seeking a property that is for sale is a purchase: "Tiflis'te satılık daire arıyorum",
 *  "ищу квартиру на продажу", "looking for an apartment for sale" (2026-10-16). The seek
 *  verb comes first; "for sale, looking for a buyer" is a seller (BUYER_WANTED). */
const SEEK_FOR_SALE = L([
  `${B}(i'?m looking for|i am looking for|we are looking for|looking for|searching for|i need|we need)[^.!?\n]{0,60}${B}for sale`,
  '(ищу|ищем)[^.!?\n]{0,60}(на продажу|в продаже|под покупку)', `satılık[^.!?\n]{0,40}arıyor`,
  '(أبحث|ابحث|نبحث)[^.!?\n]{0,40}للبيع', '(מחפש|מחפשת|מחפשים)[^.!?\n]{0,40}למכירה',
]);
const BUYER_WANTED = L([`${B}(looking for|searching for|need) (a |an )?(serious |real )?buyers?`, '(ищу|ищем) покупател', 'alıcı arıyor', 'مشتري', '(מחפש|מחפשים) קונה', 'მყიდველ']);
/** A seller or landlord looking for the OTHER side: "looking for a buyer for my flat",
 *  "ищу покупателя", "ვეძებ მყიდველს", "kiracı arıyorum". Supply, never a buyer (2026-10-17:
 *  "buyer" contains "buy", so these read as purchase seekers). */
const SEEKS_COUNTERPARTY = L([
  `${B}(looking for|searching for|seeking|need|want to find|find) (a |an )?(serious |real |reliable |good )?(buyer|buyers|tenant|tenants|renter|renters)${E}`,
  '(ищу|ищем|нужен|нужны|найти|найдём|найдем) (покупател|арендатор|квартирант|съемщик|съёмщик)', 'покупател(ь|я|ей) (ищу|ищем)',
  '(ვეძებ|ვეძებთ|მჭირდება) (მყიდველ|დამქირავებ|მოიჯარე)', '(მყიდველს|დამქირავებელს|მოიჯარეს) ვეძებ',
  `${B}(alıcı|kiracı) (arıyorum|arıyoruz|aranıyor)`, '(أبحث|ابحث|نبحث) عن (مشتر|مستأجر)', '(מחפש|מחפשת|מחפשים) (קונה|קונים|שוכר|שוכרים)',
]);
/** Asking owners for BOTH sale and rent listings is building an agent's inventory
 *  ("მეპატრონეებმა გამომიგზავნეთ გასაყიდი და გასაქირავებელი ბინები", production lead
 *  1654fa18, 2026-10-17), not one person's search. */
const COLLECTS_LISTINGS = L([
  'გასაყიდი (და|ან) გასაქირავებელი', 'გასაქირავებელი (და|ან) გასაყიდი', 'იყიდება (და|ან) ქირავდება',
  /* Broker-to-broker and listing collection (campaign 8f6b8544, 2026-10-18): "ვეძებ ერთ საძინებლიან
     ბინებს, ვისაც გაქვთ გასაყიდი და თანამშრომლობთ მომწერეთ" — a buyer wants ONE home (ბინას), a
     broker asks colleagues who "cooperate". "Send me apartments" alone stays a buyer's words. */
  'თანამშრომლობ', 'გვყავს (რეალური |ბევრი )?(კლიენტ|მყიდველ|დამქირავებ)', 'მყავს (რეალური |ბევრი )?(კლიენტ|მსურველ|მყიდველ|დამქირავებ)',
  /* Campaign 343cfc41 (2026-10-18): "ჩამიყარეთ გასაყიდი ბინები მყავს ბათუმელი კლიენტები" — any word
     between "მყავს/გვყავს" and the clients (ბათუმელი, უცხოელი …), plural clients, and the "send me
     your listings" verbs. */
  '(მყავს|გვყავს) \\S+ (კლიენტ|მყიდველ|მსურველ|დამქირავებ)', '(კლიენტები|მყიდველები) (მყავს|გვყავს)',
  '(ჩამიყარეთ|ჩამიგდეთ|გადმომიგდეთ|გამომიგზავნეთ|მომწერეთ) (თქვენი )?(გასაყიდი|გასაქირავებელი|იყიდება)', 'გასაყიდი ბინები (ჩამიყარეთ|მომწერეთ|გადმომიგდეთ)',
  '(скидывайте|присылайте|кидайте) (мне )?(ваши )?(варианты|квартиры|объекты)', `${B}(send me (your )?(listings|properties|apartments for sale)|drop (me )?your listings)`,
  /* Plural only: "для клиента" (one named client) is a broker searching for a buyer (v10). */
  '(для|под) (моих |наших )?(клиентов|клиентам|покупателей)', 'есть (реальные )?(клиенты|покупатели)', 'ищу квартиры (для|под)', 'сотрудничеств',
  `${B}(we have (real |many )?(clients|buyers)|i have (a lot of |many )?(clients|buyers)|for (my|our) clients|looking for (apartments|listings) for|co-?broker|cooperation with agents)`,
  `${B}(müşterilerim (için|var)|alıcılarım var)`, 'لدي (عملاء|زبائن)', 'יש לי (לקוחות|קונים)',
  '(продаж[аеуи]|продать) (и|или) (аренд|сдать|сдач)', '(аренд[аеуы]|сдать) (и|или) (продаж|продать)', 'на продажу (и|или) (в )?аренду',
  `${B}(for sale (and|or) (for )?rent|to sell (and|or) (to )?rent|sale (and|or) rent(al)?) (listings|properties|apartments|flats)`,
  `${B}(satılık (ve|veya) kiralık)`, 'للبيع (و|أو) (ل)?الإيجار', 'למכירה (ו|או) להשכרה',
]);
/** A broker advertising to BUYERS: "помогу приобрести недвижимость … без комиссий",
 *  "დაგეხმარებით ბინის შეძენაში", "we help you find" (production lead 12b88ce0). */
const SERVICE_TO_BUYERS = L([
  '(помогу|поможем|помогаем) (вам )?(приобрести|купить|подобрать|найти|выбрать)', 'подбер(у|ем|ём) (вам )?(недвижимость|квартиру|жиль)', 'полное сопровождение сделки', 'без комисси',
  'დაგეხმარებით (ბინის |სახლის |ქონების )?(შეძენა|ყიდვა|შერჩევა|მოძებნა)', 'შეგირჩევთ', 'მოგიძებნით (ბინა|სახლ|ქონება)', 'საკომისიოს გარეშე',
  `${B}(we (help|will help|can help) you (buy|find|choose)|help you (buy|find) (a |your )?(home|apartment|property|flat)|no commission|commission[- ]free|full support of the (deal|transaction))`,
  `${B}(almanıza yardımcı|komisyonsuz)`, 'نساعدك (في|على) (شراء|إيجاد)', 'بدون عمولة', 'נעזור לכם (לקנות|למצוא)', 'ללא עמלה',
  /* Campaign 343cfc41 (2026-10-18): "إذا كنتم مهتمين بشراء شقة … يمكنكم مراسلتي … أقدم لكم خدمة متكاملة"
     — an agent addressing buyers with a service, read as a buyer. Every language's "if you are
     interested in buying … write to me / I offer full service". */
  'إذا كنتم? مهتم', 'إذا كنت مهتم', 'أقدم لكم', 'خدمة متكاملة',
  'אם אתם מעוניינים (לקנות|ברכישת)', 'אני מציע(ה)? שירות', 'שירות מלא',
  'eğer (bir )?(daire|ev) (almak|satın almak) istiyorsanız', 'satın almakla ilgileniyorsanız', 'tam hizmet sunuyorum',
  'если вы (хотите|планируете|заинтересованы)\\S* (купить|приобрести|в покупке)', 'полный спектр услуг',
  'თუ გსურთ (ბინის |სახლის )?(შეძენა|ყიდვა)', 'თუ დაინტერესებული ხართ (ბინის |სახლის )?(შეძენ|ყიდვ)', 'სრულ მომსახურებას', 'სრული მომსახურება',
  `${B}(if you are interested in buying|if you('re| are) looking to buy|i offer (a )?(full|complete) service|full service from a to z)`,
]);
/** "Looking for a cleaner / plumber / electrician" is a service request, not a home seeker. */
const SERVICE_REQUEST = L([
  `${B}(looking for|searching for|need|i need|we need) (a |an )?(good |reliable )?(cleaner|cleaning lady|housekeeper|plumber|electrician|handyman|painter|locksmith)`,
  '(ищу|ищем|нужен|нужна) (хорошего |хорошую )?(уборщиц|сантехник|электрик|мастер|маляр|домработниц)',
  '(ვეძებ|ვეძებთ|მჭირდება) (კარგ |სანდო )?(დამლაგებ|სანტექნიკოს|ელექტრიკოს|ხელოსან|მღებავ)',
  `${B}(temizlikçi|tesisatçı|elektrikçi|boyacı) (arıyorum|arıyoruz|lazım)`, '(أبحث|ابحث|نبحث) عن (سباك|كهربائي|عامل نظافة|عاملة نظافة)', '(מחפש|מחפשת|מחפשים|צריך) (אינסטלטור|חשמלאי|מנקה|הנדימן)',
]);
/** A stated budget is a seeker's word; a seller states a price. */
const BUDGET_WORD = L([`${B}budget`, 'бюджет', 'ბიუჯეტ', 'bütçe', 'ميزانية', 'תקציב']);
const THIRD_PERSON_SEEK = L([`for (those|anyone|people) (who are )?looking`, 'для тех, кто ищ', 'для тех кто ищ', 'ვისაც ეძებ', 'arayanlar için', 'لمن يبحث', 'למי שמחפש']);

const BUY = L([
  `${B}(buy(?!er)|buying|purchase|purchasing|to own|invest in)`, 'куплю', 'купить', 'покупк', 'покупа(?!тел)', 'приобрест', 'приобрет',
  'ვიყიდი', 'ვიყიდო', 'ყიდვ', 'შევიძენ', 'შეძენ', 'შესაძენ', 'ვყიდულობ', 'საყიდ', 'გასაყიდად',
  `${B}(satın al|almak istiyorum|alıcı|alacağım)`, 'شراء', 'أشتري', 'اشتري', 'نشتري', 'للشراء', 'לקנות', 'קונה', 'קונים', 'קניית', 'לקנייה', 'רכישה', 'לרכישה',
  /* paying for it over time is a purchase, not a rent */
  'ипотек', 'рассрочк', 'იპოთეკ', 'განვადებ', 'ეტაპობრივი გადახდ', `${B}(mortgage|installments?)`, 'taksit', 'تقسيط', 'משכנתא',
]);
const RENT = L([
  `${B}(rent|renting|rental|to let|lease|per month|a month|/month|monthly|month contract|months? contract|\\d+\\s*months?|long[- ]term|short[- ]term)`,
  'сниму', 'снять', 'аренд', 'съём', 'съем', 'длит', 'долгосроч', 'посуточ', 'в месяц', '/мес', 'на месяц', 'месяц', 'проживани',
  'ქირ', 'ვიქირავებ', 'ვქირაობ', 'თვეში', 'თვით', 'წლით', 'დღიურად',
  `${B}(kira|kiralık|kiralamak|aylık)`, 'إيجار', 'ايجار', 'استئجار', 'شهري', 'לשכור', 'שכירות', 'לחודש', 'להשכרה',
]);
const SALE_OFFER = L([
  `${B}(for sale|on sale|selling|sale price|sold by owner|apartment for sale|house for sale)`,
  'прода[её]тся', 'продаю', 'продам', 'в продаже', 'на продажу',
  'იყიდება', 'ვყიდი', 'გაიყიდება', 'იყიდება ბინა',
  `${B}(satılık|satıyorum|satılıktır)`, 'للبيع', 'أبيع', 'ابيع', 'למכירה', 'מוכר', 'מוכרת',
]);
const RENT_OFFER = L([
  `${B}(for rent|to let|for lease|available for rent|renting out)`, 'сда[её]тся', 'сдаю', 'сдам', 'в аренду сда',
  'ქირავდება', 'ვაქირავებ', 'გაქირავდება', `${B}(kiralıktır|kiraya veriyorum)`, 'للإيجار', 'للايجار', 'أؤجر', 'להשכרה', 'משכיר', 'משכירה',
]);
/** Listing-like structure: price + a spec line, with contact or hashtag cues. */
const LISTING_CUES = L(['📍', '📐', '💰', '🛏', '#', 'price:', 'цена:', 'ფასი:', `${B}(size|floor|rooms|bedrooms)\\s*:`, 'этаж', 'სართულ', 'call me', 'for more details', 'details in dm', 'звоните', 'დარეკეთ', 'დამირეკეთ', 'whatsapp', 'viber', 'вотсап', 'ватсап']);
const FLEX_LOCATION = L(['район не имеет значения', 'любой район', 'any (area|district|location)', 'location (is )?flexible', 'district doesn\'t matter', 'ნებისმიერ (ადგილ|უბან)', 'უბანს არ აქვს მნიშვნელობა', 'herhangi bir (semt|bölge)', 'أي منطقة', 'כל אזור']);
/** Paying the seller over time vs a bank loan — a purchase either way, but not the same buyer. */
const INSTALMENTS = L(['рассрочк', 'ეტაპობრივი გადახდ', 'ეტაპობრივად', 'განვადებ', `${B}(installments?|instalments?|payment plan|pay in parts)`, 'taksit', 'تقسيط', 'בתשלומים', 'פריסת תשלומים']);
const MORTGAGE = L(['ипотек', 'იპოთეკ', `${B}(mortgage|bank loan)`, 'konut kredisi', `${B}kredi`, 'رهن عقاري', 'قرض سكني', 'משכנתא']);
const DOWN_PAYMENT = L(['первоначальн', 'взнос', 'პირველადი შენატან', 'წინასწარ შენატან', `${B}(down payment|deposit|first payment)`, 'peşinat', 'دفعة أولى', 'מקדמה', 'הון עצמי']);

/* ── money ─────────────────────────────────────────────────────────────── */

const CUR_USD = '(?:\\$|usd|долл\\S*|дол\\.|დოლარ\\S*|dolar|دولار|דולר)';
const CUR_GEL = '(?:₾|gel|лари|лар\\.|ლარ\\S*|ლ(?![\\p{L}])|lari)';
const CUR_EUR = '(?:€|eur|евро|ევრო|euro|يورو|יורו)';
const NUM = '(\\d{1,3}(?:[ \\u00a0,.]\\d{3})+|\\d+(?:[.,]\\d+)?)[ \\u00a0]*(k(?![\\p{L}])|к(?![\\p{L}])|ათას|тыс\\.?|bin(?![\\p{L}])|ألف|אלף)?';

function toNumber(raw: string, mult?: string): number | null {
  let s = raw.replace(/[  ]/g, '');
  if (/^\d{1,3}([,.]\d{3})+$/.test(s)) s = s.replace(/[,.]/g, '');
  else s = s.replace(',', '.');
  let n = Number(s);
  if (!Number.isFinite(n)) return null;
  if (mult) n *= 1000;
  return n;
}

interface MoneyHit extends Money { index: number; end: number; text: string }

/** Money amounts written next to a currency (never across a line break). */
export function moneyMentions(text: string): MoneyHit[] {
  const hits: MoneyHit[] = [];
  const cur: Array<[Money['currency'], string]> = [['USD', CUR_USD], ['GEL', CUR_GEL], ['EUR', CUR_EUR]];
  const SP = '[ \\t\\u00a0]*';
  const ok = (n: number | null): n is number => n != null && n >= 50 && n < 50_000_000;
  for (const [currency, c] of cur) {
    /* "50 000-70 000$" → both numbers carry the currency written after the second. */
    const range = new RegExp(`${NUM}${SP}(?:-|–|—|до|to)${SP}${NUM}${SP}${c}`, 'giu');
    for (const m of text.matchAll(range)) {
      const at = m.index ?? 0; const end = at + m[0].length;
      const a = toNumber(m[1], m[2]); const b = toNumber(m[3], m[4]);
      if (ok(a)) hits.push({ amount: a, currency, index: at, end, text: m[0] });
      if (ok(b)) hits.push({ amount: b, currency, index: at + 1, end, text: m[0] });
    }
    for (const re of [new RegExp(`${c}${SP}${NUM}`, 'giu'), new RegExp(`${NUM}${SP}${c}`, 'giu')]) {
      for (const m of text.matchAll(re)) {
        const at = m.index ?? 0; const end = at + m[0].length;
        const a = toNumber(m[1], m[2]);
        if (!ok(a)) continue;
        if (hits.some((h) => at < h.end && end > h.index)) continue;
        hits.push({ amount: a, currency, index: at, end, text: m[0] });
      }
    }
  }
  return hits.sort((x, y) => x.index - y.index);
}

/* thousands word, or "up to / budget" + a large number, or a large number + "-მდე" (up to). */
const BARE_AMOUNT = new RegExp([
  `(?<![\\p{L}\\p{N}])(\\d{1,4}(?:[.,]\\d+)?)\\s*(k|к|ათას\\S*|тыс\\S*|bin|ألف|אלף)(?![\\p{L}])`,
  `(?:до|up to|budget|бюджет|ბიუჯეტ\\S*|max\\.?|maximum)\\s*:?\\s*(\\d{2,3}(?:[ \\u00a0,.]\\d{3})+|\\d{5,7})()`,
  `(\\d{2,3}(?:[ \\u00a0,.]\\d{3})+|\\d{5,7})\\s*-?\\s*მდე`,
].join('|'), 'iu');

const FX_TO_USD: Record<Money['currency'], number> = { USD: 1, GEL: 0.37, EUR: 1.08 };
export const toUsd = (m: Money, fx?: Partial<Record<string, number>>) => m.amount * (fx?.[m.currency] ?? FX_TO_USD[m.currency]);

/** Monthly-rent scale vs purchase scale, in USD. Between them: undecided. */
const RENT_SCALE_MAX_USD = 6000;
const BUY_SCALE_MIN_USD = 15000;

/* ── reading ───────────────────────────────────────────────────────────── */

const firstIndex = (re: RegExp, s: string) => { const m = s.match(re); return m && m.index != null ? m.index : -1; };

function numberNear(re: RegExp, s: string): number | null {
  const m = s.match(re);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 && n < 20 ? n : null;
}
/** Size units, every language the campaigns read (v7: "კვადრატ…", "square meters" were missed). */
const AREA_UNIT = '(?:m2|m²|sq\\.?\\s?m(?:eters?|etres?)?|sqm|square\\s*met(?:er|re)s?|кв\\.?\\s?м\\S*|квадрат\\S*|м2|м²|კვ\\.?\\s?მ\\S*|კვ\\/მ\\S*|კვმ\\S*|კვადრატ\\S*|metrekare|متر\\s*مربع|م2|מ"ר|מטר|metr\\S*)';
const AREA_N = '(\\d{2,4}(?:[.,]\\d+)?)';
const AREA_RANGE = new RegExp(`(?:от\\s*|from\\s*|between\\s*)?${AREA_N}\\s*(?:-|–|—|до|to|and|-დან)\\s*${AREA_N}\\s*-?\\s*${AREA_UNIT}`, 'iu');
const AREA_MAX = new RegExp(`(?:(?:до|up to|under|max(?:imum)?|не более|less than|below)\\s*${AREA_N}\\s*${AREA_UNIT})|(?:${AREA_N}\\s*-?\\s*${AREA_UNIT}?\\s*-?მდე)`, 'iu');
const AREA_MIN = new RegExp(`(?:(?:от|from|at least|min(?:imum)?|не менее|more than|over|above|больше)\\s*${AREA_N}\\s*${AREA_UNIT})|(?:${AREA_N}\\s*-?\\s*${AREA_UNIT}\\s*-?\\s*(?:ზე\\s*მეტ|და\\s*მეტ|\\+))`, 'iu');
const AREA_ONE = new RegExp(`${AREA_N}\\s*-?\\s*${AREA_UNIT}`, 'iu');

/** The size a writer states, as a range. A bare number with no unit is never a size. */
export function statedArea(s: string): { min: number | null; max: number | null; approx: boolean } | null {
  const n = (x: string | undefined) => (x == null ? null : Number(x.replace(',', '.')));
  const ok = (v: number | null) => v != null && v >= 10 && v <= 2000;
  const range = s.match(AREA_RANGE);
  if (range && ok(n(range[1])) && ok(n(range[2]))) {
    const a = n(range[1])!, b = n(range[2])!;
    return { min: Math.min(a, b), max: Math.max(a, b), approx: false };
  }
  const max = s.match(AREA_MAX);
  /* "-მდე" right after a number+unit ("60 კვადრატამდე", "40 კვ.მ-მდე") only counts when a unit
     is present — "60 ათასამდე" is money. */
  if (max) {
    const v = n(max[1] ?? max[2]);
    const unitSeen = max[1] != null || new RegExp(AREA_UNIT, 'iu').test(max[0]);
    if (ok(v) && unitSeen) return { min: null, max: v, approx: false };
  }
  const min = s.match(AREA_MIN);
  if (min && ok(n(min[1] ?? min[2]))) return { min: n(min[1] ?? min[2]), max: null, approx: false };
  const one = s.match(AREA_ONE);
  if (one && ok(n(one[1]))) return { min: n(one[1]), max: n(one[1]), approx: true };
  return null;
}

/** Bedroom counts in words: "ერთ საძინებლიან", "ორსაძინებლიანი", "одна спальня", "two-bedroom" (8f6b8544: a
 *  one-bedroom request was read as "bedrooms unknown" and offered for a two-bedroom 97 m² home). */
const WORD_BEDROOMS: Array<[RegExp, number]> = [
  [/(?<![\p{L}])(one|single)[- ]?bed(room)?|односпальн|одн(а|ой|у) спальн|(?<![\p{L}])ერთ\s*-?\s*საძინებ|bir yatak odal|غرفة نوم واحدة|חדר שינה אחד/iu, 1],
  [/(?<![\p{L}])two[- ]?bed(room)?|двухспальн|дв(е|ух) спальн|(?<![\p{L}])ორ\s*-?\s*საძინებ|iki yatak odal|غرفتي نوم|שני חדרי שינה/iu, 2],
  [/(?<![\p{L}])three[- ]?bed(room)?|тр[её]хспальн|тр(и|ех|ёх) спальн|(?<![\p{L}])სამ\s*-?\s*საძინებ|üç yatak odal|ثلاث غرف نوم|שלושה חדרי שינה/iu, 3],
  [/(?<![\p{L}])four[- ]?bed(room)?|четыр[её]хспальн|четыре спальн|(?<![\p{L}])ოთხ\s*-?\s*საძინებ|dört yatak odal|أربع غرف نوم|ארבעה חדרי שינה/iu, 4],
];

/**
 * An author name that is a business or a channel, not a person: "ბინების ყიდვა-გაყიდვა
 * გაქირავება", "უძრავი ქონების აგენტი თაკო", "Sale Home", "Tika's Prime Home Georgia". Such an
 * author asking for homes is an intermediary, never a buyer (owner, 2026-10-18: "from the name
 * alone you must see that a broker posts").
 */
const BUSINESS_AUTHOR = L([
  'ბინებ', 'ბინის ', 'ყიდვა', 'გაყიდვ', 'გაქირავ', 'უძრავი ქონ', 'აგენტ', 'სააგენტ', 'ბროკერ', 'რიელტ', 'დეველოპ', 'ჰოუმ',
  `${B}(home|homes|house|realty|real estate|estate|properties|property|apartments|flats|rent|sale|invest|agency|group|development|developers|construction|llc|ltd)${E}`,
  'недвижим', 'квартир', 'аренд', 'продаж', 'риел', 'риэл', 'агентств',
  `${B}(emlak|gayrimenkul|konut|daire)`, 'عقار', 'شقق', 'נדל"ן', 'דירות',
]);
export function authorLooksLikeBusiness(name: string | null | undefined): boolean {
  const n = String(name ?? '').normalize('NFKC').trim();
  return n.length > 0 && BUSINESS_AUTHOR.test(n);
}

/** Roles an advertiser's or broker's post takes; their author asking for homes is no buyer. */
export const ADVERTISER_ROLES: readonly DemandRole[] = ['SALE_OFFER', 'RENT_OFFER', 'AGENT'];

/**
 * A broker explicitly searching for a CLIENT ("ищу для клиента 2-комнатную в Ваке", "მყავს
 * კლიენტი, ეძებს…"): real demand through an intermediary (owner, 2026-10-18: "detect brokers
 * explicitly representing buyers"). Never a buyer of their own, never Strong, labelled as such
 * (BUYER_VIA_BROKER). Brokers collecting inventory, soliciting sellers or selling services to
 * buyers stay rejected; a business-named author or one advertising in the same read never
 * reaches this (their evidence is not seeking_for_client).
 */
export function buyerViaBroker(r: Pick<DemandReading, 'role' | 'evidence'>): boolean {
  return r.role === 'AGENT' && r.evidence.includes('seeking_for_client');
}

/**
 * Who is speaking decides it as much as what is said: a seeker reading becomes AGENT when the
 * author's name is a business/channel name, or when the same author advertises homes in the same
 * read (8f6b8544: "ბინების ყიდვა-გაყიდვა გაქირავება" posted four sale ads and one "buyer" post).
 */
export function withAuthorEvidence(reading: DemandReading, author: { name?: string | null; alsoAdvertises?: boolean }): DemandReading {
  if (!['BUY_SEEKER', 'RENT_SEEKER', 'UNCLEAR'].includes(reading.role)) return reading;
  const why = authorLooksLikeBusiness(author.name) ? 'business_author' : author.alsoAdvertises ? 'author_also_advertises' : null;
  if (!why) return reading;
  return { ...reading, role: 'AGENT', intermediary: true, needsModel: false, confidence: Math.max(reading.confidence, 0.8), evidence: [...reading.evidence, why] };
}

const WORD_ROOMS: Array<[RegExp, number]> = [
  [/(one|single)[- ]?(room|bedroom)|одно(комнат)|однушк|ერთ\s*ოთახ/iu, 1],
  [/two[- ]?(room|bedroom)|двух(комнат)|двушк|ორ\s*ოთახ/iu, 2],
  [/three[- ]?(room|bedroom)|тр[её]х(комнат)|тр[её]шк|სამ\s*ოთახ/iu, 3],
  [/four[- ]?(room|bedroom)|четыр[её]х(комнат)|ოთხ\s*ოთახ/iu, 4],
];

export interface ClassifyOptions {
  kind?: 'POST' | 'COMMENT' | 'MESSAGE';
}

export function classifyDemand(text: string | null | undefined, opts: ClassifyOptions = {}): DemandReading {
  const raw = String(text ?? '').replace(/ /g, ' ');
  const s = raw.normalize('NFKC');
  const evidence: string[] = [];
  const empty = (role: DemandRole, why: string, confidence = 0.9): DemandReading => ({
    role, transaction: null, realEstate: false, residential: false, propertyType: null, intermediary: false,
    budget: null, downPayment: null, cities: [], districts: [], streets: [], excludedPlaces: [], locationFlexible: false, rooms: null, bedrooms: null, areaSqm: null,
    evidence: [...evidence, why], confidence, needsModel: false,
  });
  const letters = (s.match(/\p{L}/gu) ?? []).length;
  if (!s.trim() || letters < 3) return empty('IRRELEVANT', 'empty_or_emoji');

  const residentialNoun = RESIDENTIAL.test(s);
  const roomSpec = ROOM_SPEC.test(s);
  const commercialOnly = COMMERCIAL_ONLY.test(s) && !residentialNoun;
  /* A parking place or garage is real estate too; "apartment with parking" stays an apartment. */
  const parkingOnly = isParkingText(s) && !residentialNoun && !roomSpec;
  const realEstate = residentialNoun || roomSpec || commercialOnly || LAND.test(s) || parkingOnly;

  /* Job seeking / hiring — the "ищу работу", "ищу нянечку" failure. */
  if (JOB.test(s) && !(residentialNoun && (SALE_OFFER.test(s) || RENT_OFFER.test(s) || BUY.test(s)))) {
    return empty('JOB', 'job_or_hiring');
  }
  const seekIdx = THIRD_PERSON_SEEK.test(s) ? -1 : firstIndex(SEEK, s);
  /* A listing that mentions its renovation is a listing, not a service ad. */
  const offerMarker = SALE_OFFER.test(s) || RENT_OFFER.test(s);
  if (SERVICE.test(s) && seekIdx < 0 && !offerMarker && !(residentialNoun && moneyMentions(s).length)) return empty('SERVICE', 'service_offer');
  if (SERVICE_REQUEST.test(s) && !STRONG_SEEK.test(s)) return empty('SERVICE', 'service_request');
  /* "Looking for a renovation company for my apartment": a service request, unless the
     same text also states a first-person purchase or rental ("I want to buy … and renovate"). */
  if (RENOVATION.test(s) && RENOVATION_PROVIDER.test(s) && !offerMarker && !STRONG_SEEK.test(s)) return empty('SERVICE', seekIdx >= 0 ? 'renovation_request' : 'service_offer');
  /* An advertiser addressing buyers ("Want to buy? We offer…") is a sales ad. */
  const addressesReader = SECOND_PERSON_ADDRESS.test(s) || QUESTION_TO_READER.test(s);
  if (addressesReader && OFFER_VERB.test(s) && (!STRONG_SEEK.test(s) || QUESTION_TO_READER.test(s))) {
    return { ...empty('SALE_OFFER', 'addresses_buyers_with_offer', 0.85), realEstate: realEstate || BUY.test(s), residential: residentialNoun, transaction: 'BUY' };
  }
  /* A broker or agency recruiting sellers is supply, whatever buyer words it uses. */
  if (SELLER_SERVICE.test(s) && (ADDRESSES_SELLERS.test(s) || seekIdx < 0) && !STRONG_SEEK.test(s)) {
    return { ...empty('AGENT', 'solicits_sellers', 0.85), realEstate: realEstate || BUY.test(s), residential: residentialNoun, intermediary: true };
  }
  /* A seller/landlord seeking the other side, an agent collecting sale AND rent listings,
     a broker advertising to buyers: supply or intermediaries, never a buyer. */
  if (SEEKS_COUNTERPARTY.test(s) && !STRONG_SEEK.test(s)) {
    const rentSide = /(tenant|renter|арендатор|квартирант|съ[её]мщик|დამქირავებ|მოიჯარე|kiracı|مستأجر|שוכר)/iu.test(s);
    return { ...empty(rentSide ? 'RENT_OFFER' : 'SALE_OFFER', 'seeks_counterparty', 0.85), realEstate: true, residential: residentialNoun, transaction: rentSide ? 'RENT' : 'BUY' };
  }
  if (COLLECTS_LISTINGS.test(s)) return { ...empty('AGENT', 'collects_listings', 0.85), realEstate: true, residential: residentialNoun, intermediary: true };
  if (SERVICE_TO_BUYERS.test(s) && !STRONG_SEEK.test(s)) return { ...empty('AGENT', 'service_to_buyers', 0.85), realEstate: true, residential: residentialNoun, intermediary: true };
  /* Already bought / found, or explicitly not looking: never an active seeker. */
  if (ALREADY_DONE.test(s)) return empty('IRRELEVANT', 'already_purchased');
  if (NOT_LOOKING.test(s)) return empty('IRRELEVANT', 'not_looking');
  if (!realEstate) return empty('IRRELEVANT', seekIdx >= 0 ? 'seeking_but_not_real_estate' : 'not_real_estate');

  const propertyType: DemandReading['propertyType'] = parkingOnly ? 'PARKING' : LAND.test(s) && !residentialNoun ? 'LAND'
    : commercialOnly ? 'COMMERCIAL' : HOUSE.test(s) && !/квартир|(?<![\p{L}])ბინ|apartment|flat|daire|شقة|דירה/iu.test(s) ? 'HOUSE' : 'APARTMENT';

  /* Constraints, from the text only. */
  const money = moneyMentions(s);
  const dpIdx = firstIndex(DOWN_PAYMENT, s);
  const downHit = dpIdx >= 0 ? money.find((m) => m.index >= dpIdx && m.index - dpIdx < 60) ?? null : null;
  const budgetHits = money.filter((m) => m !== downHit);
  let budget: Budget | null = null;
  if (!budgetHits.length) {
    /* An amount with no currency ("60 ათასამდე", "до 70 тыс", "budget 65k", "150 000-მდე"):
       kept as evidence with currencyStated=false — never assigned a currency. */
    const bare = s.match(BARE_AMOUNT);
    const n = bare ? toNumber(bare[1] ?? bare[3] ?? bare[5] ?? '', bare[2] ?? (bare[4] ? 'k' : undefined)) : null;
    if (bare && n != null && n >= 1000 && n < 50_000_000) {
      budget = { min: null, max: n, currency: 'USD', period: null, evidence: bare[0].trim(), currencyStated: false };
    }
  } else if (budgetHits.length) {
    const cur = budgetHits[0].currency;
    const same = budgetHits.filter((m) => m.currency === cur).map((m) => m.amount);
    const min = same.length > 1 ? Math.min(...same) : null;
    const max = Math.max(...same);
    budget = { min, max, currency: cur, period: null, evidence: budgetHits.filter((m) => m.currency === cur).map((m) => m.text.trim()).join(' · ') };
  }
  const rentWords = RENT.test(s);
  const seeksForSale = SEEK_FOR_SALE.test(s) && !BUYER_WANTED.test(s) && !LISTING_CUES.test(s);
  const asksSellers = ASKS_SELLERS.test(s) && !SELLER_SERVICE.test(s);
  const buyWords = BUY.test(s) || seeksForSale || asksSellers;
  const maxUsd = budget ? toUsd({ amount: budget.max ?? 0, currency: budget.currency }) : null;
  const scale: 'RENT' | 'BUY' | null = maxUsd == null ? null : maxUsd <= RENT_SCALE_MAX_USD ? 'RENT' : maxUsd >= BUY_SCALE_MIN_USD ? 'BUY' : null;
  if (budget) budget.period = scale === 'RENT' || (rentWords && !buyWords) ? 'MONTHLY' : scale === 'BUY' || buyWords ? 'TOTAL' : null;

  const cityKey = cityMentioned(s);
  const cities = cityKey ? [cityKey] : [];
  const places = placesMentioned(s);
  const districts = places.filter((p) => p.kind !== 'STREET' && !p.negated).map((p) => p.key);
  const streets = places.filter((p) => p.kind === 'STREET' && !p.negated).map((p) => p.key);
  const excludedPlaces = places.filter((p) => p.negated).map((p) => (p.kind === 'STREET' ? `street:${p.key}` : p.key));
  const locationFlexible = FLEX_LOCATION.test(s);
  /* "2+1" (Turkish / Georgian listings): two bedrooms and a living room — three rooms (v10). */
  const plusOne = numberNear(/(\d)\s*\+\s*1\b/u, s);
  const bedrooms = numberNear(/(\d{1,2})\s*-?\s*(?:bed(?:room)?s?\b|br\b|bhk\b|спальн|საძინებ|yatak odası|غرف? نوم|חדרי שינה)/iu, s) ?? plusOne
    /* "one-bedroom", "1+1 / 1 спальня", "studio": a stated bedroom count (v7: "1bhk" was missed). */
    ?? (WORD_BEDROOMS.find(([re]) => re.test(s))?.[1] ?? (/(?<![\p{L}])(studio|студи|სტუდიო)/iu.test(s) ? 0 : null));
  const rooms = numberNear(/(\d{1,2})\s*-?\s*(?:rooms?\b|комн|к\.|ოთახ|oda\b|غرف|חדרים|חד')/iu, s)
    ?? (plusOne != null ? plusOne + 1 : null) ?? (WORD_ROOMS.find(([re]) => re.test(s))?.[1] ?? null);
  const area = statedArea(s);
  const areaSqm = area ? area.max ?? area.min : null;

  const base = {
    realEstate: true, residential: propertyType === 'APARTMENT' || propertyType === 'HOUSE', propertyType,
    intermediary: AGENT.test(s.replace(new RegExp(NO_AGENTS.source, 'giu'), ' ')), budget, downPayment: downHit ? { amount: downHit.amount, currency: downHit.currency } : null,
    financing: INSTALMENTS.test(s) ? 'INSTALMENTS' as const : MORTGAGE.test(s) ? 'MORTGAGE' as const : null,
    cities, districts, streets, excludedPlaces, locationFlexible, rooms, bedrooms, areaSqm, area,
  };

  /* Direction: who is speaking — someone seeking, or someone offering. */
  const saleIdx = firstIndex(SALE_OFFER, s);
  const rentOfferIdx = firstIndex(RENT_OFFER, s);
  const offerIdx = [saleIdx, rentOfferIdx].filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? -1;
  let direction: 'SEEK' | 'OFFER' | null = null;
  if (seekIdx >= 0 && (offerIdx < 0 || seekIdx < offerIdx)) { direction = 'SEEK'; evidence.push('first_person_seeking'); }
  else if (offerIdx >= 0) { direction = 'OFFER'; evidence.push(saleIdx === offerIdx ? 'sale_offer_marker' : 'rent_offer_marker'); }
  if (direction === 'OFFER' && STRONG_SEEK.test(s) && !LISTING_CUES.test(s)) { direction = 'SEEK'; evidence.push('first_person_purchase_phrase'); }
  if (seeksForSale && direction !== 'SEEK') { direction = 'SEEK'; evidence.push('seeks_property_for_sale'); }
  /* "if you have one for sale, message me" is a seeker asking sellers. */
  if (direction === 'OFFER' && /(თუ გაქვთ|если у вас есть|if you have|eğer varsa|إذا كان لديك|אם יש לכם)/iu.test(s)) { direction = 'SEEK'; evidence.push('asks_sellers'); }
  if (!direction && asksSellers) { direction = 'SEEK'; evidence.push('asks_sellers'); }
  if (!direction && (BUY.test(s) || /(снять|to rent|kiralamak|استئجار|לשכור)/iu.test(s) || BUDGET_WORD.test(s)) && !LISTING_CUES.test(s)) {
    /* "купить квартиру …", "buy apartment …", "שراء شقة": an explicit purchase/rent
       verb or a stated budget, with no listing cues, is someone who wants one. */
    direction = 'SEEK'; evidence.push('intent_verb_or_budget');
  }
  if (!direction) {
    /* No verb either way: a price + spec line + contact/hashtags is a listing. */
    const listing = (budget != null && (rooms != null || bedrooms != null || areaSqm != null || districts.length > 0)) && (LISTING_CUES.test(s) || /\+?\d[\d\s-]{7,}\d/.test(s) || s.length < 160);
    if (listing) { direction = 'OFFER'; evidence.push('listing_structure'); }
  }
  if (!direction) {
    return { ...base, role: 'UNCLEAR', transaction: scale, evidence: [...evidence, 'no_direction'], confidence: 0.3, needsModel: true };
  }

  /* Transaction: explicit words first; a contradiction is settled by the money scale. */
  let transaction: 'BUY' | 'RENT' | null = null;
  if (direction === 'OFFER') {
    transaction = rentOfferIdx >= 0 && (saleIdx < 0 || rentOfferIdx <= saleIdx) ? 'RENT' : saleIdx >= 0 ? 'BUY' : scale ?? (rentWords && !buyWords ? 'RENT' : buyWords && !rentWords ? 'BUY' : null);
    if (saleIdx >= 0 && scale === 'RENT' && rentOfferIdx < 0) transaction = 'BUY';
  } else {
    if (buyWords && !rentWords) transaction = 'BUY';
    else if (rentWords && !buyWords) transaction = 'RENT';
    else if (buyWords && rentWords) transaction = scale ?? (firstIndex(BUY, s) < firstIndex(RENT, s) ? 'BUY' : 'RENT');
    else transaction = scale;
    if (scale && transaction && scale !== transaction && !(buyWords && !rentWords)) transaction = scale;
    if (transaction) evidence.push(buyWords || rentWords ? 'transaction_words' : 'transaction_money_scale');
  }

  if (direction === 'OFFER') {
    if (base.intermediary) evidence.push('agent_listing');
    return { ...base, role: transaction === 'RENT' ? 'RENT_OFFER' : transaction === 'BUY' ? 'SALE_OFFER' : 'SALE_OFFER',
      transaction, evidence, confidence: transaction ? 0.85 : 0.55, needsModel: transaction == null };
  }
  if (base.intermediary) {
    return { ...base, role: 'AGENT', transaction, evidence: [...evidence, 'seeking_for_client'], subtypes: statedSubtypes(base.propertyType, s), confidence: 0.8, needsModel: false };
  }
  if (!transaction) {
    return { ...base, role: 'UNCLEAR', transaction: null, evidence: [...evidence, 'transaction_unknown'], subtypes: statedSubtypes(base.propertyType, s), confidence: 0.4, needsModel: true };
  }
  return { ...base, role: transaction === 'BUY' ? 'BUY_SEEKER' : 'RENT_SEEKER', transaction, evidence,
    subtypes: statedSubtypes(base.propertyType, s), confidence: buyWords || rentWords ? 0.9 : 0.7, needsModel: false };
}

/** A home seeker whose buy-or-rent was never stated (or only guessed by the model). */
export function transactionUnconfirmed(r: Pick<DemandReading, 'role' | 'evidence' | 'realEstate'>): boolean {
  if (!r.realEstate) return false;
  if (r.evidence.includes('transaction_inferred')) return r.role === 'BUY_SEEKER' || r.role === 'RENT_SEEKER';
  return r.role === 'UNCLEAR' && r.evidence.includes('first_person_seeking') && r.evidence.includes('transaction_unknown');
}

/* ── comments in context ───────────────────────────────────────────────── */

const INTEREST = L([
  `${B}(interested|still available|is it available|available\\?|how much|price\\?|what is the price|can i (see|view)|viewing|send (me )?(the )?(price|details|location))`,
  'интересует', 'актуально', 'сколько стоит', 'какая цена', `${B}цена\\?`, 'можно посмотреть', 'просмотр', 'в лс', 'в личку',
  'დაინტერესებ', 'აქტუალურია', 'რა ღირს', 'ფასი\\?', 'რა ფასი', 'ნახვ(?!ამდის)', 'შეიძლება ნახვა', 'მომწერეთ ფასი',
  'ilgileniyorum', 'fiyat', 'ne kadar', 'hala satılık', 'görebilir miyim', 'مهتم', 'كم السعر', 'السعر', 'متاحة', 'معاينة',
  'מעוניין', 'מעוניינת', 'כמה עולה', 'מחיר', 'עדיין זמין', 'לראות',
]);
const HAVE_ONE = L([`${B}(i have|we have|i've got)`, 'у меня есть', 'есть вариант', 'მაქვს', 'გვაქვს', `${B}(bende var|elimde var)`, 'لدي', 'יש לי']);
/** A commenter offering their own property or options under someone's listing: a competitor. */
const SELF_OFFER_COMMENT = L([
  `${B}(i sell|i'?m selling|i have (a )?similar|i have (one|another|other)|we have (similar|options|other options|more options)|i can offer|check my (listing|page|profile))`,
  '(продаю|есть|у меня есть|у нас есть) (похож|аналогичн|другие вариант|ещ[её] вариант|вариант)', '(у меня|у нас) есть вариант', 'смотрите (мой|наш) профил',
  'მეც ვყიდი', 'ვყიდი მსგავს', 'მსგავსი მაქვს', 'მსგავსი გვაქვს', '(გვაქვს|მაქვს) (სხვა )?ვარიანტ', 'ჩემს გვერდზე',
  `${B}(benzerini satıyorum|benzeri var|seçeneklerimiz var)`, 'لدينا خيارات', 'عندي شقة مشابهة', 'لدي شقة مشابهة', 'יש לי דומה', 'יש לנו אפשרויות',
]);
const BARE_CONTACT = /^(?:\s|[.!?+👍🙏🔥❤️])*(pm|dm|pm me|dm me|call me|call|interested|\+|ლს|в лс|в личку|пм|მომწერეთ|დამირეკეთ|интересует|actual\??|актуально\??)(?:\s|[.!?+👍🙏🔥❤️])*$/iu;

/**
 * A comment under a post. Interest under a comparable SALE listing can be a
 * buyer; under a RENT listing a tenant; under someone's request it is a
 * seller/agent replying. A bare "PM me"/"+"/"interested" is never enough on
 * its own (UNCLEAR, not demand) — the comment must carry its own content.
 */
export function classifyComment(text: string | null | undefined, parent: { role: DemandRole | null; similarity: number } | null): DemandReading {
  const own = classifyDemand(text, { kind: 'COMMENT' });
  if (['JOB', 'SERVICE', 'AGENT', 'SALE_OFFER', 'RENT_OFFER'].includes(own.role)) return own;
  if (own.role === 'BUY_SEEKER' || own.role === 'RENT_SEEKER') return own;
  const s = String(text ?? '');
  if (!parent?.role) return { ...own, role: 'UNCLEAR', evidence: [...own.evidence, 'comment_without_parent'], needsModel: INTEREST.test(s) };
  if (parent.role === 'BUY_SEEKER' || parent.role === 'RENT_SEEKER') {
    /* Replies under a request are offers ("I have one, call me"). */
    const offering = INTEREST.test(s) || BARE_CONTACT.test(s) || HAVE_ONE.test(s) || /(call me|dm me|pm me|позвоните|напишите|დამირეკეთ|მომწერეთ|beni ara|اتصل بي|תתקשר)/iu.test(s);
    return { ...own, role: offering ? (parent.role === 'RENT_SEEKER' ? 'RENT_OFFER' : 'SALE_OFFER') : 'UNCLEAR', transaction: parent.role === 'RENT_SEEKER' ? 'RENT' : 'BUY',
      evidence: [...own.evidence, 'reply_under_request'], confidence: 0.6, needsModel: false };
  }
  /* An agent ("I am an agent with buyers") or a competitor ("I sell similar") replying
     under a listing is not an interested person, whatever interest words it uses. */
  if (parent.role === 'SALE_OFFER' || parent.role === 'RENT_OFFER') {
    if (AGENT.test(s)) return { ...own, role: 'AGENT', intermediary: true, evidence: [...own.evidence, 'agent_comment'], confidence: 0.8, needsModel: false };
    if (SELF_OFFER_COMMENT.test(s) || SALE_OFFER.test(s) || RENT_OFFER.test(s)) {
      return { ...own, role: parent.role, transaction: parent.role === 'RENT_OFFER' ? 'RENT' : 'BUY', evidence: [...own.evidence, 'competitor_comment'], confidence: 0.75, needsModel: false };
    }
  }
  if ((parent.role === 'SALE_OFFER' || parent.role === 'RENT_OFFER') && INTEREST.test(s)) {
    if (BARE_CONTACT.test(s)) {
      return { ...own, role: 'UNCLEAR', transaction: parent.role === 'RENT_OFFER' ? 'RENT' : 'BUY', evidence: [...own.evidence, 'bare_interest_no_context'], confidence: 0.35, needsModel: false };
    }
    return { ...own, role: parent.role === 'RENT_OFFER' ? 'RENT_SEEKER' : 'BUY_SEEKER', transaction: parent.role === 'RENT_OFFER' ? 'RENT' : 'BUY',
      realEstate: true, residential: true, evidence: [...own.evidence, 'interest_under_listing'], confidence: parent.similarity >= 70 ? 0.75 : 0.55, needsModel: false };
  }
  return { ...own, role: own.role === 'IRRELEVANT' ? 'IRRELEVANT' : 'UNCLEAR', evidence: [...own.evidence, 'comment_no_intent'], needsModel: false };
}

/* ── model, bounded ────────────────────────────────────────────────────── */

/** Roles a model verdict may NOT overturn: the rules saw positive evidence. */
const RULE_FINAL = new Set<DemandRole>(['JOB', 'SERVICE', 'SALE_OFFER', 'RENT_OFFER', 'AGENT', 'IRRELEVANT', 'BUY_SEEKER', 'RENT_SEEKER']);

/**
 * Apply a model's reading to an UNCLEAR rule reading. The model chooses a
 * role/transaction only; budgets, places and rooms always come from the text
 * (never from the model), so nothing is invented.
 */
export function boundModelReading(rule: DemandReading, model: { role?: unknown; transaction?: unknown } | null): DemandReading {
  if (!model || RULE_FINAL.has(rule.role) && !rule.needsModel) return { ...rule, needsModel: false };
  const role = String(model.role ?? '').toUpperCase() as DemandRole;
  if (!DEMAND_ROLES.includes(role)) return { ...rule, needsModel: false, evidence: [...rule.evidence, 'model_invalid'] };
  const tx = String(model.transaction ?? '').toUpperCase();
  let transaction: 'BUY' | 'RENT' | null = tx === 'BUY' ? 'BUY' : tx === 'RENT' ? 'RENT' : null;
  /* The money scale outranks the model on the transaction. */
  const maxUsd = rule.budget?.max != null ? toUsd({ amount: rule.budget.max, currency: rule.budget.currency }) : null;
  if (maxUsd != null && maxUsd <= RENT_SCALE_MAX_USD) transaction = 'RENT';
  if (maxUsd != null && maxUsd >= BUY_SCALE_MIN_USD) transaction = 'BUY';
  let finalRole = role;
  if ((role === 'BUY_SEEKER' || role === 'RENT_SEEKER') && !rule.realEstate) finalRole = 'IRRELEVANT';
  /* v7: a text in which the rules found no wish to buy or rent at all (no first-person
     seeking, no purchase verb, no budget — e.g. a developer's article, production lead
     b74a01b8, 2026-10-17) is never made a seeker by the model; it stays undecided. */
  if ((finalRole === 'BUY_SEEKER' || finalRole === 'RENT_SEEKER') && rule.evidence.includes('no_direction')) {
    return { ...rule, role: 'UNCLEAR', needsModel: false, evidence: [...rule.evidence, 'model_seeker_without_direction'] };
  }
  if (role === 'BUY_SEEKER' && transaction === 'RENT') finalRole = 'RENT_SEEKER';
  if (role === 'RENT_SEEKER' && transaction === 'BUY') finalRole = 'BUY_SEEKER';
  if ((finalRole === 'BUY_SEEKER' || finalRole === 'RENT_SEEKER') && !transaction) transaction = finalRole === 'BUY_SEEKER' ? 'BUY' : 'RENT';
  /* A first-person seeker who never said buy or rent: the model's transaction is a guess,
     kept as such so the person is "interested, needs verification", never a confirmed buyer
     or a dropped tenant (production signal "ვეძებ ბინას 3ოთახიანს ვარკეთილში", 2026-10-16). */
  const inferred = rule.evidence.includes('transaction_unknown') && maxUsd == null && (finalRole === 'BUY_SEEKER' || finalRole === 'RENT_SEEKER');
  return { ...rule, role: finalRole, transaction, needsModel: false, confidence: Math.min(0.75, rule.confidence + 0.3),
    evidence: [...rule.evidence, 'model_resolved', ...(inferred ? ['transaction_inferred'] : [])] };
}

export const DEMAND_MODEL_SCHEMA = {
  name: 'find_buyers_demand',
  strict: true,
  schema: {
    type: 'object', additionalProperties: false, required: ['items'],
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['id', 'role', 'transaction', 'reason'],
          properties: {
            id: { type: 'string' },
            role: { type: 'string', enum: [...DEMAND_ROLES] },
            transaction: { type: 'string', enum: ['BUY', 'RENT', 'UNKNOWN'] },
            reason: { type: 'string', maxLength: 160 },
          },
        },
      },
    },
  },
} as const;

export const DEMAND_SYSTEM_PROMPT = [
  'You read short public social-media posts/comments about real estate in Georgia (languages: Georgian, Russian, English, Arabic, Hebrew, Turkish).',
  'For each item decide who is speaking and what they want. Roles: BUY_SEEKER (the author personally wants to buy a home), RENT_SEEKER (wants to rent one),',
  'SALE_OFFER (offers a property for sale), RENT_OFFER (offers one for rent), AGENT (an intermediary acting for clients), SERVICE (offers a service),',
  'JOB (job seeking or hiring), IRRELEVANT (not about residential real estate), UNCLEAR (cannot tell).',
  'Seeking words alone ("looking for", "ищу", "ვეძებ") do not mean real estate. A monthly price, a lease term or a contract length means RENT.',
  'Choose BUY only when the text indicates purchasing. Never infer budgets, places or personal traits. Reason: max 20 words, factual.',
].join(' ');

/** For tests/diagnostics: the city keys we can recognise. */
export const KNOWN_CITIES = Object.keys(CITY_NAMES);
