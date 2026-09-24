// HOMATCH pay-as-you-go copy, part 1 — the activation offer.
//
// Order is [en, ka, ru, tr, ar, he].
//
// THE ONE SENTENCE THIS SCREEN HAS TO GET RIGHT
//
// "$0 charged now." An elderly customer being asked for a card is right to
// be suspicious, and the answer to that suspicion is one short sentence in
// their own language, next to the button, not buried in terms. Every
// translation below keeps it as its own sentence for that reason.
//
// {{credits}} and {{usd}} are substituted by t(). They are never baked in:
// the number of credits and the conversion rate are both admin settings, so
// an operator changing 10 to 20 changes this copy without a deploy.

export const PAYG_STRINGS_1 = {
  card_activation_title: [
    'Get {{credits}} free credits',
    'მიიღეთ {{credits}} უფასო კრედიტი',
    'Получите {{credits}} бесплатных кредитов',
    '{{credits}} ücretsiz kredi alın',
    'احصل على {{credits}} رصيد مجاني',
    'קבלו {{credits}} קרדיטים בחינם',
  ],
  card_activation_body: [
    '{{credits}} credits are worth ${{usd}} and can be used on anything Homatch charges for.',
    '{{credits}} კრედიტი ${{usd}}-ს უდრის და ნებისმიერ ფასიან სერვისზე გამოგადგებათ.',
    '{{credits}} кредитов — это ${{usd}}, и их можно потратить на любую платную услугу Homatch.',
    '{{credits}} kredi ${{usd}} değerindedir ve Homatch’in ücretli hizmetlerinin tamamında kullanılabilir.',
    '{{credits}} رصيد تساوي ${{usd}} ويمكن استخدامها في أي خدمة مدفوعة من Homatch.',
    '{{credits}} קרדיטים שווים ${{usd}} וניתן להשתמש בהם בכל שירות בתשלום של Homatch.',
  ],
  card_activation_cta: [
    'Add card & get {{credits}} credits',
    'დაამატეთ ბარათი და მიიღეთ {{credits}} კრედიტი',
    'Добавить карту и получить {{credits}} кредитов',
    'Kart ekleyin, {{credits}} kredi alın',
    'أضف بطاقة واحصل على {{credits}} رصيد',
    'הוסיפו כרטיס וקבלו {{credits}} קרדיטים',
  ],
  card_activation_zero_charge: [
    '$0 charged now.',
    'ახლა თანხა არ ჩამოგეჭრებათ.',
    'Сейчас ничего не спишется.',
    'Şimdi hiçbir ücret alınmaz.',
    'لن يُخصم منك أي مبلغ الآن.',
    'לא מחויבים כלום עכשיו.',
  ],
  card_activation_dismiss: [
    'Not now',
    'ახლა არა',
    'Не сейчас',
    'Şimdi değil',
    'ليس الآن',
    'לא עכשיו',
  ],
  card_activation_claim_short: [
    'Claim {{credits}} free credits',
    'მიიღეთ {{credits}} უფასო კრედიტი',
    'Забрать {{credits}} бесплатных кредитов',
    '{{credits}} ücretsiz krediyi alın',
    'احصل على {{credits}} رصيد مجاني',
    'קבלו {{credits}} קרדיטים בחינם',
  ],
  card_activation_granted_title: [
    '{{credits}} credits added',
    '{{credits}} კრედიტი დაემატა',
    'Начислено {{credits}} кредитов',
    '{{credits}} kredi eklendi',
    'تمت إضافة {{credits}} رصيد',
    'נוספו {{credits}} קרדיטים',
  ],
  card_activation_granted_body: [
    'They are in your balance and never expire.',
    'ისინი თქვენს ბალანსზეა და ვადა არ გასდის.',
    'Они на вашем балансе и не сгорают.',
    'Bakiyenizde duruyor ve süresi dolmaz.',
    'أصبحت في رصيدك ولا تنتهي صلاحيتها.',
    'הם ביתרה שלכם ואינם פגים.',
  ],
  card_activation_card_saved: [
    'Card saved',
    'ბარათი შენახულია',
    'Карта сохранена',
    'Kart kaydedildi',
    'تم حفظ البطاقة',
    'הכרטיס נשמר',
  ],
  // Shown when the configured provider cannot store a card without charging
  // it. Deliberately says what Homatch cannot do rather than blaming the
  // customer or pretending the button is merely busy.
  card_activation_unavailable: [
    'Card saving is not available yet.',
    'ბარათის შენახვა ჯერ ხელმისაწვდომი არ არის.',
    'Сохранение карты пока недоступно.',
    'Kart kaydetme henüz kullanılamıyor.',
    'حفظ البطاقة غير متاح بعد.',
    'שמירת כרטיס אינה זמינה עדיין.',
  ],
  card_activation_unavailable_body: [
    'Homatch cannot store a card without charging it yet, so this offer is paused. Your balance and everything you have already bought are unaffected.',
    'Homatch-ს ჯერ არ შეუძლია ბარათის შენახვა თანხის ჩამოჭრის გარეშე, ამიტომ შეთავაზება შეჩერებულია. თქვენს ბალანსს და უკვე შეძენილს ეს არ ეხება.',
    'Homatch пока не может сохранить карту без списания, поэтому предложение приостановлено. На ваш баланс и уже купленное это не влияет.',
    'Homatch henüz kartı ücret almadan kaydedemiyor, bu yüzden teklif duraklatıldı. Bakiyeniz ve satın aldıklarınız etkilenmez.',
    'لا يستطيع Homatch بعد حفظ البطاقة دون خصم مبلغ، لذلك أُوقف هذا العرض مؤقتًا. لا يتأثر رصيدك ولا ما اشتريته من قبل.',
    'Homatch עדיין אינו יכול לשמור כרטיס בלי לחייב אותו, ולכן ההצעה מושהית. היתרה שלכם וכל מה שכבר רכשתם אינם מושפעים.',
  ],
  card_activation_failed: [
    'The card was not saved.',
    'ბარათი არ შენახულა.',
    'Карта не сохранена.',
    'Kart kaydedilmedi.',
    'لم يتم حفظ البطاقة.',
    'הכרטיס לא נשמר.',
  ],
  card_activation_failed_body: [
    'Nothing was charged. You can try again whenever you like.',
    'თანხა არ ჩამოჭრილა. სცადეთ ნებისმიერ დროს.',
    'Ничего не списано. Попробуйте снова в любой момент.',
    'Hiçbir ücret alınmadı. İstediğiniz zaman tekrar deneyebilirsiniz.',
    'لم يتم خصم أي مبلغ. يمكنك المحاولة مرة أخرى في أي وقت.',
    'לא חויבתם בכלום. אפשר לנסות שוב מתי שתרצו.',
  ],
};
