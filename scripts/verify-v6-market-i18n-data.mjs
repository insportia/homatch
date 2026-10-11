/*
 * Verify v6 MARKET + LOCATION copy (owner, 2026-10-11).
 *
 * The approved MARKET and LOCATION introductions (APPROVED_COPY.md, Georgian
 * verbatim), the property-kind gate (a parking space is never priced from
 * apartments, job dbf04e48), the subject-price verdict rule (no asking price
 * of its own: no verdict), the collapsible methodology panel and the
 * cadastral-plan centre basis for the neighbourhood (job eeefada9).
 *
 * Order is en, ka, ru, tr, ar, he (LANGS in lib/i18nSplice.mjs).
 * Placeholders survive in every locale. No em dashes in customer prose.
 */
export const VERIFY_V6_MARKET_STRINGS = {
  /* ── approved MARKET introduction ── */
  vfm6_intro_title: [
    'Is the property worth the asking price?',
    'ღირს თუ არა ბინა მოთხოვნილ ფასად?',
    'Стоит ли квартира запрашиваемой цены?',
    'Daire istenen fiyata değer mi?',
    'هل تستحق الشقة السعر المطلوب؟',
    'האם הדירה שווה את המחיר המבוקש?',
  ],
  vfm6_intro_p1: [
    'A home should not be judged by its price per square metre alone. What matters is what we compare it with.',
    'ბინის ფასი მხოლოდ კვადრატული მეტრის ღირებულებით არ უნდა შევაფასოთ. მნიშვნელოვანია, რას ვადარებთ ერთმანეთს.',
    'Цену квартиры нельзя оценивать только по стоимости квадратного метра. Важно, с чем мы её сравниваем.',
    'Bir dairenin fiyatı yalnızca metrekare bedeliyle değerlendirilmemeli. Önemli olan neyi neyle karşılaştırdığımızdır.',
    'لا ينبغي تقييم سعر الشقة بسعر المتر المربع وحده. المهم هو ما نقارنها به.',
    'אין להעריך את מחיר הדירה לפי המחיר למטר רבוע בלבד. חשוב עם מה אנחנו משווים אותה.',
  ],
  vfm6_intro_p2: [
    'Two flats can be the same size and still differ in location, building quality, finishing state and infrastructure. That is why we selected offers that genuinely resemble this property.',
    'ორი ბინა შეიძლება ერთი ზომის იყოს, მაგრამ განსხვავდებოდეს მდებარეობით, შენობის ხარისხით, დასრულების მდგომარეობითა და ინფრასტრუქტურით. ამიტომ შევარჩიეთ ისეთი შეთავაზებები, რომლებიც ამ ქონებას რეალურად ჰგავს.',
    'Две квартиры могут быть одного размера, но отличаться расположением, качеством здания, степенью готовности и инфраструктурой. Поэтому мы отобрали предложения, которые действительно похожи на этот объект.',
    'İki daire aynı büyüklükte olup konum, bina kalitesi, tamamlanma durumu ve altyapı bakımından farklı olabilir. Bu yüzden bu mülke gerçekten benzeyen teklifleri seçtik.',
    'قد تكون شقتان بالحجم نفسه لكنهما تختلفان في الموقع وجودة المبنى وحالة التشطيب والبنية التحتية. لذلك اخترنا عروضًا تشبه هذا العقار فعلًا.',
    'שתי דירות יכולות להיות באותו גודל ועדיין להיבדל במיקום, באיכות הבניין, במצב הגמר ובתשתיות. לכן בחרנו הצעות שבאמת דומות לנכס הזה.',
  ],
  vfm6_intro_p3: [
    'Below you will see the prices in similar projects and how competitive the property under review looks.',
    'ქვემოთ ნახავთ, რა ფასებია მსგავს პროექტებში და რამდენად კონკურენტულად გამოიყურება განსახილველი ბინა.',
    'Ниже вы увидите цены в похожих проектах и то, насколько конкурентоспособно выглядит рассматриваемая квартира.',
    'Aşağıda benzer projelerdeki fiyatları ve incelenen dairenin ne kadar rekabetçi göründüğünü bulacaksınız.',
    'ستجد أدناه الأسعار في مشاريع مشابهة ومدى تنافسية الشقة موضوع الدراسة.',
    'למטה תמצאו את המחירים בפרויקטים דומים ועד כמה הדירה הנבדקת נראית תחרותית.',
  ],
  /* Not a flat: the intro says what is compared instead (never "ბინა"). */
  vfm6_intro_parking: [
    'This is a parking space, and a parking space is not priced like a flat: a flat\'s price per square metre says nothing about it. We therefore compared it only with parking spaces offered for sale, and set apartment listings aside.',
    'ეს ქონება ავტოსადგომია, ავტოსადგომის ფასი კი ბინის კვადრატული მეტრის ფასით არ ფასდება. ამიტომ მას მხოლოდ გასაყიდად გამოტანილ ავტოსადგომებს ვადარებთ, ბინების შეთავაზებები კი ამ შეფასებაში არ გამოგვიყენებია.',
    'Это машино-место, а его цена не определяется ценой квадратного метра квартиры. Поэтому мы сравниваем его только с машино-местами, выставленными на продажу, а предложения квартир не использовали.',
    'Bu bir otopark yeridir ve fiyatı bir dairenin metrekare fiyatıyla belirlenmez. Bu yüzden onu yalnızca satışa çıkarılmış otopark yerleriyle karşılaştırdık, daire ilanlarını kullanmadık.',
    'هذا العقار موقف سيارات، وسعر الموقف لا يُقاس بسعر المتر المربع للشقة. لذلك قارنّاه بمواقف السيارات المعروضة للبيع فقط، ولم نستخدم عروض الشقق.',
    'הנכס הזה הוא מקום חניה, ומחירו אינו נקבע לפי המחיר למטר של דירה. לכן השווינו אותו רק למקומות חניה המוצעים למכירה, ולא השתמשנו בהצעות של דירות.',
  ],
  vfm6_intro_commercial: [
    'This is a commercial space, so its price is compared only with commercial spaces offered for sale. Apartment prices describe a different market and are not used.',
    'ეს ქონება კომერციული ფართია, ამიტომ მის ფასს მხოლოდ გასაყიდად გამოტანილ კომერციულ ფართებს ვადარებთ. ბინების ფასები სხვა ბაზარს აღწერს და აქ არ გამოიყენება.',
    'Это коммерческое помещение, поэтому его цену мы сравниваем только с коммерческими помещениями на продажу. Цены квартир описывают другой рынок и не используются.',
    'Bu bir ticari alandır, bu yüzden fiyatını yalnızca satıştaki ticari alanlarla karşılaştırıyoruz. Daire fiyatları başka bir pazarı anlatır ve kullanılmaz.',
    'هذا العقار مساحة تجارية، لذلك نقارن سعره بالمساحات التجارية المعروضة للبيع فقط. أسعار الشقق تصف سوقًا مختلفة ولا تُستخدم هنا.',
    'הנכס הזה הוא שטח מסחרי, ולכן אנו משווים את מחירו רק לשטחים מסחריים המוצעים למכירה. מחירי דירות מתארים שוק אחר ואינם בשימוש.',
  ],
  vfm6_intro_house: [
    'This is a house, so it is compared only with houses offered for sale. Flats in apartment buildings are a different product and are not used.',
    'ეს ქონება საცხოვრებელი სახლია, ამიტომ მას მხოლოდ გასაყიდად გამოტანილ სახლებს ვადარებთ. მრავალბინიან შენობებში არსებული ბინები სხვა პროდუქტია და აქ არ გამოიყენება.',
    'Это дом, поэтому мы сравниваем его только с домами на продажу. Квартиры в многоквартирных зданиях являются другим продуктом и не используются.',
    'Bu bir evdir, bu yüzden yalnızca satıştaki evlerle karşılaştırıyoruz. Apartman daireleri farklı bir üründür ve kullanılmaz.',
    'هذا العقار منزل، لذلك نقارنه بالمنازل المعروضة للبيع فقط. الشقق في المباني السكنية منتج مختلف ولا تُستخدم هنا.',
    'הנכס הזה הוא בית, ולכן אנו משווים אותו רק לבתים המוצעים למכירה. דירות בבנייני מגורים הן מוצר אחר ואינן בשימוש.',
  ],
  vfm6_intro_land: [
    'This is a land plot, so it is compared only with land plots offered for sale. Apartment prices are not used.',
    'ეს ქონება მიწის ნაკვეთია, ამიტომ მას მხოლოდ გასაყიდად გამოტანილ მიწის ნაკვეთებს ვადარებთ. ბინების ფასები აქ არ გამოიყენება.',
    'Это земельный участок, поэтому мы сравниваем его только с участками на продажу. Цены квартир не используются.',
    'Bu bir arsadır, bu yüzden yalnızca satıştaki arsalarla karşılaştırıyoruz. Daire fiyatları kullanılmaz.',
    'هذا العقار قطعة أرض، لذلك نقارنه بقطع الأراضي المعروضة للبيع فقط. لا تُستخدم أسعار الشقق.',
    'הנכס הזה הוא מגרש, ולכן אנו משווים אותו רק למגרשים המוצעים למכירה. מחירי דירות אינם בשימוש.',
  ],

  /* ── the subject's own price ── */
  vfm6_subject_price_unknown: [
    'We did not find an asking price for this property itself, so we do not say whether its price is attractive, reasonable or high. The prices below describe similar offers, not this property.',
    'ამ ქონების საკუთარი მოთხოვნილი ფასი ვერ მოვიძიეთ, ამიტომ არ ვაფასებთ, მისი ფასი მიმზიდველია, გონივრული თუ მაღალი. ქვემოთ მოცემული ფასები მსგავს შეთავაზებებს აღწერს და არა თავად ამ ქონებას.',
    'Мы не нашли запрашиваемую цену самого объекта, поэтому не оцениваем, привлекательна ли она, разумна или высока. Цены ниже описывают похожие предложения, а не сам объект.',
    'Bu mülkün kendi istenen fiyatını bulamadık, bu yüzden fiyatının cazip, makul ya da yüksek olduğunu söylemiyoruz. Aşağıdaki fiyatlar bu mülkü değil, benzer teklifleri anlatır.',
    'لم نجد سعرًا مطلوبًا لهذا العقار نفسه، لذلك لا نقول إن سعره جذاب أو معقول أو مرتفع. الأسعار أدناه تصف عروضًا مشابهة وليس هذا العقار.',
    'לא מצאנו מחיר מבוקש לנכס הזה עצמו, ולכן איננו קובעים אם מחירו אטרקטיבי, סביר או גבוה. המחירים למטה מתארים הצעות דומות ולא את הנכס הזה.',
  ],
  vfm6_subject_price_label: ['Asking price of this property', 'ამ ქონების მოთხოვნილი ფასი', 'Запрашиваемая цена объекта', 'Bu mülkün istenen fiyatı', 'السعر المطلوب لهذا العقار', 'המחיר המבוקש לנכס'],
  vfm6_subject_price_no_verdict: [
    'There are not enough truly comparable offers to say how this price compares.',
    'ჯერ არ გვაქვს საკმარისი, რეალურად მსგავსი შეთავაზება, რომ ვთქვათ, როგორ გამოიყურება ეს ფასი მათთან შედარებით.',
    'Пока недостаточно действительно похожих предложений, чтобы сказать, как выглядит эта цена в сравнении.',
    'Bu fiyatın nasıl durduğunu söylemek için henüz yeterince benzer teklif yok.',
    'لا توجد حتى الآن عروض مشابهة فعلًا بما يكفي لنقول كيف يبدو هذا السعر بالمقارنة.',
    'עדיין אין מספיק הצעות דומות באמת כדי לומר כיצד המחיר הזה נראה בהשוואה.',
  ],
  vfm6_pos_below: [
    'Below the range of the comparable asking prices above.',
    'ზემოთ მოცემული მსგავსი შეთავაზებების ფასების დიაპაზონზე დაბალია.',
    'Ниже диапазона цен похожих предложений выше.',
    'Yukarıdaki benzer tekliflerin fiyat aralığının altında.',
    'أقل من نطاق أسعار العروض المشابهة أعلاه.',
    'מתחת לטווח המחירים של ההצעות הדומות שלמעלה.',
  ],
  vfm6_pos_lower: [
    'In the lower part of the comparable asking prices above.',
    'ზემოთ მოცემული მსგავსი შეთავაზებების ფასების ქვედა ნაწილშია.',
    'В нижней части цен похожих предложений выше.',
    'Yukarıdaki benzer tekliflerin fiyatlarının alt kısmında.',
    'في الجزء الأدنى من أسعار العروض المشابهة أعلاه.',
    'בחלק התחתון של מחירי ההצעות הדומות שלמעלה.',
  ],
  vfm6_pos_around: [
    'Close to the middle of the comparable asking prices above.',
    'ზემოთ მოცემული მსგავსი შეთავაზებების ფასების შუა ნაწილთან ახლოსაა.',
    'Близко к середине цен похожих предложений выше.',
    'Yukarıdaki benzer tekliflerin fiyatlarının ortasına yakın.',
    'قريب من منتصف أسعار العروض المشابهة أعلاه.',
    'קרוב לאמצע מחירי ההצעות הדומות שלמעלה.',
  ],
  vfm6_pos_higher: [
    'Above the middle of the comparable asking prices above.',
    'ზემოთ მოცემული მსგავსი შეთავაზებების ფასების შუა ნიშნულზე მაღალია.',
    'Выше середины цен похожих предложений выше.',
    'Yukarıdaki benzer tekliflerin fiyatlarının ortasının üzerinde.',
    'أعلى من منتصف أسعار العروض المشابهة أعلاه.',
    'מעל אמצע מחירי ההצעות הדומות שלמעלה.',
  ],
  vfm6_pos_well_above: [
    'Well above the comparable asking prices above.',
    'ზემოთ მოცემული მსგავსი შეთავაზებების ფასებზე მნიშვნელოვნად მაღალია.',
    'Заметно выше цен похожих предложений выше.',
    'Yukarıdaki benzer tekliflerin fiyatlarının belirgin şekilde üzerinde.',
    'أعلى بوضوح من أسعار العروض المشابهة أعلاه.',
    'גבוה משמעותית ממחירי ההצעות הדומות שלמעלה.',
  ],
  vfm6_badge_transaction: ['Sale', 'გარიგება', 'Сделка', 'Satış', 'صفقة', 'עסקה'],

  /* ── methodology (collapsed) ── */
  vfm6_method_title: ['How we chose these offers', 'როგორ შევარჩიეთ ეს შეთავაზებები', 'Как мы отобрали эти предложения', 'Bu teklifleri nasıl seçtik', 'كيف اخترنا هذه العروض', 'איך בחרנו את ההצעות האלה'],
  vfm6_method_hierarchy: [
    'Order of relevance: the same development first, then the same address, the same street, then comparable developments in the same or a neighbouring area. Listings from unrelated parts of the city are not used. A similar price alone never makes an offer comparable.',
    'შესაბამისობის რიგი: ჯერ იგივე პროექტი, შემდეგ იგივე მისამართი, იგივე ქუჩა და ბოლოს მსგავსი პროექტები იმავე ან მეზობელ უბანში. ქალაქის სხვა, შეუსაბამო ნაწილების შეთავაზებები არ გამოიყენება. მხოლოდ მსგავსი ფასი შეთავაზებას შესადარებლად ვერ აქცევს.',
    'Порядок значимости: сначала тот же проект, затем тот же адрес, та же улица, затем похожие проекты в том же или соседнем районе. Предложения из других частей города не используются. Одна лишь похожая цена не делает предложение сопоставимым.',
    'Önem sırası: önce aynı proje, sonra aynı adres, aynı sokak, ardından aynı veya komşu semtteki benzer projeler. Şehrin ilgisiz bölgelerindeki ilanlar kullanılmaz. Yalnızca benzer fiyat bir teklifi karşılaştırılabilir yapmaz.',
    'ترتيب الصلة: المشروع نفسه أولًا، ثم العنوان نفسه، ثم الشارع نفسه، ثم مشاريع مشابهة في الحي نفسه أو حي مجاور. لا تُستخدم إعلانات من أجزاء غير ذات صلة من المدينة. السعر المشابه وحده لا يجعل العرض قابلًا للمقارنة.',
    'סדר הרלוונטיות: קודם אותו פרויקט, אחר כך אותה כתובת, אותו רחוב, ולבסוף פרויקטים דומים באותה שכונה או בשכונה סמוכה. מודעות מחלקים לא קשורים של העיר אינן בשימוש. מחיר דומה לבדו אינו הופך הצעה לברת השוואה.',
  ],
  vfm6_method_kind: [
    'Property type compared: {{kind}}. Other property types were set aside.',
    'შედარებული ქონების ტიპი: {{kind}}. სხვა ტიპის ქონება გვერდზე გადავდეთ.',
    'Сравниваемый тип объекта: {{kind}}. Объекты других типов не учитывались.',
    'Karşılaştırılan mülk türü: {{kind}}. Diğer türler dışarıda bırakıldı.',
    'نوع العقار المقارَن: {{kind}}. استُبعدت الأنواع الأخرى.',
    'סוג הנכס שהושווה: {{kind}}. סוגים אחרים הוצאו מההשוואה.',
  ],
  vfm6_method_size: [
    'Size range used: {{min}} to {{max}} m².',
    'გამოყენებული ფართობის დიაპაზონი: {{min}}-დან {{max}} მ²-მდე.',
    'Использованный диапазон площади: от {{min}} до {{max}} м².',
    'Kullanılan alan aralığı: {{min}} ile {{max}} m² arası.',
    'نطاق المساحة المستخدم: من {{min}} إلى {{max}} م².',
    'טווח השטח שנעשה בו שימוש: {{min}} עד {{max}} מ״ר.',
  ],
  vfm6_method_minimum: [
    'A price range is shown only with at least {{count}} truly comparable offers.',
    'ფასების დიაპაზონს მხოლოდ მაშინ ვაჩვენებთ, როცა სულ მცირე {{count}} რეალურად მსგავსი შეთავაზება გვაქვს.',
    'Диапазон цен показывается только при наличии не менее {{count}} действительно похожих предложений.',
    'Fiyat aralığı yalnızca en az {{count}} gerçekten benzer teklif olduğunda gösterilir.',
    'لا يُعرض نطاق الأسعار إلا بوجود {{count}} عروض مشابهة فعلًا على الأقل.',
    'טווח מחירים מוצג רק כשיש לפחות {{count}} הצעות דומות באמת.',
  ],
  vfm6_method_excluded: ['Set aside', 'გვერდზე გადადებული შეთავაზებები', 'Не учтены', 'Dışarıda bırakılanlar', 'ما استُبعد', 'מה הוצא מההשוואה'],
  vfm6_ex_other_district: ['{{count}} in unrelated parts of the city', '{{count}} ქალაქის შეუსაბამო ნაწილში', '{{count}} в других частях города', 'Şehrin ilgisiz bölgelerinde {{count}}', '{{count}} في أجزاء غير ذات صلة من المدينة', '{{count}} בחלקים לא קשורים של העיר'],
  vfm6_ex_district_unknown: ['{{count}} with no identifiable area', '{{count}} უბნის დადგენის გარეშე', '{{count}} без определяемого района', 'Semti belirlenemeyen {{count}}', '{{count}} دون حي محدد', '{{count}} ללא שכונה מזוהה'],
  vfm6_ex_other_kind: ['{{count}} of another property type', '{{count}} სხვა ტიპის ქონება', '{{count}} другого типа объекта', 'Başka türde {{count}} mülk', '{{count}} من نوع عقار آخر', '{{count}} מסוג נכס אחר'],
  vfm6_ex_size: ['{{count}} far from this size', '{{count}} ფართობით მნიშვნელოვნად განსხვავებული', '{{count}} сильно отличаются по площади', 'Alanı çok farklı {{count}}', '{{count}} بمساحة بعيدة عن هذه', '{{count}} בגודל שונה בהרבה'],
  vfm6_ex_size_unknown: ['{{count}} without a stated size', '{{count}} ფართობის მითითების გარეშე', '{{count}} без указанной площади', 'Alanı belirtilmemiş {{count}}', '{{count}} دون مساحة مذكورة', '{{count}} ללא שטח מצוין'],
  vfm6_ex_rent: ['{{count}} for rent, not for sale', '{{count}} ქირავდება და არა იყიდება', '{{count}} в аренду, а не на продажу', 'Satılık değil kiralık {{count}}', '{{count}} للإيجار لا للبيع', '{{count}} להשכרה ולא למכירה'],
  vfm6_ex_class: ['{{count}} in older buildings', '{{count}} ძველ შენობებში', '{{count}} в старых зданиях', 'Eski binalarda {{count}}', '{{count}} في مبانٍ قديمة', '{{count}} בבניינים ישנים'],
  vfm6_ex_condition: ['{{count}} in a very different condition', '{{count}} მნიშვნელოვნად განსხვავებულ მდგომარეობაში', '{{count}} в совсем ином состоянии', 'Çok farklı durumda {{count}}', '{{count}} بحالة مختلفة جدًا', '{{count}} במצב שונה מאוד'],
  vfm6_ex_expired: ['{{count}} no longer on offer', '{{count}} აღარ იყიდება', '{{count}} уже сняты с продажи', 'Artık satışta olmayan {{count}}', '{{count}} لم تعد معروضة', '{{count}} שכבר אינן מוצעות'],
  vfm6_ex_stale: ['{{count}} older than a year', '{{count}} ერთ წელზე ძველი', '{{count}} старше года', 'Bir yıldan eski {{count}}', '{{count}} أقدم من عام', '{{count}} ישנות משנה'],
  vfm6_ex_outlier: ['{{count}} with an unusual price for their group', '{{count}} თავისი ჯგუფისთვის უჩვეულო ფასით', '{{count}} с нетипичной для группы ценой', 'Grubuna göre olağan dışı fiyatlı {{count}}', '{{count}} بسعر غير معتاد لمجموعتها', '{{count}} במחיר חריג לקבוצה שלהן'],

  /* ── property kinds ── */
  vfm6_kind_apartment: ['apartment', 'ბინა', 'квартира', 'daire', 'شقة', 'דירה'],
  vfm6_kind_parking: ['parking space', 'ავტოსადგომი', 'машино-место', 'otopark yeri', 'موقف سيارات', 'מקום חניה'],
  vfm6_kind_commercial: ['commercial space', 'კომერციული ფართი', 'коммерческое помещение', 'ticari alan', 'مساحة تجارية', 'שטח מסחרי'],
  vfm6_kind_house: ['house', 'საცხოვრებელი სახლი', 'дом', 'ev', 'منزل', 'בית'],
  vfm6_kind_land: ['land plot', 'მიწის ნაკვეთი', 'земельный участок', 'arsa', 'قطعة أرض', 'מגרש'],

  /* ── what is missing for a non-apartment ── */
  vfm6_missing_same_kind_parking: [
    'No parking spaces offered for sale nearby were found. The {{kinds}} listings gathered were apartments, and an apartment price does not describe a parking space.',
    'ახლომახლო გასაყიდად გამოტანილი ავტოსადგომი ვერ მოვიძიეთ. მოძიებული {{kinds}} შეთავაზება ბინებს ეხებოდა, ბინის ფასი კი ავტოსადგომის ღირებულებას ვერ აღწერს.',
    'Машино-места на продажу поблизости не найдены. Собранные {{kinds}} предложений относились к квартирам, а цена квартиры не описывает машино-место.',
    'Yakında satılık otopark yeri bulunamadı. Toplanan {{kinds}} ilan daireydi ve daire fiyatı bir otopark yerini anlatmaz.',
    'لم نعثر على مواقف سيارات معروضة للبيع في الجوار. كانت العروض التي جُمعت ({{kinds}}) شققًا، وسعر الشقة لا يصف موقف السيارات.',
    'לא נמצאו מקומות חניה למכירה בסביבה. {{kinds}} המודעות שנאספו היו דירות, ומחיר דירה אינו מתאר מקום חניה.',
  ],
  vfm6_missing_same_kind_commercial: [
    'No comparable commercial spaces for sale were found nearby; the {{kinds}} listings of other types were set aside.',
    'ახლომახლო მსგავსი კომერციული ფართი გასაყიდად ვერ მოვიძიეთ. სხვა ტიპის {{kinds}} შეთავაზება გვერდზე გადავდეთ.',
    'Похожих коммерческих помещений на продажу поблизости не найдено; {{kinds}} предложений другого типа не учитывались.',
    'Yakında satılık benzer ticari alan bulunamadı; başka türdeki {{kinds}} ilan dışarıda bırakıldı.',
    'لم نعثر على مساحات تجارية مشابهة للبيع في الجوار؛ واستُبعدت {{kinds}} عروض من أنواع أخرى.',
    'לא נמצאו שטחים מסחריים דומים למכירה בסביבה; {{kinds}} מודעות מסוגים אחרים הוצאו מההשוואה.',
  ],
  vfm6_missing_same_kind_house: [
    'No comparable houses for sale were found nearby; the {{kinds}} listings of other types were set aside.',
    'ახლომახლო მსგავსი სახლი გასაყიდად ვერ მოვიძიეთ. სხვა ტიპის {{kinds}} შეთავაზება გვერდზე გადავდეთ.',
    'Похожих домов на продажу поблизости не найдено; {{kinds}} предложений другого типа не учитывались.',
    'Yakında satılık benzer ev bulunamadı; başka türdeki {{kinds}} ilan dışarıda bırakıldı.',
    'لم نعثر على منازل مشابهة للبيع في الجوار؛ واستُبعدت {{kinds}} عروض من أنواع أخرى.',
    'לא נמצאו בתים דומים למכירה בסביבה; {{kinds}} מודעות מסוגים אחרים הוצאו מההשוואה.',
  ],
  vfm6_missing_same_kind_land: [
    'No comparable land plots for sale were found nearby; the {{kinds}} listings of other types were set aside.',
    'ახლომახლო მსგავსი მიწის ნაკვეთი გასაყიდად ვერ მოვიძიეთ. სხვა ტიპის {{kinds}} შეთავაზება გვერდზე გადავდეთ.',
    'Похожих участков на продажу поблизости не найдено; {{kinds}} предложений другого типа не учитывались.',
    'Yakında satılık benzer arsa bulunamadı; başka türdeki {{kinds}} ilan dışarıda bırakıldı.',
    'لم نعثر على قطع أراضٍ مشابهة للبيع في الجوار؛ واستُبعدت {{kinds}} عروض من أنواع أخرى.',
    'לא נמצאו מגרשים דומים למכירה בסביבה; {{kinds}} מודעות מסוגים אחרים הוצאו מההשוואה.',
  ],
  vfm6_next_parking_developer: [
    'Ask the developer or seller for the current price list of parking spaces in this building.',
    'სთხოვეთ დეველოპერს ან გამყიდველს ამ შენობის ავტოსადგომების მიმდინარე ფასების ჩამონათვალი.',
    'Запросите у застройщика или продавца актуальный прайс-лист машино-мест в этом здании.',
    'Geliştiriciden veya satıcıdan bu binadaki otopark yerlerinin güncel fiyat listesini isteyin.',
    'اطلب من المطوّر أو البائع قائمة الأسعار الحالية لمواقف السيارات في هذا المبنى.',
    'בקשו מהיזם או מהמוכר את מחירון מקומות החניה העדכני בבניין.',
  ],
  vfm6_next_parking_listings: [
    'Compare with parking spaces offered for sale in nearby new developments.',
    'შეადარეთ ახლომდებარე ახალ პროექტებში გასაყიდად გამოტანილ ავტოსადგომებს.',
    'Сравните с машино-местами на продажу в соседних новостройках.',
    'Yakındaki yeni projelerde satıştaki otopark yerleriyle karşılaştırın.',
    'قارن بمواقف السيارات المعروضة للبيع في المشاريع الجديدة القريبة.',
    'השוו למקומות חניה המוצעים למכירה בפרויקטים חדשים סמוכים.',
  ],

  /* ── approved LOCATION introduction ── */
  vnb6_intro_title: [
    'What will everyday life be like here?',
    'როგორი იქნება აქ ყოველდღიური ცხოვრება?',
    'Какой будет здесь повседневная жизнь?',
    'Burada gündelik hayat nasıl olacak?',
    'كيف ستكون الحياة اليومية هنا؟',
    'איך ייראו כאן חיי היומיום?',
  ],
  vnb6_intro_p1: [
    'When choosing a home, the building itself is not the only thing that matters. What is nearby also has a big effect on everyday comfort.',
    'ბინის შერჩევისას მხოლოდ თავად შენობა არ არის მნიშვნელოვანი. ყოველდღიურ კომფორტზე დიდ გავლენას ახდენს ისიც, რა მდებარეობს ახლოს.',
    'При выборе квартиры важно не только само здание. На повседневный комфорт сильно влияет и то, что находится рядом.',
    'Ev seçerken yalnızca binanın kendisi önemli değildir. Yakında ne olduğu da gündelik konforu büyük ölçüde etkiler.',
    'عند اختيار الشقة لا يهم المبنى وحده. فما يقع بالقرب منه يؤثر كثيرًا أيضًا في راحة الحياة اليومية.',
    'בבחירת דירה לא רק הבניין עצמו חשוב. גם מה שנמצא בקרבת מקום משפיע מאוד על הנוחות היומיומית.',
  ],
  vnb6_intro_p2: [
    'We checked the available information on transport, shops, schools, medical services and places to relax, so you can better picture how convenient this place is to live in.',
    'შევამოწმეთ ტრანსპორტის, მაღაზიების, სკოლების, სამედიცინო მომსახურებისა და დასასვენებელი სივრცეების შესახებ ხელმისაწვდომი ინფორმაცია, რათა უკეთ წარმოიდგინოთ, რამდენად მოსახერხებელია ეს ადგილი საცხოვრებლად.',
    'Мы проверили доступную информацию о транспорте, магазинах, школах, медицинских услугах и местах отдыха, чтобы вы лучше представили, насколько удобно здесь жить.',
    'Ulaşım, mağazalar, okullar, sağlık hizmetleri ve dinlenme alanları hakkında erişilebilir bilgileri kontrol ettik; böylece burada yaşamanın ne kadar rahat olduğunu daha iyi canlandırabilirsiniz.',
    'راجعنا المعلومات المتاحة عن المواصلات والمتاجر والمدارس والخدمات الطبية وأماكن الاستراحة، لتتصور بشكل أفضل مدى ملاءمة هذا المكان للسكن.',
    'בדקנו את המידע הזמין על תחבורה, חנויות, בתי ספר, שירותי בריאות ומקומות בילוי, כדי שתוכלו לדמיין טוב יותר עד כמה המקום נוח למגורים.',
  ],
  verify_nb_basis_CADASTRAL_PLAN: [
    'Measured from the parcel centre on the official cadastral plan (Public Registry, WGS 84 / UTM coordinates), so distances are accurate to within a few tens of metres.',
    'მანძილი გაზომილია ნაკვეთის ცენტრიდან, საჯარო რეესტრის ოფიციალური საკადასტრო გეგმის კოორდინატების მიხედვით (WGS 84 / UTM), ამიტომ ცდომილება რამდენიმე ათეულ მეტრს არ აღემატება.',
    'Расстояния измерены от центра участка по координатам официального кадастрового плана Публичного реестра (WGS 84 / UTM), с точностью до нескольких десятков метров.',
    'Mesafeler, Kamu Sicili resmi kadastro planının koordinatlarına (WGS 84 / UTM) göre parsel merkezinden ölçüldü; birkaç on metre hassasiyetindedir.',
    'قيست المسافات من مركز قطعة الأرض وفق إحداثيات المخطط المساحي الرسمي للسجل العام (WGS 84 / UTM)، بدقة في حدود بضع عشرات من الأمتار.',
    'המרחקים נמדדו ממרכז החלקה לפי קואורדינטות התוכנית הקדסטרית הרשמית של המרשם הציבורי (WGS 84 / UTM), בדיוק של כמה עשרות מטרים.',
  ],
  vrx_area_dighomi_massive: ['Dighomi Massive', 'დიღმის მასივი', 'Дигомский массив', 'Dighomi Massivi', 'مجمع ديغومي', 'מתחם דיגומי'],
};
