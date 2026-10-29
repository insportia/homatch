/*
 * Verify: one fixed price and 30-day report validity (20261127090000).
 * Customer launch / running / summary / expired copy, and the Admin price card.
 *
 * Order is en, ka, ru, tr, ar, he — LANGS in lib/i18nSplice.mjs.
 * {{n}}, {{usd}} and {{days}} survive in every locale.
 */
export const VERIFY_FIXED_PRICE_STRINGS = {
  verify_price_label: ['Price', 'ფასი', 'Цена', 'Fiyat', 'السعر', 'מחיר'],
  verify_price_note: ['One fixed price, VAT included. It is charged only when your report is ready — a stopped or failed check costs nothing. Your report stays available for {{days}} days.', 'ერთი ფიქსირებული ფასი, დღგ-ს ჩათვლით. თანხა ჩამოიჭრება მხოლოდ მაშინ, როცა ანგარიში მზად იქნება, შეჩერებული ან წარუმატებელი შემოწმება არაფერი ღირს. ანგარიში ხელმისაწვდომი იქნება {{days}} დღის განმავლობაში.', 'Одна фиксированная цена с НДС. Списывается только когда отчёт готов — остановленная или неудачная проверка ничего не стоит. Отчёт доступен {{days}} дней.', 'KDV dahil tek sabit fiyat. Yalnızca raporunuz hazır olduğunda tahsil edilir — durdurulan veya başarısız bir kontrol ücretsizdir. Raporunuz {{days}} gün erişilebilir kalır.', 'سعر ثابت واحد شامل ضريبة القيمة المضافة. يُخصم فقط عندما يصبح تقريرك جاهزًا — الفحص الذي يتوقف أو يفشل لا يكلّف شيئًا. يبقى تقريرك متاحًا لمدة {{days}} يومًا.', 'מחיר קבוע אחד, כולל מע״מ. הוא נגבה רק כשהדוח שלך מוכן — בדיקה שנעצרה או נכשלה אינה עולה דבר. הדוח שלך נשאר זמין למשך {{days}} ימים.'],
  verify_price_changed: [
    'The price has changed to {{n}} credits. Please confirm the new price to start.',
    'ფასი შეიცვალა და გახდა {{n}} კრედიტი. დასაწყებად დაადასტურეთ ახალი ფასი.',
    'Цена изменилась на {{n}} кредитов. Подтвердите новую цену, чтобы начать.',
    'Fiyat {{n}} krediye değişti. Başlamak için lütfen yeni fiyatı onaylayın.',
    'تغيّر السعر إلى {{n}} رصيد. يُرجى تأكيد السعر الجديد للبدء.',
    'המחיר השתנה ל-{{n}} קרדיטים. אשרו את המחיר החדש כדי להתחיל.',
  ],
  verify_price_running: ['Fixed price: {{n}} credits — charged only when your report is ready.', 'ფიქსირებული ფასი: {{n}} კრედიტი, ჩამოიჭრება მხოლოდ ანგარიშის მზადყოფნისას.', 'Фиксированная цена: {{n}} кредитов — списывается только когда отчёт готов.', 'Sabit fiyat: {{n}} kredi — yalnızca raporunuz hazır olduğunda tahsil edilir.', 'السعر الثابت: {{n}} رصيد — يُخصم فقط عندما يصبح تقريرك جاهزًا.', 'מחיר קבוע: {{n}} קרדיטים — נגבה רק כשהדוח שלך מוכן.'],
  verify_price_paid: ['Price paid', 'გადახდილი ფასი', 'Оплаченная цена', 'Ödenen fiyat', 'السعر المدفوع', 'המחיר ששולם'],
  verify_report_expired_title: [
    'This report has expired',
    'ამ ანგარიშის ვადა ამოიწურა',
    'Срок действия этого отчёта истёк',
    'Bu raporun süresi doldu',
    'انتهت صلاحية هذا التقرير',
    'תוקף הדוח הזה פג',
  ],
  verify_rerun_cta: ['Run new verification — {{n}} credits', 'ახალი ვერიფიკაცია: {{n}} კრედიტი', 'Новая проверка — {{n}} кредитов', 'Yeni doğrulama — {{n}} kredi', 'تحقق جديد — {{n}} رصيد', 'אימות חדש — {{n}} קרדיטים'],
  adm_vprice_title: ['Verify price', 'Verify-ის ფასი', 'Цена Verify', 'Verify fiyatı', 'سعر Verify', 'מחיר Verify'],
  adm_vprice_desc: [
    'The one customer price for every verification, V1 and V2 alike. Internal provider costs stay in Finance.',
    'ერთი სამომხმარებლო ფასი ყველა ვერიფიკაციისთვის, V1-ისა და V2-ისთვის ერთნაირად. შიდა პროვაიდერის ხარჯები ფინანსებში რჩება.',
    'Единая цена для клиента за любую проверку, одинаковая для V1 и V2. Внутренние расходы на провайдеров остаются в разделе финансов.',
    'Her doğrulama için tek müşteri fiyatı, V1 ve V2 için aynı. Dahili sağlayıcı maliyetleri Finans bölümünde kalır.',
    'سعر واحد للعميل لكل عملية تحقق، متطابق في V1 وV2. تبقى تكاليف المزوّدين الداخلية في قسم المالية.',
    'מחיר לקוח אחד לכל אימות, זהה ב-V1 וב-V2. עלויות הספקים הפנימיות נשארות בכספים.',
  ],
  adm_vprice_active: [
    'Active price: {{usd}} = {{n}} credits',
    'მოქმედი ფასი: {{usd}} = {{n}} კრედიტი',
    'Действующая цена: {{usd}} = {{n}} кредитов',
    'Geçerli fiyat: {{usd}} = {{n}} kredi',
    'السعر الحالي: {{usd}} = {{n}} رصيد',
    'מחיר פעיל: {{usd}} = {{n}} קרדיטים',
  ],
  adm_vprice_not_fixed: [
    'Not a fixed price yet',
    'ფიქსირებული ფასი ჯერ არ არის დაყენებული',
    'Фиксированная цена ещё не задана',
    'Henüz sabit fiyat yok',
    'لم يُحدَّد سعر ثابت بعد',
    'עדיין לא נקבע מחיר קבוע',
  ],
  adm_vprice_validity: [
    'Report valid {{days}} days',
    'ანგარიში მოქმედებს {{days}} დღე',
    'Отчёт действует {{days}} дней',
    'Rapor {{days}} gün geçerli',
    'التقرير صالح لمدة {{days}} يومًا',
    'הדוח בתוקף {{days}} ימים',
  ],
  adm_vprice_vat: ['VAT included', 'დღგ-ს ჩათვლით', 'НДС включён', 'KDV dahil', 'شامل الضريبة', 'כולל מע״מ'],
  adm_vprice_usd: ['Price (USD)', 'ფასი (USD)', 'Цена (USD)', 'Fiyat (USD)', 'السعر (USD)', 'מחיר (USD)'],
  adm_vprice_credits: ['= {{n}} credits', '= {{n}} კრედიტი', '= {{n}} кредитов', '= {{n}} kredi', '= {{n}} رصيد', '= {{n}} קרדיטים'],
  adm_vprice_invalid: [
    'Enter an amount that is a whole number of credits (a multiple of $0.10).',
    'შეიყვანეთ თანხა, რომელიც კრედიტების მთელ რაოდენობას შეადგენს ($0.10-ის ჯერადი).',
    'Введите сумму, равную целому числу кредитов (кратную $0.10).',
    'Tam sayıda krediye denk gelen bir tutar girin ($0.10’un katı).',
    'أدخل مبلغًا يساوي عددًا صحيحًا من الأرصدة (من مضاعفات 0.10 دولار).',
    'הזינו סכום ששווה למספר שלם של קרדיטים (כפולה של $0.10).',
  ],
  adm_vprice_save: ['Save price', 'ფასის შენახვა', 'Сохранить цену', 'Fiyatı kaydet', 'حفظ السعر', 'שמירת המחיר'],
  adm_vprice_reason: ['Reason (required)', 'მიზეზი (სავალდებულო)', 'Причина (обязательно)', 'Gerekçe (zorunlu)', 'السبب (مطلوب)', 'סיבה (חובה)'],
  adm_vprice_confirm_title: [
    'Change the Verify price to {{usd}} = {{n}} credits?',
    'შეიცვალოს Verify-ის ფასი {{usd}} = {{n}} კრედიტზე?',
    'Изменить цену Verify на {{usd}} = {{n}} кредитов?',
    'Verify fiyatı {{usd}} = {{n}} kredi olarak değiştirilsin mi?',
    'هل تريد تغيير سعر Verify إلى {{usd}} = {{n}} رصيد؟',
    'לשנות את מחיר Verify ל-{{usd}} = {{n}} קרדיטים?',
  ],
  adm_vprice_confirm_body: [
    'New purchases use the new price immediately. Running and already purchased reports keep the price they started with. The change is recorded in the audit log with your reason.',
    'ახალი შესყიდვები ახალ ფასს მაშინვე იყენებს. მიმდინარე და უკვე შეძენილი ანგარიშები საწყის ფასს ინარჩუნებს. ცვლილება თქვენი მიზეზით აუდიტის ჟურნალში ჩაიწერება.',
    'Новые покупки сразу идут по новой цене. Текущие и уже купленные отчёты сохраняют свою цену. Изменение записывается в журнал аудита вместе с причиной.',
    'Yeni satın almalar yeni fiyatı hemen kullanır. Devam eden ve satın alınmış raporlar başladıkları fiyatı korur. Değişiklik gerekçenizle denetim kaydına yazılır.',
    'تستخدم عمليات الشراء الجديدة السعر الجديد فورًا. تحتفظ التقارير الجارية والمشتراة مسبقًا بالسعر الذي بدأت به. يُسجَّل التغيير في سجل التدقيق مع السبب.',
    'רכישות חדשות משתמשות במחיר החדש מיד. דוחות פעילים ודוחות שכבר נרכשו שומרים על המחיר שבו התחילו. השינוי נרשם ביומן הביקורת עם הסיבה שלך.',
  ],
  adm_vprice_saved: ['Verify price updated', 'Verify-ის ფასი განახლდა', 'Цена Verify обновлена', 'Verify fiyatı güncellendi', 'تم تحديث سعر Verify', 'מחיר Verify עודכן'],
  adm_vprice_history: ['Price changes', 'ფასის ცვლილებები', 'Изменения цены', 'Fiyat değişiklikleri', 'تغييرات السعر', 'שינויי מחיר'],
};

/* Corrected (owner decision 2026-10-23): access ends after 30 days; nothing is deleted. */
export const VERIFY_RETENTION_POLICY_STRINGS = {
  rt_policy_verify: [
    'Your Verify report is available for 30 days after it is completed. After that it is no longer accessible; your payment record is kept. We recommend downloading the report in advance if you need it.',
    'Verify-ის ანგარიში ხელმისაწვდომია დასრულებიდან 30 დღის განმავლობაში. ამის შემდეგ ის აღარ იქნება ხელმისაწვდომი; გადახდის ჩანაწერი ინახება. თუ ანგარიში დაგჭირდებათ, გირჩევთ წინასწარ ჩამოტვირთოთ.',
    'Отчёт Verify доступен 30 дней после завершения. После этого он больше недоступен; запись об оплате сохраняется. Если отчёт вам понадобится, рекомендуем скачать его заранее.',
    'Verify raporunuz tamamlandıktan sonra 30 gün erişilebilir. Bundan sonra erişilemez; ödeme kaydınız saklanır. İhtiyacınız olacaksa raporu önceden indirmenizi öneririz.',
    'يكون تقرير Verify متاحًا لمدة 30 يومًا بعد اكتماله. بعد ذلك لا يعود متاحًا؛ ويُحتفظ بسجل الدفع. ننصح بتنزيل التقرير مسبقًا إذا كنت ستحتاج إليه.',
    'דוח Verify זמין במשך 30 יום מסיומו. לאחר מכן הוא אינו נגיש עוד; רישום התשלום נשמר. אם תזדקקו לדוח, מומלץ להוריד אותו מראש.',
  ],
};
