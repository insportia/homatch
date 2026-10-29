// Find Property capacity (2026-10-18): a source answered from listings HOMATCH already checked
// (live quota used, portal busy, live check unavailable), a source read together with an
// identical search, and the notice shown when a new search could not also check live.
// Order: [en, ka, ru, tr, ar, he].
export const FP_CAPACITY_STRINGS = {
  fpx_src_deferred_LIVE_REFRESH_LIMIT: ['Live check limit reached — showing listings checked earlier', 'ცოცხალი შემოწმების ლიმიტი ამოიწურა, ნაჩვენებია ადრე შემოწმებული განცხადებები', 'Лимит живых проверок исчерпан — показаны ранее проверенные объявления', 'Canlı kontrol sınırına ulaşıldı — daha önce kontrol edilen ilanlar gösteriliyor', 'تم بلوغ حد التحقق المباشر — تُعرض الإعلانات التي تم التحقق منها سابقًا', 'הגעתם למגבלת הבדיקה החיה — מוצגות מודעות שנבדקו קודם'],
  fpx_src_deferred_SOURCE_BUSY: ['Portal busy — showing listings checked earlier', 'პორტალი დაკავებულია: ნაჩვენებია ადრე შემოწმებული განცხადებები', 'Портал занят — показаны ранее проверенные объявления', 'Portal yoğun — daha önce kontrol edilen ilanlar gösteriliyor', 'البوابة مشغولة — تُعرض الإعلانات التي تم التحقق منها سابقًا', 'הפורטל עמוס — מוצגות מודעות שנבדקו קודם'],
  fpx_src_deferred_LIVE_REFRESH_UNAVAILABLE: ['Live check unavailable — showing listings checked earlier', 'ცოცხალი შემოწმება ახლა მიუწვდომელია, ნაჩვენებია ადრე შემოწმებული განცხადებები', 'Живая проверка недоступна — показаны ранее проверенные объявления', 'Canlı kontrol şu an kullanılamıyor — daha önce kontrol edilen ilanlar gösteriliyor', 'التحقق المباشر غير متاح — تُعرض الإعلانات التي تم التحقق منها سابقًا', 'בדיקה חיה אינה זמינה — מוצגות מודעות שנבדקו קודם'],
  fpx_src_shared: [
    'Checking together with an identical search',
    'მოწმდება იდენტურ ძიებასთან ერთად',
    'Проверяется вместе с идентичным поиском',
    'Aynı aramayla birlikte kontrol ediliyor',
    'يُفحص مع بحث مطابق',
    'נבדק יחד עם חיפוש זהה',
  ],
  mps_live_limited_concurrent: [
    'You already have {{n}} live searches running. This one shows listings HOMATCH already checked; a live check starts again when one of them finishes.',
    'უკვე მიმდინარეობს თქვენი {{n}} ცოცხალი ძიება. ეს ძიება აჩვენებს HOMATCH-ის მიერ უკვე შემოწმებულ განცხადებებს; ცოცხალი შემოწმება ხელახლა დაიწყება, როცა ერთ-ერთი დასრულდება.',
    'У вас уже идут живые поиски: {{n}}. Здесь показаны объявления, которые HOMATCH уже проверил; живая проверка снова станет доступна, когда один из них завершится.',
    'Zaten {{n}} canlı aramanız sürüyor. Bu arama HOMATCH\'in daha önce kontrol ettiği ilanları gösteriyor; biri bittiğinde canlı kontrol yeniden başlar.',
    'لديك بالفعل عمليات بحث مباشرة قيد التشغيل: {{n}}. يعرض هذا البحث إعلانات سبق أن تحقق منها HOMATCH؛ يعود التحقق المباشر عند انتهاء إحداها.',
    'כבר פועלים אצלכם חיפושים חיים: {{n}}. חיפוש זה מציג מודעות ש-HOMATCH כבר בדק; בדיקה חיה תתחדש כשאחד מהם יסתיים.',
  ],
  mps_live_limited_until: [
    'You\'ve reached your live check limit. Showing listings HOMATCH already checked; live checks are available again at {{time}}.',
    'ცოცხალი შემოწმების ლიმიტი ამოიწურა. ნაჩვენებია HOMATCH-ის მიერ უკვე შემოწმებული განცხადებები; ცოცხალი შემოწმება ხელმისაწვდომი იქნება {{time}}-დან.',
    'Лимит живых проверок исчерпан. Показаны объявления, уже проверенные HOMATCH; живые проверки снова доступны в {{time}}.',
    'Canlı kontrol sınırınıza ulaştınız. HOMATCH\'in daha önce kontrol ettiği ilanlar gösteriliyor; canlı kontrol {{time}} itibarıyla yeniden kullanılabilir.',
    'لقد بلغت حد التحقق المباشر. تُعرض الإعلانات التي سبق أن تحقق منها HOMATCH؛ يتوفر التحقق المباشر مجددًا عند {{time}}.',
    'הגעתם למגבלת הבדיקות החיות. מוצגות מודעות ש-HOMATCH כבר בדק; בדיקות חיות יחזרו בשעה {{time}}.',
  ],
  mps_live_limited: [
    'You\'ve reached your live check limit. Showing listings HOMATCH already checked.',
    'ცოცხალი შემოწმების ლიმიტი ამოიწურა. ნაჩვენებია HOMATCH-ის მიერ უკვე შემოწმებული განცხადებები.',
    'Лимит живых проверок исчерпан. Показаны объявления, уже проверенные HOMATCH.',
    'Canlı kontrol sınırınıza ulaştınız. HOMATCH\'in daha önce kontrol ettiği ilanlar gösteriliyor.',
    'لقد بلغت حد التحقق المباشر. تُعرض الإعلانات التي سبق أن تحقق منها HOMATCH.',
    'הגעתם למגבלת הבדיקות החיות. מוצגות מודעות ש-HOMATCH כבר בדק.',
  ],
  mps_live_busy_until: [
    'The portals are busy right now. Showing listings HOMATCH already checked; try a live check again at {{time}}.',
    'პორტალები ახლა დაკავებულია. ნაჩვენებია HOMATCH-ის მიერ უკვე შემოწმებული განცხადებები; ცოცხალი შემოწმება ხელახლა სცადეთ {{time}}-ზე.',
    'Порталы сейчас загружены. Показаны объявления, уже проверенные HOMATCH; повторите живую проверку в {{time}}.',
    'Portallar şu anda yoğun. HOMATCH\'in daha önce kontrol ettiği ilanlar gösteriliyor; canlı kontrolü {{time}} saatinde yeniden deneyin.',
    'البوابات مشغولة الآن. تُعرض الإعلانات التي سبق أن تحقق منها HOMATCH؛ أعد محاولة التحقق المباشر عند {{time}}.',
    'הפורטלים עמוסים כרגע. מוצגות מודעות ש-HOMATCH כבר בדק; נסו בדיקה חיה שוב בשעה {{time}}.',
  ],
  mps_live_busy: [
    'The portals are busy right now. Showing listings HOMATCH already checked.',
    'პორტალები ახლა დაკავებულია. ნაჩვენებია HOMATCH-ის მიერ უკვე შემოწმებული განცხადებები.',
    'Порталы сейчас загружены. Показаны объявления, уже проверенные HOMATCH.',
    'Portallar şu anda yoğun. HOMATCH\'in daha önce kontrol ettiği ilanlar gösteriliyor.',
    'البوابات مشغولة الآن. تُعرض الإعلانات التي سبق أن تحقق منها HOMATCH.',
    'הפורטלים עמוסים כרגע. מוצגות מודעות ש-HOMATCH כבר בדק.',
  ],
  mps_live_unavailable: [
    'Live checks are temporarily unavailable. Showing listings HOMATCH already checked.',
    'ცოცხალი შემოწმება დროებით მიუწვდომელია. ნაჩვენებია HOMATCH-ის მიერ უკვე შემოწმებული განცხადებები.',
    'Живые проверки временно недоступны. Показаны объявления, уже проверенные HOMATCH.',
    'Canlı kontrol geçici olarak kullanılamıyor. HOMATCH\'in daha önce kontrol ettiği ilanlar gösteriliyor.',
    'التحقق المباشر غير متاح مؤقتًا. تُعرض الإعلانات التي سبق أن تحقق منها HOMATCH.',
    'בדיקות חיות אינן זמינות זמנית. מוצגות מודעות ש-HOMATCH כבר בדק.',
  ],
  mps_reused_recent: ['You ran this exact search a few minutes ago — here are its results.', 'ზუსტად ეს ძიება რამდენიმე წუთის წინ ჩაატარეთ, აი მისი შედეგები.', 'Вы выполняли точно такой же поиск несколько минут назад — вот его результаты.', 'Bu aramanın aynısını birkaç dakika önce yaptınız — sonuçları burada.', 'أجريت هذا البحث نفسه قبل دقائق — إليك نتائجه.', 'הרצתם בדיוק את החיפוש הזה לפני כמה דקות — הנה התוצאות שלו.'],
};
