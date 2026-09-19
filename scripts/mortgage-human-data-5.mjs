/*
 * PART 5 — the page itself, the details section, and the errors.
 *
 * Most of the Georgian here is the owner's, written straight into
 * app_content on 19 September. It is repeated in the bundle so that the
 * shipped copy and the live copy are the same words rather than two
 * sources with the database quietly winning, and the other five
 * languages are brought to the same register.
 *
 * Two of the replacements are not stylistic:
 *
 *   mortgage_opening_promise used the "არა მხოლოდ X, არამედ Y"
 *   construction, which is the single most recognisable tell of
 *   machine-written Georgian and is on the brief's banned list.
 *
 *   mortgage_details_missing_costs listed the names of the cost classes
 *   after a dash. Naming them is useful; the dash and the count made it
 *   read like a log line, and the same names are already shown as chips
 *   one section down where they have room.
 *
 * key -> [en, ka, ru, tr, ar, he].
 */

export const PART_5 = {
  /* ── The page ────────────────────────────────────────────────────── */

  mortgage_product_eyebrow: [
    'Mortgage',
    'იპოთეკა',
    'Ипотека',
    'Konut kredisi',
    'القرض العقاري',
    'משכנתה',
  ],
  mortgage_page_title: [
    'Mortgage AI Consultant',
    'იპოთეკის AI კონსულტანტი',
    'ИИ-консультант по ипотеке',
    'Yapay zekâ konut kredisi danışmanı',
    'مستشار القروض العقارية بالذكاء الاصطناعي',
    'יועץ המשכנתאות של Homatch',
  ],
  mortgage_opening_promise: [
    'Enter your loan terms and see what you pay each month, what you pay in total, and how the answer changes on different terms.',
    'შეიყვანე სესხის პირობები და მარტივად ნახე, რამდენი გექნება გადასახდელი თვეში, რამდენს გადაიხდი მთლიანად და როგორ შეგიძლია ხარჯის შემცირება.',
    'Введите условия кредита и посмотрите, сколько платить в месяц, сколько всего и как результат меняется при других условиях.',
    'Kredi koşullarınızı girin; ayda ne ödeyeceğinizi, toplamda ne ödeyeceğinizi ve koşullar değişince sonucun nasıl değiştiğini görün.',
    'أدخل شروط القرض وانظر كم تدفع شهريًا، وكم تدفع في المجموع، وكيف تتغيّر النتيجة بشروط أخرى.',
    'הזינו את תנאי ההלוואה וראו כמה תשלמו בחודש, כמה בסך הכול, ואיך התוצאה משתנה בתנאים אחרים.',
  ],
  mortgage_page_subtitle: [
    'Enter five things and see what the loan really costs. Then ask about it.',
    'შეიყვანე ხუთი მონაცემი და ნახე, რეალურად რა ჯდება სესხი. მერე კი მკითხე.',
    'Введите пять значений и узнайте реальную стоимость кредита. А потом спрашивайте.',
    'Beş bilgi girin ve kredinin gerçek maliyetini görün. Sonra sorun.',
    'أدخل خمس معلومات وانظر التكلفة الحقيقية للقرض. ثم اسأل.',
    'הזינו חמישה נתונים וראו כמה ההלוואה באמת עולה. ואז שאלו.',
  ],
  mortgage_currency_denomination_note: [
    'Pick the currency you want the loan worked out in. Nothing is converted here.',
    'აირჩიე ვალუტა, რომელშიც სესხის დათვლა გინდა. ვალუტის გადაყვანა აქ არ ხდება.',
    'Выберите валюту, в которой хотите посчитать кредит. Конвертации здесь нет.',
    'Kredinin hesaplanmasını istediğiniz para birimini seçin. Burada çevrim yapılmaz.',
    'اختر العملة التي تريد حساب القرض بها. لا يوجد تحويل هنا.',
    'בחרו את המטבע שבו תרצו לחשב את ההלוואה. אין כאן המרה.',
  ],
  mortgage_calc_rate_hint: [
    'Enter the annual rate the bank offered you.',
    'ჩაწერე ბანკის მიერ შემოთავაზებული წლიური პროცენტი.',
    'Введите годовую ставку, которую предложил банк.',
    'Bankanın size sunduğu yıllık faizi girin.',
    'أدخل النسبة السنوية التي عرضها عليك البنك.',
    'הזינו את הריבית השנתית שהבנק הציע לכם.',
  ],
  mortgage_start_over: [
    'Start over',
    'თავიდან დაწყება',
    'Начать заново',
    'Baştan başla',
    'ابدأ من جديد',
    'להתחיל מחדש',
  ],
  mortgage_global_disclaimer: [
    'Homatch calculations are for information only and are not a bank offer or a pre-approval. Confirm the final terms directly with your bank.',
    'Homatch-ის გამოთვლები საინფორმაციო მიზნებისთვისაა და ბანკის შეთავაზებას ან წინასწარ დამტკიცებას არ წარმოადგენს. საბოლოო პირობები გადაამოწმე უშუალოდ ბანკთან.',
    'Расчёты Homatch носят информационный характер и не являются предложением банка или предварительным одобрением. Итоговые условия уточняйте прямо в банке.',
    'Homatch hesaplamaları yalnızca bilgi amaçlıdır; banka teklifi ya da ön onay değildir. Son koşulları doğrudan bankanızla teyit edin.',
    'حسابات Homatch لأغراض المعلومات فقط وليست عرضًا من بنك ولا موافقة مسبقة. تأكّد من الشروط النهائية مباشرة مع بنكك.',
    'החישובים של Homatch הם למידע בלבד ואינם הצעה של בנק או אישור מראש. אשרו את התנאים הסופיים ישירות מול הבנק.',
  ],
  mortgage_result_eyebrow: [
    'Your result',
    'შენი შედეგი',
    'Ваш результат',
    'Sonucunuz',
    'نتيجتك',
    'התוצאה שלכם',
  ],
  mortgage_result_monthly_label: [
    'Per month',
    'თვეში',
    'В месяц',
    'Aylık',
    'شهريًا',
    'לחודש',
  ],
  mortgage_result_loan_amount: [
    'Loan amount',
    'სესხის თანხა',
    'Сумма кредита',
    'Kredi tutarı',
    'مبلغ القرض',
    'סכום ההלוואה',
  ],
  mortgage_result_total_interest: [
    'Interest in total',
    'სულ პროცენტში',
    'Всего процентов',
    'Toplam faiz',
    'إجمالي الفوائد',
    'סך הריבית',
  ],
  mortgage_result_total_repayment: [
    'Total you repay',
    'სულ გადასახდელი',
    'Всего к выплате',
    'Toplam geri ödeme',
    'إجمالي ما تسدّده',
    'סך הכול להחזר',
  ],
  mortgage_result_handoff: [
    'If you like, we can look at how to bring that figure down.',
    'თუ გინდა, ერთად ვნახოთ როგორ შეიძლება ამ თანხის შემცირება.',
    'Если хотите, посмотрим вместе, как эту сумму уменьшить.',
    'İsterseniz bu tutarı nasıl düşürebileceğinize birlikte bakalım.',
    'إن أردت، ننظر معًا كيف يمكن تقليل هذا المبلغ.',
    'אם תרצו, נראה יחד איך אפשר להקטין את הסכום הזה.',
  ],
  mortgage_consultant_title: [
    'Let us go through your loan',
    'განვიხილოთ შენი სესხი',
    'Разберём ваш кредит',
    'Kredinizi birlikte ele alalım',
    'لنراجع قرضك',
    'בואו נעבור על ההלוואה שלכם',
  ],
  mortgage_consultant_sub: [
    'I already have your numbers. Ask whatever you like and I will answer from these calculations.',
    'შენი მონაცემები უკვე მაქვს. მკითხე რაც გაინტერესებს და პასუხს ამ გამოთვლებზე დაყრდნობით მოგცემ.',
    'Ваши цифры у меня уже есть. Спрашивайте что угодно, отвечу по этим расчётам.',
    'Rakamlarınız bende. Ne isterseniz sorun, bu hesaplara dayanarak yanıtlayayım.',
    'أرقامك لديّ بالفعل. اسأل ما تشاء وسأجيب استنادًا إلى هذه الحسابات.',
    'המספרים שלכם כבר אצלי. שאלו מה שתרצו ואענה לפי החישובים האלה.',
  ],
  mortgage_consultant_sub_no_scenario: [
    'Fill in the loan terms first. After that I can help with any question.',
    'ჯერ შეავსე სესხის პირობები. შემდეგ ნებისმიერ კითხვაზე დაგეხმარები.',
    'Сначала заполните условия кредита. Потом помогу с любым вопросом.',
    'Önce kredi koşullarını doldurun. Sonra her soruda yardımcı olabilirim.',
    'املأ شروط القرض أولًا. بعدها أساعدك في أي سؤال.',
    'קודם מלאו את תנאי ההלוואה. אחר כך אעזור בכל שאלה.',
  ],

  /* ── Details ─────────────────────────────────────────────────────── */

  mortgage_details_title: [
    'Loan details',
    'სესხის დეტალები',
    'Детали кредита',
    'Kredi ayrıntıları',
    'تفاصيل القرض',
    'פרטי ההלוואה',
  ],
  mortgage_details_nominal: [
    'The bank’s rate',
    'ბანკის განაკვეთი',
    'Ставка банка',
    'Bankanın oranı',
    'نسبة البنك',
    'הריבית של הבנק',
  ],
  mortgage_details_effective: [
    'Real yearly cost',
    'რეალური წლიური ხარჯი',
    'Реальная годовая стоимость',
    'Gerçek yıllık maliyet',
    'التكلفة السنوية الحقيقية',
    'העלות השנתית האמיתית',
  ],
  mortgage_details_effective_explain: [
    'This figure shows the real price of the loan better, because it counts the extra costs we already know about.',
    'ეს მაჩვენებელი უკეთ გაჩვენებს სესხის რეალურ ფასს, რადგან ცნობილ დამატებით ხარჯებსაც ითვალისწინებს.',
    'Эта цифра лучше показывает реальную цену кредита, потому что учитывает известные нам дополнительные расходы.',
    'Bu rakam kredinin gerçek fiyatını daha iyi gösterir, çünkü bildiğimiz ek masrafları da sayar.',
    'يُظهر هذا الرقم السعر الحقيقي للقرض بشكل أفضل، لأنه يحتسب التكاليف الإضافية المعروفة لنا.',
    'המספר הזה מראה טוב יותר את המחיר האמיתי של ההלוואה, כי הוא סופר גם את העלויות הנוספות הידועות.',
  ],
  mortgage_details_missing_costs: [
    'Some extra costs have not been entered yet. If the bank charges them, the real cost of the loan goes up.',
    'ზოგი დამატებითი ხარჯი ჯერ არ შეგიყვანიათ. თუ ბანკი მათ ითხოვს, სესხის რეალური ღირებულება გაიზრდება.',
    'Некоторые дополнительные расходы ещё не внесены. Если банк их берёт, реальная стоимость кредита вырастет.',
    'Bazı ek masraflar henüz girilmedi. Banka bunları alıyorsa kredinin gerçek maliyeti artar.',
    'بعض التكاليف الإضافية لم تُدخل بعد. إن كان البنك يتقاضاها، فسترتفع التكلفة الحقيقية للقرض.',
    'חלק מהעלויות הנוספות עדיין לא הוזנו. אם הבנק גובה אותן, העלות האמיתית תעלה.',
  ],
  mortgage_details_see_breakdown: [
    'See the costs',
    'ნახე ხარჯები',
    'Посмотреть расходы',
    'Masrafları gör',
    'اطّلع على التكاليف',
    'לראות את העלויות',
  ],
  mortgage_details_terms: [
    'Compare loan terms',
    'ვადების შედარება',
    'Сравнить сроки',
    'Vadeleri karşılaştır',
    'قارن المدد',
    'השוואת תקופות',
  ],
  mortgage_details_schedule: [
    'Payment schedule',
    'გადახდის გრაფიკი',
    'График платежей',
    'Ödeme planı',
    'جدول السداد',
    'לוח התשלומים',
  ],
  mortgage_details_checklist: [
    'What to check',
    'რა უნდა გადაამოწმო',
    'Что проверить',
    'Neleri kontrol etmeli',
    'ما الذي تتحقّق منه',
    'מה לבדוק',
  ],
  mortgage_section_costs: [
    'The bank’s extra costs',
    'ბანკის დამატებითი ხარჯები',
    'Дополнительные расходы банка',
    'Bankanın ek masrafları',
    'التكاليف الإضافية للبنك',
    'העלויות הנוספות של הבנק',
  ],
  mortgage_section_costs_desc: [
    'If the bank named a fee, insurance or any other charge, enter it here and the result gets more accurate.',
    'თუ ბანკმა საკომისიო, დაზღვევა ან სხვა ხარჯი დაგისახელა, აქ ჩაწერე და შედეგი უფრო ზუსტი გახდება.',
    'Если банк назвал комиссию, страховку или другой сбор, внесите его сюда, и результат станет точнее.',
    'Banka bir ücret, sigorta ya da başka bir masraf söylediyse buraya girin, sonuç daha doğru olsun.',
    'إذا ذكر البنك رسمًا أو تأمينًا أو أي تكلفة أخرى، أدخلها هنا لتصبح النتيجة أدقّ.',
    'אם הבנק ציין עמלה, ביטוח או חיוב אחר, הזינו אותו כאן והתוצאה תהיה מדויקת יותר.',
  ],
  mortgage_section_income: [
    'Your income',
    'შენი შემოსავალი',
    'Ваш доход',
    'Geliriniz',
    'دخلك',
    'ההכנסה שלכם',
  ],
  mortgage_section_income_desc: [
    'Only fill this in if you want to see how comfortable this payment is against your income.',
    'შეავსე მხოლოდ თუ გინდა ნახო, რამდენად კომფორტულია ეს გადასახადი შენი შემოსავლისთვის.',
    'Заполняйте, только если хотите увидеть, насколько этот платёж комфортен при вашем доходе.',
    'Bu ödemenin gelirinize göre ne kadar rahat olduğunu görmek isterseniz doldurun.',
    'املأ هذا فقط إن أردت أن ترى مدى راحة هذا القسط مقارنة بدخلك.',
    'מלאו רק אם תרצו לראות כמה ההחזר הזה נוח ביחס להכנסה שלכם.',
  ],

  /* ── When something is missing or goes wrong ─────────────────────── */

  mortgage_topic_needs: [
    'To answer this we still need:',
    'ამის დასათვლელად ჯერ გვჭირდება:',
    'Чтобы ответить, нам ещё нужно:',
    'Bunu yanıtlamak için hâlâ şunlara ihtiyacımız var:',
    'للإجابة عن هذا ما زلنا نحتاج:',
    'כדי לענות על זה עוד צריך:',
  ],
  mortgage_effective_rate_unavailable_generic: [
    'We cannot work out the real yearly cost yet. Add any fees the bank named under the extra costs above.',
    'რეალურ წლიურ ხარჯს ჯერ ვერ ვთვლით. ზემოთ, დამატებით ხარჯებში, ჩაწერე ბანკის დასახელებული საკომისიოები.',
    'Реальную годовую стоимость посчитать пока нельзя. Внесите названные банком комиссии в дополнительные расходы выше.',
    'Gerçek yıllık maliyeti henüz hesaplayamıyoruz. Bankanın söylediği ücretleri yukarıdaki ek masraflara ekleyin.',
    'لا يمكننا حساب التكلفة السنوية الحقيقية بعد. أضف الرسوم التي ذكرها البنك في التكاليف الإضافية أعلاه.',
    'עדיין אי אפשר לחשב את העלות השנתית האמיתית. הוסיפו את העמלות שהבנק ציין בעלויות הנוספות למעלה.',
  ],
  mortgage_effective_rate_unavailable_no_financing: [
    'Your down payment covers the whole price, so there is no loan to price.',
    'პირველადი შენატანი მთელ ფასს ფარავს, ამიტომ სასესხებელი არაფერია.',
    'Первоначальный взнос покрывает всю цену, значит кредита нет.',
    'Peşinatınız fiyatın tamamını karşılıyor, yani fiyatlanacak bir kredi yok.',
    'دفعتك الأولى تغطّي السعر كاملًا، فلا يوجد قرض لتسعيره.',
    'המקדמה מכסה את כל המחיר, ולכן אין הלוואה לתמחר.',
  ],
  mortgage_effective_rate_unavailable_no_schedule: [
    'We could not build a payment schedule from these numbers. Check the term and the rate.',
    'ამ ციფრებით გადახდის გრაფიკი ვერ ავაგეთ. გადაამოწმე ვადა და განაკვეთი.',
    'По этим числам график платежей построить не удалось. Проверьте срок и ставку.',
    'Bu rakamlarla bir ödeme planı kuramadık. Vadeyi ve faizi kontrol edin.',
    'لم نتمكّن من بناء جدول سداد بهذه الأرقام. تحقّق من المدة والنسبة.',
    'לא הצלחנו לבנות לוח תשלומים מהמספרים האלה. בדקו את התקופה ואת הריבית.',
  ],
  mortgage_effective_rate_unavailable_degenerate: [
    'These numbers do not give a solvable answer. Check the fees you entered.',
    'ეს ციფრები ამოხსნად პასუხს არ იძლევა. გადაამოწმე შეყვანილი საკომისიოები.',
    'Эти числа не дают решаемого ответа. Проверьте внесённые комиссии.',
    'Bu rakamlar çözülebilir bir sonuç vermiyor. Girdiğiniz ücretleri kontrol edin.',
    'هذه الأرقام لا تعطي نتيجة قابلة للحل. تحقّق من الرسوم التي أدخلتها.',
    'המספרים האלה לא נותנים תשובה פתירה. בדקו את העמלות שהזנתם.',
  ],
};
