/*
 * Copy for the Verify report v6 layout (owner, 2026-10-11): the five-group
 * sticky navigation, the approved "who worked on this project" introduction,
 * and the stage label on each documented person.
 *
 * Order is en, ka, ru, tr, ar, he — LANGS in lib/i18nSplice.mjs.
 * The Georgian introduction is the owner-approved text, verbatim.
 * Placeholders ({{span}}) survive in every locale.
 */
export const VERIFY_V6_LAYOUT_STRINGS = {
  /* ── navigation ── */
  verify_v6_nav_label: ['Report sections', 'ანგარიშის ნავიგაცია', 'Разделы отчёта', 'Rapor bölümleri', 'أقسام التقرير', 'חלקי הדוח'],
  verify_v6_nav_main: ['Overview', 'მთავარი', 'Главное', 'Genel bakış', 'الرئيسي', 'עיקר'],
  verify_v6_nav_project: ['Project', 'პროექტი', 'Проект', 'Proje', 'المشروع', 'הפרויקט'],
  verify_v6_nav_safety: ['Safety', 'უსაფრთხოება', 'Безопасность', 'Güvenlik', 'الأمان', 'בטיחות'],
  verify_v6_nav_place: ['Area & price', 'გარემო და ფასი', 'Окружение и цена', 'Çevre ve fiyat', 'المحيط والسعر', 'סביבה ומחיר'],
  verify_v6_nav_documents: ['Documents', 'დოკუმენტები', 'Документы', 'Belgeler', 'المستندات', 'מסמכים'],

  /* ── people ── */
  verify_v6_people_title: ['Who worked on this project?', 'ვინ მუშაობდა ამ პროექტზე?', 'Кто работал над этим проектом?', 'Bu projede kimler çalıştı?', 'من عمل على هذا المشروع؟', 'מי עבד על הפרויקט הזה?'],
  verify_v6_people_intro_1: [
    'Many specialists take part in creating a building. The architect defines its spatial and visual solutions, the structural engineer works on the load-bearing systems, and other engineers are responsible for specific technical parts.',
    'შენობის შექმნაში სხვადასხვა სპეციალისტი მონაწილეობს. არქიტექტორი განსაზღვრავს სივრცით და ვიზუალურ გადაწყვეტებს, კონსტრუქტორი მუშაობს შენობის მზიდ სისტემებზე, ხოლო სხვა ინჟინრები კონკრეტულ ტექნიკურ ნაწილებზე არიან პასუხისმგებელი.',
    'В создании здания участвуют разные специалисты. Архитектор определяет пространственные и визуальные решения, конструктор работает над несущими системами здания, а другие инженеры отвечают за отдельные технические части.',
    'Bir binanın ortaya çıkmasında farklı uzmanlar yer alır. Mimar mekânsal ve görsel çözümleri belirler, statik mühendisi binanın taşıyıcı sistemleri üzerinde çalışır, diğer mühendisler ise belirli teknik bölümlerden sorumludur.',
    'يشارك في إنشاء المبنى متخصصون مختلفون. يحدد المعماري الحلول المكانية والبصرية، ويعمل المهندس الإنشائي على الأنظمة الحاملة للمبنى، بينما يتولى مهندسون آخرون مسؤولية أجزاء تقنية محددة.',
    'ביצירת בניין משתתפים אנשי מקצוע שונים. האדריכל קובע את הפתרונות המרחביים והחזותיים, מהנדס הקונסטרוקציה עובד על המערכות הנושאות של הבניין, ומהנדסים אחרים אחראים לחלקים טכניים מסוימים.',
  ],
  verify_v6_people_intro_2: [
    'We gathered information about the people whose participation is confirmed in official documents.',
    'ჩვენ შევაგროვეთ იმ ადამიანების შესახებ ინფორმაცია, რომელთა მონაწილეობაც ოფიციალურ დოკუმენტებში დასტურდება.',
    'Мы собрали сведения о людях, участие которых подтверждается официальными документами.',
    'Katılımı resmî belgelerle doğrulanan kişiler hakkındaki bilgileri bir araya getirdik.',
    'جمعنا معلومات عن الأشخاص الذين تؤكد الوثائق الرسمية مشاركتهم.',
    'אספנו מידע על האנשים שהשתתפותם מאומתת במסמכים רשמיים.',
  ],
  verify_v6_people_intro_3: [
    'Each entry shows what work the name is connected to and which document confirms it. This does not mean that all of them still work on the project today.',
    'თითოეულთან მითითებულია, რა სამუშაოსთან არის დაკავშირებული მისი სახელი და რომელი დოკუმენტი ადასტურებს ამას. ეს არ ნიშნავს, რომ ყველა მათგანი დღესაც პროექტზე მუშაობს.',
    'Для каждого указано, с какой работой связано его имя и какой документ это подтверждает. Это не означает, что все они и сегодня работают над проектом.',
    'Her kişi için adının hangi işle bağlantılı olduğu ve bunu hangi belgenin doğruladığı belirtilmiştir. Bu, hepsinin bugün de projede çalıştığı anlamına gelmez.',
    'يُذكر لكل شخص العمل المرتبط باسمه والوثيقة التي تؤكد ذلك. ولا يعني هذا أن جميعهم ما زالوا يعملون على المشروع اليوم.',
    'לצד כל אחד מצוין לאיזו עבודה שמו קשור ואיזה מסמך מאשר זאת. אין פירוש הדבר שכולם עדיין עובדים על הפרויקט כיום.',
  ],
  verify_v6_team_stage_current: ['Latest project stage', 'ბოლო საპროექტო ეტაპი', 'Последний этап проекта', 'Projenin son aşaması', 'أحدث مرحلة في المشروع', 'השלב האחרון של הפרויקט'],
  verify_v6_team_stage_earlier: ['Earlier stage · {{span}}', 'ადრინდელი ეტაპი · {{span}}', 'Более ранний этап · {{span}}', 'Önceki aşama · {{span}}', 'مرحلة سابقة · {{span}}', 'שלב מוקדם יותר · {{span}}'],
};
