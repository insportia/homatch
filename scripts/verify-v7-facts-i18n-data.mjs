/*
 * Copy for the Verify v7 property facts card (owner, 2026-10-11):
 * "ქონების ძირითადი მონაცემები" — the exact area and the latest extract,
 * near the top of the report — and the registry property kinds.
 *
 * Order is en, ka, ru, tr, ar, he — LANGS in lib/i18nSplice.mjs.
 * The Georgian title, labels and the two lede paragraphs are the owner's
 * verbatim copy. {{n}} survives in every locale.
 */
export const VERIFY_V7_FACTS_STRINGS = {
  verify_v7_facts_eyebrow: ['Public registry', 'საჯარო რეესტრი', 'Публичный реестр', 'Tapu sicili', 'السجل العام', 'המרשם הציבורי'],
  verify_v7_facts_title: ['Key property details', 'ქონების ძირითადი მონაცემები', 'Основные данные объекта', 'Mülkün temel bilgileri', 'البيانات الأساسية للعقار', 'נתוני הנכס העיקריים'],
  verify_v7_facts_lede: [
    'These are the property’s key details, as confirmed by the public registry extract we retrieved. Here you can check the exact area, the cadastral code, the registered owner and the date of the document.',
    'ეს არის ქონების ძირითადი ინფორმაცია, რომელიც საჯარო რეესტრის მოძიებული ამონაწერით დასტურდება. აქ შეგიძლიათ გადაამოწმოთ ზუსტი ფართობი, საკადასტრო კოდი, რეგისტრირებული მესაკუთრე და დოკუმენტის თარიღი.',
    'Это основные данные объекта, подтверждённые полученной выпиской из публичного реестра. Здесь можно проверить точную площадь, кадастровый код, зарегистрированного собственника и дату документа.',
    'Bunlar, edindiğimiz tapu sicili özetiyle doğrulanan mülkün temel bilgileridir. Burada tam alanı, kadastro kodunu, kayıtlı maliki ve belgenin tarihini kontrol edebilirsiniz.',
    'هذه هي البيانات الأساسية للعقار كما يؤكدها مستخرج السجل العام الذي حصلنا عليه. يمكنكم هنا التحقق من المساحة الدقيقة والرمز المساحي والمالك المسجل وتاريخ المستند.',
    'אלה נתוני הנכס העיקריים, כפי שהם מאושרים בנסח המרשם הציבורי שאיתרנו. כאן אפשר לבדוק את השטח המדויק, הקוד הקדסטרי, הבעלים הרשום ותאריך המסמך.',
  ],
  verify_v7_facts_lede_note: [
    'Please note that an extract reflects the position on the day it was prepared. If you plan to buy the property, it is advisable to check the most recent extract before the transaction.',
    'გაითვალისწინეთ, რომ ამონაწერი ასახავს მდგომარეობას მისი მომზადების დღეს. თუ ქონების შეძენას გეგმავთ, გარიგებამდე სასურველია უახლესი ამონაწერის გადამოწმება.',
    'Учтите, что выписка отражает положение на день её подготовки. Если вы планируете покупку, перед сделкой желательно проверить самую свежую выписку.',
    'Bir özetin, hazırlandığı gündeki durumu yansıttığını unutmayın. Mülkü satın almayı planlıyorsanız, işlemden önce en güncel özeti kontrol etmeniz önerilir.',
    'يُرجى ملاحظة أن المستخرج يعكس الوضع في يوم إعداده. إذا كنتم تخططون لشراء العقار، فمن المستحسن التحقق من أحدث مستخرج قبل إتمام الصفقة.',
    'שימו לב שנסח משקף את המצב ביום שבו הוכן. אם אתם מתכננים לרכוש את הנכס, מומלץ לבדוק את הנסח העדכני ביותר לפני העסקה.',
  ],
  verify_v7_facts_type: ['Property type', 'ქონების ტიპი', 'Тип объекта', 'Mülk türü', 'نوع العقار', 'סוג הנכס'],
  verify_v7_facts_cadastral: ['Cadastral code', 'საკადასტრო კოდი', 'Кадастровый код', 'Kadastro kodu', 'الرمز المساحي', 'קוד קדסטרי'],
  verify_v7_facts_area: ['Area', 'ფართობი', 'Площадь', 'Alan', 'المساحة', 'שטח'],
  verify_v7_facts_land_area: ['Land plot area', 'მიწის ნაკვეთის ფართობი', 'Площадь участка', 'Arsa alanı', 'مساحة قطعة الأرض', 'שטח המגרש'],
  verify_v7_facts_address: ['Address', 'მისამართი', 'Адрес', 'Adres', 'العنوان', 'כתובת'],
  verify_v7_facts_block: ['Block', 'ბლოკი', 'Блок', 'Blok', 'المبنى (البلوك)', 'בלוק'],
  verify_v7_facts_floor: ['Floor', 'სართული', 'Этаж', 'Kat', 'الطابق', 'קומה'],
  verify_v7_facts_level: ['Level', 'დონე', 'Уровень', 'Seviye', 'المستوى', 'מפלס'],
  verify_v7_facts_unit_number: ['Unit number', 'ერთეულის ნომერი', 'Номер объекта', 'Birim numarası', 'رقم الوحدة', 'מספר היחידה'],
  verify_v7_facts_owner: ['Registered owner', 'რეგისტრირებული მესაკუთრე', 'Зарегистрированный собственник', 'Kayıtlı malik', 'المالك المسجل', 'הבעלים הרשום'],
  verify_v7_facts_state: ['Condition stated in the registry', 'რეესტრში მითითებული მდგომარეობა', 'Состояние по данным реестра', 'Sicilde belirtilen durum', 'الحالة المذكورة في السجل', 'המצב הרשום במרשם'],
  verify_v7_facts_state_under_construction: ['Under construction', 'მშენებარე', 'Строящийся', 'İnşaat halinde', 'قيد الإنشاء', 'בבנייה'],
  verify_v7_facts_land_function: ['Land use category', 'მიწის ნაკვეთის ფუნქცია', 'Назначение участка', 'Arsa kullanım türü', 'تصنيف استخدام الأرض', 'ייעוד הקרקע'],
  verify_v7_facts_extract_date: ['Latest extract retrieved', 'ბოლო მოძიებული ამონაწერი', 'Последняя полученная выписка', 'Edinilen en son özet', 'أحدث مستخرج تم الحصول عليه', 'הנסח האחרון שאותר'],
  verify_v7_facts_view_extract: ['View extract', 'ამონაწერის ნახვა', 'Открыть выписку', 'Özeti görüntüle', 'عرض المستخرج', 'צפייה בנסח'],
  verify_v7_facts_view_record: ['View the registry record', 'ჩანაწერის ნახვა საჯარო რეესტრში', 'Открыть запись в реестре', 'Sicil kaydını görüntüle', 'عرض القيد في السجل', 'צפייה ברשומה במרשם'],
  verify_v7_facts_sqm: ['{{n}} m²', '{{n}} მ²', '{{n}} м²', '{{n}} m²', '{{n}} م²', '{{n}} מ"ר'],
  verify_v7_facts_parcel_total: ['Whole land plot (not this unit)', 'მთლიანი მიწის ნაკვეთი (არა ეს ერთეული)', 'Весь земельный участок (не этот объект)', 'Arsanın tamamı (bu birim değil)', 'قطعة الأرض بالكامل (ليست هذه الوحدة)', 'המגרש כולו (לא יחידה זו)'],
  verify_v7_facts_building_total: ['Total area of the buildings on the plot (not this unit)', 'ნაკვეთზე არსებული შენობების საერთო ფართი (არა ეს ერთეული)', 'Общая площадь зданий на участке (не этот объект)', 'Arsadaki binaların toplam alanı (bu birim değil)', 'المساحة الإجمالية للمباني على القطعة (ليست هذه الوحدة)', 'השטח הכולל של המבנים במגרש (לא יחידה זו)'],
  verify_v7_facts_kind_apartment: ['Apartment', 'ბინა', 'Квартира', 'Daire', 'شقة', 'דירה'],
  verify_v7_facts_kind_house: ['Private house with land', 'საცხოვრებელი სახლი მიწის ნაკვეთით', 'Частный дом с участком', 'Arsalı müstakil ev', 'منزل خاص مع أرض', 'בית פרטי עם מגרש'],
  verify_v7_facts_kind_land: ['Land plot', 'მიწის ნაკვეთი', 'Земельный участок', 'Arsa', 'قطعة أرض', 'מגרש'],
  verify_v7_facts_kind_parking: ['Parking space', 'ავტოსადგომი', 'Парковочное место', 'Otopark yeri', 'موقف سيارة', 'מקום חניה'],
  verify_v7_facts_kind_commercial: ['Commercial space', 'კომერციული ფართი', 'Коммерческое помещение', 'Ticari alan', 'مساحة تجارية', 'שטח מסחרי'],
  verify_v7_facts_kind_office: ['Office', 'ოფისი', 'Офис', 'Ofis', 'مكتب', 'משרד'],
  verify_v7_facts_kind_storage: ['Storage room', 'სათავსო', 'Кладовое помещение', 'Depo', 'غرفة تخزين', 'מחסן'],
  verify_v7_facts_kind_other: ['Registered space', 'რეგისტრირებული ფართი', 'Зарегистрированное помещение', 'Kayıtlı alan', 'مساحة مسجلة', 'שטח רשום'],
  verify_v7_facts_kind_ambiguous: ['Not clearly determined', 'ცალსახად არ დგინდება', 'Однозначно не определяется', 'Net olarak belirlenemiyor', 'غير محدد بشكل قاطع', 'לא נקבע באופן חד-משמעי'],
  verify_v7_facts_ambiguous_note: [
    'The registry records describe this property in different ways, so we have not assigned a single type. Please check the type in the extract itself.',
    'რეესტრის ჩანაწერებში ეს ქონება სხვადასხვაგვარად არის აღწერილი, ამიტომ მას ერთ კონკრეტულ ტიპს არ ვანიჭებთ. გთხოვთ, ტიპი თავად ამონაწერში გადაამოწმოთ.',
    'В записях реестра этот объект описан по-разному, поэтому мы не присваиваем ему один тип. Пожалуйста, проверьте тип в самой выписке.',
    'Sicil kayıtları bu mülkü farklı şekillerde tanımlıyor, bu nedenle tek bir tür atamadık. Lütfen türü özetin kendisinde kontrol edin.',
    'تصف سجلات السجل العام هذا العقار بطرق مختلفة، لذلك لم نحدد له نوعًا واحدًا. يُرجى التحقق من النوع في المستخرج نفسه.',
    'רשומות המרשם מתארות את הנכס הזה בדרכים שונות, ולכן לא קבענו לו סוג אחד. אנא בדקו את הסוג בנסח עצמו.',
  ],
};
