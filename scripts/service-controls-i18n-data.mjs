// Service Control Center — the six-service pause / resume page in Admin, the shared
// "currently unavailable" page, and the readiness / audit codes. 2026-10-16.
// Order: [en, ka, ru, tr, ar, he]. Placeholders {{var}} survive every locale.
const E = (en, ka, ru, tr, ar, he) => [en, ka, ru, tr, ar, he];

export const SERVICE_CONTROLS_STRINGS = {
  /* ── Service names ── */
  svc_name_publishing: E('Publish to Portals', 'პორტალებზე გამოქვეყნება', 'Публикация на порталах', 'Portallarda yayınla', 'النشر على البوابات', 'פרסום בפורטלים'),
  svc_name_ai_call_center: E('AI Call Center', 'AI ზარების ცენტრი', 'AI-колл-центр', 'AI Çağrı Merkezi', 'مركز الاتصال بالذكاء الاصطناعي', 'מרכז שיחות AI'),
  svc_name_ai_talk: E('AI TALK', 'AI TALK', 'AI TALK', 'AI TALK', 'AI TALK', 'AI TALK'),
  svc_name_whatsapp: E('WhatsApp', 'WhatsApp', 'WhatsApp', 'WhatsApp', 'واتساب', 'WhatsApp'),
  svc_name_live_chat: E('Live Chat', 'ლაივ ჩატი', 'Живой чат', 'Canlı Sohbet', 'الدردشة المباشرة', 'צ׳אט חי'),
  svc_name_design_studio: E('Design Studio', 'დიზაინ სტუდიო', 'Дизайн-студия', 'Tasarım Stüdyosu', 'استوديو التصميم', 'סטודיו עיצוב'),

  /* ── Customer: a paused service's address ── */
  svc_unavailable_title: E('This service is currently unavailable', 'ეს სერვისი ამჟამად მიუწვდომელია', 'Этот сервис сейчас недоступен', 'Bu hizmet şu anda kullanılamıyor', 'هذه الخدمة غير متاحة حاليًا', 'השירות אינו זמין כרגע'),
  svc_unavailable_body: E('It has been paused for now. Nothing of yours is lost — your records are kept and will be here when it returns.', 'ის დროებით შეჩერებულია. თქვენი არაფერი იკარგება — ჩანაწერები შენახულია და დაბრუნებისას აქ დაგხვდებათ.', 'Он временно приостановлен. Ничего не потеряно — ваши данные сохранены и будут здесь, когда он вернётся.', 'Şimdilik duraklatıldı. Hiçbir şeyiniz kaybolmadı — kayıtlarınız saklanıyor ve hizmet döndüğünde burada olacak.', 'تم إيقافها مؤقتًا. لم يضع شيء — سجلاتك محفوظة وستجدها هنا عند عودتها.', 'השירות הושהה לעת עתה. שום דבר לא אבד — הרשומות שלכם נשמרות ויחכו כאן כשהשירות יחזור.'),
  svc_unavailable_dashboard: E('Go to your dashboard', 'დაფაზე გადასვლა', 'Перейти в кабинет', 'Panele git', 'الانتقال إلى لوحة التحكم', 'מעבר ללוח הבקרה'),
  svc_unavailable_home: E('Go to the home page', 'მთავარ გვერდზე გადასვლა', 'На главную', 'Ana sayfaya git', 'الانتقال إلى الصفحة الرئيسية', 'מעבר לדף הבית'),

  /* ── Admin navigation and page ── */
  admin_nav_service_control: E('Service Control Center', 'სერვისების მართვის ცენტრი', 'Центр управления сервисами', 'Hizmet Kontrol Merkezi', 'مركز التحكم بالخدمات', 'מרכז בקרת שירותים'),
  svc_eyebrow: E('System', 'სისტემა', 'Система', 'Sistem', 'النظام', 'מערכת'),
  svc_title: E('Service Control Center', 'სერვისების მართვის ცენტრი', 'Центр управления сервисами', 'Hizmet Kontrol Merkezi', 'مركز التحكم بالخدمات', 'מרכז בקרת שירותים'),
  svc_subtitle: E('Pause or resume each HOMATCH service without deleting anything. A change reaches every server within about {{seconds}} seconds.', 'შეაჩერეთ ან განაახლეთ HOMATCH-ის თითოეული სერვისი ისე, რომ არაფერი წაიშალოს. ცვლილება ყველა სერვერს დაახლოებით {{seconds}} წამში აღწევს.', 'Приостанавливайте и возобновляйте каждый сервис HOMATCH, ничего не удаляя. Изменение доходит до всех серверов примерно за {{seconds}} секунд.', 'Her HOMATCH hizmetini hiçbir şey silmeden duraklatın veya sürdürün. Değişiklik yaklaşık {{seconds}} saniyede tüm sunuculara ulaşır.', 'أوقف أي خدمة من خدمات HOMATCH مؤقتًا أو استأنفها دون حذف أي شيء. يصل التغيير إلى كل الخوادم خلال {{seconds}} ثانية تقريبًا.', 'השהו או חדשו כל שירות של HOMATCH בלי למחוק דבר. שינוי מגיע לכל השרתים בתוך כ-{{seconds}} שניות.'),
  svc_refresh: E('Refresh', 'განახლება', 'Обновить', 'Yenile', 'تحديث', 'רענון'),
  svc_load_failed: E('The service states could not be loaded.', 'სერვისების მდგომარეობა ვერ ჩაიტვირთა.', 'Не удалось загрузить состояние сервисов.', 'Hizmet durumları yüklenemedi.', 'تعذّر تحميل حالات الخدمات.', 'לא ניתן היה לטעון את מצב השירותים.'),
  svc_kpi_paused: E('Paused', 'შეჩერებული', 'Приостановлено', 'Duraklatıldı', 'متوقفة', 'מושהים'),
  svc_kpi_live: E('Running', 'მუშაობს', 'Работают', 'Çalışıyor', 'تعمل', 'פועלים'),
  svc_kpi_not_ready: E('Not ready to resume', 'განახლებისთვის მზად არ არის', 'Не готовы к запуску', 'Sürdürmeye hazır değil', 'غير جاهزة للاستئناف', 'לא מוכנים לחידוש'),
  svc_pause_all_title: E('Pause all six', 'ექვსივეს შეჩერება', 'Приостановить все шесть', 'Altısını da duraklat', 'إيقاف الست جميعًا', 'השהיית כל השישה'),
  svc_pause_all_body: E('Hides all six services from customers and stops new work for them, in one step. No other HOMATCH product is affected.', 'ერთი ნაბიჯით მალავს ექვსივე სერვისს მომხმარებლებისგან და აჩერებს მათ ახალ სამუშაოს. HOMATCH-ის სხვა პროდუქტებს არ ეხება.', 'Одним шагом скрывает все шесть сервисов от клиентов и останавливает новую работу для них. Другие продукты HOMATCH не затрагиваются.', 'Altı hizmeti tek adımda müşterilerden gizler ve yeni işlerini durdurur. Diğer HOMATCH ürünleri etkilenmez.', 'يخفي الخدمات الست عن العملاء ويوقف أي عمل جديد لها بخطوة واحدة. لا يتأثر أي منتج آخر من HOMATCH.', 'מסתיר את כל ששת השירותים מהלקוחות ועוצר עבורם עבודה חדשה בצעד אחד. מוצרי HOMATCH אחרים אינם מושפעים.'),
  svc_pause_all_action: E('Pause all six', 'ექვსივეს შეჩერება', 'Приостановить все', 'Hepsini duraklat', 'إيقاف الكل', 'השהיית הכול'),
  svc_checked_at: E('Checked {{at}}', 'შემოწმდა {{at}}', 'Проверено {{at}}', 'Kontrol edildi: {{at}}', 'تم الفحص {{at}}', 'נבדק {{at}}'),

  /* ── Descriptions ── */
  svc_desc_publishing: E('Publishing listings to external property portals.', 'განცხადებების გამოქვეყნება გარე უძრავი ქონების პორტალებზე.', 'Публикация объявлений на внешних порталах недвижимости.', 'İlanların harici emlak portallarında yayınlanması.', 'نشر الإعلانات على بوابات العقارات الخارجية.', 'פרסום מודעות בפורטלי נדל"ן חיצוניים.'),
  svc_desc_ai_call_center: E('AI phone calls, test calls and call campaigns.', 'AI სატელეფონო ზარები, სატესტო ზარები და ზარების კამპანიები.', 'ИИ-звонки, тестовые звонки и кампании обзвона.', 'Yapay zekâ telefon aramaları, test aramaları ve arama kampanyaları.', 'مكالمات هاتفية بالذكاء الاصطناعي ومكالمات تجريبية وحملات اتصال.', 'שיחות טלפון AI, שיחות ניסיון וקמפיינים של שיחות.'),
  svc_desc_ai_talk: E('Real-time AI voice conversations on the home page.', 'რეალურ დროში AI ხმოვანი საუბრები მთავარ გვერდზე.', 'Голосовые разговоры с ИИ в реальном времени на главной странице.', 'Ana sayfada gerçek zamanlı yapay zekâ sesli görüşmeleri.', 'محادثات صوتية فورية بالذكاء الاصطناعي على الصفحة الرئيسية.', 'שיחות קוליות בזמן אמת עם AI בדף הבית.'),
  svc_desc_whatsapp: E('HOMATCH WhatsApp messages, inbox and campaigns. Incoming messages are still recorded.', 'HOMATCH-ის WhatsApp შეტყობინებები, შემოსულები და კამპანიები. შემომავალი შეტყობინებები კვლავ ინახება.', 'Сообщения, входящие и кампании WhatsApp от HOMATCH. Входящие сообщения по-прежнему сохраняются.', 'HOMATCH WhatsApp mesajları, gelen kutusu ve kampanyaları. Gelen mesajlar kaydedilmeye devam eder.', 'رسائل واتساب من HOMATCH وصندوق الوارد والحملات. لا تزال الرسائل الواردة تُسجَّل.', 'הודעות, תיבת דואר וקמפיינים של WhatsApp מ-HOMATCH. הודעות נכנסות ממשיכות להירשם.'),
  svc_desc_live_chat: E('The live community chat room.', 'ლაივ საზოგადოებრივი ჩატის ოთახი.', 'Комната живого общего чата.', 'Canlı topluluk sohbet odası.', 'غرفة الدردشة المجتمعية المباشرة.', "חדר הצ'אט הקהילתי החי."),
  svc_desc_design_studio: E('AI interior design, renders, GPU jobs and walkthroughs.', 'AI ინტერიერის დიზაინი, რენდერები, GPU სამუშაოები და ვირტუალური ტურები.', 'ИИ-дизайн интерьера, рендеры, задания на GPU и виртуальные туры.', 'Yapay zekâ iç mimari, render, GPU işleri ve sanal turlar.', 'تصميم داخلي بالذكاء الاصطناعي وصور مُصيَّرة ومهام GPU وجولات افتراضية.', 'עיצוב פנים ב-AI, הדמיות, משימות GPU וסיורים וירטואליים.'),

  /* ── Effective state ── */
  svc_effective_paused: E('Paused', 'შეჩერებულია', 'Приостановлен', 'Duraklatıldı', 'متوقفة', 'מושהה'),
  svc_effective_backend_only: E('Running, hidden', 'მუშაობს, დამალულია', 'Работает, скрыт', 'Çalışıyor, gizli', 'تعمل، مخفية', 'פועל, מוסתר'),
  svc_effective_live: E('Live', 'აქტიურია', 'Активен', 'Yayında', 'مفعّلة', 'פעיל'),
  svc_effective_degraded: E('On, but not ready', 'ჩართულია, მაგრამ მზად არ არის', 'Включён, но не готов', 'Açık ama hazır değil', 'مشغّلة لكنها غير جاهزة', 'מופעל, אך לא מוכן'),

  /* ── Card ── */
  svc_backend_label: E('Backend execution', 'სერვერზე შესრულება', 'Выполнение на сервере', 'Sunucuda yürütme', 'التنفيذ في الخادم', 'ביצוע בשרת'),
  svc_backend_on_hint: E('The server may start new work.', 'სერვერს შეუძლია ახალი სამუშაოს დაწყება.', 'Сервер может начинать новую работу.', 'Sunucu yeni iş başlatabilir.', 'يمكن للخادم بدء عمل جديد.', 'השרת רשאי להתחיל עבודה חדשה.'),
  svc_backend_off_hint: E('New work is refused by the server.', 'სერვერი ახალ სამუშაოს უარყოფს.', 'Сервер отклоняет новую работу.', 'Sunucu yeni işi reddediyor.', 'يرفض الخادم أي عمل جديد.', 'השרת דוחה עבודה חדשה.'),
  svc_frontend_label: E('Frontend visibility', 'მომხმარებლისთვის ხილვადობა', 'Видимость для клиентов', 'Müşteri görünürlüğü', 'الظهور للعملاء', 'נראות ללקוחות'),
  svc_frontend_on_hint: E('Shown in its customer-facing places.', 'ჩანს მომხმარებლისთვის განკუთვნილ ადგილებში.', 'Показывается в клиентских разделах.', 'Müşteriye açık yerlerinde gösteriliyor.', 'تظهر في أماكنها المخصّصة للعملاء.', 'מוצג במקומות המיועדים ללקוחות.'),
  svc_frontend_off_hint: E('Hidden from customers.', 'დამალულია მომხმარებლებისგან.', 'Скрыт от клиентов.', 'Müşterilerden gizli.', 'مخفية عن العملاء.', 'מוסתר מהלקוחות.'),
  svc_frontend_needs_backend: E('Turn on backend execution first.', 'ჯერ ჩართეთ სერვერზე შესრულება.', 'Сначала включите выполнение на сервере.', 'Önce sunucuda yürütmeyi açın.', 'شغّل التنفيذ في الخادم أولًا.', 'הפעילו קודם את הביצוע בשרת.'),
  svc_ready: E('Ready', 'მზადაა', 'Готов', 'Hazır', 'جاهزة', 'מוכן'),
  svc_not_ready: E('Not ready', 'მზად არ არის', 'Не готов', 'Hazır değil', 'غير جاهزة', 'לא מוכן'),
  svc_last_change: E('Last change {{at}} by {{by}}', 'ბოლო ცვლილება {{at}}, {{by}}', 'Последнее изменение {{at}}, {{by}}', 'Son değişiklik {{at}}, {{by}}', 'آخر تغيير {{at}} بواسطة {{by}}', 'שינוי אחרון {{at}} על ידי {{by}}'),
  svc_system: E('system', 'სისტემა', 'система', 'sistem', 'النظام', 'מערכת'),
  svc_pause_this: E('Pause', 'შეჩერება', 'Приостановить', 'Duraklat', 'إيقاف مؤقت', 'השהיה'),
  svc_history: E('History', 'ისტორია', 'История', 'Geçmiş', 'السجل', 'היסטוריה'),
  svc_history_empty: E('No changes recorded yet.', 'ცვლილებები ჯერ არ დაფიქსირებულა.', 'Изменений пока нет.', 'Henüz kayıtlı değişiklik yok.', 'لا توجد تغييرات مسجلة بعد.', 'עדיין לא נרשמו שינויים.'),
  svc_history_state: E('backend {{backend}}, frontend {{frontend}}', 'სერვერი {{backend}}, ხილვადობა {{frontend}}', 'сервер {{backend}}, видимость {{frontend}}', 'sunucu {{backend}}, görünürlük {{frontend}}', 'الخادم {{backend}}، الظهور {{frontend}}', 'שרת {{backend}}, נראות {{frontend}}'),
  svc_on: E('on', 'ჩართ.', 'вкл.', 'açık', 'مشغّل', 'פועל'),
  svc_off: E('off', 'გამორთ.', 'выкл.', 'kapalı', 'متوقف', 'כבוי'),

  /* ── Running work ── */
  svc_running_operations_active: E('Browser operations', 'ბრაუზერის ოპერაციები', 'Операции браузера', 'Tarayıcı işlemleri', 'عمليات المتصفح', 'פעולות דפדפן'),
  svc_running_publications_in_progress: E('Publications in progress', 'მიმდინარე გამოქვეყნებები', 'Публикации в процессе', 'Süren yayınlar', 'منشورات قيد التنفيذ', 'פרסומים בתהליך'),
  svc_running_sessions_active: E('Active sessions', 'აქტიური სესიები', 'Активные сеансы', 'Etkin oturumlar', 'جلسات نشطة', 'שיחות פעילות'),
  svc_running_campaigns_running: E('Running campaigns', 'მიმდინარე კამპანიები', 'Активные кампании', 'Süren kampanyalar', 'حملات جارية', 'קמפיינים פעילים'),
  svc_running_sends_pending: E('Pending sends', 'მოლოდინში მყოფი გაგზავნები', 'Ожидающие отправки', 'Bekleyen gönderimler', 'إرسالات معلّقة', 'שליחות ממתינות'),
  svc_running_messages_last_hour: E('Messages, last hour', 'შეტყობინებები, ბოლო საათი', 'Сообщения за час', 'Son bir saatteki mesajlar', 'رسائل آخر ساعة', 'הודעות בשעה האחרונה'),
  svc_running_renders_open: E('Open renders', 'მიმდინარე რენდერები', 'Незавершённые рендеры', 'Açık render işleri', 'صور مُصيَّرة مفتوحة', 'הדמיות פתוחות'),
  svc_running_walkthroughs_open: E('Open walkthroughs', 'მიმდინარე ტურები', 'Незавершённые туры', 'Açık sanal turlar', 'جولات مفتوحة', 'סיורים פתוחים'),
  svc_running_gpu_jobs_open: E('Open GPU jobs', 'მიმდინარე GPU სამუშაოები', 'Незавершённые задания GPU', 'Açık GPU işleri', 'مهام GPU مفتوحة', 'משימות GPU פתוחות'),

  /* ── Confirmation ── */
  svc_confirm_title: E('Change {{service}}?', 'შეიცვალოს {{service}}?', 'Изменить {{service}}?', '{{service}} değiştirilsin mi?', 'تغيير {{service}}؟', 'לשנות את {{service}}?'),
  svc_confirm_backend_on: E('The server will start accepting new work for it.', 'სერვერი დაიწყებს მისთვის ახალი სამუშაოს მიღებას.', 'Сервер начнёт принимать для него новую работу.', 'Sunucu bunun için yeni iş kabul etmeye başlayacak.', 'سيبدأ الخادم في قبول عمل جديد لها.', 'השרת יתחיל לקבל עבורו עבודה חדשה.'),
  svc_confirm_backend_off: E('The server will refuse new work for it; nothing is deleted.', 'სერვერი მისთვის ახალ სამუშაოს უარყოფს; არაფერი წაიშლება.', 'Сервер будет отклонять для него новую работу; ничего не удаляется.', 'Sunucu bunun için yeni işi reddedecek; hiçbir şey silinmez.', 'سيرفض الخادم أي عمل جديد لها؛ لا يُحذف شيء.', 'השרת ידחה עבורו עבודה חדשה; שום דבר לא נמחק.'),
  svc_confirm_frontend_on: E('Customers will see it again.', 'მომხმარებლები მას ისევ დაინახავენ.', 'Клиенты снова его увидят.', 'Müşteriler onu yeniden görecek.', 'سيراها العملاء مجددًا.', 'הלקוחות יראו אותו שוב.'),
  svc_confirm_frontend_off: E('It will be hidden from customers.', 'ის მომხმარებლებისგან დაიმალება.', 'Он будет скрыт от клиентов.', 'Müşterilerden gizlenecek.', 'ستُخفى عن العملاء.', 'הוא יוסתר מהלקוחות.'),
  svc_confirm_pause_all_title: E('Pause all six services?', 'შეჩერდეს ექვსივე სერვისი?', 'Приостановить все шесть сервисов?', 'Altı hizmetin tamamı duraklatılsın mı?', 'إيقاف الخدمات الست مؤقتًا؟', 'להשהות את כל ששת השירותים?'),
  svc_confirm_pause_all_body: E('All six are hidden and stop accepting new work. Records, conversations, projects and settings are kept.', 'ექვსივე დაიმალება და ახალი სამუშაოს მიღებას შეწყვეტს. ჩანაწერები, საუბრები, პროექტები და პარამეტრები შენარჩუნდება.', 'Все шесть будут скрыты и перестанут принимать новую работу. Записи, переписки, проекты и настройки сохраняются.', 'Altısı da gizlenir ve yeni iş kabul etmeyi bırakır. Kayıtlar, sohbetler, projeler ve ayarlar korunur.', 'تُخفى الست جميعًا وتتوقف عن قبول عمل جديد. تُحفظ السجلات والمحادثات والمشاريع والإعدادات.', 'כל השישה יוסתרו ויפסיקו לקבל עבודה חדשה. הרשומות, השיחות, הפרויקטים וההגדרות נשמרים.'),
  svc_reason_label: E('Reason (kept in the audit log)', 'მიზეზი (ინახება აუდიტის ჟურნალში)', 'Причина (сохраняется в журнале аудита)', 'Neden (denetim günlüğünde saklanır)', 'السبب (يُحفظ في سجل التدقيق)', 'סיבה (נשמרת ביומן הביקורת)'),
  svc_reason_placeholder: E('Why is this changing?', 'რატომ იცვლება?', 'Почему это меняется?', 'Neden değişiyor?', 'لماذا يتغير هذا؟', 'למה זה משתנה?'),
  svc_cancel: E('Cancel', 'გაუქმება', 'Отмена', 'İptal', 'إلغاء', 'ביטול'),
  svc_confirm_action: E('Confirm', 'დადასტურება', 'Подтвердить', 'Onayla', 'تأكيد', 'אישור'),
  svc_ok: E('OK', 'კარგი', 'OK', 'Tamam', 'حسنًا', 'אישור'),
  svc_not_ready_title: E('{{service}} is not ready to run', '{{service}} მუშაობისთვის მზად არ არის', '{{service}} не готов к работе', '{{service}} çalışmaya hazır değil', '{{service}} غير جاهزة للعمل', '{{service}} אינו מוכן לפעולה'),
  svc_not_ready_body: E('It stays paused. Complete these first:', 'ის შეჩერებული რჩება. ჯერ დაასრულეთ:', 'Он остаётся приостановленным. Сначала выполните:', 'Duraklatılmış olarak kalıyor. Önce şunları tamamlayın:', 'تبقى متوقفة. أكمل هذه أولًا:', 'הוא נשאר מושהה. השלימו קודם את אלה:'),
  svc_toast_saved: E('{{service}} updated.', '{{service}} განახლდა.', '{{service}}: изменения сохранены.', '{{service}} güncellendi.', 'تم تحديث {{service}}.', '{{service}} עודכן.'),
  svc_toast_paused_all: E('{{n}} service(s) paused.', 'შეჩერდა {{n}} სერვისი.', 'Приостановлено сервисов: {{n}}.', '{{n}} hizmet duraklatıldı.', 'تم إيقاف {{n}} خدمة مؤقتًا.', 'הושהו {{n}} שירותים.'),
  svc_toast_unchanged: E('Nothing needed to change.', 'ცვლილება საჭირო არ იყო.', 'Изменять ничего не потребовалось.', 'Değiştirilecek bir şey yoktu.', 'لم يلزم أي تغيير.', 'לא היה צורך בשינוי.'),
  svc_toast_conflict: E('Someone changed this service a moment ago. The latest state is shown — check it and try again.', 'ეს სერვისი ახლახან სხვამ შეცვალა. ნაჩვენებია ბოლო მდგომარეობა — გადაამოწმეთ და სცადეთ ხელახლა.', 'Этот сервис только что изменил другой администратор. Показано актуальное состояние — проверьте и повторите.', 'Bu hizmeti az önce başka biri değiştirdi. En güncel durum gösteriliyor — kontrol edip yeniden deneyin.', 'غيّر شخص آخر هذه الخدمة للتو. تُعرض الحالة الأحدث — تحقق منها وحاول مجددًا.', 'מישהו שינה את השירות הזה לפני רגע. מוצג המצב העדכני — בדקו ונסו שוב.'),
  svc_toast_failed: E('The change was not saved ({{code}}).', 'ცვლილება არ შეინახა ({{code}}).', 'Изменение не сохранено ({{code}}).', 'Değişiklik kaydedilmedi ({{code}}).', 'لم يُحفظ التغيير ({{code}}).', 'השינוי לא נשמר ({{code}}).'),

  /* ── Readiness and notes ── */
  svc_code_secret: E('Server secret {{name}} is not set', 'სერვერის საიდუმლო {{name}} არ არის მითითებული', 'Не задан серверный секрет {{name}}', '{{name}} sunucu gizli anahtarı ayarlı değil', 'السر الخادمي {{name}} غير مُعيَّن', 'סוד השרת {{name}} לא הוגדר'),
  svc_code_schema: E('Database table {{name}} is missing', 'მონაცემთა ბაზის ცხრილი {{name}} არ არსებობს', 'Отсутствует таблица базы данных {{name}}', '{{name}} veritabanı tablosu eksik', 'جدول قاعدة البيانات {{name}} مفقود', 'טבלת מסד הנתונים {{name}} חסרה'),
  svc_code_storage_r2_not_configured: E('File storage (R2) is not configured', 'ფაილების საცავი (R2) არ არის კონფიგურირებული', 'Файловое хранилище (R2) не настроено', 'Dosya depolama (R2) yapılandırılmadı', 'تخزين الملفات (R2) غير مُهيَّأ', 'אחסון הקבצים (R2) לא הוגדר'),
  svc_code_route_telephony_vapi_off: E('The Vapi telephony route is switched off (Admin → Providers)', 'Vapi-ის სატელეფონო მარშრუტი გამორთულია (ადმინი → პროვაიდერები)', 'Телефонный маршрут Vapi выключен (Админ → Провайдеры)', 'Vapi telefon rotası kapalı (Yönetici → Sağlayıcılar)', 'مسار الاتصال الهاتفي Vapi متوقف (المسؤول ← المزوّدون)', 'נתיב הטלפוניה של Vapi כבוי (ניהול ← ספקים)'),
  svc_code_route_messaging_meta_off: E('The Meta WhatsApp messaging route is switched off (Admin → Providers)', 'Meta WhatsApp-ის შეტყობინებების მარშრუტი გამორთულია (ადმინი → პროვაიდერები)', 'Маршрут сообщений Meta WhatsApp выключен (Админ → Провайдеры)', 'Meta WhatsApp mesajlaşma rotası kapalı (Yönetici → Sağlayıcılar)', 'مسار رسائل Meta WhatsApp متوقف (المسؤول ← المزوّدون)', 'נתיב ההודעות של Meta WhatsApp כבוי (ניהול ← ספקים)'),
  svc_code_publishing_central_migration_not_applied: E('Automatic publishing through HOMATCH accounts is not installed yet (migration pending)', 'HOMATCH-ის ანგარიშებით ავტომატური გამოქვეყნება ჯერ არ არის დაყენებული (მიგრაცია მოლოდინშია)', 'Автопубликация через аккаунты HOMATCH ещё не установлена (миграция не применена)', 'HOMATCH hesaplarıyla otomatik yayın henüz kurulmadı (taşıma bekliyor)', 'النشر التلقائي عبر حسابات HOMATCH غير مثبّت بعد (الترحيل معلّق)', 'פרסום אוטומטי דרך חשבונות HOMATCH עדיין לא הותקן (מיגרציה ממתינה)'),
  svc_code_publishing_worker_token_not_set: E('The publishing worker token is not configured; the browser worker cannot connect', 'გამოქვეყნების ვორკერის ტოკენი არ არის მითითებული; ბრაუზერის ვორკერი ვერ დაუკავშირდება', 'Токен воркера публикации не настроен; браузерный воркер не может подключиться', 'Yayın çalışanı belirteci yapılandırılmadı; tarayıcı çalışanı bağlanamaz', 'رمز عامل النشر غير مُهيَّأ؛ لا يمكن لعامل المتصفح الاتصال', 'אסימון עובד הפרסום לא הוגדר; עובד הדפדפן לא יכול להתחבר'),
  svc_code_publishing_credentials_key_not_set: E('The portal session encryption key is not configured', 'პორტალის სესიის დაშიფვრის გასაღები არ არის მითითებული', 'Ключ шифрования сеансов порталов не настроен', 'Portal oturumu şifreleme anahtarı yapılandırılmadı', 'مفتاح تشفير جلسات البوابات غير مُهيَّأ', 'מפתח ההצפנה של חיבורי הפורטלים לא הוגדר'),
  svc_code_publishing_automation_railway_flag: E('Browser automation also needs its own switch on the Railway worker, and live publishing needs the owner\'s separate approval', 'ბრაუზერის ავტომატიზაციას Railway ვორკერზე საკუთარი გადამრთველიც სჭირდება, ცოცხალ გამოქვეყნებას კი — მფლობელის ცალკე თანხმობა', 'Автоматизации браузера также нужен свой переключатель на воркере Railway, а реальной публикации — отдельное одобрение владельца', 'Tarayıcı otomasyonu Railway çalışanında kendi anahtarına da ihtiyaç duyar; canlı yayın ise sahibin ayrı onayını gerektirir', 'تحتاج أتمتة المتصفح أيضًا إلى مفتاحها الخاص على عامل Railway، ويحتاج النشر الفعلي إلى موافقة منفصلة من المالك', 'אוטומציית הדפדפן צריכה גם מתג משלה בעובד Railway, ופרסום חי דורש אישור נפרד של הבעלים'),
  svc_code_ai_talk_setting_off: E('The AI TALK setting in voice settings is off — sessions will be refused until it is on', 'AI TALK-ის პარამეტრი ხმის პარამეტრებში გამორთულია — სესიები უარყოფილი იქნება, სანამ არ ჩაირთვება', 'Настройка AI TALK в голосовых параметрах выключена — сеансы будут отклоняться, пока её не включить', 'Ses ayarlarındaki AI TALK ayarı kapalı — açılana kadar oturumlar reddedilecek', 'إعداد AI TALK في إعدادات الصوت متوقف — ستُرفض الجلسات حتى يُشغَّل', 'הגדרת AI TALK בהגדרות הקול כבויה — שיחות יידחו עד שתופעל'),
  svc_code_product_ai_call_not_priced: E('AI calls have no active price yet, so campaigns cannot reserve credits', 'AI ზარებს ჯერ არ აქვს აქტიური ფასი, ამიტომ კამპანიები კრედიტებს ვერ დაჯავშნიან', 'У ИИ-звонков ещё нет активной цены, поэтому кампании не могут резервировать кредиты', 'Yapay zekâ aramalarının henüz etkin fiyatı yok; kampanyalar kredi ayıramaz', 'لا يوجد بعد سعر فعّال لمكالمات الذكاء الاصطناعي، لذا لا تستطيع الحملات حجز الأرصدة', 'לשיחות AI עדיין אין מחיר פעיל, ולכן קמפיינים אינם יכולים לשריין קרדיטים'),
  svc_code_whatsapp_webhook_secrets_not_set: E('WhatsApp webhook secrets are not set; incoming messages cannot be verified', 'WhatsApp-ის ვებჰუკის საიდუმლოები არ არის მითითებული; შემომავალი შეტყობინებები ვერ დადასტურდება', 'Секреты вебхука WhatsApp не заданы; входящие сообщения нельзя проверить', 'WhatsApp webhook gizli anahtarları ayarlı değil; gelen mesajlar doğrulanamaz', 'أسرار خطاف واتساب غير مُعيَّنة؛ لا يمكن التحقق من الرسائل الواردة', 'סודות ה-webhook של WhatsApp לא הוגדרו; לא ניתן לאמת הודעות נכנסות'),
  svc_code_product_whatsapp_not_priced: E('WhatsApp campaigns have no active price yet', 'WhatsApp-ის კამპანიებს ჯერ არ აქვს აქტიური ფასი', 'У кампаний WhatsApp ещё нет активной цены', 'WhatsApp kampanyalarının henüz etkin fiyatı yok', 'لا يوجد بعد سعر فعّال لحملات واتساب', 'לקמפיינים של WhatsApp עדיין אין מחיר פעיל'),
  svc_code_design_studio_billing_off: E('Design Studio billing is off: work runs unbilled and its cost is recorded', 'დიზაინ სტუდიოს ბილინგი გამორთულია: სამუშაო უფასოდ სრულდება და ხარჯი ფიქსირდება', 'Биллинг Дизайн-студии выключен: работа выполняется без списания, затраты учитываются', 'Tasarım Stüdyosu faturalandırması kapalı: işler ücretsiz çalışır ve maliyet kaydedilir', 'فوترة استوديو التصميم متوقفة: يُنفَّذ العمل دون فوترة وتُسجَّل تكلفته', 'החיוב בסטודיו עיצוב כבוי: העבודה מתבצעת ללא חיוב והעלות נרשמת'),

  /* ── History ── */
  svc_code_changed: E('Changed', 'შეიცვალა', 'Изменено', 'Değiştirildi', 'تم التغيير', 'שונה'),
  svc_code_unchanged: E('No change needed', 'ცვლილება არ დასჭირდა', 'Без изменений', 'Değişiklik gerekmedi', 'لم يلزم تغيير', 'לא נדרש שינוי'),
  svc_code_conflict: E('Refused: changed by someone else first', 'უარყოფილია: ჯერ სხვამ შეცვალა', 'Отклонено: сначала изменил другой', 'Reddedildi: önce başkası değiştirdi', 'مرفوض: غيّرها شخص آخر أولًا', 'נדחה: מישהו אחר שינה קודם'),
  svc_code_not_ready: E('Refused: not ready', 'უარყოფილია: მზად არ არის', 'Отклонено: не готов', 'Reddedildi: hazır değil', 'مرفوض: غير جاهزة', 'נדחה: לא מוכן'),
  svc_code_service_control_set: E('Switch changed', 'გადამრთველი შეიცვალა', 'Переключатель изменён', 'Anahtar değiştirildi', 'تم تغيير المفتاح', 'המתג שונה'),
  svc_code_service_control_pause_all: E('Paused with all six', 'შეჩერდა ექვსივესთან ერთად', 'Приостановлен вместе со всеми', 'Altısıyla birlikte duraklatıldı', 'أُوقفت مع الست جميعًا', 'הושהה יחד עם כל השישה'),
  svc_code_service_control_not_ready: E('Activation refused: not ready', 'ჩართვა უარყოფილია: მზად არ არის', 'Включение отклонено: не готов', 'Etkinleştirme reddedildi: hazır değil', 'رُفض التفعيل: غير جاهزة', 'ההפעלה נדחתה: לא מוכן'),
};
