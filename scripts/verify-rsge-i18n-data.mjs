/*
 * Copy for the RS.ge taxpayer-registry row of the Verify report's company
 * finance card (2026-10-11): every field RS.ge returned, labelled; the
 * check date and where to repeat it; neutral copy for a check that is
 * pending, unavailable or failed.
 *
 * Order is en, ka, ru, tr, ar, he — LANGS in lib/i18nSplice.mjs.
 * {{id}} survives in every locale.
 *
 * RS_STRINGS are new keys. RS_REPLACED_STRINGS overwrite an existing key on
 * purpose: vbi_fin_tax_explain used to say the company is "in good standing
 * with the tax authority". The taxpayer registry shows registration details;
 * it does not prove the absence of arrears, so the copy now states only what
 * RS.ge literally returned.
 */
export const RS_STRINGS = {
  vbi_rs_name: ['Name', 'დასახელება', 'Наименование', 'Unvan', 'الاسم', 'שם'],
  vbi_rs_id: ['Identification code', 'საიდენტიფიკაციო კოდი', 'Идентификационный код', 'Kimlik kodu', 'رمز التعريف', 'מספר מזהה'],
  vbi_rs_legal_form: ['Legal form', 'სამართლებრივი ფორმა', 'Организационно-правовая форма', 'Hukuki şekil', 'الشكل القانوني', 'צורה משפטית'],
  vbi_rs_registered: ['Registration date', 'რეგისტრაციის თარიღი', 'Дата регистрации', 'Kayıt tarihi', 'تاريخ التسجيل', 'תאריך רישום'],
  vbi_rs_vat: ['VAT payer', 'დღგ-ს გადამხდელი', 'Плательщик НДС', 'KDV mükellefi', 'مسجل في ضريبة القيمة المضافة', 'עוסק מורשה במע״מ'],
  vbi_rs_address: ['Address', 'მისამართი', 'Адрес', 'Adres', 'العنوان', 'כתובת'],
  vbi_rs_yes: ['Yes', 'კი', 'Да', 'Evet', 'نعم', 'כן'],
  vbi_rs_no: ['No', 'არა', 'Нет', 'Hayır', 'لا', 'לא'],
  vbi_rs_record_found: [
    'Listed in the taxpayer registry',
    'გადასახადის გადამხდელთა რეესტრში ფიქსირდება',
    'Значится в реестре налогоплательщиков',
    'Vergi mükellefleri sicilinde kayıtlı',
    'مدرجة في سجل دافعي الضرائب',
    'רשומה במרשם משלמי המסים',
  ],
  vbi_rs_status_caution: [
    'The status the registry shows for the company needs attention — check it before any transaction.',
    'რეესტრში მითითებული კომპანიის სტატუსი ყურადღებას საჭიროებს — გარიგებამდე გადაამოწმეთ.',
    'Статус компании в реестре требует внимания — проверьте его до любой сделки.',
    'Sicilde şirket için gösterilen durum dikkat gerektiriyor — herhangi bir işlemden önce kontrol edin.',
    'الحالة التي يُظهرها السجل للشركة تستدعي الانتباه — تحقّقوا منها قبل أي معاملة.',
    'הסטטוס שהמרשם מציג לחברה דורש תשומת לב — בדקו אותו לפני כל עסקה.',
  ],
  vbi_rs_no_record: [
    'No record returned for this identifier',
    'ამ კოდით ჩანაწერი არ დაბრუნდა',
    'По этому коду запись не возвращена',
    'Bu kod için kayıt dönmedi',
    'لم يُرجَع أي سجل لهذا الرمز',
    'לא הוחזרה רשומה עבור מזהה זה',
  ],
  vbi_rs_no_record_explain: [
    'The Revenue Service taxpayer registry returned no record for company ID {{id}} on the date shown. On its own this is neither a good nor a bad sign; it is worth confirming the identifier with the company.',
    'შემოსავლების სამსახურის გადასახადის გადამხდელთა რეესტრმა საიდენტიფიკაციო კოდით {{id}} მითითებულ თარიღში ჩანაწერი არ დააბრუნა. ეს თავისთავად არც დადებითი ნიშანია და არც უარყოფითი; სასურველია კოდი კომპანიასთან დააზუსტოთ.',
    'Реестр налогоплательщиков Службы доходов не вернул запись по коду {{id}} на указанную дату. Само по себе это ни хороший, ни плохой знак; код стоит уточнить у компании.',
    'Gelir İdaresi vergi mükellefleri sicili, gösterilen tarihte {{id}} şirket kodu için kayıt döndürmedi. Bu tek başına ne olumlu ne olumsuz bir işarettir; kodu şirketle teyit etmeniz önerilir.',
    'لم يُرجع سجل دافعي الضرائب لدى مصلحة الإيرادات أي سجل لرمز الشركة {{id}} في التاريخ المبيّن. هذا بحد ذاته ليس مؤشرًا إيجابيًا ولا سلبيًا؛ يُستحسن التأكد من الرمز مع الشركة.',
    'מרשם משלמי המסים של רשות ההכנסות לא החזיר רשומה עבור מספר החברה {{id}} בתאריך המצוין. כשלעצמו זה אינו סימן טוב ואינו סימן רע; מומלץ לאמת את המספר מול החברה.',
  ],
  vbi_rs_source_link: ['Check on rs.ge', 'გადაამოწმეთ rs.ge-ზე', 'Проверить на rs.ge', 'rs.ge üzerinde kontrol edin', 'تحقّقوا على rs.ge', 'בדקו ב-rs.ge'],
  vbi_rs_state_pending: ['Awaiting verification', 'ვერიფიკაციას ელოდება', 'Ожидает проверки', 'Doğrulama bekleniyor', 'بانتظار التحقق', 'ממתין לאימות'],
  vbi_rs_state_pending_explain: [
    'The Revenue Service check needs an extra verification step and has not been completed in this research. This is neither a good nor a bad sign — you can check it on rs.ge with company ID {{id}}.',
    'შემოსავლების სამსახურის შემოწმებას დამატებითი ვერიფიკაცია სჭირდება და ამ კვლევაში არ დასრულებულა. ეს არც დადებითი ნიშანია და არც უარყოფითი — rs.ge-ზე შეამოწმებთ საიდენტიფიკაციო კოდით {{id}}.',
    'Проверке в Службе доходов нужен дополнительный шаг подтверждения, и в этом исследовании она не завершена. Это ни хороший, ни плохой знак — проверить можно на rs.ge по коду {{id}}.',
    'Gelir İdaresi kontrolü ek bir doğrulama adımı gerektiriyor ve bu araştırmada tamamlanmadı. Bu ne olumlu ne olumsuz bir işarettir — rs.ge üzerinde {{id}} şirket koduyla kontrol edebilirsiniz.',
    'يتطلب فحص مصلحة الإيرادات خطوة تحقق إضافية ولم يكتمل في هذا البحث. هذا ليس مؤشرًا إيجابيًا ولا سلبيًا — يمكنكم التحقق على rs.ge برمز الشركة {{id}}.',
    'בדיקת רשות ההכנסות דורשת שלב אימות נוסף ולא הושלמה במחקר זה. זה אינו סימן טוב ואינו סימן רע — אפשר לבדוק ב-rs.ge עם מספר החברה {{id}}.',
  ],
  vbi_rs_state_unavailable: ['Temporarily unavailable', 'დროებით მიუწვდომელია', 'Временно недоступно', 'Geçici olarak kullanılamıyor', 'غير متاح مؤقتًا', 'לא זמין זמנית'],
  vbi_rs_state_unavailable_explain: [
    'The Revenue Service registry did not respond during this research. This is neither a good nor a bad sign — you can check it on rs.ge with company ID {{id}}.',
    'შემოსავლების სამსახურის რეესტრმა ამ კვლევის დროს არ უპასუხა. ეს არც დადებითი ნიშანია და არც უარყოფითი — rs.ge-ზე შეამოწმებთ საიდენტიფიკაციო კოდით {{id}}.',
    'Реестр Службы доходов не ответил во время этого исследования. Это ни хороший, ни плохой знак — проверить можно на rs.ge по коду {{id}}.',
    'Gelir İdaresi sicili bu araştırma sırasında yanıt vermedi. Bu ne olumlu ne olumsuz bir işarettir — rs.ge üzerinde {{id}} şirket koduyla kontrol edebilirsiniz.',
    'لم يستجب سجل مصلحة الإيرادات خلال هذا البحث. هذا ليس مؤشرًا إيجابيًا ولا سلبيًا — يمكنكم التحقق على rs.ge برمز الشركة {{id}}.',
    'מרשם רשות ההכנסות לא הגיב במהלך מחקר זה. זה אינו סימן טוב ואינו סימן רע — אפשר לבדוק ב-rs.ge עם מספר החברה {{id}}.',
  ],
  vbi_rs_state_failed: ['Could not be verified', 'ვერ გადამოწმდა', 'Не удалось проверить', 'Doğrulanamadı', 'تعذّر التحقق', 'לא ניתן היה לאמת'],
  vbi_rs_state_failed_explain: [
    'The Revenue Service check could not be completed automatically in this research. This is neither a good nor a bad sign — you can check it on rs.ge with company ID {{id}}.',
    'შემოსავლების სამსახურის შემოწმება ამ კვლევაში ავტომატურად ვერ დასრულდა. ეს არც დადებითი ნიშანია და არც უარყოფითი — rs.ge-ზე შეამოწმებთ საიდენტიფიკაციო კოდით {{id}}.',
    'Проверку в Службе доходов не удалось завершить автоматически в этом исследовании. Это ни хороший, ни плохой знак — проверить можно на rs.ge по коду {{id}}.',
    'Gelir İdaresi kontrolü bu araştırmada otomatik olarak tamamlanamadı. Bu ne olumlu ne olumsuz bir işarettir — rs.ge üzerinde {{id}} şirket koduyla kontrol edebilirsiniz.',
    'تعذّر إكمال فحص مصلحة الإيرادات تلقائيًا في هذا البحث. هذا ليس مؤشرًا إيجابيًا ولا سلبيًا — يمكنكم التحقق على rs.ge برمز الشركة {{id}}.',
    'לא ניתן היה להשלים אוטומטית את בדיקת רשות ההכנסות במחקר זה. זה אינו סימן טוב ואינו סימן רע — אפשר לבדוק ב-rs.ge עם מספר החברה {{id}}.',
  ],
};

export const RS_REPLACED_STRINGS = {
  vbi_fin_tax_explain: [
    'This is what the Revenue Service taxpayer registry returned for the company on the date shown. The registry shows registration details only — it does not show whether the company has tax arrears.',
    'ეს არის ის, რაც შემოსავლების სამსახურის გადასახადის გადამხდელთა რეესტრმა კომპანიაზე მითითებულ თარიღში დააბრუნა. რეესტრი მხოლოდ სარეგისტრაციო მონაცემებს აჩვენებს — საგადასახადო დავალიანების არსებობა-არარსებობას ის არ აჩვენებს.',
    'Это то, что реестр налогоплательщиков Службы доходов вернул по компании на указанную дату. Реестр показывает только регистрационные данные — наличие или отсутствие налоговой задолженности он не показывает.',
    'Bu, Gelir İdaresi vergi mükellefleri sicilinin gösterilen tarihte şirket için döndürdüğü bilgidir. Sicil yalnızca kayıt bilgilerini gösterir — şirketin vergi borcu olup olmadığını göstermez.',
    'هذا ما أرجعه سجل دافعي الضرائب لدى مصلحة الإيرادات عن الشركة في التاريخ المبيّن. يعرض السجل بيانات التسجيل فقط — ولا يبيّن ما إذا كانت على الشركة متأخرات ضريبية.',
    'זה מה שמרשם משלמי המסים של רשות ההכנסות החזיר לגבי החברה בתאריך המצוין. המרשם מציג פרטי רישום בלבד — הוא אינו מראה אם לחברה יש חובות מס.',
  ],
};
