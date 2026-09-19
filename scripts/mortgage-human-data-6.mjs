/*
 * PART 6 — the advanced-input labels, and who runs the programme.
 *
 * Found by the browser gate rather than by reading, which is the point
 * of having one: both of these are strings that look harmless in a
 * translation file and read badly on a screen.
 *
 *   EVERY OPTIONAL FIELD CARRIED A PARENTHESIS. "საშეღავათო პერიოდი
 *   (თვეები, მხოლოდ პროცენტი)" puts the explanation inside the label,
 *   where it competes with the label for the same glance. Each of
 *   these already has a hint line underneath it, which is where an
 *   explanation belongs. The unit moves into the label proper and the
 *   bracket goes.
 *
 *   THE PROGRAMME NAMED ITS ADMINISTRATOR IN ENGLISH, WITH A SEMICOLON
 *   AND TWO DECREE NUMBERS: "Government of Georgia (Decree No. 388,
 *   2 August 2021; last amended by Decree No. 218, 21 May 2026)". That
 *   is the row's `administrator` field, written for the people who
 *   maintain the knowledge base, and it was printed verbatim under a
 *   Georgian eligibility result. The customer line now names the
 *   administrator in their language; the decree citation is one line
 *   away behind the official-source link, which is where somebody who
 *   wants it will look.
 *
 * key -> [en, ka, ru, tr, ar, he].
 */

export const PART_6 = {
  mortgage_label_effective_rate_bank: [
    'The real yearly cost, as the bank states it',
    'რეალური წლიური ხარჯი, როგორც ბანკმა დაასახელა',
    'Реальная годовая стоимость, как её назвал банк',
    'Bankanın söylediği gerçek yıllık maliyet',
    'التكلفة السنوية الحقيقية كما ذكرها البنك',
    'העלות השנתית האמיתית, כפי שהבנק מציג אותה',
  ],
  mortgage_label_origination_fee_percent: [
    'One-off fee, as a share of the loan',
    'ერთჯერადი საკომისიო, სესხის პროცენტად',
    'Разовая комиссия, в процентах от кредита',
    'Tek seferlik ücret, kredinin yüzdesi olarak',
    'رسم لمرة واحدة، كنسبة من القرض',
    'עמלה חד-פעמית, כאחוז מההלוואה',
  ],
  mortgage_label_insurance_annual: [
    'Compulsory insurance a year',
    'სავალდებულო დაზღვევა წელიწადში',
    'Обязательная страховка в год',
    'Yıllık zorunlu sigorta',
    'التأمين الإلزامي سنويًا',
    'ביטוח חובה לשנה',
  ],
  mortgage_label_valuation_fee: [
    'One-off valuation fee',
    'ერთჯერადი შეფასების საკომისიო',
    'Разовая плата за оценку',
    'Tek seferlik ekspertiz ücreti',
    'رسم التقييم لمرة واحدة',
    'עמלת שמאות חד-פעמית',
  ],
  mortgage_label_grace_period: [
    'Months of interest only at the start',
    'დასაწყისში რამდენ თვეს იხდი მხოლოდ პროცენტს',
    'Сколько месяцев в начале платите только проценты',
    'Başta kaç ay sadece faiz ödenecek',
    'كم شهرًا تدفع الفائدة فقط في البداية',
    'כמה חודשים בהתחלה משלמים רק ריבית',
  ],
  mortgage_label_monthly_income: [
    'Your monthly income after tax',
    'შენი თვიური შემოსავალი გადასახადის შემდეგ',
    'Ваш месячный доход после налогов',
    'Vergi sonrası aylık geliriniz',
    'دخلك الشهري بعد الضريبة',
    'ההכנסה החודשית שלכם אחרי מס',
  ],
  mortgage_label_existing_debt: [
    'Other loan payments you make each month',
    'სხვა სესხების თვიური გადასახადები',
    'Другие ежемесячные платежи по кредитам',
    'Her ay ödediğiniz diğer kredi taksitleri',
    'أقساط القروض الأخرى التي تدفعها شهريًا',
    'החזרי הלוואות אחרות שאתם משלמים כל חודש',
  ],

  /* The administrator, in the reader's language. The decree citation is
     the official-source link beside it. */
  mortgage_kb_subsidy_administrator: [
    'Government of Georgia',
    'საქართველოს მთავრობა',
    'Правительство Грузии',
    'Gürcistan Hükûmeti',
    'حكومة جورجيا',
    'ממשלת גאורגיה',
  ],
};
