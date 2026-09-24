// HOMATCH Admin copy, part 1 — the navigation, the search and the home.
//
// Order is [en, ka, ru, tr, ar, he], matching every other applier here.
//
// THE RULE THIS COPY IS WRITTEN UNDER
//
// The reader did not build Homatch. They do not know what Cartesia is,
// where a setting is stored, or which provider answers a phone call. So
// the navigation names what they WANT, never what the code calls it:
// "Voice", not "TTS"; "AI Call Center", not "Vapi"; "Email", not
// "RESEND". Provider names still appear — but as the answer to "which
// provider", never as the question.
//
// Headings do not end with a full stop. Sentences under them do.

export const ADMIN_STRINGS_1 = {
  /* ── Sidebar groups ─────────────────────────────────────────────── */
  admin_group_overview: [
    'Overview', 'მიმოხილვა', 'Обзор', 'Genel bakış', 'نظرة عامة', 'סקירה',
  ],
  admin_group_users: [
    'Users', 'მომხმარებლები', 'Пользователи', 'Kullanıcılar', 'المستخدمون', 'משתמשים',
  ],
  admin_group_property: [
    'Properties & matching', 'ქონება და შერჩევა', 'Объекты и подбор',
    'Mülkler ve eşleştirme', 'العقارات والمطابقة', 'נכסים והתאמה',
  ],
  admin_group_comms: [
    'AI & communication', 'AI და კომუნიკაცია', 'ИИ и связь',
    'Yapay zekâ ve iletişim', 'الذكاء الاصطناعي والتواصل', 'בינה מלאכותית ותקשורת',
  ],
  admin_group_money: [
    'Finance & pricing', 'ფინანსები და ფასები', 'Финансы и цены',
    'Finans ve fiyatlandırma', 'المالية والتسعير', 'כספים ותמחור',
  ],
  admin_group_website: [
    'Website & content', 'საიტი და კონტენტი', 'Сайт и контент',
    'Site ve içerik', 'الموقع والمحتوى', 'אתר ותוכן',
  ],
  admin_group_system: [
    'System', 'სისტემა', 'Система', 'Sistem', 'النظام', 'מערכת',
  ],

  /* ── New destinations ───────────────────────────────────────────── */
  admin_nav_home: [
    'Control centre', 'მართვის პანელი', 'Панель управления',
    'Kontrol merkezi', 'مركز التحكم', 'מרכז בקרה',
  ],
  admin_nav_metrics: [
    'Platform metrics', 'პლატფორმის მაჩვენებლები', 'Показатели платформы',
    'Platform ölçümleri', 'مؤشرات المنصة', 'מדדי הפלטפורמה',
  ],
  admin_nav_comms_overview: [
    'Overview', 'მიმოხილვა', 'Обзор', 'Genel bakış', 'نظرة عامة', 'סקירה',
  ],
  admin_nav_voice: [
    'Voice', 'ხმა', 'Голос', 'Ses', 'الصوت', 'קול',
  ],
  admin_nav_call_center: [
    'AI Call Center', 'AI ქოლ-ცენტრი', 'ИИ колл-центр',
    'AI Çağrı Merkezi', 'مركز اتصال الذكاء الاصطناعي', 'מוקד טלפוני AI',
  ],
  admin_nav_email: [
    'Email', 'ელფოსტა', 'Email', 'E-posta', 'البريد الإلكتروني', 'אימייל',
  ],
  admin_nav_whatsapp: [
    'WhatsApp', 'WhatsApp', 'WhatsApp', 'WhatsApp', 'واتساب', 'וואטסאפ',
  ],
  admin_nav_comms_usage: [
    'Usage & cost', 'მოხმარება და ხარჯი', 'Использование и расходы',
    'Kullanım ve maliyet', 'الاستخدام والتكلفة', 'שימוש ועלות',
  ],
  admin_nav_comms_advanced: [
    'Advanced', 'დამატებითი', 'Расширенные', 'Gelişmiş', 'إعدادات متقدمة', 'מתקדם',
  ],
  admin_nav_risk: [
    'Risk & compliance', 'რისკი და შესაბამისობა', 'Риски и соответствие',
    'Risk ve uyum', 'المخاطر والامتثال', 'סיכון וציות',
  ],

  /* ── Sidebar chrome ─────────────────────────────────────────────── */
  admin_search_placeholder: [
    'Search Admin', 'ძებნა ადმინში', 'Поиск в админке',
    'Yönetimde ara', 'ابحث في الإدارة', 'חיפוש בניהול',
  ],
  admin_search_open: [
    'Search Admin', 'ძებნა ადმინში', 'Поиск в админке',
    'Yönetimde ara', 'ابحث في الإدارة', 'חיפוש בניהול',
  ],
  admin_search_empty: [
    'Nothing matches that.', 'ვერაფერი მოიძებნა.', 'Ничего не найдено.',
    'Eşleşen bir şey yok.', 'لا توجد نتائج مطابقة.', 'לא נמצאה התאמה.',
  ],
  admin_search_hint: [
    'Try a word like voice, email, WhatsApp or pricing.',
    'სცადეთ სიტყვა: ხმა, ელფოსტა, WhatsApp ან ფასები.',
    'Попробуйте слово: голос, email, WhatsApp или цены.',
    'Ses, e-posta, WhatsApp ya da fiyat gibi bir kelime deneyin.',
    'جرّب كلمة مثل الصوت أو البريد أو واتساب أو التسعير.',
    'נסו מילה כמו קול, אימייל, וואטסאפ או תמחור.',
  ],

  /* ── The control centre ─────────────────────────────────────────── */
  admin_home_title: [
    'Homatch Admin', 'Homatch-ის ადმინი', 'Админка Homatch',
    'Homatch Yönetimi', 'إدارة Homatch', 'ניהול Homatch',
  ],
  admin_home_subtitle: [
    'Manage your platform from one place.',
    'მართეთ თქვენი პლატფორმა ერთი ადგილიდან.',
    'Управляйте платформой из одного места.',
    'Platformunuzu tek bir yerden yönetin.',
    'أدِر منصتك من مكان واحد.',
    'נהלו את הפלטפורמה ממקום אחד.',
  ],
  admin_home_status_title: [
    'Status', 'მდგომარეობა', 'Состояние', 'Durum', 'الحالة', 'מצב',
  ],
  admin_home_attention_title: [
    'Needs your attention', 'საჭიროებს თქვენს ყურადღებას', 'Требует вашего внимания',
    'Dikkatinizi gerektirir', 'يحتاج إلى انتباهك', 'דורש את תשומת לבכם',
  ],
  admin_home_all_clear: [
    'Nothing needs your attention.',
    'ყურადღებას არაფერი საჭიროებს.',
    'Ничего не требует вашего внимания.',
    'Dikkatinizi gerektiren bir şey yok.',
    'لا شيء يحتاج إلى انتباهك.',
    'שום דבר לא דורש את תשומת לבכם.',
  ],
  admin_home_fix: [
    'Fix', 'გასწორება', 'Исправить', 'Düzelt', 'إصلاح', 'תיקון',
  ],
  admin_home_open: [
    'Open', 'გახსნა', 'Открыть', 'Aç', 'فتح', 'פתיחה',
  ],
  admin_home_checking: [
    'Checking', 'მოწმდება', 'Проверяется', 'Kontrol ediliyor', 'جارٍ الفحص', 'בבדיקה',
  ],
  admin_home_sys_system: [
    'System', 'სისტემა', 'Система', 'Sistem', 'النظام', 'מערכת',
  ],
  admin_home_sys_voice: [
    'AI & voice', 'AI და ხმა', 'ИИ и голос',
    'Yapay zekâ ve ses', 'الذكاء الاصطناعي والصوت', 'בינה מלאכותית וקול',
  ],
  admin_home_sys_email: [
    'Email', 'ელფოსტა', 'Email', 'E-posta', 'البريد الإلكتروني', 'אימייל',
  ],
  admin_home_sys_whatsapp: [
    'WhatsApp', 'WhatsApp', 'WhatsApp', 'WhatsApp', 'واتساب', 'וואטסאפ',
  ],
  admin_home_sys_calls: [
    'Phone calls', 'სატელეფონო ზარები', 'Телефонные звонки',
    'Telefon çağrıları', 'المكالمات الهاتفية', 'שיחות טלפון',
  ],
  admin_home_sys_spend: [
    'Spending', 'ხარჯვა', 'Расходы', 'Harcama', 'الإنفاق', 'הוצאות',
  ],
  admin_home_providers_count: [
    '{{ok}} of {{total}} working',
    '{{total}}-დან {{ok}} მუშაობს',
    'работают {{ok}} из {{total}}',
    '{{total}} hizmetten {{ok}} tanesi çalışıyor',
    '{{ok}} من {{total}} تعمل',
    '{{ok}} מתוך {{total}} פועלים',
  ],

  /* ── Status words, shared everywhere ────────────────────────────── */
  admin_status_working: [
    'Working', 'მუშაობს', 'Работает', 'Çalışıyor', 'تعمل', 'פועל',
  ],
  admin_status_action: [
    'Action needed', 'საჭიროა მოქმედება', 'Нужно действие',
    'İşlem gerekli', 'يلزم إجراء', 'נדרשת פעולה',
  ],
  admin_status_not_configured: [
    'Not set up', 'არ არის დაყენებული', 'Не настроено',
    'Kurulmadı', 'غير مُعد', 'לא הוגדר',
  ],
  admin_status_off: [
    'Turned off', 'გამორთულია', 'Отключено', 'Kapalı', 'مُعطّل', 'כבוי',
  ],
  admin_status_problem: [
    'Problem', 'პრობლემა', 'Проблема', 'Sorun', 'مشكلة', 'תקלה',
  ],
  admin_status_unknown: [
    'Unknown', 'უცნობია', 'Неизвестно', 'Bilinmiyor', 'غير معروف', 'לא ידוע',
  ],
  admin_status_unknown_why: [
    'Homatch could not read this. It is not a claim that anything is wrong.',
    'ამის წაკითხვა ვერ მოხერხდა. ეს არ ნიშნავს, რომ რამე გაფუჭდა.',
    'Это не удалось прочитать. Это не означает, что что-то сломано.',
    'Bu okunamadı. Bir şeyin bozuk olduğu anlamına gelmez.',
    'تعذّرت قراءة هذا. وهذا لا يعني أن هناك خطأ ما.',
    'לא ניתן היה לקרוא את זה. אין בכך כדי לומר שמשהו תקול.',
  ],

  /* ── Shared page chrome ─────────────────────────────────────────── */
  admin_advanced_show: [
    'Advanced settings', 'დამატებითი პარამეტრები', 'Расширенные настройки',
    'Gelişmiş ayarlar', 'إعدادات متقدمة', 'הגדרות מתקדמות',
  ],
  admin_advanced_hint: [
    'Technical controls. You do not need these to change the voice.',
    'ტექნიკური პარამეტრები. ხმის შესაცვლელად ისინი არ გჭირდებათ.',
    'Технические настройки. Для смены голоса они не нужны.',
    'Teknik ayarlar. Sesi değiştirmek için bunlara ihtiyacınız yok.',
    'إعدادات تقنية. لست بحاجة إليها لتغيير الصوت.',
    'הגדרות טכניות. אינכם זקוקים להן כדי להחליף קול.',
  ],
  admin_technical_details: [
    'Technical details', 'ტექნიკური დეტალები', 'Технические детали',
    'Teknik ayrıntılar', 'التفاصيل التقنية', 'פרטים טכניים',
  ],
  admin_managed_in_env: [
    'Managed in the production environment',
    'იმართება საწარმოო გარემოში',
    'Управляется в production-окружении',
    'Üretim ortamında yönetilir',
    'تُدار في بيئة الإنتاج',
    'מנוהל בסביבת הייצור',
  ],
  admin_secret_present: [
    'Configured', 'დაყენებულია', 'Настроено', 'Yapılandırıldı', 'مُعد', 'מוגדר',
  ],
  admin_secret_missing: [
    'Missing', 'აკლია', 'Отсутствует', 'Eksik', 'مفقود', 'חסר',
  ],
  admin_no_data: [
    'No data recorded', 'მონაცემები არ დაფიქსირებულა', 'Данных нет',
    'Kayıtlı veri yok', 'لا توجد بيانات مسجّلة', 'לא נרשמו נתונים',
  ],
};
