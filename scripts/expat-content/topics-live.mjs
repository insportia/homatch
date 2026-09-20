// FOR EXPATS content — banking, healthcare, and what a month costs.
//
// Shorter than the residency topics on purpose. §13 says not to render
// empty sections, and the honest way to obey that is not to write filler
// into sections the evidence cannot support. Where a section would say
// "requirements vary", it is absent and the short answer says so once.
//
// THE HEALTHCARE TOPIC CARRIES A DELIBERATE UNKNOWN
//
// Whether a foreign resident can join the state universal healthcare
// programme is the single most valuable fact on that page and it could
// not be established from a source we were able to read. The Ministry's
// own page was not reachable, and the secondary sources disagree about
// which residence statuses qualify.
//
// So the fact is stored as UNKNOWN with needs_review set, and the page
// says we have not confirmed it rather than repeating what the internet
// says. It is the first item in the review queue, and it is there as a
// working demonstration that the queue is real: this is exactly the
// situation §49 exists for.

export const LIVE_TOPICS = [
  {
    slug: 'opening-a-bank-account',
    domain: 'BANKING',
    pathway: 'LIVE',
    factClass: 'PROCESS',
    register: 'PRACTICAL_CONTEXT',
    sortOrder: 10,
    content: {
      en: {
        title: 'Opening a Georgian bank account',
        summary:
          'There is no national checklist for this, and that surprises people. The law tells banks they must know who you are; each bank decides for itself what will satisfy it.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'The short answer',
            body: 'Go in person to a branch with your passport. Expect to be asked what you do, where your money comes from and where you live, and to be asked for something in writing to support the answers. Which documents count is the bank\'s decision, not the state\'s, so ask the specific branch before you assemble anything.',
          },
          {
            kind: 'NOTES',
            heading: 'Why we are not giving you a document list',
            body: 'Because there is not one to give. Georgian law requires banks to identify and verify customers and to apply due diligence, and leaves the implementation to them. A list published by anyone other than your bank is that writer\'s experience at one branch on one day. We would rather tell you the shape of the conversation than hand you a checklist that gets you turned away.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'What tends to help',
            body: 'A local phone number, a lease or something else showing a Georgian address, and a plain explanation of your income with a document behind it — an employment contract, recent statements, company papers. Non-residents are generally expected to attend a branch in person rather than open remotely.',
          },
        ],
      },
      ka: {
        title: 'ქართული საბანკო ანგარიშის გახსნა',
        summary:
          'ამისთვის ერთიანი სახელმწიფო სია არ არსებობს და ეს ხალხს უკვირს. კანონი ბანკებს ავალდებულებს იცოდნენ ვინ ხართ; რა დააკმაყოფილებს, ამას თითოეული ბანკი თავად წყვეტს.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'მოკლე პასუხი',
            body: 'მიდით ფილიალში პირადად, პასპორტით. დაგელოდებათ კითხვები იმაზე, რით ხართ დაკავებული, საიდან გაქვთ შემოსავალი და სად ცხოვრობთ, და სთხოვენ ამის დამადასტურებელ დოკუმენტს. რომელი დოკუმენტი ჩაითვლება, ამას ბანკი წყვეტს და არა სახელმწიფო, ამიტომ ჯერ კონკრეტულ ფილიალს ჰკითხეთ.',
          },
          {
            kind: 'NOTES',
            heading: 'რატომ არ გაძლევთ დოკუმენტების სიას',
            body: 'იმიტომ, რომ ასეთი სია არ არსებობს. ქართული კანონი ბანკებს ავალდებულებს მომხმარებლის იდენტიფიცირებას და შემოწმებას, ხოლო შესრულების წესს თავად ბანკებს უტოვებს. ნებისმიერი სია, რომელიც თქვენი ბანკის გარდა სხვას გამოუქვეყნებია, ერთი ადამიანის გამოცდილებაა ერთ ფილიალში ერთ დღეს. გირჩევნიათ იცოდეთ, როგორი საუბარი გელით, ვიდრე გქონდეთ სია, რომლითაც უკან გამოგაბრუნებენ.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'რა შველის ხოლმე',
            body: 'ადგილობრივი ნომერი, იჯარის ხელშეკრულება ან სხვა დოკუმენტი ქართული მისამართით, და შემოსავლის მარტივი ახსნა დოკუმენტით: შრომითი ხელშეკრულება, ბოლო ამონაწერები, კომპანიის საბუთები. არარეზიდენტებს ჩვეულებრივ ფილიალში პირადად მისვლას ელოდებიან და არა დისტანციურ გახსნას.',
          },
        ],
      },
      ru: {
        title: 'Открытие счёта в грузинском банке',
        summary:
          'Единого государственного списка документов для этого нет, и это людей удивляет. Закон обязывает банки знать, кто вы; что именно их устроит, каждый банк решает сам.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'Коротко',
            body: 'Придите в отделение лично с паспортом. Будьте готовы к вопросам о том, чем вы занимаетесь, откуда деньги и где вы живёте, и к просьбе подтвердить ответы документом. Какие документы подойдут, решает банк, а не государство, поэтому спросите конкретное отделение прежде, чем что-то собирать.',
          },
          {
            kind: 'NOTES',
            heading: 'Почему мы не даём список документов',
            body: 'Потому что такого списка не существует. Грузинский закон требует от банков идентифицировать и проверять клиентов и оставляет им способ исполнения. Любой список, опубликованный кем-то кроме вашего банка, — это чей-то опыт в одном отделении в один день. Лучше знать, как пойдёт разговор, чем держать в руках список, с которым вас развернут.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Что обычно помогает',
            body: 'Местный номер телефона, договор аренды или иной документ с грузинским адресом и простое объяснение источника дохода с подтверждением: трудовой договор, недавние выписки, документы компании. От нерезидентов, как правило, ждут личного визита в отделение, а не удалённого открытия.',
          },
        ],
      },
      tr: {
        title: 'Gürcistan\'da banka hesabı açmak',
        summary:
          'Bunun için ulusal bir belge listesi yok ve bu insanları şaşırtıyor. Kanun bankalara sizi tanımalarını söylüyor; neyin yeterli olacağına her banka kendi karar veriyor.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'Kısa cevap',
            body: 'Pasaportunuzla şubeye bizzat gidin. Ne iş yaptığınız, paranızın nereden geldiği ve nerede yaşadığınız sorulacak, cevaplarınızı destekleyen bir belge istenecektir. Hangi belgelerin geçerli olduğuna devlet değil banka karar verir; bu yüzden bir şey toplamadan önce ilgili şubeye sorun.',
          },
          {
            kind: 'NOTES',
            heading: 'Neden size bir belge listesi vermiyoruz',
            body: 'Çünkü verilecek bir liste yok. Gürcistan kanunu bankaların müşteriyi tanımasını ve doğrulamasını şart koşar, uygulamayı ise bankalara bırakır. Kendi bankanız dışında birinin yayımladığı her liste, bir kişinin bir şubede bir gün yaşadığıdır. Sizi geri çevirecek bir listeyi elinize tutuşturmaktansa konuşmanın nasıl geçeceğini anlatmayı tercih ederiz.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Genellikle işe yarayanlar',
            body: 'Yerel bir telefon numarası, kira sözleşmesi ya da Gürcistan adresini gösteren başka bir belge ve gelirinizin belgeyle desteklenmiş sade bir açıklaması: iş sözleşmesi, son hesap dökümleri, şirket evrakı. Yerleşik olmayanlardan genellikle uzaktan değil, şubeye bizzat gelmeleri beklenir.',
          },
        ],
      },
      ar: {
        title: 'فتح حساب مصرفي في جورجيا',
        summary:
          'لا توجد قائمة مستندات وطنية موحدة لهذا الأمر، وهو ما يفاجئ الناس. القانون يُلزم المصارف بأن تعرف من أنت؛ أما ما يقنعها فيقرره كل مصرف بنفسه.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'الجواب باختصار',
            body: 'اذهب إلى الفرع شخصياً ومعك جواز سفرك. توقّع أن تُسأل عن عملك ومصدر أموالك ومكان سكنك، وأن يُطلب منك ما يدعم إجاباتك كتابةً. تحديد المستندات المقبولة يعود إلى المصرف لا إلى الدولة، فاسأل الفرع المعني قبل أن تجمع شيئاً.',
          },
          {
            kind: 'NOTES',
            heading: 'لماذا لا نعطيك قائمة مستندات',
            body: 'لأنه لا توجد قائمة لنعطيها. القانون الجورجي يُلزم المصارف بتحديد هوية العملاء والتحقق منهم ويترك لها طريقة التنفيذ. وأي قائمة ينشرها غير مصرفك هي تجربة شخص واحد في فرع واحد في يوم واحد. نفضّل أن نصف لك شكل المحادثة على أن نسلّمك قائمة تُعاد بسببها من الباب.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'ما الذي يساعد عادةً',
            body: 'رقم هاتف محلي، وعقد إيجار أو ما يثبت عنواناً في جورجيا، وشرح بسيط لمصدر دخلك مدعوم بمستند: عقد عمل، كشوف حساب حديثة، أوراق شركة. ويُتوقع من غير المقيمين عادةً الحضور إلى الفرع شخصياً لا الفتح عن بُعد.',
          },
        ],
      },
      he: {
        title: 'פתיחת חשבון בנק בגאורגיה',
        summary:
          'אין לזה רשימת מסמכים ארצית אחידה, וזה מפתיע אנשים. החוק מחייב את הבנקים לדעת מי אתם; מה יספק אותם — כל בנק מחליט בעצמו.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'התשובה הקצרה',
            body: 'הגיעו לסניף פיזית עם הדרכון. צפו שישאלו במה אתם עוסקים, מאיפה הכסף שלכם ואיפה אתם גרים, ושיבקשו מסמך שתומך בתשובות. אילו מסמכים נחשבים זו החלטה של הבנק ולא של המדינה, אז שאלו את הסניף הספציפי לפני שאתם אוספים משהו.',
          },
          {
            kind: 'NOTES',
            heading: 'למה איננו נותנים לכם רשימת מסמכים',
            body: 'כי אין כזו לתת. החוק הגאורגי מחייב בנקים לזהות ולאמת לקוחות ומשאיר להם את אופן הביצוע. כל רשימה שפרסם מישהו שאינו הבנק שלכם היא ניסיון של אדם אחד בסניף אחד ביום אחד. עדיף שנתאר לכם איך תיראה השיחה מאשר שניתן בידכם רשימה שבגללה תוחזרו הביתה.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'מה בדרך כלל עוזר',
            body: 'מספר טלפון מקומי, חוזה שכירות או מסמך אחר שמראה כתובת בגאורגיה, והסבר פשוט על מקור ההכנסה עם מסמך מאחוריו: חוזה העסקה, דפי חשבון אחרונים, מסמכי חברה. מתושבי חוץ בדרך כלל מצפים להגעה פיזית לסניף ולא לפתיחה מרחוק.',
          },
        ],
      },
    },
    facts: [
      {
        key: 'due-diligence-required',
        factClass: 'LEGAL',
        register: 'OFFICIAL_REQUIREMENT',
        availability: 'ESTABLISHED',
        sources: ['amlLaw'],
        value: null,
        statement: {
          en: 'Georgian law obliges banks to identify and verify customers and to apply customer due diligence. The specific documents each bank requires are set by that bank within this framework.',
          ka: 'ქართული კანონი ბანკებს ავალდებულებს მომხმარებლის იდენტიფიცირებას, შემოწმებას და სათანადო შემოწმების ღონისძიებების გატარებას. კონკრეტულ დოკუმენტებს ამ ჩარჩოში თითოეული ბანკი თავად ადგენს.',
          ru: 'Грузинский закон обязывает банки идентифицировать и проверять клиентов и применять надлежащую проверку. Конкретные документы каждый банк устанавливает сам в рамках этих требований.',
          tr: 'Gürcistan kanunu bankaları müşteriyi tanımaya, doğrulamaya ve gerekli özeni göstermeye zorunlu kılar. Hangi belgelerin isteneceğini bu çerçeve içinde her banka kendisi belirler.',
          ar: 'يُلزم القانون الجورجي المصارف بتحديد هوية العملاء والتحقق منهم وتطبيق العناية الواجبة. أما المستندات المحددة فيضعها كل مصرف ضمن هذا الإطار.',
          he: 'החוק הגאורגי מחייב בנקים לזהות ולאמת לקוחות ולנקוט בדיקת נאותות. את המסמכים הספציפיים קובע כל בנק בעצמו במסגרת הזו.',
        },
      },
    ],
  },

  {
    slug: 'healthcare-and-insurance',
    domain: 'HEALTHCARE',
    pathway: 'LIVE',
    factClass: 'PROCESS',
    register: 'PRACTICAL_CONTEXT',
    sortOrder: 20,
    needsReview: true,
    reviewReason:
      'Whether foreign residents can join the State Universal Healthcare Programme is not established from a source we were able to read. The Ministry of Health page was unreachable and secondary sources disagree.',
    content: {
      en: {
        title: 'Healthcare and insurance',
        summary:
          'Most foreign residents here use private healthcare and private insurance. Whether any residence status opens the state programme to you is something we have not been able to confirm, and we would rather say so.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'The short answer',
            body: 'Plan on private cover. Georgian private medicine is inexpensive by Western European standards and consultations are usually quick to get. Insurers here sell policies to foreigners, and international policies are also widely used by people who move between countries.',
          },
          {
            kind: 'NOTES',
            heading: 'What we have not confirmed',
            body: 'Georgia runs a State Universal Healthcare Programme. We could not establish from a source we were able to open whether, and under which residence statuses, a foreign resident may join it. Sources that are not the Ministry disagree with each other. Rather than repeat one of them, this page leaves the question open and it is queued for review. If it matters to your decision, ask the Ministry of Internally Displaced Persons, Labour, Health and Social Affairs directly.',
          },
        ],
      },
      ka: {
        title: 'ჯანდაცვა და დაზღვევა',
        summary:
          'აქ მცხოვრები უცხოელების უმეტესობა კერძო მედიცინითა და კერძო დაზღვევით სარგებლობს. გიხსნით თუ არა რომელიმე ბინადრობის სტატუსი სახელმწიფო პროგრამას, ვერ დავადასტურეთ და გირჩევნიათ ეს გითხრათ.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'მოკლე პასუხი',
            body: 'დაგეგმეთ კერძო დაზღვევა. ქართული კერძო მედიცინა დასავლეთ ევროპის ფასებთან შედარებით იაფია და კონსულტაციაზე მოხვედრა ჩვეულებრივ სწრაფად ხერხდება. აქაური მზღვეველები უცხოელებზე პოლისებს ყიდიან, ხოლო ვინც ქვეყნებს შორის გადაადგილდება, ხშირად საერთაშორისო პოლისს იყენებს.',
          },
          {
            kind: 'NOTES',
            heading: 'რა ვერ დავადასტურეთ',
            body: 'საქართველოში მოქმედებს საყოველთაო ჯანდაცვის სახელმწიფო პროგრამა. ვერ დავადგინეთ წყაროდან, რომლის გახსნაც შევძელით, შეუძლია თუ არა უცხოელ მაცხოვრებელს მასში ჩართვა და რომელი სტატუსით. არასამინისტრო წყაროები ერთმანეთს ეწინააღმდეგება. იმის ნაცვლად, რომ რომელიმე გავიმეოროთ, ეს გვერდი კითხვას ღიად ტოვებს და განხილვის რიგშია. თუ თქვენი გადაწყვეტილებისთვის ეს მნიშვნელოვანია, პირდაპირ ჰკითხეთ ჯანდაცვის სამინისტროს.',
          },
        ],
      },
      ru: {
        title: 'Здравоохранение и страхование',
        summary:
          'Большинство живущих здесь иностранцев пользуются частной медициной и частной страховкой. Открывает ли какой-либо статус проживания доступ к государственной программе, мы подтвердить не смогли — и предпочитаем так и сказать.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'Коротко',
            body: 'Рассчитывайте на частное покрытие. Частная медицина в Грузии недорога по западноевропейским меркам, и попасть на приём обычно можно быстро. Местные страховщики продают полисы иностранцам; те, кто перемещается между странами, часто пользуются международными полисами.',
          },
          {
            kind: 'NOTES',
            heading: 'Чего мы не подтвердили',
            body: 'В Грузии действует государственная программа всеобщего здравоохранения. Из источника, который нам удалось открыть, мы не смогли установить, может ли иностранный резидент в неё войти и при каком статусе. Источники, не являющиеся министерством, противоречат друг другу. Вместо того чтобы повторить один из них, эта страница оставляет вопрос открытым, и он поставлен в очередь на проверку. Если это важно для вашего решения, спросите напрямую в министерстве здравоохранения.',
          },
        ],
      },
      tr: {
        title: 'Sağlık hizmeti ve sigorta',
        summary:
          'Burada yaşayan yabancıların çoğu özel sağlık hizmeti ve özel sigorta kullanıyor. Herhangi bir oturma statüsünün devlet programını size açıp açmadığını doğrulayamadık ve bunu söylemeyi tercih ediyoruz.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'Kısa cevap',
            body: 'Özel sigorta üzerinden planlayın. Gürcistan\'da özel sağlık hizmeti Batı Avrupa ölçülerine göre ucuzdur ve muayeneye genellikle çabuk sıra gelir. Buradaki sigortacılar yabancılara poliçe satıyor; ülkeler arasında gidip gelenler sıkça uluslararası poliçe kullanıyor.',
          },
          {
            kind: 'NOTES',
            heading: 'Doğrulayamadıklarımız',
            body: 'Gürcistan\'da bir Devlet Genel Sağlık Programı yürürlükte. Açabildiğimiz bir kaynaktan, yabancı bir yerleşiğin bu programa katılıp katılamayacağını ve hangi statüyle katılabileceğini tespit edemedik. Bakanlık dışındaki kaynaklar birbiriyle çelişiyor. Bunlardan birini tekrarlamak yerine bu sayfa soruyu açık bırakıyor ve konu inceleme sırasına alındı. Kararınız için önemliyse doğrudan Sağlık Bakanlığı\'na sorun.',
          },
        ],
      },
      ar: {
        title: 'الرعاية الصحية والتأمين',
        summary:
          'معظم المقيمين الأجانب هنا يعتمدون على الطب الخاص والتأمين الخاص. أما إن كان أي وضع إقامة يفتح لك باب البرنامج الحكومي فهذا ما لم نتمكن من تأكيده، ونفضّل أن نقول ذلك.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'الجواب باختصار',
            body: 'خطّط على أساس تغطية خاصة. الطب الخاص في جورجيا غير مكلف بمقاييس أوروبا الغربية، والحصول على موعد عادةً سريع. شركات التأمين المحلية تبيع وثائق للأجانب، ومن ينتقلون بين البلدان يستخدمون كثيراً وثائق دولية.',
          },
          {
            kind: 'NOTES',
            heading: 'ما لم نتمكن من تأكيده',
            body: 'لدى جورجيا برنامج حكومي للرعاية الصحية الشاملة. ولم نستطع، من مصدر تمكّنا من فتحه، أن نحدد ما إذا كان المقيم الأجنبي يستطيع الانضمام إليه وبأي وضع إقامة. والمصادر غير الوزارية يناقض بعضها بعضاً. وبدلاً من تكرار أحدها، تترك هذه الصفحة السؤال مفتوحاً، وقد أُدرج في قائمة المراجعة. وإن كان هذا مهماً لقرارك فاسأل وزارة الصحة مباشرة.',
          },
        ],
      },
      he: {
        title: 'בריאות וביטוח',
        summary:
          'רוב התושבים הזרים כאן משתמשים ברפואה פרטית ובביטוח פרטי. האם מעמד ישיבה כלשהו פותח בפניכם את התוכנית הממלכתית — זה מה שלא הצלחנו לאמת, ואנחנו מעדיפים לומר זאת.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'התשובה הקצרה',
            body: 'תכננו על כיסוי פרטי. הרפואה הפרטית בגאורגיה זולה במונחי מערב אירופה, ובדרך כלל אפשר להגיע לייעוץ מהר. חברות ביטוח מקומיות מוכרות פוליסות לזרים, ומי שנע בין מדינות משתמש לא פעם בפוליסה בינלאומית.',
          },
          {
            kind: 'NOTES',
            heading: 'מה לא אימתנו',
            body: 'בגאורגיה פועלת תוכנית ממלכתית לבריאות כוללת. לא הצלחנו לקבוע ממקור שהצלחנו לפתוח אם תושב זר יכול להצטרף אליה ובאיזה מעמד. מקורות שאינם המשרד סותרים זה את זה. במקום לחזור על אחד מהם, העמוד הזה משאיר את השאלה פתוחה והיא הוכנסה לתור הבדיקה. אם זה משמעותי להחלטה שלכם, פנו ישירות למשרד הבריאות.',
          },
        ],
      },
    },
    facts: [
      {
        key: 'state-programme-eligibility',
        factClass: 'LEGAL',
        register: 'OFFICIAL_REQUIREMENT',
        // The point of the whole design: we do not know, and we say so.
        availability: 'UNKNOWN',
        sources: [],
        value: null,
        needsReview: true,
        statement: {
          en: 'Whether, and under which residence statuses, a foreign resident may join the State Universal Healthcare Programme has not been confirmed from a source Homatch could read.',
          ka: 'შეუძლია თუ არა უცხოელ მაცხოვრებელს საყოველთაო ჯანდაცვის სახელმწიფო პროგრამაში ჩართვა და რომელი სტატუსით, არ დადასტურებულა წყაროდან, რომლის წაკითხვაც Homatch-მა შეძლო.',
          ru: 'Может ли иностранный резидент войти в государственную программу всеобщего здравоохранения и при каком статусе — не подтверждено источником, который Homatch смог прочитать.',
          tr: 'Yabancı bir yerleşiğin Devlet Genel Sağlık Programı\'na katılıp katılamayacağı ve hangi statüyle katılabileceği, Homatch\'in okuyabildiği bir kaynaktan doğrulanmadı.',
          ar: 'لم يتأكد من مصدر تمكّنت Homatch من قراءته ما إذا كان المقيم الأجنبي يستطيع الانضمام إلى برنامج الرعاية الصحية الشاملة الحكومي، ولا بأي وضع إقامة.',
          he: 'האם תושב זר יכול להצטרף לתוכנית הממלכתית לבריאות כוללת, ובאיזה מעמד, לא אומת ממקור ש‏Homatch הצליחה לקרוא.',
        },
      },
    ],
  },
];
