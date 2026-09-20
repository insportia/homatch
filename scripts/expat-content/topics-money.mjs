// FOR EXPATS content — what things cost, and what buying involves.
//
// The cost-of-living topic is unusual: most of what it would like to say is
// not here, because the prices are not ours to state. Georgia's statistics
// office sells its average retail price series rather than publishing it,
// and buying a dataset is an owner's decision, not a developer's. So the
// budget tool ships with the handful of prices that ARE published — a
// transport pass, an electricity tariff — and says plainly how many
// categories it cannot yet fill.
//
// That is the right way round. A budget built from four sourced numbers and
// eleven honest gaps is usable; a budget built from fifteen plausible
// numbers is a number somebody will move country on.

export const MONEY_TOPICS = [
  {
    slug: 'cost-of-living',
    domain: 'COST_OF_LIVING',
    pathway: 'LIVE',
    factClass: 'PRICE',
    register: 'HOMATCH_ANALYSIS',
    sortOrder: 10,
    content: {
      en: {
        title: 'What a month in Georgia costs',
        summary:
          'Build a monthly budget from prices that carry their source and the date they were observed. Where we have not observed a price, the category says so rather than guessing.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'How this works',
            body: 'Pick a city and a household, and the budget fills in from observed prices. Every line shows where its number came from and when. Lines we have no observation for stay empty and are listed as gaps — they are not quietly counted as zero, because a total that looks complete and is not is worse than an obviously partial one.',
          },
          {
            kind: 'NOTES',
            heading: 'Why the answer is a range',
            body: 'Because a month is. Rent in one district is not rent in another, and two people in the same flat do not spend the same on food. Adding midpoints would give you one confident number that nobody could reproduce, so the low bounds are added into a low month and the high bounds into a high month, and you see both. A wide gap between them is information, not vagueness.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Anything you type is yours',
            body: 'Override any line with your own figure and it is used exactly as given and marked as yours. We do not average your number with ours, and we do not quietly replace it when an observation updates.',
          },
        ],
      },
      ka: {
        title: 'რა ჯდება ერთი თვე საქართველოში',
        summary:
          'ააწყვეთ თვიური ბიუჯეტი ფასებით, რომლებსაც თან ახლავს წყარო და დაკვირვების თარიღი. სადაც ფასი არ დაგვიფიქსირებია, კატეგორია ამას ამბობს და არ ცდილობს გამოცნობას.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'როგორ მუშაობს',
            body: 'აირჩიეთ ქალაქი და ოჯახის შემადგენლობა და ბიუჯეტი დაკვირვებული ფასებით შეივსება. თითოეული ხაზი აჩვენებს, საიდან და როდის მოვიდა ციფრი. ხაზები, რომლებზეც დაკვირვება არ გვაქვს, ცარიელი რჩება და ხარვეზებად ჩამოითვლება. ისინი ჩუმად ნულად არ ითვლება, რადგან ჯამი, რომელიც სრული ჩანს და არ არის, აშკარად ნაწილობრივზე უარესია.',
          },
          {
            kind: 'NOTES',
            heading: 'რატომ არის პასუხი დიაპაზონი',
            body: 'იმიტომ, რომ თვეც დიაპაზონია. ერთი უბნის ქირა მეორისა არ არის, და ერთ ბინაში მცხოვრები ორი ადამიანი საკვებზე ერთნაირად არ ხარჯავს. საშუალოების შეკრება მოგცემდათ ერთ თავდაჯერებულ ციფრს, რომლის გამეორებაც ვერავინ შეძლებდა. ამიტომ ქვედა ზღვრები ერთ იაფ თვედ იკრიბება, ზედა კი ერთ ძვირად, და ორივეს ხედავთ. მათ შორის დიდი სხვაობა ინფორმაციაა და არა ბუნდოვანება.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'რასაც თავად ჩაწერთ, თქვენია',
            body: 'ნებისმიერი ხაზი შეგიძლიათ თქვენი ციფრით შეცვალოთ. ის ზუსტად ისე გამოიყენება, როგორც ჩაწერეთ, და თქვენად მოინიშნება. ჩვენ არ ვაშუალებთ თქვენს ციფრს ჩვენთან და არც ჩუმად ვცვლით, როცა დაკვირვება განახლდება.',
          },
        ],
      },
      ru: {
        title: 'Сколько стоит месяц в Грузии',
        summary:
          'Соберите месячный бюджет из цен, у каждой из которых есть источник и дата наблюдения. Там, где цену мы не наблюдали, категория так и говорит, а не угадывает.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'Как это работает',
            body: 'Выберите город и состав семьи — бюджет заполнится наблюдёнными ценами. В каждой строке видно, откуда взялась цифра и когда. Строки, по которым наблюдений нет, остаются пустыми и перечисляются как пробелы: их не считают тихо нулём, потому что итог, который выглядит полным и таковым не является, хуже очевидно неполного.',
          },
          {
            kind: 'NOTES',
            heading: 'Почему ответ — диапазон',
            body: 'Потому что месяц и есть диапазон. Аренда в одном районе — не аренда в другом, и двое в одной квартире тратят на еду по-разному. Сложение средних дало бы одну уверенную цифру, которую никто не смог бы воспроизвести. Поэтому нижние границы складываются в дешёвый месяц, верхние — в дорогой, и вы видите оба. Большой разрыв между ними — это информация, а не расплывчатость.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Всё, что вы впишете, — ваше',
            body: 'Замените любую строку своей цифрой: она используется ровно так, как введена, и помечается как ваша. Мы не усредняем её с нашей и не подменяем тихо, когда наблюдение обновится.',
          },
        ],
      },
      tr: {
        title: 'Gürcistan\'da bir ay ne tutar',
        summary:
          'Aylık bütçenizi, her biri kaynağını ve gözlem tarihini taşıyan fiyatlardan kurun. Gözlemlemediğimiz bir fiyat varsa kalem bunu söyler, tahmin etmez.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'Nasıl çalışır',
            body: 'Bir şehir ve hane yapısı seçin; bütçe gözlemlenmiş fiyatlarla dolar. Her satır, rakamın nereden ve ne zaman geldiğini gösterir. Gözlemimiz olmayan satırlar boş kalır ve eksik olarak listelenir; sessizce sıfır sayılmazlar, çünkü tam görünen ama tam olmayan bir toplam, açıkça eksik olandan daha kötüdür.',
          },
          {
            kind: 'NOTES',
            heading: 'Cevap neden bir aralık',
            body: 'Çünkü ay da öyle. Bir semtteki kira başka semtteki kira değildir ve aynı evdeki iki kişi yemeğe aynı parayı harcamaz. Ortalamaları toplamak size kimsenin yeniden üretemeyeceği tek bir kesin rakam verirdi. Bu yüzden alt sınırlar ucuz bir ayda, üst sınırlar pahalı bir ayda toplanır ve ikisini de görürsünüz. Aralarındaki büyük fark belirsizlik değil, bilgidir.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Yazdığınız her şey sizindir',
            body: 'Herhangi bir satırı kendi rakamınızla değiştirin; tam girdiğiniz gibi kullanılır ve size ait olarak işaretlenir. Sizin rakamınızı bizimkiyle ortalamayız ve bir gözlem güncellendiğinde sessizce değiştirmeyiz.',
          },
        ],
      },
      ar: {
        title: 'كم يكلف شهر في جورجيا',
        summary:
          'ابنِ ميزانية شهرية من أسعار يحمل كل منها مصدره وتاريخ رصده. وحيث لم نرصد سعراً، يقول البند ذلك بدل أن يخمّن.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'كيف يعمل هذا',
            body: 'اختر مدينة وشكل الأسرة، فتمتلئ الميزانية بأسعار مرصودة. كل بند يبيّن من أين جاء رقمه ومتى. والبنود التي لا رصد لدينا عنها تبقى فارغة وتُدرج كثغرات، ولا تُحتسب صفراً بصمت، لأن مجموعاً يبدو كاملاً وليس كذلك أسوأ من مجموع ناقص بوضوح.',
          },
          {
            kind: 'NOTES',
            heading: 'لماذا الجواب نطاق',
            body: 'لأن الشهر نفسه نطاق. الإيجار في حيّ ليس الإيجار في آخر، وشخصان في الشقة نفسها لا ينفقان على الطعام بالقدر ذاته. جمع المتوسطات كان سيعطيك رقماً واحداً واثقاً لا يستطيع أحد إعادة إنتاجه. لذلك تُجمع الحدود الدنيا في شهر رخيص والحدود العليا في شهر غالٍ، وترى الاثنين. والفجوة الواسعة بينهما معلومة لا غموض.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'كل ما تكتبه فهو لك',
            body: 'استبدل أي بند برقمك الخاص، فيُستخدم كما أدخلته تماماً ويُوسم بأنه رقمك. نحن لا نحسب متوسطاً بين رقمك ورقمنا، ولا نستبدله بصمت عند تحديث أي رصد.',
          },
        ],
      },
      he: {
        title: 'כמה עולה חודש בגאורגיה',
        summary:
          'בנו תקציב חודשי ממחירים שכל אחד מהם נושא את מקורו ואת תאריך התצפית. במקום שלא צפינו בו מחיר, הקטגוריה אומרת זאת במקום לנחש.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'איך זה עובד',
            body: 'בחרו עיר והרכב משק בית, והתקציב יתמלא ממחירים שנצפו. כל שורה מראה מאיפה הגיע המספר ומתי. שורות שאין לנו תצפית עליהן נשארות ריקות ומופיעות כפערים — הן לא נספרות בשקט כאפס, כי סכום שנראה שלם ואינו שלם גרוע מסכום חלקי בגלוי.',
          },
          {
            kind: 'NOTES',
            heading: 'למה התשובה היא טווח',
            body: 'כי גם החודש הוא טווח. שכר דירה בשכונה אחת אינו שכר דירה באחרת, ושני אנשים באותה דירה לא מוציאים אותו דבר על אוכל. חיבור ממוצעים היה נותן מספר אחד בטוח שאיש לא יכול לשחזר. לכן הגבולות הנמוכים מצטברים לחודש זול והגבוהים לחודש יקר, ואתם רואים את שניהם. פער גדול ביניהם הוא מידע ולא עמימות.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'כל מה שתקלידו הוא שלכם',
            body: 'החליפו כל שורה במספר שלכם — הוא ישמש בדיוק כפי שהוזן ויסומן כשלכם. איננו ממצעים את המספר שלכם עם שלנו, ואיננו מחליפים אותו בשקט כשתצפית מתעדכנת.',
          },
        ],
      },
    },
    facts: [
      {
        key: 'tbilisi-transport-monthly',
        factClass: 'PRICE',
        register: 'OFFICIAL_REQUIREMENT',
        availability: 'ESTABLISHED',
        sources: ['ttcTariff'],
        value: { amount: 40, currency: 'GEL', unit: 'PER_MONTH' },
        statement: {
          en: 'A month of unlimited travel on Tbilisi public transport costs GEL 40. A single 90-minute journey costs GEL 1.',
          ka: 'თბილისის საზოგადოებრივ ტრანსპორტში თვიური შეუზღუდავი მგზავრობა 40 ლარი ღირს. ერთი 90-წუთიანი მგზავრობა 1 ლარია.',
          ru: 'Месяц безлимитных поездок в общественном транспорте Тбилиси стоит 40 лари. Одна поездка на 90 минут — 1 лари.',
          tr: 'Tiflis toplu taşımasında bir aylık sınırsız seyahat 40 lari tutar. Tek bir 90 dakikalık yolculuk 1 laridir.',
          ar: 'شهر من التنقل غير المحدود في نقل تبليسي العام يكلف 40 لاري. والرحلة الواحدة لمدة 90 دقيقة تكلف 1 لاري.',
          he: 'חודש נסיעות ללא הגבלה בתחבורה הציבורית בטביליסי עולה 40 לארי. נסיעה בודדת של 90 דקות עולה 1 לארי.',
        },
      },
      {
        key: 'tbilisi-electricity-tariff',
        factClass: 'PRICE',
        register: 'PRACTICAL_CONTEXT',
        availability: 'ESTABLISHED',
        sources: ['electricityTariff'],
        value: { bands: [[0, 101, 0.20041], [101, 301, 0.24053], [301, null, 0.28537]], currency: 'GEL', unit: 'PER_ITEM' },
        statement: {
          en: 'Tbilisi household electricity, effective April 2026: 20.041 tetri per kWh up to 101 kWh a month, 24.053 from 101 to 301, and 28.537 above that. Reported from the regulator\'s decision rather than read on the regulator\'s own site.',
          ka: 'თბილისის საყოფაცხოვრებო ელექტროენერგია, 2026 წლის აპრილიდან: 20.041 თეთრი კვტსთ-ზე თვეში 101 კვტსთ-მდე, 24.053 — 101-დან 301-მდე, 28.537 — ზემოთ. მოყვანილია მარეგულირებლის გადაწყვეტილების შესახებ ცნობიდან და არა თავად მარეგულირებლის საიტიდან.',
          ru: 'Электроэнергия для домохозяйств Тбилиси, с апреля 2026 года: 20,041 тетри за кВт·ч до 101 кВт·ч в месяц, 24,053 — от 101 до 301, 28,537 — свыше. Приводится по сообщению о решении регулятора, а не с сайта самого регулятора.',
          tr: 'Tiflis konut elektriği, Nisan 2026\'dan itibaren: ayda 101 kWh\'ye kadar kWh başına 20,041 tetri, 101–301 arası 24,053, üzeri 28,537. Düzenleyicinin kendi sitesinden değil, kararına ilişkin habere dayanılarak aktarılmıştır.',
          ar: 'كهرباء المنازل في تبليسي، اعتباراً من أبريل 2026: 20.041 تتري لكل كيلوواط ساعة حتى 101 كيلوواط ساعة شهرياً، و24.053 من 101 إلى 301، و28.537 لما فوق. منقول عن خبر بقرار الجهة المنظِّمة لا عن موقعها.',
          he: 'חשמל ביתי בטביליסי, החל מאפריל 2026: 20.041 טטרי לקוט"ש עד 101 קוט"ש בחודש, 24.053 בין 101 ל־301, ו־28.537 מעבר לכך. מדווח מתוך ההחלטה של הרגולטור ולא נקרא באתר הרגולטור עצמו.',
        },
      },
    ],
  },

  {
    slug: 'buying-property',
    domain: 'PROPERTY',
    pathway: 'BUY',
    factClass: 'PROCESS',
    register: 'PRACTICAL_CONTEXT',
    sortOrder: 10,
    content: {
      en: {
        title: 'Buying property in Georgia as a foreigner',
        summary:
          'Foreigners buy apartments here routinely. What separates a good purchase from a bad one is almost never the price — it is what you knew about the building, the seller and the title before you signed.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'The short answer',
            body: 'Residential property is registered at the National Agency of Public Registry, and a transfer is completed there. The paperwork itself is fast by international standards. The work worth doing is all before that: confirming who owns it, what is registered against it, whether the building is what it appears to be, and whether the price matches the market.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'What to establish before you commit',
            body: 'Ownership and any encumbrance on the title. The developer\'s record if it is a new build. The observed price per square metre for that location, so you can tell whether the asking price is ordinary. The contract terms, particularly on payment schedule and handover. Homatch does the first three as separate products and they are linked from this page.',
          },
          {
            kind: 'NOTES',
            heading: 'A caution about land',
            body: 'Apartments and buildings are one thing; agricultural land is a separate question with its own history of restrictions on foreign ownership. If your interest is land rather than a flat, take advice specific to the plot and the current rule, and do not assume the apartment answer applies.',
          },
        ],
      },
      ka: {
        title: 'უძრავი ქონების ყიდვა საქართველოში უცხოელისთვის',
        summary:
          'უცხოელები აქ ბინებს რეგულარულად ყიდულობენ. კარგ და ცუდ გარიგებას შორის სხვაობას თითქმის არასდროს ფასი ქმნის. სხვაობას ქმნის ის, რაც ხელმოწერამდე იცოდით შენობაზე, გამყიდველსა და საკუთრების უფლებაზე.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'მოკლე პასუხი',
            body: 'საცხოვრებელი ქონება საჯარო რეესტრის ეროვნულ სააგენტოში რეგისტრირდება და გადაფორმებაც იქ სრულდება. თავად ქაღალდები საერთაშორისო სტანდარტით სწრაფად კეთდება. ნამდვილი სამუშაო ამის წინაა: ვის ეკუთვნის, რა არის რეგისტრირებული ქონებაზე, არის თუ არა შენობა ის, რაც ჩანს, და შეესაბამება თუ არა ფასი ბაზარს.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'რა უნდა დაადასტუროთ ვალდებულების აღებამდე',
            body: 'საკუთრება და ნებისმიერი ყადაღა თუ დატვირთვა. დეველოპერის ისტორია, თუ ახალი მშენებლობაა. ამ ლოკაციის დაკვირვებული ფასი კვადრატულ მეტრზე, რომ გაიგოთ, ჩვეულებრივია თუ არა მოთხოვნილი თანხა. ხელშეკრულების პირობები, განსაკუთრებით გადახდის გრაფიკი და ჩაბარება. პირველ სამს Homatch ცალკე პროდუქტებად აკეთებს და ისინი აქედან მისაწვდომია.',
          },
          {
            kind: 'NOTES',
            heading: 'გაფრთხილება მიწაზე',
            body: 'ბინები და შენობები ერთია, სასოფლო-სამეურნეო მიწა კი ცალკე საკითხია, უცხოელის მფლობელობაზე შეზღუდვების საკუთარი ისტორიით. თუ მიწა გაინტერესებთ და არა ბინა, აიღეთ კონკრეტულ ნაკვეთსა და მოქმედ წესზე მორგებული რჩევა და ნუ ჩათვლით, რომ ბინის პასუხი აქაც მოქმედებს.',
          },
        ],
      },
      ru: {
        title: 'Покупка недвижимости в Грузии иностранцем',
        summary:
          'Иностранцы покупают здесь квартиры регулярно. Хорошую сделку от плохой почти никогда не отличает цена — её отличает то, что вы знали о здании, продавце и праве собственности до подписания.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'Коротко',
            body: 'Жилая недвижимость регистрируется в Национальном агентстве публичного реестра, там же оформляется переход права. Сами бумаги по международным меркам делаются быстро. Вся работа, которую стоит делать, — до этого: кто владеет, что зарегистрировано в отношении объекта, является ли здание тем, чем кажется, и соответствует ли цена рынку.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Что установить до обязательств',
            body: 'Собственность и любые обременения. Историю застройщика, если это новостройка. Наблюдаемую цену за квадратный метр в этой локации, чтобы понять, обычна ли запрошенная сумма. Условия договора, особенно график платежей и передачу объекта. Первые три Homatch делает отдельными продуктами, и они доступны с этой страницы.',
          },
          {
            kind: 'NOTES',
            heading: 'Предостережение о земле',
            body: 'Квартиры и здания — одно, сельскохозяйственная земля — отдельный вопрос со своей историей ограничений для иностранцев. Если вас интересует земля, а не квартира, получите консультацию по конкретному участку и действующему правилу и не считайте, что ответ про квартиру подходит.',
          },
        ],
      },
      tr: {
        title: 'Yabancı olarak Gürcistan\'da gayrimenkul almak',
        summary:
          'Yabancılar burada rutin olarak daire alıyor. İyi bir alımı kötüsünden ayıran şey neredeyse hiçbir zaman fiyat değildir; imzadan önce bina, satıcı ve tapu hakkında ne bildiğinizdir.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'Kısa cevap',
            body: 'Konut, Ulusal Kamu Sicil Ajansı\'nda kayıtlıdır ve devir de orada tamamlanır. Evrak işi uluslararası ölçülere göre hızlıdır. Yapılmaya değer iş bunun öncesindedir: kime ait olduğu, üzerinde ne kayıtlı olduğu, binanın göründüğü şey olup olmadığı ve fiyatın piyasaya uyup uymadığı.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Bağlanmadan önce netleştirilecekler',
            body: 'Mülkiyet ve tapu üzerindeki her türlü takyidat. Yeni yapıysa müteahhidin geçmişi. O konum için gözlemlenmiş metrekare fiyatı, böylece istenen bedelin olağan olup olmadığını anlarsınız. Sözleşme şartları, özellikle ödeme planı ve teslim. İlk üçünü Homatch ayrı ürünler olarak yapıyor ve bu sayfadan bağlantılıdır.',
          },
          {
            kind: 'NOTES',
            heading: 'Arazi konusunda bir uyarı',
            body: 'Daire ve bina başka, tarım arazisi ise yabancı mülkiyetine dair kendi kısıtlama geçmişi olan ayrı bir konudur. İlginiz daire değil arazi ise, ilgili parsele ve yürürlükteki kurala özgü danışmanlık alın; daire için geçerli cevabın burada da geçtiğini varsaymayın.',
          },
        ],
      },
      ar: {
        title: 'شراء عقار في جورجيا بصفتك أجنبياً',
        summary:
          'يشتري الأجانب الشقق هنا بشكل اعتيادي. وما يفرّق بين صفقة جيدة وأخرى سيئة لا يكاد يكون السعر، بل ما عرفته عن المبنى والبائع وسند الملكية قبل أن توقّع.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'الجواب باختصار',
            body: 'تُسجَّل العقارات السكنية لدى الوكالة الوطنية للسجل العام، وهناك يُستكمل نقل الملكية. والمعاملة الورقية نفسها سريعة بالمقاييس الدولية. أما العمل الذي يستحق الجهد فكله قبل ذلك: من المالك، وما المسجَّل على العقار، وهل المبنى كما يبدو، وهل السعر يوافق السوق.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'ما ينبغي التثبت منه قبل الالتزام',
            body: 'الملكية وأي رهن أو قيد على السند. سجل المطوِّر إن كان البناء جديداً. السعر المرصود للمتر المربع في ذلك الموقع، لتعرف إن كان المطلوب اعتيادياً. وشروط العقد، وبخاصة جدول الدفع والتسليم. الثلاثة الأولى تقدّمها Homatch كمنتجات مستقلة، وهي موصولة من هذه الصفحة.',
          },
          {
            kind: 'NOTES',
            heading: 'تنبيه بشأن الأراضي',
            body: 'الشقق والمباني شيء، والأراضي الزراعية مسألة منفصلة لها تاريخها الخاص من القيود على تملّك الأجانب. فإن كان اهتمامك أرضاً لا شقة، فاطلب مشورة خاصة بتلك القطعة وبالقاعدة النافذة، ولا تفترض أن جواب الشقة ينطبق.',
          },
        ],
      },
      he: {
        title: 'רכישת נכס בגאורגיה כזר',
        summary:
          'זרים קונים כאן דירות באופן שגרתי. מה שמבדיל עסקה טובה מרעה כמעט אף פעם אינו המחיר — אלא מה ידעתם על הבניין, על המוכר ועל הבעלות לפני שחתמתם.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'התשובה הקצרה',
            body: 'נכסי מגורים רשומים בסוכנות הלאומית לרישום המקרקעין, ושם גם מושלמת ההעברה. הניירת עצמה מהירה במונחים בינלאומיים. כל העבודה שכדאי לעשות היא לפני כן: מי הבעלים, מה רשום על הנכס, האם הבניין הוא מה שהוא נראה, והאם המחיר תואם את השוק.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'מה לברר לפני שמתחייבים',
            body: 'בעלות וכל שעבוד או עיקול. עברו של היזם אם מדובר בבנייה חדשה. המחיר שנצפה למטר רבוע באותו מיקום, כדי לדעת אם המחיר המבוקש רגיל. תנאי החוזה, ובעיקר לוח התשלומים והמסירה. את שלושת הראשונים Homatch עושה כמוצרים נפרדים, והם מקושרים מהעמוד הזה.',
          },
          {
            kind: 'NOTES',
            heading: 'אזהרה בעניין קרקע',
            body: 'דירות ובניינים הם דבר אחד; קרקע חקלאית היא שאלה נפרדת עם היסטוריה משלה של הגבלות על בעלות זרה. אם מה שמעניין אתכם הוא קרקע ולא דירה, קבלו ייעוץ ספציפי לחלקה ולכלל התקף, ואל תניחו שהתשובה לגבי דירה חלה גם כאן.',
          },
        ],
      },
    },
    facts: [],
  },
];
