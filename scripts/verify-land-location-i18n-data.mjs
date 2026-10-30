/*
 * Copy for a Verify market section whose subject's location could not be
 * established (prod 9f49e7e3): no search ran, so nothing was "found".
 *
 * Order is en, ka, ru, tr, ar, he — LANGS in lib/i18nSplice.mjs.
 */
export const VERIFY_LAND_LOCATION_STRINGS = {
  vfm7_insufficient_title_no_location: [
    'Market comparison not possible: location not confirmed',
    'ბაზრის შედარება შეუძლებელია: მდებარეობა არ დადასტურდა',
    'Сравнение с рынком невозможно: местоположение не подтверждено',
    'Piyasa karşılaştırması yapılamadı: konum doğrulanmadı',
    'تعذّرت مقارنة السوق: لم يتم تأكيد الموقع',
    'לא ניתן להשוות לשוק: המיקום לא אומת',
  ],
  vfm7_insufficient_body_no_location: ['The official sources did not give us this property\'s exact location, so no market search was run and no comparable properties are shown. We are not giving a price for it. This is not a finding about the market — it was not compared.', 'ოფიციალურმა წყაროებმა ამ ქონების ზუსტი მდებარეობა ვერ მოგვცა, ამიტომ ბაზრის ძიება არ ჩატარებულა და შესადარებელი ქონება არ არის ნაჩვენები. ფასს ამ ქონებისთვის არ ვაძლევთ. ეს ბაზრის შესახებ დასკვნა არ არის, შედარება არ მომხდარა.', 'Официальные источники не дали нам точного местоположения этой недвижимости, поэтому поиск по рынку не проводился и сопоставимые объекты не показаны. Мы не называем для неё цену. Это не вывод о рынке — сравнение не проводилось.', 'Resmi kaynaklar bu mülkün kesin konumunu vermedi; bu nedenle piyasa araması yapılmadı ve karşılaştırılabilir mülk gösterilmiyor. Bu mülk için fiyat vermiyoruz. Bu, piyasa hakkında bir bulgu değildir — karşılaştırma yapılmadı.', 'لم تُعطنا المصادر الرسمية الموقع الدقيق لهذا العقار، لذلك لم يُجرَ بحث في السوق ولا تُعرض عقارات قابلة للمقارنة. لا نعطي سعرًا لهذا العقار. هذا ليس استنتاجًا عن السوق — لم تتم المقارنة.', 'המקורות הרשמיים לא מסרו לנו את המיקום המדויק של הנכס, ולכן לא בוצע חיפוש בשוק ולא מוצגים נכסים להשוואה. איננו נותנים לו מחיר. זה אינו ממצא על השוק — לא בוצעה השוואה.'],
  vfm7_missing_location: [
    'The property\'s confirmed location from an official source (its position on the cadastral map or its district).',
    'ქონების დადასტურებული მდებარეობა ოფიციალური წყაროდან (მისი ადგილი საკადასტრო რუკაზე ან უბანი).',
    'Подтверждённое местоположение объекта из официального источника (его место на кадастровой карте или район).',
    'Mülkün resmi bir kaynaktan doğrulanmış konumu (kadastro haritasındaki yeri veya semti).',
    'الموقع المؤكد للعقار من مصدر رسمي (موضعه على الخريطة المساحية أو حيّه).',
    'המיקום המאומת של הנכס ממקור רשמי (מקומו במפת הקדסטר או השכונה).',
  ],
  vfm7_next_location: [
    'Confirm the property\'s location (its cadastral map position or district); the market can then be compared with nearby listings of the same kind.',
    'დაადასტურეთ ქონების მდებარეობა (მისი ადგილი საკადასტრო რუკაზე ან უბანი); ამის შემდეგ ბაზარი შეგვიძლია შევადაროთ იმავე ტიპის ახლომდებარე განცხადებებს.',
    'Подтвердите местоположение объекта (его место на кадастровой карте или район); тогда рынок можно будет сравнить с ближайшими объявлениями того же типа.',
    'Mülkün konumunu doğrulayın (kadastro haritasındaki yeri veya semti); ardından piyasa aynı türdeki yakın ilanlarla karşılaştırılabilir.',
    'أكّد موقع العقار (موضعه على الخريطة المساحية أو حيّه)؛ بعدها يمكن مقارنة السوق بالإعلانات القريبة من النوع نفسه.',
    'אמתו את מיקום הנכס (מקומו במפת הקדסטר או השכונה); לאחר מכן ניתן יהיה להשוות לשוק מול מודעות סמוכות מאותו סוג.',
  ],
};
