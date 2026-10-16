// SOURCE RELEVANCE — is a discovered community worth reading for THIS
// property? Decided from its public name/description before any money is
// spent on its posts. The VILLION campaign paid to read "jobingeorgia" (a job
// board) and rental-only groups for a SALE search; neither can produce a buyer.

import { mentionsPlace, cityMentioned } from './places.ts';
import type { PropertyDna } from './propertyDna.ts';

const RE_TERMS = /(apartment|flat|real estate|realty|property|properties|housing|homes?\b|квартир|недвижим|жиль|ბინ|უძრავ|სახლ|emlak|daire|konut|عقار|شقق|شقة|דירות|נדל)/iu;
const JOB_TERMS = /(job|jobs|vacanc|work\b|hiring|career|работ|ваканс|სამუშაო|ვაკანს|iş ilan|eleman|وظائف|عمل|עבודה|משרות)/iu;
const OFF_TOPIC = /(dating|знакомств|рецепт|recipe|travel|туризм|ტურიზმ|авто|cars?\b|მანქან|marketplace|барахолк|buy\s*&?\s*sell (everything|anything)|ყველაფერი)/iu;
const RENT_ONLY = /(rent|rental|for rent|аренд|сда[её]|ქირ|kiral|إيجار|ايجار|להשכרה|שכירות)/iu;
const SALE_TERMS = /(sale|sell|buy|продаж|купл|покуп|იყიდება|ყიდვ|გაყიდვ|satılık|للبيع|شراء|למכירה|קנייה)/iu;

export interface SourceRelevance {
  score: number;
  reasons: string[];
  /** Read its posts in this campaign? (Registration happens either way.) */
  readable: boolean;
}

export function sourceRelevance(text: string, dna: PropertyDna, members = 0): SourceRelevance {
  const reasons: string[] = [];
  const t = String(text ?? '');
  if (JOB_TERMS.test(t) && !RE_TERMS.test(t)) return { score: 0, reasons: ['job_board'], readable: false };
  if (OFF_TOPIC.test(t) && !RE_TERMS.test(t)) return { score: 0, reasons: ['off_topic'], readable: false };
  let score = 0;
  if (RE_TERMS.test(t)) { score += 0.4; reasons.push('real_estate'); }
  const city = mentionsPlace(t, 'city', dna.city);
  if (city) { score += 0.3; reasons.push('same_city'); }
  else if (cityMentioned(t)) { score -= 0.3; reasons.push('other_city'); }
  else { score += 0.1; reasons.push('country_wide'); }
  if (dna.district && mentionsPlace(t, 'district', dna.district)) { score += 0.15; reasons.push('same_district'); }
  const rentOnly = RENT_ONLY.test(t) && !SALE_TERMS.test(t);
  if (dna.transaction === 'SALE' && rentOnly) { score -= 0.35; reasons.push('rental_only'); }
  if (dna.transaction === 'RENT' && SALE_TERMS.test(t) && !RENT_ONLY.test(t)) { score -= 0.2; reasons.push('sale_only'); }
  if (SALE_TERMS.test(t) && dna.transaction === 'SALE') { score += 0.1; reasons.push('sale_market'); }
  score += Math.min(0.05, members / 400_000);
  score = Math.max(0, Math.min(1, Math.round(score * 100) / 100));
  return { score, reasons, readable: score >= 0.45 };
}
