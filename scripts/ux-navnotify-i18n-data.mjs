/* UX round · finished-job notifications — [en, ka, ru, tr, ar, he].
 * Georgian first in meaning: plain everyday words, no dashes, and never
 * "confirmed buyer" (the results of a search are people who MAY be interested). */
export const UX_NAVNOTIFY_STRINGS = {
  /* A Find Buyers / Find Tenants search the person ran has finished (in-app, push, list). */
  notif_find_clients_done_title: [
    'Your search for interested people has finished',
    'დაინტერესებული ადამიანების ძებნა დასრულდა',
    'Поиск заинтересованных людей завершён',
    'İlgilenebilecek kişi araması bitti',
    'انتهى البحث عن الأشخاص المهتمين',
    'החיפוש אחר אנשים מתעניינים הסתיים',
  ],
  notif_find_clients_done_body: [
    'The results are ready. See who may be interested in your property.',
    'შედეგები მზად არის. ნახე, ვინ შეიძლება დაინტერესდეს შენი ქონებით.',
    'Результаты готовы. Посмотри, кого может заинтересовать твой объект.',
    'Sonuçlar hazır. Mülkünle kimlerin ilgilenebileceğini gör.',
    'النتائج جاهزة. شاهد من قد يهتم بعقارك.',
    'התוצאות מוכנות. ראה מי עשוי להתעניין בנכס שלך.',
  ],

  /* The one line under the title of the "your task finished" card. */
  jobdone_verify_body: [
    'The report is ready to read.',
    'ანგარიში მზად არის, შეგიძლია წაიკითხო.',
    'Отчёт готов, можно читать.',
    'Rapor hazır, okuyabilirsin.',
    'التقرير جاهز للقراءة.',
    'הדוח מוכן לקריאה.',
  ],
  jobdone_document_body: [
    'See which clauses need your attention.',
    'ნახე, რომელ პუნქტებს სჭირდება შენი ყურადღება.',
    'Посмотри, какие пункты требуют внимания.',
    'Hangi maddelerin dikkat istediğini gör.',
    'اطلع على البنود التي تحتاج إلى انتباهك.',
    'ראה אילו סעיפים דורשים את תשומת לבך.',
  ],
  jobdone_search_body: [
    'See who may be interested in your property.',
    'ნახე, ვინ შეიძლება დაინტერესდეს შენი ქონებით.',
    'Посмотри, кого может заинтересовать твой объект.',
    'Mülkünle kimlerin ilgilenebileceğini gör.',
    'شاهد من قد يهتم بعقارك.',
    'ראה מי עשוי להתעניין בנכס שלך.',
  ],
  jobdone_generic_body: [
    'Everything is ready for you.',
    'ყველაფერი მზად არის.',
    'Всё готово.',
    'Her şey hazır.',
    'كل شيء جاهز.',
    'הכול מוכן.',
  ],
  jobdone_failed_body: [
    'You are not charged for what was not done. You can try again.',
    'რაც ვერ შესრულდა, იმაში თანხა არ ჩამოგეჭრება. შეგიძლია ხელახლა სცადო.',
    'За то, что не сделано, деньги не списываются. Можно попробовать снова.',
    'Yapılmayan iş için ücret alınmaz. Tekrar deneyebilirsin.',
    'لا تُحتسب رسوم على ما لم يُنجز. يمكنك المحاولة مرة أخرى.',
    'לא תחויב על מה שלא בוצע. אפשר לנסות שוב.',
  ],

  /* An offer inside that card, only while this device is not set up for notifications. */
  jobdone_push_offer: [
    'Want this on your phone next time, even with the site closed?',
    'გინდა შემდეგ ჯერზე ეს ტელეფონზეც მოგივიდეს, საიტი დახურულიც რომ იყოს?',
    'Хочешь в следующий раз получать это на телефон, даже когда сайт закрыт?',
    'Bir dahaki sefere site kapalıyken bile telefonuna gelsin mi?',
    'هل تريد أن يصلك هذا على هاتفك في المرة القادمة حتى لو كان الموقع مغلقًا؟',
    'רוצה לקבל את זה בטלפון בפעם הבאה, גם כשהאתר סגור?',
  ],
  jobdone_push_enable: [
    'Turn on',
    'ჩართვა',
    'Включить',
    'Aç',
    'تفعيل',
    'הפעל',
  ],
  jobdone_push_enabled: [
    'Done. This device will now get notifications.',
    'მზადაა. ამ მოწყობილობაზე შეტყობინებები მოვა.',
    'Готово. На это устройство будут приходить уведомления.',
    'Tamam. Bu cihaza artık bildirim gelecek.',
    'تم. سيصل الإشعار إلى هذا الجهاز من الآن.',
    'מוכן. המכשיר הזה יקבל מעכשיו התראות.',
  ],
};
