// HOMATCH pay-as-you-go copy, part 3 — choosing the campaign budget.
//
// Order is [en, ka, ru, tr, ar, he].
//
// THE DISTINCTION THIS COPY HAS TO CARRY
//
// Wallet balance is everything the customer owns. Campaign budget is the most
// they are willing to let ONE search consume. A person with 100 credits
// pressing Start must not lose 100 credits, and the way to make that true in
// the interface is to ask the question out loud, in their own words, before
// the search begins: "how much may this search spend?"
//
// The answer is a ceiling, never a price. "You are charged what the search
// actually used" already exists as cost_only_actual and is shown beneath the
// ladder, so the customer reads the cap and the refund promise together.

export const PAYG_STRINGS_3 = {
  budget_choose_title: [
    'How much may this search spend?',
    'რამდენის დახარჯვა შეუძლია ამ ძიებას?',
    'Сколько может потратить этот поиск?',
    'Bu arama en fazla ne kadar harcayabilir?',
    'ما الحد الأقصى الذي يمكن أن ينفقه هذا البحث؟',
    'כמה מותר לחיפוש הזה להוציא?',
  ],
  budget_choose_help: [
    'This is a limit, not a price. Anything the search does not use stays in your balance.',
    'ეს ზღვარია და არა ფასი. რასაც ძიება არ დახარჯავს, თქვენს ბალანსზე რჩება.',
    'Это лимит, а не цена. Всё, что поиск не потратит, останется на балансе.',
    'Bu bir üst sınırdır, fiyat değil. Aramanın kullanmadığı her şey bakiyenizde kalır.',
    'هذا حد أقصى وليس سعرًا. كل ما لا يستخدمه البحث يبقى في رصيدك.',
    'זו תקרה, לא מחיר. כל מה שהחיפוש לא ניצל נשאר ביתרה שלכם.',
  ],
  budget_recommended: [
    'Recommended',
    'რეკომენდებული',
    'Рекомендуем',
    'Önerilen',
    'موصى به',
    'מומלץ',
  ],
  budget_custom_label: [
    'Another amount',
    'სხვა ოდენობა',
    'Другая сумма',
    'Başka bir tutar',
    'مبلغ آخر',
    'סכום אחר',
  ],
  budget_over_balance: [
    'More than your balance',
    'თქვენს ბალანსზე მეტი',
    'Больше вашего баланса',
    'Bakiyenizden fazla',
    'أكثر من رصيدك',
    'יותר מהיתרה שלכם',
  ],
  budget_broader_note: [
    'A larger limit lets Homatch search more sources and go deeper.',
    'დიდი ზღვარი Homatch-ს მეტ წყაროში და უფრო ღრმად ძებნის საშუალებას აძლევს.',
    'Больший лимит позволяет Homatch искать в большем числе источников и глубже.',
    'Daha yüksek bir sınır, Homatch’in daha çok kaynakta ve daha derine bakmasını sağlar.',
    'الحد الأعلى يتيح لـ Homatch البحث في مصادر أكثر وبعمق أكبر.',
    'תקרה גבוהה יותר מאפשרת ל-Homatch לחפש ביותר מקורות ולעומק רב יותר.',
  ],
  budget_cta_authorize: [
    'Search with up to {{credits}} credits',
    'ძებნა მაქსიმუმ {{credits}} კრედიტით',
    'Искать не более чем на {{credits}} кредитов',
    'En fazla {{credits}} kredi ile ara',
    'ابحث بحد أقصى {{credits}} رصيد',
    'חיפוש עם עד {{credits}} קרדיטים',
  ],
};
