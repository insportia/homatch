/*
 * Copy for the Verify v3 customer report refinement (2026-10): the
 * discipline-grouped project team, the official document explorer, today's
 * legal position with pending applications, the documented specifications,
 * the register's ownership & security card, and the viewer's thumbnails.
 *
 * Order is en, ka, ru, tr, ar, he — LANGS in lib/i18nSplice.mjs.
 *
 * Accuracy rules held in the wording, every locale:
 *   - a pending application is "under review — not yet decided", never an
 *     approval, and the approved project stays the one in force;
 *   - "Proposed" is a value in an application still under review;
 *   - a reused registry extract says when it was retrieved.
 */
export const VERIFY_REPORT_V3_STRINGS = {
  // ── Chapter: official documents ──
  verify_v3_nav_documents: ['Documents', 'დოკუმენტები', 'Документы', 'Belgeler', 'الوثائق', 'מסמכים'],
  verify_v3_docs_kicker: ['From the municipal records', 'მერიის ოფიციალური ჩანაწერებიდან', 'Из муниципальных записей', 'Belediye kayıtlarından', 'من سجلات البلدية', 'מרשומות העירייה'],
  verify_v3_docs_title: ['Official documents', 'ოფიციალური დოკუმენტები', 'Официальные документы', 'Resmî belgeler', 'الوثائق الرسمية', 'מסמכים רשמיים'],
  verify_v3_docs_lede: [
    'The applications filed for this project, newest first, with every file HOMATCH found and what it could read in each. Originals open at the official source.',
    'ამ პროექტზე შეტანილი განაცხადები, უახლესიდან დაწყებული — ყველა ფაილით, რაც HOMATCH-მა იპოვა, და რისი წაკითხვაც შეძლო თითოეულში. ორიგინალი ოფიციალურ წყაროში იხსნება.',
    'Заявления по этому проекту, начиная с последних, — со всеми файлами, которые нашёл HOMATCH, и с тем, что удалось прочитать в каждом. Оригиналы открываются в официальном источнике.',
    'Bu proje için yapılan başvurular, en yeniden başlayarak; HOMATCH’in bulduğu her dosya ve her birinde neyi okuyabildiği ile. Asılları resmî kaynakta açılır.',
    'الطلبات المقدّمة لهذا المشروع، بدءًا بالأحدث، مع كل ملف وجده HOMATCH وما استطاع قراءته في كل منها. تُفتح النسخ الأصلية في المصدر الرسمي.',
    'הבקשות שהוגשו לפרויקט, מהחדשה ביותר, עם כל קובץ ש-HOMATCH מצא ומה שהצליח לקרוא בכל אחד. המקור נפתח באתר הרשמי.',
  ],
  verify_v3_docs_recent_two: ['The two latest applications', 'ბოლო ორი განაცხადი', 'Два последних заявления', 'Son iki başvuru', 'آخر طلبين', 'שתי הבקשות האחרונות'],
  verify_v3_docs_recent_one: ['The latest application', 'ბოლო განაცხადი', 'Последнее заявление', 'Son başvuru', 'آخر طلب', 'הבקשה האחרונה'],
  verify_v3_docs_earlier: ['Earlier applications ({{count}})', 'ადრინდელი განაცხადები ({{count}})', 'Более ранние заявления ({{count}})', 'Önceki başvurular ({{count}})', 'طلبات سابقة ({{count}})', 'בקשות קודמות ({{count}})'],
  verify_v3_docs_untitled: ['Official application', 'ოფიციალური განაცხადი', 'Официальное заявление', 'Resmî başvuru', 'طلب رسمي', 'בקשה רשמית'],
  verify_v3_docs_files: ['Files in this application', 'განაცხადის ფაილები', 'Файлы заявления', 'Başvurudaki dosyalar', 'ملفات هذا الطلب', 'קבצי הבקשה'],
  verify_v3_docs_file: ['Attached file', 'თანდართული ფაილი', 'Приложенный файл', 'Ekli dosya', 'ملف مرفق', 'קובץ מצורף'],
  verify_v3_docs_pages: ['{{count}} pp.', '{{count}} გვ.', '{{count}} стр.', '{{count}} sayfa', '{{count}} صفحة', '{{count}} עמ׳'],
  verify_v3_docs_open_original: ['Open original', 'ორიგინალის გახსნა', 'Открыть оригинал', 'Aslını aç', 'فتح الأصل', 'פתיחת המקור'],
  verify_v3_docs_open_case: ['Open the official case', 'ოფიციალური საქმის გახსნა', 'Открыть официальное дело', 'Resmî dosyayı aç', 'فتح الملف الرسمي', 'פתיחת התיק הרשמי'],
  verify_v3_docs_view_images: ['View images ({{count}})', 'გამოსახულებები ({{count}})', 'Изображения ({{count}})', 'Görseller ({{count}})', 'عرض الصور ({{count}})', 'הצגת תמונות ({{count}})'],
  verify_v3_docs_note: [
    'HOMATCH links to the official public record and does not keep its own copies of these files. Images it extracted open in the viewer above.',
    'HOMATCH მიგითითებთ ოფიციალურ საჯარო ჩანაწერზე და ამ ფაილების საკუთარ ასლებს არ ინახავს. ამოღებული გამოსახულებები ზემოთ, დათვალიერების ფანჯარაში იხსნება.',
    'HOMATCH ссылается на официальную публичную запись и не хранит собственных копий этих файлов. Извлечённые изображения открываются в просмотрщике.',
    'HOMATCH resmî kamu kaydına bağlantı verir, bu dosyaların kendi kopyalarını tutmaz. Çıkarılan görseller görüntüleyicide açılır.',
    'يربطك HOMATCH بالسجل العام الرسمي ولا يحتفظ بنسخ خاصة من هذه الملفات. تُفتح الصور المستخرجة في العارض.',
    'HOMATCH מפנה לרשומה הציבורית הרשמית ואינו שומר עותקים משלו של הקבצים. תמונות שחולצו נפתחות במציג.',
  ],
  verify_v3_doc_status_under_review: ['Under review', 'განხილვაშია', 'На рассмотрении', 'İncelemede', 'قيد المراجعة', 'בבדיקה'],
  verify_v3_doc_status_approved: ['Approved', 'დამტკიცებული', 'Утверждено', 'Onaylandı', 'مُعتمد', 'אושר'],
  verify_v3_doc_status_refused: ['Refused', 'უარყოფილი', 'Отказано', 'Reddedildi', 'مرفوض', 'נדחה'],
  verify_v3_doc_status_historical: ['Earlier record', 'ადრინდელი ჩანაწერი', 'Ранняя запись', 'Önceki kayıt', 'سجل سابق', 'רשומה קודמת'],
  verify_v3_doc_read_full: ['Read in full', 'სრულად წაკითხული', 'Прочитан полностью', 'Tamamen okundu', 'قُرئ بالكامل', 'נקרא במלואו'],
  verify_v3_doc_read_visual: ['Images extracted', 'გამოსახულებები ამოღებულია', 'Изображения извлечены', 'Görseller çıkarıldı', 'استُخرجت الصور', 'התמונות חולצו'],
  verify_v3_doc_read_unsupported: ['Format not readable — open the original', 'ფორმატი ვერ წაიკითხება — გახსენით ორიგინალი', 'Формат не читается — откройте оригинал', 'Biçim okunamıyor — aslını açın', 'تعذّرت قراءة الصيغة — افتح الأصل', 'לא ניתן לקרוא את הפורמט — פתחו את המקור'],
  verify_v3_doc_read_deferred: ['Queued for follow-up', 'დამატებით წასაკითხად რიგშია', 'В очереди на дочитывание', 'Takip için sırada', 'في قائمة المتابعة', 'בתור להמשך קריאה'],
  verify_v3_doc_read_not_read: ['Not read by HOMATCH — open the original', 'HOMATCH-ს არ წაუკითხავს — გახსენით ორიგინალი', 'HOMATCH не читал — откройте оригинал', 'HOMATCH okumadı — aslını açın', 'لم يقرأه HOMATCH — افتح الأصل', 'HOMATCH לא קרא — פתחו את המקור'],
  verify_v3_case_ref: ['Case № {{ref}}', 'საქმე № {{ref}}', 'Дело № {{ref}}', 'Dosya no. {{ref}}', 'الملف رقم {{ref}}', 'תיק מס׳ {{ref}}'],
  verify_v3_official_source: ['Official source', 'ოფიციალური წყარო', 'Официальный источник', 'Resmî kaynak', 'المصدر الرسمي', 'המקור הרשמי'],
  verify_v3_opens_new_tab: ['(opens in a new tab)', '(იხსნება ახალ ჩანართში)', '(откроется в новой вкладке)', '(yeni sekmede açılır)', '(يُفتح في علامة تبويب جديدة)', '(נפתח בכרטיסייה חדשה)'],

  // ── Project team & responsibility ──
  verify_v3_team_group_developer: ['Developer & project organization', 'დეველოპერი და პროექტის ორგანიზაცია', 'Девелопер и организация проекта', 'Geliştirici ve proje organizasyonu', 'المطوّر وتنظيم المشروع', 'היזם וארגון הפרויקט'],
  verify_v3_team_group_architecture: ['Architecture & co-authors', 'არქიტექტურა და თანაავტორები', 'Архитектура и соавторы', 'Mimari ve ortak yazarlar', 'العمارة والمؤلفون المشاركون', 'אדריכלות ושותפים לתכנון'],
  verify_v3_team_group_structural: ['Structural engineering & expert assessments', 'კონსტრუქციები და საექსპერტო შეფასებები', 'Конструкции и экспертные оценки', 'Taşıyıcı sistem ve uzman değerlendirmeleri', 'الهندسة الإنشائية وتقييمات الخبراء', 'הנדסת מבנים וחוות דעת מומחים'],
  verify_v3_team_group_geotechnical: ['Geotechnical', 'საინჟინრო-გეოლოგია', 'Инженерная геология', 'Jeoteknik', 'الجيوتقنية', 'גאוטכניקה'],
  verify_v3_team_group_landscape: ['Landscape', 'ლანდშაფტი', 'Ландшафт', 'Peyzaj', 'تنسيق المواقع', 'אדריכלות נוף'],
  verify_v3_team_group_construction_org: ['Construction organization', 'მშენებლობის ორგანიზაცია', 'Организация строительства', 'İnşaat organizasyonu', 'تنظيم البناء', 'ארגון הבנייה'],
  verify_v3_team_group_safety: ['Safety', 'უსაფრთხოება', 'Безопасность', 'Güvenlik', 'السلامة', 'בטיחות'],
  verify_v3_team_group_other: ['Other documented participants', 'სხვა დოკუმენტირებული მონაწილეები', 'Другие участники по документам', 'Belgelenen diğer katılımcılar', 'مشاركون موثّقون آخرون', 'משתתפים מתועדים נוספים'],
  verify_v3_team_roles_show: ['All documented roles ({{count}})', 'ყველა დოკუმენტირებული როლი ({{count}})', 'Все роли по документам ({{count}})', 'Belgelenen tüm roller ({{count}})', 'كل الأدوار الموثّقة ({{count}})', 'כל התפקידים המתועדים ({{count}})'],
  verify_v3_team_roles_hide: ['Hide roles ({{count}})', 'როლების დამალვა ({{count}})', 'Скрыть роли ({{count}})', 'Rolleri gizle ({{count}})', 'إخفاء الأدوار ({{count}})', 'הסתרת התפקידים ({{count}})'],

  // ── Legal position ──
  verify_v3_position_effective: ['In force today', 'დღეს მოქმედი', 'Действует сегодня', 'Bugün yürürlükte', 'ساري المفعول اليوم', 'בתוקף היום'],
  verify_v3_position_since: ['since {{date}}', '{{date}}-დან', 'с {{date}}', '{{date}} tarihinden beri', 'منذ {{date}}', 'מאז {{date}}'],
  verify_v3_position_decision: ['decision № {{number}}', 'გადაწყვეტილება № {{number}}', 'решение № {{number}}', 'karar no. {{number}}', 'القرار رقم {{number}}', 'החלטה מס׳ {{number}}'],
  verify_v3_position_conflicts: [
    'The records disagree on {{count}} point(s); the timeline shows each record as filed.',
    'ჩანაწერები {{count}} საკითხში ერთმანეთს არ ემთხვევა; ქრონოლოგიაში თითოეული ჩანაწერი ისეა ნაჩვენები, როგორც შეტანილია.',
    'Записи расходятся в {{count}} пункте(ах); в хронологии каждая запись показана так, как подана.',
    'Kayıtlar {{count}} noktada birbirini tutmuyor; zaman çizelgesi her kaydı sunulduğu hâliyle gösterir.',
    'تتعارض السجلات في {{count}} نقطة؛ ويعرض الخط الزمني كل سجل كما قُدّم.',
    'הרשומות אינן מתיישבות ב-{{count}} נקודות; ציר הזמן מציג כל רשומה כפי שהוגשה.',
  ],
  verify_v3_pending_title: ['Applications under review ({{count}})', 'განხილვაში მყოფი განაცხადები ({{count}})', 'Заявления на рассмотрении ({{count}})', 'İncelemedeki başvurular ({{count}})', 'طلبات قيد المراجعة ({{count}})', 'בקשות בבדיקה ({{count}})'],
  verify_v3_pending_chip: ['Under review — not yet decided', 'განხილვაშია — გადაწყვეტილება ჯერ არ არის', 'На рассмотрении — решения ещё нет', 'İncelemede — henüz karar yok', 'قيد المراجعة — لم يُبتّ فيه بعد', 'בבדיקה — טרם הוחלט'],
  verify_v3_pending_filed: ['filed {{date}}', 'შეტანილია {{date}}', 'подано {{date}}', 'başvuru {{date}}', 'قُدّم في {{date}}', 'הוגשה {{date}}'],
  verify_v3_pending_deadline: ['decision due by {{date}}', 'გადაწყვეტილების ვადა: {{date}}', 'срок решения: {{date}}', 'karar için son tarih: {{date}}', 'موعد القرار: {{date}}', 'מועד ההחלטה: {{date}}'],
  verify_v3_pending_note: [
    'A pending application is not an approval. Until it is decided, the decision in force above is what applies.',
    'განხილვაში მყოფი განაცხადი დამტკიცებას არ ნიშნავს. გადაწყვეტილების მიღებამდე მოქმედებს ზემოთ მითითებული გადაწყვეტილება.',
    'Заявление на рассмотрении — не утверждение. Пока по нему не принято решение, действует решение, указанное выше.',
    'İncelemedeki bir başvuru onay değildir. Karar verilene kadar yukarıdaki yürürlükteki karar geçerlidir.',
    'الطلب قيد المراجعة ليس موافقة. وإلى أن يُبتّ فيه، يبقى القرار الساري أعلاه هو المعمول به.',
    'בקשה בבדיקה אינה אישור. עד שתתקבל החלטה, חלה ההחלטה שבתוקף המופיעה למעלה.',
  ],
  verify_v3_pending_note_plain: [
    'A pending application is not an approval — it says what was requested, not what was decided.',
    'განხილვაში მყოფი განაცხადი დამტკიცებას არ ნიშნავს — ის აჩვენებს, რა მოითხოვეს და არა რა გადაწყდა.',
    'Заявление на рассмотрении — не утверждение: оно показывает, что запрошено, а не что решено.',
    'İncelemedeki bir başvuru onay değildir; neyin istendiğini gösterir, neye karar verildiğini değil.',
    'الطلب قيد المراجعة ليس موافقة؛ إنه يبيّن ما طُلب لا ما تقرّر.',
    'בקשה בבדיקה אינה אישור — היא מראה מה התבקש, לא מה הוחלט.',
  ],

  // ── Building specifications ──
  verify_v3_specs_title: ['Documented specifications', 'დოკუმენტირებული მახასიათებლები', 'Характеристики по документам', 'Belgelenen özellikler', 'المواصفات الموثّقة', 'מפרט מתועד'],
  verify_v3_specs_lede: [
    'Figures stated in the official project documents, each with its status. A proposed value comes from an application still under review.',
    'პროექტის ოფიციალურ დოკუმენტებში მითითებული მონაცემები, თითოეული თავისი სტატუსით. შემოთავაზებული მნიშვნელობა ჯერ განხილვაში მყოფი განაცხადიდანაა.',
    'Показатели из официальных документов проекта, у каждого — свой статус. Предложенное значение взято из заявления, которое ещё на рассмотрении.',
    'Resmî proje belgelerinde belirtilen değerler, her biri kendi durumuyla. Önerilen değer, hâlâ incelemedeki bir başvurudan gelir.',
    'أرقام وردت في وثائق المشروع الرسمية، ولكلٍّ منها حالته. القيمة المقترحة مأخوذة من طلب لا يزال قيد المراجعة.',
    'נתונים שמופיעים במסמכי הפרויקט הרשמיים, כל אחד עם הסטטוס שלו. ערך מוצע מגיע מבקשה שעדיין בבדיקה.',
  ],
  verify_v3_specs_proposed_note: [
    'Proposed values may change or be refused; rely on the approved ones until a decision is issued.',
    'შემოთავაზებული მნიშვნელობები შეიძლება შეიცვალოს ან უარყოფილ იქნეს; გადაწყვეტილების გამოცემამდე დაეყრდენით დამტკიცებულს.',
    'Предложенные значения могут измениться или быть отклонены; до решения ориентируйтесь на утверждённые.',
    'Önerilen değerler değişebilir veya reddedilebilir; karar çıkana kadar onaylı değerleri esas alın.',
    'قد تتغيّر القيم المقترحة أو تُرفض؛ اعتمد على القيم المعتمدة حتى صدور القرار.',
    'ערכים מוצעים עשויים להשתנות או להידחות; עד שתצא החלטה, הסתמכו על הערכים המאושרים.',
  ],
  verify_v3_spec_status_approved: ['Approved', 'დამტკიცებული', 'Утверждено', 'Onaylı', 'مُعتمد', 'מאושר'],
  verify_v3_spec_status_proposed: ['Proposed — under review', 'შემოთავაზებული — განხილვაშია', 'Предложено — на рассмотрении', 'Önerilen — incelemede', 'مقترح — قيد المراجعة', 'מוצע — בבדיקה'],
  verify_v3_spec_status_unknown: ['Status not established', 'სტატუსი დაუდგენელია', 'Статус не установлен', 'Durum belirlenmedi', 'الحالة غير محدّدة', 'הסטטוס לא נקבע'],
  verify_v3_spec_group_site: ['Site & density', 'ნაკვეთი და განაშენიანება', 'Участок и плотность', 'Arsa ve yoğunluk', 'الأرض والكثافة', 'מגרש וצפיפות'],
  verify_v3_spec_group_volume: ['Volume & heights', 'მოცულობა და სიმაღლე', 'Объём и высотность', 'Hacim ve yükseklik', 'الحجم والارتفاعات', 'נפח וגבהים'],
  verify_v3_spec_group_areas: ['Areas by use', 'ფართები დანიშნულების მიხედვით', 'Площади по назначению', 'Kullanıma göre alanlar', 'المساحات حسب الاستخدام', 'שטחים לפי שימוש'],
  verify_v3_spec_group_structure: ['Structure & foundation', 'კონსტრუქცია და საძირკველი', 'Конструкция и фундамент', 'Taşıyıcı sistem ve temel', 'الهيكل والأساسات', 'שלד ויסודות'],
  verify_v3_spec_group_facade: ['Facade & materials', 'ფასადი და მასალები', 'Фасад и материалы', 'Cephe ve malzemeler', 'الواجهة والمواد', 'חזית וחומרים'],
  verify_v3_spec_group_transport: ['Lifts & parking', 'ლიფტები და პარკინგი', 'Лифты и парковка', 'Asansörler ve otopark', 'المصاعد والمواقف', 'מעליות וחניה'],
  verify_v3_spec_group_other: ['Other documented figures', 'სხვა დოკუმენტირებული მონაცემები', 'Другие показатели по документам', 'Belgelenen diğer değerler', 'أرقام موثّقة أخرى', 'נתונים מתועדים נוספים'],
  verify_v3_spec_meaning_site: [
    'How much of the plot is built on and how densely — it shapes light, green space and what can be added later.',
    'რამდენად და რა სიმჭიდროვით არის ნაკვეთი განაშენიანებული — ეს განსაზღვრავს განათებას, მწვანე სივრცეს და შემდგომი დაშენების შესაძლებლობას.',
    'Какая часть участка застроена и насколько плотно — от этого зависят свет, зелень и возможность последующей застройки.',
    'Arsanın ne kadarının ve ne yoğunlukta yapılaştığı; ışığı, yeşil alanı ve sonradan eklenebilecekleri belirler.',
    'كم من الأرض مبني وبأي كثافة — وهذا يحدد الإضاءة والمساحات الخضراء وما يمكن إضافته لاحقًا.',
    'כמה מהמגרש בנוי ובאיזו צפיפות — זה קובע אור, שטחים ירוקים ומה ניתן להוסיף בהמשך.',
  ],
  verify_v3_spec_meaning_volume: [
    'The building’s size and height as documented — compare it with what is being advertised.',
    'შენობის ზომა და სიმაღლე დოკუმენტების მიხედვით — შეადარეთ სარეკლამო ინფორმაციას.',
    'Размер и высота здания по документам — сравните с тем, что рекламируется.',
    'Belgelere göre binanın büyüklüğü ve yüksekliği; reklamı yapılanla karşılaştırın.',
    'حجم المبنى وارتفاعه كما وردا في الوثائق — قارنهما بما يُعلَن عنه.',
    'גודל הבניין וגובהו לפי המסמכים — השוו למה שמפורסם.',
  ],
  verify_v3_spec_meaning_areas: [
    'How the floor area is split between homes and other uses, which affects how residential the building will feel.',
    'როგორ ნაწილდება ფართი საცხოვრებელ და სხვა დანიშნულებას შორის — ეს განსაზღვრავს, რამდენად საცხოვრებელი ხასიათის იქნება შენობა.',
    'Как площадь делится между жильём и другими назначениями — от этого зависит, насколько дом будет жилым по характеру.',
    'Alanın konut ve diğer kullanımlar arasında nasıl bölündüğü; binanın ne kadar konut karakterli olacağını etkiler.',
    'كيف تتوزع المساحة بين السكن والاستخدامات الأخرى، وهذا يؤثر في الطابع السكني للمبنى.',
    'איך השטח מתחלק בין מגורים לשימושים אחרים — זה משפיע על אופי המגורים בבניין.',
  ],
  verify_v3_spec_meaning_structure: [
    'The frame and foundation the documents describe — the part of the building you cannot change later.',
    'დოკუმენტებში აღწერილი კარკასი და საძირკველი — შენობის ის ნაწილი, რომლის შეცვლაც შემდგომ შეუძლებელია.',
    'Каркас и фундамент по документам — та часть здания, которую потом не изменить.',
    'Belgelerde tanımlanan taşıyıcı sistem ve temel; binanın sonradan değiştirilemeyen kısmı.',
    'الهيكل والأساسات كما تصفها الوثائق — الجزء من المبنى الذي لا يمكن تغييره لاحقًا.',
    'השלד והיסודות כפי שהמסמכים מתארים — החלק בבניין שאי אפשר לשנות אחר כך.',
  ],
  verify_v3_spec_meaning_facade: [
    'Materials stated for the exterior — they drive upkeep costs and how the building ages.',
    'გარე მოპირკეთების დოკუმენტირებული მასალები — მათზეა დამოკიდებული მოვლის ხარჯი და შენობის დაძველება.',
    'Заявленные материалы фасада — от них зависят расходы на содержание и то, как здание стареет.',
    'Dış cephe için belirtilen malzemeler; bakım maliyetini ve binanın nasıl yaşlanacağını belirler.',
    'مواد الواجهة المذكورة — وهي تحدد تكاليف الصيانة وكيف يتقادم المبنى.',
    'החומרים שצוינו לחזית — הם קובעים את עלויות התחזוקה ואת הזדקנות הבניין.',
  ],
  verify_v3_spec_meaning_transport: [
    'Lifts and parking as documented — check the numbers against the number of apartments.',
    'ლიფტები და პარკინგი დოკუმენტების მიხედვით — შეადარეთ ბინების რაოდენობას.',
    'Лифты и парковка по документам — сравните с количеством квартир.',
    'Belgelere göre asansörler ve otopark; sayıları daire sayısıyla karşılaştırın.',
    'المصاعد والمواقف كما وردت في الوثائق — قارن الأعداد بعدد الشقق.',
    'מעליות וחניה לפי המסמכים — השוו את המספרים למספר הדירות.',
  ],

  // ── Register: ownership & security ──
  verify_v3_reg_unit_mortgage: ['Mortgage on this apartment', 'იპოთეკა ამ ბინაზე', 'Ипотека на эту квартиру', 'Bu dairede ipotek', 'رهن على هذه الشقة', 'משכנתה על הדירה'],
  verify_v3_reg_parcel_security: ['Security on the developer’s parcel or building', 'უზრუნველყოფა დეველოპერის ნაკვეთზე ან შენობაზე', 'Обеспечение на участке или здании девелопера', 'Geliştiricinin arsası veya binası üzerindeki teminat', 'ضمان على أرض المطوّر أو مبناه', 'בטוחה על המגרש או הבניין של היזם'],
  verify_v3_reg_parcel_security_note: [
    'Registered on the parcel or building rather than on the apartment alone. Ask the developer and the lender how this apartment will be released from it before you pay.',
    'რეგისტრირებულია ნაკვეთზე ან შენობაზე და არა მხოლოდ ბინაზე. გადახდამდე ჰკითხეთ დეველოპერს და კრედიტორს, როგორ გათავისუფლდება მისგან ეს ბინა.',
    'Зарегистрировано на участок или здание, а не только на квартиру. До оплаты спросите девелопера и кредитора, как эта квартира будет из-под него выведена.',
    'Yalnızca daireye değil, arsaya veya binaya kayıtlı. Ödeme yapmadan önce geliştiriciye ve alacaklıya bu dairenin nasıl serbest bırakılacağını sorun.',
    'مسجّل على الأرض أو المبنى لا على الشقة وحدها. قبل الدفع، اسأل المطوّر والجهة الدائنة كيف ستُحرَّر هذه الشقة منه.',
    'רשום על המגרש או הבניין ולא על הדירה בלבד. לפני התשלום שאלו את היזם ואת המלווה איך הדירה תשוחרר ממנו.',
  ],
  verify_v3_reg_reused: [
    'Based on the registry extract retrieved on {{date}} in your earlier check.',
    'ეფუძნება საჯარო რეესტრის ამონაწერს, რომელიც თქვენი წინა შემოწმებისას, {{date}}-ს იქნა მიღებული.',
    'Основано на выписке из реестра, полученной {{date}} при вашей предыдущей проверке.',
    'Önceki kontrolünüzde {{date}} tarihinde alınan tapu kaydı özetine dayanır.',
    'يستند إلى مستخرج السجل الذي جُلب في {{date}} خلال فحصك السابق.',
    'מבוסס על נסח הרישום שהתקבל ב-{{date}} בבדיקה הקודמת שלכם.',
  ],

  // ── Viewer ──
  verify_v3_lightbox_thumbs: ['All images in this set', 'ამ ნაკრების ყველა გამოსახულება', 'Все изображения набора', 'Bu setteki tüm görseller', 'كل الصور في هذه المجموعة', 'כל התמונות בסדרה'],
};
