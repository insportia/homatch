/*
 * PART 1 — the calculator, the answer, the consultant, the tools, and
 * the financing picture.
 *
 * THE RULE THIS FILE IS WRITTEN UNDER
 *
 * A person who has never taken a loan reads every sentence here and
 * understands it the first time. That is not "simpler words on the same
 * sentence"; several of these replace copy that was accurate, literary
 * and useless at a bank counter.
 *
 * Concretely, for the Georgian:
 *
 *   ONE VOICE. Second person singular, the way a friend speaks. The page
 *   used to mix შეავსე with შეავსეთ inside one screen, which reads as
 *   two different products talking over each other.
 *
 *   NO INTERNAL VOCABULARY IN A CUSTOMER SENTENCE. "ეფექტური განაკვეთი"
 *   is what the industry calls it; "რეალური წლიური ხარჯი" is what it is.
 *   PTI and LTV keep their acronyms as a small secondary label and lead
 *   with what they measure.
 *
 *   NO EM DASHES, NO SEMICOLONS, NO HEADINGS ENDING IN A FULL STOP, and
 *   no parenthesis holding an explanation that belongs in the sentence.
 *
 *   ONE THOUGHT PER SENTENCE, and the sentence stops when the thought
 *   does. "რეალური ღირებულება გამოცხადებულ განაკვეთზე 0.80 პროცენტული
 *   პუნქტით მაღალია — დაახლოებით იმდენი, რამდენსაც მხოლოდ თვიური
 *   კაპიტალიზაცია იძლევა" is two thoughts, one dash and a word nobody
 *   outside a bank has said out loud.
 *
 * key -> [en, ka, ru, tr, ar, he].
 */

export const PART_1 = {
  /* ── The five fields ─────────────────────────────────────────────── */

  mortgage_label_nominal_rate: [
    'Annual rate',
    'წლიური განაკვეთი',
    'Годовая ставка',
    'Yıllık faiz',
    'النسبة السنوية',
    'ריבית שנתית',
  ],
  mortgage_label_term_years: [
    'Loan term in years',
    'სესხის ვადა წლებში',
    'Срок кредита в годах',
    'Kredi vadesi, yıl olarak',
    'مدة القرض بالسنوات',
    'תקופת ההלוואה בשנים',
  ],
  mortgage_calc_error_missing: [
    'Fill this in and we can calculate.',
    'შეავსე ეს ველი და დავთვლით.',
    'Заполните это поле, и мы посчитаем.',
    'Bunu doldurun, hesaplayalım.',
    'املأ هذا الحقل ولنحسب.',
    'מלאו את השדה הזה ונחשב.',
  ],
  mortgage_calc_error_down_too_big: [
    'The down payment has to be smaller than the price.',
    'პირველადი შენატანი ფასზე ნაკლები უნდა იყოს.',
    'Первоначальный взнос должен быть меньше цены.',
    'Peşinat, fiyattan küçük olmalı.',
    'الدفعة الأولى يجب أن تكون أقل من السعر.',
    'המקדמה צריכה להיות קטנה מהמחיר.',
  ],

  /* ── The answer ──────────────────────────────────────────────────── */

  /*
   * THE SENTENCE THAT PRINTED {{monthly}}.
   *
   * The call site passes `amount` and `years`. An override written
   * straight into the database named the hole {{monthly}}, nothing
   * filled it, and six literal braces stood where the price of a house
   * should have been. The Georgian here is the owner's own wording with
   * the hole spelled the way the call site fills it.
   */
  mortgage_result_sentence: [
    'On these terms you pay about {{amount}} a month for {{years}} years.',
    'ამ პირობებით თვეში დაახლოებით {{amount}} გადაიხდი {{years}} წლის განმავლობაში.',
    'На этих условиях вы будете платить около {{amount}} в месяц в течение {{years}} лет.',
    'Bu koşullarda {{years}} yıl boyunca ayda yaklaşık {{amount}} ödersiniz.',
    'بهذه الشروط تدفع نحو {{amount}} شهريًا لمدة {{years}} سنة.',
    'בתנאים האלה תשלמו כ-{{amount}} בחודש במשך {{years}} שנים.',
  ],

  /* ── The consultant ──────────────────────────────────────────────── */

  /*
   * "What changes if I choose 15 years?" was a constant, and the
   * owner's own scenario is an eight-year loan: the chip offered a
   * LONGER term under the heading of saving money. It takes the next
   * shorter rung of the term ladder now, and is not offered at all
   * when there is no shorter rung.
   */
  mortgage_ask_shorter_term: [
    'What changes if I choose {{years}} years?',
    'რა შეიცვლება, თუ {{years}} წელს ავირჩევ?',
    'Что изменится, если выбрать {{years}} лет?',
    '{{years}} yıl seçersem ne değişir?',
    'ما الذي يتغيّر إذا اخترت {{years}} سنوات؟',
    'מה משתנה אם אבחר {{years}} שנים?',
  ],

  /* One register. The other openers already speak in the singular;
     this one said ამიხსენით and sounded like a different person. */
  mortgage_ask_explain_effective: [
    'Explain the real rate simply',
    'მარტივად ამიხსენი რეალური განაკვეთი',
    'Объясни реальную ставку простыми словами',
    'Gerçek oranı basitçe anlat',
    'اشرح لي النسبة الحقيقية ببساطة',
    'תסביר לי בפשטות את הריבית האמיתית',
  ],
  mortgage_consultant_limit: [
    'That is the free questions used up for now. Sign in and we carry on.',
    'უფასო კითხვები ჯერჯერობით ამოიწურა. შედი და გავაგრძელოთ.',
    'Бесплатные вопросы пока закончились. Войдите, и продолжим.',
    'Ücretsiz sorular şimdilik bitti. Giriş yapın, devam edelim.',
    'انتهت الأسئلة المجانية في الوقت الحالي. سجّل الدخول ولنكمل.',
    'השאלות החינמיות נגמרו לעכשיו. התחברו ונמשיך.',
  ],
  mortgage_sign_in_to_save: [
    'Sign in and this calculation is here when you come back',
    'შედი და ეს გამოთვლა დაბრუნებისას აქვე დაგხვდება',
    'Войдите, и этот расчёт будет ждать вас здесь',
    'Giriş yapın, bu hesap döndüğünüzde burada olsun',
    'سجّل الدخول وسيبقى هذا الحساب في انتظارك',
    'התחברו והחישוב הזה יחכה לכם כאן',
  ],

  /* The button every card ends with, and the only way into the chat
     from outside it. See src/components/mortgage/askConsultant.tsx. */
  mortgage_ask_homatch: [
    'Ask Homatch',
    'ჰკითხე Homatch-ს',
    'Спросить Homatch',
    "Homatch'a sor",
    'اسأل Homatch',
    'שאלו את Homatch',
  ],

  /* ── The five optional tools ─────────────────────────────────────── */

  mortgage_tools_title: [
    'More calculations',
    'დამატებითი გამოთვლები',
    'Дополнительные расчёты',
    'Ek hesaplamalar',
    'حسابات إضافية',
    'חישובים נוספים',
  ],
  mortgage_tools_sub: [
    'Open one if you want to compare options in more detail.',
    'თუ გინდა, შეგიძლია უფრო დეტალურად შეადარო სხვადასხვა ვარიანტი.',
    'Откройте, если хотите сравнить варианты подробнее.',
    'Seçenekleri daha ayrıntılı karşılaştırmak isterseniz birini açın.',
    'افتح واحدة إن أردت مقارنة الخيارات بتفصيل أكبر.',
    'פתחו אחד אם תרצו להשוות אפשרויות לעומק.',
  ],

  /*
   * WHAT EACH TOOL ANSWERS, IN ONE SENTENCE, BEFORE THE FORM.
   *
   * A panel that opens straight into three empty fields makes somebody
   * work out what they are being asked for and why. One line first,
   * naming the question the tool answers, costs a second to read and
   * saves the person deciding whether to bother.
   */
  mortgage_tool_intro_early_repayment: [
    'See how much sooner you finish, and how much interest you avoid, if you pay extra.',
    'ნახე, რამდენად ადრე დაასრულებ და რამდენ პროცენტს აირიდებ, თუ დამატებით გადაიხდი.',
    'Посмотрите, насколько раньше закончите и сколько процентов сэкономите, если платить больше.',
    'Fazladan ödeme yaparsanız ne kadar erken bitireceğinizi ve ne kadar faizden kurtulacağınızı görün.',
    'اطّلع على كم ستنتهي أبكر وكم فائدة ستوفّر إذا دفعت مبالغ إضافية.',
    'ראו בכמה תסיימו מוקדם יותר וכמה ריבית תחסכו אם תשלמו יותר.',
  ],
  mortgage_tool_intro_compare_offers: [
    'Put two or three bank offers side by side and see which costs less in total.',
    'დადე ორი ან სამი ბანკის შეთავაზება გვერდიგვერდ და ნახე, რომელი ჯდება ნაკლები.',
    'Поставьте два-три банковских предложения рядом и посмотрите, какое дешевле в сумме.',
    'İki ya da üç banka teklifini yan yana koyun, toplamda hangisi daha ucuz görün.',
    'ضع عرضين أو ثلاثة من البنوك جنبًا إلى جنب وانظر أيها أقل تكلفة في المجموع.',
    'הניחו שתיים-שלוש הצעות בנק זו לצד זו וראו איזו עולה פחות בסך הכול.',
  ],
  mortgage_tool_intro_affordability: [
    'Tell us your income and we show how heavy this payment is, and what price fits it.',
    'გვითხარი შემოსავალი და გაჩვენებთ, რამდენად მძიმეა ეს გადასახადი და რა ფასი გერგება.',
    'Укажите доход, и мы покажем, насколько тяжёл этот платёж и какая цена вам подходит.',
    'Gelirinizi söyleyin, bu ödemenin ne kadar ağır olduğunu ve size hangi fiyatın uyduğunu gösterelim.',
    'أخبرنا بدخلك ونُظهر لك ثقل هذا القسط وأي سعر يناسبك.',
    'ספרו לנו על ההכנסה ונראה כמה התשלום הזה כבד ואיזה מחיר מתאים לכם.',
  ],
  mortgage_tool_intro_refinancing: [
    'Already have a loan? See whether moving it to a new rate is worth the cost of moving.',
    'უკვე გაქვს სესხი? ნახე, ღირს თუ არა ახალ განაკვეთზე გადასვლა გადასვლის ხარჯის გათვალისწინებით.',
    'Уже есть кредит? Посмотрите, окупится ли переход на новую ставку.',
    'Krediniz var mı? Yeni bir orana geçmenin, geçiş masrafına değip değmediğini görün.',
    'لديك قرض بالفعل؟ انظر هل يستحق الانتقال إلى نسبة جديدة تكلفة الانتقال.',
    'כבר יש הלוואה? בדקו אם מעבר לריבית חדשה שווה את עלות המעבר.',
  ],
  mortgage_tool_intro_programs: [
    'Check whether your details appear to match the published conditions of the state subsidy.',
    'შეამოწმე, ემთხვევა თუ არა შენი მონაცემები სახელმწიფო სუბსიდიის გამოქვეყნებულ პირობებს.',
    'Проверьте, похоже ли, что ваши данные отвечают опубликованным условиям государственной субсидии.',
    'Bilgilerinizin devlet sübvansiyonunun yayımlanmış koşullarına uyup uymadığını kontrol edin.',
    'تحقّق مما إذا كانت بياناتك تطابق الشروط المنشورة لدعم الدولة.',
    'בדקו אם הפרטים שלכם מתאימים לתנאים שפורסמו של הסבסוד הממשלתי.',
  ],

  /* ── The financing picture ───────────────────────────────────────── */

  mortgage_pic_title: [
    'Your financing picture',
    'შენი დაფინანსების სურათი',
    'Картина вашего финансирования',
    'Finansman tablonuz',
    'صورة تمويلك',
    'תמונת המימון שלכם',
  ],
  mortgage_pic_eyebrow: [
    'The main numbers in one place',
    'მთავარი ციფრები ერთ ადგილას',
    'Главные цифры в одном месте',
    'Ana rakamlar tek yerde',
    'الأرقام الأساسية في مكان واحد',
    'המספרים העיקריים במקום אחד',
  ],
  mortgage_pic_effective: [
    'Real yearly cost',
    'რეალური წლიური ხარჯი',
    'Реальная годовая стоимость',
    'Gerçek yıllık maliyet',
    'التكلفة السنوية الحقيقية',
    'העלות השנתית האמיתית',
  ],
  mortgage_pic_total_cost: [
    'What borrowing costs you',
    'რა გიჯდება სესხის აღება',
    'Во что обходится заём',
    'Borçlanmanın size maliyeti',
    'ما يكلّفك الاقتراض',
    'כמה עולה לכם ההלוואה',
  ],

  /*
   * PTI AND LTV, SAID IN WORDS FIRST.
   *
   * Two acronyms stood alone above two numbers. Somebody who does not
   * already know them learns nothing from either, and somebody who does
   * loses nothing by reading the words. The acronym stays as the small
   * second line, because it is what a bank will say back to them.
   */
  mortgage_pic_pti: [
    'Share of income',
    'შემოსავლის რა ნაწილი მიდის',
    'Какая часть дохода уходит',
    'Gelirin ne kadarı gidiyor',
    'كم من الدخل يذهب',
    'איזה חלק מההכנסה הולך',
  ],
  mortgage_pic_ltv: [
    'Share of the price financed',
    'ფასის რა ნაწილს ფარავს სესხი',
    'Какую часть цены покрывает кредит',
    'Fiyatın ne kadarını kredi karşılıyor',
    'كم من السعر يغطّيه القرض',
    'איזה חלק מהמחיר ההלוואה מכסה',
  ],
  mortgage_pic_pti_sub: [
    'PTI, the payment-to-income ratio',
    'PTI, გადასახადის შეფარდება შემოსავალთან',
    'PTI, отношение платежа к доходу',
    'PTI, ödemenin gelire oranı',
    'PTI، نسبة القسط إلى الدخل',
    'PTI, יחס ההחזר להכנסה',
  ],
  mortgage_pic_ltv_sub: [
    'LTV, the loan-to-value ratio',
    'LTV, სესხის შეფარდება ქონების ფასთან',
    'LTV, отношение кредита к стоимости',
    'LTV, kredinin değere oranı',
    'LTV، نسبة القرض إلى قيمة العقار',
    'LTV, יחס ההלוואה לשווי',
  ],

  /*
   * THE THREE LISTS, AND WHY THE FIRST ONE CHANGED ITS NAME.
   *
   * It used to be "Looks comfortable", and the effective rate sitting
   * 0.8 points above the advertised one was filed under it. That is not
   * comfort, it is arithmetic: monthly compounding does it on its own
   * and it says nothing about whether the loan is a good one. Calling it
   * good was the product handing out an opinion it has no basis for,
   * which is the same thing financingPicture.ts refuses to do with a
   * score. So the list is now what it always actually held: the things
   * we already know.
   */
  mortgage_pic_known: [
    'What we already know',
    'რაც უკვე ვიცით',
    'Что мы уже знаем',
    'Şu an bildiklerimiz',
    'ما نعرفه بالفعل',
    'מה שכבר ידוע',
  ],
  mortgage_pic_attention: [
    'Worth paying attention to',
    'რას უნდა მიაქციო ყურადღება',
    'На что стоит обратить внимание',
    'Dikkat etmeniz gerekenler',
    'ما يستحق انتباهك',
    'למה כדאי לשים לב',
  ],
  mortgage_pic_missing: [
    'What we are still missing',
    'რა ინფორმაცია გვაკლია',
    'Какой информации не хватает',
    'Hâlâ eksik olan bilgiler',
    'المعلومات التي ما زالت ناقصة',
    'איזה מידע עוד חסר',
  ],

  mortgage_picture_pti_under: [
    'The payment takes about {{pti}}% of your income. The published limit is {{limit}}%.',
    'გადასახადი შენი შემოსავლის დაახლოებით {{pti}}%-ს იღებს. გამოქვეყნებული ზღვარია {{limit}}%.',
    'Платёж забирает около {{pti}}% дохода. Опубликованный лимит — {{limit}}%.',
    'Ödeme gelirinizin yaklaşık %{{pti}} kadarını alıyor. Yayımlanan sınır %{{limit}}.',
    'يأخذ القسط نحو {{pti}}% من دخلك. الحد المنشور هو {{limit}}%.',
    'ההחזר לוקח כ-{{pti}}% מההכנסה. המגבלה שפורסמה היא {{limit}}%.',
  ],
  mortgage_picture_pti_near: [
    'The payment takes about {{pti}}% of your income. That is already a big share, so there is little room left for other loans and everyday spending.',
    'თვიური გადასახადი შენი შემოსავლის დაახლოებით {{pti}}%-ია. ეს უკვე დიდი ნაწილია, ამიტომ სხვა სესხებისა და ყოველდღიური ხარჯებისთვის ნაკლები ადგილი გრჩება.',
    'Платёж забирает около {{pti}}% дохода. Это уже большая доля, поэтому на другие кредиты и повседневные расходы остаётся немного.',
    'Ödeme gelirinizin yaklaşık %{{pti}} kadarını alıyor. Bu zaten büyük bir pay, diğer krediler ve günlük harcamalar için az yer kalıyor.',
    'يأخذ القسط نحو {{pti}}% من دخلك. هذه حصة كبيرة بالفعل، فيبقى مجال أقل للقروض الأخرى وللمصروف اليومي.',
    'ההחזר לוקח כ-{{pti}}% מההכנסה. זה כבר חלק גדול, ולכן נשאר פחות מקום להלוואות אחרות ולהוצאות היומיום.',
  ],
  mortgage_picture_pti_over: [
    'The payment takes about {{pti}}% of your income, above the published limit of {{limit}}%. A bank that applies that limit could not give this loan as entered.',
    'თვიური გადასახადი შენი შემოსავლის დაახლოებით {{pti}}%-ია, რაც გამოქვეყნებულ {{limit}}% ზღვარს აღემატება. ბანკი, რომელიც ამ ზღვარს იცავს, ამ სესხს ასე ვერ გასცემს.',
    'Платёж забирает около {{pti}}% дохода, это выше опубликованного лимита в {{limit}}%. Банк, который его применяет, такой кредит не выдаст.',
    'Ödeme gelirinizin yaklaşık %{{pti}} kadarını alıyor, yayımlanan %{{limit}} sınırının üzerinde. Bu sınırı uygulayan bir banka krediyi bu haliyle veremez.',
    'يأخذ القسط نحو {{pti}}% من دخلك، أي أعلى من الحد المنشور {{limit}}%. البنك الذي يطبّق هذا الحد لن يمنح القرض بهذه الصورة.',
    'ההחזר לוקח כ-{{pti}}% מההכנסה, מעל המגבלה שפורסמה של {{limit}}%. בנק שמיישם אותה לא ייתן את ההלוואה כפי שהוזנה.',
  ],
  mortgage_picture_ltv_under: [
    'The bank would finance {{ltv}}% of the price. The published limit is {{limit}}%.',
    'ბანკი ქონების ფასის {{ltv}}%-ს დააფინანსებს. გამოქვეყნებული ზღვარია {{limit}}%.',
    'Банк профинансирует {{ltv}}% цены. Опубликованный лимит — {{limit}}%.',
    'Banka fiyatın %{{ltv}} kadarını finanse eder. Yayımlanan sınır %{{limit}}.',
    'سيموّل البنك {{ltv}}% من السعر. الحد المنشور هو {{limit}}%.',
    'הבנק יממן {{ltv}}% מהמחיר. המגבלה שפורסמה היא {{limit}}%.',
  ],
  mortgage_picture_ltv_near: [
    'The bank would finance {{ltv}}% of the price, close to the published limit of {{limit}}%. A valuation below the price would push it over.',
    'ბანკი ქონების ფასის {{ltv}}%-ს დააფინანსებს, რაც ახლოსაა გამოქვეყნებულ {{limit}}% ზღვართან. ფასზე დაბალი შეფასება ზღვარს გადააცილებს.',
    'Банк профинансирует {{ltv}}% цены — близко к лимиту {{limit}}%. Оценка ниже цены выведет за него.',
    'Banka fiyatın %{{ltv}} kadarını finanse eder, yayımlanan %{{limit}} sınırına yakın. Fiyatın altında bir ekspertiz sınırı aşırır.',
    'سيموّل البنك {{ltv}}% من السعر، قريبًا من الحد المنشور {{limit}}%. تقييم أقل من السعر سيتجاوزه.',
    'הבנק יממן {{ltv}}% מהמחיר, קרוב למגבלה של {{limit}}%. שמאות נמוכה מהמחיר תעבור אותה.',
  ],
  mortgage_picture_ltv_over: [
    'You need the bank to finance {{ltv}}% of the price, above the published limit of {{limit}}%. A larger down payment brings the loan and the monthly payment down.',
    'ბანკისგან ქონების ფასის {{ltv}}%-ის დაფინანსება გჭირდება, რაც გამოქვეყნებულ {{limit}}% ზღვარს აღემატება. უფრო დიდი პირველადი შენატანი სესხის თანხასა და თვიურ გადასახადს შეამცირებს.',
    'Вам нужно, чтобы банк профинансировал {{ltv}}% цены, это выше лимита {{limit}}%. Больший первоначальный взнос уменьшит и кредит, и платёж.',
    'Bankanın fiyatın %{{ltv}} kadarını finanse etmesi gerekiyor, yayımlanan %{{limit}} sınırının üzerinde. Daha büyük bir peşinat krediyi ve aylık ödemeyi düşürür.',
    'تحتاج أن يموّل البنك {{ltv}}% من السعر، أي فوق الحد المنشور {{limit}}%. دفعة أولى أكبر تخفّض القرض والقسط الشهري.',
    'אתם צריכים שהבנק יממן {{ltv}}% מהמחיר, מעל המגבלה של {{limit}}%. מקדמה גדולה יותר מקטינה את ההלוואה ואת ההחזר.',
  ],
  mortgage_picture_rate_gap: [
    'The loan really costs you {{gap}} percentage points more than the rate the bank quotes. The extra comes from fees, so ask which ones apply.',
    'სესხი შენ რეალურად {{gap}} პროცენტული პუნქტით მეტი გიჯდება, ვიდრე ბანკის გამოცხადებული განაკვეთი. სხვაობას საკომისიოები ქმნის, ამიტომ ჰკითხე, რომელი მოქმედებს.',
    'Кредит на самом деле обходится на {{gap}} процентных пункта дороже заявленной ставки. Разницу создают комиссии, спросите, какие именно.',
    'Kredi aslında bankanın söylediği orandan {{gap}} puan daha pahalıya geliyor. Farkı ücretler yaratıyor, hangileri geçerli diye sorun.',
    'القرض يكلّفك فعليًا {{gap}} نقطة مئوية أكثر من النسبة المعلنة. الفارق سببه الرسوم، فاسأل أيها ينطبق.',
    'ההלוואה עולה לכם בפועל {{gap}} נקודות אחוז יותר מהריבית שהבנק מציג. ההפרש מגיע מעמלות, אז שאלו אילו חלות.',
  ],
  mortgage_picture_rate_close: [
    'The rate the bank quotes is {{gap}} percentage points below what the loan really costs. A gap this small is just how monthly interest adds up.',
    'ბანკის გამოცხადებული განაკვეთი სესხის რეალურ ხარჯზე {{gap}} პროცენტული პუნქტით ნაკლებია. ასეთი მცირე სხვაობა უბრალოდ თვიური დარიცხვის შედეგია.',
    'Заявленная ставка на {{gap}} процентных пункта ниже реальной стоимости. Такая небольшая разница — просто результат ежемесячного начисления.',
    'Bankanın söylediği oran, gerçek maliyetin {{gap}} puan altında. Bu kadar küçük bir fark, faizin aylık işlemesinden geliyor.',
    'النسبة المعلنة أقل من التكلفة الحقيقية بـ {{gap}} نقطة مئوية. فارق بهذا الصغر ناتج عن احتساب الفائدة شهريًا.',
    'הריבית שהבנק מציג נמוכה ב-{{gap}} נקודות אחוז מהעלות האמיתית. פער כזה קטן נובע פשוט מצבירה חודשית.',
  ],
  mortgage_picture_rate_fixed: [
    'The rate is fixed, so the monthly payment stays where it is.',
    'განაკვეთი ფიქსირებულია, ამიტომ თვიური გადასახადი არ შეიცვლება.',
    'Ставка фиксированная, поэтому ежемесячный платёж не изменится.',
    'Faiz sabit, bu yüzden aylık ödeme değişmez.',
    'النسبة ثابتة، لذلك القسط الشهري لا يتغيّر.',
    'הריבית קבועה, ולכן ההחזר החודשי לא ישתנה.',
  ],
  /*
   * "განაკვეთი {{type}}-ია" put a hyphen between a Georgian adjective
   * and its copula, which is the form reserved for foreign words and
   * abbreviations: it read as "the rate is Fixed-is". Interpolation
   * cannot inflect, so the sentence is built around a label instead of
   * around an adjective, which works in all six languages.
   */
  mortgage_picture_rate_not_fixed: [
    'Rate type: {{type}}. That means the payment can change, so ask what it follows and how often it is reset.',
    'განაკვეთის ტიპია {{type}}. ეს ნიშნავს, რომ გადასახადი შეიძლება შეიცვალოს, ამიტომ ჰკითხე, რას მიჰყვება და რამდენად ხშირად გადაიხედება.',
    'Тип ставки: {{type}}. Значит, платёж может измениться, поэтому спросите, к чему она привязана и как часто пересматривается.',
    'Faiz türü: {{type}}. Bu, ödemenin değişebileceği anlamına gelir; neye bağlı ve ne sıklıkla güncelleniyor diye sorun.',
    'نوع النسبة: {{type}}. هذا يعني أن القسط قد يتغيّر، فاسأل بماذا ترتبط وكم مرة تُراجع.',
    'סוג הריבית: {{type}}. כלומר ההחזר עשוי להשתנות, אז שאלו למה היא צמודה וכל כמה זמן היא מתעדכנת.',
  ],
  mortgage_picture_fx: [
    'The loan is in {{currency}}. If you are not paid in {{currency}}, a change in the exchange rate can raise your monthly payment.',
    'სესხი {{currency}}-შია. თუ შემოსავალი {{currency}}-ში არ გაქვს, კურსის ცვლილებამ შეიძლება თვიური ხარჯი გაგიზარდოს.',
    'Кредит в {{currency}}. Если доход у вас не в {{currency}}, изменение курса может увеличить платёж.',
    'Kredi {{currency}} cinsinden. Geliriniz {{currency}} değilse, kur değişimi aylık ödemeyi artırabilir.',
    'القرض بعملة {{currency}}. إذا لم يكن دخلك بـ {{currency}}، فتغيّر سعر الصرف قد يرفع قسطك الشهري.',
    'ההלוואה ב-{{currency}}. אם ההכנסה שלכם אינה ב-{{currency}}, שינוי בשער יכול להעלות את ההחזר.',
  ],
  mortgage_picture_missing_income: [
    'We do not know your monthly income yet. Without it we cannot say how heavy this payment would be for you.',
    'შენი თვიური შემოსავალი ჯერ არ ვიცით. მის გარეშე ვერ ვიტყვით, რამდენად მძიმე იქნება ეს გადასახადი შენთვის.',
    'Мы пока не знаем ваш месячный доход. Без него нельзя сказать, насколько тяжёлым будет платёж.',
    'Aylık gelirinizi henüz bilmiyoruz. Onsuz bu ödemenin sizin için ne kadar ağır olacağını söyleyemeyiz.',
    'لا نعرف دخلك الشهري بعد. بدونه لا يمكننا القول كم سيكون هذا القسط ثقيلًا عليك.',
    'עדיין לא ידועה ההכנסה החודשית שלכם. בלעדיה אי אפשר לומר כמה ההחזר הזה כבד עבורכם.',
  ],
  mortgage_picture_missing_costs: [
    'There are {{n}} kinds of cost you have not entered. If your loan has them, the real cost goes up.',
    '{{n}} სახის ხარჯი ჯერ არ შეგიყვანია. თუ შენს სესხს აქვს, რეალური ღირებულება გაიზრდება.',
    'Есть {{n}} видов расходов, которые вы не внесли. Если они в вашем кредите есть, реальная стоимость вырастет.',
    'Girmediğiniz {{n}} tür masraf var. Kredinizde varsa gerçek maliyet artar.',
    'هناك {{n}} أنواع من التكاليف لم تُدخلها. إن كانت في قرضك، سترتفع التكلفة الحقيقية.',
    'יש {{n}} סוגי עלויות שלא הזנתם. אם הן קיימות בהלוואה, העלות האמיתית תעלה.',
  ],
  mortgage_picture_missing_rate_type: [
    'We do not know yet whether the rate is fixed or can change later. Check that with the bank.',
    'ჯერ არ ვიცით, პროცენტი ფიქსირებულია თუ მომავალში შეიძლება შეიცვალოს. ეს ბანკთან აუცილებლად გადაამოწმე.',
    'Мы пока не знаем, фиксированная ставка или может измениться. Уточните это в банке.',
    'Faizin sabit mi olduğunu yoksa değişebilir mi olduğunu henüz bilmiyoruz. Bunu bankaya sorun.',
    'لا نعرف بعد إن كانت النسبة ثابتة أم قد تتغيّر لاحقًا. تحقّق من ذلك مع البنك.',
    'עדיין לא ידוע אם הריבית קבועה או עשויה להשתנות. בדקו זאת מול הבנק.',
  ],
  mortgage_picture_missing_early_fee: [
    'We do not know what the bank charges for repaying early. That matters if you plan to pay a large sum in or close the loan sooner.',
    'ჯერ არ ვიცით, რას გადაგახდევინებს ბანკი სესხის ადრე დაფარვაში. ეს მნიშვნელოვანია, თუ დიდი თანხის შეტანას ან სესხის ადრე დახურვას გეგმავ.',
    'Мы не знаем, сколько банк берёт за досрочное погашение. Это важно, если планируете внести крупную сумму или закрыть кредит раньше.',
    'Bankanın erken kapamadan ne kadar aldığını bilmiyoruz. Büyük bir ödeme yapmayı ya da krediyi erken kapatmayı düşünüyorsanız bu önemli.',
    'لا نعرف ما يتقاضاه البنك مقابل السداد المبكر. هذا مهم إن كنت تخطّط لدفع مبلغ كبير أو إغلاق القرض مبكرًا.',
    'לא ידוע מה הבנק גובה על פירעון מוקדם. זה חשוב אם אתם מתכננים להכניס סכום גדול או לסגור את ההלוואה מוקדם.',
  ],
  mortgage_picture_missing_pti_rule: [
    'No published income limit matches this income and currency, so the figure stands on its own.',
    'ამ შემოსავალსა და ვალუტას გამოქვეყნებული ზღვარი არ შეესაბამება, ამიტომ ციფრი დამოუკიდებლად დგას.',
    'Опубликованного лимита для такого дохода и валюты нет, поэтому цифра стоит сама по себе.',
    'Bu gelir ve para birimi için yayımlanmış bir sınır yok, bu yüzden rakam kendi başına duruyor.',
    'لا يوجد حد منشور يطابق هذا الدخل وهذه العملة، لذا يبقى الرقم قائمًا بذاته.',
    'אין מגבלה שפורסמה שמתאימה להכנסה ולמטבע האלה, ולכן המספר עומד בפני עצמו.',
  ],
  mortgage_picture_missing_ltv_rule: [
    'No published financing limit matches this currency, so the figure stands on its own.',
    'ამ ვალუტას გამოქვეყნებული ზღვარი არ შეესაბამება, ამიტომ ციფრი დამოუკიდებლად დგას.',
    'Опубликованного лимита для этой валюты нет, поэтому цифра стоит сама по себе.',
    'Bu para birimi için yayımlanmış bir sınır yok, bu yüzden rakam kendi başına duruyor.',
    'لا يوجد حد منشور يطابق هذه العملة، لذا يبقى الرقم قائمًا بذاته.',
    'אין מגבלה שפורסמה למטבע הזה, ולכן המספר עומד בפני עצמו.',
  ],
};
