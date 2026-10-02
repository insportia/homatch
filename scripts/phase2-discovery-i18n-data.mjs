// Copy for PHASE 2 — Universal Discovery (namespace p2d_): search controls
// that act on the server, and the Find Property live stages.
// Order: [en, ka, ru, tr, ar, he]. Terminology: match = დამთხვევა.
export const PHASE2_DISCOVERY_STRINGS = {
  p2d_resume_search: ['Resume search', 'ძიების გაგრძელება', 'Возобновить поиск', 'Aramaya devam et', 'استئناف البحث', 'המשך החיפוש'],
  p2d_stop_search: ['Stop and show results', 'შეჩერება და შედეგების ჩვენება', 'Остановить и показать результаты', 'Durdur ve sonuçları göster', 'إيقاف وعرض النتائج', 'עצירה והצגת התוצאות'],
  p2d_paused_note: [
    'Search paused. Nothing new is searched until you resume. Your budget stays reserved for up to an hour.',
    'ძიება შეჩერებულია. გაგრძელებამდე ახალი არაფერი მოიძებნება. ბიუჯეტი დაჯავშნული რჩება მაქსიმუმ ერთი საათით.',
    'Поиск приостановлен. До возобновления ничего нового не ищется. Бюджет остаётся зарезервированным до одного часа.',
    'Arama duraklatıldı. Devam ettirene kadar yeni bir şey aranmaz. Bütçeniz en fazla bir saat ayrılmış kalır.',
    'تم إيقاف البحث مؤقتًا. لن يُبحث عن شيء جديد حتى تستأنف. تبقى ميزانيتك محجوزة لمدة تصل إلى ساعة.',
    'החיפוש הושהה. שום דבר חדש לא ייחפש עד שתמשיכו. התקציב נשאר שמור עד שעה.',
  ],
  p2d_resumed_toast: ['Search resumed', 'ძიება გაგრძელდა', 'Поиск возобновлён', 'Arama devam ediyor', 'تم استئناف البحث', 'החיפוש חודש'],
  p2d_stopping_toast: ['Finishing with what was found…', 'სრულდება ნაპოვნით…', 'Завершаем с тем, что найдено…', 'Bulunanlarla tamamlanıyor…', 'جارٍ الإنهاء بما تم العثور عليه…', 'מסיימים עם מה שנמצא…'],
  p2d_control_error: ['This could not be done right now. Please try again.', 'ახლა ეს ვერ მოხერხდა. გთხოვთ, სცადოთ ხელახლა.', 'Сейчас это не удалось. Попробуйте ещё раз.', 'Bu şu anda yapılamadı. Lütfen tekrar deneyin.', 'تعذّر تنفيذ ذلك الآن. حاول مرة أخرى.', 'לא ניתן לעשות זאת כרגע. נסו שוב.'],
};

// Find Property: searching outside HOMATCH, real stages, customer-safe source groups.
Object.assign(PHASE2_DISCOVERY_STRINGS, {
  p2d_outside_title: ['Search outside HOMATCH', 'ძიება HOMATCH-ის გარეთ', 'Поиск за пределами HOMATCH', 'HOMATCH dışında ara', 'البحث خارج HOMATCH', 'חיפוש מחוץ ל-HOMATCH'],
  p2d_outside_body: [
    'HOMATCH searches live property portals and communities for listings that fit your search. You set a budget; you pay only for what is used.',
    'HOMATCH ეძებს თქვენს მოთხოვნებთან შესაბამის განცხადებებს უძრავი ქონების პორტალებსა და თემებში. ბიუჯეტს თქვენ ადგენთ და იხდით მხოლოდ გამოყენებულში.',
    'HOMATCH ищет подходящие объявления на порталах недвижимости и в сообществах. Бюджет задаёте вы, оплата — только за использованное.',
    'HOMATCH, aramanıza uyan ilanları emlak portallarında ve topluluklarda arar. Bütçeyi siz belirlersiniz; yalnızca kullanılan kadar ödersiniz.',
    'يبحث HOMATCH في بوابات العقارات والمجتمعات عن إعلانات تناسب بحثك. أنت تحدد الميزانية وتدفع فقط مقابل ما يُستخدم.',
    'HOMATCH מחפש בפורטלי נדל״ן ובקהילות מודעות שמתאימות לחיפוש שלכם. אתם קובעים תקציב ומשלמים רק על מה שנוצל.',
  ],
  p2d_outside_start: ['Search outside HOMATCH', 'ძიების დაწყება HOMATCH-ის გარეთ', 'Начать поиск за пределами HOMATCH', 'HOMATCH dışında aramayı başlat', 'ابدأ البحث خارج HOMATCH', 'התחלת חיפוש מחוץ ל-HOMATCH'],
  p2d_outside_again: ['Search again', 'ხელახლა ძიება', 'Искать снова', 'Tekrar ara', 'ابحث مرة أخرى', 'חיפוש נוסף'],
  p2d_outside_done: ['This search found {{count}} properties outside HOMATCH. They are in your results.', 'ამ ძიებამ HOMATCH-ის გარეთ {{count}} ობიექტი იპოვა. ისინი თქვენს შედეგებშია.', 'Этот поиск нашёл {{count}} объектов за пределами HOMATCH. Они в ваших результатах.', 'Bu arama HOMATCH dışında {{count}} mülk buldu. Sonuçlarınızda yer alıyor.', 'وجد هذا البحث {{count}} عقارًا خارج HOMATCH. إنها ضمن نتائجك.', 'החיפוש מצא {{count}} נכסים מחוץ ל-HOMATCH. הם מופיעים בתוצאות שלכם.'],
  p2d_outside_none: ['The last search outside HOMATCH found nothing new that fits. Only what was used was charged.', 'HOMATCH-ის გარეთ ბოლო ძიებამ შესაბამისი ახალი ვერაფერი იპოვა. ჩამოიჭრა მხოლოდ გამოყენებული.', 'Последний поиск за пределами HOMATCH не нашёл ничего нового подходящего. Списано только использованное.', 'HOMATCH dışındaki son arama uygun yeni bir şey bulamadı. Yalnızca kullanılan ücretlendirildi.', 'لم يعثر آخر بحث خارج HOMATCH على شيء جديد مناسب. تم احتساب ما استُخدم فقط.', 'החיפוש האחרון מחוץ ל-HOMATCH לא מצא משהו חדש שמתאים. חויב רק מה שנוצל.'],
  p2d_pause_search: ['Pause search', 'ძიების შეჩერება', 'Приостановить поиск', 'Aramayı duraklat', 'إيقاف البحث مؤقتًا', 'השהיית החיפוש'],
  p2d_stage_understanding: ['Understanding your request', 'თქვენი მოთხოვნის გააზრება', 'Понимаем ваш запрос', 'Talebiniz anlaşılıyor', 'فهم طلبك', 'מבינים את הבקשה'],
  p2d_stage_checking: ['Checking HOMATCH intelligence', 'HOMATCH-ის მონაცემების შემოწმება', 'Проверяем данные HOMATCH', 'HOMATCH verileri kontrol ediliyor', 'التحقق من بيانات HOMATCH', 'בודקים את המידע של HOMATCH'],
  p2d_stage_searching: ['Searching sources', 'წყაროებში ძიება', 'Ищем по источникам', 'Kaynaklarda aranıyor', 'البحث في المصادر', 'מחפשים במקורות'],
  p2d_stage_validating: ['Validating listings', 'განცხადებების გადამოწმება', 'Проверяем объявления', 'İlanlar doğrulanıyor', 'التحقق من الإعلانات', 'מאמתים מודעות'],
  p2d_stage_matching: ['Matching to your search', 'თქვენს ძიებასთან დამთხვევა', 'Сопоставляем с вашим поиском', 'Aramanızla eşleştiriliyor', 'المطابقة مع بحثك', 'מתאימים לחיפוש שלכם'],
  p2d_stage_ready: ['Results ready', 'შედეგები მზადაა', 'Результаты готовы', 'Sonuçlar hazır', 'النتائج جاهزة', 'התוצאות מוכנות'],
  p2d_group_portals: ['Property portals', 'უძრავი ქონების პორტალები', 'Порталы недвижимости', 'Emlak portalları', 'بوابات العقارات', 'פורטלי נדל״ן'],
  p2d_group_communities: ['Communities', 'თემები', 'Сообщества', 'Topluluklar', 'المجتمعات', 'קהילות'],
  p2d_group_forums: ['Forums', 'ფორუმები', 'Форумы', 'Forumlar', 'المنتديات', 'פורומים'],
  p2d_group_homatch: ['HOMATCH intelligence', 'HOMATCH-ის მონაცემები', 'Данные HOMATCH', 'HOMATCH verileri', 'بيانات HOMATCH', 'המידע של HOMATCH'],
  p2d_group_done: ['{{group}}: {{count}} searched', '{{group}}: მოძიებულია {{count}}', '{{group}}: проверено {{count}}', '{{group}}: {{count}} arandı', '{{group}}: تم البحث في {{count}}', '{{group}}: נבדקו {{count}}'],
  p2d_refused_off: ['Searching outside HOMATCH is not available right now.', 'HOMATCH-ის გარეთ ძიება ახლა მიუწვდომელია.', 'Поиск за пределами HOMATCH сейчас недоступен.', 'HOMATCH dışında arama şu anda kullanılamıyor.', 'البحث خارج HOMATCH غير متاح حاليًا.', 'חיפוש מחוץ ל-HOMATCH אינו זמין כרגע.'],
  p2d_refused_no_sources: ['No live source covers this market right now.', 'ამ ბაზარს ახლა არცერთი აქტიური წყარო არ ფარავს.', 'Сейчас ни один активный источник не охватывает этот рынок.', 'Şu anda bu pazarı kapsayan aktif bir kaynak yok.', 'لا يغطي أي مصدر نشط هذا السوق حاليًا.', 'כרגע אין מקור פעיל שמכסה את השוק הזה.'],
  p2d_refused_plan: ['Add a city to your search first.', 'ჯერ ძიებას ქალაქი დაამატეთ.', 'Сначала добавьте город в поиск.', 'Önce aramanıza bir şehir ekleyin.', 'أضف مدينة إلى بحثك أولًا.', 'הוסיפו קודם עיר לחיפוש.'],
  p2d_refused_budget: ['The budget is below the minimum for this search.', 'ბიუჯეტი ამ ძიების მინიმუმზე ნაკლებია.', 'Бюджет ниже минимума для этого поиска.', 'Bütçe bu arama için gereken asgari tutarın altında.', 'الميزانية أقل من الحد الأدنى لهذا البحث.', 'התקציב נמוך מהמינימום לחיפוש הזה.'],
  p2d_refused_credits: ['Your balance does not cover this budget.', 'თქვენი ბალანსი ამ ბიუჯეტს ვერ ფარავს.', 'Баланса недостаточно для этого бюджета.', 'Bakiyeniz bu bütçeyi karşılamıyor.', 'رصيدك لا يغطي هذه الميزانية.', 'היתרה שלכם אינה מכסה את התקציב הזה.'],
});
