// The fixed copy the conversation standard introduced.
//
// A NOTE ON THE GEORGIAN, WHICH IS THE POINT OF THIS FILE
//
// Georgian here is written as somebody speaks it, not as English
// rearranged. That means: no "გთხოვთ" where a friend would not say it,
// no noun-stacking where a verb does the work, contractions and
// particles where they are natural (მოდი, ერთად, ხომ), and short
// sentences. Several of these strings replace copy that was
// grammatically correct and unmistakably translated.
//
// key -> [en, ka, ru, tr, ar, he].

export const CONVERSATION_STRINGS = {
  /* ── The chips ──────────────────────────────────────────────────── */

  ai_suggested_replies_label: [
    'Suggested replies',
    'შესაძლო პასუხები',
    'Возможные ответы',
    'Olası yanıtlar',
    'ردود مقترحة',
    'תשובות אפשריות',
  ],

  /* ── Running out of credits, said kindly ────────────────────────── */

  ai_out_of_credits: ['Your credit balance has run out. The conversation stays right here. New credits are no longer sold.', 'კრედიტების ნაშთი ამოიწურა. საუბარი აქვე რჩება. ახალი კრედიტები აღარ იყიდება.', 'Баланс кредитов закончился. Разговор сохранится здесь. Новые кредиты больше не продаются.', 'Kredi bakiyen bitti. Sohbet burada kalır. Yeni kredi artık satılmıyor.', 'نفد رصيدك. تبقى المحادثة هنا. لم تعد الأرصدة الجديدة تُباع.', 'יתרת הקרדיטים נגמרה. השיחה נשארת כאן. קרדיטים חדשים כבר לא נמכרים.'],
  ai_out_of_credits_action: ['View balance', 'ბალანსის ნახვა', 'Посмотреть баланс', 'Bakiyeyi gör', 'عرض الرصيد', 'צפייה ביתרה'],

  /* ── The welcome grant ──────────────────────────────────────────── */

  credits_welcome_title: [
    'We have added 50 Credits to get you started',
    'საწყისად 50 კრედიტი დაგიმატეთ',
    'Мы начислили вам 50 кредитов для начала',
    'Başlangıç için hesabınıza 50 Kredi ekledik',
    'أضفنا إلى حسابك 50 رصيدًا للبداية',
    'הוספנו לכם 50 קרדיטים להתחלה',
  ],
  credits_welcome_body: ['Use them for research and for help from Homatch AI. Credits are service value, not cash.', 'გამოიყენე HOMATCH-ის კვლევებსა და AI დახმარებაში. კრედიტი სერვისის ღირებულებაა და არა ნაღდი ფული.', 'Используйте их для исследований и помощи Homatch AI. Кредиты — это стоимость услуг, а не наличные.', 'Homatch araştırmalarında ve AI yardımında kullanın. Krediler hizmet değeridir, nakit değildir.', 'استخدمها في أبحاث Homatch وفي مساعدة الذكاء الاصطناعي. الأرصدة قيمة خدمات وليست نقودًا.', 'השתמשו בהם למחקרים ולעזרה מ-Homatch AI. קרדיטים הם שווי שירות, לא מזומן.'],

  /* ── Mortgage: the promise before the calculator ────────────────── */

  mortgage_opening_promise: [
    'Enter your terms and in a few seconds you will see more than a monthly payment: what it means for you, where you could save, and which scenario might suit you better.',
    'შეიყვანე შენი პირობები — რამდენიმე წამში ნახავ არა მხოლოდ თვიურ გადასახადს, არამედ იმასაც, რას ნიშნავს ეს შენთვის, სად შეგიძლია დაზოგო და რომელი სცენარი შეიძლება უკეთ მოგერგოს.',
    'Введите свои условия — через несколько секунд увидите не только ежемесячный платёж, но и что он означает для вас, где можно сэкономить и какой сценарий подойдёт вам лучше.',
    'Koşullarınızı girin — birkaç saniye içinde yalnızca aylık ödemeyi değil, bunun sizin için ne anlama geldiğini, nerede tasarruf edebileceğinizi ve hangi senaryonun size daha çok yakışacağını göreceksiniz.',
    'أدخل شروطك، وخلال ثوانٍ سترى أكثر من مجرد قسط شهري: ماذا يعني لك، وأين يمكنك التوفير، وأي سيناريو قد يناسبك أكثر.',
    'הזינו את התנאים שלכם ותוך שניות תראו יותר מתשלום חודשי: מה זה אומר עבורכם, איפה אפשר לחסוך, ואיזה תרחיש אולי מתאים לכם יותר.',
  ],

  /* ── Mortgage: the handoff from numbers to a conversation ───────── */

  mortgage_result_handoff: [
    'That is the real picture. Shall we go through it together?',
    'აი, ახლა უკვე რეალური სურათი გვაქვს 👌 მოდი, ერთად გავარჩიოთ.',
    'Вот теперь картина реальная. Давайте разберём её вместе?',
    'İşte gerçek tablo. İsterseniz birlikte bakalım.',
    'هذه هي الصورة الحقيقية. نراجعها معًا؟',
    'זו התמונה האמיתית. נעבור עליה יחד?',
  ],
};
