/*
 * FIND PROPERTY — every home found is browsable (owner, 2026-10-18): the homes outside the
 * request get their own section after the ones that fit, each with what it does not meet.
 * Order: en, ka, ru, tr, ar, he (LANGS in lib/i18nSplice.mjs). {{var}} survive in every locale.
 */
export const ALL_RESULTS_STRINGS = {
  fpv_outside_title: ['Also found — not everything you asked for', 'ასევე ვიპოვეთ: ყველა მოთხოვნას არ ერგება', 'Также найдено — не всё, что вы просили', 'Ayrıca bulundu — her isteğinize uymuyor', 'وجدنا أيضًا — لا تطابق كل ما طلبته', 'נמצאו גם — לא כל מה שביקשתם'],
  fpv_outside_body: [
    'Real listings from the same sites that miss at least one of your requirements. Each card says what differs.',
    'რეალური განცხადებები იმავე საიტებიდან, რომლებიც ერთ-ერთ მოთხოვნას მაინც არ აკმაყოფილებს. თითოეულ ბარათზე წერია, რით განსხვავდება.',
    'Настоящие объявления с тех же сайтов, которые не подходят хотя бы по одному требованию. На каждой карточке указано, в чём отличие.',
    'Aynı sitelerden, isteklerinizden en az birini karşılamayan gerçek ilanlar. Her kartta neyin farklı olduğu yazar.',
    'إعلانات حقيقية من المواقع نفسها لا تستوفي شرطًا واحدًا على الأقل من شروطك. تذكر كل بطاقة ما الذي يختلف.',
    'מודעות אמיתיות מאותם אתרים שאינן עומדות לפחות בדרישה אחת שלכם. בכל כרטיס כתוב מה שונה.',
  ],
  fpv_outside_label: ['Differs:', 'განსხვავდება:', 'Отличие:', 'Farklı:', 'يختلف في:', 'שונה ב:'],
  fpv_miss_DISTRICT: ['another district', 'სხვა უბანი', 'другой район', 'başka semt', 'حي آخر', 'שכונה אחרת'],
  fpv_miss_AREA: ['area', 'ფართი', 'площадь', 'alan', 'المساحة', 'שטח'],
  fpv_miss_ROOMS: ['rooms', 'ოთახები', 'комнаты', 'oda sayısı', 'عدد الغرف', 'חדרים'],
  fpv_miss_BEDROOMS: ['bedrooms', 'საძინებლები', 'спальни', 'yatak odası', 'غرف النوم', 'חדרי שינה'],
  fpv_miss_BATHROOMS: ['bathrooms', 'სველი წერტილები', 'санузлы', 'banyo', 'الحمامات', 'חדרי רחצה'],
  fpv_miss_FLOOR: ['floor', 'სართული', 'этаж', 'kat', 'الطابق', 'קומה'],
  fpv_miss_BUILDING_AGE: ['building age', 'შენობის ასაკი', 'возраст дома', 'bina yaşı', 'عمر المبنى', 'גיל הבניין'],
  fpv_miss_BUILDING_STATUS: ['building status', 'შენობის სტატუსი', 'статус дома', 'bina durumu', 'حالة المبنى', 'סטטוס הבניין'],
  fpv_miss_RENOVATION: ['renovation', 'რემონტი', 'ремонт', 'tadilat', 'التجديد', 'שיפוץ'],
  fpv_miss_PARKING: ['no parking', 'პარკინგი არ აქვს', 'нет парковки', 'otopark yok', 'بلا موقف سيارات', 'אין חניה'],
  fpv_miss_FURNISHED: ['furnishing', 'ავეჯი', 'мебель', 'eşya durumu', 'الأثاث', 'ריהוט'],
  fpv_miss_REQUIRED: ['a must-have is missing', 'სავალდებულო რამ აკლია', 'нет обязательного', 'zorunlu bir özellik yok', 'ينقصه شرط أساسي', 'חסר משהו שחובה'],
  fpv_miss_EXCLUDED: ['has something you excluded', 'აქვს ის, რაც გამორიცხეთ', 'есть то, что вы исключили', 'hariç tuttuğunuz bir şey var', 'فيه شيء استبعدته', 'יש בו משהו שהחרגתם'],
  fpv_miss_PRICE_HIGH: ['price above your budget', 'ფასი ბიუჯეტზე მაღალია', 'цена выше бюджета', 'fiyat bütçenin üstünde', 'السعر أعلى من ميزانيتك', 'המחיר מעל התקציב'],
  fpv_miss_PRICE_LOW: ['price below your range', 'ფასი თქვენს დიაპაზონზე დაბალია', 'цена ниже диапазона', 'fiyat aralığınızın altında', 'السعر أقل من نطاقك', 'המחיר מתחת לטווח'],
  fpv_miss_PRICE_UNKNOWN: ['price not stated', 'ფასი მითითებული არ არის', 'цена не указана', 'fiyat belirtilmemiş', 'السعر غير مذكور', 'המחיר לא צוין'],
  /* Snake: the on-screen arrows (owner, 2026-10-18). */
  mps_snake_up: ['Up', 'ზემოთ', 'Вверх', 'Yukarı', 'أعلى', 'למעלה'],
  mps_snake_down: ['Down', 'ქვემოთ', 'Вниз', 'Aşağı', 'أسفل', 'למטה'],
  mps_snake_left: ['Left', 'მარცხნივ', 'Влево', 'Sol', 'يسار', 'שמאלה'],
  mps_snake_right: ['Right', 'მარჯვნივ', 'Вправо', 'Sağ', 'يمين', 'ימינה'],
};
