import { splice, validate } from './lib/i18nSplice.mjs';
const strings = {
  fpw_property_unavailable: ['This property could not be loaded. Reopen the search or try again.', 'ამ ქონების ჩატვირთვა ვერ მოხერხდა. გახსენი ძიება ან სცადე ხელახლა.', 'Не удалось загрузить объект. Откройте поиск или повторите попытку.', 'Bu mülk yüklenemedi. Aramayı yeniden açın veya tekrar deneyin.', 'تعذّر تحميل هذا العقار. أعد فتح البحث أو حاول مجدداً.', 'לא ניתן לטעון את הנכס הזה. פתחו מחדש את החיפוש או נסו שוב.'],
  fpw_ai_pending: ['This paid response is still processing. Wait briefly and retry; it will use the same turn.', 'ფასიანი პასუხი ჯერ მუშავდება. ცოტა ხანში სცადე ხელახლა; იგივე მოთხოვნა გამოიყენება.', 'Этот оплаченный ответ ещё обрабатывается. Немного подождите и повторите; будет использован тот же запрос.', 'Bu ücretli yanıt hâlâ işleniyor. Biraz bekleyip tekrar deneyin; aynı istek kullanılacak.', 'هذه الإجابة المدفوعة لا تزال قيد المعالجة. انتظر قليلاً وأعد المحاولة؛ سيُستخدم الطلب نفسه.', 'התשובה בתשלום עדיין בעיבוד. המתינו מעט ונסו שוב; ייעשה שימוש באותה בקשה.'],
  fpw_seller_owner: ['Owner', 'მესაკუთრე', 'Собственник', 'Mal sahibi', 'المالك', 'בעלים'],
  fpw_seller_likely_owner: ['Likely owner', 'სავარაუდოდ მესაკუთრე', 'Вероятно, собственник', 'Muhtemelen mal sahibi', 'مالك محتمل', 'כנראה הבעלים'],
  fpw_seller_broker_agency: ['Broker / agency', 'ბროკერი / სააგენტო', 'Брокер / агентство', 'Emlakçı / emlak ofisi', 'وسيط / وكالة', 'מתווך / סוכנות'],
  fpw_ai_usage: ['{{used}} Credits used · {{remaining}} remaining', 'გამოყენებულია {{used}} Credits · დარჩენილია {{remaining}}', 'Использовано {{used}} Credits · осталось {{remaining}}', '{{used}} Credits kullanıldı · {{remaining}} kaldı', 'تم استخدام {{used}} Credits · المتبقي {{remaining}}', 'נוצלו {{used}} Credits · נותרו {{remaining}}'],
  fpw_over_budget: ['{{amount}} above your maximum budget (+{{pct}})', 'მაქსიმალურ ბიუჯეტზე {{amount}}-ით მეტი (+{{pct}})', '{{amount}} выше максимального бюджета (+{{pct}})', 'Azami bütçenizin {{amount}} üzerinde (+{{pct}})', '{{amount}} فوق الحد الأقصى لميزانيتك (+{{pct}})', '{{amount}} מעל התקציב המרבי (+{{pct}})'],
  fpw_listing_count: ['{{n}} listings', '{{n}} განცხადება', '{{n}} объявлений', '{{n}} ilan', '{{n}} إعلانات', '{{n}} מודעות'],
  fpw_ai_working: ['Analysing…', 'ანალიზი მიმდინარეობს…', 'Анализ…', 'Analiz ediliyor…', 'جارٍ التحليل…', 'מנתח…'],
  fpw_ai_insufficient: ['Not enough Credits. Your question is preserved; add Credits to continue.', 'Credits არასაკმარისია. კითხვა შენახულია; გასაგრძელებლად შეავსე Credits.', 'Недостаточно Credits. Вопрос сохранён; пополните Credits для продолжения.', 'Yeterli Credits yok. Sorunuz korunur; devam etmek için Credits ekleyin.', 'Credits غير كافية. سؤالك محفوظ؛ أضف Credits للمتابعة.', 'אין מספיק Credits. השאלה נשמרת; הוסיפו Credits כדי להמשיך.'],
  fpw_ai_question: ['Your question about this property', 'შენი კითხვა ამ ქონებაზე', 'Ваш вопрос об этом объекте', 'Bu mülk hakkındaki sorunuz', 'سؤالك عن هذا العقار', 'השאלה שלכם על הנכס הזה'],
  fpw_ai_send: ['Send · uses Credits', 'გაგზავნა · იყენებს Credits-ს', 'Отправить · использует Credits', 'Gönder · Credits kullanır', 'إرسال · يستخدم Credits', 'שליחה · משתמש ב-Credits'],
  fpw_prompt_value: ['Is the asking price supported by the available evidence?', 'ამ ფასს არსებული მტკიცებულებები ამყარებს?', 'Подтверждают ли имеющиеся данные запрашиваемую цену?', 'Mevcut kanıtlar istenen fiyatı destekliyor mu?', 'هل تدعم الأدلة المتاحة السعر المطلوب؟', 'האם הראיות הזמינות תומכות במחיר המבוקש?'],
  fpw_prompt_risks: ['What are the main risks and unknowns?', 'რა არის მთავარი რისკები და უცნობი ფაქტები?', 'Каковы основные риски и неизвестные?', 'Başlıca riskler ve bilinmeyenler neler?', 'ما أهم المخاطر والمعلومات المجهولة؟', 'מהם הסיכונים העיקריים והמידע החסר?'],
  fpw_prompt_questions: ['What should I ask the seller before buying?', 'რა ვკითხო გამყიდველს შეძენამდე?', 'Что спросить у продавца перед покупкой?', 'Satın almadan önce satıcıya ne sormalıyım?', 'ماذا أسأل البائع قبل الشراء؟', 'מה כדאי לשאול את המוכר לפני רכישה?'],
  fpw_prompt_renovation: ['What information is needed to estimate renovation and total cost?', 'რა ინფორმაცია გვჭირდება რემონტისა და ჯამური ხარჯის შესაფასებლად?', 'Какие данные нужны для оценки ремонта и общей стоимости?', 'Tadilat ve toplam maliyet tahmini için hangi bilgiler gerekli?', 'ما المعلومات اللازمة لتقدير التجديد والتكلفة الإجمالية؟', 'איזה מידע דרוש להערכת השיפוץ והעלות הכוללת?'],
  fpw_history: ['Search history', 'ძიებების ისტორია', 'История поиска', 'Arama geçmişi', 'سجل البحث', 'היסטוריית חיפושים'],
  fpw_history_note: ['Saved searches remain available. Counts reflect the last completed processing; reopen to see current eligible results.', 'შენახული ძიებები ხელმისაწვდომია. რაოდენობა ბოლო დამუშავებას ასახავს; მიმდინარე შედეგებისთვის გახსენი ძიება.', 'Поиски сохраняются. Количество отражает последнюю обработку; откройте поиск для актуальных результатов.', 'Aramalar saklanır. Sayılar son işlemeyi yansıtır; güncel sonuçlar için aramayı açın.', 'تظل عمليات البحث محفوظة. الأعداد تعكس آخر معالجة؛ افتح البحث لرؤية النتائج الحالية.', 'החיפושים נשמרים. הספירות משקפות את העיבוד האחרון; פתחו חיפוש לצפייה בתוצאות העדכניות.'],
  fpw_history_empty: ['Your searches will appear here.', 'შენი ძიებები აქ გამოჩნდება.', 'Ваши поиски появятся здесь.', 'Aramalarınız burada görünecek.', 'ستظهر عمليات بحثك هنا.', 'החיפושים שלכם יופיעו כאן.'],
  fpw_saved_properties: ['{{n}} saved unique properties', '{{n}} შენახული უნიკალური ქონება', '{{n}} сохранённых уникальных объектов', '{{n}} kayıtlı benzersiz mülk', '{{n}} عقارات فريدة محفوظة', '{{n}} נכסים ייחודיים שמורים'],
  fpw_saved_strong: ['{{n}} strong matches', '{{n}} ძლიერი დამთხვევა', '{{n}} точных совпадений', '{{n}} güçlü eşleşme', '{{n}} تطابقات قوية', '{{n}} התאמות חזקות'],
  fpw_open_search: ['View search', 'ძიების ნახვა', 'Открыть поиск', 'Aramayı görüntüle', 'عرض البحث', 'צפייה בחיפוש'],
  fpw_retry: ['Try again', 'ხელახლა ცდა', 'Повторить', 'Tekrar dene', 'حاول مجدداً', 'נסו שוב'],
  fpw_back_results: ['Back to results', 'შედეგებზე დაბრუნება', 'Вернуться к результатам', 'Sonuçlara dön', 'العودة إلى النتائج', 'חזרה לתוצאות'],
  fpw_open_property: ['View property', 'ქონების ნახვა', 'Открыть объект', 'Mülkü görüntüle', 'عرض العقار', 'צפייה בנכס'],
  fpw_open_gallery: ['Open property photos and details', 'ქონების ფოტოებისა და დეტალების გახსნა', 'Открыть фото и сведения об объекте', 'Mülk fotoğraflarını ve ayrıntılarını aç', 'فتح صور العقار وتفاصيله', 'פתיחת תמונות ופרטי הנכס'],
  fpw_previous_photo: ['Previous photo', 'წინა ფოტო', 'Предыдущее фото', 'Önceki fotoğraf', 'الصورة السابقة', 'התמונה הקודמת'],
  fpw_next_photo: ['Next photo', 'შემდეგი ფოტო', 'Следующее фото', 'Sonraki fotoğraf', 'الصورة التالية', 'התמונה הבאה'],
  fpw_photo: ['Photo {{n}}', 'ფოტო {{n}}', 'Фото {{n}}', 'Fotoğraf {{n}}', 'الصورة {{n}}', 'תמונה {{n}}'],
  fpw_ai: ['AI Property Analysis', 'ქონების AI ანალიზი', 'AI-анализ объекта', 'AI mülk analizi', 'تحليل العقار بالذكاء الاصطناعي', 'ניתוח נכס באמצעות AI'],
  fpw_ai_credits: ['Uses Credits through AI Chat. Each response is billed by measured usage.', 'იყენებს Credits-ს AI ჩატის მეშვეობით. თითოეული პასუხი ფაქტობრივი გამოყენებით ფასდება.', 'Использует Credits через AI-чат. Ответ оплачивается по фактическому использованию.', 'AI sohbet üzerinden Credits kullanır. Her yanıt ölçülen kullanıma göre ücretlendirilir.', 'يستخدم Credits عبر محادثة AI. تُحسب تكلفة كل إجابة وفق الاستخدام الفعلي.', 'משתמש ב-Credits דרך צ׳אט AI. כל תשובה מחויבת לפי השימוש שנמדד.'],
};
const statuses = {
  CREATED: ['Queued', 'რიგშია', 'В очереди', 'Sırada', 'في الانتظار', 'בתור'],
  READY: ['Queued', 'რიგშია', 'В очереди', 'Sırada', 'في الانتظار', 'בתור'],
  DISPATCHING: ['Starting', 'იწყება', 'Запускается', 'Başlatılıyor', 'جارٍ البدء', 'מתחיל'],
  SEARCHING: ['Searching', 'მიმდინარეობს ძიება', 'Идёт поиск', 'Aranıyor', 'جارٍ البحث', 'בחיפוש'],
  PROCESSING: ['Processing results', 'შედეგების დამუშავება', 'Обработка результатов', 'Sonuçlar işleniyor', 'جارٍ معالجة النتائج', 'מעבד תוצאות'],
  RESULTS_AVAILABLE: ['Results available; search continues', 'შედეგები ხელმისაწვდომია; ძიება გრძელდება', 'Есть результаты; поиск продолжается', 'Sonuçlar hazır; arama sürüyor', 'النتائج متاحة؛ البحث مستمر', 'תוצאות זמינות; החיפוש נמשך'],
  COMPLETE: ['Completed', 'დასრულებულია', 'Завершён', 'Tamamlandı', 'مكتمل', 'הושלם'],
  PARTIAL_COMPLETE: ['Partially completed', 'ნაწილობრივ დასრულებულია', 'Частично завершён', 'Kısmen tamamlandı', 'مكتمل جزئياً', 'הושלם חלקית'],
  FAILED: ['Search unavailable', 'ძიება მიუწვდომელია', 'Поиск недоступен', 'Arama kullanılamıyor', 'البحث غير متاح', 'החיפוש אינו זמין'],
  CANCELLED: ['Cancelled', 'გაუქმებულია', 'Отменён', 'İptal edildi', 'ملغى', 'בוטל'],
};
for (const [status, labels] of Object.entries(statuses)) strings[`fpw_status_${status}`] = labels;
const problems = validate(strings, 'find-property-workspace');
if (problems.length) throw new Error(problems.join('\n'));
const result = splice(new URL('../src/i18n/translations.ts', import.meta.url), strings, { banner: 'FIND PROPERTY WORKSPACE', tag: 'find-property-workspace', overwrite: process.argv.includes('--overwrite') });
if (result.collisions.length) throw new Error(result.collisions.join(', '));
console.log(`${result.added} workspace strings added.`);
