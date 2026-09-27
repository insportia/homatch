// The copy the Notification Center introduced.
//
// A NOTE ON REGISTER
//
// Notifications speak for Homatch, to a customer, about their property, their money and
// their messages. So they use the same polite register the existing notification copy
// already uses in each language — formal "თქვენ" in Georgian, "вы" in Russian,
// "siz" in Turkish, plural address in Hebrew — rather than the friendlier voice of the
// assistant conversation. Georgian is written as it is said, not as English rearranged:
// a verb where English stacks nouns, and no calques ("მატჩი" is avoided in favour of
// "შესაბამისობა").
//
// Where a count is interpolated, languages with several plural forms (ru, ar, he) put the
// number after a colon — the pattern notif_unread_count already uses — so no count ever
// produces a wrong plural.
//
// key -> [en, ka, ru, tr, ar, he].

export const NOTIFICATION_STRINGS = {
  /* ── Categories: what a notification is about ─────────────────────── */

  notif_kind_message: ['Messages', 'მიმოწერა', 'Сообщения', 'Mesajlar', 'الرسائل', 'הודעות'],
  notif_kind_match: ['Matches', 'შესაბამისობა', 'Совпадения', 'Eşleşmeler', 'التطابقات', 'התאמות'],
  notif_kind_property: ['Property', 'ქონება', 'Недвижимость', 'Mülk', 'العقار', 'נכס'],
  notif_kind_discovery: ['Discovery', 'ძიება', 'Поиск', 'Keşif', 'الاستكشاف', 'חיפוש'],
  notif_kind_service: ['Services', 'სერვისები', 'Сервисы', 'Hizmetler', 'الخدمات', 'שירותים'],
  notif_kind_billing: ['Billing', 'გადახდები', 'Оплата', 'Ödemeler', 'المدفوعات', 'תשלומים'],
  notif_kind_account: [
    'Account & security',
    'ანგარიში და უსაფრთხოება',
    'Аккаунт и безопасность',
    'Hesap ve güvenlik',
    'الحساب والأمان',
    'חשבון ואבטחה',
  ],
  notif_kind_news: ['News', 'სიახლეები', 'Новости', 'Duyurular', 'الأخبار', 'חדשות'],

  /* ── The centre itself ────────────────────────────────────────────── */

  notif_page_sub: [
    'Messages, matches and news about your properties and services.',
    'მიმოწერა, შესაბამისობები და სიახლეები თქვენს ქონებასა და სერვისებზე.',
    'Сообщения, совпадения и новости о ваших объектах и сервисах.',
    'Mülkleriniz ve hizmetlerinizle ilgili mesajlar, eşleşmeler ve duyurular.',
    'الرسائل والتطابقات والأخبار المتعلقة بعقاراتك وخدماتك.',
    'הודעות, התאמות וחדשות על הנכסים והשירותים שלכם.',
  ],
  notif_list_label: [
    'Your notifications',
    'თქვენი შეტყობინებები',
    'Ваши уведомления',
    'Bildirimleriniz',
    'إشعاراتك',
    'ההתראות שלכם',
  ],
  notif_filter_label: ['Filter', 'ფილტრი', 'Фильтр', 'Filtre', 'تصفية', 'סינון'],
  notif_unread_label: ['Unread', 'წაუკითხავი', 'Не прочитано', 'Okunmadı', 'غير مقروء', 'לא נקרא'],
  notif_mark_read: [
    'Mark as read',
    'წაკითხულად მონიშვნა',
    'Отметить как прочитанное',
    'Okundu olarak işaretle',
    'تحديد كمقروء',
    'סימון כנקרא',
  ],
  notif_mark_all_failed: [
    'Could not mark them read. Please try again.',
    'წაკითხულად მონიშვნა ვერ მოხერხდა. სცადეთ ხელახლა.',
    'Не удалось отметить уведомления. Попробуйте ещё раз.',
    'Bildirimler işaretlenemedi. Lütfen tekrar deneyin.',
    'تعذّر تحديد الإشعارات كمقروءة. حاول مرة أخرى.',
    'לא הצלחנו לסמן את ההתראות. נסו שוב.',
  ],
  notif_retry: ['Try again', 'ხელახლა ცდა', 'Повторить', 'Tekrar dene', 'إعادة المحاولة', 'ניסיון חוזר'],
  notif_load_error_body: [
    'Check your connection and try again.',
    'შეამოწმეთ ინტერნეტთან კავშირი და სცადეთ ხელახლა.',
    'Проверьте подключение и попробуйте ещё раз.',
    'Bağlantınızı kontrol edip tekrar deneyin.',
    'تحقّق من اتصالك ثم حاول مرة أخرى.',
    'בדקו את החיבור ונסו שוב.',
  ],
  notif_all_loaded: [
    'That is everything.',
    'მეტი შეტყობინება არ არის.',
    'Больше уведомлений нет.',
    'Başka bildirim yok.',
    'لا توجد إشعارات أخرى.',
    'אין התראות נוספות.',
  ],
  notif_empty_all_desc: [
    'When something needs your attention, it will appear here.',
    'როცა რამე თქვენს ყურადღებას მოითხოვს, აქ გამოჩნდება.',
    'Когда что-то потребует вашего внимания, это появится здесь.',
    'Dikkatinizi gerektiren bir şey olduğunda burada görünecek.',
    'عندما يحتاج أمر ما إلى انتباهك، سيظهر هنا.',
    'כשמשהו ידרוש את תשומת לבכם, הוא יופיע כאן.',
  ],

  /* ── Service completions ──────────────────────────────────────────── */

  notif_verify_complete_title: [
    'Your verification is ready',
    'თქვენი შემოწმება მზადაა',
    'Ваша проверка готова',
    'Doğrulamanız hazır',
    'التحقق الخاص بك جاهز',
    'הבדיקה שלכם מוכנה',
  ],
  notif_verify_complete_body: [
    'The report has finished and is ready to read.',
    'ანგარიში დასრულდა — შეგიძლიათ გაეცნოთ.',
    'Отчёт готов — его можно открыть.',
    'Rapor tamamlandı ve okunmaya hazır.',
    'اكتمل التقرير وهو جاهز للقراءة.',
    'הדוח הושלם ומוכן לקריאה.',
  ],
  notif_document_analyzed_title: [
    'Your document has been analysed',
    'დოკუმენტის ანალიზი დასრულდა',
    'Анализ документа завершён',
    'Belgenizin analizi tamamlandı',
    'اكتمل تحليل مستندك',
    'ניתוח המסמך הושלם',
  ],
  notif_document_analyzed_body: [
    'The analysis is ready to read.',
    'შედეგები მზადაა გასაცნობად.',
    'Результаты готовы.',
    'Sonuçlar okunmaya hazır.',
    'النتائج جاهزة للقراءة.',
    'התוצאות מוכנות לקריאה.',
  ],

  /* ── Native matches: both sides ───────────────────────────────────── */

  notif_native_supply_title: [
    'A Homatch member is looking for something like your property',
    'Homatch-ის მომხმარებელი თქვენი ქონების მსგავსს ეძებს',
    'Пользователь Homatch ищет что-то похожее на ваш объект',
    'Bir Homatch üyesi mülkünüze benzer bir yer arıyor',
    'عضو في Homatch يبحث عن عقار مشابه لعقارك',
    'חבר Homatch מחפש נכס דומה לשלכם',
  ],
  notif_native_supply_many_title: [
    '{{n}} Homatch members are looking for something like your property',
    '{{n}} მომხმარებელი ეძებს თქვენი ქონების მსგავსს',
    'Ищут что-то похожее на ваш объект: {{n}}',
    '{{n}} Homatch üyesi mülkünüze benzer bir yer arıyor',
    'أعضاء Homatch الذين يبحثون عن عقار مشابه لعقارك: {{n}}',
    'חברי Homatch שמחפשים נכס דומה לשלכם: {{n}}',
  ],
  notif_native_supply_body: [
    'Their stated requirements fit this property.',
    'მათი მოთხოვნები ამ ქონებას შეესაბამება.',
    'Их требования подходят к этому объекту.',
    'Belirttikleri kriterler bu mülke uyuyor.',
    'متطلباتهم المعلنة تناسب هذا العقار.',
    'הדרישות שהם הגדירו מתאימות לנכס הזה.',
  ],
  notif_native_demand_title: [
    'A Homatch property matches your search',
    'Homatch-ზე თქვენს ძიებას ქონება შეესაბამება',
    'Объект на Homatch подходит под ваш поиск',
    'Bir Homatch mülkü aramanızla eşleşiyor',
    'عقار على Homatch يطابق بحثك',
    'נכס ב-Homatch מתאים לחיפוש שלכם',
  ],
  notif_native_demand_many_title: [
    '{{n}} Homatch properties match your search',
    'თქვენს ძიებას {{n}} ქონება შეესაბამება',
    'Объектов, подходящих под ваш поиск: {{n}}',
    '{{n}} Homatch mülkü aramanızla eşleşiyor',
    'عقارات على Homatch تطابق بحثك: {{n}}',
    'נכסים ב-Homatch שמתאימים לחיפוש שלכם: {{n}}',
  ],
  notif_native_demand_body: [
    'It fits the plan you confirmed.',
    'ის თქვენ მიერ დადასტურებულ გეგმას შეესაბამება.',
    'Он соответствует подтверждённому вами плану.',
    'Onayladığınız plana uyuyor.',
    'إنه يناسب الخطة التي أكدتها.',
    'הוא מתאים לתוכנית שאישרתם.',
  ],
};

/*
 * EXISTING VALUES THAT WERE WRONG, corrected in place.
 *
 * Found while reading the notification copy this work touches:
 *   ka notif_load_more             "ვერწი ძველი" is not Georgian
 *   ka notif_property_action_title carried a stray Georgian-capital codepoint and read
 *                                  "your property needs several"
 *   tr notif_search_complete_title "Aramaniz" — dotless ı dropped
 *
 * lang -> key -> value. Applied by replacing that key's line in that bundle; a value
 * already correct is left alone, so re-running changes nothing.
 */
export const NOTIFICATION_CORRECTIONS = {
  ka: {
    notif_load_more: 'ძველების ჩვენება',
    notif_property_action_title: 'თქვენს ერთ-ერთ ქონებას ყურადღება სჭირდება',
  },
  tr: {
    notif_search_complete_title: 'Aramanız için sonuçlar var',
  },
};
