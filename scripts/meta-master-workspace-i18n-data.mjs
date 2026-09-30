// Copy for the Meta Ads master WORKSPACE: global dashboard, Leads Center,
// HOMATCH service balance, Guard banner, and the service-balance ledger
// vocabulary the server returns as labelKey (src/lib/metaAds/billing.ts).
// Order: [en, ka, ru, tr, ar, he]. Spliced by scripts/meta-master-i18n-apply.mjs.
//
// Vocabulary rules: match = დამთხვევა; lead = ლიდი; tenant = მოიჯარე; a lead
// is a "potentially interested person", never a confirmed buyer; unused
// service fee is "Released to HOMATCH Balance" — never refunded to cash.
export const META_MASTER_WORKSPACE_STRINGS = {
  // ── Ledger vocabulary (server labelKey) ─────────────────────────────────
  mads_ledger_deposit: [
    'Deposit', 'შევსება', 'Пополнение', 'Yatırma', 'إيداع', 'הפקדה',
  ],
  mads_ledger_service_reserved: [
    'Service fee reserved', 'მომსახურების საკომისიო დაკავებულია', 'Сервисный сбор зарезервирован',
    'Hizmet bedeli ayrıldı', 'تم حجز رسوم الخدمة', 'דמי השירות שוריינו',
  ],
  mads_ledger_released_to_balance: [
    'Released to HOMATCH Balance', 'დაბრუნდა HOMATCH-ის ბალანსზე', 'Возвращено на баланс HOMATCH',
    'HOMATCH bakiyesine aktarıldı', 'أُعيد إلى رصيد HOMATCH', 'הועבר ליתרת HOMATCH',
  ],
  mads_ledger_budget_reserved: [
    'Ad budget reserved', 'სარეკლამო ბიუჯეტი დაკავებულია', 'Рекламный бюджет зарезервирован',
    'Reklam bütçesi ayrıldı', 'تم حجز ميزانية الإعلان', 'תקציב הפרסום שוריין',
  ],
  mads_ledger_meta_spend: [
    'Meta ad spend', 'Meta-ს სარეკლამო ხარჯი', 'Расход на рекламу в Meta',
    'Meta reklam harcaması', 'الإنفاق الإعلاني على Meta', 'הוצאת פרסום ב-Meta',
  ],
  mads_ledger_adjustment: [
    'Adjustment', 'კორექტირება', 'Корректировка', 'Düzeltme', 'تسوية', 'התאמה',
  ],

  // ── Workspace tabs ──────────────────────────────────────────────────────
  mm_w_tab_balance: [
    'Balance', 'ბალანსი', 'Баланс', 'Bakiye', 'الرصيد', 'יתרה',
  ],

  // ── Guard banner ────────────────────────────────────────────────────────
  mm_w_guard_suspended_title: [
    'Managed actions are paused', 'მართული მოქმედებები შეჩერებულია', 'Управляемые действия приостановлены',
    'Yönetilen işlemler duraklatıldı', 'الإجراءات المُدارة متوقفة مؤقتًا', 'הפעולות המנוהלות מושהות',
  ],
  mm_w_guard_suspended_body: [
    'Managed Meta Ads actions are paused for this ad account after repeated changes outside HOMATCH. Your statistics and leads remain available. Contact support to review.',
    'ამ სარეკლამო ანგარიშზე მართული Meta Ads მოქმედებები შეჩერებულია HOMATCH-ის გარეთ განმეორებითი ცვლილებების გამო. თქვენი სტატისტიკა და ლიდები ხელმისაწვდომი რჩება. განსახილველად დაუკავშირდით მხარდაჭერას.',
    'Управляемые действия Meta Ads для этого рекламного аккаунта приостановлены после повторных изменений вне HOMATCH. Ваша статистика и лиды остаются доступны. Свяжитесь с поддержкой для проверки.',
    'HOMATCH dışında tekrarlanan değişiklikler nedeniyle bu reklam hesabı için yönetilen Meta Ads işlemleri duraklatıldı. İstatistikleriniz ve potansiyel müşterileriniz erişilebilir olmaya devam ediyor. İnceleme için destekle iletişime geçin.',
    'تم إيقاف إجراءات Meta Ads المُدارة مؤقتًا لهذا الحساب الإعلاني بعد تغييرات متكررة خارج HOMATCH. تبقى إحصاءاتك وعملاؤك المحتملون متاحين. تواصل مع الدعم للمراجعة.',
    'הפעולות המנוהלות של Meta Ads הושהו עבור חשבון המודעות הזה לאחר שינויים חוזרים מחוץ ל-HOMATCH. הנתונים והלידים שלכם נשארים זמינים. פנו לתמיכה לבדיקה.',
  ],
  mm_w_guard_strikes: [
    '{{count}} of {{max}} strikes', '{{count}} / {{max}} გაფრთხილება', 'Нарушений: {{count}} из {{max}}',
    '{{max}} ihlalden {{count}}', '{{count}} من {{max}} مخالفات', '{{count}} מתוך {{max}} התראות חמורות',
  ],
  mm_w_guard_account: [
    'Ad account {{id}}', 'სარეკლამო ანგარიში {{id}}', 'Рекламный аккаунт {{id}}',
    'Reklam hesabı {{id}}', 'الحساب الإعلاني {{id}}', 'חשבון מודעות {{id}}',
  ],
  mm_w_guard_watch_title: [
    'A note about your ad account', 'შენიშვნა თქვენი სარეკლამო ანგარიშის შესახებ', 'Замечание о вашем рекламном аккаунте',
    'Reklam hesabınız hakkında bir not', 'ملاحظة حول حسابك الإعلاني', 'הערה לגבי חשבון המודעות שלכם',
  ],
  mm_w_guard_watch_body: [
    'We noticed changes to this ad account made outside HOMATCH. Everything keeps running; making changes in HOMATCH keeps your campaigns in sync.',
    'შევნიშნეთ ამ სარეკლამო ანგარიშში HOMATCH-ის გარეთ შეტანილი ცვლილებები. ყველაფერი აგრძელებს მუშაობას; ცვლილებები HOMATCH-ში შეიტანეთ, რომ კამპანიები სინქრონში დარჩეს.',
    'Мы заметили изменения в этом рекламном аккаунте, сделанные вне HOMATCH. Всё продолжает работать; вносите изменения в HOMATCH, чтобы кампании оставались синхронизированы.',
    'Bu reklam hesabında HOMATCH dışında yapılan değişiklikler fark ettik. Her şey çalışmaya devam ediyor; değişiklikleri HOMATCH içinde yapmak kampanyalarınızı senkronize tutar.',
    'لاحظنا تغييرات على هذا الحساب الإعلاني أُجريت خارج HOMATCH. يستمر كل شيء في العمل؛ إجراء التغييرات داخل HOMATCH يبقي حملاتك متزامنة.',
    'שמנו לב לשינויים בחשבון המודעות הזה שבוצעו מחוץ ל-HOMATCH. הכול ממשיך לפעול; ביצוע שינויים ב-HOMATCH שומר על הקמפיינים מסונכרנים.',
  ],
  mm_w_guard_contact: [
    'Contact support', 'მხარდაჭერასთან დაკავშირება', 'Связаться с поддержкой',
    'Destekle iletişime geç', 'تواصل مع الدعم', 'פנייה לתמיכה',
  ],

  // ── Global dashboard ────────────────────────────────────────────────────
  mm_w_dash_title: [
    'Performance across your campaigns', 'თქვენი კამპანიების შედეგები', 'Результаты по всем кампаниям',
    'Tüm kampanyalarınızın performansı', 'أداء جميع حملاتك', 'ביצועים בכל הקמפיינים שלכם',
  ],
  mm_w_filters_label: [
    'Dashboard filters', 'დაფის ფილტრები', 'Фильтры панели',
    'Pano filtreleri', 'عوامل تصفية اللوحة', 'מסנני לוח הבקרה',
  ],
  mm_w_filter_status: ['Status', 'სტატუსი', 'Статус', 'Durum', 'الحالة', 'סטטוס'],
  mm_w_filter_goal: ['Goal', 'მიზანი', 'Цель', 'Hedef', 'الهدف', 'מטרה'],
  mm_w_filter_currency: ['Currency', 'ვალუტა', 'Валюта', 'Para birimi', 'العملة', 'מטבע'],
  mm_w_filter_from: ['From', 'დან', 'С', 'Başlangıç', 'من', 'מתאריך'],
  mm_w_filter_to: ['To', 'მდე', 'По', 'Bitiş', 'إلى', 'עד תאריך'],
  mm_w_filter_any: ['All', 'ყველა', 'Все', 'Tümü', 'الكل', 'הכול'],
  mm_w_filter_reset: [
    'Reset filters', 'ფილტრების გასუფთავება', 'Сбросить фильтры',
    'Filtreleri sıfırla', 'إعادة ضبط عوامل التصفية', 'איפוס מסננים',
  ],
  mm_w_count_total: ['Campaigns', 'კამპანიები', 'Кампании', 'Kampanyalar', 'الحملات', 'קמפיינים'],
  mm_w_count_live: ['Live', 'აქტიური', 'Активные', 'Yayında', 'قيد التشغيل', 'פעילים'],
  mm_w_count_attention: [
    'Needs attention', 'საჭიროებს ყურადღებას', 'Требуют внимания',
    'İlgi gerektiriyor', 'تحتاج إلى انتباه', 'דורשים תשומת לב',
  ],
  mm_w_summary_title: [
    'Results in {{currency}}', 'შედეგები — {{currency}}', 'Результаты в {{currency}}',
    '{{currency}} cinsinden sonuçlar', 'النتائج بعملة {{currency}}', 'תוצאות ב-{{currency}}',
  ],
  mm_w_summary_campaigns: [
    '{{count}} campaigns', '{{count}} კამპანია', 'Кампаний: {{count}}',
    '{{count}} kampanya', '{{count}} حملات', '{{count}} קמפיינים',
  ],
  mm_w_summary_note: [
    'Each currency is shown on its own card. Amounts in different currencies are never added together.',
    'თითოეული ვალუტა ცალკე ბარათზეა ნაჩვენები. სხვადასხვა ვალუტის თანხები არასოდეს იკრიბება.',
    'Каждая валюта показана на отдельной карточке. Суммы в разных валютах никогда не складываются.',
    'Her para birimi kendi kartında gösterilir. Farklı para birimlerindeki tutarlar asla toplanmaz.',
    'تُعرض كل عملة في بطاقة مستقلة. لا تُجمع المبالغ بعملات مختلفة أبدًا.',
    'כל מטבע מוצג בכרטיס משלו. סכומים במטבעות שונים לעולם אינם מחוברים יחד.',
  ],
  mm_w_summary_empty_title: [
    'No results in this period', 'ამ პერიოდში შედეგები არ არის', 'Нет результатов за этот период',
    'Bu dönemde sonuç yok', 'لا توجد نتائج في هذه الفترة', 'אין תוצאות בתקופה הזו',
  ],
  mm_w_summary_empty_body: [
    'Numbers appear here once Meta reports delivery for a campaign.',
    'მონაცემები აქ გამოჩნდება, როცა Meta კამპანიის ჩვენებებს დააფიქსირებს.',
    'Цифры появятся здесь, когда Meta сообщит о показах кампании.',
    'Meta bir kampanyanın yayınını bildirdiğinde rakamlar burada görünür.',
    'تظهر الأرقام هنا بمجرد أن تُبلغ Meta عن عرض إحدى الحملات.',
    'המספרים יופיעו כאן ברגע ש-Meta ידווח על הצגת קמפיין.',
  ],
  mm_w_kpi_spend: ['Spend', 'დახარჯული', 'Расход', 'Harcama', 'الإنفاق', 'הוצאה'],
  mm_w_kpi_results: ['Results', 'შედეგები', 'Результаты', 'Sonuçlar', 'النتائج', 'תוצאות'],
  mm_w_kpi_cpr: [
    'Cost per result', 'ფასი ერთ შედეგზე', 'Цена за результат',
    'Sonuç başına maliyet', 'التكلفة لكل نتيجة', 'עלות לתוצאה',
  ],
  mm_w_kpi_leads: ['Leads', 'ლიდები', 'Лиды', 'Potansiyel müşteriler', 'العملاء المحتملون', 'לידים'],
  mm_w_kpi_cpl: [
    'Cost per lead', 'ფასი ერთ ლიდზე', 'Цена за лид',
    'Potansiyel müşteri başına maliyet', 'التكلفة لكل عميل محتمل', 'עלות לליד',
  ],
  mm_w_kpi_cpql: [
    'Cost per qualified lead', 'ფასი ერთ კვალიფიციურ ლიდზე', 'Цена за квалифицированный лид',
    'Nitelikli potansiyel müşteri başına maliyet', 'التكلفة لكل عميل محتمل مؤهَّل', 'עלות לליד מוכשר',
  ],
  mm_w_kpi_qual_rate: [
    'Qualification rate', 'კვალიფიკაციის მაჩვენებელი', 'Доля квалифицированных',
    'Nitelik oranı', 'نسبة التأهيل', 'שיעור הכשרה',
  ],
  mm_w_kpi_cost_viewing: [
    'Cost per viewing', 'ფასი ერთ დათვალიერებაზე', 'Цена за просмотр объекта',
    'Gezme başına maliyet', 'التكلفة لكل معاينة', 'עלות לצפייה בנכס',
  ],
  mm_w_campaigns_title: ['Campaigns', 'კამპანიები', 'Кампании', 'Kampanyalar', 'الحملات', 'קמפיינים'],
  mm_w_col_campaign: ['Campaign', 'კამპანია', 'Кампания', 'Kampanya', 'الحملة', 'קמפיין'],
  mm_w_col_flags: ['Signals', 'სიგნალები', 'Сигналы', 'Sinyaller', 'الإشارات', 'אותות'],
  mm_w_badge_recs: [
    '{{count}} recommendations', '{{count}} რეკომენდაცია', 'Рекомендаций: {{count}}',
    '{{count}} öneri', '{{count}} توصيات', '{{count}} המלצות',
  ],
  mm_w_badge_attention: [
    'Needs attention', 'საჭიროებს ყურადღებას', 'Требует внимания',
    'İlgi gerektiriyor', 'تحتاج إلى انتباه', 'דורש תשומת לב',
  ],
  mm_w_open_campaign: [
    'Open campaign {{name}}', 'კამპანიის გახსნა: {{name}}', 'Открыть кампанию {{name}}',
    '{{name}} kampanyasını aç', 'فتح الحملة {{name}}', 'פתיחת הקמפיין {{name}}',
  ],
  mm_w_campaigns_empty_title: [
    'No campaigns match these filters', 'ამ ფილტრებით კამპანია ვერ მოიძებნა', 'Нет кампаний по этим фильтрам',
    'Bu filtrelere uyan kampanya yok', 'لا توجد حملات تطابق عوامل التصفية', 'אין קמפיינים שתואמים למסננים',
  ],
  mm_w_campaigns_empty_body: [
    'Change the filters, or create a campaign to start.',
    'შეცვალეთ ფილტრები ან შექმენით ახალი კამპანია.',
    'Измените фильтры или создайте кампанию.',
    'Filtreleri değiştirin veya başlamak için bir kampanya oluşturun.',
    'غيّر عوامل التصفية أو أنشئ حملة للبدء.',
    'שנו את המסננים, או צרו קמפיין כדי להתחיל.',
  ],
  mm_w_freshness: [
    'Statistics come from Meta and can lag by a few hours. Last updated {{time}}.',
    'სტატისტიკა Meta-დან მოდის და შეიძლება რამდენიმე საათით აგვიანდეს. ბოლო განახლება: {{time}}.',
    'Статистика поступает из Meta и может отставать на несколько часов. Обновлено: {{time}}.',
    'İstatistikler Meta’dan gelir ve birkaç saat gecikebilir. Son güncelleme: {{time}}.',
    'تأتي الإحصاءات من Meta وقد تتأخر بضع ساعات. آخر تحديث: {{time}}.',
    'הנתונים מגיעים מ-Meta ועשויים להתעכב בכמה שעות. עודכן לאחרונה: {{time}}.',
  ],
  mm_w_freshness_never: [
    'Statistics come from Meta and can lag by a few hours. None have been received yet.',
    'სტატისტიკა Meta-დან მოდის და შეიძლება რამდენიმე საათით აგვიანდეს. ჯერ არაფერი მიგვიღია.',
    'Статистика поступает из Meta и может отставать на несколько часов. Пока данных нет.',
    'İstatistikler Meta’dan gelir ve birkaç saat gecikebilir. Henüz veri alınmadı.',
    'تأتي الإحصاءات من Meta وقد تتأخر بضع ساعات. لم يصل شيء بعد.',
    'הנתונים מגיעים מ-Meta ועשויים להתעכב בכמה שעות. עדיין לא התקבלו נתונים.',
  ],
  mm_w_dash_failed: [
    'The dashboard could not be loaded.', 'დაფის ჩატვირთვა ვერ მოხერხდა.', 'Не удалось загрузить панель.',
    'Pano yüklenemedi.', 'تعذّر تحميل اللوحة.', 'לא ניתן היה לטעון את לוח הבקרה.',
  ],
  mm_w_retry: ['Try again', 'ხელახლა ცდა', 'Повторить', 'Tekrar dene', 'حاول مجددًا', 'נסו שוב'],

  // ── HOMATCH service balance ─────────────────────────────────────────────
  mm_w_bal_title: [
    'HOMATCH service balance', 'HOMATCH-ის მომსახურების ბალანსი', 'Сервисный баланс HOMATCH',
    'HOMATCH hizmet bakiyesi', 'رصيد خدمة HOMATCH', 'יתרת השירות של HOMATCH',
  ],
  mm_w_bal_available: ['Available', 'ხელმისაწვდომი', 'Доступно', 'Kullanılabilir', 'المتاح', 'זמין'],
  mm_w_bal_deposited: ['Deposited', 'შეტანილი', 'Внесено', 'Yatırılan', 'المُودَع', 'הופקד'],
  mm_w_bal_reserved: ['Reserved', 'დაკავებული', 'Зарезервировано', 'Ayrılan', 'المحجوز', 'משוריין'],
  mm_w_bal_reserved_hint: [
    'Service fee held for running campaigns', 'მიმდინარე კამპანიებისთვის დაკავებული საკომისიო',
    'Сервисный сбор, удерживаемый для активных кампаний', 'Devam eden kampanyalar için ayrılan hizmet bedeli',
    'رسوم الخدمة المحجوزة للحملات الجارية', 'דמי שירות שמוחזקים עבור קמפיינים פעילים',
  ],
  mm_w_bal_consumed: ['Consumed', 'გამოყენებული', 'Использовано', 'Kullanılan', 'المُستهلَك', 'נוצל'],
  mm_w_bal_consumed_hint: [
    'Service fee for delivered advertising', 'მიწოდებული რეკლამის საკომისიო',
    'Сервисный сбор за показанную рекламу', 'Yayınlanan reklamların hizmet bedeli',
    'رسوم الخدمة للإعلانات التي عُرضت', 'דמי שירות עבור פרסום שהוצג',
  ],
  mm_w_bal_released: ['Released', 'დაბრუნებული', 'Возвращено', 'Aktarılan', 'المُعاد', 'הועבר'],
  mm_w_bal_released_hint: [
    'Released to HOMATCH Balance', 'დაბრუნდა HOMATCH-ის ბალანსზე', 'Возвращено на баланс HOMATCH',
    'HOMATCH bakiyesine aktarıldı', 'أُعيد إلى رصيد HOMATCH', 'הועבר ליתרת HOMATCH',
  ],
  mm_w_bal_disclosure: [
    'HOMATCH service balance is non-refundable to cash, but it stays in your HOMATCH balance and can be reused for future campaigns. Unused service fee is Released to HOMATCH Balance.',
    'HOMATCH-ის მომსახურების ბალანსი ნაღდ ფულად არ ბრუნდება, მაგრამ რჩება თქვენს HOMATCH-ის ბალანსზე და შეგიძლიათ გამოიყენოთ მომავალი კამპანიებისთვის. გამოუყენებელი საკომისიო ბრუნდება HOMATCH-ის ბალანსზე.',
    'Сервисный баланс HOMATCH не выводится деньгами, но остаётся на вашем балансе HOMATCH и может использоваться для будущих кампаний. Неиспользованный сервисный сбор возвращается на баланс HOMATCH.',
    'HOMATCH hizmet bakiyesi nakde çevrilemez, ancak HOMATCH bakiyenizde kalır ve gelecekteki kampanyalar için yeniden kullanılabilir. Kullanılmayan hizmet bedeli HOMATCH bakiyesine aktarılır.',
    'رصيد خدمة HOMATCH غير قابل للاسترداد نقدًا، لكنه يبقى في رصيدك لدى HOMATCH ويمكن استخدامه في حملات مستقبلية. تُعاد رسوم الخدمة غير المستخدمة إلى رصيد HOMATCH.',
    'יתרת השירות של HOMATCH אינה ניתנת להמרה חזרה למזומן, אך היא נשארת ביתרת HOMATCH שלכם וניתן להשתמש בה בקמפיינים עתידיים. דמי שירות שלא נוצלו מועברים ליתרת HOMATCH.',
  ],
  mm_w_bal_empty: [
    'No deposits yet. Add funds to launch your first managed campaign.',
    'შევსება ჯერ არ გაგიკეთებიათ. დაამატეთ თანხა პირველი მართული კამპანიის გასაშვებად.',
    'Пополнений пока нет. Пополните баланс, чтобы запустить первую управляемую кампанию.',
    'Henüz yatırma yok. İlk yönetilen kampanyanızı başlatmak için bakiye ekleyin.',
    'لا توجد إيداعات بعد. أضف رصيدًا لإطلاق أول حملة مُدارة.',
    'עדיין אין הפקדות. הוסיפו כספים כדי להשיק את הקמפיין המנוהל הראשון.',
  ],
  mm_w_bal_currency: [
    'Balance in {{currency}}', 'ბალანსი — {{currency}}', 'Баланс в {{currency}}',
    '{{currency}} bakiyesi', 'الرصيد بعملة {{currency}}', 'יתרה ב-{{currency}}',
  ],
  mm_w_bal_fee: [
    'Your service fee: {{percent}}%', 'თქვენი მომსახურების საკომისიო: {{percent}}%', 'Ваш сервисный сбор: {{percent}}%',
    'Hizmet bedeliniz: %{{percent}}', 'رسوم الخدمة الخاصة بك: {{percent}}%', 'דמי השירות שלכם: {{percent}}%',
  ],
  mm_w_bal_min: [
    'Minimum $5.', 'მინიმუმ $5.', 'Минимум $5.', 'En az 5 $.', 'الحد الأدنى 5 $.', 'מינימום $5.',
  ],

  // ── Leads Center ────────────────────────────────────────────────────────
  mm_w_leads_intro: [
    'Each lead is a potentially interested person who answered your form. Move them through the pipeline as you follow up.',
    'თითოეული ლიდი პოტენციურად დაინტერესებული პირია, რომელმაც თქვენი ფორმა შეავსო. გადაიტანეთ ისინი ეტაპებზე კომუნიკაციისას.',
    'Каждый лид — потенциально заинтересованный человек, заполнивший вашу форму. Переводите его по этапам по мере работы.',
    'Her potansiyel müşteri, formunuzu yanıtlamış potansiyel olarak ilgilenen bir kişidir. Takip ettikçe onları aşamalar arasında ilerletin.',
    'كل عميل محتمل هو شخص قد يكون مهتمًا أجاب على نموذجك. انقله عبر المراحل أثناء المتابعة.',
    'כל ליד הוא אדם שעשוי להתעניין וענה על הטופס שלכם. העבירו אותו בין השלבים תוך כדי מעקב.',
  ],
  mm_w_leads_campaign: ['Campaign', 'კამპანია', 'Кампания', 'Kampanya', 'الحملة', 'קמפיין'],
  mm_w_leads_all_campaigns: [
    'All campaigns', 'ყველა კამპანია', 'Все кампании', 'Tüm kampanyalar', 'كل الحملات', 'כל הקמפיינים',
  ],
  mm_w_leads_status: ['Status', 'სტატუსი', 'Статус', 'Durum', 'الحالة', 'סטטוס'],
  mm_w_leads_search_label: [
    'Search leads', 'ლიდების ძიება', 'Поиск лидов', 'Potansiyel müşteri ara', 'ابحث في العملاء المحتملين', 'חיפוש לידים',
  ],
  mm_w_leads_counts_label: [
    'Leads by status', 'ლიდები სტატუსის მიხედვით', 'Лиды по статусам',
    'Duruma göre potansiyel müşteriler', 'العملاء المحتملون حسب الحالة', 'לידים לפי סטטוס',
  ],
  mm_w_lead_status_NEW: ['New', 'ახალი', 'Новый', 'Yeni', 'جديد', 'חדש'],
  mm_w_lead_status_CONTACTED: ['Contacted', 'დაკავშირებული', 'Связались', 'İletişime geçildi', 'تم التواصل', 'נוצר קשר'],
  mm_w_lead_status_QUALIFIED: ['Qualified', 'კვალიფიციური', 'Квалифицирован', 'Nitelikli', 'مؤهَّل', 'מוכשר'],
  mm_w_lead_status_VIEWING: ['Viewing', 'დათვალიერება', 'Просмотр', 'Gezme', 'معاينة', 'צפייה בנכס'],
  mm_w_lead_status_NEGOTIATING: ['Negotiating', 'მოლაპარაკება', 'Переговоры', 'Pazarlık', 'تفاوض', 'משא ומתן'],
  mm_w_lead_status_WON: ['Won', 'წარმატებული', 'Сделка', 'Kazanıldı', 'تمّت الصفقة', 'נסגר בהצלחה'],
  mm_w_lead_status_LOST: ['Lost', 'დაკარგული', 'Потерян', 'Kaybedildi', 'لم يُكمل', 'לא התממש'],
  mm_w_lead_open: [
    'Open lead record', 'ლიდის ბარათის გახსნა', 'Открыть карточку лида',
    'Potansiyel müşteri kaydını aç', 'فتح سجل العميل المحتمل', 'פתיחת רשומת הליד',
  ],
  mm_w_lead_change_status: [
    'Pipeline status', 'ეტაპი', 'Этап воронки', 'Süreç durumu', 'مرحلة المتابعة', 'שלב בתהליך',
  ],
  mm_w_lead_status_saved: [
    'Status updated', 'სტატუსი განახლდა', 'Статус обновлён', 'Durum güncellendi', 'تم تحديث الحالة', 'הסטטוס עודכן',
  ],
  mm_w_lead_save_failed: [
    'Could not save. Nothing was changed.', 'შენახვა ვერ მოხერხდა. არაფერი შეცვლილა.',
    'Не удалось сохранить. Ничего не изменено.', 'Kaydedilemedi. Hiçbir şey değişmedi.',
    'تعذّر الحفظ. لم يتغيّر شيء.', 'לא ניתן היה לשמור. דבר לא השתנה.',
  ],
  mm_w_lead_legacy_status: [
    'Earlier status', 'წინა სტატუსი', 'Прежний статус', 'Önceki durum', 'الحالة السابقة', 'סטטוס קודם',
  ],
  mm_w_lead_contact: ['Contact', 'კონტაქტი', 'Контакт', 'İletişim', 'التواصل', 'פרטי קשר'],
  mm_w_lead_contact_private: [
    'Private — visible only to you.', 'პირადი — ხედავთ მხოლოდ თქვენ.', 'Конфиденциально — видно только вам.',
    'Gizli — yalnızca siz görebilirsiniz.', 'خاص — مرئي لك فقط.', 'פרטי — גלוי רק לכם.',
  ],
  mm_w_lead_name: ['Name', 'სახელი', 'Имя', 'Ad', 'الاسم', 'שם'],
  mm_w_lead_email: ['Email', 'ელფოსტა', 'Эл. почта', 'E-posta', 'البريد الإلكتروني', 'דוא״ל'],
  mm_w_lead_phone: ['Phone', 'ტელეფონი', 'Телефон', 'Telefon', 'الهاتف', 'טלפון'],
  mm_w_lead_answers: [
    'Their answers', 'პასუხები', 'Ответы', 'Yanıtları', 'إجاباته', 'התשובות שלהם',
  ],
  mm_w_lead_no_answers: [
    'This form had no qualifying questions.', 'ამ ფორმას დამაზუსტებელი კითხვები არ ჰქონდა.',
    'В этой форме не было уточняющих вопросов.', 'Bu formda nitelendirme sorusu yoktu.',
    'لم يتضمن هذا النموذج أسئلة تأهيل.', 'בטופס הזה לא היו שאלות סינון.',
  ],
  mm_w_lead_attribution: [
    'Where this lead came from', 'საიდან მოვიდა ეს ლიდი', 'Откуда пришёл лид',
    'Bu potansiyel müşteri nereden geldi', 'من أين جاء هذا العميل المحتمل', 'מאיפה הגיע הליד',
  ],
  mm_w_lead_attr_campaign: ['Campaign', 'კამპანია', 'Кампания', 'Kampanya', 'الحملة', 'קמפיין'],
  mm_w_lead_attr_ad: ['Ad', 'რეკლამა', 'Объявление', 'Reklam', 'الإعلان', 'מודעה'],
  mm_w_lead_attr_adset: ['Ad set', 'რეკლამების ჯგუფი', 'Группа объявлений', 'Reklam seti', 'مجموعة الإعلانات', 'קבוצת מודעות'],
  mm_w_lead_attr_property: ['Property ID', 'ქონების ID', 'ID объекта', 'Mülk No', 'رقم العقار', 'מזהה נכס'],
  mm_w_lead_attr_unknown: [
    'Not recorded', 'არ არის დაფიქსირებული', 'Не записано', 'Kaydedilmedi', 'غير مسجَّل', 'לא נרשם',
  ],
  mm_w_lead_received: ['Received', 'მიღებულია', 'Получен', 'Alındı', 'تاريخ الاستلام', 'התקבל'],
  mm_w_lead_meta_time: [
    'Submitted on Meta', 'გაიგზავნა Meta-ზე', 'Отправлен в Meta', 'Meta’da gönderildi', 'أُرسل على Meta', 'נשלח ב-Meta',
  ],
  mm_w_lead_notes: ['Notes', 'შენიშვნები', 'Заметки', 'Notlar', 'ملاحظات', 'הערות'],
  mm_w_lead_notes_ph: [
    'Private notes about this person', 'პირადი შენიშვნები ამ პირის შესახებ', 'Личные заметки об этом человеке',
    'Bu kişi hakkında özel notlar', 'ملاحظات خاصة عن هذا الشخص', 'הערות פרטיות על האדם הזה',
  ],
  mm_w_lead_note_save: ['Save note', 'შენიშვნის შენახვა', 'Сохранить заметку', 'Notu kaydet', 'حفظ الملاحظة', 'שמירת הערה'],
  mm_w_lead_note_saved: ['Note saved', 'შენიშვნა შენახულია', 'Заметка сохранена', 'Not kaydedildi', 'تم حفظ الملاحظة', 'ההערה נשמרה'],

  // ── Qualifying answers (premium lead form) ──────────────────────────────
  mm_w_answer_buy_or_rent: [
    'Buy or rent', 'ყიდვა თუ ქირაობა', 'Купить или арендовать', 'Satın alma veya kiralama', 'شراء أم إيجار', 'קנייה או שכירות',
  ],
  mm_w_answer_budget: ['Budget', 'ბიუჯეტი', 'Бюджет', 'Bütçe', 'الميزانية', 'תקציב'],
  mm_w_answer_preferred_location: [
    'Preferred location', 'სასურველი მდებარეობა', 'Предпочтительный район', 'Tercih edilen konum', 'الموقع المفضَّل', 'מיקום מועדף',
  ],
  mm_w_answer_property_type: [
    'Property type', 'ქონების ტიპი', 'Тип недвижимости', 'Mülk türü', 'نوع العقار', 'סוג נכס',
  ],
  mm_w_answer_bedrooms: ['Bedrooms', 'საძინებლები', 'Спальни', 'Yatak odası', 'غرف النوم', 'חדרי שינה'],
  mm_w_answer_timeframe: [
    'Timeframe', 'ვადები', 'Сроки', 'Zaman aralığı', 'الإطار الزمني', 'לוח זמנים',
  ],
  mm_w_answer_agent_contact: [
    'Agent contact', 'აგენტთან კონტაქტი', 'Связь с агентом', 'Temsilci iletişimi', 'التواصل مع الوكيل', 'יצירת קשר עם סוכן',
  ],
};
