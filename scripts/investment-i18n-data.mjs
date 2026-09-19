// One-shot generator input for the Investment Intelligence translation keys.
//
// Kept as a script rather than typed straight into translations.ts so the six
// bundles are written from ONE table and cannot drift at authoring time — the
// failure mode i18n-check.mjs exists to catch after the fact. Run with
// `node scripts/investment-i18n-apply.mjs`; it is idempotent and refuses to
// overwrite a key that already exists.

/**
 * key: [en, ka, ru, tr, ar, he]
 *
 * Placeholders use the app's own {{name}} convention (see LanguageContext.t).
 */
export const INVESTMENT_STRINGS = {
  /* ── Product and page ─────────────────────────────────────────── */
  inv_page_title: [
    'Investment Intelligence — Homatch',
    'საინვესტიციო ანალიტიკა — Homatch',
    'Инвестиционная аналитика — Homatch',
    'Yatırım Zekâsı — Homatch',
    'ذكاء الاستثمار — Homatch',
    'אינטליגנציית השקעות — Homatch',
  ],
  inv_page_description: [
    'Choose an investment strategy, enter the numbers, and see the return, the break-even and the margin of safety — with current market prices alongside them.',
    'აირჩიეთ საინვესტიციო სტრატეგია, შეიყვანეთ ციფრები და ნახეთ უკუგება, ნულოვანი წერტილი და უსაფრთხოების მარაგი — მიმდინარე საბაზრო ფასებთან ერთად.',
    'Выберите инвестиционную стратегию, введите цифры и увидите доходность, точку безубыточности и запас прочности — рядом с текущими рыночными ценами.',
    'Bir yatırım stratejisi seçin, rakamları girin ve getiriyi, başabaş noktasını ve güvenlik payını güncel piyasa fiyatlarıyla birlikte görün.',
    'اختر استراتيجية استثمار وأدخل الأرقام لترى العائد ونقطة التعادل وهامش الأمان، إلى جانب أسعار السوق الحالية.',
    'בחרו אסטרטגיית השקעה, הזינו את המספרים וראו את התשואה, נקודת האיזון ומרווח הביטחון — לצד מחירי השוק הנוכחיים.',
  ],
  inv_product_eyebrow: [
    'Investment Intelligence',
    'საინვესტიციო ანალიტიკა',
    'Инвестиционная аналитика',
    'Yatırım Zekâsı',
    'ذكاء الاستثمار',
    'אינטליגנציית השקעות',
  ],
  nav_investment: [
    'Investment',
    'ინვესტიცია',
    'Инвестиции',
    'Yatırım',
    'الاستثمار',
    'השקעה',
  ],
  link_investment: [
    'Investment Intelligence',
    'საინვესტიციო ანალიტიკა',
    'Инвестиционная аналитика',
    'Yatırım Zekâsı',
    'ذكاء الاستثمار',
    'אינטליגנציית השקעות',
  ],

  /* ── Entry ────────────────────────────────────────────────────── */

  /* ── Composer and consultant ──────────────────────────────────── */
  inv_group_property: ['Property', 'ქონება', 'Объект', 'Mülk', 'العقار', 'הנכס'],
  inv_f_area: ['Area (m²)', 'ფართი (მ²)', 'Площадь (м²)', 'Alan (m²)', 'المساحة (م²)', 'שטח (מ״ר)'],
  inv_f_other_income: ['Other annual income', 'სხვა წლიური შემოსავალი', 'Прочий годовой доход', 'Diğer yıllık gelir', 'دخل سنوي آخر', 'הכנסה שנתית אחרת'],
  inv_f_management_pct: ['Management (% of rent collected)', 'მართვა (აკრეფილი ქირის %)', 'Управление (% собранной аренды)', 'Yönetim (tahsil edilen kiranın %)', 'الإدارة (% من الإيجار المحصّل)', 'ניהול (% מהשכירות שנגבתה)'],
  inv_f_management_pct_hint: [
    'Charged on rent actually collected, not on rent an empty flat does not produce.',
    'ერიცხება ფაქტობრივად აკრეფილ ქირას და არა იმ ქირას, რომელსაც ცარიელი ბინა არ გამოიმუშავებს.',
    'Начисляется на фактически полученную аренду, а не на ту, которую пустая квартира не приносит.',
    'Fiilen tahsil edilen kira üzerinden alınır; boş dairenin üretmediği kira üzerinden değil.',
    'تُحتسب على الإيجار المحصّل فعليًا، لا على إيجار لا تنتجه شقة شاغرة.',
    'נגבה על שכירות שנגבתה בפועל, לא על שכירות שדירה ריקה אינה מייצרת.',
  ],
  inv_f_selling_cost_pct: ['Selling costs (% of sale)', 'გაყიდვის ხარჯები (გაყიდვის %)', 'Расходы на продажу (% от суммы)', 'Satış maliyetleri (satışın %)', 'تكاليف البيع (% من البيع)', 'עלויות מכירה (% מהמכירה)'],

  /* ── Units and gaps ───────────────────────────────────────────── */
  inv_unit_years: ['{{n}} years', '{{n}} წელი', '{{n}} лет', '{{n}} yıl', '{{n}} سنة', '{{n}} שנים'],
  inv_unit_months: ['{{n}} months', '{{n}} თვე', '{{n}} мес.', '{{n}} ay', '{{n}} شهرًا', '{{n}} חודשים'],
  inv_unit_months_short: ['mo', 'თვე', 'мес.', 'ay', 'شهر', 'ח׳'],
  inv_gap_missing_input: ['Not established yet', 'ჯერ არ არის დადგენილი', 'Пока не установлено', 'Henüz belirlenmedi', 'لم يُحدَّد بعد', 'טרם נקבע'],
  inv_gap_not_meaningful: ['No meaningful answer here', 'აქ აზრიანი პასუხი არ არსებობს', 'Здесь нет осмысленного ответа', 'Burada anlamlı bir yanıt yok', 'لا إجابة ذات معنى هنا', 'אין כאן תשובה בעלת משמעות'],
  inv_gap_no_positive_income: ['No positive income to recover from', 'დადებითი შემოსავალი არ არის', 'Нет положительного дохода', 'Geri kazanılacak pozitif gelir yok', 'لا يوجد دخل موجب للاسترداد منه', 'אין הכנסה חיובית להחזר'],
  inv_gap_never_recovers: ['Never recovers at these assumptions', 'ამ დაშვებებით არასდროს ანაზღაურდება', 'При этих допущениях не окупается', 'Bu varsayımlarla hiç geri dönmez', 'لا يسترد أبدًا بهذه الافتراضات', 'לא מוחזר בהנחות אלו'],
  inv_gap_not_financed: ['No loan in this scenario', 'ამ სცენარში სესხი არ არის', 'В этом сценарии кредита нет', 'Bu senaryoda kredi yok', 'لا يوجد قرض في هذا السيناريو', 'אין הלוואה בתרחיש הזה'],
  inv_needs_input_prefix: ['To answer this I need:', 'ამაზე პასუხისთვის მჭირდება:', 'Чтобы ответить, нужно:', 'Bunu yanıtlamak için gerekli:', 'للإجابة أحتاج إلى:', 'כדי לענות אני צריך:'],

  /* ── Provenance ───────────────────────────────────────────────── */
  inv_origin_user: ['You', 'თქვენ', 'Вы', 'Siz', 'أنت', 'אתם'],
  inv_origin_property: ['Listing', 'განცხადება', 'Объявление', 'İlan', 'الإعلان', 'מודעה'],
  inv_origin_research: ['Researched', 'მოკვლეული', 'Исследовано', 'Araştırıldı', 'مبحوث', 'נחקר'],
  inv_origin_derived: ['Calculated', 'გამოთვლილი', 'Рассчитано', 'Hesaplandı', 'محسوب', 'מחושב'],
};
