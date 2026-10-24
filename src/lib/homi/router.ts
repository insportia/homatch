/*
 * HOMI ROUTER — decide, before any model is called, how a turn is answered.
 *
 *   1. DETERMINISTIC — a closed intent HOMATCH already has a written answer
 *      for (content.ts). No model, no tokens, no web.
 *   2. MODEL_LIGHT   — a short conversational turn with no sign of needing
 *      current external facts: lower reasoning effort, a one-search budget.
 *   3. MODEL_FULL    — everything else: research-shaped, long, or explicitly
 *      asking for current information.
 *
 * CONSERVATIVE BY DESIGN. A deterministic answer to the wrong question is
 * worse than a model call, so a pattern only wins when the message is short
 * and the match is unambiguous. Anything longer goes to the model, which
 * still has every product described in its prompt.
 *
 * Pure and runtime-neutral: shared by the edge function, the app and tests.
 */

import { isHomiIntent, type HomiDeterministicIntent } from './content.ts';

export type HomiRoute =
  | { kind: 'DETERMINISTIC'; intent: HomiDeterministicIntent; reason: 'CHIP' | 'PATTERN' }
  | { kind: 'MODEL'; tier: 'LIGHT' | 'FULL'; searchCue: boolean; intent: string | null };

/** Lowercase, strip punctuation/emoji, collapse spaces. Keeps every script we support. */
export function normaliseTurn(text: string): string {
  return text
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const words = (s: string) => (s ? s.split(' ').length : 0);

/* Whole-message patterns: the message IS this, nothing more. */
const WHOLE: Array<[HomiDeterministicIntent, RegExp]> = [
  ['GREETING', /^(hi|hello|hey|hiya|good (morning|afternoon|evening)|გამარჯობა|გაგიმარჯოს|სალამი|ჰეი|привет|здравствуй(те)?|добрый (день|вечер)|доброе утро|merhaba|selam|iyi günler|مرحبا|اهلا|أهلا|السلام عليكم|שלום|היי|הי)( (homi|ჰომი|хоми|هومي|הומי))?$/u],
  ['THANKS', /^(thanks?( a lot| so much)?|thank you( so much)?|thx|მადლობა( დიდი)?|დიდი მადლობა|გმადლობ(თ)?|спасибо( большое)?|благодарю|teşekkürler|teşekkür ederim|sağ ol|شكرا( جزيلا)?|شكرًا|תודה( רבה)?)$/u],
  ['GOODBYE', /^(bye|goodbye|see you|ნახვამდის|კარგად იყავი|пока|до свидания|hoşça kal|görüşürüz|مع السلامة|وداعا|ביי|להתראות)$/u],
];

/* Contained patterns, only for short messages. */
const IDENTITY = /(who are you|what are you|are you (a )?(human|person|real|bot|robot|ai)|who (made|created|built) you|ვინ ხარ|რა ხარ|ადამიანი ხარ|რობოტი ხარ|ბოტი ხარ|ვინ შეგქმნა|ვინ გაგაკეთა|кто ты|ты (человек|бот|робот)|кто тебя (создал|сделал)|sen kimsin|insan mısın|bot musun|seni kim (yaptı|yarattı)|من أنت|هل أنت (إنسان|روبوت)|من صنعك|מי אתה|אתה (בן אדם|רובוט|בוט)|מי יצר אותך)/u;
const MODEL_Q = /(chatgpt|gpt|openai|claude|anthropic|gemini|llm|which (ai|model)|what model|რომელი (მოდელი|ai)|რა მოდელ|какая (модель|нейросеть)|hangi (model|yapay)|أي نموذج|איזה מודל)/u;
const CAPABILITIES = /(what can you do|how can you help|what do you do|რა შეგიძლია|რაში დამეხმარები|რაში შეგიძლია|რას აკეთებ|что ты умеешь|чем (ты )?можешь помочь|neler yapabilirsin|ne yapabilirsin|ماذا تستطيع|بماذا تساعد|מה אתה יודע לעשות|במה אתה יכול לעזור)/u;
const CONTACT = /(contact|phone number|email address|how (do i|can i|to) (reach|contact)|საკონტაქტო|კონტაქტი|დაგიკავშირდე|ტელეფონის ნომერი|ელფოსტა|контакт|как (с вами )?связаться|номер телефона|iletişim|telefon numarası|nasıl ulaşırım|تواصل|رقم الهاتف|اتصال|יצירת קשר|מספר טלפון|איך ליצור קשר)/u;

const WHAT_IS = /(what is|what's|what does|tell me about|how does .* work|explain|რა არის|რას აკეთებს|როგორ მუშაობს|მომიყევი|ამიხსენი|что такое|что делает|как работает|расскажи (про|о)|nedir|ne işe yarar|nasıl çalışır|ما هو|ما هي|كيف يعمل|اشرح|מה זה|איך עובד|ספר לי על)/u;
const SERVICE_TOKENS: Array<[HomiDeterministicIntent, RegExp]> = [
  ['SERVICE_VERIFY', /(verify|ვერიფ|ქონების შემოწმ|верифа|проверк[аиу] (недвижимости|объекта)|mülk kontrol|فحص العقار|בדיקת נכס)/u],
  ['SERVICE_MORTGAGE', /(mortgage consultant|mortgage|იპოთეკ|ипотек|konut kredisi|ipotek|الرهن|משכנתא)/u],
  ['SERVICE_INVESTMENT', /(investment (analysis|intelligence)|საინვესტიციო|инвестиционн|yatırım analiz|تحليل الاستثمار|ניתוח השקעה)/u],
  ['SERVICE_CONTRACTS', /(contract (intelligence|analysis)|ხელშეკრულების ანალიზ|анализ договор|sözleşme analiz|تحليل العقود|ניתוח חוזה)/u],
  ['SERVICE_EXPATS', /(expat|relocation guide|გადმოსვლის გზამკვლევ|ემიგრანტ|экспат|переезд|taşınma rehberi|دليل الانتقال|מדריך למעבר)/u],
  ['SERVICE_FIND_BUYERS', /(find (a )?buyers?|find tenants?|მყიდველის მოძებნ|მოიჯარის მოძებნ|поиск покупател|alıcı bul|البحث عن مشتر|למצוא קונים)/u],
  ['SERVICE_BROKERS', /(brokers? directory|ბროკერ|брокер|emlakçı rehberi|دليل الوسطاء|מדריך המתווכים)/u],
  ['SERVICE_FIND_PROPERTY', /(find property|ქონების მოძებნ|поиск недвижимости|mülk arama|البحث عن عقار|חיפוש נכס)/u],
];

const MORTGAGE_DOCS = /((documents?|papers?|დოკუმენტ|документ|belge|evrak|مستند|وثائق|מסמכ).*(mortgage|loan|იპოთეკ|სესხ|ипотек|кредит|kredi|ipotek|الرهن|قرض|משכנתא|הלוואה))|((mortgage|loan|იპოთეკ|სესხ|ипотек|кредит|kredi|الرهن|قرض|משכנתא|הלוואה).*(documents?|დოკუმენტ|документ|belge|مستند|מסמכ))/u;
const MONTHLY = /(monthly payment|how much (will|would) i pay|ყოველთვიური შენატან|თვეში რამდენს გადავიხდი|ежемесячн(ый|ого) платеж|сколько (я )?буду платить|aylık taksit|ayda ne kadar|القسط الشهري|كم سأدفع شهري|החזר חודשי|כמה אשלם בחודש)/u;
const ROI = /(profitab|roi\b|rental yield|return on investment|მომგებიან|უკუგება|შემოსავლიან|доходност|выгодн|окупаем|karlı|getiri|kira getirisi|مربح|العائد|רווחי|תשואה)/u;
const FIND_HOME = /^(i want|i need|i'm looking for|im looking for|looking for|find me|show me)? ?(a |an )?(cheaper |cheap |affordable )?(apartment|flat|home|house|property)( please)?$|(უფრო იაფი|იაფი) (ბინა|სახლი)|ბინა მინდა|ბინას ვეძებ|ვეძებ ბინას|ბინის მოძებნა|ищу квартиру|хочу квартиру|квартиру подешевле|daire arıyorum|daha ucuz daire|ucuz ev|أبحث عن شقة|شقة أرخص|מחפש דירה|דירה זולה/u;

/* Signals that current external facts matter → the full tier. */
const SEARCH_CUE = /(today|current(ly)?|latest|news|202[5-9]|right now|price (in|of)|law|regulation|tax|company|developer|ltd|llc|search the web|google|დღეს|ამჟამად|ახალი ამბ|კანონ|გადასახად|კომპანი|დეველოპერ|შპს|сегодня|сейчас|новост|закон|налог|компани|застройщик|ооо|bugün|güncel|haber|kanun|vergi|şirket|müteahhit|اليوم|حاليا|أخبار|قانون|ضريبة|شركة|مطور|היום|עכשיו|חדשות|חוק|מיסוי|חברה|יזם|https?:)/u;

export interface RouteOptions {
  /** A chip's intent, sent by the client. Trusted only if it is in the closed set. */
  chipIntent?: unknown;
  /** The surface the chat lives on; workspace surfaces never short-circuit to generic answers. */
  surface?: string | null;
}

export function routeHomiTurn(text: string, opts: RouteOptions = {}): HomiRoute {
  if (isHomiIntent(opts.chipIntent)) return { kind: 'DETERMINISTIC', intent: opts.chipIntent, reason: 'CHIP' };

  const n = normaliseTurn(text);
  const w = words(n);
  const searchCue = SEARCH_CUE.test(n);
  /* Inside a workspace (mortgage, contract, investment) the person's question
     is about THEIR numbers or document — a canned product description would
     be the wrong answer, so only the social intents short-circuit there. */
  const inWorkspace = Boolean(opts.surface && opts.surface !== 'ai-assistant');

  if (n && w <= 6) {
    for (const [intent, re] of WHOLE) if (re.test(n)) return { kind: 'DETERMINISTIC', intent, reason: 'PATTERN' };
  }
  if (n && w <= 9 && !searchCue) {
    if (MODEL_Q.test(n)) return { kind: 'DETERMINISTIC', intent: 'MODEL_QUESTION', reason: 'PATTERN' };
    if (IDENTITY.test(n)) return { kind: 'DETERMINISTIC', intent: 'IDENTITY', reason: 'PATTERN' };
    if (!inWorkspace) {
      if (CAPABILITIES.test(n)) return { kind: 'DETERMINISTIC', intent: 'CAPABILITIES', reason: 'PATTERN' };
      /* "How do I contact the seller?" is about somebody else — that one is the model's. */
      if (CONTACT.test(n) && !/(seller|owner|agent|broker|landlord|developer|გამყიდველ|მესაკუთრე|აგენტ|ბროკერ|დეველოპერ|продав|собственник|агент|застройщик|satıcı|ev sahibi|emlakçı|البائع|المالك|الوسيط|מוכר|בעלים|מתווך)/u.test(n)) {
        return { kind: 'DETERMINISTIC', intent: 'CONTACT', reason: 'PATTERN' };
      }
      if (MORTGAGE_DOCS.test(n)) return { kind: 'DETERMINISTIC', intent: 'MORTGAGE_DOCS', reason: 'PATTERN' };
      if (MONTHLY.test(n)) return { kind: 'DETERMINISTIC', intent: 'MORTGAGE_QUICK', reason: 'PATTERN' };
      if (WHAT_IS.test(n) || w <= 3) {
        for (const [intent, re] of SERVICE_TOKENS) if (re.test(n)) return { kind: 'DETERMINISTIC', intent, reason: 'PATTERN' };
      }
      if (ROI.test(n)) return { kind: 'DETERMINISTIC', intent: 'ROI_QUICK', reason: 'PATTERN' };
      if (FIND_HOME.test(n)) return { kind: 'DETERMINISTIC', intent: 'FIND_PROPERTY', reason: 'PATTERN' };
    }
  }

  const light = !searchCue && n.length <= 160 && w <= 28;
  return { kind: 'MODEL', tier: light ? 'LIGHT' : 'FULL', searchCue, intent: null };
}
