/*
 * HOMI TURN POLICY: does this turn get the internet, and which HOMATCH
 * service does it belong to?
 *
 * WHY THIS IS DECIDED IN CODE
 *
 * The web_search tool used to be offered on every model turn with
 * tool_choice "auto", and the prompt asked the model to search "only when
 * useful". It searched anyway. "Find me an apartment" came back as a list of
 * other portals' listings, which is the one answer HOMATCH must never give:
 * finding a property IS a HOMATCH service (Find Property), and so is finding
 * a buyer or a tenant.
 *
 * So the decision moved out of the model. The tool is only offered when the
 * question genuinely needs live data (an exchange rate, the current state of
 * a law or a tax, news, a company or developer background check, or the
 * person explicitly asking to check online). Everything else is answered
 * from HOMATCH's own context, products and stable knowledge, and a turn that
 * asks for a service is routed to that service.
 *
 * ORDER MATTERS. A property search beats a live-data cue ("find me a flat in
 * Vake, what are prices today" is still a Find Property request). Only an
 * explicit "search the web" or a pasted link opens the web for it.
 *
 * Pure and runtime-neutral: imported by the edge function, the app and tests.
 */

import { normaliseTurn } from './router.ts';
import type { ServiceActionId } from '../ai/serviceActions.ts';

export type WebDecision = 'ON' | 'OFF';

export type TurnPolicyReason =
  | 'PROPERTY_ANALYSIS'
  | 'EXPLICIT_WEB'
  | 'PROPERTY_SEARCH'
  | 'FIND_BUYERS'
  | 'LIVE_DATA'
  | 'LEGAL_OR_TAX'
  | 'COMPANY_CHECK'
  | 'INTERNAL';

export interface TurnPolicy {
  web: WebDecision;
  reason: TurnPolicyReason;
  /** The HOMATCH service this turn belongs to, when there is one. */
  service: ServiceActionId | null;
}

/* ── Signals ─────────────────────────────────────────────────────────── */

/** The person explicitly asked to look online, or pasted a link. */
const EXPLICIT_WEB = /(https?:|www\.|search (the )?(web|internet|online)|google (it|this)|check (it )?online|look (it |this )?up online|on the internet|ინტერნეტში|ონლაინ (მოძებნე|ნახე|გადაამოწმე|შეამოწმე)|гугл|погугли|в интернете|поищи в сети|internette|google'?da|ابحث (في|على) (الإنترنت|الانترنت|جوجل)|على الإنترنت|חפש באינטרנט|בגוגל|באינטרנט)/u;

/* An owner who wants a buyer or a tenant: checked BEFORE a property search,
   because "I want to rent out my flat" contains "flat" too. */
const FIND_BUYERS = new RegExp([
  'find (a |some |me )?(buyers?|tenants?)', 'looking for (a )?(buyers?|tenants?)', 'sell (my|our|the) (flat|apartment|house|home|property)',
  'selling (my|our) ', 'rent out', 'let out', 'want to sell',
  'მყიდველ\\S* (მოძებნ|მომიძებნ|ვეძებ|მინდა|მჭირდება|ვიპოვო)', 'მოიჯარე\\S* (მოძებნ|მომიძებნ|ვეძებ|მინდა|მჭირდება|ვიპოვო)',
  '(მოძებნ|მომიძებნ|ვეძებ|ვიპოვო)\\S* (მყიდველ|მოიჯარე)', 'გავყიდო', 'ვყიდი (ჩემს |ჩემი )?(ბინ|სახლ|ქონ)', 'გავაქირავო', 'ვაქირავებ',
  'найти (покупател|арендатор|жильц)', 'ищу (покупател|арендатор|жильц)', 'продать (мою|свою|нашу|квартир|дом)', 'сдать (мою|свою|квартир|дом)',
  'alıcı bul', 'kiracı bul', '(evimi|dairemi|mülkümü) (satmak|sat|kiraya)', 'kiraya vermek',
  'أبحث عن (مشتر|مستأجر)', 'ابحث عن (مشتر|مستأجر)', 'أريد (بيع|تأجير) ', 'اريد (بيع|تأجير) ',
  'למצוא (קונה|קונים|שוכר|שוכרים)', 'מחפש (קונה|שוכר)', 'רוצה (למכור|להשכיר)',
].join('|'), 'u');

/* Somebody looking for a place: a "looking/want/find" verb and a property noun,
   in either order, in any of the six languages. */
const SEEK_VERB = new RegExp([
  '\\b(find|search(ing)? for|look(ing)? for|show me|recommend|(want|need|wish|would like|planning) to (buy|rent)|buy(ing)? (a|an|some)|rent(ing)? (a|an|some))\\b',
  '\\bi(\'m| am)? (want|need|would like) (a|an|some)\\b',
  'ვეძებ', 'მოძებნ', 'მომიძებნ', 'მომინახ', 'მაჩვენ', 'მინდა', 'მჭირდება', 'ვიყიდ', 'ვიქირავ', 'ქირით', 'შევიძინ', 'საყიდლად', 'საქირავებლად',
  'ищу', 'найди', 'найти', 'подбер', 'покажи', 'хочу', 'нужн', 'купить', 'куплю', 'снять', 'сниму', 'арендовать',
  'arıyorum', '(^| )bul( |$)', 'bulur musun', 'göster', 'istiyorum', 'lazım', 'satın al', 'almak', 'kiralamak', 'kiralık',
  'أبحث', 'ابحث', 'أريد', 'اريد', 'أحتاج', 'احتاج', 'اعثر', 'أعثر', 'شراء', 'استئجار', 'أشتري', 'اشتري', 'استأجر',
  'מחפש', 'מחפשת', 'תמצא', 'למצוא', 'רוצה', 'צריך', 'צריכה', 'לקנות', 'לשכור',
].join('|'), 'u');
const PROPERTY_NOUN = new RegExp([
  '(^| )(an? )?(apartments?|flats?|house|houses|home|homes|property|properties|studio|studios|villa|villas|penthouse|cottage|land plot|plot of land|room to rent|place to live)( |$)',
  'ბინ', 'სახლ', 'აგარაკ', 'ნაკვეთ', 'კოტეჯ', 'ოთახიან', 'საცხოვრებელ',
  'квартир', '(^| )дом( |а |$)', 'жиль', 'недвижимост', 'студи', 'участок', 'коттедж',
  'daire', '(^| )ev( |i |$)', 'konut', 'emlak', 'mülk', 'villa', 'arsa', 'stüdyo',
  'شقة', 'شقه', 'منزل', '(^| )بيت( |$)', 'عقار', 'فيلا', 'استوديو',
  'דירה', 'דירת', '(^| )בית( |$)', 'נכס', 'וילה', 'סטודיו', 'מגרש',
].join('|'), 'u');
/* "my flat" questions are about a property they own, not a search. */
const OWN_PROPERTY = /(my (flat|apartment|house|home|property)|ჩემი (ბინ|სახლ|ქონ)|ჩემს (ბინ|სახლ|ქონ)|ჩემი ბინის|моя квартира|мою квартиру|моего дома|evim|dairem|شقتي|منزلي|הדירה שלי|הבית שלי)/u;
/* "this flat" is a question about one property already on the table. */
const THIS_PROPERTY = /(\b(this|that) (flat|apartment|house|home|property)\b|(^| )ეს (ბინა|სახლი|ქონება)|(^| )ამ (ბინ|სახლ|ქონ)|эта квартира|эту квартиру|этой квартир|этот дом|bu daire|bu ev|هذه الشقة|هذا المنزل|هذا العقار|הדירה הזו|הדירה הזאת|הנכס הזה)/u;
/* "home loan" is a mortgage, not a home. */
const HOME_LOAN = /\bhome loans?\b/g;

/** Live data: the only reason, besides an explicit request, to go online. */
const LIVE_DATA = /(\b(exchange rate|currency rate|rate of the (lari|dollar|euro)|today|right now|currently|at the moment|latest|news|this (week|month|year))\b|202[5-9]|გაცვლითი კურს|ლარის კურს|დოლარის კურს|ევროს კურს|კურსი|დღეს|ამჟამად|ამ წუთას|უახლეს|სიახლე|ახალი ამბ|курс (доллара|лари|евро|валют)|обменный курс|сегодня|сейчас|на данный момент|последни[ея]|новост|döviz kuru|kur ne|bugün|şu an|şu anda|güncel|son dakika|haber|سعر الصرف|سعر الدولار|اليوم|حاليا|حالياً|الآن|آخر الأخبار|أخبار|שער (ה)?חליפין|שער הדולר|היום|עכשיו|כרגע|עדכני|חדשות)/u;

/** The current state of a law, a regulation or a tax can change: worth checking. */
const LEGAL_OR_TAX = /(\b(laws?|legislation|regulations?|legal requirements?|tax|taxes|duty|duties)\b|კანონ|რეგულაცი|გადასახად|საგადასახადო|закон|законодательств|налог|пошлин|kanun|yasa|yönetmelik|vergi|قانون|تشريع|ضريبة|رسوم|חוק|חקיקה|תקנ|מס )/u;

/** A company, developer or person background check is research by definition. */
const COMPANY_CHECK = /(\b(company|companies|developer|developers|ltd|llc|construction firm)\b|შპს|კომპანი|დეველოპერ|სამშენებლო|компани|застройщик|девелопер|ооо|şirket|müteahhit|inşaat firması|شركة|مطور|المطور|חברה|יזם|קבלן)/u;

/* Services a question can be ABOUT, without being a search (used for the
   card and the service hint; never to open the web). */
const SERVICE_SIGNALS: Array<[ServiceActionId, RegExp]> = [
  ['VERIFY', /(verify|verification|check (the |this |a )?(property|flat|apartment|owner|ownership|cadastr)|ვერიფ|გადამოწმ|ქონების შემოწმ|მესაკუთრე|საკადასტრო|верифи|проверить (квартир|недвижим|собственник)|кадастр|mülk kontrol|tapu|التحقق من العقار|فحص العقار|בדיקת נכס|לאמת)/u],
  ['CONTRACT_INTELLIGENCE', /(contract|agreement|clause|ხელშეკრულებ|პუნქტ|договор|пункт договора|sözleşme|عقد|חוזה|סעיף)/u],
  ['MORTGAGE', /(mortgage|home loan|monthly payment|იპოთეკ|სესხ|ипотек|кредит на|konut kredisi|ipotek|الرهن|قرض|משכנתא)/u],
  ['INVESTMENT', /(invest|roi|rental yield|return on|profitab|ინვესტ|საინვესტიციო|მომგებიან|უკუგებ|инвест|доходност|окупаем|yatırım|getiri|استثمار|العائد|השקע|תשואה)/u],
  ['FOR_EXPATS', /(moving to georgia|move to georgia|relocat|expat|residence permit|საქართველოში გადმოსვლ|გადმოსახლ|ემიგრანტ|переезд|переехать|внж|taşın|oturma izni|الانتقال إلى جورجيا|الإقامة|לעבור לגאורגיה|רילוקיישן)/u],
  ['BROKERS', /(broker|realtor|real estate agent|ბროკერ|აგენტ|რიელტორ|брокер|риелтор|риэлтор|emlakçı|وسيط|سمسار|מתווך)/u],
  ['META_ADS', /(facebook ad|instagram ad|meta ad|advertis|ფეისბუქ|რეკლამ|реклам|reklam|إعلان|פרסום|מודעה)/u],
  ['CONTACT', /(contact (homatch|you|support)|support team|დაგიკავშირდე|კონტაქტ|связаться с вами|iletişim|تواصل معكم|ליצור קשר)/u],
];

/** The first service a piece of text is clearly about, or null. */
export function detectService(text: string): ServiceActionId | null {
  const n = normaliseTurn(text).replace(HOME_LOAN, 'mortgage');
  if (!n) return null;
  if (FIND_BUYERS.test(n)) return 'FIND_BUYERS_TENANTS';
  if (SEEK_VERB.test(n) && PROPERTY_NOUN.test(n) && !OWN_PROPERTY.test(n) && !THIS_PROPERTY.test(n)) return 'FIND_PROPERTY';
  for (const [id, re] of SERVICE_SIGNALS) if (re.test(n)) return id;
  return null;
}

/* Product names as HOMI writes them in a reply. Narrower than the question
   signals on purpose: a reply that merely uses the word "contract" is not
   recommending Contract Intelligence. */
const PRODUCT_NAMES: Array<[ServiceActionId, RegExp]> = [
  ['VERIFY', /(\bverify\b|ვერიფ|верифай|\/verify)/iu],
  ['FIND_PROPERTY', /(find property|ქონების მოძებნ|поиск недвижимости|mülk arama|البحث عن عقار|חיפוש נכס|\/find-property)/iu],
  ['FIND_BUYERS_TENANTS', /(find buyers|მყიდველის ან მოიჯარის|მყიდველის მოძებნ|поиск покупател|alıcı bul|البحث عن مشتر|למצוא קונים|\/property\/add)/iu],
  ['CONTRACT_INTELLIGENCE', /(contract intelligence|ხელშეკრულების ანალიზ|анализ договор|sözleşme analiz|تحليل العقود|ניתוח חוזה|\/contracts)/iu],
  ['MORTGAGE', /(homatch mortgage|იპოთეკის კალკულატორ|ипотечный калькулятор|\/mortgage)/iu],
  ['INVESTMENT', /(investment analysis|საინვესტიციო ანალიზ|инвестиционный анализ|yatırım analiz|تحليل الاستثمار|ניתוח השקעה|\/investment)/iu],
  ['FOR_EXPATS', /(my georgia|moving to georgia|\/for-expats|\/my-georgia)/iu],
  ['BROKERS', /(brokers directory|ბროკერების ნახვა|\/brokers)/iu],
];

/** Every HOMATCH product a finished reply names, in catalogue order. */
export function servicesNamedIn(reply: string): ServiceActionId[] {
  const out: ServiceActionId[] = [];
  for (const [id, re] of PRODUCT_NAMES) if (re.test(reply)) out.push(id);
  return out;
}

export interface TurnPolicyOptions {
  /** The paid property analysis inside Find Property keeps its web rules. */
  marketplace?: boolean;
}

/**
 * The one decision. Web is OFF unless the turn genuinely needs live data.
 */
export function decideTurnPolicy(text: string, opts: TurnPolicyOptions = {}): TurnPolicy {
  if (opts.marketplace) return { web: 'ON', reason: 'PROPERTY_ANALYSIS', service: null };
  const n = normaliseTurn(text);
  const service = detectService(text);
  if (!n) return { web: 'OFF', reason: 'INTERNAL', service: null };

  // A pasted link or "check online" is honoured whatever the topic.
  if (EXPLICIT_WEB.test(n) || /https?:|www\./i.test(text)) return { web: 'ON', reason: 'EXPLICIT_WEB', service };

  // Finding a place, a buyer or a tenant is HOMATCH's own work: never the web.
  if (service === 'FIND_PROPERTY') return { web: 'OFF', reason: 'PROPERTY_SEARCH', service };
  if (service === 'FIND_BUYERS_TENANTS') return { web: 'OFF', reason: 'FIND_BUYERS', service };

  if (LIVE_DATA.test(n)) return { web: 'ON', reason: 'LIVE_DATA', service };
  if (LEGAL_OR_TAX.test(n)) return { web: 'ON', reason: 'LEGAL_OR_TAX', service };
  if (COMPANY_CHECK.test(n)) return { web: 'ON', reason: 'COMPANY_CHECK', service };

  return { web: 'OFF', reason: 'INTERNAL', service };
}

/** Human-readable product names for the prompt hint (English, model-facing only). */
export const SERVICE_PROMPT_NAME: Readonly<Record<ServiceActionId, string>> = Object.freeze({
  VERIFY: 'Verify (/verify)',
  CONTRACT_INTELLIGENCE: 'Contract Intelligence (/contracts)',
  INVESTMENT: 'Investment Analysis (/investment)',
  MORTGAGE: 'Mortgage (/mortgage)',
  FIND_PROPERTY: 'Find Property (/find-property)',
  FIND_BUYERS_TENANTS: 'Find buyers or tenants (/property/add)',
  BROKERS: 'Brokers (/brokers)',
  META_ADS: 'Meta Ads (/outreach/meta)',
  FOR_EXPATS: 'Moving to Georgia / My Georgia (/for-expats/georgia)',
  CONTACT: 'Contact (/contact)',
});

/** The per-turn prompt lines that state the policy to the model. */
export function turnPolicyPrompt(policy: TurnPolicy): string {
  const lines: string[] = [];
  if (policy.web === 'OFF') {
    lines.push('WEB THIS TURN: OFF. HOMATCH decided this turn does not need live internet data, so you have no search tool. Answer from PAGE CONTEXT, HOMATCH INTERNAL DATA, HOMATCH\'s own services and stable knowledge. Never say or imply that you searched or checked online, and never send the person to other websites or property portals.');
  } else {
    lines.push(`WEB THIS TURN: AVAILABLE (${policy.reason}). Use it only for the live part of the question; everything HOMATCH already knows comes first.`);
  }
  if (policy.service === 'FIND_PROPERTY') {
    lines.push('THIS TURN IS A PROPERTY SEARCH. Finding a property is HOMATCH\'s own service, Find Property: the person describes what they want and HOMATCH builds an editable search plan and searches for them. Do not list, invent or quote specific listings, and never recommend other portals or agencies. In two or three short sentences say what HOMATCH will do for them, then ask the ONE most useful missing detail (city or district, budget, rooms, buy or rent). Include FIND_PROPERTY in suggested_actions, and make suggested_replies the likely answers to your question (for example city names, budget ranges, room counts).');
  } else if (policy.service === 'FIND_BUYERS_TENANTS') {
    lines.push('THIS TURN IS AN OWNER LOOKING FOR A BUYER OR TENANT. That is HOMATCH\'s own service: they add the property and HOMATCH finds potentially interested people whose stated needs fit it. Never call anybody a confirmed buyer. Briefly explain the next step, ask the one most useful missing detail, and include FIND_BUYERS_TENANTS in suggested_actions.');
  } else if (policy.service) {
    lines.push(`THIS TURN TOUCHES A HOMATCH SERVICE: ${SERVICE_PROMPT_NAME[policy.service]}. Answer the question itself first; if that product is the natural next step, include ${policy.service} in suggested_actions.`);
  }
  return lines.join('\n');
}
