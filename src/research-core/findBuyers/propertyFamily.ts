// PROPERTY FAMILY — what kind of place a search is for, in the five families a
// buyer or tenant actually asks for: an apartment, a house, land, commercial space
// or a parking place. Pure; shared by the strategy, the query planner, the model
// planner and qualification so that all four agree.
//
// THE DEFECT THIS CLOSES (2026-10-12). Every phrase the engine searched with was an
// apartment phrase ("ვყიდულობ ბინას", "куплю квартиру"), and the type gate compared
// only HOUSE vs APARTMENT. A land plot or a shop was searched for with apartment
// queries, and an apartment seeker matched to it was kept as a WEAK lead and shown
// to the customer. Parking had no family at all: `property_type` has no PARKING
// value, so a parking place is stored as OTHER and recognised from its title.

export type PropertyFamily = 'APARTMENT' | 'HOUSE' | 'LAND' | 'COMMERCIAL' | 'PARKING';

const PARKING_WORDS = /parking|garage|паркинг|парковк|парковочн|машиноместо|гараж|პარკინგ|ავტოსადგომ|ავტოფარეხ|garaj|otopark|موقف|كراج|חניה|חנייה/iu;

/** The family of a stored property type (the `property_type` enum), parking read from the title. */
export function propertyFamily(propertyType: string | null | undefined, title?: string | null): PropertyFamily {
  const t = String(propertyType ?? '').toUpperCase();
  if (t === 'PARKING' || (PARKING_WORDS.test(String(title ?? '')) && (t === 'OTHER' || t === 'COMMERCIAL' || t === ''))) return 'PARKING';
  if (t === 'HOUSE' || t === 'VILLA' || t === 'TOWNHOUSE') return 'HOUSE';
  if (t === 'LAND') return 'LAND';
  if (t === 'COMMERCIAL' || t === 'OFFICE') return 'COMMERCIAL';
  return 'APARTMENT';
}

export function isParkingText(text: string): boolean {
  return PARKING_WORDS.test(text);
}

/** How people name the family in each search language, in the accusative/object form a request uses. */
export const FAMILY_NOUN: Record<PropertyFamily, Record<'ka' | 'ru' | 'en' | 'ar' | 'he' | 'tr', string>> = {
  APARTMENT: { ka: 'ბინას', ru: 'квартиру', en: 'apartment', ar: 'شقة', he: 'דירה', tr: 'daire' },
  HOUSE: { ka: 'სახლს', ru: 'дом', en: 'house', ar: 'منزل', he: 'בית', tr: 'müstakil ev' },
  LAND: { ka: 'მიწის ნაკვეთს', ru: 'земельный участок', en: 'land plot', ar: 'أرض', he: 'מגרש', tr: 'arsa' },
  COMMERCIAL: { ka: 'კომერციულ ფართს', ru: 'коммерческое помещение', en: 'commercial space', ar: 'محل تجاري', he: 'שטח מסחרי', tr: 'işyeri' },
  PARKING: { ka: 'პარკინგის ადგილს', ru: 'парковочное место', en: 'parking space', ar: 'موقف سيارة', he: 'חניה', tr: 'otopark yeri' },
};
