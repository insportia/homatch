/*
 * Copy for the Verify final polish: the curated market comparables and the
 * plain explanation when there is not enough local evidence for a valuation
 * (job 8ba97da9, Krtsanisi St. 6, 2026-10-11).
 *
 * Order is en, ka, ru, tr, ar, he — LANGS in lib/i18nSplice.mjs.
 * Placeholders ({{have}}, {{need}}, {{other}}, {{size}}, {{min}}, {{max}},
 * {{pct}}, {{floor}}) survive in every locale. No em dashes in customer prose.
 */
export const VERIFY_FINAL_MARKET_STRINGS = {
  /* ── hierarchy levels ── */
  vfm_level_same_project: ['Same project', 'იგივე პროექტი', 'Тот же проект', 'Aynı proje', 'المشروع نفسه', 'אותו פרויקט'],
  vfm_level_same_address: ['Same address', 'იგივე მისამართი', 'Тот же адрес', 'Aynı adres', 'العنوان نفسه', 'אותה כתובת'],
  vfm_level_same_street: ['Same street', 'იგივე ქუჩა', 'Та же улица', 'Aynı sokak', 'الشارع نفسه', 'אותו רחוב'],
  vfm_level_premium_peer: ['Comparable premium project nearby', 'მსგავსი პრემიუმ პროექტი ახლოს', 'Сопоставимый премиальный проект рядом', 'Yakındaki benzer premium proje', 'مشروع فاخر مماثل قريب', 'פרויקט פרימיום דומה בסביבה'],
  vfm_level_broader: ['Broader nearby area', 'ახლომდებარე უფრო ფართო არეალი', 'Более широкий район рядом', 'Yakın çevrenin geneli', 'المنطقة المجاورة الأوسع', 'האזור הסמוך הרחב יותר'],
  vfm_broader_note: [
    'Shown for orientation only. It is not used to price this home.',
    'ნაჩვენებია მხოლოდ ორიენტაციისთვის. ამ ბინის ფასის შესაფასებლად არ გამოიყენება.',
    'Показано только для ориентира. Для оценки этой квартиры не используется.',
    'Yalnızca fikir vermesi için gösterilir. Bu evin fiyatlandırmasında kullanılmaz.',
    'معروض للاسترشاد فقط، ولا يُستخدم لتقدير سعر هذا العقار.',
    'מוצג להתמצאות בלבד. אינו משמש לתמחור הדירה הזו.',
  ],

  /* ── listing facts ── */
  vfm_floor: ['Floor {{floor}}', 'სართული {{floor}}', 'Этаж {{floor}}', '{{floor}}. kat', 'الطابق {{floor}}', 'קומה {{floor}}'],
  vfm_cond_black_frame: ['Black frame', 'შავი კარკასი', 'Черный каркас', 'Kaba inşaat', 'هيكل أسود', 'שלד שחור'],
  vfm_cond_green_frame: ['Green frame', 'მწვანე კარკასი', 'Зеленый каркас', 'Yeşil karkas', 'هيكل أخضر', 'שלד ירוק'],
  vfm_cond_white_frame: ['White frame', 'თეთრი კარკასი', 'Белый каркас', 'Beyaz karkas', 'هيكل أبيض', 'שלד לבן'],
  vfm_cond_renovated: ['Renovated', 'გარემონტებული', 'С ремонтом', 'Tadilatlı', 'مُجدَّد', 'משופץ'],
  vfm_cond_newly_renovated: ['Newly renovated', 'ახალი რემონტით', 'Со свежим ремонтом', 'Yeni tadilatlı', 'مُجدَّد حديثًا', 'משופץ לאחרונה'],
  vfm_status_active: ['Active listing', 'აქტიური განცხადება', 'Активное объявление', 'Aktif ilan', 'إعلان نشط', 'מודעה פעילה'],
  vfm_status_expired: ['No longer listed', 'აღარ არის განთავსებული', 'Снято с публикации', 'Artık yayında değil', 'لم يعد معروضًا', 'כבר לא מפורסם'],
  vfm_status_unknown: ['Listing status not stated', 'განცხადების სტატუსი მითითებული არ არის', 'Статус объявления не указан', 'İlan durumu belirtilmemiş', 'حالة الإعلان غير مذكورة', 'סטטוס המודעה לא צוין'],

  /* ── differences from the subject ── */
  vfm_diff_larger: ['{{pct}}% larger', '{{pct}}%-ით დიდი', 'на {{pct}}% больше', '%{{pct}} daha büyük', 'أكبر بنسبة {{pct}}%', 'גדולה ב-{{pct}}%'],
  vfm_diff_smaller: ['{{pct}}% smaller', '{{pct}}%-ით პატარა', 'на {{pct}}% меньше', '%{{pct}} daha küçük', 'أصغر بنسبة {{pct}}%', 'קטנה ב-{{pct}}%'],
  vfm_diff_size_similar: ['Similar size', 'მსგავსი ფართი', 'Похожая площадь', 'Benzer büyüklük', 'مساحة مماثلة', 'גודל דומה'],
  vfm_diff_better_condition: ['Better finish', 'უკეთესი მდგომარეობა', 'Лучшее состояние', 'Daha iyi durumda', 'تشطيب أفضل', 'גימור טוב יותר'],
  vfm_diff_worse_condition: ['Lower finish', 'უფრო დაბალი მდგომარეობა', 'Худшее состояние', 'Daha düşük durumda', 'تشطيب أدنى', 'גימור נמוך יותר'],
  vfm_diff_condition_unknown: ['Condition not stated', 'მდგომარეობა მითითებული არ არის', 'Состояние не указано', 'Durum belirtilmemiş', 'الحالة غير مذكورة', 'המצב לא צוין'],
  vfm_diff_not_active: ['No longer on the market', 'ბაზარზე აღარ არის', 'Уже не на рынке', 'Artık piyasada değil', 'لم يعد في السوق', 'כבר לא בשוק'],
  vfm_diff_status_unconfirmed: ['Not confirmed as still on the market', 'დადასტურებული არ არის, რომ ჯერ კიდევ იყიდება', 'Не подтверждено, что еще продается', 'Hâlâ satışta olduğu doğrulanmadı', 'لم يُؤكَّد أنه لا يزال معروضًا للبيع', 'לא אושר שהיא עדיין למכירה'],
  vfm_diff_undated: ['Listing date unknown', 'განცხადების თარიღი უცნობია', 'Дата объявления неизвестна', 'İlan tarihi bilinmiyor', 'تاريخ الإعلان غير معروف', 'תאריך המודעה לא ידוע'],
  vfm_diff_asking: ['Asking price, not a sale price', 'მოთხოვნილი ფასია და არა გაყიდვის ფასი', 'Цена предложения, а не цена сделки', 'Satış fiyatı değil, istenen fiyat', 'سعر مطلوب وليس سعر بيع', 'מחיר מבוקש, לא מחיר מכירה'],

  /* ── insufficient evidence ── */
  vfm_insufficient_title: [
    'Not enough local evidence for a valuation',
    'შეფასებისთვის საკმარისი ადგილობრივი მონაცემები არ არის',
    'Недостаточно местных данных для оценки',
    'Değerleme için yeterli yerel veri yok',
    'لا توجد أدلة محلية كافية للتقييم',
    'אין מספיק נתונים מקומיים להערכת שווי',
  ],
  vfm_insufficient_body: [
    'A price range needs at least {{need}} comparable homes from the same project, the same street or a similar premium project nearby. We found {{have}}, so we are not giving a number for this home.',
    'ფასის დიაპაზონის დასადგენად საჭიროა მინიმუმ {{need}} შესადარებელი ბინა იმავე პროექტიდან, იმავე ქუჩიდან ან ახლომდებარე მსგავსი პრემიუმ პროექტიდან. ვიპოვეთ {{have}}, ამიტომ ამ ბინისთვის ციფრს არ ვასახელებთ.',
    'Для диапазона цен нужно не менее {{need}} сопоставимых квартир из того же проекта, с той же улицы или из похожего премиального проекта рядом. Мы нашли {{have}}, поэтому не называем цифру для этой квартиры.',
    'Bir fiyat aralığı için aynı projeden, aynı sokaktan veya yakındaki benzer bir premium projeden en az {{need}} karşılaştırılabilir konut gerekir. {{have}} tane bulduk, bu nedenle bu konut için bir rakam vermiyoruz.',
    'يتطلب نطاق السعر ما لا يقل عن {{need}} من المساكن المماثلة من المشروع نفسه أو الشارع نفسه أو مشروع فاخر مماثل قريب. وجدنا {{have}}، لذلك لا نقدّم رقمًا لهذا العقار.',
    'טווח מחירים דורש לפחות {{need}} דירות דומות מאותו פרויקט, מאותו רחוב או מפרויקט פרימיום דומה בסביבה. מצאנו {{have}}, ולכן איננו נותנים מספר לדירה זו.',
  ],
  vfm_missing_title: ['What is missing', 'რა აკლია', 'Чего не хватает', 'Eksik olan', 'ما الذي ينقص', 'מה חסר'],
  vfm_missing_local: [
    'Current listings in this building, on this street or in a similar premium development nearby.',
    'მიმდინარე განცხადებები ამ შენობაში, ამ ქუჩაზე ან ახლომდებარე მსგავს პრემიუმ პროექტში.',
    'Актуальные объявления в этом здании, на этой улице или в похожем премиальном проекте рядом.',
    'Bu binada, bu sokakta veya yakındaki benzer bir premium projede güncel ilanlar.',
    'إعلانات حالية في هذا المبنى أو هذا الشارع أو في مشروع فاخر مماثل قريب.',
    'מודעות עדכניות בבניין הזה, ברחוב הזה או בפרויקט פרימיום דומה בסביבה.',
  ],
  vfm_missing_area: [
    'The confirmed area of this home, which sets the size range for comparison.',
    'ამ ბინის დადასტურებული ფართი, რომლითაც შესადარებელი ზომების დიაპაზონი განისაზღვრება.',
    'Подтвержденная площадь этой квартиры, по которой задается диапазон размеров для сравнения.',
    'Karşılaştırma için büyüklük aralığını belirleyen, bu konutun doğrulanmış alanı.',
    'المساحة المؤكدة لهذا العقار، والتي تحدد نطاق المساحات للمقارنة.',
    'השטח המאומת של הדירה, שקובע את טווח הגדלים להשוואה.',
  ],
  vfm_missing_size: [
    '{{size}} nearby listings were set aside because their size is outside {{min}}–{{max}} m².',
    '{{size}} ახლომდებარე განცხადება გამოვრიცხეთ, რადგან მათი ფართი {{min}}–{{max}} მ²-ის ფარგლებს გარეთაა.',
    '{{size}} объявлений поблизости исключены, так как их площадь вне диапазона {{min}}–{{max}} м².',
    'Alanı {{min}}–{{max}} m² aralığının dışında kaldığı için yakındaki {{size}} ilan dışarıda bırakıldı.',
    'استُبعد {{size}} من الإعلانات القريبة لأن مساحتها خارج نطاق {{min}}–{{max}} م².',
    '{{size}} מודעות סמוכות הוצאו כי שטחן מחוץ לטווח {{min}}–{{max}} מ"ר.',
  ],
  vfm_missing_other_districts: [
    '{{other}} listings from other parts of the city were not used: they describe a different market.',
    '{{other}} განცხადება ქალაქის სხვა უბნებიდან არ გამოგვიყენებია, რადგან ისინი სხვა ბაზარს აღწერს.',
    '{{other}} объявлений из других районов города не использованы: они описывают другой рынок.',
    'Şehrin diğer bölgelerinden {{other}} ilan kullanılmadı: farklı bir pazarı anlatıyorlar.',
    'لم نستخدم {{other}} من الإعلانات من أنحاء أخرى في المدينة، فهي تصف سوقًا مختلفًا.',
    '{{other}} מודעות מאזורים אחרים בעיר לא שימשו: הן מתארות שוק אחר.',
  ],
  vfm_missing_transactions: [
    'Registered sale prices for nearby flats. Listings show asking prices only.',
    'ახლომდებარე ბინების რეგისტრირებული გაყიდვის ფასები. განცხადებები მხოლოდ მოთხოვნილ ფასს აჩვენებს.',
    'Зарегистрированные цены продаж соседних квартир. Объявления показывают только цену предложения.',
    'Yakındaki dairelerin tescilli satış fiyatları. İlanlar yalnızca istenen fiyatı gösterir.',
    'أسعار البيع المسجلة للشقق القريبة. الإعلانات تعرض الأسعار المطلوبة فقط.',
    'מחירי מכירה רשומים של דירות סמוכות. מודעות מציגות מחיר מבוקש בלבד.',
  ],
  vfm_next_title: ['What would make a valuation possible', 'რა გახდის შეფასებას შესაძლებელს', 'Что сделает оценку возможной', 'Değerlemeyi ne mümkün kılar', 'ما الذي يجعل التقييم ممكنًا', 'מה יאפשר הערכת שווי'],
  vfm_next_same_project: [
    'Prices of other flats in the same project, from the developer or current listings.',
    'იმავე პროექტის სხვა ბინების ფასები დეველოპერისგან ან მიმდინარე განცხადებებიდან.',
    'Цены других квартир в том же проекте, от застройщика или из актуальных объявлений.',
    'Aynı projedeki diğer dairelerin fiyatları, geliştiriciden veya güncel ilanlardan.',
    'أسعار شقق أخرى في المشروع نفسه، من المطوّر أو من الإعلانات الحالية.',
    'מחירי דירות אחרות באותו פרויקט, מהיזם או ממודעות עדכניות.',
  ],
  vfm_next_same_street: [
    'More current listings of similar size on the same street.',
    'იმავე ქუჩაზე მსგავსი ფართის მეტი მიმდინარე განცხადება.',
    'Больше актуальных объявлений похожей площади на той же улице.',
    'Aynı sokakta benzer büyüklükte daha fazla güncel ilan.',
    'مزيد من الإعلانات الحالية لمساحات مماثلة في الشارع نفسه.',
    'יותר מודעות עדכניות בגודל דומה באותו רחוב.',
  ],
  vfm_next_registered_sales: [
    'Registered sale prices in this area from the Public Registry.',
    'ამ არეალში რეგისტრირებული გაყიდვების ფასები საჯარო რეესტრიდან.',
    'Зарегистрированные цены продаж в этом районе из Публичного реестра.',
    'Bu bölgedeki tescilli satış fiyatları, Kamu Sicilinden.',
    'أسعار البيع المسجلة في هذه المنطقة من السجل العام.',
    'מחירי מכירה רשומים באזור זה מהמרשם הציבורי.',
  ],
  vfm_next_developer_prices: [
    "The developer's official price list for this building.",
    'ამ შენობისთვის დეველოპერის ოფიციალური ფასების სია.',
    'Официальный прайс-лист застройщика по этому зданию.',
    'Geliştiricinin bu bina için resmi fiyat listesi.',
    'قائمة الأسعار الرسمية من المطوّر لهذا المبنى.',
    'מחירון רשמי של היזם לבניין זה.',
  ],
  vfm_next_subject_area: [
    'The confirmed area of this home from the registry extract.',
    'ამ ბინის დადასტურებული ფართი რეესტრის ამონაწერიდან.',
    'Подтвержденная площадь этой квартиры из выписки реестра.',
    'Bu konutun tapu kaydından doğrulanmış alanı.',
    'المساحة المؤكدة لهذا العقار من مستخرج السجل.',
    'השטח המאומת של הדירה מנסח הרישום.',
  ],
};
