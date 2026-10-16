/*
 * Copy for the premium Verify report restoration (owner, 2026-10-11):
 * the people behind the project grouped by discipline with their evidence,
 * the official gallery's scope labels, counts and case links, and register
 * representation codes that must never print as English.
 *
 * Order is en, ka, ru, tr, ar, he — LANGS in lib/i18nSplice.mjs.
 * Placeholders ({{count}}, {{cases}}, {{roles}}, {{case}}) survive in every
 * locale. Terminology: match = დამთხვევა, tenant = მოიჯარე, თბილისი.
 */
export const VERIFY_P0_UI_STRINGS = {
  /* ── team groups ── */
  verify_p0_team_group_engineering: ['Engineering systems', 'საინჟინრო სისტემები', 'Инженерные системы', 'Mühendislik sistemleri', 'الأنظمة الهندسية', 'מערכות הנדסיות'],
  verify_p0_team_group_design: ['Design', 'დიზაინი', 'Дизайн', 'Tasarım', 'التصميم', 'עיצוב'],
  verify_p0_team_group_applicants: ['Clients & permit applicants', 'დამკვეთები და განმცხადებლები', 'Заказчики и заявители', 'İşverenler ve izin başvuru sahipleri', 'العملاء ومقدّمو طلبات التصاريح', 'מזמינים ומגישי בקשות להיתר'],

  /* ── what each group is responsible for ── */
  verify_p0_team_duty_architecture: [
    'Designed the building and signed the architectural project submitted to the city.',
    'შენობის დაპროექტება და ქალაქში წარდგენილი არქიტექტურული პროექტის ხელმოწერა.',
    'Спроектировали здание и подписали архитектурный проект, поданный в город.',
    'Binayı tasarladı ve belediyeye sunulan mimari projeyi imzaladı.',
    'صمّموا المبنى ووقّعوا المشروع المعماري المقدَّم إلى البلدية.',
    'תכננו את הבניין וחתמו על התוכנית האדריכלית שהוגשה לעירייה.',
  ],
  verify_p0_team_duty_structural: [
    'Responsible for the load-bearing structure — frame, slabs and foundations — and its expert review.',
    'პასუხისმგებელია მზიდ კონსტრუქციაზე — კარკასზე, გადახურვებსა და საძირკველზე — და მის საექსპერტო შეფასებაზე.',
    'Отвечают за несущие конструкции — каркас, перекрытия и фундамент — и их экспертизу.',
    'Taşıyıcı sistemden — karkas, döşemeler ve temel — ve bunun uzman incelemesinden sorumludur.',
    'مسؤولون عن الهيكل الحامل — الإطار والبلاطات والأساسات — ومراجعته الفنية.',
    'אחראים לשלד הנושא — מסגרת, תקרות ויסודות — ולבדיקתו המקצועית.',
  ],
  verify_p0_team_duty_geotechnical: [
    'Studied the ground the building stands on and how deep and how strong its foundations must be.',
    'შეისწავლეს გრუნტი, რომელზეც შენობა დგას, და რამდენად ღრმა და მტკიცე უნდა იყოს საძირკველი.',
    'Изучили грунт под зданием и определили, насколько глубоким и прочным должен быть фундамент.',
    'Binanın üzerinde durduğu zemini ve temelin ne kadar derin ve sağlam olması gerektiğini inceledi.',
    'درسوا التربة التي يقوم عليها المبنى ومدى العمق والمتانة المطلوبين للأساسات.',
    'בחנו את הקרקע שעליה עומד הבניין וכמה עמוקים וחזקים צריכים להיות היסודות.',
  ],
  verify_p0_team_duty_engineering: [
    'Power, water, sewage, ventilation and lifts — the systems you live with every day.',
    'ელექტროობა, წყალი, კანალიზაცია, ვენტილაცია და ლიფტები — სისტემები, რომლებითაც ყოველდღე ცხოვრობთ.',
    'Электричество, вода, канализация, вентиляция и лифты — системы, с которыми вы живёте каждый день.',
    'Elektrik, su, kanalizasyon, havalandırma ve asansörler — her gün birlikte yaşadığınız sistemler.',
    'الكهرباء والمياه والصرف والتهوية والمصاعد — الأنظمة التي تعيش معها يوميًا.',
    'חשמל, מים, ביוב, אוורור ומעליות — המערכות שאיתן חיים בכל יום.',
  ],
  verify_p0_team_duty_design: [
    'Interiors, façades and common areas as they were designed.',
    'ინტერიერი, ფასადები და საერთო სივრცეები ისე, როგორც დაპროექტდა.',
    'Интерьеры, фасады и общие зоны в том виде, в каком они спроектированы.',
    'Tasarlandığı haliyle iç mekânlar, cepheler ve ortak alanlar.',
    'التصميمات الداخلية والواجهات والمناطق المشتركة كما صُمّمت.',
    'פנים, חזיתות ושטחים משותפים כפי שתוכננו.',
  ],
  verify_p0_team_duty_developer: [
    'The company that builds and sells the project.',
    'კომპანია, რომელიც პროექტს აშენებს და ყიდის.',
    'Компания, которая строит и продаёт проект.',
    'Projeyi inşa eden ve satan şirket.',
    'الشركة التي تبني المشروع وتبيعه.',
    'החברה שבונה ומוכרת את הפרויקט.',
  ],
  verify_p0_team_duty_applicants: [
    'Named in the city records as the client who commissioned the project or as the person who filed an application. This is an administrative role — not a design role, and not ownership of your apartment.',
    'ქალაქის ჩანაწერებში დასახელებულია, როგორც პროექტის დამკვეთი ან განაცხადის შემტანი. ეს ადმინისტრაციული როლია — არა დამპროექტებლის და არა თქვენი ბინის მესაკუთრის.',
    'Указаны в городских записях как заказчик проекта или лицо, подавшее заявление. Это административная роль — не проектировщик и не владелец вашей квартиры.',
    'Belediye kayıtlarında projeyi sipariş eden işveren veya başvuruyu yapan kişi olarak geçer. Bu idari bir roldür — tasarımcı değildir ve dairenizin sahibi anlamına gelmez.',
    'مذكورون في سجلات البلدية بصفتهم العميل الذي طلب المشروع أو مقدّم الطلب. هذا دور إداري — ليس دور تصميم ولا ملكية لشقتك.',
    'מופיעים ברשומות העירייה כמזמין הפרויקט או כמגיש הבקשה. זהו תפקיד מנהלי — לא תפקיד תכנון ולא בעלות על הדירה שלכם.',
  ],

  /* ── roles by code (used when the record held only a form label) ── */
  verify_p0_role_chief_architect: ['Chief architect / lead specialist', 'მთავარი არქიტექტორი / სპეციალისტი', 'Главный архитектор / ведущий специалист', 'Baş mimar / sorumlu uzman', 'المعماري الرئيسي / الأخصائي المسؤول', 'אדריכל ראשי / מומחה אחראי'],
  verify_p0_role_engineer: ['Engineer', 'ინჟინერი', 'Инженер', 'Mühendis', 'مهندس', 'מהנדס'],
  verify_p0_role_designer: ['Designer', 'დიზაინერი', 'Дизайнер', 'Tasarımcı', 'مصمم', 'מעצב'],

  /* ── team card ── */
  verify_p0_team_also: ['Also: {{roles}}', 'ასევე: {{roles}}', 'Также: {{roles}}', 'Ayrıca: {{roles}}', 'أيضًا: {{roles}}', 'גם: {{roles}}'],
  verify_p0_team_cases: ['{{count}} official cases', '{{count}} ოფიციალური საქმე', 'Официальных дел: {{count}}', '{{count}} resmi dosya', 'ملفات رسمية: {{count}}', 'תיקים רשמיים: {{count}}'],
  verify_p0_team_director_note: [
    'Also a registered director of the developer company.',
    'ასევე დეველოპერი კომპანიის რეგისტრირებული დირექტორია.',
    'Также зарегистрированный директор компании-девелопера.',
    'Aynı zamanda geliştirici şirketin kayıtlı müdürüdür.',
    'وهو أيضًا مدير مسجّل في شركة التطوير.',
    'גם דירקטור רשום בחברה היזמית.',
  ],
  verify_p0_team_public_source: [
    'From a public source — not an official record',
    'საჯარო წყაროდან — არა ოფიციალური ჩანაწერიდან',
    'Из открытого источника — не из официальной записи',
    'Kamuya açık kaynaktan — resmi kayıt değil',
    'من مصدر عام — ليس سجلًا رسميًا',
    'ממקור פומבי — לא מרשומה רשמית',
  ],
  verify_p0_team_evidence_show: ['Evidence — {{count}} documented roles', 'მტკიცებულება — {{count}} დოკუმენტირებული როლი', 'Подтверждения — ролей по документам: {{count}}', 'Kanıt — {{count}} belgelenmiş rol', 'الأدلة — {{count}} أدوار موثّقة', 'ראיות — {{count}} תפקידים מתועדים'],

  /* ── register representation codes ── */
  verify_p0_rep_joint: ['jointly', 'ერთობლივი', 'совместно', 'birlikte', 'بالاشتراك', 'במשותף'],
  verify_p0_rep_sole: ['alone', 'დამოუკიდებლად', 'единолично', 'tek başına', 'منفردًا', 'לבד'],
  verify_p0_rep_separate: ['separately', 'ცალ-ცალკე', 'раздельно', 'ayrı ayrı', 'بشكل منفصل', 'בנפרד'],

  /* ── gallery ── */
  verify_p0_scope_exact_unit: ['This apartment', 'ზუსტად ეს ბინა', 'Именно эта квартира', 'Tam bu daire', 'هذه الشقة تحديدًا', 'הדירה הזו בדיוק'],
  verify_p0_scope_typical_floor: ['Typical floor of this building', 'ამ შენობის ტიპური სართული', 'Типовой этаж этого здания', 'Bu binanın tipik katı', 'الطابق النموذجي لهذا المبنى', 'קומה טיפוסית בבניין זה'],
  verify_p0_scope_building: ['This building', 'ეს შენობა', 'Это здание', 'Bu bina', 'هذا المبنى', 'הבניין הזה'],
  verify_p0_scope_project: ['Whole project — not this apartment specifically', 'მთელი პროექტი — არა კონკრეტულად ეს ბინა', 'Весь проект — не именно эта квартира', 'Projenin tamamı — özellikle bu daire değil', 'المشروع بأكمله — ليس هذه الشقة تحديدًا', 'כל הפרויקט — לא הדירה הזו דווקא'],
  verify_p0_visual_filed_with: ['Filed with {{case}}', 'წარდგენილია: {{case}}', 'Подано в: {{case}}', 'Sunulduğu dosya: {{case}}', 'مقدَّم ضمن: {{case}}', 'הוגש במסגרת: {{case}}'],
  verify_p0_gallery_count: ['{{count}} official images', '{{count}} ოფიციალური გამოსახულება', 'Официальных изображений: {{count}}', '{{count}} resmi görsel', 'صور رسمية: {{count}}', 'תמונות רשמיות: {{count}}'],
  verify_p0_gallery_count_cases: [
    '{{count}} official images from {{cases}} city cases',
    '{{count}} ოფიციალური გამოსახულება {{cases}} საქმიდან',
    'Официальных изображений: {{count}}, из дел мэрии: {{cases}}',
    '{{cases}} belediye dosyasından {{count}} resmi görsel',
    'صور رسمية: {{count}} من ملفات البلدية: {{cases}}',
    'תמונות רשמיות: {{count}}, מתוך תיקי עירייה: {{cases}}',
  ],
  /* ── report contents (under the summary) ── */
  verify_p0_jump_label: ['In this report', 'ამ ანგარიშში', 'В этом отчёте', 'Bu raporda', 'في هذا التقرير', 'בדוח זה'],
  verify_p0_jump_visuals: ['official images', 'ოფიციალური გამოსახულება', 'официальных изображений', 'resmi görsel', 'صورة رسمية', 'תמונות רשמיות'],
  verify_p0_jump_people: ['people and companies behind the project', 'ადამიანი და კომპანია პროექტის უკან', 'людей и компаний за проектом', 'projenin arkasındaki kişi ve şirket', 'أشخاص وشركات وراء المشروع', 'אנשים וחברות מאחורי הפרויקט'],
  verify_p0_jump_cases: ['official city cases', 'ოფიციალური საქმე მერიაში', 'официальных дел в мэрии', 'resmi belediye dosyası', 'ملفات رسمية لدى البلدية', 'תיקים רשמיים בעירייה'],
  verify_p0_jump_specs: ['documented specifications', 'დოკუმენტირებული მახასიათებელი', 'задокументированных характеристик', 'belgelenmiş özellik', 'مواصفات موثّقة', 'מפרטים מתועדים'],
};
