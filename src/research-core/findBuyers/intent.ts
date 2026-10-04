// COMMENT / MESSAGE INTENT — a strict taxonomy, decided from the comment,
// its parent post and that post's similarity to the owner's property
// together. "Call me" means nothing on its own.
//
// Deterministic rules settle the clear cases at zero cost (praise, agents,
// sellers, explicit requests, price questions under a comparable listing);
// only ambiguous text is sent to the model, and the model's verdict is still
// bounded by context here (it cannot make a commenter under an unrelated post
// a high-intent buyer).

export const INTENT_CLASSES = [
  'BUYER_HIGH', 'BUYER_MEDIUM', 'TENANT_HIGH', 'TENANT_MEDIUM', 'QUESTION',
  'AGENT', 'SELLER', 'OWNER', 'SERVICE_PROVIDER', 'NOISE', 'UNCERTAIN',
] as const;
export type IntentClass = typeof INTENT_CLASSES[number];

export const QUALIFYING: ReadonlySet<IntentClass> = new Set(['BUYER_HIGH', 'BUYER_MEDIUM', 'TENANT_HIGH', 'TENANT_MEDIUM']);

export const INTENT_SCORE: Readonly<Record<IntentClass, number>> = {
  BUYER_HIGH: 92, TENANT_HIGH: 92, BUYER_MEDIUM: 68, TENANT_MEDIUM: 68, QUESTION: 35, UNCERTAIN: 20,
  OWNER: 5, SELLER: 3, AGENT: 3, SERVICE_PROVIDER: 2, NOISE: 0,
};

export interface IntentContext {
  campaign: 'SALE' | 'RENT';
  kind: 'POST' | 'COMMENT' | 'MESSAGE';
  /** For a comment: the parent's similarity to the owner's property. */
  parentSimilarity: number | null;
  /** For a comment: did the parent offer a property or ask for one? */
  parentStance: 'OFFER' | 'REQUEST' | null;
}

export interface IntentVerdict {
  intentClass: IntentClass;
  score: number;
  method: 'RULE' | 'MODEL' | 'MODEL_BOUNDED' | 'UNDECIDED';
  rule: string | null;
  needsModel: boolean;
}

const strip = (s: string) => s.replace(/https?:\/\/\S+/g, ' ').replace(/[@#][\p{L}\p{N}_.]+/gu, ' ');
const lettersOf = (s: string) => (strip(s).match(/\p{L}/gu) ?? []).length;

const PRAISE = /^(?:\s|[\p{Extended_Pictographic}‍️!.]|beautiful|nice|wow|great|super|cool|amazing|love it|congrats|красота|класс|супер|отлично|шикарно|მაგარია|ლამაზია|ძალიან ლამაზი|გილოცავ|harika|güzel|süper|جميل|رائع|ما شاء الله|יפה|מהמם|וואו)+$/iu;
const AGENT = /(i am an? (agent|realtor|broker)|i'm an? (agent|realtor|broker)|real estate agent|our agency|we have (more|other|many) (apartments|options|properties)|риелтор|риэлтор|агентств|агент по недвижимости|у нас есть варианты|უძრავი ქონების აგენტ|სააგენტო|აგენტი ვარ|emlakçı|emlak ofisi|danışman|وسيط عقاري|مكتب عقار|לדעתי מתווך|מתווך|משרד תיווך)/i;
const SERVICE = /(mortgage|ипотек|იპოთეკ|kredi|تمويل|משכנתא|renovation|ремонт|რემონტ|tadilat|furniture|мебел|ავეჯ|moving company|переезд услуги|cleaning|уборк)/i;
const SELLER = /(i (also )?(have|sell|am selling)|selling my|продаю|продам|сдаю|сдам|у меня есть квартира|ვყიდი|ვაქირავებ|მაქვს ბინა|satıyorum|kiraya veriyorum|أبيع|أؤجر|لدي شقة|מוכר|משכיר|יש לי דירה)/i;
const OWNER = /(i('| a)m the owner|owner here|собственник|хозяин|მესაკუთრე ვარ|sahibiyim|أنا المالك|אני הבעלים)/i;
const REQUEST = /(looking for|looking to (buy|rent)|i need an?|need (a|an) (flat|apartment|house)|want to (buy|rent)|searching for|ищу|ищем|куплю|сниму|нужна квартира|хочу (купить|снять)|ვეძებ|ვეძებთ|მჭირდება|ვყიდულობ|ვქირაობ|მინდა (ვიყიდო|ვიქირაო)|arıyorum|arıyoruz|almak istiyorum|kiralamak istiyorum|أبحث|ابحث|نبحث|أريد شراء|أريد استئجار|מחפש|מחפשת|מחפשים|רוצה לקנות|רוצה לשכור)/i;
const SIMILAR = /(something similar|similar (one|apartment|flat)|like this|что-то похожее|похожую|подобн|მსგავს|benzer|مشابه|مثل هذا|דומה)/i;
const INTEREST = /(interested|i'?m interested|still available|is it available|send (me )?(the )?price|price\??|how much|dm me|pm me|inbox|интересно|интересует|актуально|сколько стоит|цена\??|в лс|в личку|დაინტერესებული|ფასი\??|რა ღირს|აქტუალურია|მომწერეთ|ilgileniyorum|fiyat|ne kadar|hala satılık|dm|مهتم|كم السعر|السعر|ما زالت متاحة|راسلني|מעוניין|מעוניינת|כמה עולה|מחיר|עדיין זמין|פרטי)/i;
const PRICE_ASK = /(price|how much|цена|сколько|ფასი|რა ღირს|fiyat|ne kadar|سعر|كم|מחיר|כמה)/i;
const CALL_ME = /^(?:\s|[.!])*(call me|call|dm|pm|позвоните|звоните|напишите|в лс|დამირეკეთ|მომწერეთ|beni ara|ara|اتصل بي|راسلني|תתקשרו|תתקשר)(?:\s|[.!])*$/i;
const QUESTION = /\?|^(where|when|which|is|are|does|где|когда|какой|სად|როდის|nerede|ne zaman|أين|متى|איפה|מתי)\b/i;

function tenantize(c: IntentClass, campaign: 'SALE' | 'RENT'): IntentClass {
  if (campaign === 'RENT') {
    if (c === 'BUYER_HIGH') return 'TENANT_HIGH';
    if (c === 'BUYER_MEDIUM') return 'TENANT_MEDIUM';
  } else {
    if (c === 'TENANT_HIGH') return 'BUYER_HIGH';
    if (c === 'TENANT_MEDIUM') return 'BUYER_MEDIUM';
  }
  return c;
}

const verdict = (c: IntentClass, method: IntentVerdict['method'], rule: string | null, needsModel = false): IntentVerdict =>
  ({ intentClass: c, score: INTENT_SCORE[c], method, rule, needsModel });

/** Rules first. needsModel=true means "the text is ambiguous; ask the model". */
export function classifyByRules(text: string, ctx: IntentContext): IntentVerdict {
  const s = String(text ?? '').trim();
  if (!s || lettersOf(s) === 0 || PRAISE.test(s)) return verdict('NOISE', 'RULE', 'praise_or_empty');
  if (AGENT.test(s)) return verdict('AGENT', 'RULE', 'agent_marker');
  if (OWNER.test(s)) return verdict('OWNER', 'RULE', 'owner_marker');
  if (SELLER.test(s) && !REQUEST.test(s)) return verdict('SELLER', 'RULE', 'seller_marker');
  if (SERVICE.test(s) && !REQUEST.test(s)) return verdict('SERVICE_PROVIDER', 'RULE', 'service_marker');

  const sim = ctx.parentSimilarity ?? 0;
  const high = (ctx.campaign === 'RENT' ? 'TENANT_HIGH' : 'BUYER_HIGH') as IntentClass;
  const medium = (ctx.campaign === 'RENT' ? 'TENANT_MEDIUM' : 'BUYER_MEDIUM') as IntentClass;

  if (REQUEST.test(s)) {
    /* An explicit request is strong demand. Under someone else's REQUEST it
       is a peer asking too (still demand); under an offer it is interest. */
    if (ctx.kind !== 'COMMENT' || SIMILAR.test(s) || sim >= 70) return verdict(high, 'RULE', 'explicit_request');
    return verdict(medium, 'RULE', 'request_under_unrelated_post');
  }

  if (ctx.kind === 'COMMENT' && CALL_ME.test(s)) {
    /* "Call me" under a buyer's request is someone offering; under a
       comparable listing it is interest; otherwise unknowable. */
    if (ctx.parentStance === 'REQUEST') return verdict('SELLER', 'RULE', 'call_me_under_request');
    if (ctx.parentStance === 'OFFER' && sim >= 70) return verdict(medium, 'RULE', 'call_me_under_listing');
    return verdict('UNCERTAIN', 'RULE', 'call_me_no_context');
  }

  if (ctx.kind === 'COMMENT' && INTEREST.test(s)) {
    if (ctx.parentStance === 'REQUEST') return verdict('UNCERTAIN', 'RULE', 'interest_under_request', true);
    if (sim >= 85 && (PRICE_ASK.test(s) || SIMILAR.test(s)) && /interest|интерес|დაინტერეს|ilgilen|مهتم|מעוניין|available|актуально|აქტუალ|متاح|זמין/i.test(s)) {
      return verdict(high, 'RULE', 'interest_and_price_under_comparable');
    }
    if (sim >= 70) return verdict(medium, 'RULE', 'interest_under_comparable');
    return verdict('QUESTION', 'RULE', 'interest_under_unrelated_post');
  }

  if (QUESTION.test(s)) return verdict('QUESTION', 'RULE', 'question', true);
  return verdict('UNCERTAIN', 'UNDECIDED', null, true);
}

/**
 * Bound a model verdict by context. The model reads language; this function
 * keeps the business rules: a commenter under a non-comparable post is never
 * HIGH, and the campaign's counterpart decides BUYER vs TENANT wording.
 */
export function boundModelVerdict(modelClass: unknown, ctx: IntentContext): IntentVerdict {
  const raw = String(modelClass ?? '').toUpperCase() as IntentClass;
  if (!INTENT_CLASSES.includes(raw)) return verdict('UNCERTAIN', 'MODEL_BOUNDED', 'model_invalid_class');
  let c = tenantize(raw, ctx.campaign);
  if (ctx.kind === 'COMMENT') {
    const sim = ctx.parentSimilarity ?? 0;
    if ((c === 'BUYER_HIGH' || c === 'TENANT_HIGH') && sim < 70) {
      c = ctx.campaign === 'RENT' ? 'TENANT_MEDIUM' : 'BUYER_MEDIUM';
      return verdict(c, 'MODEL_BOUNDED', 'high_capped_by_parent_similarity');
    }
  }
  return verdict(c, 'MODEL', null);
}

/** The schema the model must answer with (strict structured output). */
export const INTENT_MODEL_SCHEMA = {
  name: 'find_buyers_intent',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'intent_class', 'language', 'reason'],
          properties: {
            id: { type: 'string' },
            intent_class: { type: 'string', enum: [...INTENT_CLASSES] },
            language: { type: 'string', enum: ['ka', 'ru', 'en', 'ar', 'he', 'tr', 'other'] },
            reason: { type: 'string', maxLength: 160 },
          },
        },
      },
    },
  },
} as const;

export const INTENT_SYSTEM_PROMPT = [
  'You classify short public social-media comments/posts about real estate in Georgia.',
  'Each item has: campaign (SALE = owner wants buyers, RENT = owner wants tenants), kind, text, and for comments the parent post excerpt and parent_similarity (0-100: how close the parent post property is to the owner property).',
  'Classes: BUYER_HIGH/BUYER_MEDIUM (wants to buy), TENANT_HIGH/TENANT_MEDIUM (wants to rent), QUESTION (asks without expressing intent), AGENT, SELLER, OWNER, SERVICE_PROVIDER, NOISE (praise, emoji, unrelated), UNCERTAIN.',
  'Use the parent context: "call me" under a listing can be interest; under someone looking for a flat it is a seller/agent.',
  'HIGH only for explicit, specific intent (wants this or similar property, asks price/availability with interest).',
  'Never infer sensitive traits. Reason: max 20 words, factual.',
].join(' ');
