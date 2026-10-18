/*
 * FIND PROPERTY — Deep Search v2 (owner, 2026-10-18).
 *
 * One confirmation on the Deep Search card starts it; the customer follows the PROCESS,
 * never a list of networks or sites; its results have their own view. Order is en, ka, ru,
 * tr, ar, he (LANGS in lib/i18nSplice.mjs). Placeholders survive every locale.
 *
 * REPLACED holds existing keys whose values change (applied with overwrite); ADDED holds new keys.
 */
export const FIND_PROPERTY_PAID_V2_REPLACED = {
  fpx_start_deep: ['Start Deep Search', 'ვრცელი ძიების დაწყება', 'Начать расширенный поиск', 'Geniş aramayı başlat', 'ابدأ البحث الموسّع', 'להתחיל חיפוש מורחב'],
  fpi_paid_results_wait: [
    'Results appear when the search has finished.',
    'შედეგები ძიების დასრულების შემდეგ გამოჩნდება.',
    'Результаты появятся, когда поиск завершится.',
    'Sonuçlar arama bittiğinde görünür.',
    'تظهر النتائج عند انتهاء البحث.',
    'התוצאות יופיעו כשהחיפוש יסתיים.',
  ],
};

export const FIND_PROPERTY_PAID_V2_ADDED = {
  fpx_deep_consent: [
    'I approve up to {{credits}} credits ({{max}}). They are held now; I pay only for the work done and the rest returns to me.',
    'ვადასტურებ მაქსიმუმ {{credits}} კრედიტს ({{max}}). ის ახლავე დარეზერვდება; ვიხდი მხოლოდ შესრულებულ სამუშაოში, დანარჩენი დამიბრუნდება.',
    'Подтверждаю максимум {{credits}} кредитов ({{max}}). Они резервируются сейчас; я плачу только за выполненную работу, остаток вернётся.',
    'En fazla {{credits}} krediyi ({{max}}) onaylıyorum. Şimdi bloke edilir; yalnızca yapılan iş için öderim, kalanı bana döner.',
    'أوافق على ما يصل إلى {{credits}} رصيدًا ({{max}}). يُحجز الآن؛ أدفع فقط مقابل العمل المنجز ويعود الباقي إليّ.',
    'אני מאשר/ת עד {{credits}} קרדיטים ({{max}}). הם נחסמים עכשיו; אשלם רק על העבודה שבוצעה והשאר יחזור אליי.',
  ],
  fpi_paid_starting: ['Starting your Deep Search…', 'ვრცელი ძიება იწყება…', 'Запускаем расширенный поиск…', 'Geniş arama başlatılıyor…', 'جارٍ بدء البحث الموسّع…', 'החיפוש המורחב מתחיל…'],
  fpi_proc_search: [
    'Searching public posts where people offer homes',
    'ვეძებთ საჯარო პოსტებს, სადაც ბინებს სთავაზობენ',
    'Ищем публичные посты, где предлагают жильё',
    'İnsanların ev sunduğu herkese açık gönderileri arıyoruz',
    'نبحث في المنشورات العامة التي يعرض فيها الناس منازل',
    'מחפשים פוסטים ציבוריים שבהם מציעים דירות',
  ],
  fpi_proc_analyse: [
    'Reading each post: is it an offer of the right kind, in the right place?',
    'ვკითხულობთ თითოეულ პოსტს: შეთავაზებაა თუ არა, სწორი ტიპის და სწორ ადგილას?',
    'Читаем каждый пост: это предложение нужного типа и в нужном месте?',
    'Her gönderiyi okuyoruz: doğru türde, doğru yerde bir teklif mi?',
    'نقرأ كل منشور: هل هو عرض من النوع الصحيح وفي المكان الصحيح؟',
    'קוראים כל פוסט: האם זו הצעה מהסוג הנכון ובמקום הנכון?',
  ],
  fpi_proc_match: [
    'Checking each offer against your search',
    'თითოეულ შეთავაზებას თქვენს ძიებასთან ვამოწმებთ',
    'Сверяем каждое предложение с вашим поиском',
    'Her teklifi aramanızla karşılaştırıyoruz',
    'نطابق كل عرض مع بحثك',
    'בודקים כל הצעה מול החיפוש שלך',
  ],
  fpi_proc_ready: ['Preparing your results', 'შედეგებს ვამზადებთ', 'Готовим результаты', 'Sonuçlarınızı hazırlıyoruz', 'نجهّز نتائجك', 'מכינים את התוצאות'],
  fpi_proc_progress: ['Progress: {{pct}}%', 'პროგრესი: {{pct}}%', 'Прогресс: {{pct}}%', 'İlerleme: %{{pct}}', 'التقدّم: {{pct}}%', 'התקדמות: {{pct}}%'],
  fpi_paid_no_offers: [
    'No posts offering a home like yours were found this time. You pay only for the work done; the rest returns to your balance.',
    'ამჯერად თქვენნაირი ბინის შეთავაზების პოსტი ვერ მოიძებნა. იხდით მხოლოდ შესრულებულ სამუშაოში, დანარჩენი ბალანსზე ბრუნდება.',
    'На этот раз постов с подходящим предложением не нашлось. Вы платите только за выполненную работу, остаток вернётся на баланс.',
    'Bu kez sizinkine benzer bir ev sunan gönderi bulunamadı. Yalnızca yapılan iş için ödersiniz; kalanı bakiyenize döner.',
    'لم نعثر هذه المرة على منشورات تعرض منزلًا كالذي تريده. تدفع فقط مقابل العمل المنجز ويعود الباقي إلى رصيدك.',
    'הפעם לא נמצאו פוסטים שמציעים דירה כמו שחיפשת. משלמים רק על העבודה שבוצעה, והשאר חוזר ליתרה.',
  ],
  fpv_tab_paid: ['Deep Search', 'ვრცელი ძიება', 'Расширенный', 'Geniş arama', 'البحث الموسّع', 'חיפוש מורחב'],
  fpv_paid_title: ['Deep Search results', 'ვრცელი ძიების შედეგები', 'Результаты расширенного поиска', 'Geniş arama sonuçları', 'نتائج البحث الموسّع', 'תוצאות החיפוש המורחב'],
  fpv_paid_body: [
    'Homes people offered in public posts. HOMATCH has not verified them: open the original post and check the details with the person who posted it.',
    'ბინები, რომლებიც ადამიანებმა საჯარო პოსტებში შესთავაზეს. HOMATCH-ს ისინი გადამოწმებული არ აქვს: გახსენით ორიგინალი პოსტი და დეტალები ავტორთან დააზუსტეთ.',
    'Жильё, которое люди предложили в публичных постах. HOMATCH его не проверял: откройте исходный пост и уточните детали у автора.',
    'İnsanların herkese açık gönderilerde sunduğu evler. HOMATCH bunları doğrulamadı: orijinal gönderiyi açın ve ayrıntıları paylaşan kişiyle netleştirin.',
    'منازل عرضها أشخاص في منشورات عامة. لم يتحقق منها HOMATCH: افتح المنشور الأصلي وتأكد من التفاصيل مع ناشره.',
    'דירות שאנשים הציעו בפוסטים ציבוריים. HOMATCH לא אימת אותן: פתחו את הפוסט המקורי ובררו את הפרטים עם מי שפרסם.',
  ],
  fpv_paid_empty_title: ['No Deep Search results yet', 'ვრცელი ძიების შედეგები ჯერ არ არის', 'Результатов расширенного поиска пока нет', 'Henüz geniş arama sonucu yok', 'لا توجد نتائج للبحث الموسّع بعد', 'עדיין אין תוצאות חיפוש מורחב'],
  fpv_paid_empty_body: [
    'Offers from public posts appear here once a Deep Search has finished.',
    'საჯარო პოსტებიდან შეთავაზებები აქ ვრცელი ძიების დასრულების შემდეგ გამოჩნდება.',
    'Предложения из публичных постов появятся здесь после завершения расширенного поиска.',
    'Herkese açık gönderilerdeki teklifler, geniş arama bittiğinde burada görünür.',
    'تظهر هنا العروض من المنشورات العامة بعد انتهاء البحث الموسّع.',
    'הצעות מפוסטים ציבוריים יופיעו כאן אחרי שהחיפוש המורחב יסתיים.',
  ],
};
