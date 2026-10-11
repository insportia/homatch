/*
 * Copy for the Verify v6 story, legal, technical and conclusion pass
 * (owner, 2026-10-11): the owner-approved Georgian section copy, VERBATIM
 * (INTRODUCTION, PENDING CHANGES, TECHNICAL, MATERIALS, LEGAL, PROJECT SCALE,
 * FINAL CONCLUSION), the project-evolution step labels, the four status
 * tracks, the legal finding scopes and the conclusion stances.
 *
 * Order is en, ka, ru, tr, ar, he — LANGS in lib/i18nSplice.mjs.
 * Paragraphs are separated by "\n"; components split on it. Placeholders
 * ({{date}}, {{ref}}, {{number}}, {{count}}, {{dates}}) survive in every
 * locale. No em dashes. Terminology: match = დამთხვევა, tenant = მოიჯარე,
 * თბილისი; never "confirmed buyer".
 */
export const VERIFY_V6_STORY_STRINGS = {
  /* ── INTRODUCTION ── */
  verify_v6s_intro_title: ['What is the story of this project?', 'რა ისტორია აქვს ამ პროექტს?', 'Какова история этого проекта?', 'Bu projenin hikâyesi nedir?', 'ما قصة هذا المشروع؟', 'מה הסיפור של הפרויקט הזה?'],
  verify_v6s_intro_body: [
    'The story of this building does not begin with how it looks today. The official documents contain design materials and decisions from different periods that show how the project developed over the years.\nWe studied these materials to understand what was originally planned, what changed afterwards, which changes were approved and what we know about the building as it stands today.\nBelow we show everything in order, focusing on the points that truly matter before you buy an apartment.',
    'ამ შენობის ისტორია მხოლოდ მისი დღევანდელი იერსახით არ იწყება. ოფიციალურ დოკუმენტებში გვხვდება სხვადასხვა პერიოდის საპროექტო მასალები და გადაწყვეტილებები, რომლებიც გვიჩვენებს, როგორ ვითარდებოდა პროექტი წლების განმავლობაში.\nჩვენ შევისწავლეთ ეს მასალები, რათა გაგვერკვია, რა იყო თავდაპირველად დაგეგმილი, რა შეიცვალა შემდეგ, რომელი ცვლილებები დამტკიცდა და რა ვიცით შენობის დღევანდელი მდგომარეობის შესახებ.\nქვემოთ ყველაფერს თანმიმდევრულად გაჩვენებთ. განსაკუთრებით ყურადღებას გავამახვილებთ იმ საკითხებზე, რომლებიც ბინის შეძენამდე ნამდვილად მნიშვნელოვანია.',
    'История этого здания не начинается с его нынешнего облика. В официальных документах есть проектные материалы и решения разных лет, которые показывают, как проект развивался со временем.\nМы изучили эти материалы, чтобы понять, что планировалось изначально, что изменилось потом, какие изменения были утверждены и что известно о нынешнем состоянии здания.\nНиже мы показываем всё по порядку и особенно выделяем то, что действительно важно до покупки квартиры.',
    'Bu binanın hikâyesi bugünkü görünümüyle başlamıyor. Resmî belgelerde, projenin yıllar içinde nasıl geliştiğini gösteren farklı dönemlere ait proje malzemeleri ve kararlar bulunuyor.\nBaşlangıçta neyin planlandığını, sonra neyin değiştiğini, hangi değişikliklerin onaylandığını ve binanın bugünkü durumu hakkında ne bildiğimizi anlamak için bu malzemeleri inceledik.\nAşağıda her şeyi sırasıyla gösteriyoruz ve özellikle daire almadan önce gerçekten önemli olan konulara odaklanıyoruz.',
    'لا تبدأ قصة هذا المبنى بمظهره الحالي. ففي الوثائق الرسمية مواد تصميمية وقرارات من فترات مختلفة تُظهر كيف تطوّر المشروع عبر السنين.\nدرسنا هذه المواد لنفهم ما كان مخططًا في البداية، وما الذي تغيّر بعد ذلك، وأي التغييرات اعتُمدت، وما الذي نعرفه عن حالة المبنى اليوم.\nنعرض أدناه كل شيء بالترتيب، مع تركيز خاص على المسائل المهمة فعلًا قبل شراء الشقة.',
    'הסיפור של הבניין הזה לא מתחיל במראה שלו היום. במסמכים הרשמיים יש חומרי תכנון והחלטות מתקופות שונות, שמראים איך הפרויקט התפתח לאורך השנים.\nבחנו את החומרים האלה כדי להבין מה תוכנן בהתחלה, מה השתנה אחר כך, אילו שינויים אושרו ומה ידוע לנו על מצב הבניין כיום.\nלהלן נציג הכול לפי הסדר, ונתמקד במיוחד בנושאים שבאמת חשובים לפני קניית דירה.',
  ],

  /* ── PENDING CHANGES ── */
  verify_v6s_pending_title: ['Changes still under consideration', 'პროექტში კიდევ განიხილება ცვლილებები', 'В проекте ещё рассматриваются изменения', 'Projede hâlâ değerlendirilen değişiklikler var', 'تغييرات لا تزال قيد النظر في المشروع', 'שינויים שעדיין נבחנים בפרויקט'],
  verify_v6s_pending_body: [
    'The official records show matters on which a final decision has not yet been confirmed. This in itself does not mean the project has a problem. Reviewing design changes during construction can be an ordinary procedure.\nWhat matters is understanding what exactly each change concerns and whether it could affect the building or your apartment.\nBelow we explain each matter separately and show the related official document.',
    'ოფიციალურ ჩანაწერებში ჩანს საკითხები, რომლებზეც საბოლოო გადაწყვეტილება ჯერ არ არის დადასტურებული. ეს თავისთავად არ ნიშნავს, რომ პროექტს პრობლემა აქვს. მშენებლობის პროცესში საპროექტო ცვლილებების განხილვა შესაძლებელია ჩვეულებრივი პროცედურაც იყოს.\nმნიშვნელოვანია გავიგოთ, კონკრეტულად რას ეხება თითოეული ცვლილება და შეიძლება თუ არა მან გავლენა მოახდინოს შენობაზე ან თქვენს ბინაზე.\nქვემოთ თითოეულ საკითხს ცალ-ცალკე აგიხსნით და შესაბამის ოფიციალურ დოკუმენტსაც გაჩვენებთ.',
    'В официальных записях есть вопросы, по которым окончательное решение ещё не подтверждено. Само по себе это не означает, что у проекта есть проблема. Рассмотрение проектных изменений во время строительства может быть обычной процедурой.\nВажно понять, чего именно касается каждое изменение и может ли оно повлиять на здание или на вашу квартиру.\nНиже мы объясняем каждый вопрос отдельно и показываем соответствующий официальный документ.',
    'Resmî kayıtlarda nihai kararı henüz kesinleşmemiş konular görünüyor. Bu tek başına projenin bir sorunu olduğu anlamına gelmez. İnşaat sürecinde proje değişikliklerinin incelenmesi olağan bir prosedür de olabilir.\nÖnemli olan, her değişikliğin tam olarak neyle ilgili olduğunu ve binayı ya da dairenizi etkileyip etkilemeyeceğini anlamaktır.\nAşağıda her konuyu ayrı ayrı açıklıyor ve ilgili resmî belgeyi de gösteriyoruz.',
    'تُظهر السجلات الرسمية مسائل لم يُؤكَّد بشأنها قرار نهائي بعد. وهذا بحد ذاته لا يعني أن في المشروع مشكلة، فدراسة تغييرات التصميم أثناء البناء قد تكون إجراءً عاديًا.\nالمهم أن نفهم ما يتعلق به كل تغيير تحديدًا، وما إذا كان قد يؤثر في المبنى أو في شقتك.\nنشرح أدناه كل مسألة على حدة ونعرض الوثيقة الرسمية المتعلقة بها.',
    'ברשומות הרשמיות מופיעים נושאים שעדיין לא אושרה לגביהם החלטה סופית. אין בכך כשלעצמו כדי לומר שיש בפרויקט בעיה. בחינת שינויי תכנון במהלך הבנייה יכולה להיות גם הליך רגיל.\nחשוב להבין במה בדיוק עוסק כל שינוי והאם הוא עשוי להשפיע על הבניין או על הדירה שלכם.\nלהלן נסביר כל נושא בנפרד ונציג גם את המסמך הרשמי הרלוונטי.',
  ],
  verify_v6s_resolved_title: ['Recent changes: decided', 'ბოლო ცვლილებები: გადაწყვეტილია', 'Последние изменения: решены', 'Son değişiklikler: karara bağlandı', 'التغييرات الأخيرة: صدر القرار', 'שינויים אחרונים: הוכרעו'],
  verify_v6s_resolved_note: [
    '{{count}} application(s) the city list still shows as under review were already decided: the published orders ({{dates}}) are described in the story above.',
    'ქალაქის სიაში განხილვაში მყოფად ნაჩვენები {{count}} განაცხადი უკვე გადაწყვეტილია: გამოქვეყნებული ბრძანებები ({{dates}}) ზემოთ, ისტორიაშია აღწერილი.',
    'Заявления ({{count}}), которые в списке города всё ещё значатся на рассмотрении, уже решены: опубликованные приказы ({{dates}}) описаны в истории выше.',
    'Belediye listesinde hâlâ incelemede görünen {{count}} başvuru zaten karara bağlandı: yayımlanan kararlar ({{dates}}) yukarıdaki hikâyede anlatılıyor.',
    'الطلبات ({{count}}) التي لا تزال قائمة البلدية تُظهرها قيد النظر قد صدر فيها قرار بالفعل: الأوامر المنشورة ({{dates}}) موصوفة في القصة أعلاه.',
    'בקשות ({{count}}) שברשימת העירייה עדיין מופיעות כבבדיקה כבר הוכרעו: הצווים שפורסמו ({{dates}}) מתוארים בסיפור למעלה.',
  ],

  /* ── evolution steps ── */
  verify_v6s_steps_label: ['How the project evolved', 'როგორ ვითარდებოდა პროექტი', 'Как развивался проект', 'Proje nasıl gelişti', 'كيف تطوّر المشروع', 'איך הפרויקט התפתח'],
  verify_v6s_step_requested: ['What was requested', 'რა მოითხოვეს', 'Что было запрошено', 'Ne talep edildi', 'ما الذي طُلب', 'מה התבקש'],
  verify_v6s_step_changed: ['What changed in practice', 'რა შეიცვალა პრაქტიკულად', 'Что изменилось на практике', 'Pratikte ne değişti', 'ما الذي تغيّر عمليًا', 'מה השתנה בפועל'],
  verify_v6s_step_final: ['Is it final', 'საბოლოოა თუ არა', 'Окончательно ли это', 'Kesin mi', 'هل هو نهائي', 'האם זה סופי'],
  verify_v6s_step_impact: ['What it means for a buyer', 'რას ნიშნავს მყიდველისთვის', 'Что это значит для покупателя', 'Alıcı için ne anlama geliyor', 'ماذا يعني للمشتري', 'מה זה אומר לקונה'],
  verify_v6s_step_unverified: ['What remains to verify', 'რა რჩება გადასამოწმებელი', 'Что остаётся проверить', 'Doğrulanması gereken', 'ما الذي يبقى للتحقق', 'מה נותר לבדוק'],
  verify_v6s_status_approved: ['Approved', 'დამტკიცდა', 'Утверждено', 'Onaylandı', 'اعتُمد', 'אושר'],
  verify_v6s_status_permit: ['Permit issued', 'ნებართვა გაიცა', 'Разрешение выдано', 'İzin verildi', 'صدر الترخيص', 'ניתן היתר'],
  verify_v6s_status_corrected: ['Figures corrected', 'მაჩვენებლები შესწორდა', 'Показатели исправлены', 'Rakamlar düzeltildi', 'صُحّحت الأرقام', 'הנתונים תוקנו'],
  verify_v6s_status_returned: ['Returned', 'დაბრუნდა', 'Возвращено', 'İade edildi', 'أُعيد', 'הוחזר'],
  verify_v6s_status_under_review: ['Under review', 'განხილვაშია', 'На рассмотрении', 'İncelemede', 'قيد النظر', 'בבדיקה'],
  verify_v6s_status_response_unread: ['Response published', 'პასუხი გამოქვეყნდა', 'Ответ опубликован', 'Yanıt yayımlandı', 'نُشر الرد', 'פורסמה תשובה'],
  verify_v6s_status_no_decision_read: ['No decision on record', 'გადაწყვეტილება არ ჩანს', 'Решения в записях нет', 'Kayıtta karar yok', 'لا قرار في السجلات', 'אין החלטה ברשומות'],
  verify_v6s_evidence: ['Documents and official records', 'დოკუმენტები და ოფიციალური ჩანაწერები', 'Документы и официальные записи', 'Belgeler ve resmî kayıtlar', 'الوثائق والسجلات الرسمية', 'מסמכים ורשומות רשמיות'],
  verify_v6s_evidence_case: ['Case {{ref}}', 'საქმე {{ref}}', 'Дело {{ref}}', 'Dosya {{ref}}', 'الملف {{ref}}', 'תיק {{ref}}'],
  verify_v6s_evidence_filed: ['filed {{date}}', 'შეტანილია {{date}}', 'подано {{date}}', 'başvuru {{date}}', 'قُدّم في {{date}}', 'הוגש {{date}}'],
  verify_v6s_evidence_decision: ['decision No. {{number}}', 'გადაწყვეტილება № {{number}}', 'решение № {{number}}', 'karar No. {{number}}', 'القرار رقم {{number}}', 'החלטה מס׳ {{number}}'],
  verify_v6s_evidence_open_case: ['Open the case', 'საქმის გახსნა', 'Открыть дело', 'Dosyayı aç', 'فتح الملف', 'פתיחת התיק'],
  verify_v6s_latest_title: ['Latest approved documentation', 'ბოლო დამტკიცებული საპროექტო დოკუმენტაცია', 'Последняя утверждённая проектная документация', 'Son onaylı proje belgeleri', 'أحدث وثائق تصميم معتمدة', 'תיעוד התכנון המאושר האחרון'],
  verify_v6s_status_title: ['Where the project stands today', 'სად დგას პროექტი დღეს', 'Где проект находится сегодня', 'Proje bugün nerede', 'أين يقف المشروع اليوم', 'איפה הפרויקט עומד היום'],
  verify_v6s_track_construction: ['Construction activity', 'სამშენებლო სამუშაოები', 'Строительные работы', 'İnşaat faaliyeti', 'أعمال البناء', 'עבודות בנייה'],
  verify_v6s_track_completion: ['Physical completion', 'ფიზიკური დასრულება', 'Физическое завершение', 'Fiziksel tamamlanma', 'الإنجاز الفعلي', 'השלמה פיזית'],
  verify_v6s_track_permit: ['Official approval', 'ოფიციალური ნებართვა', 'Официальное разрешение', 'Resmî onay', 'الموافقة الرسمية', 'אישור רשמי'],
  verify_v6s_track_commissioning: ['Commissioning', 'ექსპლუატაციაში მიღება', 'Ввод в эксплуатацию', 'İskân', 'القبول للاستخدام', 'קבלה לשימוש'],

  /* ── TECHNICAL / MATERIALS ── */
  verify_v6s_tech_title: ['How well is the building planned?', 'რამდენად კარგად არის შენობა დაგეგმილი?', 'Насколько хорошо спланировано здание?', 'Bina ne kadar iyi planlanmış?', 'ما مدى جودة تخطيط المبنى؟', 'עד כמה הבניין מתוכנן היטב?'],
  verify_v6s_tech_body: [
    'Appearance is not all that matters when assessing a building. The structure, foundation, engineering systems, materials used and how thoroughly all of this is documented also deserve attention.\nOfficial drawings and technical documents show which solutions the project provided for. However, the quality described in a document and the work actually carried out are not the same thing.\nSo below we explain what the project provides for and what is worth checking in the building itself.',
    'შენობის შეფასებისას მხოლოდ მისი გარეგნობა არ არის მნიშვნელოვანი. ყურადღებას იმსახურებს კონსტრუქცია, საძირკველი, საინჟინრო სისტემები, გამოყენებული მასალები და ისიც, რამდენად დეტალურად არის ეს ყველაფერი დოკუმენტირებული.\nოფიციალური ნახაზები და ტექნიკური დოკუმენტები გვიჩვენებს, რა გადაწყვეტილებები იყო გათვალისწინებული პროექტში. თუმცა დოკუმენტში აღწერილი ხარისხი და რეალურად შესრულებული სამუშაო ერთი და იგივე არ არის.\nამიტომ ქვემოთ აგიხსნით, რას ითვალისწინებს პროექტი და რისი გადამოწმებაა სასურველი უშუალოდ შენობაში.',
    'При оценке здания важен не только внешний вид. Внимания заслуживают конструкция, фундамент, инженерные системы, использованные материалы и то, насколько подробно всё это задокументировано.\nОфициальные чертежи и технические документы показывают, какие решения предусматривал проект. Однако качество, описанное в документе, и реально выполненная работа не одно и то же.\nПоэтому ниже мы объясняем, что предусматривает проект и что желательно проверить непосредственно в здании.',
    'Bir binayı değerlendirirken yalnızca görünüşü önemli değildir. Taşıyıcı sistem, temel, mühendislik sistemleri, kullanılan malzemeler ve tüm bunların ne kadar ayrıntılı belgelendiği de dikkate değer.\nResmî çizimler ve teknik belgeler projede hangi çözümlerin öngörüldüğünü gösterir. Ancak belgede tarif edilen kalite ile fiilen yapılan iş aynı şey değildir.\nBu yüzden aşağıda projenin neyi öngördüğünü ve binada bizzat neyin kontrol edilmesinin iyi olacağını açıklıyoruz.',
    'لا يقتصر تقييم المبنى على مظهره. فالهيكل والأساسات والأنظمة الهندسية والمواد المستخدمة، ومدى تفصيل توثيق ذلك كله، أمور تستحق الاهتمام أيضًا.\nتُظهر المخططات الرسمية والوثائق الفنية الحلول التي نصّ عليها المشروع. لكن الجودة الموصوفة في الوثيقة والعمل المنفّذ فعليًا ليسا الشيء نفسه.\nلذلك نشرح أدناه ما ينص عليه المشروع وما يُستحسن التحقق منه في المبنى نفسه.',
    'בהערכת בניין לא רק המראה חשוב. ראויים לתשומת לב גם השלד, היסודות, מערכות ההנדסה, החומרים שבהם נעשה שימוש ועד כמה כל זה מתועד בפירוט.\nהשרטוטים הרשמיים והמסמכים הטכניים מראים אילו פתרונות נכללו בפרויקט. עם זאת, האיכות המתוארת במסמך והעבודה שבוצעה בפועל אינן אותו דבר.\nלכן להלן נסביר מה הפרויקט כולל ומה כדאי לבדוק בבניין עצמו.',
  ],
  verify_v6s_materials_title: ['Materials and finishes', 'მასალები და მოპირკეთება', 'Материалы и отделка', 'Malzemeler ve kaplamalar', 'المواد والتشطيبات', 'חומרים וגימורים'],
  verify_v6s_materials_body: [
    'The materials named in the project documents help us understand what was planned. To judge their real condition, it is best to see the building in person.\nIt is advisable to check the details with the owner or, if the project has a sales representative, directly with them. Pay particular attention to the facade, windows, common areas, engineering systems and the condition in which the apartment is handed over.',
    'პროექტის დოკუმენტებში მითითებული მასალები გვეხმარება გავიგოთ, რა იყო დაგეგმილი. მათი რეალური მდგომარეობის შესაფასებლად კი უმჯობესია შენობა პირადად დაათვალიეროთ.\nსასურველია დეტალები გადაამოწმოთ მესაკუთრესთან ან, თუ პროექტს გაყიდვების წარმომადგენელი ჰყავს, უშუალოდ მასთან. განსაკუთრებით ყურადღება მიაქციეთ ფასადს, ფანჯრებს, საერთო სივრცეებს, საინჟინრო სისტემებსა და ბინის ჩაბარების მდგომარეობას.',
    'Материалы, указанные в проектных документах, помогают понять, что было запланировано. Чтобы оценить их реальное состояние, лучше осмотреть здание лично.\nДетали желательно уточнить у собственника или, если у проекта есть представитель по продажам, напрямую у него. Особое внимание обратите на фасад, окна, общие пространства, инженерные системы и состояние, в котором передаётся квартира.',
    'Proje belgelerinde belirtilen malzemeler neyin planlandığını anlamamıza yardımcı olur. Gerçek durumlarını değerlendirmek için binayı bizzat görmek en iyisidir.\nAyrıntıları mal sahibiyle ya da projenin bir satış temsilcisi varsa doğrudan onunla teyit etmeniz önerilir. Özellikle cepheye, pencerelere, ortak alanlara, mühendislik sistemlerine ve dairenin teslim durumuna dikkat edin.',
    'تساعدنا المواد المذكورة في وثائق المشروع على فهم ما كان مخططًا. أما لتقييم حالتها الفعلية فالأفضل معاينة المبنى شخصيًا.\nيُستحسن التحقق من التفاصيل مع المالك أو، إن كان للمشروع ممثل مبيعات، معه مباشرة. انتبه خصوصًا إلى الواجهة والنوافذ والمساحات المشتركة والأنظمة الهندسية وحالة تسليم الشقة.',
    'החומרים המצוינים במסמכי הפרויקט עוזרים להבין מה תוכנן. כדי להעריך את מצבם בפועל, עדיף לראות את הבניין באופן אישי.\nמומלץ לאמת את הפרטים מול הבעלים או, אם לפרויקט יש נציג מכירות, ישירות מולו. שימו לב במיוחד לחזית, לחלונות, לשטחים המשותפים, למערכות ההנדסה ולמצב שבו הדירה נמסרת.',
  ],
  verify_v6s_tech_term: ['What the term means', 'რას ნიშნავს ტერმინი', 'Что означает термин', 'Terim ne anlama geliyor', 'ماذا يعني المصطلح', 'מה פירוש המונח'],
  verify_v6s_tech_establishes: ['What the documents establish', 'რას ადგენს დოკუმენტები', 'Что устанавливают документы', 'Belgeler neyi ortaya koyuyor', 'ما الذي تُثبته الوثائق', 'מה המסמכים קובעים'],
  verify_v6s_tech_why: ['Why it matters', 'რატომ არის მნიშვნელოვანი', 'Почему это важно', 'Neden önemli', 'لماذا هذا مهم', 'למה זה חשוב'],
  verify_v6s_tech_cannot: ['What the documents cannot prove', 'რას ვერ ადასტურებს დოკუმენტები', 'Чего документы не доказывают', 'Belgelerin kanıtlayamadığı', 'ما لا تستطيع الوثائق إثباته', 'מה המסמכים אינם יכולים להוכיח'],

  /* ── LEGAL ── */
  verify_v6s_legal_title: ['What do we know about ownership and the legal position?', 'რა ვიცით საკუთრებისა და სამართლებრივი მდგომარეობის შესახებ?', 'Что мы знаем о собственности и правовом положении?', 'Mülkiyet ve hukuki durum hakkında ne biliyoruz?', 'ماذا نعرف عن الملكية والوضع القانوني؟', 'מה ידוע לנו על הבעלות והמצב המשפטי?'],
  verify_v6s_legal_body: [
    'Before buying an apartment, three questions need answers: in whose name the property is registered, whether there are restrictions in force on it, and what state the building\'s official documentation is in.\nWe consider the records we found by their specific dates, because an old extract cannot always reflect the present situation.\nBelow you will see what is officially confirmed, what has changed over time and which information should be refreshed before the transaction.',
    'ბინის შეძენამდე მნიშვნელოვანია სამი საკითხის გარკვევა: ვის სახელზეა რეგისტრირებული ქონება, არსებობს თუ არა მასზე მოქმედი შეზღუდვები და რა მდგომარეობაშია შენობის ოფიციალური დოკუმენტაცია.\nჩვენ მოძიებულ ჩანაწერებს კონკრეტული თარიღების მიხედვით განვიხილავთ, რადგან ძველი ამონაწერი ყოველთვის ვერ ასახავს დღევანდელ მდგომარეობას.\nქვემოთ ნახავთ, რა არის ოფიციალურად დადასტურებული, რა შეიცვალა დროთა განმავლობაში და რომელი ინფორმაცია უნდა განახლდეს გარიგების წინ.',
    'Перед покупкой квартиры важно выяснить три вопроса: на чьё имя зарегистрирована собственность, есть ли на ней действующие ограничения и в каком состоянии официальная документация здания.\nМы рассматриваем найденные записи по их конкретным датам, потому что старая выписка не всегда отражает нынешнее положение.\nНиже вы увидите, что официально подтверждено, что изменилось со временем и какую информацию нужно обновить перед сделкой.',
    'Daire almadan önce üç konunun netleşmesi önemlidir: mülkün kimin adına kayıtlı olduğu, üzerinde yürürlükte bir kısıtlama olup olmadığı ve binanın resmî belgelerinin ne durumda olduğu.\nBulduğumuz kayıtları belirli tarihlerine göre ele alıyoruz, çünkü eski bir tapu kaydı bugünkü durumu her zaman yansıtamaz.\nAşağıda neyin resmî olarak doğrulandığını, zamanla neyin değiştiğini ve işlemden önce hangi bilgilerin güncellenmesi gerektiğini göreceksiniz.',
    'قبل شراء الشقة من المهم توضيح ثلاث مسائل: باسم من سُجّل العقار، وهل توجد عليه قيود سارية، وما حالة الوثائق الرسمية للمبنى.\nنتناول السجلات التي وجدناها وفق تواريخها المحددة، لأن المستخرج القديم لا يعكس دائمًا الوضع الحالي.\nستجد أدناه ما هو مؤكَّد رسميًا، وما تغيّر مع الوقت، وأي المعلومات ينبغي تحديثها قبل الصفقة.',
    'לפני קניית דירה חשוב לברר שלושה נושאים: על שם מי רשום הנכס, האם חלות עליו מגבלות בתוקף ובאיזה מצב נמצא התיעוד הרשמי של הבניין.\nאנחנו בוחנים את הרשומות שמצאנו לפי התאריכים המדויקים שלהן, כי נסח ישן לא תמיד משקף את המצב הנוכחי.\nלהלן תראו מה מאושר רשמית, מה השתנה עם הזמן ואיזה מידע יש לעדכן לפני העסקה.',
  ],
  verify_v6s_scope_unit: ['This apartment', 'ეს ბინა', 'Эта квартира', 'Bu daire', 'هذه الشقة', 'הדירה הזו'],
  verify_v6s_scope_parcel: ['Land parcel', 'მიწის ნაკვეთი', 'Земельный участок', 'Arsa', 'قطعة الأرض', 'החלקה'],
  verify_v6s_scope_building: ['Building', 'შენობა', 'Здание', 'Bina', 'المبنى', 'הבניין'],
  verify_v6s_scope_company: ['Developer', 'დეველოპერი', 'Девелопер', 'Geliştirici', 'المطوّر', 'היזם'],
  verify_v6s_scope_project: ['Project', 'პროექტი', 'Проект', 'Proje', 'المشروع', 'הפרויקט'],
  verify_v6s_observed: ['Record date: {{date}}', 'ჩანაწერის თარიღი: {{date}}', 'Дата записи: {{date}}', 'Kayıt tarihi: {{date}}', 'تاريخ السجل: {{date}}', 'תאריך הרשומה: {{date}}'],

  /* ── PROJECT SCALE ── */
  verify_v6s_scale_title: ['How large is the project really?', 'რამდენად დიდია პროექტი სინამდვილეში?', 'Насколько велик проект на самом деле?', 'Proje gerçekte ne kadar büyük?', 'ما حجم المشروع فعلًا؟', 'כמה גדול הפרויקט באמת?'],
  verify_v6s_scale_body: [
    'The number of floors alone is not enough to understand a building\'s scale. It matters to know the land area, how much floor space may be built, and what share goes to residential, commercial or common areas.\nThese figures show the project\'s real size more clearly, and how space is distributed within the building.',
    'შენობის მასშტაბის გასაგებად მხოლოდ სართულების რაოდენობა არ კმარა. მნიშვნელოვანია ვიცოდეთ მიწის ფართობი, რამდენი სივრცის განაშენიანებაა ნებადართული და რა ნაწილი ეთმობა საცხოვრებელ, კომერციულ თუ საერთო დანიშნულების ფართებს.\nამ მონაცემებით უკეთ ჩანს პროექტის რეალური მოცულობა და ისიც, როგორ ნაწილდება სივრცე შენობაში.',
    'Одного количества этажей недостаточно, чтобы понять масштаб здания. Важно знать площадь земли, сколько площади разрешено застроить и какая доля отводится под жилые, коммерческие или общие помещения.\nЭти данные лучше показывают реальный объём проекта и то, как распределяется пространство в здании.',
    'Bir binanın ölçeğini anlamak için kat sayısı tek başına yeterli değildir. Arsa alanını, ne kadar alanın inşa edilmesine izin verildiğini ve konut, ticari ya da ortak alanlara ne kadar pay ayrıldığını bilmek önemlidir.\nBu veriler projenin gerçek hacmini ve alanın bina içinde nasıl dağıldığını daha iyi gösterir.',
    'لا يكفي عدد الطوابق وحده لفهم حجم المبنى. من المهم معرفة مساحة الأرض، ومقدار المساحة المسموح ببنائها، والحصة المخصصة للمساحات السكنية أو التجارية أو المشتركة.\nتُظهر هذه البيانات الحجم الحقيقي للمشروع بوضوح أكبر، وكيف تتوزع المساحة داخل المبنى.',
    'מספר הקומות לבדו אינו מספיק כדי להבין את היקף הבניין. חשוב לדעת את שטח הקרקע, כמה שטח מותר לבנות ואיזה חלק מוקצה לשטחי מגורים, מסחר או שטחים משותפים.\nהנתונים האלה מראים טוב יותר את ההיקף האמיתי של הפרויקט ואת אופן חלוקת השטח בבניין.',
  ],

  /* ── FINAL CONCLUSION ── */
  verify_v6s_final_title: ['In the end, what do we think of this property?', 'საბოლოოდ, რას ვფიქრობთ ამ ქონებაზე?', 'Итак, что мы думаем об этой недвижимости?', 'Sonuçta bu mülk hakkında ne düşünüyoruz?', 'في النهاية، ما رأينا في هذا العقار؟', 'בסופו של דבר, מה אנחנו חושבים על הנכס הזה?'],
  verify_v6s_final_lede: [
    'After going through so much information, the main question is simple: how well founded is it to consider buying this property?\nWhat matters to us is not only what advantages the project has, but also how well those advantages are supported by documents and which questions remain to be verified.',
    'ამდენი ინფორმაციის გაცნობის შემდეგ მთავარი კითხვა მარტივია: რამდენად საფუძვლიანია ამ ქონების შეძენის განხილვა?\nჩვენთვის მნიშვნელოვანია არა მხოლოდ ის, რა უპირატესობები აქვს პროექტს, არამედ ისიც, რამდენად კარგად დასტურდება ეს უპირატესობები დოკუმენტებით და რა საკითხები რჩება გადასამოწმებელი.',
    'После знакомства с таким объёмом информации главный вопрос прост: насколько обоснованно рассматривать покупку этой недвижимости?\nДля нас важно не только то, какие преимущества есть у проекта, но и то, насколько хорошо они подтверждаются документами и какие вопросы остаются для проверки.',
    'Bu kadar bilgiyi inceledikten sonra asıl soru basit: bu mülkü satın almayı değerlendirmek ne kadar sağlam bir temele dayanıyor?\nBizim için önemli olan yalnızca projenin hangi avantajlara sahip olduğu değil, bu avantajların belgelerle ne kadar iyi desteklendiği ve hangi konuların doğrulanmayı beklediğidir.',
    'بعد الاطلاع على كل هذه المعلومات، السؤال الرئيسي بسيط: إلى أي حد يستند التفكير في شراء هذا العقار إلى أساس متين؟\nلا يهمنا فقط ما يتمتع به المشروع من مزايا، بل أيضًا مدى تأكيد الوثائق لهذه المزايا، وما المسائل التي تبقى بحاجة إلى تحقق.',
    'אחרי שעברנו על כל כך הרבה מידע, השאלה המרכזית פשוטה: עד כמה מבוסס לשקול את רכישת הנכס הזה?\nחשוב לנו לא רק אילו יתרונות יש לפרויקט, אלא גם עד כמה היתרונות האלה נתמכים במסמכים ואילו נושאים נותרו לבדיקה.',
  ],
  verify_v6s_final_strengths: ['What the documents support', 'რას ადასტურებს დოკუმენტები', 'Что подтверждают документы', 'Belgelerin desteklediği', 'ما تؤكده الوثائق', 'מה המסמכים תומכים בו'],
  verify_v6s_final_concerns: ['What deserves attention, and why', 'რას უნდა მიექცეს ყურადღება და რატომ', 'На что стоит обратить внимание и почему', 'Neye dikkat edilmeli ve neden', 'ما يستحق الانتباه ولماذا', 'למה כדאי לשים לב ומדוע'],
  verify_v6s_stance_positive: ['The evidence supports a positive assessment', 'მტკიცებულებები დადებით შეფასებას ამყარებს', 'Данные поддерживают положительную оценку', 'Kanıtlar olumlu bir değerlendirmeyi destekliyor', 'الأدلة تدعم تقييمًا إيجابيًا', 'הראיות תומכות בהערכה חיובית'],
  verify_v6s_stance_balanced: ['The evidence supports a balanced assessment', 'მტკიცებულებები დაბალანსებულ შეფასებას ამყარებს', 'Данные поддерживают взвешенную оценку', 'Kanıtlar dengeli bir değerlendirmeyi destekliyor', 'الأدلة تدعم تقييمًا متوازنًا', 'הראיות תומכות בהערכה מאוזנת'],
  verify_v6s_stance_cautious: ['The evidence calls for caution', 'მტკიცებულებები სიფრთხილეს მოითხოვს', 'Данные требуют осторожности', 'Kanıtlar temkinli olmayı gerektiriyor', 'الأدلة تستدعي الحذر', 'הראיות מחייבות זהירות'],
  verify_v6s_final_closing: [
    'Our aim is not to make the decision for you. We want you to make your choice as informed as possible, knowing the project\'s strengths and seeing in advance the matters worth extra attention.',
    'ჩვენი მიზანი არ არის თქვენს ნაცვლად გადაწყვეტილების მიღება. გვინდა, რომ არჩევანი მაქსიმალურად ინფორმირებულად გააკეთოთ, იცოდეთ პროექტის ძლიერი მხარეები და წინასწარ ხედავდეთ საკითხებს, რომლებზეც დამატებითი ყურადღების გამახვილება ღირს.',
    'Наша цель не принять решение за вас. Мы хотим, чтобы вы сделали выбор максимально осознанно, знали сильные стороны проекта и заранее видели вопросы, которым стоит уделить дополнительное внимание.',
    'Amacımız sizin yerinize karar vermek değil. Seçiminizi mümkün olduğunca bilgili yapmanızı, projenin güçlü yanlarını bilmenizi ve ek dikkat gerektiren konuları önceden görmenizi istiyoruz.',
    'ليس هدفنا أن نتخذ القرار نيابةً عنك. نريد أن يكون اختيارك مستنيرًا قدر الإمكان، وأن تعرف نقاط قوة المشروع وترى مسبقًا المسائل التي تستحق اهتمامًا إضافيًا.',
    'המטרה שלנו אינה לקבל את ההחלטה במקומכם. אנחנו רוצים שתבחרו בצורה מושכלת ככל האפשר, תכירו את החוזקות של הפרויקט ותראו מראש את הנושאים שכדאי לתת עליהם תשומת לב נוספת.',
  ],
};
