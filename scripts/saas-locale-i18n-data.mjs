// English, Georgian, Russian, Turkish, Arabic, Hebrew.
// SaaS round, locale + legal workstream (2026-10-29):
//   * the language suggestion toast (LanguageSuggestion.tsx). Each locale's
//     value is shown TO a visitor IN that language and offers that language,
//     so every value names its own language;
//   * the new operator's entity type (src/lib/legal/operator.ts);
//   * Terms section "fees" rewritten for monthly GEL plans (TermsPage.tsx).
//     Prices and allowances are admin-configurable, so the Terms point to the
//     pricing page rather than quoting numbers. Facts that depend on the bank
//     payment provider (methods, moment of charge, auto-renewal, refunds
//     procedure) are stated as provider-dependent, not invented.
export const SAAS_LOCALE_STRINGS = {
  // ── Language suggestion (IP country, only when nothing better was known) ──
  lang_suggest_message: [
    'Would you like to use HOMATCH in English?',
    'გსურთ HOMATCH-ით ქართულად სარგებლობა?',
    'Хотите пользоваться HOMATCH на русском?',
    'HOMATCH\'i Türkçe kullanmak ister misiniz?',
    'هل تودّ استخدام HOMATCH باللغة العربية؟',
    'רוצה להשתמש ב-HOMATCH בעברית?',
  ],
  lang_suggest_switch: ['Switch to English', 'ქართულზე გადართვა', 'Перейти на русский', 'Türkçeye geç', 'التبديل إلى العربية', 'מעבר לעברית'],
  lang_suggest_dismiss: ['No, thanks', 'არა, გმადლობთ', 'Нет, спасибо', 'Hayır, teşekkürler', 'لا، شكرًا', 'לא, תודה'],

  // ── Legal operator: entity type ──
  legal_entity_llc: [
    'Limited Liability Company',
    'შეზღუდული პასუხისმგებლობის საზოგადოება',
    'Общество с ограниченной ответственностью',
    'Limited Şirket',
    'شركة ذات مسؤولية محدودة',
    'חברה בערבון מוגבל',
  ],

  // ── Archived editions (?version=), kept as they were for those who accepted them ──
  legal_archived_notice: [
    'You are reading an archived edition (version {{version}}), which applied until {{until}}. It is kept unchanged for those who accepted it.',
    'თქვენ კითხულობთ დაარქივებულ ვერსიას ({{version}}), რომელიც მოქმედებდა {{until}}-მდე. ის უცვლელად ინახება მათთვის, ვინც ის დაადასტურა.',
    'Вы читаете архивную редакцию (версия {{version}}), которая действовала до {{until}}. Она сохранена без изменений для тех, кто её принял.',
    'Arşivlenmiş bir sürümü okuyorsunuz (sürüm {{version}}); bu sürüm {{until}} tarihine kadar geçerliydi. Kabul edenler için değiştirilmeden saklanmaktadır.',
    'أنت تقرأ نسخة مؤرشفة (الإصدار {{version}})، وكانت سارية حتى {{until}}. وهي محفوظة دون تغيير لمن وافق عليها.',
    'אתה קורא גרסה בארכיון (גרסה {{version}}), שהייתה בתוקף עד {{until}}. היא נשמרת ללא שינוי עבור מי שאישר אותה.',
  ],
  legal_view_current: ['Read the current version', 'მიმდინარე ვერსიის ნახვა', 'Открыть действующую редакцию', 'Güncel sürümü okuyun', 'اقرأ النسخة الحالية', 'לקריאת הגרסה הנוכחית'],
  legal_previous_versions: ['Previous versions:', 'წინა ვერსიები:', 'Предыдущие редакции:', 'Önceki sürümler:', 'الإصدارات السابقة:', 'גרסאות קודמות:'],

  // ── Terms: subscription plans and fees ──
  terms_sub_title: ['Subscription plans and fees', 'გამოწერის პაკეტები და საფასური', 'Тарифные планы и оплата', 'Abonelik planları ve ücretler', 'خطط الاشتراك والرسوم', 'תוכניות מנוי ותשלומים'],
  terms_sub_plans: [
    'HOMATCH is offered on monthly subscription plans: STANDARD, VIP and UNLIMITED. Prices are in Georgian lari (GEL) and are final prices, including any applicable VAT. The current price of each plan and what it includes in a billing period, such as the number of Verify reports and contract analyses, are shown on the pricing page and before you confirm a purchase. A plan fee is the fee for digital services and is not a commission calculated from the value of a real-estate transaction.',
    'HOMATCH ხელმისაწვდომია ყოველთვიური გამოწერის პაკეტებით: STANDARD, VIP და UNLIMITED. ფასები მითითებულია ლარში და საბოლოოა, მათ შორის მოიცავს დღგ-ს, თუ ის გამოიყენება. თითოეული პაკეტის მიმდინარე ფასი და ის, რასაც პაკეტი ერთი საანგარიშო პერიოდის განმავლობაში მოიცავს, მაგალითად Verify ანგარიშებისა და ხელშეკრულების ანალიზების რაოდენობა, ნაჩვენებია ფასების გვერდზე და შეძენის დადასტურებამდე. პაკეტის საფასური არის ციფრული მომსახურების საფასური და არ წარმოადგენს უძრავი ქონების გარიგების ღირებულებიდან გამოთვლილ საკომისიოს.',
    'HOMATCH предоставляется по ежемесячным тарифным планам: STANDARD, VIP и UNLIMITED. Цены указаны в грузинских лари (GEL) и являются окончательными, включая применимый НДС, если он начисляется. Текущая цена каждого плана и то, что он включает за расчётный период, например количество отчётов Verify и анализов договоров, указаны на странице цен и перед подтверждением покупки. Плата за план является платой за цифровые услуги и не является комиссией, рассчитанной от стоимости сделки с недвижимостью.',
    'HOMATCH aylık abonelik planlarıyla sunulur: STANDARD, VIP ve UNLIMITED. Fiyatlar Gürcü larisi (GEL) cinsindendir ve varsa geçerli KDV dahil nihai fiyatlardır. Her planın güncel fiyatı ve bir fatura döneminde neleri kapsadığı, örneğin Verify raporu ve sözleşme analizi sayısı, fiyatlandırma sayfasında ve satın almayı onaylamadan önce gösterilir. Plan ücreti dijital hizmetlerin bedelidir ve gayrimenkul işleminin değeri üzerinden hesaplanan bir komisyon değildir.',
    'تُقدَّم HOMATCH عبر خطط اشتراك شهرية: STANDARD وVIP وUNLIMITED. الأسعار باللاري الجورجي (GEL) وهي أسعار نهائية تشمل ضريبة القيمة المضافة المطبقة إن وُجدت. يُعرض السعر الحالي لكل خطة وما تشمله خلال فترة الفوترة، مثل عدد تقارير Verify وتحليلات العقود، في صفحة الأسعار وقبل تأكيد الشراء. رسوم الخطة مقابلٌ لخدمات رقمية وليست عمولة محسوبة من قيمة الصفقة العقارية.',
    'HOMATCH מוצעת בתוכניות מנוי חודשיות: STANDARD, VIP ו-UNLIMITED. המחירים נקובים בלארי גאורגי (GEL) והם מחירים סופיים הכוללים מע״מ החל, אם חל. המחיר הנוכחי של כל תוכנית ומה שהיא כוללת בתקופת חיוב, כמו מספר דוחות Verify וניתוחי חוזים, מוצגים בעמוד המחירים ולפני אישור הרכישה. דמי התוכנית הם תשלום עבור שירותים דיגיטליים ואינם עמלה המחושבת משווי עסקת הנדל״ן.',
  ],
  terms_sub_trial: [
    'Every new account can use each paid feature, such as a Verify report or a contract analysis, once free of charge and without a payment card. The free use is counted only when the result is delivered successfully, and only once per account for each feature.',
    'ყოველ ახალ ანგარიშს შეუძლია თითოეული ფასიანი ფუნქციით, მაგალითად Verify ანგარიშით ან ხელშეკრულების ანალიზით, ერთხელ უფასოდ ისარგებლოს, საბანკო ბარათის მითითების გარეშე. უფასო გამოყენება ჩაითვლება მხოლოდ მაშინ, როცა შედეგი წარმატებით მოგეწოდებათ, და მხოლოდ ერთხელ თითოეულ ფუნქციაზე ერთ ანგარიშზე.',
    'Каждый новый аккаунт может один раз бесплатно воспользоваться каждой платной функцией, например отчётом Verify или анализом договора, без банковской карты. Бесплатное использование засчитывается только при успешной выдаче результата и только один раз на аккаунт для каждой функции.',
    'Her yeni hesap, Verify raporu veya sözleşme analizi gibi her ücretli özelliği bir kez ücretsiz ve banka kartı olmadan kullanabilir. Ücretsiz kullanım yalnızca sonuç başarıyla teslim edildiğinde ve her özellik için hesap başına yalnızca bir kez sayılır.',
    'يمكن لكل حساب جديد استخدام كل ميزة مدفوعة، مثل تقرير Verify أو تحليل عقد، مرة واحدة مجانًا ودون بطاقة دفع. ولا يُحتسب الاستخدام المجاني إلا عند تسليم النتيجة بنجاح، ومرة واحدة فقط لكل حساب ولكل ميزة.',
    'כל חשבון חדש יכול להשתמש בכל תכונה בתשלום, כמו דוח Verify או ניתוח חוזה, פעם אחת בחינם וללא כרטיס אשראי. השימוש החינמי נספר רק כשהתוצאה נמסרה בהצלחה, ורק פעם אחת לכל חשבון ולכל תכונה.',
  ],
  terms_sub_included: [
    'Every plan includes HOMI chat (text and voice), searching properties on HOMATCH, matching with buyers and tenants on HOMATCH and opening the contact details of those matches, without a separate charge. Reasonable technical limits apply to protect the service, for example a maximum length of a voice message and limits on the number of requests.',
    'ყველა პაკეტი მოიცავს HOMI ჩატს (ტექსტური და ხმოვანი), HOMATCH-ზე ქონების ძიებას, HOMATCH-ზე მყიდველებთან და მოიჯარეებთან დამთხვევას და ამ დამთხვევების საკონტაქტო მონაცემების გახსნას, ცალკე საფასურის გარეშე. მომსახურების დასაცავად მოქმედებს გონივრული ტექნიკური შეზღუდვები, მაგალითად ხმოვანი შეტყობინების მაქსიმალური ხანგრძლივობა და მოთხოვნების რაოდენობის ლიმიტი.',
    'Каждый план включает чат HOMI (текстом и голосом), поиск недвижимости на HOMATCH, подбор покупателей и арендаторов на HOMATCH и открытие контактов найденных совпадений без отдельной платы. Для защиты сервиса действуют разумные технические ограничения, например максимальная длина голосового сообщения и лимиты на количество запросов.',
    'Her plan; HOMI sohbetini (yazılı ve sesli), HOMATCH üzerinde mülk aramayı, HOMATCH üzerinde alıcı ve kiracılarla eşleştirmeyi ve bu eşleşmelerin iletişim bilgilerini açmayı ayrıca ücret alınmadan kapsar. Hizmeti korumak için makul teknik sınırlar uygulanır; örneğin sesli mesajın azami uzunluğu ve istek sayısı sınırları.',
    'تشمل كل خطة محادثة HOMI (نصًا وصوتًا)، والبحث عن العقارات على HOMATCH، والمطابقة مع المشترين والمستأجرين على HOMATCH، وفتح بيانات الاتصال لهذه المطابقات، دون رسوم منفصلة. وتُطبَّق حدود تقنية معقولة لحماية الخدمة، مثل الحد الأقصى لطول الرسالة الصوتية وحدود عدد الطلبات.',
    'כל תוכנית כוללת צ׳אט HOMI (טקסט וקול), חיפוש נכסים ב-HOMATCH, התאמה לקונים ולשוכרים ב-HOMATCH ופתיחת פרטי הקשר של ההתאמות האלה, ללא תשלום נפרד. כדי להגן על השירות חלות מגבלות טכניות סבירות, כמו אורך מרבי של הודעה קולית ומגבלות על מספר הבקשות.',
  ],
  terms_sub_third_party: [
    'Costs of third parties are not included in any plan: advertising budgets (for example Meta Ads), paid searches of external sources and GPU rendering. They are shown separately and charged only after you confirm them.',
    'არცერთ პაკეტში არ შედის მესამე მხარის ხარჯები: სარეკლამო ბიუჯეტი (მაგალითად Meta Ads), გარე წყაროებში ფასიანი ძიება და GPU რენდერინგი. ისინი ცალკე ჩანს და ჩამოგეჭრებათ მხოლოდ თქვენი დადასტურების შემდეგ.',
    'Расходы третьих сторон не входят ни в один план: рекламные бюджеты (например Meta Ads), платный поиск во внешних источниках и рендеринг на GPU. Они показываются отдельно и списываются только после вашего подтверждения.',
    'Üçüncü taraf maliyetleri hiçbir plana dahil değildir: reklam bütçeleri (örneğin Meta Ads), dış kaynaklarda ücretli arama ve GPU ile işleme. Bunlar ayrıca gösterilir ve yalnızca onayınızdan sonra ücretlendirilir.',
    'لا تشمل أي خطة تكاليف الأطراف الثالثة: ميزانيات الإعلانات (مثل Meta Ads)، والبحث المدفوع في المصادر الخارجية، والمعالجة الرسومية عبر GPU. وتُعرض هذه التكاليف بشكل منفصل ولا تُحتسب إلا بعد تأكيدك.',
    'עלויות של צדדים שלישיים אינן כלולות באף תוכנית: תקציבי פרסום (למשל Meta Ads), חיפוש בתשלום במקורות חיצוניים ועיבוד גרפי ב-GPU. הן מוצגות בנפרד ומחויבות רק לאחר אישורך.',
  ],
  terms_sub_credits: [
    'HOMATCH no longer sells credits. Credits bought earlier are kept, do not expire and can be used for the services that accept them until they are spent.',
    'HOMATCH აღარ ყიდის კრედიტებს. ადრე შეძენილი კრედიტები ინახება, მათ ვადა არ გასდის და შეგიძლიათ გამოიყენოთ იმ მომსახურებისთვის, რომლებიც კრედიტებს იღებს, სანამ არ ამოიწურება.',
    'HOMATCH больше не продаёт кредиты. Ранее купленные кредиты сохраняются, не сгорают и могут использоваться для услуг, которые их принимают, пока не будут израсходованы.',
    'HOMATCH artık kredi satmamaktadır. Daha önce satın alınan krediler korunur, süreleri dolmaz ve tükenene kadar onları kabul eden hizmetlerde kullanılabilir.',
    'لم تعد HOMATCH تبيع الأرصدة. تبقى الأرصدة المشتراة سابقًا محفوظة ولا تنتهي صلاحيتها، ويمكن استخدامها للخدمات التي تقبلها حتى نفادها.',
    'HOMATCH אינה מוכרת עוד קרדיטים. קרדיטים שנרכשו בעבר נשמרים, אינם פגים וניתן להשתמש בהם בשירותים שמקבלים אותם עד שינוצלו.',
  ],
  terms_sub_cancel: [
    'A plan runs one month at a time. You can cancel it at any time; the cancellation takes effect at the end of the billing period you have already paid for, and the plan stays available until then.',
    'პაკეტი მოქმედებს ერთი თვით. მისი გაუქმება ნებისმიერ დროს შეგიძლიათ; გაუქმება ძალაში შედის უკვე გადახდილი საანგარიშო პერიოდის ბოლოს და მანამდე პაკეტი ხელმისაწვდომი რჩება.',
    'План действует по одному месяцу. Вы можете отменить его в любой момент; отмена вступает в силу в конце уже оплаченного расчётного периода, и до этого момента план остаётся доступным.',
    'Bir plan birer aylık dönemlerle geçerlidir. Planı istediğiniz zaman iptal edebilirsiniz; iptal, ödemesi yapılmış fatura döneminin sonunda yürürlüğe girer ve plan o zamana kadar kullanılabilir kalır.',
    'تسري الخطة لمدة شهر في كل مرة. يمكنك إلغاؤها في أي وقت، ويسري الإلغاء في نهاية فترة الفوترة المدفوعة، وتبقى الخطة متاحة حتى ذلك الحين.',
    'תוכנית תקפה לחודש אחד בכל פעם. אפשר לבטל אותה בכל עת; הביטול נכנס לתוקף בסוף תקופת החיוב שכבר שולמה, והתוכנית נשארת זמינה עד אז.',
  ],
  terms_sub_provider: [
    'Payments are processed by Georgian bank payment providers. Which provider processes your payment, the payment methods accepted, when the amount is charged and whether a plan renews automatically depend on that provider and are shown before you pay.',
    'გადახდებს ამუშავებენ საქართველოს საბანკო გადახდის პროვაიდერები. რომელი პროვაიდერი დაამუშავებს თქვენს გადახდას, გადახდის რომელი საშუალებებია მისაღები, როდის ჩამოგეჭრებათ თანხა და განახლდება თუ არა პაკეტი ავტომატურად, დამოკიდებულია ამ პროვაიდერზე და გეჩვენებათ გადახდამდე.',
    'Платежи обрабатывают грузинские банковские платёжные провайдеры. Какой провайдер обработает ваш платёж, какие способы оплаты принимаются, когда списываются средства и продлевается ли план автоматически, зависит от этого провайдера и показывается до оплаты.',
    'Ödemeler Gürcistan\'daki banka ödeme sağlayıcıları tarafından işlenir. Ödemenizi hangi sağlayıcının işleyeceği, hangi ödeme yöntemlerinin kabul edildiği, tutarın ne zaman tahsil edileceği ve planın otomatik olarak yenilenip yenilenmeyeceği bu sağlayıcıya bağlıdır ve ödemeden önce gösterilir.',
    'تتولى معالجة المدفوعات جهاتُ دفع مصرفية في جورجيا. ويعتمد تحديد الجهة التي تعالج دفعتك، ووسائل الدفع المقبولة، وموعد الخصم، وما إذا كانت الخطة تتجدد تلقائيًا، على هذه الجهة، ويُعرض ذلك قبل الدفع.',
    'התשלומים מעובדים על ידי ספקי תשלום בנקאיים בגאורגיה. איזה ספק יעבד את התשלום שלך, אילו אמצעי תשלום מתקבלים, מתי מתבצע החיוב והאם התוכנית מתחדשת אוטומטית תלויים בספק זה ומוצגים לפני התשלום.',
  ],
  terms_sub_refund: [
    'Refunds are made in accordance with applicable Georgian law and the rules of the payment provider that processed the payment. These Terms do not limit the rights guaranteed to you by law.',
    'თანხის დაბრუნება ხორციელდება საქართველოს მოქმედი კანონმდებლობისა და გადახდის დამმუშავებელი პროვაიდერის წესების მიხედვით. წინამდებარე პირობები არ ზღუდავს თქვენს კანონით გარანტირებულ უფლებებს.',
    'Возврат средств осуществляется в соответствии с действующим законодательством Грузии и правилами платёжного провайдера, обработавшего платёж. Настоящие условия не ограничивают права, гарантированные вам законом.',
    'İadeler, Gürcistan\'ın yürürlükteki mevzuatına ve ödemeyi işleyen ödeme sağlayıcısının kurallarına göre yapılır. Bu Şartlar, kanunla güvence altına alınmış haklarınızı sınırlamaz.',
    'يتم رد المبالغ وفقًا للتشريعات الجورجية السارية وقواعد جهة الدفع التي عالجت الدفعة. ولا تحدّ هذه الشروط من الحقوق التي يكفلها لك القانون.',
    'החזרים מתבצעים בהתאם לדין הגאורגי החל ולכללי ספק התשלום שעיבד את התשלום. תנאים אלה אינם מגבילים את הזכויות המוקנות לך על פי דין.',
  ],
};
