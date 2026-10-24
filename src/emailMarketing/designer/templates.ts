// EMAIL DESIGNER — the built-in template library. Owner brief §7 and the UX pass §5.
//
// Ten templates, each its OWN composition — not one layout in ten colours. They differ in
// structure (hero image vs. colour banner vs. letter), type (serif display, geometric sans,
// plain letter), rhythm (airy luxury spacing vs. dense newsletter), image treatment (full-bleed,
// rounded inset, gallery, side card, none) and CTA style (square outline, pill, full-width, text
// link). Every template is a designer document, so everything is editable block by block.
//
// Copy NEVER invents a fact: anything the sender must supply is a visible [placeholder] in square
// brackets, and the Campaign Risk Engine refuses to pass an email that still contains one
// (TEMPLATE_PLACEHOLDER). Images start empty — no stock photo is passed off as the sender's
// property — and render nothing until the sender uploads one. No template names HOMATCH as the
// sender's brand. Copy ships in all six languages.

import { type Block, type BlockType, createBlock, DEFAULT_THEME, DOC_VERSION, type EmailDoc, type Theme } from './document.ts';

export type TemplateKind =
  | 'LUXURY' | 'LAUNCH' | 'CORPORATE' | 'VIP' | 'EVENT' | 'NEWSLETTER' | 'PRODUCT' | 'PROMO' | 'FOLLOW_UP' | 'PERSONAL';
export const TEMPLATE_KINDS: TemplateKind[] = ['LUXURY', 'LAUNCH', 'CORPORATE', 'VIP', 'EVENT', 'NEWSLETTER', 'PRODUCT', 'PROMO', 'FOLLOW_UP', 'PERSONAL'];

type Lang = 'en' | 'ka' | 'ru' | 'tr' | 'ar' | 'he';
const LANGS: Lang[] = ['en', 'ka', 'ru', 'tr', 'ar', 'he'];
type Copy = Record<string, string>;

/* ── copy ─────────────────────────────────────────────────────────────────────────────────── */
const C: Record<TemplateKind, Record<Lang, Copy>> = {
  LUXURY: {
    en: { subject: '[Residence name] — a private presentation', brand: '[YOUR AGENCY]', title: '[Residence name]', place: '[District, city] · [one defining detail]', f1: 'PRICE', v1: '[price]', f2: 'AREA', v2: '[size] m²', f3: 'BEDROOMS', v3: '[number]', body: 'Dear {{first_name|there}},\n\nWe would like to present [residence name], [two sentences on what makes it exceptional: the view, the architecture, the setting].\n\nViewings are by appointment only.', cta: 'Arrange a private viewing', note: 'Details are provided by the owner and may change.' },
    ka: { subject: '[რეზიდენციის სახელი] — პირადი პრეზენტაცია', brand: '[თქვენი სააგენტო]', title: '[რეზიდენციის სახელი]', place: '[უბანი, ქალაქი] · [ერთი გამორჩეული დეტალი]', f1: 'ფასი', v1: '[ფასი]', f2: 'ფართი', v2: '[ფართი] მ²', f3: 'საძინებელი', v3: '[რაოდენობა]', body: 'გამარჯობა, {{first_name|}}!\n\nწარმოგიდგენთ [რეზიდენციის სახელი]-ს — [ორი წინადადება იმაზე, რაც მას გამორჩეულს ხდის: ხედი, არქიტექტურა, გარემო].\n\nდათვალიერება მხოლოდ წინასწარი ჩაწერით.', cta: 'პირადი დათვალიერების დაგეგმვა', note: 'ინფორმაცია მოწოდებულია მესაკუთრის მიერ და შეიძლება შეიცვალოს.' },
    ru: { subject: '[Название резиденции] — частная презентация', brand: '[ВАШЕ АГЕНТСТВО]', title: '[Название резиденции]', place: '[Район, город] · [одна главная деталь]', f1: 'ЦЕНА', v1: '[цена]', f2: 'ПЛОЩАДЬ', v2: '[площадь] м²', f3: 'СПАЛЬНИ', v3: '[количество]', body: 'Здравствуйте, {{first_name|}}!\n\nПредставляем [название резиденции] — [два предложения о том, чем она исключительна: вид, архитектура, окружение].\n\nПросмотры — только по предварительной записи.', cta: 'Назначить частный просмотр', note: 'Сведения предоставлены владельцем и могут измениться.' },
    tr: { subject: '[Rezidans adı] — özel tanıtım', brand: '[AJANSINIZ]', title: '[Rezidans adı]', place: '[Semt, şehir] · [öne çıkan bir ayrıntı]', f1: 'FİYAT', v1: '[fiyat]', f2: 'ALAN', v2: '[alan] m²', f3: 'YATAK ODASI', v3: '[sayı]', body: 'Merhaba {{first_name|}},\n\n[Rezidans adı]’nı sunmaktan memnuniyet duyarız: [onu özel kılan iki cümle: manzara, mimari, çevre].\n\nGörüşmeler yalnızca randevu ile yapılır.', cta: 'Özel görüşme ayarlayın', note: 'Bilgiler mülk sahibi tarafından sağlanmıştır ve değişebilir.' },
    ar: { subject: '[اسم المسكن] — عرض خاص', brand: '[وكالتك]', title: '[اسم المسكن]', place: '[الحي، المدينة] · [ميزة مميزة واحدة]', f1: 'السعر', v1: '[السعر]', f2: 'المساحة', v2: '[المساحة] م²', f3: 'غرف النوم', v3: '[العدد]', body: 'مرحبًا {{first_name|}}،\n\nيسعدنا أن نقدّم لكم [اسم المسكن]، [جملتان عمّا يجعله استثنائيًا: الإطلالة، العمارة، المحيط].\n\nالمعاينة بموعد مسبق فقط.', cta: 'حجز معاينة خاصة', note: 'المعلومات مقدّمة من المالك وقد تتغيّر.' },
    he: { subject: '[שם הנכס] — הצגה פרטית', brand: '[הסוכנות שלכם]', title: '[שם הנכס]', place: '[שכונה, עיר] · [פרט מאפיין אחד]', f1: 'מחיר', v1: '[מחיר]', f2: 'שטח', v2: '[שטח] מ״ר', f3: 'חדרי שינה', v3: '[מספר]', body: 'שלום {{first_name|}},\n\nאנו שמחים להציג את [שם הנכס], [שני משפטים על מה שהופך אותו לייחודי: הנוף, האדריכלות, הסביבה].\n\nהצפייה בתיאום מראש בלבד.', cta: 'תיאום צפייה פרטית', note: 'הפרטים נמסרו על ידי הבעלים ועשויים להשתנות.' },
  },
  LAUNCH: {
    en: { subject: 'Now selling: [project name]', eyebrow: 'NOW SELLING', title: '[Project name]', sub: '[One sentence: what it is, where, and who it is for.]', cta: 'See the residences', f1: 'Price from', v1: '[price]', f2: 'Completion', v2: '[date]', f3: 'Residences', v3: '[number]', f4: 'Location', v4: '[district]', planT: 'Floor plans', plan: '[Unit types and sizes on offer.]', planCta: 'View floor plans', locT: 'The location', loc: '[What is nearby: transport, schools, parks.]', payT: 'Payment plan', pay: '[Deposit and instalment terms, as offered.]', cta2: 'Register your interest', note: 'Prices and availability as of [date]; they may change.' },
    ka: { subject: 'გაყიდვები დაიწყო: [პროექტის სახელი]', eyebrow: 'გაყიდვები დაიწყო', title: '[პროექტის სახელი]', sub: '[ერთი წინადადება: რა არის, სად და ვისთვის.]', cta: 'ბინების ნახვა', f1: 'ფასი', v1: '[ფასი]-დან', f2: 'დასრულება', v2: '[თარიღი]', f3: 'ბინები', v3: '[რაოდენობა]', f4: 'მდებარეობა', v4: '[უბანი]', planT: 'გეგმარებები', plan: '[ბინების ტიპები და ფართები.]', planCta: 'გეგმარებების ნახვა', locT: 'მდებარეობა', loc: '[რა არის ახლოს: ტრანსპორტი, სკოლები, პარკები.]', payT: 'გადახდის გეგმა', pay: '[შენატანისა და განვადების პირობები.]', cta2: 'დაინტერესების დაფიქსირება', note: 'ფასები და ხელმისაწვდომობა [თარიღი]-ის მდგომარეობით; შეიძლება შეიცვალოს.' },
    ru: { subject: 'Старт продаж: [название проекта]', eyebrow: 'СТАРТ ПРОДАЖ', title: '[Название проекта]', sub: '[Одно предложение: что это, где и для кого.]', cta: 'Смотреть квартиры', f1: 'Цена от', v1: '[цена]', f2: 'Сдача', v2: '[дата]', f3: 'Квартир', v3: '[количество]', f4: 'Район', v4: '[район]', planT: 'Планировки', plan: '[Типы и площади квартир.]', planCta: 'Смотреть планировки', locT: 'Расположение', loc: '[Что рядом: транспорт, школы, парки.]', payT: 'Условия оплаты', pay: '[Первый взнос и рассрочка, как предлагаются.]', cta2: 'Оставить заявку', note: 'Цены и наличие на [дата]; могут измениться.' },
    tr: { subject: 'Satışta: [proje adı]', eyebrow: 'SATIŞTA', title: '[Proje adı]', sub: '[Tek cümle: ne olduğu, nerede ve kimin için.]', cta: 'Daireleri görün', f1: 'Başlangıç fiyatı', v1: '[fiyat]', f2: 'Teslim', v2: '[tarih]', f3: 'Daire', v3: '[sayı]', f4: 'Konum', v4: '[semt]', planT: 'Kat planları', plan: '[Sunulan daire tipleri ve büyüklükleri.]', planCta: 'Kat planlarını görün', locT: 'Konum', loc: '[Yakında neler var: ulaşım, okullar, parklar.]', payT: 'Ödeme planı', pay: '[Peşinat ve taksit koşulları.]', cta2: 'İlginizi bildirin', note: 'Fiyatlar ve müsaitlik [tarih] itibarıyladır; değişebilir.' },
    ar: { subject: 'بدء البيع: [اسم المشروع]', eyebrow: 'بدء البيع', title: '[اسم المشروع]', sub: '[جملة واحدة: ما هو، وأين، ولمن.]', cta: 'استعراض الوحدات', f1: 'السعر ابتداءً من', v1: '[السعر]', f2: 'التسليم', v2: '[التاريخ]', f3: 'الوحدات', v3: '[العدد]', f4: 'الموقع', v4: '[الحي]', planT: 'المخططات', plan: '[أنواع الوحدات ومساحاتها.]', planCta: 'عرض المخططات', locT: 'الموقع', loc: '[ما القريب: المواصلات، المدارس، الحدائق.]', payT: 'خطة الدفع', pay: '[شروط الدفعة الأولى والأقساط.]', cta2: 'سجّل اهتمامك', note: 'الأسعار والتوافر حتى [التاريخ]، وقد تتغيّر.' },
    he: { subject: 'יוצאים למכירה: [שם הפרויקט]', eyebrow: 'במכירה עכשיו', title: '[שם הפרויקט]', sub: '[משפט אחד: מה זה, איפה ולמי.]', cta: 'לצפייה בדירות', f1: 'מחיר החל מ־', v1: '[מחיר]', f2: 'אכלוס', v2: '[תאריך]', f3: 'דירות', v3: '[מספר]', f4: 'מיקום', v4: '[שכונה]', planT: 'תוכניות דירה', plan: '[סוגי הדירות וגדליהן.]', planCta: 'לתוכניות הדירה', locT: 'המיקום', loc: '[מה בסביבה: תחבורה, בתי ספר, פארקים.]', payT: 'תנאי תשלום', pay: '[מקדמה ותשלומים, כפי שמוצעים.]', cta2: 'השאירו פרטים', note: 'מחירים וזמינות נכון ל־[תאריך]; עשויים להשתנות.' },
  },
  CORPORATE: {
    en: { subject: 'An introduction from [your company]', brand: '[Your company]', tagline: '[What you do, in five words]', title: 'Hello {{first_name|there}}, an introduction from [your company]', body: 'My name is [your name], [your role] at [your company]. We work with [who you help] on [what you do] in [where].\n\nI am writing because [one honest reason this is relevant to the reader].', f1: 'Years in the market', v1: '[number]', f2: 'Clients served', v2: '[number]', f3: 'Cities', v3: '[number]', helpT: 'How we can help', h1: '[First service]', h2: '[Second service]', h3: '[Third service]', cta: 'Schedule a 15-minute call' },
    ka: { subject: 'გაცნობა [თქვენი კომპანია]-სგან', brand: '[თქვენი კომპანია]', tagline: '[რას აკეთებთ, ხუთი სიტყვით]', title: 'გამარჯობა, {{first_name|}}! გაცნობა [თქვენი კომპანია]-სგან', body: 'მე ვარ [თქვენი სახელი], [თანამდებობა] [თქვენი კომპანია]-ში. ვთანამშრომლობთ [ვისთან] [რა მიმართულებით] [სად].\n\nგწერთ, რადგან [ერთი გულწრფელი მიზეზი, რატომ არის ეს თქვენთვის აქტუალური].', f1: 'წელი ბაზარზე', v1: '[რაოდენობა]', f2: 'მომსახურებული კლიენტი', v2: '[რაოდენობა]', f3: 'ქალაქი', v3: '[რაოდენობა]', helpT: 'როგორ შეგვიძლია დაგეხმაროთ', h1: '[პირველი მომსახურება]', h2: '[მეორე მომსახურება]', h3: '[მესამე მომსახურება]', cta: '15-წუთიანი ზარის დაგეგმვა' },
    ru: { subject: 'Знакомство от [ваша компания]', brand: '[Ваша компания]', tagline: '[Чем вы занимаетесь, в пяти словах]', title: 'Здравствуйте, {{first_name|}}! Знакомство от [ваша компания]', body: 'Меня зовут [ваше имя], [должность] в [ваша компания]. Мы работаем с [кем] над [чем] в [где].\n\nПишу, потому что [одна честная причина, почему это актуально для вас].', f1: 'Лет на рынке', v1: '[число]', f2: 'Клиентов', v2: '[число]', f3: 'Городов', v3: '[число]', helpT: 'Чем мы можем помочь', h1: '[Первая услуга]', h2: '[Вторая услуга]', h3: '[Третья услуга]', cta: 'Назначить 15-минутный звонок' },
    tr: { subject: '[Şirketiniz]’den bir tanışma', brand: '[Şirketiniz]', tagline: '[Ne yaptığınız, beş kelimeyle]', title: 'Merhaba {{first_name|}}, [şirketiniz]’den bir tanışma', body: 'Adım [adınız], [şirketiniz]’de [unvanınız]. [Kime] [ne konuda] [nerede] destek veriyoruz.\n\nSize yazıyorum çünkü [bunun sizin için neden önemli olduğuna dair dürüst bir neden].', f1: 'Sektörde yıl', v1: '[sayı]', f2: 'Hizmet verilen müşteri', v2: '[sayı]', f3: 'Şehir', v3: '[sayı]', helpT: 'Nasıl yardımcı olabiliriz', h1: '[Birinci hizmet]', h2: '[İkinci hizmet]', h3: '[Üçüncü hizmet]', cta: '15 dakikalık görüşme planlayın' },
    ar: { subject: 'تعريف من [شركتك]', brand: '[شركتك]', tagline: '[ما تقدّمه، في خمس كلمات]', title: 'مرحبًا {{first_name|}}، تعريف من [شركتك]', body: 'اسمي [اسمك]، [منصبك] في [شركتك]. نعمل مع [من تخدمهم] في [مجال عملك] في [المكان].\n\nأكتب إليك لأن [سبب صادق واحد يجعل هذا مهمًا لك].', f1: 'سنوات في السوق', v1: '[العدد]', f2: 'عملاء خدمناهم', v2: '[العدد]', f3: 'مدن', v3: '[العدد]', helpT: 'كيف يمكننا المساعدة', h1: '[الخدمة الأولى]', h2: '[الخدمة الثانية]', h3: '[الخدمة الثالثة]', cta: 'حدّد مكالمة لمدة 15 دقيقة' },
    he: { subject: 'היכרות מ־[החברה שלכם]', brand: '[החברה שלכם]', tagline: '[מה אתם עושים, בחמש מילים]', title: 'שלום {{first_name|}}, היכרות מ־[החברה שלכם]', body: 'שמי [השם שלכם], [התפקיד] ב־[החברה שלכם]. אנו עובדים עם [מי] בתחום [מה] ב־[איפה].\n\nאני כותב/ת כי [סיבה כנה אחת לכך שזה רלוונטי עבורך].', f1: 'שנים בשוק', v1: '[מספר]', f2: 'לקוחות', v2: '[מספר]', f3: 'ערים', v3: '[מספר]', helpT: 'איך נוכל לעזור', h1: '[שירות ראשון]', h2: '[שירות שני]', h3: '[שירות שלישי]', cta: 'קביעת שיחה של 15 דקות' },
  },
  VIP: {
    en: { subject: 'A private invitation for {{first_name|you}}', brand: '[YOUR BRAND]', eyebrow: 'PRIVATE INVITATION', title: '[Occasion name]', body: 'Dear {{first_name|guest}},\n\nIt would be our pleasure to welcome you to [occasion name], an evening of [what guests will experience].', f1: 'DATE', v1: '[date and time]', f2: 'VENUE', v2: '[venue]', cta: 'Accept the invitation', note: 'Kindly reply by [RSVP date].' },
    ka: { subject: 'პირადი მოწვევა თქვენთვის, {{first_name|}}', brand: '[თქვენი ბრენდი]', eyebrow: 'პირადი მოწვევა', title: '[ღონისძიების სახელი]', body: 'პატივცემულო {{first_name|}},\n\nსიამოვნებით გიმასპინძლებთ [ღონისძიების სახელი]-ზე — საღამოზე, სადაც [რას განიცდიან სტუმრები].', f1: 'თარიღი', v1: '[თარიღი და დრო]', f2: 'ადგილი', v2: '[ადგილი]', cta: 'მოწვევის მიღება', note: 'გთხოვთ, გვიპასუხოთ [თარიღი]-მდე.' },
    ru: { subject: 'Личное приглашение для вас, {{first_name|}}', brand: '[ВАШ БРЕНД]', eyebrow: 'ЛИЧНОЕ ПРИГЛАШЕНИЕ', title: '[Название события]', body: 'Уважаемый(ая) {{first_name|}},\n\nБудем рады видеть вас на [название события] — вечере, где [что ждёт гостей].', f1: 'ДАТА', v1: '[дата и время]', f2: 'МЕСТО', v2: '[место]', cta: 'Принять приглашение', note: 'Пожалуйста, ответьте до [дата].' },
    tr: { subject: '{{first_name|Size}} özel bir davet', brand: '[MARKANIZ]', eyebrow: 'ÖZEL DAVET', title: '[Etkinlik adı]', body: 'Sayın {{first_name|}},\n\nSizi [etkinlik adı]’nda ağırlamaktan mutluluk duyarız: [konukların deneyimleyeceği şey] ile dolu bir akşam.', f1: 'TARİH', v1: '[tarih ve saat]', f2: 'MEKÂN', v2: '[mekân]', cta: 'Daveti kabul edin', note: 'Lütfen [tarih] tarihine kadar yanıt verin.' },
    ar: { subject: 'دعوة خاصة لك يا {{first_name|}}', brand: '[علامتك]', eyebrow: 'دعوة خاصة', title: '[اسم المناسبة]', body: 'عزيزي/عزيزتي {{first_name|}}،\n\nيسعدنا أن نستقبلك في [اسم المناسبة]، أمسية من [ما سيعيشه الضيوف].', f1: 'الموعد', v1: '[التاريخ والوقت]', f2: 'المكان', v2: '[المكان]', cta: 'قبول الدعوة', note: 'يرجى الرد قبل [التاريخ].' },
    he: { subject: 'הזמנה אישית עבורך, {{first_name|}}', brand: '[המותג שלכם]', eyebrow: 'הזמנה אישית', title: '[שם האירוע]', body: '{{first_name|}} היקר/ה,\n\nנשמח לארח אותך ב־[שם האירוע], ערב של [מה האורחים יחוו].', f1: 'מועד', v1: '[תאריך ושעה]', f2: 'מקום', v2: '[מקום]', cta: 'אישור הגעה', note: 'נא להשיב עד [תאריך].' },
  },
  EVENT: {
    en: { subject: 'You are invited: [event name]', eyebrow: 'YOU ARE INVITED', title: '[Event name]', sub: '[Date] · [Place]', cta: 'Reserve your place', f1: 'Date', v1: '[date]', f2: 'Time', v2: '[time]', f3: 'Place', v3: '[address]', agendaT: 'What to expect', a1: '[First item on the programme]', a2: '[Second item]', a3: '[Third item]', venueT: 'Getting there', venue: '[Directions, parking, public transport.]', note: 'Places are limited by the venue capacity.' },
    ka: { subject: 'მოწვევა: [ღონისძიების სახელი]', eyebrow: 'გეპატიჟებით', title: '[ღონისძიების სახელი]', sub: '[თარიღი] · [ადგილი]', cta: 'ადგილის დაჯავშნა', f1: 'თარიღი', v1: '[თარიღი]', f2: 'დრო', v2: '[დრო]', f3: 'ადგილი', v3: '[მისამართი]', agendaT: 'რას გთავაზობთ', a1: '[პროგრამის პირველი პუნქტი]', a2: '[მეორე პუნქტი]', a3: '[მესამე პუნქტი]', venueT: 'როგორ მოხვიდეთ', venue: '[მიმართულება, პარკინგი, საზოგადოებრივი ტრანსპორტი.]', note: 'ადგილების რაოდენობა შეზღუდულია.' },
    ru: { subject: 'Приглашение: [название мероприятия]', eyebrow: 'ВЫ ПРИГЛАШЕНЫ', title: '[Название мероприятия]', sub: '[Дата] · [Место]', cta: 'Забронировать место', f1: 'Дата', v1: '[дата]', f2: 'Время', v2: '[время]', f3: 'Место', v3: '[адрес]', agendaT: 'Программа', a1: '[Первый пункт программы]', a2: '[Второй пункт]', a3: '[Третий пункт]', venueT: 'Как добраться', venue: '[Маршрут, парковка, транспорт.]', note: 'Количество мест ограничено вместимостью зала.' },
    tr: { subject: 'Davetlisiniz: [etkinlik adı]', eyebrow: 'DAVETLİSİNİZ', title: '[Etkinlik adı]', sub: '[Tarih] · [Yer]', cta: 'Yerinizi ayırtın', f1: 'Tarih', v1: '[tarih]', f2: 'Saat', v2: '[saat]', f3: 'Yer', v3: '[adres]', agendaT: 'Program', a1: '[Programın ilk maddesi]', a2: '[İkinci madde]', a3: '[Üçüncü madde]', venueT: 'Nasıl gelinir', venue: '[Yol tarifi, otopark, toplu taşıma.]', note: 'Yer sayısı mekân kapasitesiyle sınırlıdır.' },
    ar: { subject: 'أنت مدعو: [اسم الفعالية]', eyebrow: 'أنت مدعو', title: '[اسم الفعالية]', sub: '[التاريخ] · [المكان]', cta: 'احجز مقعدك', f1: 'التاريخ', v1: '[التاريخ]', f2: 'الوقت', v2: '[الوقت]', f3: 'المكان', v3: '[العنوان]', agendaT: 'البرنامج', a1: '[البند الأول في البرنامج]', a2: '[البند الثاني]', a3: '[البند الثالث]', venueT: 'كيفية الوصول', venue: '[الاتجاهات، مواقف السيارات، المواصلات العامة.]', note: 'عدد المقاعد محدود بسعة المكان.' },
    he: { subject: 'הוזמנת: [שם האירוע]', eyebrow: 'הוזמנת', title: '[שם האירוע]', sub: '[תאריך] · [מקום]', cta: 'שמירת מקום', f1: 'תאריך', v1: '[תאריך]', f2: 'שעה', v2: '[שעה]', f3: 'מקום', v3: '[כתובת]', agendaT: 'מה בתוכנית', a1: '[פריט ראשון בתוכנית]', a2: '[פריט שני]', a3: '[פריט שלישי]', venueT: 'איך מגיעים', venue: '[הוראות הגעה, חניה, תחבורה ציבורית.]', note: 'מספר המקומות מוגבל לקיבולת המקום.' },
  },
  NEWSLETTER: {
    en: { subject: '[Newsletter name]: [this issue in a few words]', brand: '[Newsletter name]', issue: 'Issue [number] · [month year]', title: '[Lead story headline]', intro: 'Dear {{first_name|reader}},\n\n[Two sentences: what this issue covers and why it matters now.]', s1t: '[Second story title]', s1: '[Two or three sentences.]', s2t: '[Third story title]', s2: '[Two or three sentences.]', more: 'Read more', noteT: 'Market note', note: '[One short, sourced observation about the market.]', cta: 'Read the full issue' },
    ka: { subject: '[სიახლეების სახელი]: [ნომრის შინაარსი რამდენიმე სიტყვით]', brand: '[სიახლეების სახელი]', issue: 'ნომერი [ნომერი] · [თვე წელი]', title: '[მთავარი სტატიის სათაური]', intro: 'გამარჯობა, {{first_name|}}!\n\n[ორი წინადადება: რას მოიცავს ეს ნომერი და რატომ არის ახლა მნიშვნელოვანი.]', s1t: '[მეორე სტატიის სათაური]', s1: '[ორი-სამი წინადადება.]', s2t: '[მესამე სტატიის სათაური]', s2: '[ორი-სამი წინადადება.]', more: 'დაწვრილებით', noteT: 'ბაზრის შენიშვნა', note: '[ერთი მოკლე, წყაროთი დადასტურებული დაკვირვება ბაზარზე.]', cta: 'სრული ნომრის წაკითხვა' },
    ru: { subject: '[Название рассылки]: [этот выпуск в двух словах]', brand: '[Название рассылки]', issue: 'Выпуск [номер] · [месяц год]', title: '[Заголовок главной статьи]', intro: 'Здравствуйте, {{first_name|}}!\n\n[Два предложения: о чём этот выпуск и почему это важно сейчас.]', s1t: '[Заголовок второй статьи]', s1: '[Два-три предложения.]', s2t: '[Заголовок третьей статьи]', s2: '[Два-три предложения.]', more: 'Читать далее', noteT: 'Заметка о рынке', note: '[Одно короткое наблюдение о рынке со ссылкой на источник.]', cta: 'Читать весь выпуск' },
    tr: { subject: '[Bülten adı]: [bu sayı birkaç kelimeyle]', brand: '[Bülten adı]', issue: 'Sayı [numara] · [ay yıl]', title: '[Ana haber başlığı]', intro: 'Merhaba {{first_name|}},\n\n[İki cümle: bu sayının içeriği ve neden şimdi önemli olduğu.]', s1t: '[İkinci haber başlığı]', s1: '[İki üç cümle.]', s2t: '[Üçüncü haber başlığı]', s2: '[İki üç cümle.]', more: 'Devamını okuyun', noteT: 'Piyasa notu', note: '[Piyasa hakkında kaynaklı, kısa bir gözlem.]', cta: 'Sayının tamamını okuyun' },
    ar: { subject: '[اسم النشرة]: [هذا العدد في كلمات]', brand: '[اسم النشرة]', issue: 'العدد [الرقم] · [الشهر والسنة]', title: '[عنوان القصة الرئيسية]', intro: 'مرحبًا {{first_name|}}،\n\n[جملتان: ما الذي يتناوله هذا العدد ولماذا يهمّ الآن.]', s1t: '[عنوان القصة الثانية]', s1: '[جملتان أو ثلاث.]', s2t: '[عنوان القصة الثالثة]', s2: '[جملتان أو ثلاث.]', more: 'اقرأ المزيد', noteT: 'ملاحظة عن السوق', note: '[ملاحظة قصيرة موثّقة المصدر عن السوق.]', cta: 'اقرأ العدد كاملًا' },
    he: { subject: '[שם הניוזלטר]: [הגיליון הזה בכמה מילים]', brand: '[שם הניוזלטר]', issue: 'גיליון [מספר] · [חודש שנה]', title: '[כותרת הכתבה הראשית]', intro: 'שלום {{first_name|}},\n\n[שני משפטים: במה עוסק הגיליון ולמה זה חשוב עכשיו.]', s1t: '[כותרת הכתבה השנייה]', s1: '[שניים-שלושה משפטים.]', s2t: '[כותרת הכתבה השלישית]', s2: '[שניים-שלושה משפטים.]', more: 'להמשך קריאה', noteT: 'הערת שוק', note: '[תצפית קצרה ומבוססת מקור על השוק.]', cta: 'לגיליון המלא' },
  },
  PRODUCT: {
    en: { subject: 'Introducing [product or feature]', brand: '[Your company]', eyebrow: 'NEW', title: 'Introducing [product or feature]', body: '[One paragraph: what it is and the problem it solves for the reader.]', f1t: '[First benefit]', f1: '[One sentence.]', f2t: '[Second benefit]', f2: '[One sentence.]', listT: 'What you can do now', l1: '[First thing the reader can do]', l2: '[Second thing]', l3: '[Third thing]', cta: 'Try it now' },
    ka: { subject: 'გაიცანით [პროდუქტი ან ფუნქცია]', brand: '[თქვენი კომპანია]', eyebrow: 'ახალი', title: 'გაიცანით [პროდუქტი ან ფუნქცია]', body: '[ერთი აბზაცი: რა არის და რა პრობლემას უგვარებს მკითხველს.]', f1t: '[პირველი სარგებელი]', f1: '[ერთი წინადადება.]', f2t: '[მეორე სარგებელი]', f2: '[ერთი წინადადება.]', listT: 'რისი გაკეთება შეგიძლიათ ახლა', l1: '[პირველი შესაძლებლობა]', l2: '[მეორე]', l3: '[მესამე]', cta: 'სცადეთ ახლავე' },
    ru: { subject: 'Представляем [продукт или функцию]', brand: '[Ваша компания]', eyebrow: 'НОВОЕ', title: 'Представляем [продукт или функцию]', body: '[Один абзац: что это и какую задачу решает для читателя.]', f1t: '[Первое преимущество]', f1: '[Одно предложение.]', f2t: '[Второе преимущество]', f2: '[Одно предложение.]', listT: 'Что теперь можно сделать', l1: '[Первая возможность]', l2: '[Вторая]', l3: '[Третья]', cta: 'Попробовать' },
    tr: { subject: '[Ürün veya özellik] ile tanışın', brand: '[Şirketiniz]', eyebrow: 'YENİ', title: '[Ürün veya özellik] ile tanışın', body: '[Tek paragraf: ne olduğu ve okuyucunun hangi sorununu çözdüğü.]', f1t: '[Birinci fayda]', f1: '[Tek cümle.]', f2t: '[İkinci fayda]', f2: '[Tek cümle.]', listT: 'Artık neler yapabilirsiniz', l1: '[Birinci olanak]', l2: '[İkinci]', l3: '[Üçüncü]', cta: 'Hemen deneyin' },
    ar: { subject: 'نقدّم لكم [المنتج أو الميزة]', brand: '[شركتك]', eyebrow: 'جديد', title: 'نقدّم لكم [المنتج أو الميزة]', body: '[فقرة واحدة: ما هو والمشكلة التي يحلّها للقارئ.]', f1t: '[الفائدة الأولى]', f1: '[جملة واحدة.]', f2t: '[الفائدة الثانية]', f2: '[جملة واحدة.]', listT: 'ما يمكنك فعله الآن', l1: '[الإمكانية الأولى]', l2: '[الثانية]', l3: '[الثالثة]', cta: 'جرّبه الآن' },
    he: { subject: 'הכירו את [המוצר או הפיצ׳ר]', brand: '[החברה שלכם]', eyebrow: 'חדש', title: 'הכירו את [המוצר או הפיצ׳ר]', body: '[פסקה אחת: מה זה ואיזו בעיה זה פותר לקורא.]', f1t: '[יתרון ראשון]', f1: '[משפט אחד.]', f2t: '[יתרון שני]', f2: '[משפט אחד.]', listT: 'מה אפשר לעשות עכשיו', l1: '[אפשרות ראשונה]', l2: '[שנייה]', l3: '[שלישית]', cta: 'לנסות עכשיו' },
  },
  PROMO: {
    en: { subject: '[Offer headline]', eyebrow: 'SPECIAL OFFER', title: '[Offer headline]', sub: '[What the offer is, and who it is for.]', cta: 'See the offer', f1: 'Offer', v1: '[offer]', f2: 'Valid until', v2: '[date]', body: 'Dear {{first_name|there}},\n\n[Two sentences explaining the offer in plain words.]', cta2: 'Claim the offer', terms: 'Offer terms: [terms and conditions].' },
    ka: { subject: '[შეთავაზების სათაური]', eyebrow: 'სპეციალური შეთავაზება', title: '[შეთავაზების სათაური]', sub: '[რას გულისხმობს შეთავაზება და ვისთვისაა.]', cta: 'შეთავაზების ნახვა', f1: 'შეთავაზება', v1: '[შეთავაზება]', f2: 'მოქმედებს', v2: '[თარიღი]-მდე', body: 'გამარჯობა, {{first_name|}}!\n\n[ორი წინადადება, რომელიც მარტივად ხსნის შეთავაზებას.]', cta2: 'შეთავაზებით სარგებლობა', terms: 'შეთავაზების პირობები: [პირობები].' },
    ru: { subject: '[Заголовок предложения]', eyebrow: 'СПЕЦИАЛЬНОЕ ПРЕДЛОЖЕНИЕ', title: '[Заголовок предложения]', sub: '[В чём предложение и для кого оно.]', cta: 'Смотреть предложение', f1: 'Предложение', v1: '[предложение]', f2: 'Действует до', v2: '[дата]', body: 'Здравствуйте, {{first_name|}}!\n\n[Два предложения, простыми словами объясняющие предложение.]', cta2: 'Воспользоваться предложением', terms: 'Условия предложения: [условия].' },
    tr: { subject: '[Teklif başlığı]', eyebrow: 'ÖZEL TEKLİF', title: '[Teklif başlığı]', sub: '[Teklifin ne olduğu ve kimin için olduğu.]', cta: 'Teklifi görün', f1: 'Teklif', v1: '[teklif]', f2: 'Geçerlilik', v2: '[tarih]', body: 'Merhaba {{first_name|}},\n\n[Teklifi sade bir dille açıklayan iki cümle.]', cta2: 'Tekliften yararlanın', terms: 'Teklif koşulları: [koşullar].' },
    ar: { subject: '[عنوان العرض]', eyebrow: 'عرض خاص', title: '[عنوان العرض]', sub: '[ما هو العرض ولمن هو.]', cta: 'استعراض العرض', f1: 'العرض', v1: '[العرض]', f2: 'ساري حتى', v2: '[التاريخ]', body: 'مرحبًا {{first_name|}}،\n\n[جملتان تشرحان العرض بكلمات بسيطة.]', cta2: 'الاستفادة من العرض', terms: 'شروط العرض: [الشروط والأحكام].' },
    he: { subject: '[כותרת ההצעה]', eyebrow: 'הצעה מיוחדת', title: '[כותרת ההצעה]', sub: '[מה ההצעה ולמי היא מיועדת.]', cta: 'לפרטי ההצעה', f1: 'ההצעה', v1: '[ההצעה]', f2: 'בתוקף עד', v2: '[תאריך]', body: 'שלום {{first_name|}},\n\n[שני משפטים שמסבירים את ההצעה במילים פשוטות.]', cta2: 'למימוש ההצעה', terms: 'תנאי ההצעה: [תנאים].' },
  },
  FOLLOW_UP: {
    en: { subject: 'Following up on [topic]', body: 'Hi {{first_name|there}},\n\nThank you for your interest in [topic]. I wanted to follow up on [what you discussed or sent].', recap: '[A short recap: the property, the question they asked, or the next step you agreed.]', ask: 'Would [day or time] suit you for a short conversation? If it is no longer relevant, simply let me know and I will not follow up again.', cta: 'Pick a time', sign: 'Best regards,\n[Your name]\n[Your role], [your company]' },
    ka: { subject: 'გაგრძელება: [თემა]', body: 'გამარჯობა, {{first_name|}}!\n\nგმადლობთ [თემა]-ით დაინტერესებისთვის. მინდოდა დაგკავშირებოდით [რაზეც ვისაუბრეთ ან რაც გამოგიგზავნეთ] თაობაზე.', recap: '[მოკლე შეჯამება: ქონება, თქვენი შეკითხვა ან შეთანხმებული შემდეგი ნაბიჯი.]', ask: 'მოგიხერხდებათ მოკლე საუბარი [დღე ან დრო]? თუ აღარ არის აქტუალური, უბრალოდ შემატყობინეთ და აღარ შეგაწუხებთ.', cta: 'დროის არჩევა', sign: 'პატივისცემით,\n[თქვენი სახელი]\n[თანამდებობა], [კომპანია]' },
    ru: { subject: 'По поводу [тема]', body: 'Здравствуйте, {{first_name|}}!\n\nСпасибо за интерес к [тема]. Хотел(а) уточнить по поводу [что обсуждали или отправляли].', recap: '[Короткое резюме: объект, ваш вопрос или договорённый следующий шаг.]', ask: 'Удобно ли вам коротко поговорить [день или время]? Если это уже неактуально, просто дайте знать — больше не побеспокою.', cta: 'Выбрать время', sign: 'С уважением,\n[Ваше имя]\n[Должность], [компания]' },
    tr: { subject: '[Konu] hakkında', body: 'Merhaba {{first_name|}},\n\n[Konu] ile ilgilendiğiniz için teşekkür ederim. [Konuştuklarımız veya gönderdiklerim] hakkında dönüş yapmak istedim.', recap: '[Kısa bir özet: mülk, sorduğunuz soru veya kararlaştırdığımız sonraki adım.]', ask: '[Gün veya saat] kısa bir görüşme için uygun mu? Artık ilgilenmiyorsanız haber vermeniz yeterli, tekrar yazmayacağım.', cta: 'Bir zaman seçin', sign: 'Saygılarımla,\n[Adınız]\n[Unvanınız], [şirketiniz]' },
    ar: { subject: 'متابعة بخصوص [الموضوع]', body: 'مرحبًا {{first_name|}}،\n\nشكرًا لاهتمامك بـ[الموضوع]. أردت المتابعة بخصوص [ما ناقشناه أو أرسلته].', recap: '[ملخّص قصير: العقار، أو سؤالك، أو الخطوة التالية التي اتفقنا عليها.]', ask: 'هل يناسبك [اليوم أو الوقت] لمحادثة قصيرة؟ إن لم يعد الأمر مهمًا، أخبرني فقط ولن أتابع مجددًا.', cta: 'اختر موعدًا', sign: 'مع خالص التحية،\n[اسمك]\n[منصبك]، [شركتك]' },
    he: { subject: 'בהמשך ל־[נושא]', body: 'שלום {{first_name|}},\n\nתודה על ההתעניינות ב־[נושא]. רציתי לחזור אליך בנוגע ל־[מה שדיברנו או ששלחתי].', recap: '[סיכום קצר: הנכס, השאלה ששאלת או הצעד הבא שסיכמנו.]', ask: 'האם [יום או שעה] מתאים לשיחה קצרה? אם זה כבר לא רלוונטי, פשוט עדכן/י אותי ולא אפנה שוב.', cta: 'בחירת מועד', sign: 'בברכה,\n[השם שלכם]\n[תפקיד], [חברה]' },
  },
  PERSONAL: {
    en: { subject: 'A quick question about [topic]', body: 'Hi {{first_name|there}},\n\n[One sentence on why you are writing to this person specifically.]\n\n[One sentence with the single question or offer.]\n\nWould you be open to a short reply?', sign: 'Thank you,\n[Your name]\n[Your phone]' },
    ka: { subject: 'მოკლე შეკითხვა [თემა]-ზე', body: 'გამარჯობა, {{first_name|}}!\n\n[ერთი წინადადება იმაზე, რატომ წერთ სწორედ ამ ადამიანს.]\n\n[ერთი წინადადება ერთადერთი შეკითხვით ან შეთავაზებით.]\n\nშეძლებთ მოკლედ მიპასუხოთ?', sign: 'გმადლობთ,\n[თქვენი სახელი]\n[თქვენი ტელეფონი]' },
    ru: { subject: 'Короткий вопрос о [тема]', body: 'Здравствуйте, {{first_name|}}!\n\n[Одно предложение о том, почему вы пишете именно этому человеку.]\n\n[Одно предложение с единственным вопросом или предложением.]\n\nСможете коротко ответить?', sign: 'Спасибо,\n[Ваше имя]\n[Ваш телефон]' },
    tr: { subject: '[Konu] hakkında kısa bir soru', body: 'Merhaba {{first_name|}},\n\n[Neden özellikle bu kişiye yazdığınıza dair tek cümle.]\n\n[Tek soruyu veya teklifi içeren tek cümle.]\n\nKısa bir yanıt verebilir misiniz?', sign: 'Teşekkürler,\n[Adınız]\n[Telefonunuz]' },
    ar: { subject: 'سؤال سريع حول [الموضوع]', body: 'مرحبًا {{first_name|}}،\n\n[جملة واحدة عن سبب كتابتك لهذا الشخص تحديدًا.]\n\n[جملة واحدة تتضمّن سؤالك أو عرضك الوحيد.]\n\nهل يمكنك الرد باختصار؟', sign: 'شكرًا لك،\n[اسمك]\n[هاتفك]' },
    he: { subject: 'שאלה קצרה בנוגע ל־[נושא]', body: 'שלום {{first_name|}},\n\n[משפט אחד על הסיבה שאתם כותבים דווקא לאדם הזה.]\n\n[משפט אחד עם השאלה או ההצעה היחידה.]\n\nאשמח לתשובה קצרה.', sign: 'תודה,\n[השם שלכם]\n[הטלפון שלכם]' },
  },
};

/* ── themes: each template has its own palette and type ───────────────────────────────────── */
const THEMES: Record<TemplateKind, Theme> = {
  LUXURY: { ...DEFAULT_THEME, canvas: '#ECE7DF', card: '#FFFFFF', text: '#1B1B1B', muted: '#6F675C', accent: '#B08D57', link: '#8C6A36', fontFamily: 'serif', width: 600, radius: 0 },
  LAUNCH: { ...DEFAULT_THEME, canvas: '#E9EBEF', card: '#FFFFFF', text: '#111827', muted: '#5B6472', accent: '#C9973A', link: '#8A6420', fontFamily: 'helvetica', width: 620, radius: 12 },
  CORPORATE: { ...DEFAULT_THEME, canvas: '#EEF1F5', card: '#FFFFFF', text: '#1E293B', muted: '#64748B', accent: '#1D4ED8', link: '#1D4ED8', fontFamily: 'helvetica', width: 600, radius: 6 },
  VIP: { ...DEFAULT_THEME, canvas: '#0B0B0B', card: '#151515', text: '#F4EFE6', muted: '#A9A091', accent: '#D4AF37', link: '#E2C46A', fontFamily: 'georgia', width: 580, radius: 0 },
  EVENT: { ...DEFAULT_THEME, canvas: '#FBF1E7', card: '#FFFFFF', text: '#2B2118', muted: '#7A6A5C', accent: '#E4572E', link: '#C2410C', fontFamily: 'system', width: 600, radius: 18 },
  NEWSLETTER: { ...DEFAULT_THEME, canvas: '#F1F2EE', card: '#FFFFFF', text: '#222222', muted: '#6B6B6B', accent: '#2F6B4F', link: '#2F6B4F', fontFamily: 'georgia', width: 640, radius: 4 },
  PRODUCT: { ...DEFAULT_THEME, canvas: '#F3F1FF', card: '#FFFFFF', text: '#1E1B4B', muted: '#5B5A7A', accent: '#6D28D9', link: '#6D28D9', fontFamily: 'system', width: 600, radius: 16 },
  PROMO: { ...DEFAULT_THEME, canvas: '#FFF4DE', card: '#FFFFFF', text: '#1A1A1A', muted: '#6B6255', accent: '#D97706', link: '#B45309', fontFamily: 'helvetica', width: 600, radius: 12 },
  FOLLOW_UP: { ...DEFAULT_THEME, canvas: '#F7F7F5', card: '#FFFFFF', text: '#23262B', muted: '#6B7078', accent: '#23262B', link: '#2457C5', fontFamily: 'system', width: 580, radius: 8 },
  PERSONAL: { ...DEFAULT_THEME, canvas: '#FFFFFF', card: '#FFFFFF', text: '#202124', muted: '#5F6368', accent: '#202124', link: '#1A57C9', fontFamily: 'system', width: 560, radius: 0 },
};

const YOUR_NAME: Record<Lang, string> = { en: '[Your name]', ka: '[თქვენი სახელი]', ru: '[Ваше имя]', tr: '[Adınız]', ar: '[اسمك]', he: '[השם שלכם]' };

/* ── builders ─────────────────────────────────────────────────────────────────────────────── */
const P = (t: number, r: number, b: number, l: number) => ({ t, r, b, l });
/* createBlock with overrides; the cast is safe because normalizeDoc validates every template in tests. */
const mk = (type: BlockType, o: Record<string, unknown> = {}) => ({ ...createBlock(type), ...o }) as Block;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const list = (...items: string[]) => `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;

function luxury(c: Copy, t: Theme, lang: Lang): Block[] {
  return [
    mk('header', { brand: c.brand, align: 'center', textColor: t.text, padding: P(30, 32, 26, 32) }),
    mk('image', { width: 600, radius: 0, alt: c.title, padding: P(0, 0, 0, 0) }),
    mk('heading', { text: c.title, level: 1, align: 'center', fontSize: 34, fontWeight: 400, letterSpacing: 2, padding: P(38, 40, 6, 40) }),
    mk('text', { text: c.place, align: 'center', color: t.muted, fontSize: 14, padding: P(0, 40, 18, 40) }),
    mk('divider', { color: t.accent, thickness: 1, widthPct: 18, padding: P(4, 32, 18, 32) }),
    mk('facts', { items: [{ label: c.f1, value: c.v1 }, { label: c.f2, value: c.v2 }, { label: c.f3, value: c.v3 }], columns: 3, valueColor: '#8C6A36', padding: P(4, 32, 18, 32) }),
    mk('text', { text: c.body, align: 'left', fontSize: 16, lineHeight: 1.8, padding: P(12, 48, 20, 48) }),
    mk('button', { label: c.cta, align: 'center', buttonColor: '#1B1B1B', textColor: '#FFFFFF', radius: 0, size: 'lg', fontWeight: 600, padding: P(10, 32, 30, 32) }),
    mk('columns', { ratio: '50-50', gap: 12, stackOnMobile: true, padding: P(0, 32, 18, 32), columns: [[mk('image', { width: 268, radius: 0, alt: c.title, padding: P(0, 0, 0, 0) })], [mk('image', { width: 268, radius: 0, alt: c.title, padding: P(0, 0, 0, 0) })]] }),
    mk('divider', { color: '#E7E1D6', padding: P(12, 48, 12, 48) }),
    mk('contact', { name: YOUR_NAME[lang], align: 'center', padding: P(6, 32, 6, 32) }),
    mk('footer', { text: c.note, align: 'center', padding: P(6, 32, 26, 32) }),
  ];
}

function launch(c: Copy, t: Theme): Block[] {
  return [
    mk('banner', { eyebrow: c.eyebrow, title: c.title, subtitle: c.sub, buttonLabel: c.cta, align: 'left', background: '#111827', textColor: '#FFFFFF', buttonColor: t.accent, buttonTextColor: '#111827', radius: 8, padding: P(40, 36, 40, 36) }),
    mk('facts', { items: [{ label: c.f1, value: c.v1 }, { label: c.f2, value: c.v2 }, { label: c.f3, value: c.v3 }, { label: c.f4, value: c.v4 }], columns: 4, tileColor: '#F4EFE6', valueColor: '#111827', padding: P(22, 26, 10, 26) }),
    mk('card', { title: c.planT, text: c.plan, buttonLabel: c.planCta, layout: 'side', cardColor: '#FFFFFF', radius: 12, borderWidth: 1, borderColor: '#E5E7EB', padding: P(12, 32, 12, 32) }),
    mk('columns', { ratio: '50-50', gap: 16, stackOnMobile: true, padding: P(4, 32, 4, 32), columns: [
      [mk('card', { title: c.locT, text: c.loc, cardColor: '#F8F9FB', radius: 12, borderWidth: 0, padding: P(0, 0, 0, 0) })],
      [mk('card', { title: c.payT, text: c.pay, cardColor: '#F8F9FB', radius: 12, borderWidth: 0, padding: P(0, 0, 0, 0) })],
    ] }),
    mk('button', { label: c.cta2, fullWidth: true, buttonColor: t.accent, textColor: '#111827', radius: 10, size: 'lg', padding: P(22, 32, 14, 32) }),
    mk('footer', { text: c.note, align: 'left', padding: P(4, 32, 24, 32) }),
  ];
}

function corporate(c: Copy, t: Theme, lang: Lang): Block[] {
  return [
    mk('header', { brand: c.brand, tagline: c.tagline, align: 'left', textColor: t.text, padding: P(24, 32, 20, 32), borderWidth: 0 }),
    mk('divider', { color: t.accent, thickness: 3, padding: P(0, 0, 0, 0) }),
    mk('heading', { text: c.title, level: 1, align: 'left', fontSize: 25, padding: P(30, 32, 10, 32) }),
    mk('text', { text: c.body, align: 'left', fontSize: 15, padding: P(4, 32, 18, 32) }),
    mk('facts', { items: [{ label: c.f1, value: c.v1 }, { label: c.f2, value: c.v2 }, { label: c.f3, value: c.v3 }], columns: 3, tileColor: '#F1F5F9', valueColor: t.accent, padding: P(4, 26, 14, 26) }),
    mk('heading', { text: c.helpT, level: 3, align: 'left', padding: P(14, 32, 4, 32) }),
    mk('text', { text: [c.h1, c.h2, c.h3].join('\n'), rich: list(c.h1, c.h2, c.h3), align: 'left', fontSize: 15, padding: P(0, 32, 14, 32) }),
    mk('button', { label: c.cta, align: 'left', buttonColor: t.accent, textColor: '#FFFFFF', radius: 6, size: 'md', hoverColor: '#1E40AF', padding: P(8, 32, 24, 32) }),
    mk('divider', { color: '#E2E8F0', padding: P(4, 32, 4, 32) }),
    mk('contact', { name: YOUR_NAME[lang], align: 'left', padding: P(12, 32, 24, 32) }),
  ];
}

function vip(c: Copy, t: Theme, lang: Lang): Block[] {
  return [
    mk('header', { brand: c.brand, align: 'center', textColor: t.accent, padding: P(40, 32, 8, 32) }),
    mk('divider', { color: t.accent, thickness: 1, widthPct: 14, padding: P(18, 32, 24, 32) }),
    mk('heading', { text: c.eyebrow, level: 3, align: 'center', fontSize: 13, fontWeight: 600, letterSpacing: 4, color: t.accent, padding: P(4, 32, 10, 32) }),
    mk('heading', { text: c.title, level: 1, align: 'center', fontSize: 36, fontWeight: 400, padding: P(0, 32, 22, 32) }),
    mk('text', { text: c.body, align: 'center', fontSize: 16, lineHeight: 1.8, padding: P(0, 56, 24, 56) }),
    mk('facts', { items: [{ label: c.f1, value: c.v1 }, { label: c.f2, value: c.v2 }], columns: 2, valueColor: t.text, labelColor: t.accent, padding: P(6, 48, 22, 48) }),
    mk('button', { label: c.cta, align: 'center', buttonColor: '#151515', textColor: t.accent, strokeWidth: 1, strokeColor: t.accent, radius: 0, size: 'lg', fontWeight: 600, hoverColor: '#2A2414', padding: P(8, 32, 26, 32) }),
    mk('text', { text: c.note, align: 'center', fontSize: 13, color: t.muted, padding: P(0, 32, 12, 32) }),
    mk('divider', { color: '#2C2A26', padding: P(16, 48, 16, 48) }),
    mk('contact', { name: YOUR_NAME[lang], align: 'center', padding: P(4, 32, 34, 32) }),
  ];
}

function event(c: Copy, t: Theme): Block[] {
  return [
    mk('banner', { eyebrow: c.eyebrow, title: c.title, subtitle: c.sub, buttonLabel: c.cta, align: 'center', background: t.accent, textColor: '#FFFFFF', buttonColor: '#FFFFFF', buttonTextColor: '#B4351A', radius: 24, padding: P(44, 32, 44, 32) }),
    mk('facts', { items: [{ label: c.f1, value: c.v1 }, { label: c.f2, value: c.v2 }, { label: c.f3, value: c.v3 }], columns: 3, tileColor: '#FDEBDD', valueColor: '#B4351A', padding: P(24, 26, 8, 26) }),
    mk('heading', { text: c.agendaT, level: 2, align: 'left', fontSize: 21, padding: P(18, 32, 4, 32) }),
    mk('text', { text: [c.a1, c.a2, c.a3].join('\n'), rich: list(c.a1, c.a2, c.a3), align: 'left', padding: P(0, 32, 12, 32) }),
    mk('card', { title: c.venueT, text: c.venue, layout: 'side', cardColor: '#FFF8F2', radius: 18, borderWidth: 0, padding: P(8, 32, 8, 32) }),
    mk('button', { label: c.cta, align: 'center', buttonColor: t.accent, textColor: '#FFFFFF', radius: 40, size: 'lg', hoverColor: '#C2410C', padding: P(22, 32, 14, 32) }),
    mk('footer', { text: c.note, align: 'center', padding: P(4, 32, 26, 32) }),
  ];
}

function newsletter(c: Copy, t: Theme): Block[] {
  return [
    mk('header', { brand: c.brand, tagline: c.issue, align: 'left', textColor: t.accent, padding: P(26, 36, 16, 36) }),
    mk('divider', { color: '#222222', thickness: 2, padding: P(0, 36, 0, 36) }),
    mk('heading', { text: c.title, level: 1, align: 'left', fontSize: 30, fontWeight: 700, padding: P(26, 36, 10, 36) }),
    mk('text', { text: c.intro, align: 'left', fontSize: 16, lineHeight: 1.75, padding: P(0, 36, 16, 36) }),
    mk('image', { width: 568, radius: 2, alt: c.title, padding: P(0, 36, 6, 36) }),
    mk('divider', { color: '#DADAD4', padding: P(18, 36, 14, 36) }),
    mk('columns', { ratio: '50-50', gap: 22, stackOnMobile: true, padding: P(0, 36, 6, 36), columns: [
      [mk('card', { title: c.s1t, text: c.s1, buttonLabel: c.more, cardColor: '#FFFFFF', radius: 2, borderWidth: 0, buttonColor: '#FFFFFF', buttonTextColor: t.accent, padding: P(0, 0, 0, 0) })],
      [mk('card', { title: c.s2t, text: c.s2, buttonLabel: c.more, cardColor: '#FFFFFF', radius: 2, borderWidth: 0, buttonColor: '#FFFFFF', buttonTextColor: t.accent, padding: P(0, 0, 0, 0) })],
    ] }),
    mk('heading', { text: c.noteT, level: 3, align: 'left', fontSize: 13, letterSpacing: 2, color: t.accent, background: '#EEF4F0', padding: P(18, 36, 4, 36) }),
    mk('text', { text: c.note, align: 'left', fontSize: 15, background: '#EEF4F0', padding: P(0, 36, 18, 36) }),
    mk('button', { label: c.cta, align: 'left', buttonColor: '#FFFFFF', textColor: t.accent, strokeWidth: 2, strokeColor: t.accent, radius: 2, size: 'sm', padding: P(22, 36, 12, 36) }),
    mk('social', { links: [], align: 'left', padding: P(6, 36, 6, 36) }),
    mk('spacer', { height: 16 }),
  ];
}

function product(c: Copy, t: Theme): Block[] {
  return [
    mk('header', { brand: c.brand, align: 'center', textColor: t.text, padding: P(28, 32, 8, 32) }),
    mk('heading', { text: c.eyebrow, level: 3, align: 'center', fontSize: 12, fontWeight: 800, letterSpacing: 3, color: t.accent, padding: P(18, 32, 6, 32) }),
    mk('heading', { text: c.title, level: 1, align: 'center', fontSize: 31, fontWeight: 800, padding: P(0, 40, 12, 40) }),
    mk('text', { text: c.body, align: 'center', fontSize: 16, color: t.muted, padding: P(0, 48, 22, 48) }),
    mk('image', { width: 536, radius: 14, alt: c.title, padding: P(0, 32, 18, 32) }),
    mk('columns', { ratio: '50-50', gap: 16, stackOnMobile: true, padding: P(4, 32, 6, 32), columns: [
      [mk('card', { title: c.f1t, text: c.f1, cardColor: '#F5F3FF', radius: 16, borderWidth: 0, padding: P(0, 0, 0, 0) })],
      [mk('card', { title: c.f2t, text: c.f2, cardColor: '#F5F3FF', radius: 16, borderWidth: 0, padding: P(0, 0, 0, 0) })],
    ] }),
    mk('heading', { text: c.listT, level: 3, align: 'left', padding: P(18, 40, 2, 40) }),
    mk('text', { text: [c.l1, c.l2, c.l3].join('\n'), rich: list(c.l1, c.l2, c.l3), align: 'left', padding: P(0, 40, 10, 40) }),
    mk('button', { label: c.cta, align: 'center', buttonColor: t.accent, textColor: '#FFFFFF', radius: 40, size: 'lg', hoverColor: '#5B21B6', padding: P(18, 32, 30, 32) }),
  ];
}

function promo(c: Copy, t: Theme): Block[] {
  return [
    mk('banner', { eyebrow: c.eyebrow, title: c.title, subtitle: c.sub, buttonLabel: c.cta, align: 'center', background: '#1A1A1A', textColor: '#FFFFFF', buttonColor: t.accent, buttonTextColor: '#1A1A1A', radius: 12, padding: P(46, 32, 46, 32) }),
    mk('facts', { items: [{ label: c.f1, value: c.v1 }, { label: c.f2, value: c.v2 }], columns: 2, tileColor: '#FFF4DE', valueColor: '#B45309', padding: P(24, 28, 10, 28) }),
    mk('text', { text: c.body, align: 'left', padding: P(12, 32, 16, 32) }),
    mk('button', { label: c.cta2, fullWidth: true, buttonColor: t.accent, textColor: '#1A1A1A', radius: 12, size: 'lg', hoverColor: '#B45309', padding: P(6, 32, 20, 32) }),
    mk('footer', { text: c.terms, align: 'left', padding: P(0, 32, 24, 32) }),
  ];
}

function followUp(c: Copy, t: Theme): Block[] {
  return [
    mk('text', { text: c.body, align: 'left', fontSize: 16, padding: P(36, 36, 12, 36) }),
    mk('text', { text: c.recap, align: 'left', fontSize: 15, color: '#3B4048', background: '#F3F4F2', padding: P(14, 18, 14, 18) }),
    mk('text', { text: c.ask, align: 'left', fontSize: 16, padding: P(14, 36, 10, 36) }),
    mk('button', { label: c.cta, align: 'left', buttonColor: '#FFFFFF', textColor: t.text, strokeWidth: 1, strokeColor: '#C9CDD3', radius: 8, size: 'sm', hoverColor: '#F3F4F6', padding: P(6, 36, 18, 36) }),
    mk('text', { text: c.sign, align: 'left', fontSize: 15, padding: P(4, 36, 34, 36) }),
  ];
}

function personal(c: Copy): Block[] {
  return [
    mk('text', { text: c.body, align: 'left', fontSize: 16, lineHeight: 1.7, padding: P(28, 28, 14, 28) }),
    mk('text', { text: c.sign, align: 'left', fontSize: 16, lineHeight: 1.6, padding: P(4, 28, 28, 28) }),
  ];
}

const LAYOUT: Record<TemplateKind, (c: Copy, t: Theme, lang: Lang) => Block[]> = {
  LUXURY: luxury, LAUNCH: launch, CORPORATE: corporate, VIP: vip, EVENT: event, NEWSLETTER: newsletter,
  PRODUCT: product, PROMO: promo, FOLLOW_UP: followUp, PERSONAL: (c) => personal(c),
};

const langOf = (lang: string): Lang => (LANGS.includes(lang as Lang) ? (lang as Lang) : 'en');

export function builtInTemplate(kind: TemplateKind, lang: string): EmailDoc {
  const l = langOf(lang);
  const c = C[kind][l] ?? C[kind].en;
  const theme = { ...THEMES[kind] };
  return { version: DOC_VERSION, theme, blocks: LAYOUT[kind](c, theme, l), meta: { template: kind } };
}

/** The subject a template suggests (the sender edits it). */
export function templateSubject(kind: TemplateKind, lang: string): string {
  const l = langOf(lang);
  return (C[kind][l] ?? C[kind].en).subject;
}

/** Visible [placeholders] the sender has not replaced yet (merge fields and links excluded). */
export function unfilledPlaceholders(text: string): string[] {
  return [...new Set([...String(text ?? '').matchAll(/\[([^\]\n]{2,160})\](?!\()/g)].map((m) => m[1]))];
}
