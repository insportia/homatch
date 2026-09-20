// FOR EXPATS content — arriving, and staying legally.
//
// These three topics carry the highest-stakes information in the product.
// Somebody reads them and books a flight. Every number in them is attached
// to a source in sources.mjs that was read on 20 September 2026, and
// anything not attached to a source is either absent or is marked as
// something we do not yet know.
//
// ON THE ENGLISH
//
// Written for somebody intelligent who knows nothing about Georgia. Short
// sentences. No throat-clearing, no "navigating the complexities of". The
// test applied to every paragraph: would a person who has never heard of
// the Public Service Hall understand what to do after reading this?
//
// ON THE OTHER FIVE LANGUAGES
//
// Translated to mean the same thing, not to match word for word. Georgian
// keeps the institution names in Georgian because that is what the sign on
// the building says; Russian and Turkish keep them transliterated with the
// Georgian in brackets for the same reason. A foreigner standing outside
// the wrong building is not helped by an elegant translation of its name.

export const MOVE_TOPICS = [
  /* ──────────────────────────────────────────────────────────────────── */
  {
    slug: 'entry-and-stay',
    domain: 'RESIDENCY',
    pathway: 'MOVE',
    factClass: 'LEGAL',
    register: 'OFFICIAL_REQUIREMENT',
    sortOrder: 10,
    content: {
      en: {
        title: 'Entering Georgia and how long you can stay',
        summary:
          'Citizens of around a hundred countries can enter Georgia without a visa and stay for a full year. That single rule shapes most of what follows, so it is worth getting right before anything else.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'The short answer',
            body: 'If your country is on Georgia\'s visa-free list, you can arrive with just a passport and stay for one full year from the day you enter. You do not need to apply for anything in advance, and you do not need a reason for your visit. The year is per entry, not per calendar year.',
          },
          {
            kind: 'WHAT_YOU_NEED',
            heading: 'What you need at the border',
            body: 'A passport valid for the length of your stay. Border officers may ask where you are staying and how long you intend to be here, and occasionally for evidence that you can support yourself. Have an address and a return or onward plan you can describe.',
          },
          {
            kind: 'NOTES',
            heading: 'Why the one-year rule matters more than it sounds',
            body: 'A year is long enough to live somewhere properly, which is unusual and is the reason Georgia works for people who want to try a country before committing to it. It also means the clock that matters to you is your entry date, not any permit. If you intend to stay beyond the year, the application for a residence permit has to be made well before it runs out, and that deadline is set by law rather than by us.',
          },
          {
            kind: 'PROBLEMS',
            heading: 'Where people get caught out',
            body: 'The visa-free list is a government ordinance and it is amended from time to time. Check your own nationality against the current annex rather than against something written about Georgia last year. If your country is not on it, there is an electronic visa process and a consular one, and which applies depends on where you are and what you intend to do here.',
          },
        ],
      },
      ka: {
        title: 'საქართველოში შემოსვლა და დარჩენის ვადა',
        summary:
          'დაახლოებით ასი ქვეყნის მოქალაქეს საქართველოში უვიზოდ შემოსვლა და მთელი წლის განმავლობაში დარჩენა შეუძლია. ეს ერთი წესი განსაზღვრავს დანარჩენ ყველაფერს, ამიტომ ჯობია თავიდანვე ზუსტად იცოდეთ.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'მოკლე პასუხი',
            body: 'თუ თქვენი ქვეყანა საქართველოს უვიზო სიაშია, მხოლოდ პასპორტით ჩამოხვალთ და შემოსვლის დღიდან მთელი წელი დარჩებით. წინასწარ არაფრის გაკეთება არ გჭირდებათ და ვიზიტის მიზეზის დასახელებაც არ მოგიწევთ. წელი ითვლება ყოველი შემოსვლიდან, და არა კალენდარული წლით.',
          },
          {
            kind: 'WHAT_YOU_NEED',
            heading: 'რა დაგჭირდებათ საზღვარზე',
            body: 'პასპორტი, რომელიც თქვენი ყოფნის ვადაზე მოქმედია. სასაზღვრო პოლიციამ შეიძლება გკითხოთ სად ჩერდებით და რამდენ ხანს რჩებით, ზოგჯერ კი ისიც, როგორ აპირებთ თავის რჩენას. გქონდეთ მისამართი და მკაფიო პასუხი შემდგომი გეგმის შესახებ.',
          },
          {
            kind: 'NOTES',
            heading: 'რატომ არის ერთი წელი იმაზე მნიშვნელოვანი, ვიდრე ჟღერს',
            body: 'წელი საკმარისია იმისთვის, რომ ქვეყანაში ნამდვილად იცხოვროთ. სწორედ ამიტომ ირჩევენ საქართველოს ისინი, ვისაც ჯერ მოსინჯვა უნდა და მერე გადაწყვეტა. ეს იმასაც ნიშნავს, რომ თქვენთვის მთავარი თარიღი შემოსვლის დღეა და არა რომელიმე ნებართვა. თუ წელზე მეტ ხანს რჩებით, ბინადრობის ნებართვაზე განცხადება ვადის ამოწურვამდე კარგა ხნით ადრე უნდა შეიტანოთ, და ამ ვადას კანონი აწესებს და არა ჩვენ.',
          },
          {
            kind: 'PROBLEMS',
            heading: 'სად ეშლებათ ხოლმე',
            body: 'უვიზო სია მთავრობის დადგენილებაა და დროდადრო იცვლება. შეამოწმეთ თქვენი მოქალაქეობა მოქმედ დანართში და არა შარშანდელ სტატიაში. თუ თქვენი ქვეყანა სიაში არ არის, არსებობს ელექტრონული ვიზა და საკონსულო წესი, და რომელი გეხებათ, დამოკიდებულია იმაზე, სად ხართ და რისთვის ჩამოდიხართ.',
          },
        ],
      },
      ru: {
        title: 'Въезд в Грузию и срок пребывания',
        summary:
          'Граждане примерно ста стран могут въехать в Грузию без визы и находиться здесь целый год. Это правило определяет почти всё остальное, поэтому разобраться в нём стоит в первую очередь.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'Коротко',
            body: 'Если ваша страна есть в безвизовом списке Грузии, вы въезжаете по одному паспорту и остаётесь ровно год со дня въезда. Заранее оформлять ничего не нужно, и объяснять цель поездки тоже. Год считается от каждого въезда, а не по календарю.',
          },
          {
            kind: 'WHAT_YOU_NEED',
            heading: 'Что нужно на границе',
            body: 'Паспорт, действительный на весь срок пребывания. Пограничник может спросить, где вы остановитесь и насколько приехали, иногда — на какие средства. Имейте наготове адрес и внятный ответ о дальнейших планах.',
          },
          {
            kind: 'NOTES',
            heading: 'Почему год важнее, чем кажется',
            body: 'Года достаточно, чтобы пожить в стране по-настоящему, а не посмотреть её. Именно поэтому Грузию выбирают те, кто хочет сначала попробовать, а потом решать. Это также значит, что главная для вас дата — день въезда, а не какое-либо разрешение. Если вы остаётесь дольше года, заявление на вид на жительство подаётся заметно раньше окончания срока, и этот срок устанавливает закон, а не мы.',
          },
          {
            kind: 'PROBLEMS',
            heading: 'На чём обычно спотыкаются',
            body: 'Безвизовый список — это постановление правительства, и его время от времени меняют. Проверяйте своё гражданство по действующему приложению, а не по прошлогодней статье. Если вашей страны в списке нет, существуют электронная виза и консульский порядок, и что именно вам подходит, зависит от того, где вы находитесь и зачем едете.',
          },
        ],
      },
      tr: {
        title: 'Gürcistan\'a giriş ve kalış süresi',
        summary:
          'Yaklaşık yüz ülkenin vatandaşı Gürcistan\'a vizesiz girip tam bir yıl kalabiliyor. Bu tek kural geri kalanın çoğunu belirliyor, o yüzden en başta netleştirmekte fayda var.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'Kısa cevap',
            body: 'Ülkeniz Gürcistan\'ın vizesiz listesindeyse yalnızca pasaportla gelir ve giriş gününüzden itibaren tam bir yıl kalırsınız. Önceden başvuru gerekmez, ziyaret sebebi de sorulmaz. Yıl, her girişten itibaren sayılır; takvim yılı değildir.',
          },
          {
            kind: 'WHAT_YOU_NEED',
            heading: 'Sınırda gerekenler',
            body: 'Kalış süreniz boyunca geçerli bir pasaport. Sınır görevlisi nerede kalacağınızı ve ne kadar kalacağınızı, bazen de kendinizi nasıl geçindireceğinizi sorabilir. Bir adresiniz ve sonraki planınıza dair net bir cevabınız olsun.',
          },
          {
            kind: 'NOTES',
            heading: 'Bir yıl neden kulağa geldiğinden önemli',
            body: 'Bir yıl, bir ülkeyi gezmeye değil, orada gerçekten yaşamaya yeter. Gürcistan\'ı önce deneyip sonra karar vermek isteyenler için işe yaramasının sebebi budur. Aynı zamanda sizin için önemli tarihin herhangi bir izin değil, giriş tarihiniz olduğu anlamına gelir. Bir yıldan uzun kalacaksanız oturma izni başvurusu sürenin bitiminden epey önce yapılmalıdır ve bu süreyi biz değil, kanun belirler.',
          },
          {
            kind: 'PROBLEMS',
            heading: 'İnsanların takıldığı yer',
            body: 'Vizesiz ülkeler listesi bir hükümet kararnamesidir ve zaman zaman değişir. Kendi vatandaşlığınızı geçen yıl yazılmış bir yazıya göre değil, yürürlükteki eke göre kontrol edin. Ülkeniz listede yoksa elektronik vize ve konsolosluk yolu vardır; hangisinin geçerli olduğu nerede bulunduğunuza ve neden geldiğinize bağlıdır.',
          },
        ],
      },
      ar: {
        title: 'دخول جورجيا ومدة الإقامة المسموح بها',
        summary:
          'يستطيع مواطنو نحو مئة دولة دخول جورجيا بلا تأشيرة والبقاء سنة كاملة. هذه القاعدة وحدها تحدد معظم ما يليها، ويستحسن فهمها قبل أي شيء آخر.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'الجواب باختصار',
            body: 'إذا كانت دولتك ضمن قائمة الإعفاء من التأشيرة، فأنت تصل بجواز سفرك وحده وتبقى سنة كاملة من يوم الدخول. لا تحتاج إلى تقديم أي طلب مسبق، ولا إلى ذكر سبب للزيارة. السنة تُحسب من كل دخول، لا حسب السنة الميلادية.',
          },
          {
            kind: 'WHAT_YOU_NEED',
            heading: 'ما تحتاجه عند الحدود',
            body: 'جواز سفر صالح طوال مدة إقامتك. قد يسألك ضابط الحدود أين ستقيم وكم ستبقى، وأحياناً كيف ستعيل نفسك. احتفظ بعنوان واضح وبإجابة مفهومة عن خطتك التالية.',
          },
          {
            kind: 'NOTES',
            heading: 'لماذا السنة أهم مما تبدو',
            body: 'السنة مدة تكفي لأن تعيش في بلد فعلاً لا أن تزوره. لهذا تناسب جورجيا من يريد التجربة قبل القرار. وتعني أيضاً أن التاريخ المهم بالنسبة إليك هو يوم دخولك لا أي تصريح. وإذا كنت ستبقى أكثر من سنة، فطلب الإقامة يُقدَّم قبل انتهاء المدة بوقت كافٍ، وهذه المهلة يحددها القانون لا نحن.',
          },
          {
            kind: 'PROBLEMS',
            heading: 'أين يقع الناس في الخطأ',
            body: 'قائمة الإعفاء قرار حكومي يُعدَّل من حين إلى آخر. تحقق من جنسيتك في الملحق النافذ حالياً، لا في مقال كُتب العام الماضي. وإن لم تكن دولتك في القائمة فهناك تأشيرة إلكترونية ومسار قنصلي، وأيهما ينطبق يعتمد على مكانك وسبب قدومك.',
          },
        ],
      },
      he: {
        title: 'כניסה לגאורגיה וכמה זמן מותר להישאר',
        summary:
          'אזרחי כמאה מדינות יכולים להיכנס לגאורגיה בלי ויזה ולהישאר שנה שלמה. הכלל הזה לבדו קובע את רוב מה שבא אחריו, ולכן כדאי לוודא אותו לפני כל דבר אחר.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'התשובה הקצרה',
            body: 'אם המדינה שלכם ברשימת הפטור מוויזה, אתם מגיעים עם דרכון בלבד ונשארים שנה שלמה מיום הכניסה. אין צורך להגיש דבר מראש ואין צורך לנמק את הביקור. השנה נספרת מכל כניסה, ולא לפי שנה קלנדרית.',
          },
          {
            kind: 'WHAT_YOU_NEED',
            heading: 'מה צריך בגבול',
            body: 'דרכון בתוקף לכל תקופת השהות. פקיד הגבול עשוי לשאול איפה תגורו וכמה זמן תישארו, ולעיתים גם ממה תתפרנסו. כדאי שתהיה בידכם כתובת ותשובה ברורה לגבי ההמשך.',
          },
          {
            kind: 'NOTES',
            heading: 'למה שנה חשובה יותר משהיא נשמעת',
            body: 'שנה מספיקה כדי לחיות במדינה באמת, לא רק לבקר בה. זו הסיבה שגאורגיה מתאימה למי שרוצה לנסות לפני שהוא מחליט. זה גם אומר שהתאריך המשמעותי עבורכם הוא יום הכניסה ולא אישור כלשהו. אם בכוונתכם להישאר מעבר לשנה, את הבקשה לרישיון ישיבה יש להגיש הרבה לפני תום התקופה, והמועד הזה נקבע בחוק ולא על ידינו.',
          },
          {
            kind: 'PROBLEMS',
            heading: 'איפה אנשים נתקעים',
            body: 'רשימת הפטור היא צו ממשלתי והיא מתעדכנת מדי פעם. בדקו את האזרחות שלכם מול הנספח התקף ולא מול כתבה משנה שעברה. אם המדינה שלכם אינה ברשימה, קיימים מסלול ויזה אלקטרונית ומסלול קונסולרי, ומה שחל עליכם תלוי בהיכן אתם ולשם מה אתם מגיעים.',
          },
        ],
      },
    },
    facts: [
      {
        key: 'visa-free-duration',
        factClass: 'LEGAL',
        register: 'OFFICIAL_REQUIREMENT',
        availability: 'ESTABLISHED',
        sources: ['ordinance255'],
        value: { amount: 365, unit: 'DAYS' },
        statement: {
          en: 'Citizens of the countries listed in the annex to Government Ordinance No 255 may enter and stay in Georgia without a visa for one full year.',
          ka: 'მთავრობის №255 დადგენილების დანართში ჩამოთვლილი ქვეყნების მოქალაქეებს შეუძლიათ საქართველოში უვიზოდ შემოსვლა და ერთი სრული წლის განმავლობაში დარჩენა.',
          ru: 'Граждане стран, перечисленных в приложении к постановлению правительства №255, могут въезжать в Грузию без визы и находиться здесь один полный год.',
          tr: '255 sayılı Hükümet Kararnamesi ekinde sayılan ülkelerin vatandaşları Gürcistan\'a vizesiz girip tam bir yıl kalabilir.',
          ar: 'يجوز لمواطني الدول المدرجة في ملحق قرار الحكومة رقم 255 دخول جورجيا بلا تأشيرة والبقاء فيها سنة كاملة.',
          he: 'אזרחי המדינות המנויות בנספח לצו הממשלה מס\' 255 רשאים להיכנס לגאורגיה ללא ויזה ולשהות בה שנה שלמה.',
        },
      },
    ],
  },

  /* ──────────────────────────────────────────────────────────────────── */
  {
    slug: 'residence-permits',
    domain: 'RESIDENCY',
    pathway: 'MOVE',
    factClass: 'LEGAL',
    register: 'OFFICIAL_REQUIREMENT',
    sortOrder: 20,
    content: {
      en: {
        title: 'Residence permits: routes, cost and the deadline that matters',
        summary:
          'Georgia issues more than a dozen kinds of residence permit, all of them through one agency. The route you take depends on why you are here. The date you apply by depends on when your lawful stay ends, and that date is fixed in law.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'The short answer',
            body: 'The Public Service Development Agency issues every residence permit. You apply in person at a Public Service Hall, at one of the agency\'s offices, or online. The standard decision takes thirty calendar days and costs 300 lari; paying more shortens the wait. The application must be in forty calendar days before your lawful stay runs out.',
          },
          {
            kind: 'WHAT_YOU_NEED',
            heading: 'Choosing a route',
            body: 'The agency issues work, study, family reunification, investment, IT, short-term, temporary and permanent permits, among others, along with permits for the spouse of a Georgian citizen and for former citizens. They are not interchangeable: each one asks for evidence of the thing it is named after, and applying on the wrong basis is the commonest way an application is refused. Work out which describes your actual situation before you gather anything.',
          },
          {
            kind: 'DEADLINES',
            heading: 'The forty-day rule',
            body: 'The agency\'s own wording is that an applicant "shall apply for a Georgian residence permit 40 calendar days before his/her lawful stay in the territory of Georgia expires". If you entered visa-free and have a year, that means the application goes in around day 325, not in the last week. This is a legal deadline, not a suggestion from us, and it is the one date in this whole product worth putting in your calendar twice.',
          },
          {
            kind: 'COST',
            heading: 'What it costs',
            body: 'For most permits the agency publishes three speeds: a decision by the thirtieth calendar day for 300 lari, by the twentieth for 450, and by the tenth for 600. Some permits differ. A permanent permit is 500 lari at thirty days, an IT permit 500, and a permit for the spouse of a Georgian citizen is decided by the ninetieth day for 500. These are the agency\'s service fees and do not include translation, notarisation or any document you have to obtain elsewhere.',
          },
          {
            kind: 'WHERE',
            heading: 'Where you go',
            body: 'Any Public Service Hall, any territorial office of the agency, a Community Centre, or the agency\'s online service. The Public Service Halls are the large glass buildings you will see in every city; they handle most government paperwork in the country and they take appointments.',
          },
          {
            kind: 'PROBLEMS',
            heading: 'Where people get caught out',
            body: 'Two things, repeatedly. The first is leaving it late: forty days before expiry is the rule, and a document you have to get apostilled at home can take longer than the time you have left. The second is documents issued abroad, which generally need legalisation and a certified Georgian translation before the agency will look at them. Both are solved months earlier than people expect to have to solve them.',
          },
        ],
      },
      ka: {
        title: 'ბინადრობის ნებართვა: გზები, ღირებულება და მთავარი ვადა',
        summary:
          'საქართველო ათზე მეტი სახის ბინადრობის ნებართვას გასცემს და ყველას ერთი უწყება. რომელი გზა აირჩიოთ, დამოკიდებულია იმაზე, რატომ ხართ აქ. რომელ თარიღამდე შეიტანოთ განცხადება, დამოკიდებულია იმაზე, როდის იწურება თქვენი კანონიერი ყოფნა, და ამ თარიღს კანონი აწესებს.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'მოკლე პასუხი',
            body: 'ბინადრობის ყველა ნებართვას სახელმწიფო სერვისების განვითარების სააგენტო გასცემს. განცხადებას შეიტანთ იუსტიციის სახლში, სააგენტოს ტერიტორიულ ოფისში ან ონლაინ. სტანდარტული გადაწყვეტილება ოცდაათ კალენდარულ დღეს იღებს და 300 ლარი ღირს, სწრაფი კი მეტს. განცხადება უნდა შეიტანოთ კანონიერი ყოფნის ამოწურვამდე ორმოცი კალენდარული დღით ადრე.',
          },
          {
            kind: 'WHAT_YOU_NEED',
            heading: 'როგორ ავირჩიოთ გზა',
            body: 'სააგენტო გასცემს შრომით, სასწავლო, ოჯახის გაერთიანების, საინვესტიციო, IT, მოკლევადიან, დროებით და მუდმივ ნებართვებს, ასევე საქართველოს მოქალაქის მეუღლისა და ყოფილი მოქალაქეებისთვის განკუთვნილს. ისინი ერთმანეთს არ ცვლის: თითოეული სწორედ იმის დადასტურებას ითხოვს, რისი სახელიც ჰქვია. არასწორ საფუძველზე შეტანა უარის ყველაზე გავრცელებული მიზეზია. სანამ დოკუმენტებს შეაგროვებთ, ჯერ გაარკვიეთ, რომელი ეხება თქვენს რეალურ სიტუაციას.',
          },
          {
            kind: 'DEADLINES',
            heading: 'ორმოცი დღის წესი',
            body: 'სააგენტოს ფორმულირებით, უცხოელმა განცხადება უნდა შეიტანოს საქართველოში კანონიერი ყოფნის ამოწურვამდე ორმოცი კალენდარული დღით ადრე. თუ უვიზოდ შემოხვედით და წელი გაქვთ, ეს ნიშნავს დაახლოებით 325-ე დღეს და არა ბოლო კვირას. ეს კანონით დადგენილი ვადაა და არა ჩვენი რჩევა. მთელ ამ პროდუქტში ეს ის ერთი თარიღია, რომელიც კალენდარში ორჯერ ღირს ჩაწერად.',
          },
          {
            kind: 'COST',
            heading: 'რა ღირს',
            body: 'ნებართვების უმეტესობისთვის სააგენტო სამ ვადას აქვეყნებს: გადაწყვეტილება მეოცდაათე კალენდარულ დღეს 300 ლარად, მეოცეზე 450-ად, მეათეზე 600-ად. ზოგი ნებართვა განსხვავდება. მუდმივი ნებართვა ოცდაათ დღეზე 500 ლარია, IT ნებართვა 500, ხოლო საქართველოს მოქალაქის მეუღლის ნებართვა მეოთხმოცდამეათე დღეს 500 ლარად. ეს სააგენტოს მომსახურების საფასურია და არ მოიცავს თარგმანს, ნოტარიულ დამოწმებას ან სხვაგან მოსაპოვებელ დოკუმენტს.',
          },
          {
            kind: 'WHERE',
            heading: 'სად მიხვიდეთ',
            body: 'ნებისმიერ იუსტიციის სახლში, სააგენტოს ნებისმიერ ტერიტორიულ ოფისში, საზოგადოებრივ ცენტრში ან სააგენტოს ონლაინ სერვისში. იუსტიციის სახლები ის დიდი მინის შენობებია, რომლებსაც ყველა ქალაქში დაინახავთ, და წინასწარ ჩაწერაზე მუშაობენ.',
          },
          {
            kind: 'PROBLEMS',
            heading: 'სად ეშლებათ ხოლმე',
            body: 'ორ რამეში, მუდმივად. პირველი დაგვიანებაა: წესი ორმოცი დღეა, ხოლო სამშობლოში აპოსტილის დასმას იმაზე მეტი დრო შეიძლება დასჭირდეს, ვიდრე დაგრჩათ. მეორე უცხოეთში გაცემული დოკუმენტებია, რომლებსაც ჩვეულებრივ ლეგალიზაცია და დამოწმებული ქართული თარგმანი სჭირდება, სანამ სააგენტო მათ საერთოდ შეხედავს. ორივე იმაზე თვეებით ადრე უნდა მოგვარდეს, ვიდრე ადამიანებს ჰგონიათ.',
          },
        ],
      },
      ru: {
        title: 'Вид на жительство: основания, стоимость и главный срок',
        summary:
          'Грузия выдаёт больше десяти видов вида на жительство, и все — через одно агентство. Какое основание ваше, зависит от того, зачем вы здесь. До какой даты подать заявление, зависит от того, когда заканчивается ваше законное пребывание, и эту дату устанавливает закон.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'Коротко',
            body: 'Все виды на жительство выдаёт Агентство развития государственных сервисов. Заявление подаётся в Доме юстиции, в территориальном офисе агентства или онлайн. Стандартное решение занимает тридцать календарных дней и стоит 300 лари; за срочность платят больше. Заявление должно быть подано за сорок календарных дней до окончания законного пребывания.',
          },
          {
            kind: 'WHAT_YOU_NEED',
            heading: 'Как выбрать основание',
            body: 'Агентство выдаёт трудовой, учебный, по воссоединению семьи, инвестиционный, IT, краткосрочный, временный и постоянный виды на жительство, а также для супруга гражданина Грузии и для бывших граждан. Они не взаимозаменяемы: каждый требует подтверждения именно того, что вынесено в его название, и подача не по тому основанию — самая частая причина отказа. Сначала определите, что описывает вашу реальную ситуацию, и только потом собирайте документы.',
          },
          {
            kind: 'DEADLINES',
            heading: 'Правило сорока дней',
            body: 'Формулировка самого агентства: иностранец должен обратиться за видом на жительство за сорок календарных дней до окончания законного пребывания на территории Грузии. Если вы въехали без визы и у вас год, это примерно 325-й день, а не последняя неделя. Это установленный законом срок, а не наша рекомендация, и это единственная дата во всём этом продукте, которую стоит записать в календарь дважды.',
          },
          {
            kind: 'COST',
            heading: 'Сколько стоит',
            body: 'Для большинства разрешений агентство публикует три скорости: решение на тридцатый календарный день за 300 лари, на двадцатый — за 450, на десятый — за 600. Некоторые отличаются. Постоянный вид на жительство — 500 лари за тридцать дней, IT — 500, а для супруга гражданина Грузии решение принимается к девяностому дню за 500. Это сбор агентства за услугу; перевод, нотариальное заверение и документы, которые нужно получить в другом месте, в него не входят.',
          },
          {
            kind: 'WHERE',
            heading: 'Куда идти',
            body: 'В любой Дом юстиции, любой территориальный офис агентства, общественный центр либо в онлайн-сервис агентства. Дома юстиции — это большие стеклянные здания, которые вы увидите в каждом городе; там оформляют большую часть государственных документов и работают по записи.',
          },
          {
            kind: 'PROBLEMS',
            heading: 'На чём обычно спотыкаются',
            body: 'Постоянно на двух вещах. Первая — тянут до последнего: правило — сорок дней, а апостиль на родине иногда делается дольше, чем у вас осталось времени. Вторая — документы, выданные за границей: как правило, им нужны легализация и заверенный перевод на грузинский, прежде чем агентство вообще станет их смотреть. И то и другое решается на месяцы раньше, чем люди ожидают.',
          },
        ],
      },
      tr: {
        title: 'Oturma izni: yollar, ücret ve asıl önemli süre',
        summary:
          'Gürcistan on ikiden fazla türde oturma izni veriyor ve hepsini tek bir kurum düzenliyor. Hangi yolu izleyeceğiniz burada bulunma sebebinize bağlı. Başvuruyu hangi tarihe kadar yapacağınız ise yasal kalış sürenizin ne zaman bittiğine bağlı ve bu tarihi kanun belirliyor.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'Kısa cevap',
            body: 'Bütün oturma izinlerini Kamu Hizmetleri Geliştirme Ajansı veriyor. Başvuru Adalet Evi\'nde, ajansın bölge ofislerinde ya da çevrimiçi yapılır. Standart karar otuz takvim günü sürer ve 300 lari tutar; daha hızlısı daha pahalıdır. Başvurunun, yasal kalış süreniz dolmadan kırk takvim günü önce yapılmış olması gerekir.',
          },
          {
            kind: 'WHAT_YOU_NEED',
            heading: 'Doğru yolu seçmek',
            body: 'Ajans çalışma, öğrenim, aile birleşimi, yatırım, BT, kısa süreli, geçici ve daimî izinlerin yanı sıra Gürcistan vatandaşının eşi ve eski vatandaşlar için de izin veriyor. Bunlar birbirinin yerine geçmez: her biri adını taşıdığı şeyin kanıtını ister ve yanlış gerekçeyle başvurmak, reddedilmenin en yaygın sebebidir. Belge toplamaya başlamadan önce gerçek durumunuzu hangisinin tarif ettiğini belirleyin.',
          },
          {
            kind: 'DEADLINES',
            heading: 'Kırk gün kuralı',
            body: 'Ajansın kendi ifadesiyle, yabancı, Gürcistan\'daki yasal kalış süresi dolmadan kırk takvim günü önce oturma izni için başvurmalıdır. Vizesiz girdiyseniz ve bir yılınız varsa bu, son hafta değil, yaklaşık 325\'inci gün demektir. Bu bizim önerimiz değil, yasal bir süredir; bu üründeki tüm tarihler arasında takvime iki kere yazılmayı hak eden tek tarih budur.',
          },
          {
            kind: 'COST',
            heading: 'Ücreti',
            body: 'Çoğu izin için ajans üç hız yayımlıyor: otuzuncu takvim gününde karar 300 lari, yirminci günde 450, onuncu günde 600. Bazıları farklı. Daimî izin otuz günde 500 lari, BT izni 500, Gürcistan vatandaşının eşi için izin ise doksanıncı günde 500 lari. Bunlar ajansın hizmet bedelidir; çeviri, noter onayı ve başka bir yerden almanız gereken belgeler dâhil değildir.',
          },
          {
            kind: 'WHERE',
            heading: 'Nereye gidilir',
            body: 'Herhangi bir Adalet Evi, ajansın herhangi bir bölge ofisi, bir Toplum Merkezi ya da ajansın çevrimiçi hizmeti. Adalet Evleri her şehirde göreceğiniz büyük cam binalardır; ülkedeki resmî işlemlerin çoğu orada yapılır ve randevuyla çalışırlar.',
          },
          {
            kind: 'PROBLEMS',
            heading: 'İnsanların takıldığı yer',
            body: 'Sürekli iki şey. Birincisi geç kalmak: kural kırk gündür ve ülkenizde aldıracağınız apostil, kalan sürenizden uzun sürebilir. İkincisi yurt dışında düzenlenmiş belgeler; ajans bunlara bakmadan önce genellikle tasdik ve onaylı Gürcüce çeviri ister. İkisi de insanların beklediğinden aylarca önce halledilmesi gereken işlerdir.',
          },
        ],
      },
      ar: {
        title: 'تصاريح الإقامة: المسارات والتكلفة والموعد الذي يهم',
        summary:
          'تصدر جورجيا أكثر من اثني عشر نوعاً من تصاريح الإقامة، جميعها عبر جهة واحدة. المسار الذي تسلكه يعتمد على سبب وجودك هنا. أما الموعد الذي يجب أن تقدّم قبله فيعتمد على انتهاء إقامتك المشروعة، وهو موعد يحدده القانون.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'الجواب باختصار',
            body: 'تصدر وكالة تطوير الخدمات العامة كل تصاريح الإقامة. تقدّم الطلب في بيت العدل، أو في أحد مكاتب الوكالة، أو عبر الإنترنت. القرار القياسي يستغرق ثلاثين يوماً تقويمياً ويكلف 300 لاري، والأسرع يكلف أكثر. ويجب تقديم الطلب قبل انتهاء إقامتك المشروعة بأربعين يوماً تقويمياً.',
          },
          {
            kind: 'WHAT_YOU_NEED',
            heading: 'اختيار المسار',
            body: 'تصدر الوكالة تصاريح للعمل والدراسة ولمّ شمل الأسرة والاستثمار وتقنية المعلومات، وتصاريح قصيرة ومؤقتة ودائمة، إضافة إلى تصريح لزوج المواطن الجورجي وللمواطنين السابقين. وهي ليست بديلاً عن بعضها: كل تصريح يطلب إثبات ما يحمل اسمه، والتقديم على أساس خاطئ هو أكثر أسباب الرفض شيوعاً. حدّد أيها يصف وضعك الفعلي قبل أن تجمع أي ورقة.',
          },
          {
            kind: 'DEADLINES',
            heading: 'قاعدة الأربعين يوماً',
            body: 'بنص الوكالة نفسها، على الأجنبي أن يتقدّم بطلب الإقامة قبل انتهاء إقامته المشروعة في جورجيا بأربعين يوماً تقويمياً. فإن كنت قد دخلت بلا تأشيرة ولديك سنة، فهذا يعني نحو اليوم 325 لا الأسبوع الأخير. هذه مهلة قانونية لا نصيحة منّا، وهي التاريخ الوحيد في هذا المنتج كله الذي يستحق أن يُكتب في التقويم مرتين.',
          },
          {
            kind: 'COST',
            heading: 'التكلفة',
            body: 'لمعظم التصاريح تنشر الوكالة ثلاث سرعات: قرار في اليوم الثلاثين مقابل 300 لاري، وفي العشرين مقابل 450، وفي العاشر مقابل 600. وبعضها يختلف. التصريح الدائم 500 لاري في ثلاثين يوماً، وتصريح تقنية المعلومات 500، وتصريح زوج المواطن الجورجي يُبتّ في اليوم التسعين مقابل 500. هذه رسوم خدمة الوكالة ولا تشمل الترجمة ولا التصديق ولا أي مستند عليك الحصول عليه من جهة أخرى.',
          },
          {
            kind: 'WHERE',
            heading: 'إلى أين تذهب',
            body: 'أي بيت عدل، أو أي مكتب إقليمي للوكالة، أو مركز مجتمعي، أو الخدمة الإلكترونية للوكالة. بيوت العدل هي المباني الزجاجية الكبيرة التي ستراها في كل مدينة، وفيها تُنجز معظم المعاملات الحكومية، وتعمل بنظام المواعيد.',
          },
          {
            kind: 'PROBLEMS',
            heading: 'أين يقع الناس في الخطأ',
            body: 'في أمرين، مراراً. الأول التأخير: القاعدة أربعون يوماً، وتصديق مستند في بلدك قد يستغرق وقتاً أطول مما تبقّى لك. والثاني المستندات الصادرة في الخارج، فهي تحتاج عادةً إلى تصديق وترجمة معتمدة إلى الجورجية قبل أن تنظر فيها الوكالة أصلاً. وكلاهما يُحلّ قبل أشهر مما يتوقعه الناس.',
          },
        ],
      },
      he: {
        title: 'רישיונות ישיבה: מסלולים, עלות והמועד שחשוב באמת',
        summary:
          'גאורגיה מנפיקה יותר מתריסר סוגים של רישיון ישיבה, כולם דרך רשות אחת. איזה מסלול מתאים לכם תלוי בסיבה שבגללה אתם כאן. עד מתי צריך להגיש תלוי במועד שבו נגמרת השהות החוקית שלכם, ואת המועד הזה קובע החוק.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'התשובה הקצרה',
            body: 'את כל רישיונות הישיבה מנפיקה סוכנות פיתוח השירותים הציבוריים. מגישים בבית הצדק, באחד ממשרדי הסוכנות או באינטרנט. ההחלטה הרגילה אורכת שלושים ימים קלנדריים ועולה 300 לארי; מהיר יותר עולה יותר. את הבקשה יש להגיש ארבעים ימים קלנדריים לפני שהשהות החוקית שלכם נגמרת.',
          },
          {
            kind: 'WHAT_YOU_NEED',
            heading: 'לבחור מסלול',
            body: 'הסוכנות מנפיקה רישיונות עבודה, לימודים, איחוד משפחות, השקעה, הייטק, קצר מועד, זמני וקבוע, וכן רישיון לבן או בת זוג של אזרח גאורגי ולאזרחים לשעבר. הם אינם חליפיים: כל אחד דורש הוכחה בדיוק לדבר ששמו נושא, והגשה על בסיס לא נכון היא הסיבה השכיחה ביותר לסירוב. בררו מי מהם מתאר את מצבכם בפועל לפני שאתם אוספים מסמך אחד.',
          },
          {
            kind: 'DEADLINES',
            heading: 'כלל ארבעים הימים',
            body: 'בניסוח של הסוכנות עצמה, על זר להגיש בקשה לרישיון ישיבה ארבעים ימים קלנדריים לפני תום שהותו החוקית בגאורגיה. אם נכנסתם בפטור מוויזה ויש לכם שנה, מדובר בערך ביום ה־325 ולא בשבוע האחרון. זהו מועד שקבוע בחוק ולא המלצה שלנו, וזה התאריך היחיד במוצר הזה כולו שכדאי לרשום ביומן פעמיים.',
          },
          {
            kind: 'COST',
            heading: 'כמה זה עולה',
            body: 'לרוב הרישיונות מפרסמת הסוכנות שלוש מהירויות: החלטה ביום הקלנדרי השלושים תמורת 300 לארי, ביום העשרים תמורת 450 וביום העשירי תמורת 600. חלקם שונים. רישיון קבע עולה 500 לארי בשלושים יום, רישיון הייטק 500, ורישיון לבן או בת זוג של אזרח גאורגי מוכרע ביום התשעים תמורת 500. אלה דמי השירות של הסוכנות, ואינם כוללים תרגום, אישור נוטריוני או מסמך שעליכם להשיג במקום אחר.',
          },
          {
            kind: 'WHERE',
            heading: 'לאן הולכים',
            body: 'לכל בית צדק, לכל משרד אזורי של הסוכנות, למרכז קהילתי או לשירות המקוון של הסוכנות. בתי הצדק הם המבנים הגדולים מזכוכית שתראו בכל עיר; שם מתבצע רוב הנייר הממשלתי במדינה, והם עובדים בתורים מראש.',
          },
          {
            kind: 'PROBLEMS',
            heading: 'איפה אנשים נתקעים',
            body: 'בשני דברים, שוב ושוב. הראשון הוא דחייה לרגע האחרון: הכלל הוא ארבעים יום, ואפוסטיל שצריך להוציא בארץ המוצא יכול לקחת יותר זמן ממה שנשאר לכם. השני הוא מסמכים שהונפקו בחו"ל, שבדרך כלל דורשים אישור ותרגום מאושר לגאורגית לפני שהסוכנות בכלל מסתכלת עליהם. את שניהם פותרים חודשים לפני שאנשים מצפים שיצטרכו.',
          },
        ],
      },
    },
    facts: [
      {
        key: 'application-deadline',
        factClass: 'DEADLINE',
        register: 'OFFICIAL_REQUIREMENT',
        availability: 'ESTABLISHED',
        sources: ['sdaResidence'],
        value: { amount: 40, unit: 'DAYS_BEFORE_STAY_EXPIRY' },
        statement: {
          en: 'An applicant must apply to the Public Service Development Agency for a residence permit 40 calendar days before their lawful stay in Georgia expires.',
          ka: 'ბინადრობის ნებართვისთვის განცხადება სახელმწიფო სერვისების განვითარების სააგენტოში უნდა შეიტანოთ საქართველოში კანონიერი ყოფნის ამოწურვამდე 40 კალენდარული დღით ადრე.',
          ru: 'Заявление на вид на жительство подаётся в Агентство развития государственных сервисов за 40 календарных дней до окончания законного пребывания в Грузии.',
          tr: 'Oturma izni başvurusu, Gürcistan\'daki yasal kalış süresi dolmadan 40 takvim günü önce Kamu Hizmetleri Geliştirme Ajansı\'na yapılmalıdır.',
          ar: 'يجب تقديم طلب تصريح الإقامة إلى وكالة تطوير الخدمات العامة قبل انتهاء الإقامة المشروعة في جورجيا بأربعين يوماً تقويمياً.',
          he: 'יש להגיש בקשה לרישיון ישיבה לסוכנות פיתוח השירותים הציבוריים 40 ימים קלנדריים לפני תום השהות החוקית בגאורגיה.',
        },
      },
      {
        key: 'standard-fee',
        factClass: 'FEE',
        register: 'OFFICIAL_REQUIREMENT',
        availability: 'ESTABLISHED',
        sources: ['sdaResidence'],
        value: { amount: 300, currency: 'GEL', unit: 'ONE_OFF', decisionDays: 30 },
        statement: {
          en: 'A standard residence permit decision on the 30th calendar day costs GEL 300; GEL 450 on the 20th day and GEL 600 on the 10th.',
          ka: 'ბინადრობის ნებართვის სტანდარტული გადაწყვეტილება მე-30 კალენდარულ დღეს 300 ლარი ღირს, მე-20 დღეს 450 ლარი, მე-10-ზე 600 ლარი.',
          ru: 'Стандартное решение по виду на жительство на 30-й календарный день стоит 300 лари, на 20-й — 450 лари, на 10-й — 600 лари.',
          tr: 'Otuzuncu takvim gününde verilen standart oturma izni kararı 300 lari, yirminci günde 450 lari, onuncu günde 600 laridir.',
          ar: 'قرار تصريح الإقامة القياسي في اليوم الثلاثين يكلف 300 لاري، وفي اليوم العشرين 450 لاري، وفي العاشر 600 لاري.',
          he: 'החלטה רגילה על רישיון ישיבה ביום הקלנדרי ה־30 עולה 300 לארי, ביום ה־20 עולה 450 לארי וביום ה־10 עולה 600 לארי.',
        },
      },
    ],
  },
];
