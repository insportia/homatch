// HOMATCH pay-as-you-go copy, part 2 — the pricing page without plans.
//
// Order is [en, ka, ru, tr, ar, he].
//
// THE SENTENCE THE WHOLE BUSINESS MODEL REDUCES TO
//
// "If you don't use Homatch, you pay nothing." It is the first thing on the
// page because it is the thing that distinguishes this product from every
// subscription the reader has been burned by, and because an elderly or
// non-technical customer should be able to stop reading after one line and
// still have understood the offer.
//
// NOTHING HERE NAMES A PRICE. Every figure on that page arrives from
// billable_products and admin_settings at render time, so an operator
// changing a price changes the page without a deploy, and this copy cannot
// drift away from what the engine actually charges.

export const PAYG_STRINGS_2 = {
  payg_headline: [
    'Pay only for what you use',
    'გადაიხადეთ მხოლოდ იმაში, რასაც იყენებთ',
    'Платите только за то, чем пользуетесь',
    'Yalnızca kullandığınız kadar ödeyin',
    'ادفع مقابل ما تستخدمه فقط',
    'משלמים רק על מה שמשתמשים',
  ],
  payg_no_subscription: [
    "No subscription and no monthly fee. If you don't use Homatch, you pay nothing.",
    'არანაირი გამოწერა და ყოველთვიური გადასახადი. თუ Homatch-ს არ იყენებთ, არაფერს იხდით.',
    'Никаких подписок и ежемесячных платежей. Не пользуетесь Homatch — не платите ничего.',
    'Abonelik yok, aylık ücret yok. Homatch’i kullanmazsanız hiçbir şey ödemezsiniz.',
    'لا اشتراك ولا رسوم شهرية. إذا لم تستخدم Homatch فلن تدفع شيئًا.',
    'אין מנוי ואין תשלום חודשי. אם לא משתמשים ב-Homatch, לא משלמים כלום.',
  ],
  payg_rate_line: [
    '{{credits}} credits = ${{usd}}',
    '{{credits}} კრედიტი = ${{usd}}',
    '{{credits}} кредитов = ${{usd}}',
    '{{credits}} kredi = ${{usd}}',
    '{{credits}} رصيد = ${{usd}}',
    '{{credits}} קרדיטים = ${{usd}}',
  ],
  payg_prices_title: [
    'What things cost',
    'რა რამდენი ღირს',
    'Сколько что стоит',
    'Neyin ne kadar tuttuğu',
    'كم تكلّف الخدمات',
    'כמה עולה כל דבר',
  ],
  // A variable-cost product has no single price: the customer authorises a
  // maximum and is charged actual usage. Saying "from" rather than a flat
  // figure is the honest rendering of that.
  payg_price_from: [
    'from {{credits}} credits',
    '{{credits}} კრედიტიდან',
    'от {{credits}} кредитов',
    '{{credits}} krediden itibaren',
    'ابتداءً من {{credits}} رصيد',
    'החל מ-{{credits}} קרדיטים',
  ],
  payg_price_each: [
    '{{credits}} credits',
    '{{credits}} კრედიტი',
    '{{credits}} кредитов',
    '{{credits}} kredi',
    '{{credits}} رصيد',
    '{{credits}} קרדיטים',
  ],
  payg_price_unavailable: [
    'Not available yet',
    'ჯერ ხელმისაწვდომი არ არის',
    'Пока недоступно',
    'Henüz kullanılamıyor',
    'غير متاح بعد',
    'עדיין לא זמין',
  ],
  payg_only_actual: [
    'You are charged what the search actually used, never the maximum you allowed.',
    'გადაიხდით იმას, რაც ძიებამ რეალურად დახარჯა და არა თქვენ მიერ დაშვებულ მაქსიმუმს.',
    'Списывается то, что поиск реально израсходовал, а не разрешённый вами максимум.',
    'Aramanın gerçekte harcadığı kadar ödersiniz, izin verdiğiniz üst sınır kadar değil.',
    'يُخصم منك ما استهلكه البحث فعليًا، وليس الحد الأقصى الذي سمحت به.',
    'מחויבים במה שהחיפוש באמת צרך, לא בתקרה שאישרתם.',
  ],
  payg_topup_title: [
    'Add credits from $1',
    'დაამატეთ კრედიტი $1-დან',
    'Пополнение от $1',
    '1 $’dan itibaren kredi ekleyin',
    'أضف رصيدًا ابتداءً من 1$',
    'הוספת קרדיטים מ-1$',
  ],
  payg_topup_body: [
    'Choose any amount. Credits you buy never expire.',
    'აირჩიეთ ნებისმიერი თანხა. ნაყიდ კრედიტს ვადა არ გასდის.',
    'Выберите любую сумму. Купленные кредиты не сгорают.',
    'İstediğiniz tutarı seçin. Satın aldığınız krediler asla geçersiz olmaz.',
    'اختر أي مبلغ. الرصيد الذي تشتريه لا تنتهي صلاحيته.',
    'בחרו כל סכום. קרדיטים שרכשתם אינם פגים.',
  ],
  payg_cta_wallet: [
    'Open your wallet',
    'გახსენით საფულე',
    'Открыть кошелёк',
    'Cüzdanınızı açın',
    'افتح محفظتك',
    'פתחו את הארנק',
  ],
  payg_cta_start: [
    'Create a free account',
    'შექმენით უფასო ანგარიში',
    'Создать бесплатный аккаунт',
    'Ücretsiz hesap oluşturun',
    'أنشئ حسابًا مجانيًا',
    'פתחו חשבון חינם',
  ],
  payg_free_account: [
    'Creating an account is free.',
    'ანგარიშის შექმნა უფასოა.',
    'Создание аккаунта бесплатно.',
    'Hesap oluşturmak ücretsizdir.',
    'إنشاء الحساب مجاني.',
    'פתיחת חשבון היא בחינם.',
  ],
};
