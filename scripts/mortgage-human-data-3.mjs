/*
 * PART 3 — "before you sign", collapsed AND expanded.
 *
 * The collapsed summaries were rewritten by the owner directly in
 * app_content and they are good; they are repeated here so the shipped
 * bundle carries them and there is ONE source for this copy rather than
 * a database row quietly overriding a worse string underneath.
 *
 * The expanded halves had never been touched. They were long, formal
 * and plural — ჰკითხეთ, მოითხოვეთ, იცით — beside a page that had just
 * learned to say შენ, and several of them were two thoughts joined by a
 * dash. Every one of the twenty-four is rewritten here.
 *
 * The four parts stay, because they are what makes a warning usable at
 * a desk in a bank: what it means, why it matters, what to ask, what to
 * look for in the contract.
 *
 * key -> [en, ka, ru, tr, ar, he].
 */

export const PART_3 = {
  /* ── The section ─────────────────────────────────────────────────── */

  mortgage_mod_sign_eyebrow: [
    'Before you sign',
    'სანამ სესხს აიღებ',
    'Прежде чем подписать',
    'İmzalamadan önce',
    'قبل أن توقّع',
    'לפני שחותמים',
  ],
  /* Renamed: the financing picture already has a list headed "worth
     paying attention to", and two identical headings on one page make a
     reader think they have scrolled backwards. */
  mortgage_mod_sign_title: [
    'What to check in the contract',
    'რა უნდა გადაამოწმო ხელშეკრულებაში',
    'Что проверить в договоре',
    'Sözleşmede neleri kontrol etmeli',
    'ما الذي تتحقّق منه في العقد',
    'מה לבדוק בחוזה',
  ],
  mortgage_mod_sign_sub: [
    'These details decide the final price of the loan. Open whichever one you need.',
    'ეს დეტალები სესხის საბოლოო ფასზე მოქმედებს. გახსენი ის, რაც გაინტერესებს.',
    'Эти детали определяют итоговую цену кредита. Откройте то, что вам нужно.',
    'Bu ayrıntılar kredinin son fiyatını belirler. İhtiyacınız olanı açın.',
    'هذه التفاصيل تحدّد السعر النهائي للقرض. افتح ما يهمّك.',
    'הפרטים האלה קובעים את המחיר הסופי של ההלוואה. פתחו את מה שרלוונטי לכם.',
  ],
  mortgage_sign_why_label: [
    'Why it matters',
    'რატომ არის მნიშვნელოვანი',
    'Почему это важно',
    'Neden önemli',
    'لماذا هذا مهم',
    'למה זה חשוב',
  ],
  mortgage_sign_ask_label: [
    'Ask the bank',
    'ჰკითხე ბანკს',
    'Спросите в банке',
    'Bankaya sorun',
    'اسأل البنك',
    'שאלו את הבנק',
  ],
  mortgage_sign_check_label: [
    'Find in the contract',
    'იპოვე ხელშეკრულებაში',
    'Найдите в договоре',
    'Sözleşmede bulun',
    'ابحث عنه في العقد',
    'חפשו בחוזה',
  ],
  mortgage_hidden_disclaimer: [
    'This is here to help you ask the right questions. Always confirm the final terms with the bank and in the contract.',
    'ეს ინფორმაცია დაგეხმარება სწორი კითხვების დასმაში. საბოლოო პირობები ყოველთვის გადაამოწმე ბანკთან და ხელშეკრულებაში.',
    'Это нужно, чтобы вы задали правильные вопросы. Итоговые условия всегда уточняйте в банке и в договоре.',
    'Bu, doğru soruları sormanız için. Son koşulları her zaman bankayla ve sözleşmede doğrulayın.',
    'هذا موجود ليساعدك على طرح الأسئلة الصحيحة. تأكّد دائمًا من الشروط النهائية مع البنك وفي العقد.',
    'זה כאן כדי לעזור לכם לשאול את השאלות הנכונות. אשרו תמיד את התנאים הסופיים מול הבנק ובחוזה.',
  ],

  /* ── 1. Early repayment ──────────────────────────────────────────── */

  mortgage_hidden_early_repayment_title: [
    'Paying the loan off early',
    'ვადამდე დაფარვა',
    'Досрочное погашение',
    'Krediyi erken kapatma',
    'السداد المبكر',
    'פירעון מוקדם',
  ],
  mortgage_sign_early_repayment_summary: [
    'Check what it costs to close the loan early.',
    'გადაამოწმე, რა დაგიჯდება სესხის ადრე დაფარვა.',
    'Уточните, во что обойдётся досрочное закрытие.',
    'Krediyi erken kapatmanın maliyetini kontrol edin.',
    'تحقّق من تكلفة إغلاق القرض مبكرًا.',
    'בדקו כמה עולה לסגור את ההלוואה מוקדם.',
  ],
  mortgage_hidden_early_repayment_body: [
    'Some banks charge a fee when you pay off more than the schedule asks for, or close the loan before the end. It is agreed on the first day and it is easy to miss.',
    'ზოგი ბანკი საკომისიოს იღებს, როცა გრაფიკზე მეტს იხდი ან სესხს ვადაზე ადრე ხურავ. ეს პირველივე დღეს ფორმდება და მარტივი გამოსატოვებელია.',
    'Некоторые банки берут комиссию, если вы платите больше графика или закрываете кредит досрочно. Это согласуют в первый же день, и это легко пропустить.',
    'Bazı bankalar, planın üstünde ödeme yaptığınızda ya da krediyi erken kapattığınızda ücret alır. İlk gün kararlaştırılır ve gözden kaçması kolaydır.',
    'بعض البنوك تفرض رسمًا عند الدفع فوق الجدول أو إغلاق القرض قبل نهايته. يُتفق عليه في اليوم الأول ومن السهل إغفاله.',
    'חלק מהבנקים גובים עמלה כשמשלמים מעבר ללוח הסילוקין או סוגרים את ההלוואה לפני הזמן. מסכימים על כך ביום הראשון וקל לפספס.',
  ],
  mortgage_sign_early_repayment_why: [
    'Every saving this page shows you from paying extra shrinks by that fee, and sometimes disappears completely.',
    'ყოველი დანაზოგი, რომელსაც ეს გვერდი დამატებით გადახდაზე გიჩვენებს, ამ საკომისიოთი მცირდება და ზოგჯერ სულ ქრება.',
    'Любая экономия от доплат, которую показывает эта страница, уменьшается на эту комиссию, а иногда исчезает совсем.',
    'Bu sayfanın fazladan ödemeden gösterdiği her tasarruf, o ücret kadar küçülür ve bazen tamamen kaybolur.',
    'كل توفير تعرضه هذه الصفحة من الدفع الإضافي يتقلّص بهذا الرسم، وأحيانًا يختفي تمامًا.',
    'כל חיסכון שהדף הזה מציג מתשלום נוסף מצטמצם בגלל העמלה, ולפעמים נעלם לגמרי.',
  ],
  mortgage_sign_early_repayment_ask: [
    'Give me the fee as a figure for year one, year three and year five, not as a formula.',
    'დამისახელე საკომისიო ციფრად პირველ, მესამე და მეხუთე წელს და არა ფორმულით.',
    'Назовите комиссию цифрой за первый, третий и пятый год, а не формулой.',
    'Ücreti birinci, üçüncü ve beşinci yıl için rakam olarak verin, formül olarak değil.',
    'أعطني الرسم كرقم للسنة الأولى والثالثة والخامسة، لا كصيغة.',
    'תנו לי את העמלה כמספר לשנה הראשונה, השלישית והחמישית, לא כנוסחה.',
  ],
  mortgage_sign_early_repayment_check: [
    'The early-repayment clause. Whether the fee is a share of what you repay or of what is left, and whether part payments are allowed at all.',
    'ვადამდე დაფარვის პუნქტი. საკომისიო დაფარული თანხის პროცენტია თუ დარჩენილი ვალის, და დაშვებულია თუ არა საერთოდ ნაწილობრივი დაფარვა.',
    'Пункт о досрочном погашении. Комиссия — доля от внесённого или от остатка, и разрешены ли частичные платежи вообще.',
    'Erken kapama maddesi. Ücret, ödediğiniz tutarın mı yoksa kalan borcun mu bir oranı ve kısmi ödemeye izin var mı.',
    'بند السداد المبكر. هل الرسم نسبة مما تسدّده أم من المتبقي، وهل يُسمح بالسداد الجزئي أصلًا.',
    'סעיף הפירעון המוקדם. אם העמלה היא אחוז ממה שפורעים או מהיתרה, ואם בכלל מותרים תשלומים חלקיים.',
  ],

  /* ── 2. Currency ─────────────────────────────────────────────────── */

  mortgage_hidden_fx_risk_title: [
    'A loan in foreign currency',
    'სესხი უცხოურ ვალუტაში',
    'Кредит в иностранной валюте',
    'Yabancı para cinsinden kredi',
    'قرض بعملة أجنبية',
    'הלוואה במטבע זר',
  ],
  mortgage_sign_fx_risk_summary: [
    'If your income is in another currency, a change in the rate can make the payment dearer.',
    'თუ შემოსავალი სხვა ვალუტაში გაქვს, კურსის ცვლილებამ შეიძლება გადასახადი გაგიძვიროს.',
    'Если доход в другой валюте, изменение курса может удорожить платёж.',
    'Geliriniz başka bir para birimindeyse, kur değişimi ödemeyi pahalılaştırabilir.',
    'إذا كان دخلك بعملة أخرى، فتغيّر السعر قد يجعل القسط أغلى.',
    'אם ההכנסה שלכם במטבע אחר, שינוי בשער יכול לייקר את ההחזר.',
  ],
  mortgage_hidden_fx_risk_body: [
    'You repay in the currency you borrowed in. If you are paid in another one, the exchange rate sits between your salary and your payment every month.',
    'სესხს იმ ვალუტაში აბრუნებ, რომელშიც აიღე. თუ სხვაში გიხდიან, კურსი ყოველთვე შენს ხელფასსა და გადასახადს შორის დგას.',
    'Вы возвращаете в той валюте, в которой взяли. Если платят в другой, курс каждый месяц стоит между зарплатой и платежом.',
    'Aldığınız para biriminde geri ödersiniz. Başka bir para biriminde maaş alıyorsanız, kur her ay maaşınızla ödemeniz arasında durur.',
    'تسدّد بالعملة التي اقترضت بها. إذا كان راتبك بعملة أخرى، فسعر الصرف يقف كل شهر بين راتبك وقسطك.',
    'מחזירים במטבע שבו לוויתם. אם משלמים לכם באחר, השער עומד כל חודש בין המשכורת להחזר.',
  ],
  mortgage_sign_fx_risk_why: [
    'The National Bank applies stricter limits to foreign-currency loans, which is the regulator saying the risk is real.',
    'ეროვნული ბანკი უცხოურ ვალუტაში სესხებს უფრო მკაცრ ზღვრებს უწესებს. ეს მარეგულირებლის ნათქვამია, რომ რისკი რეალურია.',
    'Национальный банк применяет к валютным кредитам более строгие лимиты. Это регулятор говорит, что риск реален.',
    'Merkez bankası yabancı para kredilerine daha sıkı sınırlar uygular. Bu, düzenleyicinin riskin gerçek olduğunu söylemesidir.',
    'يطبّق البنك الوطني حدودًا أشدّ على قروض العملة الأجنبية. هذه هي الجهة الرقابية تقول إن الخطر حقيقي.',
    'הבנק הלאומי מחיל מגבלות מחמירות יותר על הלוואות במטבע זר. זו הרגולציה אומרת שהסיכון אמיתי.',
  ],
  mortgage_sign_fx_risk_ask: [
    'What does my monthly payment become if the lari weakens by 20%, and by 30%?',
    'რა გახდება ჩემი თვიური გადასახადი, თუ ლარი 20%-ით დასუსტდება, და თუ 30%-ით?',
    'Каким станет мой платёж, если лари ослабнет на 20%, и на 30%?',
    'Lari %20 değer kaybederse, %30 kaybederse aylık ödemem ne olur?',
    'كم يصبح قسطي الشهري إذا ضعف اللاري 20%، وإذا ضعف 30%؟',
    'מה יהיה ההחזר החודשי שלי אם הלארי ייחלש ב-20%, וב-30%?',
  ],
  mortgage_sign_fx_risk_check: [
    'Whether the contract lets the bank convert the loan into another currency, and at whose exchange rate.',
    'აძლევს თუ არა ხელშეკრულება ბანკს სესხის სხვა ვალუტაში გადაყვანის უფლებას და ვისი კურსით.',
    'Разрешает ли договор банку перевести кредит в другую валюту и по чьему курсу.',
    'Sözleşme, bankaya krediyi başka bir para birimine çevirme hakkı veriyor mu ve kimin kuruyla.',
    'هل يسمح العقد للبنك بتحويل القرض إلى عملة أخرى، وبأي سعر صرف.',
    'האם החוזה מאפשר לבנק להמיר את ההלוואה למטבע אחר, ולפי שער של מי.',
  ],

  /* ── 3. Closing costs ────────────────────────────────────────────── */

  mortgage_hidden_closing_costs_title: [
    'Extra costs',
    'დამატებითი ხარჯები',
    'Дополнительные расходы',
    'Ek masraflar',
    'تكاليف إضافية',
    'עלויות נוספות',
  ],
  mortgage_sign_closing_costs_summary: [
    'Valuation, service and other charges do not always show up in the monthly payment.',
    'შეფასება, მომსახურება და სხვა ხარჯები თვიურ გადასახადში ყოველთვის არ ჩანს.',
    'Оценка, обслуживание и прочие сборы не всегда видны в месячном платеже.',
    'Ekspertiz, hizmet ve diğer masraflar aylık ödemede her zaman görünmez.',
    'التقييم والخدمة والرسوم الأخرى لا تظهر دائمًا في القسط الشهري.',
    'שמאות, שירות ועוד חיובים לא תמיד מופיעים בהחזר החודשי.',
  ],
  mortgage_hidden_closing_costs_body: [
    'Everything you pay on the day of signing that is not the deposit. Arrangement, valuation, notary, registration, and whatever else the bank adds.',
    'ყველაფერი, რასაც ხელმოწერის დღეს იხდი და რაც პირველადი შენატანი არ არის. გაფორმება, შეფასება, ნოტარიუსი, რეგისტრაცია და რაც ბანკს დამატებით აქვს.',
    'Всё, что вы платите в день подписания и что не является взносом. Оформление, оценка, нотариус, регистрация и всё, что добавит банк.',
    'İmza günü ödediğiniz ve peşinat olmayan her şey. Tahsis, ekspertiz, noter, tapu ve bankanın eklediği diğer kalemler.',
    'كل ما تدفعه يوم التوقيع وليس الدفعة الأولى. الترتيب والتقييم والتوثيق والتسجيل وما يضيفه البنك.',
    'כל מה שמשלמים ביום החתימה ואינו המקדמה. פתיחת תיק, שמאות, נוטריון, רישום, וכל מה שהבנק מוסיף.',
  ],
  mortgage_sign_closing_costs_why: [
    'They rarely appear in the headline figure, they come out of the money you receive, and they are why a borrower can arrive at signing short of cash.',
    'ისინი იშვიათად ჩანს მთავარ ციფრში, მიღებული თანხიდან გამოგაკლდება და სწორედ ამიტომ ხდება, რომ ხელმოწერაზე ფული არ გეყოს.',
    'Они редко попадают в главную цифру, вычитаются из полученных денег и потому заёмщик приходит на подписание без нужной суммы.',
    'Ana rakamda nadiren görünürler, aldığınız paradan düşülürler ve bu yüzden imzaya parası yetmeden gelinir.',
    'نادرًا ما تظهر في الرقم الرئيسي، وتُخصم من المال الذي تستلمه، ولهذا قد تصل إلى التوقيع بنقص في السيولة.',
    'הן כמעט לא מופיעות במספר הראשי, יורדות מהכסף שאתם מקבלים, ובגללן אפשר להגיע לחתימה בלי מספיק מזומן.',
  ],
  mortgage_sign_closing_costs_ask: [
    'Give me one written list of everything I pay on the day, with each amount.',
    'მომეცი ერთი წერილობითი სია ყველაფრისა, რასაც იმ დღეს გადავიხდი, თითოეული თანხით.',
    'Дайте один письменный список всего, что я плачу в тот день, с суммами.',
    'O gün ödeyeceğim her şeyin, tutarlarıyla birlikte tek bir yazılı listesini verin.',
    'أعطني قائمة مكتوبة واحدة بكل ما أدفعه في ذلك اليوم، مع كل مبلغ.',
    'תנו לי רשימה כתובה אחת של כל מה שאני משלם באותו יום, עם כל סכום.',
  ],
  mortgage_sign_closing_costs_check: [
    'Whether any of them are taken out of the loan rather than paid separately. That changes how much money actually reaches you.',
    'რომელიმე მათგანი სესხიდან იჭრება თუ ცალკე იხდი. ეს ცვლის იმას, რეალურად რამდენი ფული მოგდის.',
    'Вычитаются ли какие-то из них из кредита, а не платятся отдельно. Это меняет сумму, которая до вас дойдёт.',
    'Bunlardan biri ayrı ödenmek yerine krediden mi düşülüyor. Bu, size ulaşan parayı değiştirir.',
    'هل يُخصم أي منها من القرض بدل دفعه منفصلًا. هذا يغيّر المبلغ الذي يصلك فعليًا.',
    'האם חלק מהם יורדים מההלוואה במקום להיות משולמים בנפרד. זה משנה כמה כסף באמת מגיע אליכם.',
  ],

  /* ── 4. Insurance ────────────────────────────────────────────────── */

  mortgage_hidden_insurance_title: [
    'Insurance',
    'დაზღვევა',
    'Страхование',
    'Sigorta',
    'التأمين',
    'ביטוח',
  ],
  mortgage_sign_insurance_summary: [
    'Check which insurance is compulsory and which is simply offered.',
    'გადაამოწმე, რომელი დაზღვევაა აუცილებელი და რომელი დამატებითი.',
    'Уточните, какая страховка обязательна, а какую просто предлагают.',
    'Hangi sigortanın zorunlu, hangisinin sadece önerildiğini kontrol edin.',
    'تحقّق من أي تأمين إلزامي وأيها مجرد عرض.',
    'בדקו איזה ביטוח חובה ואיזה רק מוצע.',
  ],
  mortgage_hidden_insurance_body: [
    'A mortgage usually comes with property cover, and often with life cover as well. One of them may be a legal requirement and the other the bank’s own condition.',
    'იპოთეკას ჩვეულებრივ ქონების დაზღვევა ახლავს, ხშირად სიცოცხლისაც. ერთი შეიძლება კანონის მოთხოვნა იყოს, მეორე კი ბანკის საკუთარი პირობა.',
    'К ипотеке обычно идёт страховка имущества, часто и жизни. Одна может быть требованием закона, другая — условием банка.',
    'İpotekle birlikte genelde konut sigortası, çoğu zaman da hayat sigortası gelir. Biri yasal zorunluluk, diğeri bankanın kendi koşulu olabilir.',
    'يأتي الرهن عادةً مع تأمين على العقار، وغالبًا على الحياة أيضًا. قد يكون أحدهما مطلبًا قانونيًا والآخر شرط البنك نفسه.',
    'למשכנתה נלווה בדרך כלל ביטוח מבנה, ולעיתים גם ביטוח חיים. אחד מהם עשוי להיות דרישת חוק והשני תנאי של הבנק.',
  ],
  mortgage_sign_insurance_why: [
    'It is a cost that runs for the whole term, and it lands in the real cost of the loan whether or not anyone mentioned it when quoting you.',
    'ეს ხარჯი მთელ ვადაზე გრძელდება და სესხის რეალურ ღირებულებაში ხვდება, ახსენა თუ არა ვინმემ შეთავაზებისას.',
    'Это расход на весь срок, и он попадает в реальную стоимость кредита, упомянули его при расчёте или нет.',
    'Bu, tüm vade boyunca süren bir masraf ve teklif verilirken söylensin ya da söylenmesin kredinin gerçek maliyetine girer.',
    'هذه تكلفة تستمر طوال المدة، وتدخل في التكلفة الحقيقية للقرض سواء ذُكرت عند العرض أم لا.',
    'זו הוצאה שנמשכת כל התקופה, והיא נכנסת לעלות האמיתית של ההלוואה בין אם הזכירו אותה ובין אם לא.',
  ],
  mortgage_sign_insurance_ask: [
    'Which policy does the law require, which is your own condition, and may I buy it from another insurer?',
    'რომელ პოლისს ითხოვს კანონი, რომელია თქვენი პირობა და შემიძლია სხვა მზღვეველისგან ვიყიდო?',
    'Какой полис требует закон, какой — ваше условие, и можно ли купить его у другого страховщика?',
    'Hangi poliçeyi yasa istiyor, hangisi sizin koşulunuz ve başka bir sigortacıdan alabilir miyim?',
    'أي وثيقة يفرضها القانون، وأيها شرطكم أنتم، وهل يمكنني شراؤها من شركة أخرى؟',
    'איזו פוליסה החוק דורש, איזו היא תנאי שלכם, ואפשר לקנות אותה מחברה אחרת?',
  ],
  mortgage_sign_insurance_check: [
    'Whether the premium is fixed or repriced each year, and what happens to your rate if you change insurer.',
    'ფიქსირებულია თუ არა პრემია თუ ყოველწლიურად გადაიხედება, და რა ემართება შენს განაკვეთს მზღვეველის შეცვლისას.',
    'Фиксирована ли премия или пересматривается ежегодно, и что будет со ставкой при смене страховщика.',
    'Primin sabit mi olduğu yoksa her yıl mı güncellendiği ve sigortacı değiştirirseniz faizinize ne olacağı.',
    'هل القسط التأميني ثابت أم يُعاد تسعيره سنويًا، وماذا يحدث لنسبتك إذا غيّرت شركة التأمين.',
    'האם הפרמיה קבועה או מתעדכנת מדי שנה, ומה קורה לריבית אם מחליפים מבטח.',
  ],

  /* ── 5. Total cost ───────────────────────────────────────────────── */

  mortgage_hidden_legal_cap_title: [
    'The total cost of the loan',
    'სესხის სრული ღირებულება',
    'Полная стоимость кредита',
    'Kredinin toplam maliyeti',
    'التكلفة الإجمالية للقرض',
    'העלות הכוללת של ההלוואה',
  ],
  mortgage_sign_legal_cap_summary: [
    'Do not look at the rate alone. What matters is what you pay in the end.',
    'მხოლოდ პროცენტს ნუ შეხედავ. მნიშვნელოვანია, საბოლოოდ რამდენს გადაიხდი.',
    'Не смотрите только на ставку. Важно, сколько вы заплатите в итоге.',
    'Sadece faize bakmayın. Önemli olan sonunda ne ödediğiniz.',
    'لا تنظر إلى النسبة وحدها. المهم كم تدفع في النهاية.',
    'אל תסתכלו רק על הריבית. מה שחשוב זה כמה תשלמו בסוף.',
  ],
  mortgage_hidden_legal_cap_body: [
    'The law puts a ceiling on what a loan may cost in total, counting interest and the compulsory charges together rather than the rate on its own.',
    'კანონი ზღუდავს, სულ რამდენი შეიძლება დაგიჯდეს სესხი. ის ითვლის პროცენტსა და სავალდებულო ხარჯებს ერთად და არა მხოლოდ განაკვეთს.',
    'Закон ограничивает полную стоимость кредита, считая проценты и обязательные сборы вместе, а не одну ставку.',
    'Yasa, kredinin toplamda ne kadara mal olabileceğine bir tavan koyar; faizi ve zorunlu masrafları birlikte sayar, sadece oranı değil.',
    'يضع القانون سقفًا لما قد يكلّفه القرض إجمالًا، محتسبًا الفائدة والرسوم الإلزامية معًا لا النسبة وحدها.',
    'החוק קובע תקרה לעלות הכוללת של הלוואה, וסופר יחד את הריבית ואת החיובים שחובה לשלם, לא רק את הריבית.',
  ],
  mortgage_sign_legal_cap_why: [
    'A ceiling protects you only if you know it exists, and it caps the total cost rather than the headline rate. That is exactly the difference most borrowers never make.',
    'ჭერი მაშინ გიცავს, როცა იცი, რომ არსებობს. ის ზღუდავს სრულ ღირებულებას და არა გამოცხადებულ განაკვეთს. სწორედ ამ განსხვავებას არ აკეთებს მსესხებელთა უმეტესობა.',
    'Потолок защищает, только если вы о нём знаете, и он ограничивает полную стоимость, а не заявленную ставку. Именно этой разницы большинство не делает.',
    'Bir tavan, ancak varlığını biliyorsanız korur; üstelik ilan edilen oranı değil toplam maliyeti sınırlar. Çoğu kişinin yapmadığı ayrım tam olarak budur.',
    'السقف يحميك فقط إذا عرفت بوجوده، وهو يحدّ التكلفة الإجمالية لا النسبة المعلنة. هذا بالضبط الفرق الذي لا ينتبه إليه معظم المقترضين.',
    'תקרה מגנה רק אם יודעים שהיא קיימת, והיא מגבילה את העלות הכוללת ולא את הריבית המפורסמת. זה בדיוק ההבדל שרוב הלווים לא עושים.',
  ],
  mortgage_sign_legal_cap_ask: [
    'Put the total cost of this loan in writing, as a percentage of the amount I borrow.',
    'დამიწერე ამ სესხის სრული ღირებულება ნასესხები თანხის პროცენტად.',
    'Напишите полную стоимость этого кредита в процентах от суммы займа.',
    'Bu kredinin toplam maliyetini, aldığım tutarın yüzdesi olarak yazılı verin.',
    'اكتب لي التكلفة الإجمالية لهذا القرض كنسبة من المبلغ الذي أقترضه.',
    'תנו לי בכתב את העלות הכוללת של ההלוואה, כאחוז מהסכום שאני לווה.',
  ],
  mortgage_sign_legal_cap_check: [
    'That the contract states a total cost figure at all, and that it matches what you were quoted.',
    'რომ ხელშეკრულებაში საერთოდ წერია სრული ღირებულების ციფრი და რომ ის ემთხვევა შემოთავაზებულს.',
    'Что в договоре вообще указана полная стоимость и что она совпадает с озвученной.',
    'Sözleşmede bir toplam maliyet rakamının bulunduğunu ve size söylenenle uyuştuğunu.',
    'أن العقد يذكر رقم التكلفة الإجمالية أصلًا، وأنه يطابق ما عُرض عليك.',
    'שבחוזה בכלל מצוין מספר של עלות כוללת, ושהוא תואם למה שהוצג לכם.',
  ],

  /* ── 6. Grace period ─────────────────────────────────────────────── */

  mortgage_sign_grace_title: [
    'A lighter first stretch',
    'საშეღავათო პერიოდი',
    'Льготный период',
    'Ödemesiz başlangıç dönemi',
    'فترة سماح',
    'תקופת גרייס',
  ],
  mortgage_sign_grace_summary: [
    'A low payment at the start does not make the loan cheaper.',
    'დაბალი საწყისი გადასახადი ყოველთვის იაფ სესხს არ ნიშნავს.',
    'Низкий платёж в начале не делает кредит дешевле.',
    'Başta düşük ödeme, krediyi ucuzlatmaz.',
    'القسط المنخفض في البداية لا يجعل القرض أرخص.',
    'החזר נמוך בהתחלה לא הופך את ההלוואה לזולה יותר.',
  ],
  mortgage_sign_grace_what: [
    'For the first few months you pay interest only. The payment is smaller and the debt itself does not go down.',
    'პირველი რამდენიმე თვე მხოლოდ პროცენტს იხდი. გადასახადი უფრო მცირეა, ვალი კი არ მცირდება.',
    'Первые несколько месяцев вы платите только проценты. Платёж меньше, а сам долг не уменьшается.',
    'İlk birkaç ay sadece faiz ödersiniz. Ödeme küçüktür ve borcun kendisi azalmaz.',
    'في الأشهر الأولى تدفع الفائدة فقط. القسط أصغر والدين نفسه لا ينخفض.',
    'בחודשים הראשונים משלמים רק ריבית. ההחזר קטן יותר והחוב עצמו לא יורד.',
  ],
  mortgage_sign_grace_why: [
    'It is offered as a benefit and it costs money. Every such month is a month of interest on the full debt with no progress against it.',
    'ის სარგებლად არის შემოთავაზებული და ფული ჯდება. ყოველი ასეთი თვე სრულ ვალზე პროცენტის თვეა, ვალის შემცირების გარეშე.',
    'Это подают как выгоду, а стоит оно денег. Каждый такой месяц — месяц процентов на весь долг без продвижения.',
    'Bir avantaj gibi sunulur ve paraya mal olur. Böyle her ay, borç hiç azalmadan tam tutar üzerinden faiz ödenen bir aydır.',
    'يُقدَّم كميزة وهو يكلّف مالًا. كل شهر منه هو شهر فائدة على كامل الدين دون أي تقدّم.',
    'מציגים את זה כהטבה וזה עולה כסף. כל חודש כזה הוא חודש של ריבית על כל החוב בלי להתקדם.',
  ],
  mortgage_sign_grace_ask: [
    'Give me the total cost of the loan with the lighter start and without it, as two numbers.',
    'დამისახელე სესხის სრული ღირებულება საშეღავათო პერიოდით და მის გარეშე, ორ ციფრად.',
    'Назовите полную стоимость кредита с льготным периодом и без него, двумя цифрами.',
    'Kredinin toplam maliyetini ödemesiz dönemle ve onsuz, iki rakam olarak verin.',
    'أعطني التكلفة الإجمالية للقرض مع فترة السماح وبدونها، برقمين.',
    'תנו לי את העלות הכוללת עם תקופת הגרייס ובלעדיה, בשני מספרים.',
  ],
  mortgage_sign_grace_check: [
    'Whether it is optional, and whether turning it down changes the rate you are offered.',
    'არჩევითია თუ არა და ცვლის თუ არა მასზე უარის თქმა შემოთავაზებულ განაკვეთს.',
    'Является ли он добровольным и меняет ли отказ от него предложенную ставку.',
    'İsteğe bağlı mı ve reddetmek size sunulan oranı değiştiriyor mu.',
    'هل هي اختيارية، وهل رفضها يغيّر النسبة المعروضة عليك.',
    'האם היא אופציונלית, והאם ויתור עליה משנה את הריבית שמציעים לכם.',
  ],
};
