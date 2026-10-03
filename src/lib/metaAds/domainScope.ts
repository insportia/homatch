// META ADS — MAY THIS AD RUN? HOMATCH Ads advertise a HOMATCH property or any
// other lawful product, service or business. Pure and deterministic: the same
// function runs in the builder (to say so early, kindly) and in meta-ads-api
// preflight and launch (where it decides). No text leaves HOMATCH to classify it.
//
//   ALLOWED                 a HOMATCH property, a property offer, a real-estate
//                           service, or any ordinary lawful product / service /
//                           business — no real-estate signal is needed
//   NEEDS_REVIEW            a high-risk word next to a property, or high-risk
//                           and real-estate words mixed — a person decides
//                           (meta_moderation_cases, reason DOMAIN_SCOPE)
//   BLOCKED_OUT_OF_SCOPE    high-risk with nothing tying it to a property:
//                           gambling, betting, adult, drugs, crypto / trading —
//                           never launched
//
// High-risk words are blocked outright only when nothing ties the ad to a
// property; a property ad that merely mentions one ("next to the casino")
// goes to a person instead of being refused.

export type DomainDecision = 'ALLOWED' | 'NEEDS_REVIEW' | 'BLOCKED_OUT_OF_SCOPE';

export interface DomainInput {
  /** The campaign advertises one of the owner's HOMATCH properties. */
  hasProperty: boolean;
  /** The builder's offer: { isProperty, dealKind, title }. */
  offer?: { isProperty?: boolean; dealKind?: string | null; title?: string | null } | null;
  /** Ad copy: headlines, primary text, descriptions; the owner's brief. */
  texts: Array<string | null | undefined>;
}

export interface DomainVerdict {
  decision: DomainDecision;
  /** One code a person and the customer copy can both read. */
  reason:
    | 'HOMATCH_PROPERTY' | 'PROPERTY_OFFER' | 'REAL_ESTATE_SERVICE'
    | 'HIGH_RISK_NEXT_TO_PROPERTY' | 'MIXED_SIGNALS' | 'GENERAL_OFFER'
    | 'GAMBLING' | 'ADULT' | 'DRUGS' | 'CRYPTO_TRADING'
    /* No longer decided; kept so verdicts stored before the change still read. */
    | 'NO_REAL_ESTATE_SIGNAL' | 'UNRELATED_PRODUCT';
  /** The matched categories (never the text itself). */
  signals: string[];
}

/* Six interface languages; lower-case stems, matched case-insensitively. */
const HIGH_RISK: Array<[DomainVerdict['reason'], RegExp]> = [
  ['GAMBLING', /\b(casino|gambl\w*|betting|sportsbook|bookmaker|poker|slot machines?|jackpot|roulette|lottery|bet\s?(now|online))\b|კაზინო|სლოტ|ფსონ|ტოტალიზატორ|ბუკმეიკერ|казино|ставк\w* на спорт|букмекер|покер|слот|рулетк|лотере|kumar|bahis|iddaa|rulet|قمار|كازينو|مراهن|רולטה|הימור|קזינו/i],
  ['ADULT', /\b(escort|porn\w*|xxx|adult (content|services?)|onlyfans|sex ?shop|strip ?club)\b|ესკორტ|პორნო|эскорт|порно|интим\w* услуг|eskort|müstehcen|إباحي|مرافقة|ליווי|פורנו/i],
  ['DRUGS', /\b(cannabis|marijuana|weed|cocaine|heroin|mdma|ecstasy|meth|lsd|psilocybin|vape (juice|liquid))\b|ნარკოტიკ|მარიხუან|наркотик|марихуан|кокаин|uyuşturucu|esrar|مخدرات|حشيش|סמים|קנאביס/i],
  ['CRYPTO_TRADING', /\b(crypto\w*|bitcoin|btc|ethereum|nft|forex|binary options?|trading signals?|airdrop|token sale|ico)\b|კრიპტო|ბიტკოინ|ფორექს|крипт\w*|биткоин|форекс|бинарн\w* опцион|kripto|forex|عملات رقمية|بيتكوين|פורקס|קריפטו|ביטקוין/i],
];
const REAL_ESTATE: RegExp = /\b(apartments?|flats?|houses?|homes?|villas?|penthouses?|studio|duplex|real[- ]?estate|property|properties|land|plot|parcel|lot|commercial (space|property)|office space|retail space|warehouse|for sale|for rent|to rent|rental|lease|leasing|tenant|landlord|mortgage|developer|development|new[- ]build|residential|complex|construction|builder|contractor|renovation|refurbish\w*|repair|remodel\w*|interior( design)?|architect\w*|furniture|kitchen|bathroom|flooring|roofing|plumbing|electrician|property management|facility management|brokerage|broker|realtor|agency|agent|investment property|sqm|m²|m2|bedrooms?|bathrooms?)\b|ბინ[აი]|სახლ|აგარაკ|ვილა|უძრავ|ქონებ|მიწ[აი]|ნაკვეთ|იყიდება|ქირავდება|ქირა|იჯარ|მოიჯარ|კომერციულ ფართ|ოფის|ახალაშენებ|მშენებლ|დეველოპერ|კომპლექს|რემონტ|რეაბილიტაც|ინტერიერ|დიზაინ|არქიტექტ|ავეჯ|სამზარეულო|აბაზანა|იატაკ|სახურავ|სანტექნიკ|ბროკერ|სააგენტო|აგენტ|იპოთეკ|კვ\.?\s?მ|ოთახ|квартир|дом|коттедж|вилл|недвижим|участ|земл|продаж|аренд|сда[её]тся|арендатор|офис|новостро|застройщик|строител|ремонт|отделк|интерьер|дизайн|архитект|мебел|кухн|ванн|сантехник|риелтор|агентств|ипотек|комнат|кв\.?\s?м|(?<![a-zçğıöşü])(daire|ev|villa|emlak|gayrimenkul|arsa|satılık|kiralık|kira|ofis|inşaat|müteahhit|tadilat|iç mimar|mimar|mobilya|mutfak|banyo|tesisat|emlakçı|ipotek|konut|oda)(?![a-zçğıöşü])|شقة|شقق|منزل|فيلا|عقار|أرض|للبيع|للإيجار|إيجار|مكتب|بناء|مقاول|ترميم|تصميم داخلي|معمار|أثاث|مطبخ|حمام|سمسار|رهن عقاري|غرفة|דירה|דירות|בית|וילה|נדל"?ן|קרקע|מגרש|למכירה|להשכרה|שכירות|משרד|בנייה|קבלן|שיפוץ|עיצוב פנים|אדריכל|רהיטים|מטבח|אמבטיה|מתווך|משכנתא|חדרים/i;

const joined = (texts: DomainInput['texts']) => texts.filter(Boolean).map(String).join('\n').slice(0, 12_000);

export function classifyDomainScope(input: DomainInput): DomainVerdict {
  const text = `${input.offer?.title ?? ''}\n${joined(input.texts)}`;
  const risk = HIGH_RISK.filter(([, re]) => re.test(text)).map(([r]) => r);
  const realEstate = REAL_ESTATE.test(text);
  const propertyLinked = input.hasProperty || input.offer?.isProperty === true;

  if (propertyLinked) {
    // A real property: a high-risk word next to it is for a person to read, not a refusal.
    if (risk.length) return { decision: 'NEEDS_REVIEW', reason: 'HIGH_RISK_NEXT_TO_PROPERTY', signals: risk };
    return { decision: 'ALLOWED', reason: input.hasProperty ? 'HOMATCH_PROPERTY' : 'PROPERTY_OFFER', signals: ['PROPERTY'] };
  }
  if (risk.length) {
    // High-risk with no property tie: refused — unless real-estate words make it genuinely mixed.
    return realEstate
      ? { decision: 'NEEDS_REVIEW', reason: 'MIXED_SIGNALS', signals: [...risk, 'REAL_ESTATE_WORDS'] }
      : { decision: 'BLOCKED_OUT_OF_SCOPE', reason: risk[0], signals: risk };
  }
  // Any other lawful product, service or business runs without a person checking it.
  if (realEstate) return { decision: 'ALLOWED', reason: 'REAL_ESTATE_SERVICE', signals: ['REAL_ESTATE_WORDS'] };
  return { decision: 'ALLOWED', reason: 'GENERAL_OFFER', signals: [] };
}

/** What a person approved: the exact offer and copy it read (FNV-1a). */
export function domainFingerprint(input: DomainInput): string {
  const s = `${input.hasProperty ? 'P' : '-'}|${input.offer?.isProperty ? 'O' : '-'}|${String(input.offer?.title ?? '').trim()}|${joined(input.texts)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `d${h.toString(16)}_${s.length}`;
}

export const DOMAIN_CASE_REASON = 'DOMAIN_SCOPE';
