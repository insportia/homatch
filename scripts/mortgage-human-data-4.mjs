/*
 * PART 4 — the state subsidy, explained before it is checked.
 *
 * WHAT WAS WRONG, IN THE ORDER A PERSON MET IT
 *
 *   An English title on a Georgian page: "Subsidized Mortgage Loan —
 *   families with children (Decree No. 388, as amended by No. 218 of
 *   21 May 2026)". That string lives in the knowledge base, was never a
 *   translation key, and the owner's attempt to replace it through App
 *   Content did nothing because the key did not exist.
 *
 *   A formula before the benefit: "−4.75%" set large, above six
 *   bureaucratic questions, with nothing saying what it does to the
 *   money somebody pays.
 *
 *   The wrong child condition. The decree admits a family through a
 *   child UNDER ONE YEAR OLD born after 1 September 2021. The question
 *   asked only about the birth date, so a family with a four-year-old
 *   born in 2022 answered yes and was told they likely matched.
 *
 *   And then, after six questions, "does not match the published
 *   conditions" with no reason and nothing to do about it.
 *
 * THE SOURCE, AND WHAT WAS VERIFIED AGAINST IT
 *
 * Government of Georgia Decree No. 388 of 2 August 2021, consolidated
 * text at matsne.gov.ge/ka/document/view/5231778, as amended by Decree
 * No. 218 of 21 May 2026, read on 19 September 2026 and corroborated
 * against enterprisegeorgia.gov.ge:
 *
 *   Article 2 §5(a)  a child UNDER ONE YEAR OLD born after 2021-09-01
 *   Article 2 §5(b)  three or more children, FOR LOANS TAKEN UP TO AND
 *                    INCLUDING 2022-09-01 — a closed window
 *   Article 2 §5(c)  adoption of a minor after 2021-09-01
 *   Article 2 §4     lari only
 *   Article 2 §8     200,000 GEL maximum
 *   Article 5 §4     60 months; refinancing rate minus 3.5 points capped
 *                    at 6 for one or two children, minus 1.5 capped at 8
 *                    for three or more
 *
 * "Family / single parent / widow" appears INSIDE each of (a), (b) and
 * (c) rather than beside them, which is why being a single parent is
 * context here and not a way in. See the header of rules/subsidy.ts.
 *
 * key -> [en, ka, ru, tr, ar, he].
 */

export const PART_4 = {
  /* ── The programme, named in the reader's language ───────────────── */

  /* NEW KEY. The title used to come from the knowledge-base row, in
     English, on every locale. The row now carries this key instead. */
  mortgage_kb_subsidy_title: [
    'The state mortgage subsidy',
    'სახელმწიფო იპოთეკური სუბსიდია',
    'Государственная ипотечная субсидия',
    'Devlet konut kredisi sübvansiyonu',
    'دعم الدولة للقرض العقاري',
    'הסבסוד הממשלתי למשכנתה',
  ],
  mortgage_mod_programs_eyebrow: [
    'State programme',
    'სახელმწიფო პროგრამა',
    'Государственная программа',
    'Devlet programı',
    'برنامج حكومي',
    'תוכנית ממשלתית',
  ],
  mortgage_mod_programs_title: [
    'Support you may be able to get',
    'დახმარება, რომელიც შეიძლება მიიღო',
    'Поддержка, которую вы можете получить',
    'Alabileceğiniz destek',
    'دعم قد تحصل عليه',
    'סיוע שאולי תוכלו לקבל',
  ],
  mortgage_mod_programs_sub: [
    'Answer a few questions and we say whether your details appear to match the published conditions.',
    'უპასუხე რამდენიმე კითხვას და გეტყვით, ემთხვევა თუ არა შენი მონაცემები გამოქვეყნებულ პირობებს.',
    'Ответьте на несколько вопросов, и мы скажем, похоже ли, что ваши данные отвечают опубликованным условиям.',
    'Birkaç soruyu yanıtlayın, bilgilerinizin yayımlanmış koşullara uyup uymadığını söyleyelim.',
    'أجب عن بضعة أسئلة ونخبرك إن كانت بياناتك تبدو مطابقة للشروط المنشورة.',
    'ענו על כמה שאלות ונאמר אם הפרטים שלכם נראים תואמים לתנאים שפורסמו.',
  ],

  /*
   * THE BENEFIT, BEFORE THE FIRST QUESTION.
   *
   * Somebody should know what they are being asked about before they
   * are asked anything. This is the owner's own Georgian, which says
   * the condition, the ceiling and the currency in three short lines.
   */
  mortgage_kb_subsidy_human_explanation: [
    'If you have a child under one year old, the state may cover part of the interest on your mortgage for five years. It applies only to loans in lari, and only up to 200,000 GEL. Answer a few short questions below and we will show whether your details match the main conditions.',
    'თუ ოჯახში გყავთ 1 წლამდე ბავშვი, შეიძლება სახელმწიფო 5 წლის განმავლობაში იპოთეკის პროცენტის ნაწილს გიფარავდეთ. პროგრამა მხოლოდ ლარში აღებულ სესხზე მოქმედებს და სესხის დასაფინანსებელი ნაწილი მაქსიმუმ 200,000 ლარია. ქვემოთ რამდენიმე მარტივ კითხვას უპასუხე და გაჩვენებთ, ემთხვევა თუ არა შენი მონაცემები ძირითად პირობებს.',
    'Если у вас есть ребёнок младше года, государство может пять лет покрывать часть процентов по ипотеке. Программа действует только для кредитов в лари и только до 200 000 GEL. Ответьте на несколько коротких вопросов ниже, и мы покажем, совпадают ли ваши данные с основными условиями.',
    'Bir yaşından küçük çocuğunuz varsa, devlet beş yıl boyunca konut kredinizin faizinin bir kısmını karşılayabilir. Yalnızca lari cinsinden ve en fazla 200.000 GEL kredilerde geçerlidir. Aşağıdaki kısa soruları yanıtlayın, bilgilerinizin ana koşullara uyup uymadığını gösterelim.',
    'إذا كان لديك طفل دون سنة واحدة، فقد تغطّي الدولة جزءًا من فائدة قرضك العقاري لمدة خمس سنوات. ينطبق البرنامج على القروض باللاري فقط وبحد أقصى 200,000 GEL. أجب عن الأسئلة القصيرة أدناه وسنُظهر لك إن كانت بياناتك تطابق الشروط الأساسية.',
    'אם יש לכם ילד מתחת לגיל שנה, המדינה עשויה לכסות חלק מהריבית על המשכנתה במשך חמש שנים. התוכנית חלה רק על הלוואות בלארי ועד 200,000 GEL. ענו על כמה שאלות קצרות למטה ונראה אם הפרטים שלכם תואמים לתנאים העיקריים.',
  ],

  /* ── The four plain facts ────────────────────────────────────────── */

  mortgage_subsidy_fact_duration: [
    'How long',
    'რამდენ ხანს',
    'Как долго',
    'Ne kadar süre',
    'كم المدة',
    'לכמה זמן',
  ],
  mortgage_subsidy_fact_currency: [
    'Which loans',
    'რა სესხზე',
    'На какие кредиты',
    'Hangi krediler',
    'أي قروض',
    'על אילו הלוואות',
  ],
  mortgage_subsidy_fact_currency_value: [
    'Only loans in {{currency}}',
    'მხოლოდ {{currency}}-ში აღებული სესხი',
    'Только кредиты в {{currency}}',
    'Yalnızca {{currency}} cinsinden krediler',
    'القروض بعملة {{currency}} فقط',
    'רק הלוואות ב-{{currency}}',
  ],
  mortgage_subsidy_fact_max: [
    'Largest loan',
    'მაქსიმალური სესხი',
    'Максимальный кредит',
    'En yüksek kredi',
    'أعلى مبلغ قرض',
    'ההלוואה המקסימלית',
  ],
  mortgage_subsidy_fact_covers: [
    'What the state covers',
    'რამდენს ფარავს სახელმწიფო',
    'Что покрывает государство',
    'Devlet neyi karşılıyor',
    'ما الذي تغطّيه الدولة',
    'מה המדינה מכסה',
  ],
  mortgage_subsidy_duration_years: [
    '{{years}} years from the day the loan starts',
    'სესხის აღებიდან {{years}} წელი',
    '{{years}} лет с начала кредита',
    'Kredinin başladığı günden itibaren {{years}} yıl',
    '{{years}} سنوات من يوم بدء القرض',
    '{{years}} שנים מיום תחילת ההלוואה',
  ],

  /* ── What it is worth, said in money rather than in points ───────── */

  mortgage_subsidy_worth_title: [
    'What this means for you',
    'რას ნიშნავს ეს შენთვის',
    'Что это значит для вас',
    'Bu sizin için ne demek',
    'ماذا يعني هذا لك',
    'מה זה אומר עבורכם',
  ],
  mortgage_subsidy_worth_points: [
    '{{points}} percentage points off your interest',
    'პროცენტს {{points}} პროცენტული პუნქტით გიმცირებს',
    'Снижает процент на {{points}} процентных пункта',
    'Faizinizi {{points}} puan düşürür',
    'يخفّض فائدتك بمقدار {{points}} نقطة مئوية',
    'מוריד מהריבית {{points}} נקודות אחוז',
  ],
  /*
   * THE SENTENCE THE BIG NUMBER NEEDED.
   *
   * "−4.75%" on its own is a figure from a decree. This says what it
   * does to the rate the person actually entered, which is the only
   * form of it anybody can act on.
   */
  mortgage_subsidy_your_rate: [
    'On these terms the state covers part of the interest. Your {{nominal}}% rate works out at roughly {{rate}} for the first {{years}} years.',
    'ამ პირობებით სახელმწიფო პროცენტის ნაწილს დაგიფარავს. შენი {{nominal}}%-იანი განაკვეთის ეფექტი პირველი {{years}} წლის განმავლობაში დაახლოებით {{rate}}-მდე ჩამოდის.',
    'На этих условиях государство покрывает часть процентов. Ваша ставка {{nominal}}% первые {{years}} лет выходит примерно в {{rate}}.',
    'Bu koşullarda devlet faizin bir kısmını karşılar. %{{nominal}} oranınız ilk {{years}} yıl için yaklaşık {{rate}} seviyesine iner.',
    'بهذه الشروط تغطّي الدولة جزءًا من الفائدة. نسبتك {{nominal}}% تصبح نحو {{rate}} خلال أول {{years}} سنوات.',
    'בתנאים האלה המדינה מכסה חלק מהריבית. הריבית שלכם {{nominal}}% יוצאת בערך {{rate}} ב-{{years}} השנים הראשונות.',
  ],
  mortgage_subsidy_not_bank_rate: [
    'This is not the rate the bank gives you. The bank keeps its own rate and the state pays part of the interest for you.',
    'ეს ბანკის განაკვეთი არ არის. ბანკს თავისი განაკვეთი რჩება, სახელმწიფო კი პროცენტის ნაწილს შენს ნაცვლად იხდის.',
    'Это не ставка банка. Банк оставляет свою ставку, а часть процентов за вас платит государство.',
    'Bu, bankanın size verdiği oran değil. Banka kendi oranını korur, faizin bir kısmını devlet sizin yerinize öder.',
    'هذه ليست النسبة التي يمنحك إياها البنك. يحتفظ البنك بنسبته وتدفع الدولة جزءًا من الفائدة عنك.',
    'זו לא הריבית שהבנק נותן לכם. הבנק שומר על הריבית שלו והמדינה משלמת חלק מהריבית במקומכם.',
  ],
  mortgage_subsidy_rate_basis: [
    'Worked out against the National Bank policy rate of {{reference}}, for {{months}} months.',
    'გამოთვლილია ეროვნული ბანკის რეფინანსირების განაკვეთზე {{reference}} და {{months}} თვეზე.',
    'Рассчитано от ставки рефинансирования Национального банка {{reference}}, на {{months}} месяцев.',
    'Merkez bankasının {{reference}} politika faizine göre, {{months}} ay için hesaplandı.',
    'محسوب على أساس نسبة السياسة النقدية للبنك الوطني {{reference}}، لمدة {{months}} شهرًا.',
    'מחושב מול ריבית המדיניות של הבנק הלאומי של גאורגיה, {{reference}}, ל-{{months}} חודשים.',
  ],
  mortgage_subsidy_cap_applied: [
    'The decree’s own ceiling sets this figure, not the policy rate, so it will not grow if the policy rate rises.',
    'ამ ციფრს დადგენილების ზედა ზღვარი განსაზღვრავს და არა რეფინანსირების განაკვეთი, ამიტომ განაკვეთის ზრდისას არ გაიზრდება.',
    'Эту цифру задаёт потолок постановления, а не ставка рефинансирования, поэтому при её росте она не увеличится.',
    'Bu rakamı, politika faizi değil kararnamenin kendi tavanı belirler; bu yüzden politika faizi yükselse de artmaz.',
    'هذا الرقم يحدّده سقف المرسوم لا نسبة السياسة النقدية، لذا لن يزيد إن ارتفعت تلك النسبة.',
    'את המספר הזה קובעת התקרה שבצו ולא ריבית המדיניות, ולכן הוא לא יגדל אם היא תעלה.',
  ],
  mortgage_subsidy_worth_unavailable: [
    'We could not check the current conditions of the programme just now. Try again shortly, or open the official source below.',
    'პროგრამის მიმდინარე პირობები ახლა ვერ გადავამოწმეთ. ცოტა ხანში სცადე ან ქვემოთ ოფიციალური წყარო გახსენი.',
    'Сейчас не удалось проверить текущие условия программы. Попробуйте позже или откройте официальный источник ниже.',
    'Programın güncel koşullarını şu an kontrol edemedik. Az sonra tekrar deneyin ya da aşağıdaki resmî kaynağı açın.',
    'لم نتمكّن من التحقّق من شروط البرنامج الحالية الآن. حاول بعد قليل أو افتح المصدر الرسمي أدناه.',
    'לא הצלחנו לבדוק כרגע את התנאים העדכניים של התוכנית. נסו בעוד רגע או פתחו את המקור הרשמי למטה.',
  ],

  /* ── The questions ───────────────────────────────────────────────── */

  mortgage_subsidy_check_title: [
    'A few quick questions',
    'რამდენიმე მოკლე კითხვა',
    'Несколько коротких вопросов',
    'Birkaç kısa soru',
    'بضعة أسئلة قصيرة',
    'כמה שאלות קצרות',
  ],
  mortgage_subsidy_check_sub: [
    'Your answers stay on this device. We compare them with the published conditions.',
    'პასუხები ამ მოწყობილობაზე რჩება. ჩვენ მათ გამოქვეყნებულ პირობებს ვადარებთ.',
    'Ответы остаются на этом устройстве. Мы сверяем их с опубликованными условиями.',
    'Yanıtlarınız bu cihazda kalır. Onları yayımlanmış koşullarla karşılaştırırız.',
    'تبقى إجاباتك على هذا الجهاز. نقارنها بالشروط المنشورة.',
    'התשובות נשארות במכשיר הזה. אנחנו משווים אותן לתנאים שפורסמו.',
  ],
  mortgage_subsidy_condition_met: [
    'This condition is met',
    'ეს პირობა სრულდება',
    'Это условие выполнено',
    'Bu koşul sağlanıyor',
    'هذا الشرط مستوفى',
    'התנאי הזה מתקיים',
  ],
  mortgage_subsidy_not_checkable: [
    'The published rule does not put this precisely enough for us to check it. Ask the programme administrator.',
    'გამოქვეყნებული წესი ამას საკმარისად ზუსტად არ აყალიბებს, ამიტომ ვერ ვამოწმებთ. ჰკითხე პროგრამის ადმინისტრატორს.',
    'Опубликованное правило формулирует это недостаточно точно, чтобы мы проверили. Спросите администратора программы.',
    'Yayımlanan kural bunu kontrol edebileceğimiz kadar net söylemiyor. Program yöneticisine sorun.',
    'القاعدة المنشورة لا تحدّد هذا بدقة كافية لنتحقّق منه. اسأل إدارة البرنامج.',
    'הכלל שפורסם לא מנוסח מספיק מדויק כדי שנוכל לבדוק. שאלו את מנהל התוכנית.',
  ],
  /* Context conditions do not open the door on their own, and saying so
     is better than letting somebody read a "yes" as a qualification. */
  mortgage_subsidy_context_note: [
    'This answer does not qualify you on its own. It helps us work out what the subsidy would be worth.',
    'ეს პასუხი თავისთავად პროგრამაში არ გატარებს. ის გვეხმარება დავთვალოთ, რამდენი იქნება სუბსიდია.',
    'Этот ответ сам по себе не даёт права на программу. Он помогает рассчитать размер субсидии.',
    'Bu yanıt tek başına sizi programa dahil etmez. Sübvansiyonun ne kadar olacağını hesaplamamıza yardım eder.',
    'هذه الإجابة وحدها لا تؤهّلك. إنها تساعدنا على حساب قيمة الدعم.',
    'התשובה הזו לבדה לא מזכה אתכם. היא עוזרת לנו לחשב כמה הסבסוד שווה.',
  ],
  mortgage_subsidy_route_closed: [
    'This condition applied only to loans taken up to 1 September 2022, so it no longer opens the programme on its own.',
    'ეს პირობა მხოლოდ 2022 წლის 1 სექტემბრამდე აღებულ სესხებზე მოქმედებდა, ამიტომ დღეს თავისთავად პროგრამაში აღარ გატარებს.',
    'Это условие действовало только для кредитов, взятых до 1 сентября 2022 года, поэтому само по себе оно больше не открывает программу.',
    'Bu koşul yalnızca 1 Eylül 2022’ye kadar alınan kredilerde geçerliydi, bu yüzden artık tek başına programa girmenizi sağlamaz.',
    'كان هذا الشرط ينطبق فقط على القروض المأخوذة حتى 1 سبتمبر 2022، لذا لم يعد يفتح البرنامج وحده.',
    'התנאי הזה חל רק על הלוואות שנלקחו עד 1 בספטמבר 2022, ולכן הוא כבר לא פותח את התוכנית בפני עצמו.',
  ],

  /* The conditions, as the decree states them. */
  mortgage_kb_subsidy_eligibility_citizenship: [
    'At least one of you must be a Georgian citizen.',
    'ოჯახის შემთხვევაში საქართველოს მოქალაქე უნდა იყოს სულ მცირე ერთი მეუღლე.',
    'Хотя бы один из вас должен быть гражданином Грузии.',
    'İkinizden en az birinin Gürcistan vatandaşı olması gerekir.',
    'يجب أن يكون أحدكما على الأقل مواطنًا جورجيًا.',
    'לפחות אחד מכם צריך להיות אזרח גאורגי.',
  ],
  mortgage_kb_subsidy_eligibility_no_prior_scheme: [
    'You cannot use this programme if you were already a beneficiary of the 2020 mortgage support mechanism.',
    'ამ პროგრამით ვერ ისარგებლებთ, თუ უკვე იყავით 2020 წლის იპოთეკური მხარდაჭერის პროგრამის ბენეფიციარი.',
    'Программой нельзя воспользоваться, если вы уже были получателем поддержки по механизму 2020 года.',
    'Zaten 2020 konut kredisi destek mekanizmasından yararlandıysanız bu programı kullanamazsınız.',
    'لا يمكنك الاستفادة من هذا البرنامج إذا كنت مستفيدًا من آلية دعم الرهن لعام 2020.',
    'לא תוכלו להשתמש בתוכנית אם כבר נהניתם ממנגנון הסיוע למשכנתאות של 2020.',
  ],
  mortgage_kb_subsidy_eligibility_child_born_after: [
    'At the time you take the loan the child must be under one year old, and born after 1 September 2021.',
    'სესხის აღების დროს ბავშვი უნდა იყოს 1 წლამდე და დაბადებული 2021 წლის 1 სექტემბრის შემდეგ.',
    'На момент получения кредита ребёнку должно быть меньше года и он должен быть рождён после 1 сентября 2021 года.',
    'Krediyi aldığınız anda çocuğun bir yaşından küçük ve 1 Eylül 2021’den sonra doğmuş olması gerekir.',
    'وقت الحصول على القرض يجب أن يكون عمر الطفل أقل من سنة وأن يكون مولودًا بعد 1 سبتمبر 2021.',
    'בזמן נטילת ההלוואה הילד צריך להיות מתחת לגיל שנה ולהיוולד אחרי 1 בספטמבר 2021.',
  ],
  mortgage_kb_subsidy_eligibility_three_plus_children: [
    'The three-or-more-children condition applied to loans taken up to and including 1 September 2022.',
    'სამი ან მეტი შვილის ძველი პირობა ეხებოდა სესხებს, რომლებიც 2022 წლის 1 სექტემბრის ჩათვლით აიღეს.',
    'Условие о трёх и более детях касалось кредитов, взятых по 1 сентября 2022 года включительно.',
    'Üç ya da daha fazla çocuk koşulu, 1 Eylül 2022 dahil olmak üzere alınan kredileri kapsıyordu.',
    'شرط ثلاثة أطفال أو أكثر كان يخصّ القروض المأخوذة حتى 1 سبتمبر 2022 ضمنًا.',
    'התנאי של שלושה ילדים או יותר חל על הלוואות שנלקחו עד 1 בספטמבר 2022 ועד בכלל.',
  ],
  mortgage_kb_subsidy_eligibility_adopted_child: [
    'The programme also covers adopting a minor after 1 September 2021.',
    'პროგრამა ასევე ითვალისწინებს 2021 წლის 1 სექტემბრის შემდეგ არასრულწლოვანი ბავშვის შვილად აყვანის შემთხვევას.',
    'Программа также охватывает усыновление несовершеннолетнего после 1 сентября 2021 года.',
    'Program, 1 Eylül 2021’den sonra bir çocuğun evlat edinilmesini de kapsar.',
    'يشمل البرنامج أيضًا تبنّي قاصر بعد 1 سبتمبر 2021.',
    'התוכנית מכסה גם אימוץ קטין אחרי 1 בספטמבר 2021.',
  ],
  mortgage_kb_subsidy_eligibility_single_parent_widow: [
    'Families, single parents and widowed parents all qualify through the same conditions.',
    'ოჯახს, მარტოხელა მშობელსა და ქვრივ მშობელს ერთი და იგივე პირობები აქვს.',
    'Семьи, одинокие родители и овдовевшие родители проходят по одним и тем же условиям.',
    'Aileler, tek ebeveynler ve dul ebeveynler aynı koşullarla hak kazanır.',
    'الأسر والوالد الوحيد والأرمل جميعهم يخضعون للشروط نفسها.',
    'משפחות, הורים יחידים והורים אלמנים זכאים לפי אותם תנאים בדיוק.',
  ],

  mortgage_kb_subsidy_q_citizenship: [
    'Are you or your spouse a Georgian citizen?',
    'თქვენ ან თქვენი მეუღლე საქართველოს მოქალაქე ხართ?',
    'Вы или ваш супруг гражданин Грузии?',
    'Siz ya da eşiniz Gürcistan vatandaşı mısınız?',
    'هل أنت أو زوجك مواطن جورجي؟',
    'אתם או בן/בת הזוג אזרחים גאורגים?',
  ],
  mortgage_kb_subsidy_q_prior_scheme: [
    'Have you already used the 2020 mortgage support programme?',
    'უკვე ისარგებლეთ 2020 წლის იპოთეკური მხარდაჭერის პროგრამით?',
    'Вы уже пользовались программой поддержки ипотеки 2020 года?',
    '2020 konut kredisi destek programından daha önce yararlandınız mı?',
    'هل استفدت من قبل من برنامج دعم الرهن لعام 2020؟',
    'כבר השתמשתם בתוכנית הסיוע למשכנתאות של 2020?',
  ],
  /* THE CONDITION THE OLD QUESTION LEFT OUT. */
  mortgage_kb_subsidy_q_child_after_2021: [
    'At the time you take the loan, do you have a child under one year old?',
    'სესხის აღების დროს გყავთ 1 წლამდე ბავშვი?',
    'На момент получения кредита у вас есть ребёнок младше года?',
    'Krediyi aldığınız anda bir yaşından küçük çocuğunuz var mı?',
    'وقت الحصول على القرض، هل لديك طفل دون سنة واحدة؟',
    'בזמן נטילת ההלוואה, יש לכם ילד מתחת לגיל שנה?',
  ],
  mortgage_kb_subsidy_q_children_count: [
    'How many children do you have?',
    'რამდენი შვილი გყავთ?',
    'Сколько у вас детей?',
    'Kaç çocuğunuz var?',
    'كم عدد أطفالك؟',
    'כמה ילדים יש לכם?',
  ],
  mortgage_kb_subsidy_q_adopted_after_2021: [
    'Have you adopted a child since 1 September 2021?',
    '2021 წლის 1 სექტემბრის შემდეგ იშვილეთ არასრულწლოვანი ბავშვი?',
    'Вы усыновили ребёнка после 1 сентября 2021 года?',
    '1 Eylül 2021’den bu yana bir çocuk evlat edindiniz mi?',
    'هل تبنّيت طفلًا منذ 1 سبتمبر 2021؟',
    'אימצתם ילד מאז 1 בספטמבר 2021?',
  ],
  mortgage_kb_subsidy_q_single_parent: [
    'Are you a single parent or a widowed parent?',
    'ხართ მარტოხელა ან ქვრივი მშობელი?',
    'Вы одинокий или овдовевший родитель?',
    'Tek ebeveyn ya da dul ebeveyn misiniz?',
    'هل أنت والد وحيد أو أرمل؟',
    'אתם הורה יחיד או הורה אלמן?',
  ],
  mortgage_kb_subsidy_property_condition: [
    'The loan must be used to buy a flat or a house, or to build one, under the conditions of the programme.',
    'სესხი უნდა გამოიყენოთ საცხოვრებელი ბინის ან სახლის შესაძენად, ან სახლის ასაშენებლად, პროგრამის პირობების შესაბამისად.',
    'Кредит должен пойти на покупку квартиры или дома либо на строительство, по условиям программы.',
    'Kredi, programın koşulları çerçevesinde bir daire ya da ev almak veya inşa etmek için kullanılmalıdır.',
    'يجب استخدام القرض لشراء شقة أو منزل، أو لبنائه، وفق شروط البرنامج.',
    'ההלוואה צריכה לשמש לרכישת דירה או בית, או לבנייתו, לפי תנאי התוכנית.',
  ],
  mortgage_kb_subsidy_description_rate_reduction: [
    'The state pays part of the interest for five years. How much depends on the number of children and on the National Bank policy rate.',
    'სახელმწიფო 5 წლის განმავლობაში იპოთეკის პროცენტის ნაწილს ფარავს. ზუსტი შეღავათი დამოკიდებულია შვილების რაოდენობასა და ეროვნული ბანკის რეფინანსირების განაკვეთზე.',
    'Государство пять лет платит часть процентов. Размер зависит от числа детей и от ставки Национального банка.',
    'Devlet beş yıl boyunca faizin bir kısmını öder. Miktar, çocuk sayısına ve merkez bankası politika faizine bağlıdır.',
    'تدفع الدولة جزءًا من الفائدة لمدة خمس سنوات. المقدار يعتمد على عدد الأطفال وعلى نسبة البنك الوطني.',
    'המדינה משלמת חלק מהריבית במשך חמש שנים. הסכום תלוי במספר הילדים ובריבית של הבנק הלאומי.',
  ],

  /* ── The result, which is the part that was missing ──────────────── */

  mortgage_subsidy_verdict_likely: [
    'Your details match the main conditions',
    'შენი მონაცემები ძირითად პირობებს ემთხვევა',
    'Ваши данные отвечают основным условиям',
    'Bilgileriniz ana koşullara uyuyor',
    'بياناتك تطابق الشروط الأساسية',
    'הפרטים שלכם תואמים לתנאים העיקריים',
  ],
  mortgage_subsidy_verdict_no: [
    'On these details you do not match the main conditions',
    'ამ მონაცემებით პროგრამის ძირითად პირობებს ვერ ემთხვევი',
    'С этими данными вы не отвечаете основным условиям',
    'Bu bilgilerle ana koşullara uymuyorsunuz',
    'بهذه البيانات لا تطابق الشروط الأساسية',
    'עם הפרטים האלה אינכם תואמים לתנאים העיקריים',
  ],
  mortgage_subsidy_verdict_unknown: [
    'We need a little more information',
    'კიდევ ერთი ინფორმაცია გვჭირდება',
    'Нужно ещё немного информации',
    'Biraz daha bilgiye ihtiyacımız var',
    'نحتاج القليل من المعلومات الإضافية',
    'צריך עוד קצת מידע',
  ],
  mortgage_subsidy_met_title: [
    'Why it matches',
    'რატომ ემთხვევა',
    'Почему совпадает',
    'Neden uyuyor',
    'لماذا يطابق',
    'למה זה תואם',
  ],
  mortgage_subsidy_reason_title: [
    'The main reason',
    'მთავარი მიზეზი',
    'Главная причина',
    'Ana neden',
    'السبب الرئيسي',
    'הסיבה העיקרית',
  ],
  mortgage_subsidy_outstanding_title: [
    'Still to answer',
    'ჯერ კიდევ საპასუხოა',
    'Ещё нужно ответить',
    'Hâlâ yanıtlanacaklar',
    'ما زال يحتاج إجابة',
    'עוד צריך לענות',
  ],
  mortgage_subsidy_met_currency: [
    'The loan is in {{program}}, which is what the programme requires',
    'სესხი {{program}}-შია, სწორედ ისე, როგორც პროგრამა ითხოვს',
    'Кредит в {{program}}, как и требует программа',
    'Kredi {{program}} cinsinden, programın istediği gibi',
    'القرض بعملة {{program}}، وهو ما يشترطه البرنامج',
    'ההלוואה ב-{{program}}, בדיוק כפי שהתוכנית דורשת',
  ],
  mortgage_subsidy_met_within_max: [
    'The amount is inside the programme limit of {{max}}',
    'თანხა პროგრამის {{max}} ზღვარშია',
    'Сумма в пределах лимита программы {{max}}',
    'Tutar, programın {{max}} sınırı içinde',
    'المبلغ ضمن حد البرنامج {{max}}',
    'הסכום בתוך המגבלה של התוכנית, {{max}}',
  ],
  mortgage_kb_subsidy_met_citizenship: [
    'The citizenship condition is met',
    'მოქალაქეობის პირობა შესრულებულია',
    'Условие о гражданстве выполнено',
    'Vatandaşlık koşulu sağlanıyor',
    'شرط الجنسية مستوفى',
    'תנאי האזרחות מתקיים',
  ],
  mortgage_kb_subsidy_met_no_prior_scheme: [
    'You have not used the 2020 programme',
    'არ გისარგებლიათ 2020 წლის პროგრამით',
    'Вы не пользовались программой 2020 года',
    '2020 programından yararlanmadınız',
    'لم تستفد من برنامج 2020',
    'לא השתמשתם בתוכנית של 2020',
  ],
  mortgage_kb_subsidy_met_child_under_one: [
    'You have a child of the right age',
    'გყავს შესაბამისი ასაკის ბავშვი',
    'У вас есть ребёнок подходящего возраста',
    'Uygun yaşta bir çocuğunuz var',
    'لديك طفل بالعمر المطلوب',
    'יש לכם ילד בגיל המתאים',
  ],
  mortgage_kb_subsidy_met_adopted_child: [
    'You adopted a child after 1 September 2021',
    'შვილად აყვანა 2021 წლის 1 სექტემბრის შემდეგ მოხდა',
    'Вы усыновили ребёнка после 1 сентября 2021 года',
    '1 Eylül 2021’den sonra evlat edindiniz',
    'تبنّيت طفلًا بعد 1 سبتمبر 2021',
    'אימצתם ילד אחרי 1 בספטמבר 2021',
  ],
  mortgage_kb_subsidy_failed_citizenship: [
    'The programme is for Georgian citizens, and neither of you is one.',
    'პროგრამა საქართველოს მოქალაქეებისთვისაა, თქვენ კი არცერთი არ ხართ.',
    'Программа для граждан Грузии, а вы ими не являетесь.',
    'Program Gürcistan vatandaşları içindir ve ikiniz de vatandaş değilsiniz.',
    'البرنامج للمواطنين الجورجيين، ولا أحد منكما كذلك.',
    'התוכנית מיועדת לאזרחי גאורגיה, ואף אחד מכם אינו אזרח.',
  ],
  mortgage_kb_subsidy_failed_no_prior_scheme: [
    'You have already been a beneficiary of the 2020 mortgage support programme, and the decree rules that out.',
    'უკვე ისარგებლეთ 2020 წლის იპოთეკური მხარდაჭერის პროგრამით, დადგენილება კი ამას გამორიცხავს.',
    'Вы уже были получателем поддержки по программе 2020 года, а постановление это исключает.',
    'Daha önce 2020 konut kredisi destek programından yararlandınız ve kararname bunu dışlıyor.',
    'سبق أن استفدت من برنامج دعم الرهن لعام 2020، والمرسوم يستبعد ذلك.',
    'כבר נהניתם מתוכנית הסיוע למשכנתאות של 2020, והצו שולל זאת.',
  ],

  mortgage_subsidy_reason_currency: [
    'The main reason is the currency. The programme only applies to a mortgage taken in {{program}}, and you have chosen {{chosen}}.',
    'მთავარი მიზეზი სესხის ვალუტაა. პროგრამა მხოლოდ {{program}}-ში აღებულ იპოთეკაზე მოქმედებს, შენ კი {{chosen}} გაქვს არჩეული.',
    'Главная причина — валюта. Программа действует только для ипотеки в {{program}}, а вы выбрали {{chosen}}.',
    'Ana neden para birimi. Program yalnızca {{program}} cinsinden alınan konut kredisinde geçerli, siz ise {{chosen}} seçtiniz.',
    'السبب الرئيسي هو العملة. البرنامج ينطبق فقط على رهن بعملة {{program}}، وأنت اخترت {{chosen}}.',
    'הסיבה העיקרית היא המטבע. התוכנית חלה רק על משכנתה ב-{{program}}, ואתם בחרתם {{chosen}}.',
  ],
  mortgage_subsidy_next_currency: [
    'If a loan in {{program}} is an option for you, change the currency above and we will check again.',
    'თუ {{program}} სესხსაც განიხილავ, შეცვალე ვალუტა ზემოთ და თავიდან შევამოწმებთ.',
    'Если кредит в {{program}} для вас вариант, поменяйте валюту выше, и мы проверим заново.',
    '{{program}} cinsinden bir kredi sizin için mümkünse, yukarıdan para birimini değiştirin, yeniden kontrol edelim.',
    'إذا كان قرض بعملة {{program}} خيارًا لك، غيّر العملة أعلاه وسنتحقّق من جديد.',
    'אם הלוואה ב-{{program}} רלוונטית לכם, שנו את המטבע למעלה ונבדוק שוב.',
  ],
  mortgage_subsidy_reason_over_max: [
    'Your loan of {{loan}} is above the programme ceiling of {{max}}.',
    'შენი სესხი {{loan}} პროგრამის {{max}} ზღვარს აღემატება.',
    'Ваш кредит {{loan}} выше потолка программы {{max}}.',
    '{{loan}} tutarındaki krediniz, programın {{max}} tavanının üzerinde.',
    'قرضك البالغ {{loan}} يتجاوز سقف البرنامج {{max}}.',
    'ההלוואה שלכם, {{loan}}, מעל תקרת התוכנית שהיא {{max}}.',
  ],
  mortgage_subsidy_next_over_max: [
    'A larger down payment that brings the loan to {{max}} or below would meet this condition.',
    'უფრო დიდი პირველადი შენატანი, რომელიც სესხს {{max}}-მდე ან ქვემოთ ჩამოიყვანს, ამ პირობას დააკმაყოფილებს.',
    'Больший первоначальный взнос, доводящий кредит до {{max}} или ниже, выполнит это условие.',
    'Krediyi {{max}} ya da altına indiren daha büyük bir peşinat bu koşulu karşılar.',
    'دفعة أولى أكبر تُنزل القرض إلى {{max}} أو أقل تستوفي هذا الشرط.',
    'מקדמה גדולה יותר שתוריד את ההלוואה ל-{{max}} או פחות תעמוד בתנאי הזה.',
  ],
  mortgage_subsidy_reason_mandatory_failed: [
    'One of the conditions the programme requires of everyone was answered no.',
    'ერთ-ერთ პირობაზე, რომელსაც პროგრამა ყველასგან ითხოვს, პასუხი უარყოფითია.',
    'На одно из условий, обязательных для всех, дан отрицательный ответ.',
    'Programın herkesten istediği koşullardan birine hayır yanıtı verildi.',
    'أُجيب بلا على أحد الشروط التي يطلبها البرنامج من الجميع.',
    'על אחד התנאים שהתוכנית דורשת מכולם נענתה תשובה שלילית.',
  ],
  mortgage_subsidy_reason_no_route: [
    'None of the situations the programme is built for applies here. It is for a family with a child under one, or one that has adopted a child since September 2021.',
    'პროგრამის არცერთი შემთხვევა აქ არ ვრცელდება. ის განკუთვნილია ოჯახისთვის, რომელსაც 1 წლამდე ბავშვი ჰყავს, ან რომელმაც 2021 წლის სექტემბრიდან იშვილა.',
    'Ни одна из ситуаций, для которых создана программа, здесь не подходит. Она для семьи с ребёнком до года или усыновившей ребёнка с сентября 2021 года.',
    'Programın kurgulandığı durumlardan hiçbiri burada geçerli değil. Program, bir yaşından küçük çocuğu olan ya da Eylül 2021’den bu yana evlat edinen aileler içindir.',
    'لا تنطبق هنا أي من الحالات التي بُني لها البرنامج. إنه لأسرة لديها طفل دون سنة أو تبنّت طفلًا منذ سبتمبر 2021.',
    'אף אחד מהמצבים שהתוכנית נועדה להם לא חל כאן. היא מיועדת למשפחה עם ילד מתחת לגיל שנה, או כזו שאימצה ילד מספטמבר 2021.',
  ],
  mortgage_subsidy_reason_unanswered: [
    '{{n}} of the questions above have not been answered yet.',
    'ზემოთ {{n}} კითხვაზე პასუხი ჯერ არ არის.',
    'На {{n}} вопросов выше ещё нет ответа.',
    'Yukarıdaki sorulardan {{n}} tanesi hâlâ yanıtsız.',
    '{{n}} من الأسئلة أعلاه لم يُجب عنها بعد.',
    'על {{n}} מהשאלות למעלה עוד לא נענה.',
  ],
  mortgage_subsidy_reason_uncheckable: [
    'One condition is written in a way we cannot check. The programme administrator decides it.',
    'ერთი პირობა ისეა ჩაწერილი, რომ ჩვენ ვერ ვამოწმებთ. მას პროგრამის ადმინისტრატორი წყვეტს.',
    'Одно условие сформулировано так, что мы не можем его проверить. Его решает администратор программы.',
    'Bir koşul, kontrol edemeyeceğimiz biçimde yazılmış. Ona program yöneticisi karar verir.',
    'أحد الشروط مكتوب بطريقة لا نستطيع التحقّق منها. تقرّرها إدارة البرنامج.',
    'תנאי אחד כתוב כך שאיננו יכולים לבדוק אותו. מנהל התוכנית מכריע בו.',
  ],

  /*
   * THE LINE THAT KEEPS THIS HONEST.
   *
   * Everything above says "your details match". This says what that is
   * not. The distance between the two sentences is the difference
   * between a useful tool and a promise nobody here can keep.
   */
  mortgage_subsidy_disclaimer: [
    'This is not approval yet. The final decision is taken by the programme administrator or the bank.',
    'ეს ჯერ საბოლოო დამტკიცება არ არის. საბოლოო გადაწყვეტილებას პროგრამის ადმინისტრატორი ან ბანკი იღებს.',
    'Это ещё не одобрение. Окончательное решение принимает администратор программы или банк.',
    'Bu henüz bir onay değil. Nihai kararı program yöneticisi ya da banka verir.',
    'هذه ليست موافقة بعد. القرار النهائي تتخذه إدارة البرنامج أو البنك.',
    'זה עדיין לא אישור. את ההחלטה הסופית מקבל מנהל התוכנית או הבנק.',
  ],
  mortgage_subsidy_ask: [
    'What do I need to apply for the state subsidy?',
    'რა მჭირდება სახელმწიფო სუბსიდიაზე განაცხადისთვის?',
    'Что нужно, чтобы подать на государственную субсидию?',
    'Devlet sübvansiyonuna başvurmak için neye ihtiyacım var?',
    'ماذا أحتاج للتقدّم بطلب دعم الدولة؟',
    'מה צריך כדי להגיש בקשה לסבסוד הממשלתי?',
  ],
  mortgage_programs_checking: [
    'Checking the current conditions of the programme…',
    'პროგრამის მიმდინარე პირობებს ვამოწმებთ…',
    'Проверяем текущие условия программы…',
    'Programın güncel koşulları kontrol ediliyor…',
    'نتحقّق من شروط البرنامج الحالية…',
    'בודקים את התנאים העדכניים של התוכנית…',
  ],
  /*
   * WHY THIS DOES NOT SAY "THERE IS NO PROGRAMME".
   *
   * The knowledge-base loader fails closed on purpose: a query that
   * errors returns an empty list, so a calculator can never invent a
   * limit it could not read. The cost of that decision is that "nothing
   * is published" and "we could not reach the knowledge base" arrive
   * here as the same empty array. Telling somebody with a one-year-old
   * that no programme exists, because a request timed out, would be the
   * worst thing this page could say. So it says the one thing that is
   * true in both cases.
   */
  mortgage_programs_none: [
    'We could not check the current conditions of the programme just now. Try again shortly.',
    'პროგრამის მიმდინარე პირობები ახლა ვერ გადავამოწმეთ. ცოტა ხანში სცადე.',
    'Сейчас не удалось проверить текущие условия программы. Попробуйте чуть позже.',
    'Programın güncel koşullarını şu an kontrol edemedik. Az sonra tekrar deneyin.',
    'لم نتمكّن من التحقّق من شروط البرنامج الحالية الآن. حاول بعد قليل.',
    'לא הצלחנו לבדוק כרגע את התנאים העדכניים של התוכנית. נסו בעוד רגע.',
  ],
};
