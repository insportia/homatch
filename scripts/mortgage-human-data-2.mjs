/*
 * PART 2 — the checklist, rebuilt as fifteen cards about THIS loan.
 *
 * WHAT WAS WRONG WITH IT
 *
 * Fifteen mortgage terms with a tick box beside them. The ticks came
 * from whether a field had been filled, which is honest, but a green
 * check next to "Mandatory insurance" reads as "your insurance is
 * fine" — and the list said the same fifteen sentences to somebody who
 * had entered everything and somebody who had entered nothing.
 *
 * WHAT EACH CARD SAYS NOW
 *
 *   1. what this is, in words a first-time borrower already owns;
 *   2. what we know in THIS case, carrying the actual figures;
 *   3. why it matters;
 *   4. a question they can put to Homatch in one press.
 *
 * TWO STATES, NEITHER OF WHICH IS APPROVAL. ვიცით means the scenario
 * answers it. გასარკვევია means it does not, and the card then says
 * where the answer comes from. Neither says the term is good: a known
 * 3% fee can be terrible and an unknown early-repayment clause can be
 * generous. See src/mortgage/checklistState.ts.
 *
 * key -> [en, ka, ru, tr, ar, he].
 */

export const PART_2 = {
  /* ── The section, and what the two states mean ───────────────────── */

  mortgage_mod_checklist_eyebrow: [
    'Before you choose',
    'სანამ აირჩევ',
    'Прежде чем выбрать',
    'Seçmeden önce',
    'قبل أن تختار',
    'לפני שבוחרים',
  ],
  mortgage_mod_checklist_title: [
    'What to check with the bank',
    'რა უნდა გადაამოწმო ბანკთან',
    'Что уточнить в банке',
    'Bankaya neleri sormalısınız',
    'ما الذي تتحقّق منه مع البنك',
    'מה לבדוק מול הבנק',
  ],
  mortgage_mod_checklist_sub: [
    'These are the things that affect the final price and terms of the loan the most.',
    'აქ არის ის საკითხები, რომლებიც სესხის საბოლოო ფასსა და პირობებზე ყველაზე მეტად მოქმედებს.',
    'Это то, что сильнее всего влияет на итоговую цену и условия кредита.',
    'Bunlar kredinin son fiyatını ve koşullarını en çok etkileyen konular.',
    'هذه هي الأمور الأكثر تأثيرًا في السعر النهائي للقرض وشروطه.',
    'אלה הדברים שמשפיעים הכי הרבה על המחיר והתנאים הסופיים של ההלוואה.',
  ],
  mortgage_checklist_progress: [
    'We can already speak to {{done}} of {{total}}. The rest need an answer from the bank or the contract.',
    '{{total}}-დან {{done}}-ზე უკვე შეგვიძლია საუბარი. დანარჩენზე პასუხი ბანკიდან ან ხელშეკრულებიდან უნდა მოვიდეს.',
    'По {{done}} из {{total}} мы уже можем говорить. По остальным ответ должен прийти из банка или договора.',
    '{{total}} maddenin {{done}} tanesi hakkında şimdiden konuşabiliriz. Kalanların yanıtı bankadan ya da sözleşmeden gelmeli.',
    'يمكننا الحديث بالفعل عن {{done}} من {{total}}. الباقي يحتاج جوابًا من البنك أو من العقد.',
    'על {{done}} מתוך {{total}} כבר אפשר לדבר. לשאר צריך תשובה מהבנק או מהחוזה.',
  ],
  /*
   * WHY THE STATE IS A WORD AND NOT A GREEN TICK.
   *
   * A tick beside a bank term is read as the bank's approval. These two
   * words say only how much this page knows.
   */
  mortgage_state_known: [
    'We know this',
    'ვიცით',
    'Это известно',
    'Biliyoruz',
    'نعرف هذا',
    'ידוע לנו',
  ],
  mortgage_state_open: [
    'Still to find out',
    'გასარკვევია',
    'Ещё предстоит выяснить',
    'Öğrenilecek',
    'ما زال يحتاج توضيحًا',
    'עוד צריך לברר',
  ],
  mortgage_checklist_note: [
    'None of these has a right answer. A 2% arrangement fee is fine if the next bank charges 3% and expensive if it charges nothing, which is what comparing offers is for.',
    'არცერთს აქ სწორი პასუხი არ აქვს. 2%-იანი საკომისიო კარგია, თუ სხვა ბანკი 3%-ს ითხოვს, და ძვირია, თუ არაფერს ითხოვს. სწორედ ამისთვისაა შეთავაზებების შედარება.',
    'Правильного ответа здесь нет ни у одного пункта. Комиссия 2% хороша, если другой банк берёт 3%, и дорога, если не берёт ничего. Для этого и нужно сравнение предложений.',
    'Bunların hiçbirinin doğru bir cevabı yok. %2 tahsis ücreti, diğer banka %3 istiyorsa iyidir, hiç istemiyorsa pahalıdır. Teklifleri karşılaştırmak tam da bunun içindir.',
    'لا توجد إجابة صحيحة لأي منها. رسم 2% جيد إذا كان البنك الآخر يطلب 3%، وغالٍ إذا لم يطلب شيئًا. لهذا توجد مقارنة العروض.',
    'לאף אחד מאלה אין תשובה נכונה. עמלה של 2% היא סבירה אם בנק אחר גובה 3%, ויקרה אם הוא לא גובה כלום. בדיוק בשביל זה יש השוואת הצעות.',
  ],
  mortgage_checklist_contract_only: [
    'A calculator cannot answer this one. It is written in the contract.',
    'ამაზე კალკულატორი ვერ გიპასუხებს. ეს ხელშეკრულებაშია ჩაწერილი.',
    'На это калькулятор не ответит. Это записано в договоре.',
    'Buna hesap makinesi cevap veremez. Bu, sözleşmede yazar.',
    'لا يمكن للحاسبة الإجابة عن هذا. إنه مكتوب في العقد.',
    'על זה מחשבון לא יכול לענות. זה כתוב בחוזה.',
  ],

  /* ── Groups ──────────────────────────────────────────────────────── */

  mortgage_check_group_cost: [
    'What it costs',
    'რა ჯდება',
    'Сколько стоит',
    'Ne kadara mal oluyor',
    'كم يكلّف',
    'כמה זה עולה',
  ],
  mortgage_check_group_terms: [
    'The terms',
    'პირობები',
    'Условия',
    'Koşullar',
    'الشروط',
    'התנאים',
  ],
  mortgage_check_group_risk: [
    'What could change',
    'რა შეიძლება შეიცვალოს',
    'Что может измениться',
    'Ne değişebilir',
    'ما الذي قد يتغيّر',
    'מה עלול להשתנות',
  ],
  mortgage_check_group_exit: [
    'Getting out early',
    'ადრე გასვლა',
    'Досрочный выход',
    'Erken çıkış',
    'الخروج مبكرًا',
    'יציאה מוקדמת',
  ],

  /* ── 1. The real cost of the loan ────────────────────────────────── */

  mortgage_check_effective_rate: [
    'What the loan really costs you',
    'რეალურად რამდენი გიჯდება სესხი',
    'Во что кредит обходится на самом деле',
    'Kredinin size gerçek maliyeti',
    'ما يكلّفك القرض فعليًا',
    'כמה ההלוואה באמת עולה לכם',
  ],
  mortgage_check_effective_rate_why: [
    'Because of the extra costs a loan can end up dearer than the quoted rate suggests.',
    'დამატებითი ხარჯების გამო სესხი შეიძლება უფრო ძვირი გამოვიდეს, ვიდრე მხოლოდ გამოცხადებული პროცენტის ნახვით ჩანს.',
    'Из-за дополнительных расходов кредит может оказаться дороже, чем кажется по заявленной ставке.',
    'Ek masraflar yüzünden kredi, ilan edilen orana bakarak göründüğünden daha pahalıya gelebilir.',
    'بسبب التكاليف الإضافية قد يكون القرض أغلى مما يبدو من النسبة المعلنة وحدها.',
    'בגלל עלויות נוספות ההלוואה יכולה לצאת יקרה יותר ממה שנראה לפי הריבית המפורסמת.',
  ],
  mortgage_check_effective_rate_ask: [
    'Why does my real rate come out higher than the one the bank quoted?',
    'რატომ გამოდის ჩემი რეალური განაკვეთი ბანკის დასახელებულზე მაღალი?',
    'Почему моя реальная ставка выше той, что назвал банк?',
    'Gerçek oranım neden bankanın söylediğinden yüksek çıkıyor?',
    'لماذا تخرج نسبتي الحقيقية أعلى من التي ذكرها البنك؟',
    'למה הריבית האמיתית שלי יוצאת גבוהה מזו שהבנק נקב?',
  ],
  mortgage_state_effective_rate: [
    'The bank quotes {{nominal}}%. With the costs you entered, the loan really costs about {{effective}}% a year.',
    'ბანკის განაკვეთი {{nominal}}%-ია. შეყვანილი ხარჯების გათვალისწინებით სესხი რეალურად წელიწადში დაახლოებით {{effective}}% გიჯდება.',
    'Банк называет {{nominal}}%. С учётом внесённых расходов кредит реально стоит около {{effective}}% в год.',
    'Banka %{{nominal}} diyor. Girdiğiniz masraflarla kredi yılda gerçekte yaklaşık %{{effective}} tutuyor.',
    'البنك يذكر {{nominal}}%. مع التكاليف التي أدخلتها، يكلّفك القرض فعليًا نحو {{effective}}% سنويًا.',
    'הבנק נוקב ב-{{nominal}}%. עם העלויות שהזנתם, ההלוואה עולה בפועל כ-{{effective}}% בשנה.',
  ],
  mortgage_state_effective_rate_open: [
    'We cannot work out the real yearly cost yet.',
    'რეალურ წლიურ ხარჯს ჯერ ვერ ვთვლით.',
    'Реальную годовую стоимость пока посчитать нельзя.',
    'Gerçek yıllık maliyeti henüz hesaplayamıyoruz.',
    'لا يمكننا حساب التكلفة السنوية الحقيقية بعد.',
    'עדיין אי אפשר לחשב את העלות השנתית האמיתית.',
  ],
  mortgage_find_effective_rate: [
    'Enter the rate and any fees the bank named, and it appears here.',
    'შეიყვანე განაკვეთი და ბანკის დასახელებული საკომისიოები და აქვე გამოჩნდება.',
    'Введите ставку и названные банком комиссии, и она появится здесь.',
    'Oranı ve bankanın söylediği ücretleri girin, burada görünsün.',
    'أدخل النسبة والرسوم التي ذكرها البنك وستظهر هنا.',
    'הזינו את הריבית ואת העמלות שהבנק ציין, והיא תופיע כאן.',
  ],

  /* ── 2. Monthly payment ──────────────────────────────────────────── */

  mortgage_check_monthly_payment: [
    'What you pay each month',
    'რამდენს იხდი თვეში',
    'Сколько платите в месяц',
    'Ayda ne ödüyorsunuz',
    'كم تدفع شهريًا',
    'כמה משלמים בחודש',
  ],
  mortgage_check_monthly_payment_why: [
    'This is the figure you live with, and it is often quoted without the fees that come with it.',
    'ეს ის ციფრია, რომელთანაც ყოველდღიურად ცხოვრობ, და ხშირად სწორედ ის ისმის საკომისიოების გარეშე.',
    'Это цифра, с которой вы живёте, и её часто называют без сопутствующих комиссий.',
    'Bu, birlikte yaşadığınız rakam ve çoğu zaman yanındaki ücretler olmadan söyleniyor.',
    'هذا هو الرقم الذي تعيش معه، وغالبًا يُذكر دون الرسوم المرافقة له.',
    'זה המספר שאיתו חיים, ולעיתים קרובות מציגים אותו בלי העמלות שנלוות אליו.',
  ],
  mortgage_check_monthly_payment_ask: [
    'Does this monthly figure already include everything I pay every month?',
    'ეს თვიური თანხა უკვე მოიცავს ყველაფერს, რასაც ყოველთვიურად გადავიხდი?',
    'Эта месячная сумма уже включает всё, что я плачу ежемесячно?',
    'Bu aylık tutar, her ay ödediğim her şeyi kapsıyor mu?',
    'هل يشمل هذا المبلغ الشهري كل ما أدفعه كل شهر؟',
    'הסכום החודשי הזה כבר כולל את כל מה שאני משלם כל חודש?',
  ],
  mortgage_state_monthly_payment: [
    'About {{amount}} a month.',
    'თვეში დაახლოებით {{amount}}.',
    'Около {{amount}} в месяц.',
    'Ayda yaklaşık {{amount}}.',
    'نحو {{amount}} شهريًا.',
    'כ-{{amount}} בחודש.',
  ],

  /* ── 3. Total repaid ─────────────────────────────────────────────── */

  mortgage_check_total_repayment: [
    'What you pay in total',
    'რამდენს გადაიხდი სულ',
    'Сколько заплатите всего',
    'Toplamda ne ödeyeceksiniz',
    'كم ستدفع في المجموع',
    'כמה תשלמו בסך הכול',
  ],
  mortgage_check_total_repayment_why: [
    'Two loans with the same monthly payment can differ by tens of thousands by the end.',
    'ორი სესხი ერთნაირი თვიური გადასახადით ბოლოს შეიძლება ათეულობით ათასით განსხვავდებოდეს.',
    'Два кредита с одинаковым платежом к концу могут различаться на десятки тысяч.',
    'Aynı aylık ödemeye sahip iki kredi, sonunda on binlerce fark edebilir.',
    'قرضان بالقسط الشهري نفسه قد يختلفان بعشرات الآلاف في النهاية.',
    'שתי הלוואות עם אותו החזר חודשי יכולות להיבדל בעשרות אלפים בסוף.',
  ],
  mortgage_check_total_repayment_ask: [
    'What will I have paid in total by the end?',
    'ბოლოს სულ რამდენი მექნება გადახდილი?',
    'Сколько я заплачу в итоге к концу срока?',
    'Vade sonunda toplamda ne kadar ödemiş olacağım?',
    'كم سأكون قد دفعت في المجموع عند النهاية؟',
    'כמה אשלם בסך הכול עד הסוף?',
  ],
  mortgage_state_total_repayment: [
    '{{total}} over {{years}} years.',
    '{{years}} წელიწადში {{total}}.',
    '{{total}} за {{years}} лет.',
    '{{years}} yılda {{total}}.',
    '{{total}} خلال {{years}} سنة.',
    '{{total}} במשך {{years}} שנים.',
  ],

  /* ── 4. Total interest ───────────────────────────────────────────── */

  mortgage_check_total_interest: [
    'How much of that is interest',
    'აქედან რამდენია პროცენტი',
    'Сколько из этого проценты',
    'Bunun ne kadarı faiz',
    'كم من ذلك فوائد',
    'כמה מזה ריבית',
  ],
  mortgage_check_total_interest_why: [
    'This is the part that buys you nothing. A shorter term or extra payments cut this and nothing else.',
    'ეს ის ნაწილია, რომელშიც არაფერს იძენ. უფრო მოკლე ვადა ან დამატებითი გადახდები სწორედ ამას ამცირებს.',
    'Это часть, за которую вы ничего не получаете. Короткий срок или доплаты уменьшают именно её.',
    'Bu, karşılığında hiçbir şey almadığınız kısım. Kısa vade ya da ek ödemeler tam olarak bunu azaltır.',
    'هذا هو الجزء الذي لا تشتري به شيئًا. المدة الأقصر أو الدفعات الإضافية تقلّصه تحديدًا.',
    'זה החלק שלא קונה לכם דבר. תקופה קצרה יותר או תשלומים נוספים מקטינים בדיוק אותו.',
  ],
  mortgage_check_total_interest_ask: [
    'How do I bring the interest down without straining the monthly payment?',
    'როგორ შევამცირო პროცენტი ისე, რომ თვიური გადასახადი არ დამიმძიმდეს?',
    'Как уменьшить проценты, не утяжеляя ежемесячный платёж?',
    'Aylık ödemeyi zorlamadan faizi nasıl düşürürüm?',
    'كيف أخفّض الفوائد دون أن يثقل القسط الشهري؟',
    'איך מקטינים את הריבית בלי להכביד על ההחזר החודשי?',
  ],
  mortgage_state_total_interest: [
    '{{interest}} in interest, which is {{pct}}% of the amount you borrow.',
    'პროცენტში {{interest}}, რაც ნასესხები თანხის {{pct}}%-ია.',
    '{{interest}} процентов, это {{pct}}% от суммы займа.',
    'Faiz olarak {{interest}}, yani aldığınız tutarın %{{pct}} kadarı.',
    '{{interest}} كفوائد، أي {{pct}}% من المبلغ الذي تقترضه.',
    '{{interest}} ריבית, שהם {{pct}}% מהסכום שאתם לווים.',
  ],

  /* ── 5. Fees at signing ──────────────────────────────────────────── */

  mortgage_check_initial_fees: [
    'What you pay on the day',
    'რას იხდი ხელმოწერის დღეს',
    'Что платите в день подписания',
    'İmza günü ne ödüyorsunuz',
    'ما تدفعه يوم التوقيع',
    'מה משלמים ביום החתימה',
  ],
  mortgage_check_initial_fees_why: [
    'They come out of the money you receive, so they raise the real cost more than their size suggests.',
    'ეს თანხა მიღებული ფულიდან გამოგაკლდება, ამიტომ რეალურ ხარჯს უფრო მეტად ზრდის, ვიდრე ზომით ჩანს.',
    'Они вычитаются из полученных денег, поэтому поднимают реальную стоимость сильнее, чем кажется.',
    'Aldığınız paradan düşülürler, bu yüzden gerçek maliyeti göründüğünden fazla yükseltirler.',
    'تُخصم من المال الذي تستلمه، فترفع التكلفة الحقيقية أكثر مما يوحي حجمها.',
    'הם יורדים מהכסף שאתם מקבלים, ולכן מעלים את העלות האמיתית יותר מכפי שנדמה.',
  ],
  mortgage_check_initial_fees_ask: [
    'What should I ask the bank about the costs at signing?',
    'რა ვკითხო ბანკს ხელმოწერის დღის ხარჯებზე?',
    'Что спросить у банка о расходах при подписании?',
    'İmza günündeki masraflar hakkında bankaya ne sormalıyım?',
    'ماذا أسأل البنك عن تكاليف يوم التوقيع؟',
    'מה לשאול את הבנק על ההוצאות ביום החתימה?',
  ],
  mortgage_state_initial_fees: [
    'About {{amount}} in one-off fees, from what you entered.',
    'შეყვანილი მონაცემებით ერთჯერადი საკომისიოები დაახლოებით {{amount}}-ია.',
    'По внесённым данным разовые комиссии — около {{amount}}.',
    'Girdiğiniz bilgilere göre tek seferlik ücretler yaklaşık {{amount}}.',
    'حسب ما أدخلته، الرسوم لمرة واحدة نحو {{amount}}.',
    'לפי מה שהזנתם, העמלות החד-פעמיות הן כ-{{amount}}.',
  ],
  mortgage_state_initial_fees_open: [
    'We do not know what the bank charges at signing.',
    'ჯერ არ ვიცით, რას გადაგახდევინებს ბანკი ხელმოწერისას.',
    'Мы не знаем, что банк берёт при подписании.',
    'Bankanın imzada ne aldığını bilmiyoruz.',
    'لا نعرف ما يتقاضاه البنك عند التوقيع.',
    'לא ידוע מה הבנק גובה בחתימה.',
  ],
  mortgage_find_initial_fees: [
    'Ask for one written list of every payment due on the day, then add it above.',
    'მოითხოვე იმ დღის ყველა გადასახდელის ერთი წერილობითი სია და ზემოთ ჩაწერე.',
    'Попросите один письменный список всех платежей того дня и внесите выше.',
    'O gün ödenecek her kalemin tek bir yazılı listesini isteyin ve yukarı ekleyin.',
    'اطلب قائمة مكتوبة واحدة بكل ما يُدفع في ذلك اليوم، ثم أضفها أعلاه.',
    'בקשו רשימה כתובה אחת של כל התשלומים באותו יום, והזינו אותה למעלה.',
  ],

  /* ── 6. Monthly fees ─────────────────────────────────────────────── */

  mortgage_check_recurring_fees: [
    'Monthly charges on top',
    'თვიური დამატებითი გადასახადები',
    'Ежемесячные доплаты сверху',
    'Üstüne gelen aylık ücretler',
    'رسوم شهرية إضافية',
    'חיובים חודשיים נוספים',
  ],
  mortgage_check_recurring_fees_why: [
    'A small charge every month for twenty years is not a small charge.',
    'მცირე თანხა ყოველთვიურად ოცი წლის განმავლობაში უკვე მცირე აღარ არის.',
    'Небольшая сумма каждый месяц двадцать лет подряд уже не небольшая.',
    'Yirmi yıl boyunca her ay küçük bir tutar, artık küçük değildir.',
    'مبلغ صغير كل شهر لعشرين سنة لم يعد صغيرًا.',
    'סכום קטן בכל חודש במשך עשרים שנה כבר אינו קטן.',
  ],
  mortgage_check_recurring_fees_ask: [
    'What do I pay every month besides the loan payment itself?',
    'სესხის გადასახადის გარდა ყოველთვიურად კიდევ რას ვიხდი?',
    'Что я плачу ежемесячно кроме самого платежа по кредиту?',
    'Kredi taksiti dışında her ay ne ödüyorum?',
    'ماذا أدفع كل شهر غير قسط القرض نفسه؟',
    'מה אני משלם כל חודש מלבד ההחזר עצמו?',
  ],
  mortgage_state_recurring_fees: [
    '{{amount}} a month, which is {{total}} across the whole term.',
    'თვეში {{amount}}, რაც მთელ ვადაზე {{total}}-ს შეადგენს.',
    '{{amount}} в месяц, то есть {{total}} за весь срок.',
    'Ayda {{amount}}, yani tüm vadede {{total}}.',
    '{{amount}} شهريًا، أي {{total}} على كامل المدة.',
    '{{amount}} בחודש, כלומר {{total}} לאורך כל התקופה.',
  ],
  mortgage_state_recurring_fees_open: [
    'We do not know whether there is a monthly service charge.',
    'ჯერ არ ვიცით, არის თუ არა ყოველთვიური მომსახურების საკომისიო.',
    'Мы не знаем, есть ли ежемесячная плата за обслуживание.',
    'Aylık bir hizmet ücreti var mı bilmiyoruz.',
    'لا نعرف إن كان هناك رسم خدمة شهري.',
    'לא ידוע אם יש עמלת ניהול חודשית.',
  ],
  mortgage_find_recurring_fees: [
    'It is on the bank’s tariff sheet. Ask for the monthly figure and add it above.',
    'ეს ბანკის ტარიფებშია. ითხოვე თვიური თანხა და ზემოთ ჩაწერე.',
    'Это в тарифах банка. Запросите месячную сумму и внесите выше.',
    'Bankanın tarife listesinde yazar. Aylık tutarı isteyin ve yukarı ekleyin.',
    'إنه في لائحة رسوم البنك. اطلب المبلغ الشهري وأضفه أعلاه.',
    'זה בתעריפון של הבנק. בקשו את הסכום החודשי והזינו למעלה.',
  ],

  /* ── 7. Insurance ────────────────────────────────────────────────── */

  mortgage_check_insurance: [
    'Insurance you have to buy',
    'დაზღვევა, რომელიც უნდა შეიძინო',
    'Страховка, которую нужно купить',
    'Almanız gereken sigorta',
    'التأمين الذي عليك شراؤه',
    'ביטוח שחייבים לרכוש',
  ],
  mortgage_check_insurance_why: [
    'Some of it is genuinely required and some is simply sold. It runs for the whole term either way.',
    'ნაწილი მართლაც სავალდებულოა, ნაწილი კი უბრალოდ იყიდება. ორივე შემთხვევაში მთელ ვადაზე გრძელდება.',
    'Часть действительно обязательна, часть просто продают. В любом случае она идёт весь срок.',
    'Bir kısmı gerçekten zorunlu, bir kısmı sadece satılıyor. Her hâlükârda tüm vade boyunca sürer.',
    'بعضه مطلوب فعلًا وبعضه يُباع فقط. في الحالتين يستمر طوال المدة.',
    'חלק מזה באמת נדרש וחלק פשוט נמכר. כך או כך זה נמשך כל התקופה.',
  ],
  mortgage_check_insurance_ask: [
    'Which insurance is really compulsory, and can I buy it somewhere else?',
    'რომელი დაზღვევაა მართლა სავალდებულო და შემიძლია თუ არა სხვაგან ვიყიდო?',
    'Какая страховка действительно обязательна и можно ли купить её в другом месте?',
    'Hangi sigorta gerçekten zorunlu ve başka yerden alabilir miyim?',
    'أي تأمين إلزامي فعلًا وهل يمكنني شراؤه من مكان آخر؟',
    'איזה ביטוח באמת חובה, ואפשר לקנות אותו במקום אחר?',
  ],
  mortgage_state_insurance: [
    'About {{amount}} a year, from what you entered.',
    'შეყვანილი მონაცემებით წელიწადში დაახლოებით {{amount}}.',
    'По внесённым данным около {{amount}} в год.',
    'Girdiğiniz bilgilere göre yılda yaklaşık {{amount}}.',
    'حسب ما أدخلته، نحو {{amount}} سنويًا.',
    'לפי מה שהזנתם, כ-{{amount}} בשנה.',
  ],
  mortgage_state_insurance_open: [
    'We do not know what insurance this loan requires.',
    'ჯერ არ ვიცით, რა დაზღვევას ითხოვს ეს სესხი.',
    'Мы не знаем, какая страховка нужна для этого кредита.',
    'Bu kredinin hangi sigortayı gerektirdiğini bilmiyoruz.',
    'لا نعرف أي تأمين يتطلّبه هذا القرض.',
    'לא ידוע איזה ביטוח ההלוואה הזאת מחייבת.',
  ],
  mortgage_find_insurance: [
    'Ask the bank which policies are compulsory and what each costs a year.',
    'ჰკითხე ბანკს, რომელი პოლისია სავალდებულო და თითოეული რა ჯდება წელიწადში.',
    'Спросите банк, какие полисы обязательны и сколько каждый стоит в год.',
    'Bankaya hangi poliçelerin zorunlu olduğunu ve her birinin yıllık maliyetini sorun.',
    'اسأل البنك أي الوثائق إلزامية وكم تكلّف كل منها سنويًا.',
    'שאלו את הבנק אילו פוליסות חובה וכמה כל אחת עולה בשנה.',
  ],

  /* ── 8. Valuation ────────────────────────────────────────────────── */

  mortgage_check_valuation: [
    'Who values the property, and at whose cost',
    'ვინ აფასებს ქონებას და ვის ხარჯზე',
    'Кто оценивает недвижимость и за чей счёт',
    'Gayrimenkulü kim değerliyor ve kimin masrafına',
    'من يقيّم العقار وعلى حساب من',
    'מי שם את הנכס ועל חשבון מי',
  ],
  mortgage_check_valuation_why: [
    'You usually pay for it, and the number it produces decides how much the bank will lend.',
    'ჩვეულებრივ შენ იხდი, და მისი შედეგი განსაზღვრავს, რამდენს გასესხებს ბანკი.',
    'Обычно платите вы, а полученная цифра решает, сколько банк даст.',
    'Genelde siz ödersiniz ve çıkan rakam bankanın ne kadar vereceğini belirler.',
    'عادةً تدفع أنت، والرقم الناتج يحدّد كم سيُقرضك البنك.',
    'בדרך כלל אתם משלמים, והמספר שיוצא קובע כמה הבנק ילווה.',
  ],
  mortgage_check_valuation_ask: [
    'What happens if the valuation comes in below the price I agreed?',
    'რა მოხდება, თუ შეფასება შეთანხმებულ ფასზე დაბალი გამოვა?',
    'Что будет, если оценка окажется ниже согласованной цены?',
    'Ekspertiz, anlaştığım fiyatın altında çıkarsa ne olur?',
    'ماذا يحدث إذا جاء التقييم أقل من السعر المتفق عليه؟',
    'מה קורה אם השמאות תצא נמוכה מהמחיר שסוכם?',
  ],
  mortgage_state_valuation: [
    'About {{amount}}, from what you entered.',
    'შეყვანილი მონაცემებით დაახლოებით {{amount}}.',
    'По внесённым данным около {{amount}}.',
    'Girdiğiniz bilgilere göre yaklaşık {{amount}}.',
    'حسب ما أدخلته، نحو {{amount}}.',
    'לפי מה שהזנתם, כ-{{amount}}.',
  ],
  mortgage_state_valuation_open: [
    'We do not know the valuation cost.',
    'შეფასების ხარჯი ჯერ არ ვიცით.',
    'Стоимость оценки нам неизвестна.',
    'Ekspertiz masrafını bilmiyoruz.',
    'لا نعرف تكلفة التقييم.',
    'עלות השמאות אינה ידועה.',
  ],
  mortgage_find_valuation: [
    'The bank names the valuers it accepts and their price. Ask for both.',
    'ბანკი ასახელებს შემფასებლებს, რომლებსაც იღებს, და მათ ფასს. ორივე ჰკითხე.',
    'Банк называет оценщиков, которых принимает, и их цену. Спросите и то, и другое.',
    'Banka kabul ettiği eksperleri ve fiyatlarını söyler. İkisini de sorun.',
    'يذكر البنك المقيّمين الذين يقبلهم وأسعارهم. اسأل عن الاثنين.',
    'הבנק מציין אילו שמאים הוא מקבל ומה המחיר. בקשו את שניהם.',
  ],

  /* ── 9. Fixed or not ─────────────────────────────────────────────── */

  mortgage_check_rate_type: [
    'Whether the rate can change',
    'შეიძლება თუ არა განაკვეთი შეიცვალოს',
    'Может ли ставка измениться',
    'Faiz değişebilir mi',
    'هل يمكن أن تتغيّر النسبة',
    'האם הריבית יכולה להשתנות',
  ],
  mortgage_check_rate_type_why: [
    'A fixed rate makes every figure on this page a promise. Anything else makes them today’s picture.',
    'ფიქსირებული განაკვეთი ამ გვერდის ყველა ციფრს დაპირებად აქცევს. სხვა შემთხვევაში ისინი მხოლოდ დღევანდელი სურათია.',
    'Фиксированная ставка делает каждую цифру на этой странице обещанием. Иначе это лишь сегодняшняя картина.',
    'Sabit faiz, bu sayfadaki her rakamı bir söze dönüştürür. Aksi hâlde hepsi bugünün fotoğrafıdır.',
    'النسبة الثابتة تجعل كل رقم في هذه الصفحة وعدًا. غير ذلك، تبقى صورة اليوم فقط.',
    'ריבית קבועה הופכת כל מספר בדף הזה להבטחה. אחרת הם רק התמונה של היום.',
  ],
  mortgage_check_rate_type_ask: [
    'Is the rate fixed for the whole term, and if not, for how long?',
    'განაკვეთი მთელ ვადაზე ფიქსირებულია და თუ არა, რამდენ ხანს?',
    'Ставка фиксирована на весь срок, а если нет, то насколько?',
    'Faiz tüm vade boyunca sabit mi, değilse ne kadar süreyle?',
    'هل النسبة ثابتة طوال المدة، وإن لم تكن، فلكم من الوقت؟',
    'הריבית קבועה לכל התקופה, ואם לא, לכמה זמן?',
  ],
  mortgage_state_rate_type: [
    'You said the rate type is {{type}}.',
    'შენ მიუთითე განაკვეთის ტიპი: {{type}}.',
    'Вы указали тип ставки: {{type}}.',
    'Faiz türünü {{type}} olarak belirttiniz.',
    'ذكرت أن نوع النسبة: {{type}}.',
    'ציינתם את סוג הריבית: {{type}}.',
  ],
  mortgage_state_rate_type_open: [
    'We do not know whether the rate is fixed. Nothing here assumes that it is.',
    'ჯერ არ ვიცით, ფიქსირებულია თუ არა განაკვეთი. აქ არაფერი ვარაუდობს, რომ ასეა.',
    'Мы не знаем, фиксированная ли ставка. Здесь никто этого не предполагает.',
    'Faizin sabit olup olmadığını bilmiyoruz. Burada bunu varsayan bir şey yok.',
    'لا نعرف إن كانت النسبة ثابتة. لا شيء هنا يفترض ذلك.',
    'לא ידוע אם הריבית קבועה. שום דבר כאן לא מניח שכן.',
  ],
  mortgage_find_rate_type: [
    'It is one line in the offer. Ask the bank and set it in the extra details above.',
    'ეს შეთავაზებაში ერთი სტრიქონია. ჰკითხე ბანკს და ზემოთ დამატებით დეტალებში მიუთითე.',
    'Это одна строка в предложении. Спросите банк и укажите выше в дополнительных данных.',
    'Teklifte tek bir satır. Bankaya sorun ve yukarıdaki ek bilgilere girin.',
    'إنه سطر واحد في العرض. اسأل البنك وحدّده في التفاصيل الإضافية أعلاه.',
    'זו שורה אחת בהצעה. שאלו את הבנק והזינו בפרטים הנוספים למעלה.',
  ],

  /* ── 10. Grace period ────────────────────────────────────────────── */

  mortgage_check_grace_period: [
    'A lighter start',
    'შემსუბუქებული დასაწყისი',
    'Облегчённый старт',
    'Daha hafif bir başlangıç',
    'بداية أخف',
    'התחלה קלה יותר',
  ],
  mortgage_check_grace_period_why: [
    'Paying only interest at the start feels like a discount and is the opposite. The debt does not fall, so you pay interest on the full amount for longer.',
    'თუ დასაწყისში მხოლოდ პროცენტს იხდი, ეს შეღავათად გამოიყურება, სინამდვილეში კი პირიქითაა. ვალი არ მცირდება, ამიტომ სრულ თანხაზე უფრო დიდხანს იხდი პროცენტს.',
    'Платить в начале только проценты кажется скидкой, а выходит наоборот. Долг не уменьшается, и проценты дольше идут с полной суммы.',
    'Başta sadece faiz ödemek indirim gibi görünür, tam tersidir. Borç azalmaz, bu yüzden tam tutar üzerinden daha uzun faiz ödersiniz.',
    'دفع الفائدة فقط في البداية يبدو خصمًا وهو العكس. الدين لا ينخفض، فتدفع فائدة على كامل المبلغ لمدة أطول.',
    'לשלם רק ריבית בהתחלה נשמע כמו הנחה וזה ההפך. החוב לא יורד, ולכן משלמים ריבית על הסכום המלא לאורך זמן רב יותר.',
  ],
  mortgage_check_grace_period_ask: [
    'How much more does the loan cost in total if I take the lighter start?',
    'რამდენად გაძვირდება სესხი სულ, თუ შემსუბუქებულ დასაწყისს ავიღებ?',
    'Насколько дороже выйдет кредит в сумме с облегчённым стартом?',
    'Daha hafif başlangıcı alırsam kredi toplamda ne kadar pahalılaşır?',
    'كم يزداد إجمالي تكلفة القرض إذا أخذت البداية الأخف؟',
    'בכמה ההלוואה מתייקרת בסך הכול אם אקח את ההתחלה הקלה?',
  ],
  mortgage_state_grace_period: [
    'The first {{months}} months are interest only, from what you entered.',
    'შეყვანილი მონაცემებით პირველ {{months}} თვეში მხოლოდ პროცენტს იხდი.',
    'По внесённым данным первые {{months}} месяцев — только проценты.',
    'Girdiğiniz bilgilere göre ilk {{months}} ay sadece faiz.',
    'حسب ما أدخلته، أول {{months}} شهرًا فائدة فقط.',
    'לפי מה שהזנתם, {{months}} החודשים הראשונים הם ריבית בלבד.',
  ],
  mortgage_state_grace_period_open: [
    'No lighter start is included in this calculation.',
    'ამ გამოთვლაში შემსუბუქებული დასაწყისი არ არის ჩადებული.',
    'В этом расчёте облегчённого старта нет.',
    'Bu hesapta daha hafif bir başlangıç yok.',
    'لا توجد بداية أخف في هذا الحساب.',
    'בחישוב הזה אין התחלה קלה יותר.',
  ],
  mortgage_find_grace_period: [
    'If the bank offers one, ask for the total cost with it and without it.',
    'თუ ბანკი გთავაზობს, ითხოვე ჯამური ღირებულება მასთან ერთად და მის გარეშე.',
    'Если банк его предлагает, попросите итоговую стоимость с ним и без него.',
    'Banka sunuyorsa, onunla ve onsuz toplam maliyeti isteyin.',
    'إن عرضه البنك، اطلب التكلفة الإجمالية معه وبدونه.',
    'אם הבנק מציע, בקשו את העלות הכוללת איתה ובלעדיה.',
  ],

  /* ── 11. What the rate follows ───────────────────────────────────── */

  mortgage_check_rate_exposure: [
    'What a changing rate follows',
    'რას მიჰყვება ცვლადი განაკვეთი',
    'За чем следует плавающая ставка',
    'Değişken faiz neyi izliyor',
    'بماذا ترتبط النسبة المتغيّرة',
    'אחרי מה ריבית משתנה עוקבת',
  ],
  mortgage_check_rate_exposure_why: [
    'A rate that moves moves with something. Knowing what, and how often, is the difference between a risk you chose and one you did not see.',
    'ცვლადი განაკვეთი რაღაცას მიჰყვება. თუ იცი რას და რამდენად ხშირად, ეს არჩეულ რისკსა და შეუმჩნეველ რისკს შორის განსხვავებაა.',
    'Плавающая ставка за чем-то следует. Знать, за чем и как часто, — это разница между риском, который вы выбрали, и тем, которого не заметили.',
    'Değişen bir faiz bir şeyi izler. Neyi ve ne sıklıkla izlediğini bilmek, seçtiğiniz riskle görmediğiniz risk arasındaki farktır.',
    'النسبة المتغيّرة ترتبط بشيء ما. معرفة ماهيته وتواتره هي الفرق بين خطر اخترته وخطر لم تره.',
    'ריבית משתנה עוקבת אחרי משהו. לדעת אחרי מה וכל כמה זמן זה ההבדל בין סיכון שבחרתם לסיכון שלא ראיתם.',
  ],
  mortgage_check_rate_exposure_ask: [
    'What should I ask about a rate that can be reset?',
    'რა ვკითხო განაკვეთზე, რომელიც შეიძლება გადაიხედოს?',
    'Что спросить о ставке, которую могут пересмотреть?',
    'Güncellenebilen bir faiz hakkında ne sormalıyım?',
    'ماذا أسأل عن نسبة قابلة لإعادة التسعير؟',
    'מה לשאול על ריבית שעשויה להתעדכן?',
  ],
  mortgage_state_rate_exposure: [
    'It follows {{index}}, from what you entered.',
    'შეყვანილი მონაცემებით ის {{index}}-ს მიჰყვება.',
    'По внесённым данным она следует за {{index}}.',
    'Girdiğiniz bilgilere göre {{index}} endeksini izliyor.',
    'حسب ما أدخلته، ترتبط بـ {{index}}.',
    'לפי מה שהזנתם, היא עוקבת אחרי {{index}}.',
  ],
  mortgage_state_rate_exposure_fixed: [
    'You said the rate is fixed, so there is nothing for it to follow.',
    'შენ მიუთითე, რომ განაკვეთი ფიქსირებულია, ამიტომ მისაყოლებელი არაფერია.',
    'Вы указали, что ставка фиксированная, значит следовать не за чем.',
    'Faizin sabit olduğunu belirttiniz, dolayısıyla izleyecek bir şey yok.',
    'ذكرت أن النسبة ثابتة، فلا شيء ترتبط به.',
    'ציינתם שהריבית קבועה, ולכן אין אחרי מה לעקוב.',
  ],
  mortgage_state_rate_exposure_open: [
    'If the rate can change, we do not yet know what it follows.',
    'თუ განაკვეთი შეიძლება შეიცვალოს, ჯერ არ ვიცით, რას მიჰყვება.',
    'Если ставка может меняться, мы пока не знаем, за чем она следует.',
    'Faiz değişebiliyorsa, neyi izlediğini henüz bilmiyoruz.',
    'إذا كانت النسبة قابلة للتغيّر، فلا نعرف بعد بماذا ترتبط.',
    'אם הריבית יכולה להשתנות, עדיין לא ידוע אחרי מה היא עוקבת.',
  ],
  mortgage_find_rate_exposure: [
    'The offer names the index and how often it is reset. Ask whether there is a ceiling.',
    'შეთავაზებაში წერია ინდექსი და რამდენად ხშირად გადაიხედება. ჰკითხე, აქვს თუ არა ზედა ზღვარი.',
    'В предложении указан индекс и частота пересмотра. Спросите, есть ли потолок.',
    'Teklifte endeks ve güncelleme sıklığı yazar. Bir tavan var mı diye sorun.',
    'يذكر العرض المؤشر وتواتر إعادة التسعير. اسأل إن كان هناك سقف.',
    'בהצעה מצוין המדד ותדירות העדכון. שאלו אם יש תקרה.',
  ],

  /* ── 12. Currency ────────────────────────────────────────────────── */

  mortgage_check_currency_risk: [
    'The currency of the loan',
    'სესხის ვალუტა',
    'Валюта кредита',
    'Kredinin para birimi',
    'عملة القرض',
    'מטבע ההלוואה',
  ],
  mortgage_check_currency_risk_why: [
    'If you earn in one currency and owe in another, your payment moves with the exchange rate and your salary does not.',
    'თუ ერთ ვალუტაში გაქვს შემოსავალი და მეორეში ვალი, გადასახადი კურსს მიჰყვება, ხელფასი კი არა.',
    'Если зарабатываете в одной валюте, а должны в другой, платёж идёт за курсом, а зарплата — нет.',
    'Bir para biriminde kazanıp başka birinde borçlanırsanız, ödemeniz kurla birlikte hareket eder, maaşınız etmez.',
    'إذا كنت تكسب بعملة وتدين بأخرى، فقسطك يتحرّك مع سعر الصرف وراتبك لا.',
    'אם מרוויחים במטבע אחד וחייבים באחר, ההחזר נע עם השער והמשכורת לא.',
  ],
  mortgage_check_currency_risk_ask: [
    'What happens to my payment if the exchange rate moves 20%?',
    'რა მოუვა ჩემს გადასახადს, თუ კურსი 20%-ით შეიცვლება?',
    'Что станет с платежом, если курс изменится на 20%?',
    'Kur %20 hareket ederse ödemem ne olur?',
    'ماذا يحدث لقسطي إذا تحرّك سعر الصرف 20%؟',
    'מה קורה להחזר שלי אם השער זז ב-20%?',
  ],
  mortgage_state_currency_local: [
    'The loan is in {{currency}}, the same money most salaries here are paid in.',
    'სესხი {{currency}}-შია, იმავე ვალუტაში, რომელშიც აქ ხელფასების უმეტესობა გაიცემა.',
    'Кредит в {{currency}} — в той же валюте, в которой здесь платят большинство зарплат.',
    'Kredi {{currency}} cinsinden, buradaki maaşların çoğunun ödendiği para biriminde.',
    'القرض بعملة {{currency}}، وهي العملة التي تُدفع بها معظم الرواتب هنا.',
    'ההלוואה ב-{{currency}}, אותו מטבע שבו משולמות כאן רוב המשכורות.',
  ],
  mortgage_state_currency_foreign: [
    'The loan is in {{currency}}. If your income is in another currency, the exchange rate becomes part of your monthly cost.',
    'სესხი {{currency}}-შია. თუ შემოსავალი სხვა ვალუტაში გაქვს, კურსი შენი თვიური ხარჯის ნაწილი ხდება.',
    'Кредит в {{currency}}. Если доход в другой валюте, курс становится частью вашего ежемесячного расхода.',
    'Kredi {{currency}} cinsinden. Geliriniz başka bir para birimindeyse, kur aylık masrafınızın parçası olur.',
    'القرض بعملة {{currency}}. إذا كان دخلك بعملة أخرى، يصبح سعر الصرف جزءًا من مصروفك الشهري.',
    'ההלוואה ב-{{currency}}. אם ההכנסה שלכם במטבע אחר, השער הופך לחלק מההוצאה החודשית.',
  ],

  /* ── 13-15. The three a calculator cannot answer ─────────────────── */

  mortgage_check_early_repayment: [
    'If you want to pay the loan off early',
    'თუ სესხის ადრე დაფარვა მოგინდება',
    'Если захотите погасить кредит раньше',
    'Krediyi erken kapatmak isterseniz',
    'إذا أردت سداد القرض مبكرًا',
    'אם תרצו לסגור את ההלוואה מוקדם',
  ],
  mortgage_check_early_repayment_why: [
    'This matters if you plan to pay in a large sum later or close the loan sooner than the contract says.',
    'ეს მნიშვნელოვანია, თუ მომავალში დიდი თანხის შეტანას ან სესხის ვადაზე ადრე დახურვას გეგმავ.',
    'Это важно, если планируете внести крупную сумму позже или закрыть кредит раньше срока.',
    'İleride büyük bir ödeme yapmayı ya da krediyi vadeden önce kapatmayı düşünüyorsanız bu önemli.',
    'هذا مهم إن كنت تخطّط لدفع مبلغ كبير لاحقًا أو إغلاق القرض قبل موعده.',
    'זה חשוב אם אתם מתכננים להכניס סכום גדול בהמשך או לסגור את ההלוואה לפני הזמן.',
  ],
  mortgage_check_early_repayment_ask: [
    'If I repay the loan early, what should I check first?',
    'თუ სესხს ადრე დავფარავ, რა უნდა გადავამოწმო?',
    'Если погашу кредит досрочно, что нужно проверить в первую очередь?',
    'Krediyi erken kapatırsam önce neyi kontrol etmeliyim?',
    'إذا سدّدت القرض مبكرًا، ما الذي أتحقّق منه أولًا؟',
    'אם אפרע את ההלוואה מוקדם, מה כדאי לבדוק קודם?',
  ],
  mortgage_state_early_repayment_open: [
    'We do not know yet whether the bank charges a fee for this.',
    'ჯერ არ ვიცით, ბანკი დამატებით საკომისიოს მოგთხოვს თუ არა.',
    'Мы пока не знаем, берёт ли банк за это комиссию.',
    'Bankanın bunun için ücret alıp almadığını henüz bilmiyoruz.',
    'لا نعرف بعد إن كان البنك يتقاضى رسمًا على ذلك.',
    'עדיין לא ידוע אם הבנק גובה על כך עמלה.',
  ],
  mortgage_find_early_repayment: [
    'Ask for the fee as a figure for each of the first five years, not as a formula.',
    'ითხოვე საკომისიო ციფრად პირველი ხუთი წლის თითოეულისთვის და არა ფორმულად.',
    'Попросите комиссию цифрой на каждый из первых пяти лет, а не формулой.',
    'Ücreti ilk beş yılın her biri için rakam olarak isteyin, formül olarak değil.',
    'اطلب الرسم كرقم لكل سنة من السنوات الخمس الأولى، لا كصيغة.',
    'בקשו את העמלה כמספר לכל אחת מחמש השנים הראשונות, לא כנוסחה.',
  ],

  mortgage_check_refinancing: [
    'If you want to move the loan to another bank',
    'თუ სესხის სხვა ბანკში გადატანა მოგინდება',
    'Если захотите перевести кредит в другой банк',
    'Krediyi başka bankaya taşımak isterseniz',
    'إذا أردت نقل القرض إلى بنك آخر',
    'אם תרצו להעביר את ההלוואה לבנק אחר',
  ],
  mortgage_check_refinancing_why: [
    'Rates change over twenty years. What it takes to leave is worth knowing before you arrive.',
    'ოცი წლის განმავლობაში განაკვეთები იცვლება. ღირს წასვლის პირობები მოსვლამდე იცოდე.',
    'За двадцать лет ставки меняются. Условия ухода стоит знать до прихода.',
    'Yirmi yılda oranlar değişir. Ayrılmanın neye mal olacağını gelmeden bilmek gerekir.',
    'تتغيّر النسب على مدى عشرين سنة. يستحق أن تعرف شروط الخروج قبل الدخول.',
    'לאורך עשרים שנה הריביות משתנות. כדאי לדעת מה כרוך ביציאה עוד לפני הכניסה.',
  ],
  mortgage_check_refinancing_ask: [
    'What does it take to move this loan to another bank later?',
    'რა სჭირდება ამ სესხის მოგვიანებით სხვა ბანკში გადატანას?',
    'Что нужно, чтобы позже перевести этот кредит в другой банк?',
    'Bu krediyi ileride başka bankaya taşımak için ne gerekir?',
    'ما الذي يتطلّبه نقل هذا القرض إلى بنك آخر لاحقًا؟',
    'מה נדרש כדי להעביר את ההלוואה הזאת לבנק אחר בהמשך?',
  ],
  mortgage_state_refinancing_open: [
    'We do not know what this bank charges to release the mortgage.',
    'ჯერ არ ვიცით, რას ითხოვს ეს ბანკი იპოთეკის მოხსნისთვის.',
    'Мы не знаем, что этот банк берёт за снятие ипотеки.',
    'Bu bankanın ipoteği kaldırmak için ne aldığını bilmiyoruz.',
    'لا نعرف ما يتقاضاه هذا البنك لفكّ الرهن.',
    'לא ידוע מה הבנק הזה גובה על הסרת המשכנתה.',
  ],
  mortgage_find_refinancing: [
    'Ask what the bank charges to release the mortgage, and how long it takes.',
    'ჰკითხე, რას ითხოვს ბანკი იპოთეკის მოხსნაში და რამდენი ხანი სჭირდება.',
    'Спросите, сколько банк берёт за снятие ипотеки и сколько это занимает.',
    'Bankanın ipoteği kaldırmak için ne aldığını ve ne kadar sürdüğünü sorun.',
    'اسأل كم يتقاضى البنك لفكّ الرهن وكم يستغرق ذلك.',
    'שאלו כמה הבנק גובה על הסרת המשכנתה וכמה זמן זה לוקח.',
  ],

  mortgage_check_penalties: [
    'If a payment is late',
    'თუ გადახდა დაგვიანდება',
    'Если платёж просрочен',
    'Bir ödeme gecikirse',
    'إذا تأخّر قسط',
    'אם תשלום מתאחר',
  ],
  mortgage_check_penalties_why: [
    'Over twenty years a late payment is a real possibility, and what it triggers ranges from a small charge to the whole balance falling due.',
    'ოც წელიწადში გადახდის დაგვიანება რეალურია, და შედეგი მცირე ჯარიმიდან მთელი ვალის ერთბაშად მოთხოვნამდე მერყეობს.',
    'За двадцать лет просрочка вполне возможна, а последствия — от небольшого штрафа до требования вернуть весь долг.',
    'Yirmi yılda bir gecikme gerçekten olabilir ve sonucu küçük bir cezadan tüm borcun muaccel olmasına kadar değişir.',
    'خلال عشرين سنة، التأخّر أمر وارد، وتتراوح نتيجته بين غرامة صغيرة وحلول كامل الدين.',
    'לאורך עשרים שנה איחור הוא אפשרות ממשית, והתוצאה נעה בין קנס קטן לדרישה להחזיר את כל החוב.',
  ],
  mortgage_check_penalties_ask: [
    'What happens if a payment is a week late, and if it is a month late?',
    'რა მოხდება, თუ გადახდა კვირით დაგვიანდება და რა, თუ თვით?',
    'Что будет, если платёж опоздает на неделю, и что — если на месяц?',
    'Bir ödeme bir hafta gecikirse ne olur, bir ay gecikirse ne olur?',
    'ماذا يحدث إذا تأخّر القسط أسبوعًا، وماذا إذا تأخّر شهرًا؟',
    'מה קורה אם תשלום מתאחר בשבוע, ומה אם בחודש?',
  ],
  mortgage_state_penalties_open: [
    'The penalties are set by the contract, and we have not seen it.',
    'ჯარიმებს ხელშეკრულება ადგენს და ის ჩვენ არ გვინახავს.',
    'Штрафы определяет договор, а мы его не видели.',
    'Cezaları sözleşme belirler ve biz onu görmedik.',
    'العقوبات يحدّدها العقد، ونحن لم نطّلع عليه.',
    'הקנסות נקבעים בחוזה, ואנחנו לא ראינו אותו.',
  ],
  mortgage_find_penalties: [
    'Ask for the late-payment clause in writing before you sign anything.',
    'ხელმოწერამდე ითხოვე დაგვიანების პუნქტი წერილობით.',
    'До подписания запросите пункт о просрочке в письменном виде.',
    'İmzalamadan önce gecikme maddesini yazılı olarak isteyin.',
    'اطلب بند التأخير مكتوبًا قبل أن توقّع أي شيء.',
    'לפני שחותמים, בקשו את סעיף האיחור בכתב.',
  ],

  /* ── Before there is a scenario at all ───────────────────────────── */

  mortgage_state_no_scenario: [
    'Fill in the calculator and this fills itself in.',
    'შეავსე კალკულატორი და ეს თავისით შეივსება.',
    'Заполните калькулятор, и это заполнится само.',
    'Hesaplayıcıyı doldurun, burası kendiliğinden dolsun.',
    'املأ الحاسبة وسيمتلئ هذا تلقائيًا.',
    'מלאו את המחשבון וזה יתמלא מעצמו.',
  ],
  mortgage_find_no_scenario: [
    'Price, deposit, term and rate are all it needs.',
    'ფასი, შენატანი, ვადა და განაკვეთი სულ ეს არის საჭირო.',
    'Нужны только цена, взнос, срок и ставка.',
    'Fiyat, peşinat, vade ve faiz yeterli.',
    'السعر والدفعة الأولى والمدة والنسبة، هذا كل ما يلزم.',
    'מחיר, מקדמה, תקופה וריבית, זה כל מה שצריך.',
  ],
};
