/*
 * Copy for the Verify official document explorer (final polish, 2026-10-11):
 * documents grouped by what they prove, the secure viewer's "open" action,
 * technical files that no browser opens, and the collapsed full library.
 *
 * Order is en, ka, ru, tr, ar, he (LANGS in lib/i18nSplice.mjs).
 * Placeholders ({{count}}, {{cases}}) survive in every locale.
 * No em dashes in customer prose.
 */
export const VERIFY_FINAL_DOCS_STRINGS = {
  verify_fdocs_main_title: ['Most useful documents', 'ყველაზე მნიშვნელოვანი დოკუმენტები', 'Самые важные документы', 'En önemli belgeler', 'أهم المستندات', 'המסמכים החשובים ביותר'],

  /* ── groups ── */
  verify_fdocs_group_permits: ['Permits, decisions and register extracts', 'ნებართვები, გადაწყვეტილებები და ამონაწერები', 'Разрешения, решения и выписки', 'İzinler, kararlar ve tapu kayıt örnekleri', 'التصاريح والقرارات ومستخرجات السجل', 'היתרים, החלטות ונסחי רישום'],
  verify_fdocs_group_drawings: ['Approved project and drawings', 'შეთანხმებული პროექტი და ნახაზები', 'Согласованный проект и чертежи', 'Onaylı proje ve çizimler', 'المشروع المعتمد والمخططات', 'התוכנית המאושרת והשרטוטים'],
  verify_fdocs_group_expert: ['Expert conclusions', 'ექსპერტიზის დასკვნები', 'Экспертные заключения', 'Uzman raporları', 'تقارير الخبراء', 'חוות דעת מומחים'],
  verify_fdocs_group_photos: ['Photos from the site', 'ფოტოები ადგილიდან', 'Фотографии с участка', 'Sahadan fotoğraflar', 'صور من الموقع', 'תמונות מהאתר'],
  verify_fdocs_group_other: ['Other case documents', 'საქმის სხვა დოკუმენტები', 'Другие документы дела', 'Dosyadaki diğer belgeler', 'مستندات أخرى في الملف', 'מסמכים נוספים בתיק'],

  /* ── what each group proves ── */
  verify_fdocs_proves_permits: [
    'Shows what the city allowed or decided on this case, and on what terms.',
    'აჩვენებს, რა დაუშვა ან რა გადაწყვიტა მერიამ ამ საქმეზე და რა პირობით.',
    'Показывают, что город разрешил или решил по этому делу и на каких условиях.',
    'Belediyenin bu dosyada neye izin verdiğini veya ne karar verdiğini ve hangi koşullarla olduğunu gösterir.',
    'تُظهر ما سمحت به البلدية أو قرّرته في هذا الملف وبأي شروط.',
    'מראים מה העירייה התירה או החליטה בתיק הזה ובאילו תנאים.',
  ],
  verify_fdocs_proves_drawings: [
    'The building as submitted to the city: site plan, floors, sections and facades.',
    'შენობა ისე, როგორც მერიაში წარადგინეს: გენგეგმა, სართულები, ჭრილები და ფასადები.',
    'Здание в том виде, в каком его подали в город: генплан, этажи, разрезы и фасады.',
    'Binanın belediyeye sunulduğu hali: vaziyet planı, katlar, kesitler ve cepheler.',
    'المبنى كما قُدِّم إلى البلدية: المخطط العام والطوابق والمقاطع والواجهات.',
    'הבניין כפי שהוגש לעירייה: תוכנית מגרש, קומות, חתכים וחזיתות.',
  ],
  verify_fdocs_proves_expert: [
    'Independent assessments of the ground, the structure or safety, written for the city.',
    'გრუნტის, კონსტრუქციის ან უსაფრთხოების დამოუკიდებელი შეფასება, მომზადებული მერიისთვის.',
    'Независимая оценка грунта, конструкций или безопасности, подготовленная для города.',
    'Zemin, taşıyıcı sistem veya güvenlik hakkında belediye için hazırlanmış bağımsız değerlendirmeler.',
    'تقييمات مستقلة للتربة أو الهيكل أو السلامة أُعدّت للبلدية.',
    'הערכות בלתי תלויות של הקרקע, השלד או הבטיחות שהוכנו עבור העירייה.',
  ],
  verify_fdocs_proves_photos: [
    'What the plot or the construction looked like on the day the photos were taken.',
    'როგორ გამოიყურებოდა ნაკვეთი ან მშენებლობა ფოტოების გადაღების დღეს.',
    'Как выглядели участок или стройка в день съёмки.',
    'Fotoğrafların çekildiği gün arsanın veya inşaatın nasıl göründüğü.',
    'كيف بدت قطعة الأرض أو أعمال البناء يوم التقاط الصور.',
    'איך נראו המגרש או הבנייה ביום שבו צולמו התמונות.',
  ],
  verify_fdocs_proves_other: [
    'Applications, letters and supporting papers filed with the case.',
    'საქმეზე წარდგენილი განცხადებები, წერილები და დამხმარე მასალა.',
    'Заявления, письма и сопутствующие материалы, поданные по делу.',
    'Dosyaya sunulan başvurular, yazışmalar ve destekleyici belgeler.',
    'الطلبات والمراسلات والمستندات الداعمة المقدَّمة في الملف.',
    'בקשות, מכתבים ומסמכים תומכים שהוגשו בתיק.',
  ],

  /* ── actions and states ── */
  verify_fdocs_open: ['Open', 'გახსნა', 'Открыть', 'Aç', 'فتح', 'פתיחה'],
  verify_fdocs_opening: ['Opening…', 'იხსნება…', 'Открывается…', 'Açılıyor…', 'جارٍ الفتح…', 'נפתח…'],
  verify_fdocs_more: ['{{count}} more in the full library', 'კიდევ {{count}} სრულ ბიბლიოთეკაში', 'Ещё {{count}} в полной библиотеке', 'Tam kitaplıkta {{count}} tane daha', '{{count}} أخرى في المكتبة الكاملة', 'עוד {{count}} בספרייה המלאה'],
  verify_fdocs_none_viewable: [
    'None of the case files can be opened in a browser. The full library below lists every file.',
    'საქმის ფაილებიდან არცერთი არ იხსნება ბრაუზერში. ქვემოთ, სრულ ბიბლიოთეკაში, ყველა ფაილია ჩამოთვლილი.',
    'Ни один файл дела не открывается в браузере. Полная библиотека ниже перечисляет все файлы.',
    'Dosyadaki belgelerin hiçbiri tarayıcıda açılamıyor. Aşağıdaki tam kitaplık tüm dosyaları listeler.',
    'لا يمكن فتح أي من ملفات القضية في المتصفح. تسرد المكتبة الكاملة أدناه كل الملفات.',
    'אף אחד מקובצי התיק אינו נפתח בדפדפן. הספרייה המלאה למטה מפרטת את כל הקבצים.',
  ],
  verify_fdocs_viewer_note: [
    'Files open from a secure HOMATCH copy of the official record, unchanged.',
    'ფაილები იხსნება ოფიციალური ჩანაწერის HOMATCH-ის დაცული ასლიდან, უცვლელად.',
    'Файлы открываются из защищённой копии HOMATCH официальной записи, без изменений.',
    'Dosyalar, resmi kaydın HOMATCH tarafından tutulan güvenli kopyasından değiştirilmeden açılır.',
    'تُفتح الملفات من نسخة HOMATCH الآمنة للسجل الرسمي، دون أي تعديل.',
    'הקבצים נפתחים מעותק מאובטח של HOMATCH של הרשומה הרשמית, ללא שינוי.',
  ],
  verify_fdocs_library: ['Full library: {{count}} files in {{cases}} cases', 'სრული ბიბლიოთეკა: {{count}} ფაილი, {{cases}} საქმე', 'Полная библиотека: {{count}} файлов в {{cases}} делах', 'Tam kitaplık: {{cases}} dosyada {{count}} belge', 'المكتبة الكاملة: {{count}} ملفًا في {{cases}} قضية', 'הספרייה המלאה: {{count}} קבצים ב־{{cases}} תיקים'],
  verify_fdocs_technical: ['Technical file, not viewable in a browser', 'ტექნიკური ფაილი, ბრაუზერში არ იხსნება', 'Технический файл, не открывается в браузере', 'Teknik dosya, tarayıcıda görüntülenemez', 'ملف تقني لا يمكن عرضه في المتصفح', 'קובץ טכני, לא ניתן לצפייה בדפדפן'],
  verify_fdocs_private: ['Contains personal data, not shown in the report', 'შეიცავს პირად მონაცემებს, ანგარიშში არ ვაჩვენებთ', 'Содержит личные данные, в отчёте не показывается', 'Kişisel veri içerir, raporda gösterilmez', 'يحتوي على بيانات شخصية، لا يُعرض في التقرير', 'מכיל מידע אישי, לא מוצג בדוח'],
  verify_fdocs_not_retrieved: ['Could not be retrieved from the official source', 'ოფიციალური წყაროდან ვერ ჩამოიტვირთა', 'Не удалось получить из официального источника', 'Resmi kaynaktan alınamadı', 'تعذّر جلبه من المصدر الرسمي', 'לא ניתן היה לקבל אותו מהמקור הרשמי'],
  verify_fdocs_case_page: ['Official case page', 'საქმის ოფიციალური გვერდი', 'Официальная страница дела', 'Resmi dosya sayfası', 'صفحة القضية الرسمية', 'דף התיק הרשמי'],

  /* ── errors ── */
  verify_fdocs_err_sign_in: ['Sign in to open official files.', 'ოფიციალური ფაილების გასახსნელად შედით ანგარიშზე.', 'Войдите, чтобы открывать официальные файлы.', 'Resmi dosyaları açmak için giriş yapın.', 'سجّل الدخول لفتح الملفات الرسمية.', 'יש להתחבר כדי לפתוח קבצים רשמיים.'],
  verify_fdocs_err_unavailable: ['This file is not part of the report.', 'ეს ფაილი ანგარიშის ნაწილი არ არის.', 'Этот файл не входит в отчёт.', 'Bu dosya raporun bir parçası değil.', 'هذا الملف ليس جزءًا من التقرير.', 'הקובץ הזה אינו חלק מהדוח.'],
  verify_fdocs_err_source: [
    'The file could not be opened right now. Please try again in a moment.',
    'ფაილის გახსნა ახლა ვერ მოხერხდა. სცადეთ ცოტა ხანში.',
    'Сейчас открыть файл не удалось. Попробуйте чуть позже.',
    'Dosya şu anda açılamadı. Lütfen birazdan tekrar deneyin.',
    'تعذّر فتح الملف الآن. يُرجى المحاولة بعد قليل.',
    'לא ניתן לפתוח את הקובץ כרגע. נסו שוב בעוד רגע.',
  ],
};
