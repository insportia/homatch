/*
 * Copy for the live Verify job page (owner live run 2026-10-11):
 * the truthful stop warning, the live credits panel and the live
 * "what we have so far" panel.
 *
 * Order is en, ka, ru, tr, ar, he — LANGS in lib/i18nSplice.mjs.
 * The three verify_pause_confirm_* keys REPLACE earlier copy (--overwrite):
 * stopping ends the research at once, it does not continue in the
 * background, spent credits are not refunded and the result is incomplete.
 */
export const VERIFY_LIVE_STRINGS = {
  verify_pause_confirm_title: ['Stop the research now?', 'შევწყვიტოთ კვლევა ახლავე?', 'Остановить исследование сейчас?', 'Araştırma şimdi durdurulsun mu?', 'إيقاف البحث الآن؟', 'לעצור את המחקר עכשיו?'],
  verify_pause_confirm_body: [
    'The research stops immediately and does not continue in the background. Credits already used are not refunded, and the result will be incomplete — only what was found up to this moment. Credits not yet used return to your balance.',
    'კვლევა მაშინვე წყდება და ფონურ რეჟიმში აღარ გაგრძელდება. უკვე დახარჯული კრედიტები არ ბრუნდება, შედეგი კი არასრული იქნება — მხოლოდ ის, რაც ამ მომენტამდე მოვიძიეთ. ჯერ გამოუყენებელი კრედიტები ბალანსზე დაგიბრუნდებათ.',
    'Исследование остановится сразу и не продолжится в фоновом режиме. Уже израсходованные кредиты не возвращаются, а результат будет неполным — только то, что найдено к этому моменту. Ещё не использованные кредиты вернутся на баланс.',
    'Araştırma hemen durur ve arka planda devam etmez. Kullanılmış krediler iade edilmez ve sonuç eksik olur — yalnızca bu ana kadar bulunanlar. Henüz kullanılmamış krediler bakiyenize döner.',
    'يتوقف البحث فورًا ولا يستمر في الخلفية. لا تُسترد الأرصدة المستخدمة، وستكون النتيجة غير مكتملة — فقط ما وُجد حتى هذه اللحظة. تعود الأرصدة غير المستخدمة بعد إلى رصيدك.',
    'המחקר נעצר מיד ואינו ממשיך ברקע. קרדיטים שכבר נוצלו אינם מוחזרים, והתוצאה תהיה חלקית — רק מה שנמצא עד לרגע זה. קרדיטים שטרם נוצלו חוזרים ליתרה.',
  ],
  verify_pause_confirm_stop: ['Yes, stop now', 'დიახ, შეწყვიტე', 'Да, остановить', 'Evet, durdur', 'نعم، أوقف الآن', 'כן, לעצור עכשיו'],
  verify_stop_warning: [
    'Stopping ends the research at once — nothing continues in the background. Credits already used are not refunded and the report will be incomplete.',
    'შეწყვეტისას კვლევა მაშინვე სრულდება — ფონურ რეჟიმში აღარაფერი გაგრძელდება. დახარჯული კრედიტები არ ბრუნდება, ანგარიში კი არასრული იქნება.',
    'Остановка сразу завершает исследование — в фоне ничего не продолжится. Израсходованные кредиты не возвращаются, а отчёт будет неполным.',
    'Durdurmak araştırmayı hemen bitirir — arka planda hiçbir şey devam etmez. Kullanılmış krediler iade edilmez ve rapor eksik olur.',
    'الإيقاف ينهي البحث فورًا — لا يستمر شيء في الخلفية. لا تُسترد الأرصدة المستخدمة وسيكون التقرير غير مكتمل.',
    'עצירה מסיימת את המחקר מיד — דבר אינו ממשיך ברקע. קרדיטים שנוצלו אינם מוחזרים והדוח יהיה חלקי.',
  ],
  verify_budget_live: ['Credits, live', 'კრედიტები რეალურ დროში', 'Кредиты в реальном времени', 'Krediler, canlı', 'الأرصدة مباشرة', 'קרדיטים בזמן אמת'],
  verify_budget_reserved: ['Reserved for this research: {{n}} credits', 'ამ კვლევისთვის დარეზერვებულია {{n}} კრედიტი', 'Зарезервировано для исследования: {{n}} кредитов', 'Bu araştırma için ayrılan: {{n}} kredi', 'المحجوز لهذا البحث: {{n}} رصيد', 'שמורים למחקר זה: {{n}} קרדיטים'],
  verify_sections_progress: ['{{done}} of {{total}} ready', '{{total}}-დან მზადაა {{done}}', 'Готово {{done}} из {{total}}', '{{total}} bölümden {{done}} hazır', '{{done}} من {{total}} جاهزة', '{{done}} מתוך {{total}} מוכנים'],
  verify_live_src_TAS_MAP: ['City map (TAS)', 'ქალაქის რუკა (TAS)', 'Карта города (TAS)', 'Şehir haritası (TAS)', 'خريطة المدينة (TAS)', 'מפת העיר (TAS)'],
  verify_live_src_tas: ['Construction permit cases (TAS)', 'სამშენებლო ნებართვის საქმეები (TAS)', 'Дела о разрешениях на строительство (TAS)', 'İnşaat izni dosyaları (TAS)', 'ملفات تصاريح البناء (TAS)', 'תיקי היתרי בנייה (TAS)'],
  verify_live_src_mygov: ['Public Registry extract (MyGov)', 'საჯარო რეესტრის ამონაწერი (MyGov)', 'Выписка из Публичного реестра (MyGov)', 'Kamu Sicili özeti (MyGov)', 'مستخرج السجل العام (MyGov)', 'נסח מהמרשם הציבורי (MyGov)'],
  verify_live_state_queued: ['Waiting', 'რიგშია', 'В очереди', 'Sırada', 'في الانتظار', 'ממתין'],
  verify_live_state_running: ['In progress', 'მიმდინარეობს', 'Выполняется', 'Sürüyor', 'قيد التنفيذ', 'בתהליך'],
  verify_live_state_done: ['Received', 'მიღებულია', 'Получено', 'Alındı', 'تم الاستلام', 'התקבל'],
  verify_live_state_unavailable: ['Not available', 'მიუწვდომელია', 'Недоступно', 'Erişilemedi', 'غير متاح', 'לא זמין'],
};
