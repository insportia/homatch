/*
 * HOMI workstream copy — [en, ka, ru, tr, ar, he].
 *
 * Georgian is the product's first language: every ka value here is written,
 * not machine-translated, in the informal singular, with the approved
 * terminology (docs/claude/HOMI_GLOSSARY.md). Strings the task specification
 * gave in Georgian are used verbatim.
 *
 * Applied by scripts/homi-i18n-apply.mjs (idempotent; new keys are added,
 * HOMI_REBRAND_STRINGS deliberately overwrite the old "Homatch AI" copy).
 */

/** New keys. */
export const HOMI_STRINGS = {
  /* ── Chat: actions, status ─────────────────────────────────────────── */
  ai_action_for_expats: ['Moving to Georgia', 'საქართველოში გადმოსვლა', 'Переезд в Грузию', "Gürcistan'a taşınma", 'الانتقال إلى جورجيا', 'מעבר לגאורגיה'],
  ai_action_contact: ['Contact HOMATCH', 'HOMATCH-თან დაკავშირება', 'Связаться с HOMATCH', 'HOMATCH ile iletişim', 'تواصل مع HOMATCH', 'יצירת קשר עם HOMATCH'],
  homi_waiting: ['One moment…', 'ერთი წამით…', 'Секунду…', 'Bir saniye…', 'لحظة واحدة…', 'רגע אחד…'],
  homi_error_retry: [
    "I couldn't finish that answer. Please try again.",
    'პასუხის დასრულება ვერ მოხერხდა. სცადე ხელახლა.',
    'Не получилось закончить ответ. Попробуй ещё раз.',
    'Bu yanıtı tamamlayamadım. Lütfen tekrar dene.',
    'لم أتمكن من إكمال هذه الإجابة. حاول مرة أخرى.',
    'לא הצלחתי לסיים את התשובה. נסה שוב.',
  ],

  /* ── Chat cards ────────────────────────────────────────────────────── */
  homi_card_income_source: ['Where does your income come from?', 'საიდან იღებ შემოსავალს?', 'Откуда твой доход?', 'Gelirin nereden geliyor?', 'من أين يأتي دخلك؟', 'מאיפה מגיעה ההכנסה שלך?'],
  homi_card_checklist_title: ['Documents to prepare', 'მოსამზადებელი დოკუმენტები', 'Документы для подготовки', 'Hazırlanacak belgeler', 'المستندات المطلوب تجهيزها', 'מסמכים להכנה'],
  homi_card_progress: ['{{done}} of {{total}} ready', '{{total}}-დან {{done}} მზადაა', 'Готово {{done}} из {{total}}', '{{total}} belgeden {{done}} hazır', '{{done}} من {{total}} جاهز', '{{done}} מתוך {{total}} מוכנים'],
  homi_card_mortgage_title: ['My estimated monthly payment', 'ჩემი სავარაუდო ყოველთვიური შენატანი', 'Мой примерный ежемесячный платёж', 'Tahmini aylık taksitim', 'قسطي الشهري التقديري', 'ההחזר החודשי המשוער שלי'],
  homi_card_price: ['Property price', 'ბინის ფასი', 'Цена объекта', 'Mülk fiyatı', 'سعر العقار', 'מחיר הנכס'],
  homi_card_currency: ['Currency', 'ვალუტა', 'Валюта', 'Para birimi', 'العملة', 'מטבע'],
  homi_card_down_payment: ['Down payment: {{pct}}%', 'პირველადი შენატანი: {{pct}}%', 'Первоначальный взнос: {{pct}}%', 'Peşinat: %{{pct}}', 'الدفعة الأولى: {{pct}}%', 'הון עצמי: {{pct}}%'],
  homi_card_term: ['Term: {{years}} years', 'ვადა: {{years}} წელი', 'Срок: {{years}} г.', 'Vade: {{years}} yıl', 'المدة: {{years}} سنة', 'תקופה: {{years}} שנים'],
  homi_card_years: ['{{n}} yrs', '{{n}} წელი', '{{n}} г.', '{{n}} yıl', '{{n}} سنة', '{{n}} שנים'],
  homi_card_rate: ['Interest rate (% a year)', 'საპროცენტო განაკვეთი (წლიური %)', 'Процентная ставка (% годовых)', 'Faiz oranı (yıllık %)', 'سعر الفائدة (% سنويًا)', 'ריבית (% לשנה)'],
  homi_card_rate_hint: [
    'Use the rate your bank quoted. HOMI never guesses a rate.',
    'ჩაწერე ის განაკვეთი, რომელიც ბანკმა შემოგთავაზა. HOMI განაკვეთს არასდროს ივარაუდებს.',
    'Укажи ставку, которую предложил банк. HOMI никогда не угадывает ставку.',
    'Bankanın teklif ettiği oranı yaz. HOMI asla oran tahmin etmez.',
    'استخدم السعر الذي عرضه البنك. HOMI لا يخمّن سعر الفائدة أبدًا.',
    'הזן את הריבית שהבנק הציע. HOMI אף פעם לא מנחש ריבית.',
  ],
  homi_card_monthly: ['Monthly payment', 'ყოველთვიური შენატანი', 'Ежемесячный платёж', 'Aylık taksit', 'القسط الشهري', 'החזר חודשי'],
  homi_card_loan: ['Loan amount', 'სესხის თანხა', 'Сумма кредита', 'Kredi tutarı', 'مبلغ القرض', 'סכום ההלוואה'],
  homi_card_total_interest: ['Total interest', 'ჯამური პროცენტი', 'Всего процентов', 'Toplam faiz', 'إجمالي الفائدة', 'סך הריבית'],
  homi_card_mortgage_note: [
    'Principal and interest only. Fees, insurance and the readiness check are in the Mortgage Consultant.',
    'მხოლოდ ძირი და პროცენტი. საკომისიოები, დაზღვევა და მზადყოფნის შეფასება იპოთეკის კონსულტანტშია.',
    'Только основной долг и проценты. Комиссии, страховка и оценка готовности — в ипотечном консультанте.',
    'Yalnızca anapara ve faiz. Masraflar, sigorta ve hazırlık değerlendirmesi konut kredisi danışmanında.',
    'الأصل والفائدة فقط. الرسوم والتأمين وتقييم الجاهزية في مستشار الرهن العقاري.',
    'קרן וריבית בלבד. עמלות, ביטוח ובדיקת מוכנות נמצאים ביועץ המשכנתאות.',
  ],
  homi_card_mortgage_empty: [
    'Enter the price and the interest rate and the payment appears straight away.',
    'შეიყვანე ფასი და საპროცენტო განაკვეთი, შენატანი კი მაშინვე გამოჩნდება.',
    'Введи цену и процентную ставку, и платёж сразу появится.',
    'Fiyatı ve faiz oranını gir, taksit hemen görünsün.',
    'أدخل السعر وسعر الفائدة وسيظهر القسط فورًا.',
    'הזן את המחיר והריבית וההחזר יופיע מיד.',
  ],
  homi_card_open_mortgage: ['Continue in the Mortgage Consultant', 'იპოთეკის კონსულტანტში გაგრძელება', 'Продолжить в ипотечном консультанте', 'Konut kredisi danışmanında devam et', 'المتابعة في مستشار الرهن العقاري', 'להמשיך ביועץ המשכנתאות'],
  homi_card_roi_title: ['Return on investment', 'ინვესტიციის უკუგება', 'Доходность инвестиции', 'Yatırım getirisi', 'عائد الاستثمار', 'תשואה על ההשקעה'],
  homi_card_rent: ['Expected monthly income (your assumption)', 'სავარაუდო ყოველთვიური შემოსავალი (შენი დაშვება)', 'Ожидаемый ежемесячный доход (твоё допущение)', 'Beklenen aylık gelir (senin varsayımın)', 'الدخل الشهري المتوقع (افتراضك)', 'הכנסה חודשית צפויה (ההנחה שלך)'],
  homi_card_vacancy: ['Empty months a year (your assumption)', 'ცარიელი თვეები წელიწადში (შენი დაშვება)', 'Пустые месяцы в году (твоё допущение)', 'Yılda boş aylar (senin varsayımın)', 'الأشهر الشاغرة في السنة (افتراضك)', 'חודשים ריקים בשנה (ההנחה שלך)'],
  homi_card_months: ['{{n}} mo.', '{{n}} თვე', '{{n}} мес.', '{{n}} ay', '{{n}} شهر', '{{n}} חודשים'],
  homi_card_expenses: ['Expected expenses per year', 'მოსალოდნელი ხარჯები წელიწადში', 'Ожидаемые расходы в год', 'Yıllık beklenen giderler', 'المصاريف المتوقعة سنويًا', 'הוצאות צפויות בשנה'],
  homi_card_net_monthly: ['Net income per month', 'წმინდა შემოსავალი თვეში', 'Чистый доход в месяц', 'Aylık net gelir', 'صافي الدخل شهريًا', 'הכנסה נטו לחודש'],
  homi_card_gross_yield: ['Gross yield', 'მთლიანი უკუგება', 'Валовая доходность', 'Brüt getiri', 'العائد الإجمالي', 'תשואה ברוטו'],
  homi_card_net_yield: ['Net yield', 'წმინდა უკუგება', 'Чистая доходность', 'Net getiri', 'صافي العائد', 'תשואה נטו'],
  homi_card_payback: ['Payback', 'ანაზღაურების ვადა', 'Окупаемость', 'Geri dönüş süresi', 'فترة الاسترداد', 'תקופת החזר'],
  homi_card_roi_note: [
    'Before tax and financing. Rent and empty months are your assumptions, not market data.',
    'გადასახადებამდე და დაფინანსების გარეშე. ქირა და ცარიელი თვეები შენი დაშვებებია და არა საბაზრო მონაცემები.',
    'До налогов и без финансирования. Аренда и пустые месяцы — твои допущения, а не рыночные данные.',
    'Vergi ve finansman öncesi. Kira ve boş aylar senin varsayımların, piyasa verisi değil.',
    'قبل الضرائب ودون تمويل. الإيجار والأشهر الشاغرة افتراضاتك وليست بيانات سوق.',
    'לפני מס ומימון. השכירות והחודשים הריקים הם ההנחות שלך, לא נתוני שוק.',
  ],
  homi_card_roi_empty: ['Enter the price and the expected rent.', 'შეიყვანე ფასი და მოსალოდნელი ქირა.', 'Введи цену и ожидаемую аренду.', 'Fiyatı ve beklenen kirayı gir.', 'أدخل السعر والإيجار المتوقع.', 'הזן את המחיר ואת השכירות הצפויה.'],
  homi_card_open_investment: ['Open the full investment analysis', 'სრული საინვესტიციო შეფასების გახსნა', 'Открыть полный инвестиционный анализ', 'Tam yatırım analizini aç', 'افتح تحليل الاستثمار الكامل', 'לפתוח את ניתוח ההשקעה המלא'],
};

/** Existing keys whose copy changes with the HOMI rename. */
export const HOMI_REBRAND_STRINGS = {
  ai_title: ['HOMI', 'HOMI', 'HOMI', 'HOMI', 'HOMI', 'HOMI'],
  ai_floating_label: ['Ask HOMI', 'ჰკითხე HOMI-ს', 'Спросить HOMI', "HOMI'ye sor", 'اسأل HOMI', 'שאל את HOMI'],
  ai_subtitle: ['Your personal HOMATCH assistant', 'HOMATCH-ის შენი პერსონალური ასისტენტი', 'Твой персональный ассистент HOMATCH', 'Kişisel HOMATCH asistanın', 'مساعدك الشخصي في HOMATCH', 'העוזר האישי שלך ב-HOMATCH'],
  ai_input_placeholder: ['Ask HOMI anything…', 'ჰკითხე HOMI-ს, რაც გაინტერესებს…', 'Спроси HOMI о чём угодно…', "HOMI'ye istediğini sor…", 'اسأل HOMI عن أي شيء…', 'שאל את HOMI כל דבר…'],
  ai_sign_in_prompt: ['Sign in to keep talking with HOMI', 'შედი და HOMI-სთან საუბარი გააგრძელე', 'Войди, чтобы продолжить разговор с HOMI', 'HOMI ile konuşmaya devam etmek için giriş yap', 'سجّل الدخول لمتابعة الحديث مع HOMI', 'התחבר כדי להמשיך לדבר עם HOMI'],
  ai_sign_in_desc: [
    'Your conversation is kept: signing in simply continues it. Talking with HOMI is free.',
    'საუბარი შენახულია: შესვლის შემდეგ უბრალოდ გააგრძელებ. HOMI-სთან საუბარი უფასოა.',
    'Разговор сохранён: после входа ты просто продолжишь его. Общение с HOMI бесплатное.',
    'Sohbetin kayıtlı: giriş yapınca kaldığın yerden devam edersin. HOMI ile konuşmak ücretsiz.',
    'محادثتك محفوظة: بعد تسجيل الدخول ستتابعها ببساطة. الحديث مع HOMI مجاني.',
    'השיחה שלך נשמרת: אחרי ההתחברות פשוט ממשיכים. השיחה עם HOMI בחינם.',
  ],
  ai_disclaimer: [
    'HOMI can make mistakes. Check important information independently.',
    'HOMI შეიძლება შეცდეს. მნიშვნელოვანი ინფორმაცია დამოუკიდებლად გადაამოწმე.',
    'HOMI может ошибаться. Важную информацию проверяй самостоятельно.',
    'HOMI hata yapabilir. Önemli bilgileri bağımsız olarak doğrula.',
    'قد يخطئ HOMI. تحقّق من المعلومات المهمة بنفسك.',
    'HOMI עלול לטעות. כדאי לבדוק מידע חשוב באופן עצמאי.',
  ],
};
