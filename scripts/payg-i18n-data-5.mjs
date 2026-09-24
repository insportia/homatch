// HOMATCH pay-as-you-go copy, part 5 — the signup grant, as a lever.
//
// Order is [en, ka, ru, tr, ar, he].
//
// WHY THIS CONTROL EXISTS AT ALL
//
// The pay-as-you-go design says an account starts at zero and earns its first
// credits by proving a real payment method. That is right, and it assumes a
// payment provider exists. Production has none: PAYMENT_PROVIDER_SECRET is
// unset, so a new customer would arrive with an empty wallet and a button
// that can only tell them card saving is unavailable.
//
// Rather than decide that trade on the owner's behalf, it is a switch, next
// to the offer it interacts with, with the consequence written underneath.

export const PAYG_STRINGS_5 = {
  owner_f_signup_credits_enabled: [
    'Also give free credits at signup',
    'უფასო კრედიტის გაცემა რეგისტრაციისასაც',
    'Также давать бесплатные кредиты при регистрации',
    'Kayıt olurken de ücretsiz kredi ver',
    'منح رصيد مجاني عند التسجيل أيضًا',
    'לתת קרדיטים חינם גם בהרשמה',
  ],
  owner_h_signup_credits_enabled: [
    'Off under pay-as-you-go: an account earns its first credits by adding a card. Turn it on if no payment provider is connected yet, or new accounts will start empty with no way to earn them.',
    'გამორთულია: ანგარიში პირველ კრედიტს ბარათის დამატებით იღებს. ჩართეთ, თუ გადახდის მომწოდებელი ჯერ არ არის დაკავშირებული, თორემ ახალი ანგარიშები ცარიელი დარჩება.',
    'Выключено: аккаунт получает первые кредиты за добавление карты. Включите, если платёжный провайдер ещё не подключён, иначе новые аккаунты останутся пустыми.',
    'Kapalı: hesap ilk kredilerini kart ekleyerek kazanır. Henüz bir ödeme sağlayıcısı bağlı değilse açın, yoksa yeni hesaplar boş başlar ve kazanamaz.',
    'مُعطّل: يكسب الحساب أول رصيد له بإضافة بطاقة. فعّله إذا لم يكن هناك مزوّد دفع متصل بعد، وإلا ستبدأ الحسابات الجديدة فارغة بلا وسيلة للكسب.',
    'כבוי: חשבון מרוויח את הקרדיטים הראשונים בהוספת כרטיס. הפעילו אם עדיין לא מחובר ספק תשלומים, אחרת חשבונות חדשים יתחילו ריקים בלי דרך להרוויח.',
  ],
  owner_f_signup_credits: [
    'Credits at signup',
    'კრედიტი რეგისტრაციისას',
    'Кредитов при регистрации',
    'Kayıtta verilen kredi',
    'الرصيد عند التسجيل',
    'קרדיטים בהרשמה',
  ],
};
