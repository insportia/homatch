// HOMATCH Admin copy, part 3 — Email, WhatsApp, calls, usage, advanced.
//
// Order is [en, ka, ru, tr, ar, he].
//
// ON THE CHECKLISTS
//
// Every line a reader sees here is the CONSEQUENCE, not the identifier.
// "Homatch cannot receive replies" is the sentence; the environment
// variable that causes it sits behind "Technical details", untranslated,
// because an identifier you have to type is not helped by translation.

export const ADMIN_STRINGS_3 = {
  /* ── Email ──────────────────────────────────────────────────────── */
  email_admin_title: [
    'Email', 'ელფოსტა', 'Email', 'E-posta', 'البريد الإلكتروني', 'אימייל',
  ],
  email_admin_subtitle: [
    'Whether Homatch can send email, and whether replies come back.',
    'შეუძლია თუ არა Homatch-ს ელფოსტის გაგზავნა და ბრუნდება თუ არა პასუხები.',
    'Может ли Homatch отправлять письма и возвращаются ли ответы.',
    'Homatch e-posta gönderebiliyor mu ve yanıtlar geri geliyor mu.',
    'هل يستطيع Homatch إرسال البريد، وهل تصل الردود.',
    'האם Homatch יכול לשלוח אימייל, והאם תשובות חוזרות.',
  ],
  email_sending: [
    'Sending', 'გაგზავნა', 'Отправка', 'Gönderme', 'الإرسال', 'שליחה',
  ],
  email_receiving: [
    'Receiving', 'მიღება', 'Получение', 'Alma', 'الاستقبال', 'קבלה',
  ],
  email_sending_ok: [
    'Homatch can send email.', 'Homatch-ს ელფოსტის გაგზავნა შეუძლია.', 'Homatch может отправлять письма.',
    'Homatch e-posta gönderebiliyor.', 'يستطيع Homatch إرسال البريد.', 'Homatch יכול לשלוח אימייל.',
  ],
  email_sending_no: [
    'Homatch cannot send email.', 'Homatch-ს ელფოსტის გაგზავნა არ შეუძლია.', 'Homatch не может отправлять письма.',
    'Homatch e-posta gönderemiyor.', 'لا يستطيع Homatch إرسال البريد.', 'Homatch אינו יכול לשלוח אימייל.',
  ],
  email_receiving_ok: [
    'Replies reach Homatch.', 'პასუხები Homatch-ს აღწევს.', 'Ответы доходят до Homatch.',
    'Yanıtlar Homatch’e ulaşıyor.', 'تصل الردود إلى Homatch.', 'תשובות מגיעות ל‑Homatch.',
  ],
  email_receiving_no: [
    'Replies do not reach Homatch.', 'პასუხები Homatch-ს ვერ აღწევს.', 'Ответы не доходят до Homatch.',
    'Yanıtlar Homatch’e ulaşmıyor.', 'لا تصل الردود إلى Homatch.', 'תשובות אינן מגיעות ל‑Homatch.',
  ],
  email_addresses_title: [
    'Receiving addresses', 'მიმღები მისამართები', 'Адреса для приёма',
    'Alıcı adresleri', 'عناوين الاستقبال', 'כתובות לקבלה',
  ],
  email_addresses_none: [
    'No receiving address has an owner yet, so a reply is recorded as belonging to nobody.',
    'მიმღებ მისამართს ჯერ მფლობელი არ ჰყავს, ამიტომ პასუხი არავისზე მიბმული არ ფიქსირდება.',
    'Ни у одного адреса ещё нет владельца, поэтому ответ записывается как ничей.',
    'Hiçbir alıcı adresin sahibi yok; bu yüzden yanıt kimseye ait olmadan kaydediliyor.',
    'لا يوجد مالك لأي عنوان استقبال بعد، لذا يُسجَّل الرد دون أن ينتمي إلى أحد.',
    'לאף כתובת קבלה אין עדיין בעלים, ולכן תשובה נרשמת כשייכת לאיש.',
  ],
  email_never_received: [
    'No email has ever arrived. Point the provider at the Homatch webhook and add the MX record for the receiving domain.',
    'ელფოსტა ჯერ არასდროს მოსულა. მიუთითეთ მომწოდებელს Homatch-ის webhook და დაამატეთ MX ჩანაწერი მიმღები დომენისთვის.',
    'Письма ещё ни разу не приходили. Укажите провайдеру webhook Homatch и добавьте MX-запись для принимающего домена.',
    'Hiç e-posta gelmedi. Sağlayıcıyı Homatch webhook’una yönlendirin ve alıcı alan adı için MX kaydını ekleyin.',
    'لم يصل أي بريد إطلاقاً. وجّه المزوّد إلى webhook الخاص بـ Homatch وأضف سجل MX لنطاق الاستقبال.',
    'מעולם לא הגיע אימייל. הפנו את הספק ל‑webhook של Homatch והוסיפו רשומת MX לדומיין הקבלה.',
  ],

  /* ── WhatsApp ───────────────────────────────────────────────────── */
  wa_admin_title: [
    'WhatsApp', 'WhatsApp', 'WhatsApp', 'WhatsApp', 'واتساب', 'וואטסאפ',
  ],
  wa_admin_subtitle: [
    'Whether Homatch can message people on WhatsApp, and what is missing if it cannot.',
    'შეუძლია თუ არა Homatch-ს WhatsApp-ით მიწერა და რა აკლია, თუ არ შეუძლია.',
    'Может ли Homatch писать людям в WhatsApp и чего не хватает, если нет.',
    'Homatch WhatsApp’tan mesaj gönderebiliyor mu ve gönderemiyorsa ne eksik.',
    'هل يستطيع Homatch مراسلة الناس عبر واتساب، وما الناقص إن لم يستطع.',
    'האם Homatch יכול לשלוח הודעות בוואטסאפ, ומה חסר אם לא.',
  ],
  wa_setup_title: [
    'Setup checklist', 'დაყენების სია', 'Чек-лист настройки',
    'Kurulum listesi', 'قائمة الإعداد', 'רשימת הגדרה',
  ],
  wa_setup_done: [
    'Everything WhatsApp needs is in place.',
    'ყველაფერი, რაც WhatsApp-ს სჭირდება, დაყენებულია.',
    'Всё, что нужно WhatsApp, на месте.',
    'WhatsApp için gereken her şey hazır.',
    'كل ما يحتاجه واتساب متوفر.',
    'כל מה שוואטסאפ צריך קיים.',
  ],
  wa_env_label: [
    'Environment', 'გარემო', 'Окружение', 'Ortam', 'البيئة', 'סביבה',
  ],
  wa_env_production: [
    'Production', 'საწარმოო', 'Продакшн', 'Üretim', 'الإنتاج', 'ייצור',
  ],
  wa_env_test: [
    'Test', 'სატესტო', 'Тест', 'Test', 'اختبار', 'בדיקה',
  ],
  wa_templates_title: [
    'Message templates', 'შეტყობინების შაბლონები', 'Шаблоны сообщений',
    'Mesaj şablonları', 'قوالب الرسائل', 'תבניות הודעה',
  ],
  wa_templates_none: [
    'No approved template yet. WhatsApp only allows a first message from an approved template.',
    'დამტკიცებული შაბლონი ჯერ არ არის. WhatsApp პირველ შეტყობინებას მხოლოდ დამტკიცებული შაბლონით უშვებს.',
    'Пока нет одобренного шаблона. WhatsApp разрешает первое сообщение только из одобренного шаблона.',
    'Henüz onaylı şablon yok. WhatsApp ilk mesaja yalnızca onaylı şablonla izin verir.',
    'لا يوجد قالب معتمد بعد. لا يسمح واتساب بالرسالة الأولى إلا من قالب معتمد.',
    'אין עדיין תבנית מאושרת. וואטסאפ מתיר הודעה ראשונה רק מתבנית מאושרת.',
  ],

  /* ── AI Call Center ─────────────────────────────────────────────── */
  cc_admin_title: [
    'AI Call Center', 'AI ქოლ-ცენტრი', 'ИИ колл-центр',
    'AI Çağrı Merkezi', 'مركز اتصال الذكاء الاصطناعي', 'מוקד טלפוני AI',
  ],
  cc_admin_subtitle: [
    'AI that makes and answers phone calls, and the rules every call follows.',
    'AI, რომელიც რეკავს და პასუხობს ზარებს, და წესები, რომლებსაც ყველა ზარი მიჰყვება.',
    'ИИ, который звонит и отвечает на звонки, и правила для каждого звонка.',
    'Telefon araması yapan ve yanıtlayan yapay zekâ ve her çağrının uyduğu kurallar.',
    'ذكاء اصطناعي يُجري المكالمات ويردّ عليها، والقواعد التي تتبعها كل مكالمة.',
    'בינה מלאכותית שמתקשרת ועונה, והכללים שכל שיחה מצייתת להם.',
  ],
  cc_numbers_title: [
    'Phone numbers', 'ტელეფონის ნომრები', 'Телефонные номера',
    'Telefon numaraları', 'أرقام الهاتف', 'מספרי טלפון',
  ],
  cc_numbers_manage: [
    'Manage numbers', 'ნომრების მართვა', 'Управление номерами',
    'Numaraları yönet', 'إدارة الأرقام', 'ניהול מספרים',
  ],
  cc_agents_title: [
    'Calling agents', 'სატელეფონო აგენტები', 'Телефонные агенты',
    'Arama temsilcileri', 'وكلاء الاتصال', 'סוכני שיחות',
  ],
  cc_agents_desc: [
    'Each agent has its own voice, its own first sentence and its own instructions.',
    'თითოეულ აგენტს აქვს საკუთარი ხმა, საკუთარი პირველი წინადადება და საკუთარი ინსტრუქციები.',
    'У каждого агента свой голос, своя первая фраза и свои инструкции.',
    'Her temsilcinin kendi sesi, kendi ilk cümlesi ve kendi yönergeleri vardır.',
    'لكل وكيل صوته الخاص وجملته الأولى وتعليماته.',
    'לכל סוכן יש קול משלו, משפט פתיחה משלו והנחיות משלו.',
  ],
  cc_connection_title: [
    'Calling provider', 'ზარების მომწოდებელი', 'Поставщик звонков',
    'Arama sağlayıcısı', 'مزوّد المكالمات', 'ספק השיחות',
  ],

  /* ── Usage & cost ───────────────────────────────────────────────── */
  usage_admin_title: [
    'Usage & cost', 'მოხმარება და ხარჯი', 'Использование и расходы',
    'Kullanım ve maliyet', 'الاستخدام والتكلفة', 'שימוש ועלות',
  ],
  usage_admin_subtitle: [
    'What the communication products used, and what it cost.',
    'რა მოიხმარეს საკომუნიკაციო პროდუქტებმა და რა დაჯდა.',
    'Что израсходовали коммуникационные продукты и сколько это стоило.',
    'İletişim ürünlerinin ne kullandığı ve maliyeti.',
    'ما استهلكته منتجات التواصل وكم كلّفت.',
    'מה צרכו מוצרי התקשורת וכמה זה עלה.',
  ],
  usage_actual: [
    'Actual', 'ფაქტობრივი', 'Фактически', 'Gerçekleşen', 'فعلي', 'בפועל',
  ],
  usage_estimated: [
    'Estimated', 'სავარაუდო', 'Оценка', 'Tahmini', 'تقديري', 'הערכה',
  ],
  usage_window_today: [
    'Today', 'დღეს', 'Сегодня', 'Bugün', 'اليوم', 'היום',
  ],
  usage_window_7: [
    '7 days', '7 დღე', '7 дней', '7 gün', '٧ أيام', '7 ימים',
  ],
  usage_window_30: [
    '30 days', '30 დღე', '30 дней', '30 gün', '٣٠ يوماً', '30 ימים',
  ],

  /* ── Advanced ───────────────────────────────────────────────────── */
  adv_admin_title: [
    'Advanced voice settings', 'დამატებითი ხმის პარამეტრები', 'Расширенные настройки голоса',
    'Gelişmiş ses ayarları', 'إعدادات الصوت المتقدمة', 'הגדרות קול מתקדמות',
  ],
  adv_admin_subtitle: [
    'Speech recognition, pronunciation, failover and provider routing. You do not need this page to change a voice.',
    'მეტყველების ამოცნობა, გამოთქმა, სარეზერვო გადართვა და მომწოდებლების მარშრუტიზაცია. ხმის შესაცვლელად ეს გვერდი არ გჭირდებათ.',
    'Распознавание речи, произношение, резервирование и маршрутизация поставщиков. Для смены голоса эта страница не нужна.',
    'Konuşma tanıma, telaffuz, yedeğe geçiş ve sağlayıcı yönlendirme. Sesi değiştirmek için bu sayfaya ihtiyacınız yok.',
    'التعرّف على الكلام والنطق والتحويل الاحتياطي وتوجيه المزوّدين. لا تحتاج هذه الصفحة لتغيير الصوت.',
    'זיהוי דיבור, הגייה, גיבוי וניתוב ספקים. אינכם זקוקים לדף הזה כדי להחליף קול.',
  ],
  adv_back_to_voice: [
    'Back to Voice', 'დაბრუნება ხმაზე', 'Назад к голосу',
    'Sese dön', 'العودة إلى الصوت', 'חזרה לקול',
  ],
};
