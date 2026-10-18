// FIND BUYERS — labelled offline evaluation set (2026-10-18). Hand-labelled, synthetic but
// written the way people post in Georgian groups; NOT production data and NOT a live Actor run.
// label: 'accept' = a real buyer/tenant (or buyer via broker) this property's owner should see;
//        'reject' = not this property's lead. strongOk=false: may be shown, never as STRONG.
// Used by findBuyersEval.test.mjs and findBuyersEvalReport.mjs (node <path> prints precision / recall).

export const PROPERTIES = {
  APT_SALE: { transactionType: 'SALE', propertyType: 'APARTMENT', city: 'Tbilisi', district: 'Krtsanisi', totalPrice: 160000, currency: 'USD', area: 97.2, rooms: 3, bedrooms: 2, title: '3-ოთახიანი ბინა კრწანისში' },
  APT_RENT: { transactionType: 'RENT', propertyType: 'APARTMENT', city: 'Tbilisi', district: 'Vake', totalPrice: 900, currency: 'USD', area: 70, rooms: 3, bedrooms: 2, title: 'ქირავდება 3-ოთახიანი ბინა ვაკეში' },
  WAREHOUSE_RENT: { transactionType: 'RENT', propertyType: 'COMMERCIAL', city: 'Tbilisi', district: 'Saburtalo', totalPrice: 2500, currency: 'USD', area: 300, title: 'ქირავდება საწყობი 300 კვ.მ' },
  FARMLAND_SALE: { transactionType: 'SALE', propertyType: 'LAND', city: 'Tbilisi', totalPrice: 30000, currency: 'USD', area: 2000, title: 'იყიდება სასოფლო-სამეურნეო მიწის ნაკვეთი' },
  VILLA_SALE: { transactionType: 'SALE', propertyType: 'VILLA', city: 'Tbilisi', district: 'Vake', totalPrice: 900000, currency: 'USD', area: 400, rooms: 6, bedrooms: 4 },
  OFFICE_RENT: { transactionType: 'RENT', propertyType: 'OFFICE', city: 'Tbilisi', district: 'Vake', totalPrice: 2000, currency: 'USD', area: 120 },
};

const A = (property, text, extra = {}) => ({ property, text, label: 'accept', ...extra });
const X = (property, text, why, extra = {}) => ({ property, text, label: 'reject', why, ...extra });

export const CASES = [
  /* ── 97 m² 2-bedroom apartment for sale, Krtsanisi, $160k ── */
  A('APT_SALE', 'ვყიდულობ 3 ოთახიან ბინას კრწანისში, ბიუჯეტი 165 000$', { case: 'exact' }),
  A('APT_SALE', 'Куплю 3-комнатную квартиру в Крцаниси до 170000$', { case: 'exact' }),
  A('APT_SALE', 'Looking to buy a 2 bedroom apartment in Krtsanisi, budget $160k', { case: 'exact' }),
  A('APT_SALE', 'ვეძებ ბინას საყიდლად ორთაჭალაში ან კრწანისში, 3 ოთახიანი', { case: 'near', strongOk: false }),
  A('APT_SALE', 'ვიყიდი ბინას თბილისში, ცენტრთან ახლოს', { case: 'missing', strongOk: false }),
  A('APT_SALE', 'хочу купить квартиру в Тбилиси, рассматриваю старый Тбилиси', { case: 'missing', strongOk: false }),
  A('APT_SALE', 'Ищу квартиру для покупки, Krtsanisi или Ortachala, 2 спальни', { case: 'mixed', strongOk: false }),
  A('APT_SALE', 'أريد شراء شقة في تبليسي بثلاث غرف', { case: 'exact-ar', strongOk: false }),
  A('APT_SALE', 'רוצה לקנות דירה בטביליסי, 3 חדרים', { case: 'exact-he', strongOk: false }),
  A('APT_SALE', 'Tiflis\'te 2+1 daire satın almak istiyorum', { case: 'exact-tr', strongOk: false }),
  A('APT_SALE', 'ვეძებ ბინას საყიდლად, აგენტებმა არ შემაწუხოთ, მხოლოდ მეპატრონე', { case: 'no-agents', strongOk: false }),
  A('APT_SALE', 'Куплю квартиру в Тбилиси, риелторов просьба не беспокоить', { case: 'no-agents', strongOk: false }),
  A('APT_SALE', 'ჩემი კლიენტისთვის ვეძებ 3 ოთახიან ბინას კრწანისში საყიდლად', { case: 'broker-for-buyer', strongOk: false }),
  A('APT_SALE', 'Ищу для клиента квартиру на покупку в Крцаниси, 3 комнаты', { case: 'broker-for-buyer', strongOk: false }),
  X('APT_SALE', 'იყიდება 3 ოთახიანი ბინა კრწანისში, 97 კვ.მ, ფასი 160 000$', 'seller'),
  X('APT_SALE', 'Продается 3-комнатная квартира в Крцаниси, звоните', 'seller'),
  X('APT_SALE', 'ვეძებ ბინას ქირით კრწანისში', 'wrong-transaction'),
  X('APT_SALE', 'Сниму квартиру в Крцаниси на длительный срок', 'wrong-transaction'),
  X('APT_SALE', 'ვყიდულობ ბინას ბათუმში, ზღვასთან ახლოს', 'wrong-location'),
  X('APT_SALE', 'Куплю квартиру в Батуми у моря', 'wrong-location'),
  X('APT_SALE', 'ვყიდულობ 1 ოთახიან ბინას კრწანისში 40 000$-მდე', 'wrong-budget'),
  X('APT_SALE', 'Looking to buy a studio in Krtsanisi up to $50k', 'wrong-budget'),
  X('APT_SALE', 'ვყიდულობ მიწის ნაკვეთს კრწანისში', 'wrong-family'),
  X('APT_SALE', 'Куплю офис в Крцаниси', 'wrong-family'),
  X('APT_SALE', 'ვეძებ სამუშაოს, ვარ მძღოლი, თბილისში', 'job'),
  X('APT_SALE', 'ბინის რემონტი, სწრაფად და ხარისხიანად, დაგვიკავშირდით', 'service'),
  X('APT_SALE', 'თუ გაქვთ ბინა გასაყიდი, დაგეხმარებით და ვიპოვით მყიდველს სწრაფად', 'broker-solicits-sellers'),
  X('APT_SALE', 'ვყიდულობ 3 ოთახიან ბინას კრწანისში, ბიუჯეტი 165 000$', 'duplicate', { duplicate: true }),
  X('APT_SALE', 'Куплю 3-комнатную квартиру в Крцаниси до 170000$', 'stale', { ageDays: 60 }),
  X('APT_SALE', 'უკვე ვიყიდე ბინა კრწანისში, მადლობა ყველას', 'already-bought'),

  /* ── 2-bedroom apartment for rent, Vake, $900 ── */
  A('APT_RENT', 'ვიქირავებ 3 ოთახიან ბინას ვაკეში, 900$-მდე', { case: 'exact' }),
  A('APT_RENT', 'Сниму 3-комнатную квартиру в Ваке до 1000$', { case: 'exact' }),
  A('APT_RENT', 'Looking to rent a 2 bedroom apartment in Vake, up to $950', { case: 'exact' }),
  A('APT_RENT', 'מחפש דירה להשכרה בטביליסי, אזור ואקה', { case: 'he', strongOk: false }),
  A('APT_RENT', 'Tiflis\'te kiralık daire arıyorum, Vake bölgesi', { case: 'tr', strongOk: false }),
  A('APT_RENT', 'أبحث عن شقة للإيجار في تبليسي', { case: 'ar', strongOk: false }),
  A('APT_RENT', 'ვეძებ ბინას ქირით საბურთალოზე ან ვაკეში', { case: 'near', strongOk: false }),
  X('APT_RENT', 'ქირავდება 3 ოთახიანი ბინა ვაკეში, 900$', 'landlord'),
  X('APT_RENT', 'Сдается квартира в Ваке, 2 спальни, 900$', 'landlord'),
  X('APT_RENT', 'ვყიდულობ ბინას ვაკეში', 'wrong-transaction'),
  X('APT_RENT', 'Сниму квартиру в Ваке до 400$', 'wrong-budget'),
  X('APT_RENT', 'Сниму офис в Ваке', 'wrong-family'),
  X('APT_RENT', 'ვეძებ ბინებს გასაქირავებლად, მეპატრონეებო მომწერეთ, თანამშრომლობა', 'broker-inventory'),

  /* ── 300 m² warehouse for rent, Saburtalo ── */
  A('WAREHOUSE_RENT', 'ვიქირავებ საწყობს საბურთალოზე, 250-350 კვ.მ', { case: 'exact' }),
  A('WAREHOUSE_RENT', 'Сниму склад в Тбилиси 300 м2, Сабуртало', { case: 'exact' }),
  A('WAREHOUSE_RENT', 'Looking to rent a warehouse in Tbilisi, around 300 sqm', { case: 'exact', strongOk: false }),
  A('WAREHOUSE_RENT', 'Ищу производственное помещение в аренду в Тбилиси', { case: 'near-subtype', strongOk: false }),
  A('WAREHOUSE_RENT', 'Tiflis\'te depo kiralamak istiyorum', { case: 'tr', strongOk: false }),
  A('WAREHOUSE_RENT', 'أبحث عن مستودع للإيجار في تبليسي', { case: 'ar', strongOk: false }),
  A('WAREHOUSE_RENT', 'מחפש מחסן להשכרה בטביליסי', { case: 'he', strongOk: false }),
  X('WAREHOUSE_RENT', 'ვიქირავებ ოფისს საბურთალოზე', 'wrong-subtype'),
  X('WAREHOUSE_RENT', 'Сниму помещение под магазин на Сабуртало', 'wrong-subtype'),
  X('WAREHOUSE_RENT', 'ვიქირავებ 2 ოთახიან ბინას საბურთალოზე', 'wrong-family'),
  X('WAREHOUSE_RENT', 'ქირავდება საწყობი საბურთალოზე, 300 კვ.მ', 'landlord'),
  X('WAREHOUSE_RENT', 'Куплю склад в Тбилиси', 'wrong-transaction'),
  X('WAREHOUSE_RENT', 'Сниму склад 50 м2 в Тбилиси', 'wrong-size'),

  /* ── 2,000 m² agricultural land for sale ── */
  A('FARMLAND_SALE', 'ვყიდულობ სასოფლო-სამეურნეო მიწის ნაკვეთს თბილისის მახლობლად', { case: 'exact', strongOk: false }),
  A('FARMLAND_SALE', 'Куплю сельхоз участок под Тбилиси, 20-30 соток', { case: 'exact', strongOk: false }),
  A('FARMLAND_SALE', 'Looking to buy farmland near Tbilisi', { case: 'exact', strongOk: false }),
  A('FARMLAND_SALE', 'ვიყიდი მიწის ნაკვეთს თბილისთან ახლოს', { case: 'generic-land', strongOk: false }),
  A('FARMLAND_SALE', 'Tiflis yakınında tarla satın almak istiyorum', { case: 'tr', strongOk: false }),
  X('FARMLAND_SALE', 'ვყიდულობ სამრეწველო მიწის ნაკვეთს თბილისში', 'wrong-subtype'),
  X('FARMLAND_SALE', 'Куплю промышленный земельный участок в Тбилиси', 'wrong-subtype'),
  X('FARMLAND_SALE', 'Куплю виллу в Тбилиси', 'wrong-family'),
  X('FARMLAND_SALE', 'იყიდება სასოფლო-სამეურნეო მიწა, 2000 კვ.მ', 'seller'),
  X('FARMLAND_SALE', 'Сниму участок под огород', 'wrong-transaction'),

  /* ── 400 m² villa for sale, Vake ── */
  A('VILLA_SALE', 'ვყიდულობ ვილას ვაკეში', { case: 'exact', strongOk: false }),
  A('VILLA_SALE', 'Куплю виллу в Ваке, бюджет до 1 000 000$', { case: 'exact' }),
  A('VILLA_SALE', 'Looking to buy a villa in Tbilisi, Vake area, budget $900k', { case: 'exact' }),
  A('VILLA_SALE', 'Хочу купить дом в Тбилиси, Ваке', { case: 'family', strongOk: false }),
  A('VILLA_SALE', 'ვიყიდი კერძო სახლს ვაკეში', { case: 'family', strongOk: false }),
  A('VILLA_SALE', 'Куплю коттедж в Тбилиси', { case: 'soft-subtype', strongOk: false }),
  A('VILLA_SALE', 'רוצה לקנות וילה בטביליסי', { case: 'he', strongOk: false }),
  A('VILLA_SALE', 'أريد شراء فيلا في تبليسي', { case: 'ar', strongOk: false }),
  X('VILLA_SALE', 'Куплю квартиру в Ваке', 'wrong-family'),
  X('VILLA_SALE', 'ვყიდულობ სასოფლო-სამეურნეო მიწას', 'wrong-family'),
  X('VILLA_SALE', 'იყიდება ვილა ვაკეში, 400 კვ.მ', 'seller'),
  X('VILLA_SALE', 'Куплю дом в Тбилиси до 100000$', 'wrong-budget'),

  /* ── 120 m² office for rent, Vake ── */
  A('OFFICE_RENT', 'ვიქირავებ ოფისს ვაკეში, 100-150 კვ.მ', { case: 'exact' }),
  A('OFFICE_RENT', 'Сниму офис в Ваке 120 м2', { case: 'exact' }),
  A('OFFICE_RENT', 'Looking to rent an office in Vake for our team', { case: 'exact', strongOk: false }),
  A('OFFICE_RENT', 'Ищем коворкинг или офис в аренду в Тбилиси', { case: 'semantic', strongOk: false }),
  A('OFFICE_RENT', 'Tiflis\'te ofis kiralamak istiyorum', { case: 'tr', strongOk: false }),
  A('OFFICE_RENT', 'מחפש משרד להשכרה בטביליסי', { case: 'he', strongOk: false }),
  X('OFFICE_RENT', 'Сниму склад в Ваке', 'wrong-subtype'),
  X('OFFICE_RENT', 'ვიქირავებ ფართს რესტორნისთვის ვაკეში', 'wrong-subtype'),
  X('OFFICE_RENT', 'ქირავდება საოფისე ფართი ვაკეში', 'landlord'),
  X('OFFICE_RENT', 'Ищу работу в офисе, опыт 3 года', 'job'),
];
