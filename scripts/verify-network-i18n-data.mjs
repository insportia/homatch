/*
 * Copy for the Verify research network (the waiting experience that replaced
 * the estimated percentage bar) and the optional Snake while research runs.
 *
 * Customer language only: no provider, portal or internal stage names. A
 * count is always "label: {{count}}" so no locale needs plural grammar.
 *
 * Order is en, ka, ru, tr, ar, he — LANGS in lib/i18nSplice.mjs.
 */
export const VERIFY_NETWORK_STRINGS = {
  verify_net_node_started: ['Research started', 'კვლევა დაიწყო', 'Исследование начато', 'Araştırma başladı', 'بدأ البحث', 'המחקר התחיל'],
  verify_net_node_identity: ['Property identity', 'ქონების იდენტიფიკაცია', 'Идентификация объекта', 'Mülk kimliği', 'هوية العقار', 'זיהוי הנכס'],
  verify_net_node_location: ['Location', 'მდებარეობა', 'Местоположение', 'Konum', 'الموقع', 'מיקום'],
  verify_net_node_official: ['Official records', 'ოფიციალური ჩანაწერები', 'Официальные записи', 'Resmî kayıtlar', 'السجلات الرسمية', 'רשומות רשמיות'],
  verify_net_node_documents: ['Document review', 'დოკუმენტების განხილვა', 'Изучение документов', 'Belge incelemesi', 'مراجعة المستندات', 'סקירת מסמכים'],
  verify_net_node_registry: ['Company and registry checks', 'კომპანიისა და რეესტრის შემოწმება', 'Проверка компании и реестров', 'Şirket ve sicil kontrolleri', 'فحص الشركة والسجلات', 'בדיקות חברה ומרשמים'],
  verify_net_node_context: ['Public context', 'საჯარო კონტექსტი', 'Публичный контекст', 'Kamuya açık bağlam', 'السياق العام', 'הקשר ציבורי'],
  verify_net_node_market: ['Market comparables', 'საბაზრო ანალოგები', 'Рыночные аналоги', 'Piyasa emsalleri', 'العقارات المماثلة في السوق', 'נכסי השוואה בשוק'],
  verify_net_node_crosscheck: ['Cross-checking the evidence', 'მტკიცებულებების გადამოწმება', 'Перекрёстная проверка данных', 'Kanıtların çapraz kontrolü', 'التحقق المتقاطع من الأدلة', 'הצלבת הראיות'],
  verify_net_node_synthesis: ['Preparing your report', 'ანგარიშის მომზადება', 'Подготовка отчёта', 'Raporunuz hazırlanıyor', 'إعداد تقريرك', 'הכנת הדוח שלך'],
  verify_net_node_complete: ['Report ready', 'ანგარიში მზადაა', 'Отчёт готов', 'Rapor hazır', 'التقرير جاهز', 'הדוח מוכן'],

  verify_net_state_idle: ['Not started yet', 'ჯერ არ დაწყებულა', 'Ещё не начато', 'Henüz başlamadı', 'لم يبدأ بعد', 'טרם התחיל'],
  verify_net_state_active: ['In progress', 'მიმდინარეობს', 'Выполняется', 'Devam ediyor', 'قيد التنفيذ', 'בתהליך'],
  verify_net_state_done: ['Done', 'დასრულებულია', 'Готово', 'Tamamlandı', 'اكتمل', 'הושלם'],
  verify_net_state_partial: ['Partly available', 'ნაწილობრივ ხელმისაწვდომია', 'Доступно частично', 'Kısmen mevcut', 'متاح جزئيًا', 'זמין חלקית'],
  verify_net_state_unavailable: ['Unavailable', 'მიუწვდომელია', 'Недоступно', 'Kullanılamıyor', 'غير متاح', 'לא זמין'],

  verify_net_count_documents: ['Documents reviewed: {{count}}', 'განხილული დოკუმენტები: {{count}}', 'Изучено документов: {{count}}', 'İncelenen belgeler: {{count}}', 'المستندات التي تمت مراجعتها: {{count}}', 'מסמכים שנסקרו: {{count}}'],
  verify_net_count_decisions: ['Official decisions found: {{count}}', 'ნაპოვნი ოფიციალური გადაწყვეტილებები: {{count}}', 'Найдено официальных решений: {{count}}', 'Bulunan resmî kararlar: {{count}}', 'القرارات الرسمية التي عُثر عليها: {{count}}', 'החלטות רשמיות שנמצאו: {{count}}'],
  verify_net_count_comparables: ['Market comparables analysed: {{count}}', 'გაანალიზებული საბაზრო ანალოგები: {{count}}', 'Проанализировано рыночных аналогов: {{count}}', 'Analiz edilen piyasa emsalleri: {{count}}', 'العقارات المماثلة التي تم تحليلها: {{count}}', 'נכסי השוואה שנותחו: {{count}}'],

  verify_net_elapsed: ['Elapsed', 'გასული დრო', 'Прошло времени', 'Geçen süre', 'الوقت المنقضي', 'זמן שחלף'],
  verify_net_now: ['Now: {{step}}', 'ახლა: {{step}}', 'Сейчас: {{step}}', 'Şu an: {{step}}', 'الآن: {{step}}', 'כעת: {{step}}'],
  verify_net_settled: ['Research complete — your report is ready', 'კვლევა დასრულდა — თქვენი ანგარიში მზადაა', 'Исследование завершено — ваш отчёт готов', 'Araştırma tamamlandı — raporunuz hazır', 'اكتمل البحث — تقريرك جاهز', 'המחקר הושלם — הדוח שלך מוכן'],
  verify_net_stopped: ['Research stopped before it could finish', 'კვლევა დასრულებამდე შეწყდა', 'Исследование остановлено до завершения', 'Araştırma tamamlanmadan durdu', 'توقف البحث قبل اكتماله', 'המחקר נעצר לפני שהושלם'],
  verify_net_sr_heading: ['Research steps and their status', 'კვლევის ეტაპები და მათი სტატუსი', 'Этапы исследования и их статус', 'Araştırma adımları ve durumları', 'خطوات البحث وحالتها', 'שלבי המחקר והסטטוס שלהם'],
  verify_net_play_snake: ['Play Snake while we research your property', 'ითამაშეთ Snake-ი, სანამ თქვენს ქონებას ვიკვლევთ', 'Сыграйте в Snake, пока мы исследуем ваш объект', 'Mülkünüzü araştırırken Snake oynayın', 'العب Snake بينما نبحث في عقارك', 'שחקו Snake בזמן שאנחנו חוקרים את הנכס שלכם'],
};
