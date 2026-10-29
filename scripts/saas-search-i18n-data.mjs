/* Find Property: the deterministic query engine's clarification chips — [en, ka, ru, tr, ar, he].
 * When a sentence leaves something open (a price without a currency, buy and rent in one line,
 * two property types, two cities, a typo close to two places), the reading asks instead of
 * guessing. Georgian first in spirit: plain, friendly, no dashes. */
export const SAAS_SEARCH_STRINGS = {
  mps_clarify_title: ['Just to be sure', 'მცირე დაზუსტება', 'Чтобы не ошибиться', 'Emin olmak için', 'للتأكد فقط', 'רק כדי לוודא'],
  mps_clarify_transaction: ['Do you want to buy or to rent?', 'ყიდვა გინდათ თუ ქირაობა?', 'Вы хотите купить или снять?', 'Satın almak mı, kiralamak mı istiyorsunuz?', 'هل تريد الشراء أم الإيجار؟', 'אתם רוצים לקנות או לשכור?'],
  mps_clarify_property_type: ['Which kind of property should we search for?', 'როგორ ქონებას ვეძებთ?', 'Какую недвижимость искать?', 'Hangi tür mülkü arayalım?', 'ما نوع العقار الذي نبحث عنه؟', 'איזה סוג נכס לחפש?'],
  mps_clarify_currency: ['Which currency is that price in?', 'ეს ფასი რომელ ვალუტაშია?', 'В какой валюте эта цена?', 'Bu fiyat hangi para biriminde?', 'بأي عملة هذا السعر؟', 'באיזה מטבע המחיר הזה?'],
  mps_clarify_place: ['Which place did you mean?', 'რომელ ადგილს გულისხმობთ?', 'Какое место вы имели в виду?', 'Hangi yeri kastettiniz?', 'أي مكان تقصد؟', 'לאיזה מקום התכוונתם?'],
  mps_clarify_city: ['Which city should we search in?', 'რომელ ქალაქში ვეძებოთ?', 'В каком городе искать?', 'Hangi şehirde arayalım?', 'في أي مدينة نبحث؟', 'באיזו עיר לחפש?'],
};
