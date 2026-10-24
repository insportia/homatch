// FOR EXPATS content — documents and tax residency.
//
// The plan's tasks linked to these two slugs and production had neither, so
// a reader who tapped "read the guide" landed on "We do not have this page".
// Written on 2026-10-24 from the sources in sources.mjs (opened and read that
// day). Friendly, plain, no dashes. Where a source is a summary rather than
// the authority, the text says to confirm with the office named.

export const MORE_TOPICS = [
  {
    slug: 'documents-and-legalisation',
    domain: 'LEGAL',
    pathway: 'MOVE',
    factClass: 'PROCESS',
    register: 'PRACTICAL_CONTEXT',
    sortOrder: 30,
    content: {
      en: {
        title: 'Getting your documents accepted in Georgia',
        summary:
          'A birth certificate, diploma or marriage certificate from home works in Georgia once it has two things: an apostille from the country that issued it, and a Georgian translation certified by a notary.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'The short answer',
            body: 'Georgia is part of the Apostille Convention, so it accepts foreign documents that carry an apostille. Get the apostille in the country that issued the document, bring it to Georgia, and have it translated into Georgian with the translation certified by a notary. That pair is what most offices here ask for.',
          },
          {
            kind: 'WHAT_YOU_NEED',
            heading: 'Sort these out before you leave home',
            body: 'Think about which papers you might need here: birth and marriage certificates, diplomas, your children\'s documents, a certificate of no criminal record. Getting the apostille is far easier while you are still in the country that issued them. Some offices want certificates issued recently, so ask the office that will receive it how old the document may be.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'If your country is not in the Apostille Convention',
            body: 'Then the document needs consular legalisation instead. It is certified by the authorities in your country and then by a Georgian embassy or consulate. Ask the Georgian consulate nearest to you how they do it. A few neighbouring countries have a treaty with Georgia that skips this step; the office that receives your document can tell you whether yours is one of them.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Translation in Georgia',
            body: 'Any translation bureau can translate the document into Georgian, and a notary then certifies the translator\'s signature. Many bureaus sit right next to a notary and do both. Bring your passport. Ask them to spell your name exactly as it is in your passport, because a different spelling is the most common reason a paper comes back.',
          },
          {
            kind: 'WHERE',
            heading: 'Georgian documents you need abroad',
            body: 'If you need an apostille on a Georgian document, go to a Public Service Hall. A certificate of no criminal record comes from the Ministry of Internal Affairs and can be ordered at a Public Service Hall or online on my.gov.ge. Faster service is available and costs more.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Power of attorney',
            body: 'A notary in Georgia can draw one up for you even if you are not a resident. Bring your passport, and an interpreter if you do not speak Georgian. In Tbilisi and Batumi many notaries also work in English or Russian.',
          },
          {
            kind: 'PROBLEMS',
            heading: 'What usually goes wrong',
            body: 'The apostille was put on in a different country from the one that issued the document. The translation was done but not certified by a notary. The certificate is older than the office accepts. Your name is spelled one way in the passport and another way in the translation. Each of these sends you back to the start, so check all four before you go.',
          },
        ],
      },
      ka: {
        title: 'როგორ მიიღონ თქვენი დოკუმენტები საქართველოში',
        summary:
          'სამშობლოში გაცემული დაბადების მოწმობა, დიპლომი თუ ქორწინების მოწმობა საქართველოში ძალაშია, როცა ორი რამ აქვს: აპოსტილი იმ ქვეყნიდან, სადაც გაიცა, და ქართული თარგმანი ნოტარიულად დამოწმებული.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'მოკლე პასუხი',
            body: 'საქართველო აპოსტილის კონვენციის წევრია, ამიტომ აპოსტილიან უცხოურ დოკუმენტს იღებს. აპოსტილი გაიკეთეთ იმ ქვეყანაში, სადაც დოკუმენტი გაიცა, ჩამოიტანეთ და აქ ქართულად თარგმნეთ, თარგმანი კი ნოტარიუსმა დაამოწმოს. ეს წყვილი ითხოვება აქ უმეტეს დაწესებულებაში.',
          },
          {
            kind: 'WHAT_YOU_NEED',
            heading: 'წასვლამდე ეს მოაგვარეთ',
            body: 'დაფიქრდით, რომელი საბუთი შეიძლება დაგჭირდეთ: დაბადებისა და ქორწინების მოწმობა, დიპლომი, ბავშვების დოკუმენტები, ნასამართლობის არქონის ცნობა. აპოსტილის გაკეთება გაცილებით მარტივია, სანამ იმ ქვეყანაში ხართ, სადაც ეს საბუთები გაიცა. ზოგი დაწესებულება ახლახან გაცემულ ცნობას ითხოვს, ამიტომ ჰკითხეთ, რამდენი ხნის წინანდელი დოკუმენტი მიიღება.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'თუ თქვენი ქვეყანა აპოსტილის კონვენციაში არ არის',
            body: 'მაშინ აპოსტილის ნაცვლად საკონსულო ლეგალიზაციაა საჭირო. დოკუმენტს ჯერ თქვენი ქვეყნის უწყება ამოწმებს, შემდეგ საქართველოს საელჩო ან საკონსულო. ჰკითხეთ თქვენთან ახლოს მდებარე ქართულ საკონსულოს, როგორ აკეთებენ. რამდენიმე მეზობელ ქვეყანასთან საქართველოს ხელშეკრულება აქვს, რომელიც ამ ნაბიჯს აშორებს. რომელი ქვეყნებია, დოკუმენტის მიმღები დაწესებულება გეტყვით.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'თარგმანი საქართველოში',
            body: 'ნებისმიერი სათარჯიმნო ბიურო თარგმნის დოკუმენტს ქართულად, ნოტარიუსი კი მთარგმნელის ხელმოწერას დაამოწმებს. ბევრი ბიურო ნოტარიუსის გვერდით არის და ორივეს ერთად აკეთებს. პასპორტი თან იქონიეთ. სთხოვეთ, სახელი ზუსტად ისე დაწერონ, როგორც პასპორტშია, რადგან სხვანაირი დაწერილობა ყველაზე ხშირი მიზეზია, რის გამოც საბუთს უკან აბრუნებენ.',
          },
          {
            kind: 'WHERE',
            heading: 'ქართული დოკუმენტი საზღვარგარეთისთვის',
            body: 'ქართულ დოკუმენტზე აპოსტილისთვის მიმართეთ იუსტიციის სახლს. ნასამართლობის არქონის ცნობას შინაგან საქმეთა სამინისტრო გასცემს, შეკვეთა კი შეგიძლიათ იუსტიციის სახლში ან ონლაინ, my.gov.ge-ზე. სწრაფი მომსახურებაც არსებობს, უფრო ძვირი ღირს.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'მინდობილობა',
            body: 'საქართველოში ნოტარიუსი მინდობილობას გაგიფორმებთ, რეზიდენტი რომ არ იყოთ, მაშინაც. წაიღეთ პასპორტი, ქართული თუ არ იცით, თარჯიმანიც. თბილისსა და ბათუმში ბევრი ნოტარიუსი ინგლისურად ან რუსულადაც მუშაობს.',
          },
          {
            kind: 'PROBLEMS',
            heading: 'რა ფუჭდება ყველაზე ხშირად',
            body: 'აპოსტილი სხვა ქვეყანაშია გაკეთებული და არა იქ, სადაც დოკუმენტი გაიცა. თარგმანი გაკეთდა, მაგრამ ნოტარიუსს არ დაუმოწმებია. ცნობა იმაზე ძველია, ვიდრე დაწესებულება იღებს. სახელი პასპორტში ერთნაირად წერია, თარგმანში სხვანაირად. ყოველი მათგანი თავიდან დაწყებას ნიშნავს, ამიტომ ოთხივე წასვლამდე გადაამოწმეთ.',
          },
        ],
      },
      ru: {
        title: 'Как сделать ваши документы действительными в Грузии',
        summary:
          'Свидетельство о рождении, диплом или свидетельство о браке из вашей страны действуют в Грузии, когда у них есть две вещи: апостиль страны, которая их выдала, и перевод на грузинский, заверенный нотариусом.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'Коротко',
            body: 'Грузия участвует в Апостильной конвенции и принимает иностранные документы с апостилем. Поставьте апостиль в стране, которая выдала документ, привезите его сюда и переведите на грузинский, а перевод пусть заверит нотариус. Именно эту пару просит большинство учреждений.',
          },
          {
            kind: 'WHAT_YOU_NEED',
            heading: 'Сделайте это до отъезда',
            body: 'Подумайте, какие бумаги могут понадобиться: свидетельства о рождении и браке, дипломы, документы детей, справка об отсутствии судимости. Апостиль гораздо проще поставить, пока вы ещё в стране, где их выдали. Некоторые учреждения хотят недавно выданные справки, поэтому спросите, какого срока документ они примут.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Если ваша страна не участвует в конвенции',
            body: 'Тогда вместо апостиля нужна консульская легализация. Документ заверяют органы вашей страны, а затем посольство или консульство Грузии. Спросите ближайшее грузинское консульство, как это у них устроено. С несколькими соседними странами у Грузии есть договор, который убирает этот шаг; учреждение, принимающее документ, подскажет, относится ли к ним ваша.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Перевод в Грузии',
            body: 'Любое бюро переводов переведёт документ на грузинский, а нотариус заверит подпись переводчика. Многие бюро находятся рядом с нотариусом и делают всё сразу. Возьмите паспорт. Попросите написать имя точно как в паспорте: другое написание чаще всего становится причиной отказа.',
          },
          {
            kind: 'WHERE',
            heading: 'Грузинские документы для заграницы',
            body: 'Апостиль на грузинский документ ставят в Доме юстиции. Справку об отсутствии судимости выдаёт МВД, заказать её можно в Доме юстиции или онлайн на my.gov.ge. Есть ускоренная услуга, она дороже.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Доверенность',
            body: 'Нотариус в Грузии оформит доверенность, даже если вы не резидент. Возьмите паспорт и переводчика, если не говорите по-грузински. В Тбилиси и Батуми многие нотариусы работают на английском или русском.',
          },
          {
            kind: 'PROBLEMS',
            heading: 'Что чаще всего идёт не так',
            body: 'Апостиль поставлен не в той стране, что выдала документ. Перевод сделан, но не заверен нотариусом. Справка старше, чем принимает учреждение. Имя в паспорте написано одним образом, а в переводе другим. Любое из этого возвращает вас к началу, так что проверьте все четыре пункта заранее.',
          },
        ],
      },
      tr: {
        title: 'Belgelerinizin Gürcistan\'da kabul edilmesi',
        summary:
          'Ülkenizden doğum belgesi, diploma ya da evlilik belgesi Gürcistan\'da iki şeyle geçerli olur: belgeyi veren ülkenin apostili ve noterce onaylanmış Gürcüce çeviri.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'Kısa cevap',
            body: 'Gürcistan Apostil Sözleşmesi\'ne taraftır, bu yüzden apostilli yabancı belgeleri kabul eder. Apostili belgeyi veren ülkede yaptırın, belgeyi buraya getirin ve Gürcüceye çevirtin; çeviriyi de bir noter onaylasın. Buradaki çoğu kurumun istediği bu ikilidir.',
          },
          {
            kind: 'WHAT_YOU_NEED',
            heading: 'Yola çıkmadan halledin',
            body: 'Burada hangi belgelere ihtiyaç duyabileceğinizi düşünün: doğum ve evlilik belgeleri, diplomalar, çocuklarınızın belgeleri, adli sicil kaydı. Apostil, belgeyi veren ülkedeyken çok daha kolay alınır. Bazı kurumlar yakın tarihli belge ister; belgenin ne kadar eski olabileceğini belgeyi alacak kuruma sorun.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Ülkeniz Apostil Sözleşmesi\'nde değilse',
            body: 'O zaman apostil yerine konsolosluk tasdiki gerekir. Belge önce kendi ülkenizin makamlarınca, sonra Gürcistan büyükelçiliği veya konsolosluğunca onaylanır. Size en yakın Gürcistan konsolosluğuna nasıl yaptıklarını sorun. Gürcistan\'ın bazı komşu ülkelerle bu adımı kaldıran bir anlaşması var; belgenizi alacak kurum ülkenizin bunlardan biri olup olmadığını söyler.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Gürcistan\'da çeviri',
            body: 'Herhangi bir tercüme bürosu belgeyi Gürcüceye çevirir, noter de tercümanın imzasını onaylar. Birçok büro notere yakındır ve ikisini birlikte halleder. Pasaportunuzu yanınıza alın. Adınızın pasaporttaki gibi yazılmasını isteyin; farklı yazım, belgenin geri dönmesinin en sık nedenidir.',
          },
          {
            kind: 'WHERE',
            heading: 'Yurt dışında kullanılacak Gürcü belgeleri',
            body: 'Gürcü bir belgeye apostil için Kamu Hizmetleri Salonu\'na (Public Service Hall) gidin. Adli sicil kaydını İçişleri Bakanlığı verir; Kamu Hizmetleri Salonu\'ndan ya da my.gov.ge üzerinden çevrimiçi isteyebilirsiniz. Hızlı hizmet de var, daha pahalıdır.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Vekaletname',
            body: 'Gürcistan\'da bir noter, yerleşik olmasanız da size vekaletname düzenler. Pasaportunuzu ve Gürcüce bilmiyorsanız bir tercüman getirin. Tiflis ve Batum\'da birçok noter İngilizce veya Rusça da çalışır.',
          },
          {
            kind: 'PROBLEMS',
            heading: 'En sık ne ters gider',
            body: 'Apostil, belgeyi veren ülke yerine başka bir ülkede yapılmış. Çeviri yapılmış ama noter onaylamamış. Belge kurumun kabul ettiğinden daha eski. Adınız pasaportta bir türlü, çeviride başka türlü yazılmış. Bunların her biri sizi başa döndürür; gitmeden dördünü de kontrol edin.',
          },
        ],
      },
      ar: {
        title: 'كيف تُقبل مستنداتك في جورجيا',
        summary:
          'شهادة الميلاد أو الشهادة الجامعية أو عقد الزواج من بلدك تصبح سارية في جورجيا عندما يكون لها أمران: أبوستيل من البلد الذي أصدرها، وترجمة إلى الجورجية يصادق عليها كاتب عدل.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'الإجابة المختصرة',
            body: 'جورجيا طرف في اتفاقية الأبوستيل، لذا تقبل المستندات الأجنبية التي تحمل أبوستيل. احصل على الأبوستيل في البلد الذي أصدر المستند، وأحضره إلى جورجيا، وترجمه إلى الجورجية مع مصادقة كاتب العدل على الترجمة. هذا ما تطلبه معظم الجهات هنا.',
          },
          {
            kind: 'WHAT_YOU_NEED',
            heading: 'رتّب هذا قبل السفر',
            body: 'فكّر في الأوراق التي قد تحتاجها: شهادات الميلاد والزواج، والشهادات الدراسية، ومستندات أطفالك، وشهادة عدم المحكومية. الحصول على الأبوستيل أسهل بكثير وأنت ما زلت في البلد الذي أصدرها. بعض الجهات تطلب شهادات حديثة الإصدار، فاسأل الجهة المستلمة عن المدة المقبولة.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'إذا لم يكن بلدك في اتفاقية الأبوستيل',
            body: 'عندها تحتاج إلى تصديق قنصلي بدلًا من الأبوستيل. تصادق سلطات بلدك على المستند، ثم سفارة جورجيا أو قنصليتها. اسأل أقرب قنصلية جورجية عن طريقتها. لجورجيا معاهدة مع بعض الدول المجاورة تلغي هذه الخطوة، والجهة التي تستلم مستندك تخبرك إن كان بلدك منها.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'الترجمة في جورجيا',
            body: 'أي مكتب ترجمة يترجم المستند إلى الجورجية، ثم يصادق كاتب العدل على توقيع المترجم. كثير من المكاتب بجوار كاتب عدل وتنجز الأمرين معًا. أحضر جواز سفرك. اطلب كتابة اسمك تمامًا كما في الجواز، فاختلاف الكتابة هو أكثر سبب لرفض الورقة.',
          },
          {
            kind: 'WHERE',
            heading: 'مستندات جورجية تحتاجها في الخارج',
            body: 'للحصول على أبوستيل على مستند جورجي توجّه إلى قاعة الخدمات العامة. شهادة عدم المحكومية تصدرها وزارة الداخلية، ويمكن طلبها في قاعة الخدمات العامة أو عبر my.gov.ge. هناك خدمة أسرع بتكلفة أعلى.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'الوكالة',
            body: 'يستطيع كاتب عدل في جورجيا تحرير وكالة لك حتى لو لم تكن مقيمًا. أحضر جواز سفرك، ومترجمًا إن كنت لا تتكلم الجورجية. في تبليسي وباتومي يعمل كثير من كتّاب العدل بالإنجليزية أو الروسية أيضًا.',
          },
          {
            kind: 'PROBLEMS',
            heading: 'ما الذي يتعثر عادةً',
            body: 'وُضع الأبوستيل في بلد غير البلد الذي أصدر المستند. أُنجزت الترجمة دون مصادقة كاتب العدل. الشهادة أقدم مما تقبله الجهة. اسمك مكتوب في الجواز بطريقة وفي الترجمة بطريقة أخرى. كل واحد من هذه يعيدك إلى البداية، فتحقق من الأربعة قبل الذهاب.',
          },
        ],
      },
      he: {
        title: 'איך המסמכים שלך מתקבלים בגאורגיה',
        summary:
          'תעודת לידה, תעודת השכלה או תעודת נישואין מהבית תקפות בגאורגיה כשיש להן שני דברים: אפוסטיל מהמדינה שהנפיקה אותן ותרגום לגאורגית שנוטריון אישר.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'התשובה הקצרה',
            body: 'גאורגיה חברה באמנת האפוסטיל, ולכן היא מקבלת מסמכים זרים עם אפוסטיל. עשה את האפוסטיל במדינה שהנפיקה את המסמך, הבא אותו לגאורגיה ותרגם לגאורגית, ונוטריון יאשר את התרגום. את הצמד הזה מבקשים רוב המשרדים כאן.',
          },
          {
            kind: 'WHAT_YOU_NEED',
            heading: 'לסדר לפני שיוצאים מהבית',
            body: 'חשוב אילו מסמכים עשויים להידרש: תעודות לידה ונישואין, תעודות השכלה, מסמכי הילדים, תעודת יושר. הרבה יותר קל להוציא אפוסטיל כשאתה עדיין במדינה שהנפיקה אותם. יש משרדים שרוצים תעודה שהונפקה לאחרונה, אז שאל את המשרד שיקבל אותה מה הגיל המותר.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'אם המדינה שלך לא באמנת האפוסטיל',
            body: 'אז צריך אימות קונסולרי במקום אפוסטיל. הרשויות במדינה שלך מאשרות את המסמך, ואחריהן שגרירות או קונסוליה של גאורגיה. שאל את הקונסוליה הגאורגית הקרובה איך עושים את זה אצלם. לגאורגיה יש אמנה עם כמה מדינות שכנות שמבטלת את השלב הזה, והמשרד שמקבל את המסמך יגיד לך אם המדינה שלך ביניהן.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'תרגום בגאורגיה',
            body: 'כל משרד תרגום יתרגם את המסמך לגאורגית, ונוטריון מאשר את חתימת המתרגם. הרבה משרדים יושבים ליד נוטריון ועושים את שניהם יחד. הבא דרכון. בקש שיכתבו את שמך בדיוק כמו בדרכון, כי כתיב שונה הוא הסיבה הנפוצה ביותר שמסמך חוזר.',
          },
          {
            kind: 'WHERE',
            heading: 'מסמכים גאורגיים לשימוש בחו"ל',
            body: 'לאפוסטיל על מסמך גאורגי פונים לבית השירותים הציבוריים (Public Service Hall). תעודת יושר מנפיק משרד הפנים, ואפשר להזמין אותה בבית השירותים הציבוריים או באינטרנט ב־my.gov.ge. יש שירות מהיר יותר, והוא עולה יותר.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'ייפוי כוח',
            body: 'נוטריון בגאורגיה יערוך לך ייפוי כוח גם אם אינך תושב. הבא דרכון, ומתורגמן אם אינך דובר גאורגית. בטביליסי ובבטומי נוטריונים רבים עובדים גם באנגלית או ברוסית.',
          },
          {
            kind: 'PROBLEMS',
            heading: 'מה בדרך כלל משתבש',
            body: 'האפוסטיל נעשה במדינה אחרת מזו שהנפיקה את המסמך. התרגום נעשה אבל נוטריון לא אישר אותו. התעודה ישנה ממה שהמשרד מקבל. השם כתוב בדרכון בדרך אחת ובתרגום בדרך אחרת. כל אחד מאלה מחזיר אותך להתחלה, אז בדוק את ארבעתם לפני שאתה הולך.',
          },
        ],
      },
    },
    facts: [
      {
        key: 'apostille-convention-member',
        factClass: 'LEGAL',
        register: 'OFFICIAL_REQUIREMENT',
        availability: 'ESTABLISHED',
        sources: ['hcchApostille'],
        value: { entryIntoForce: '2007-05-14' },
        statement: {
          en: 'Georgia is a party to the Hague Apostille Convention. It entered into force for Georgia on 14 May 2007.',
          ka: 'საქართველო ჰააგის აპოსტილის კონვენციის მონაწილეა. საქართველოსთვის ძალაში 2007 წლის 14 მაისს შევიდა.',
          ru: 'Грузия участвует в Гаагской конвенции об апостиле. Для Грузии она вступила в силу 14 мая 2007 года.',
          tr: 'Gürcistan, Lahey Apostil Sözleşmesi\'ne taraftır. Sözleşme Gürcistan için 14 Mayıs 2007\'de yürürlüğe girdi.',
          ar: 'جورجيا طرف في اتفاقية لاهاي للأبوستيل، وقد دخلت حيز التنفيذ بالنسبة لجورجيا في 14 مايو 2007.',
          he: 'גאורגיה חברה באמנת האפוסטיל של האג. האמנה נכנסה לתוקף לגבי גאורגיה ב־14 במאי 2007.',
        },
      },
      {
        key: 'foreign-document-translation',
        factClass: 'PROCESS',
        register: 'PRACTICAL_CONTEXT',
        availability: 'ESTABLISHED',
        sources: ['madlobaDocuments'],
        value: null,
        statement: {
          en: 'A document issued abroad is apostilled in the country that issued it, then translated into Georgian with the translation notarised, before it is submitted in Georgia.',
          ka: 'საზღვარგარეთ გაცემულ დოკუმენტს აპოსტილს გამცემი ქვეყანა უკეთებს, შემდეგ ქართულად ითარგმნება და თარგმანი ნოტარიულად მოწმდება, სანამ საქართველოში წარადგენთ.',
          ru: 'Документ, выданный за границей, апостилируют в стране выдачи, затем переводят на грузинский с нотариальным заверением перевода и только после этого подают в Грузии.',
          tr: 'Yurt dışında verilen bir belge, veren ülkede apostillenir, sonra Gürcüceye çevrilip çevirisi noterce onaylanır ve ardından Gürcistan\'da sunulur.',
          ar: 'المستند الصادر في الخارج يُوضع عليه الأبوستيل في بلد الإصدار، ثم يُترجم إلى الجورجية مع مصادقة كاتب العدل على الترجمة، قبل تقديمه في جورجيا.',
          he: 'מסמך שהונפק בחו"ל מקבל אפוסטיל במדינה שהנפיקה אותו, ואז מתורגם לגאורגית עם אישור נוטריוני לתרגום, לפני שמגישים אותו בגאורגיה.',
        },
      },
    ],
  },

  {
    slug: 'tax-residency',
    domain: 'TAX',
    pathway: 'LIVE',
    factClass: 'LEGAL',
    register: 'OFFICIAL_REQUIREMENT',
    sortOrder: 40,
    content: {
      en: {
        title: 'Tax residency in Georgia',
        summary:
          'You become a Georgian tax resident by spending 183 days or more in Georgia within any twelve months in a row. Georgia taxes personal income at a flat 20%, and a resident pays no Georgian tax on income that does not come from Georgia.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'The short answer',
            body: 'Count your days. If you are in Georgia for 183 days or more in any continuous twelve months that end in the tax year, you are a tax resident for that whole year. A day counts even if you were here for only part of it. Your status is decided again every year.',
          },
          {
            kind: 'NOTES',
            heading: 'What it means for your money',
            body: 'Personal income in Georgia is taxed at a flat 20%. A resident does not pay Georgian tax on income that has no Georgian source, such as a salary from a company abroad. Your home country may still want its share, so check its rules and whether it has a tax treaty with Georgia before you count on paying less.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'If you work for yourself',
            body: 'If you register as an individual entrepreneur you can apply for small business status. You then pay 1% of your turnover while it stays under 500,000 lari a year, and 3% if it goes above. Very small businesses with turnover under 30,000 lari a year and no employees can register as a micro business and pay no tax on that business income.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Renting out or selling a home',
            body: 'If you rent a flat out for someone to live in and do not claim expenses against it, the tax on that rent is 5%. Profit from selling a flat or house with its land is taxed at 5% too.',
          },
          {
            kind: 'NOTES',
            heading: 'Without 183 days: the high net worth route',
            body: 'There is a second way in for people with significant wealth. The rules say you can apply to the Revenue Service if your property is worth more than 3 million lari or your income was over 200,000 lari in each of the last three years, together with a Georgian residence permit or at least 25,000 lari of Georgian income. Advisers report extra conditions added in 2023, so check the current rules with the Revenue Service before you apply.',
          },
          {
            kind: 'WHERE',
            heading: 'Who to ask',
            body: 'The Revenue Service of Georgia (rs.ge) decides on residency and issues the certificate of tax residency that banks and other countries often ask for. For anything involving two countries, talk to a tax adviser who knows both.',
          },
        ],
      },
      ka: {
        title: 'საგადასახადო რეზიდენტობა საქართველოში',
        summary:
          'საქართველოს საგადასახადო რეზიდენტი ხდებით, თუ ნებისმიერ ზედიზედ თორმეტ თვეში საქართველოში 183 დღე ან მეტი გაატარეთ. საშემოსავლო გადასახადი 20%-ია, ხოლო რეზიდენტი არ იხდის ქართულ გადასახადს შემოსავალზე, რომელიც საქართველოდან არ მოდის.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'მოკლე პასუხი',
            body: 'დღეები დაითვალეთ. თუ ნებისმიერ ზედიზედ თორმეტ თვეში, რომელიც საგადასახადო წელს მთავრდება, საქართველოში 183 დღე ან მეტი ხართ, მთელი ამ წლის რეზიდენტი ხართ. დღე ითვლება, აქ მისი ნაწილი რომ გაატაროთ, მაშინაც. სტატუსი ყოველ წელს თავიდან განისაზღვრება.',
          },
          {
            kind: 'NOTES',
            heading: 'რას ნიშნავს ეს თქვენი ფულისთვის',
            body: 'ფიზიკური პირის შემოსავალი საქართველოში ერთიანი 20%-ით იბეგრება. რეზიდენტი ქართულ გადასახადს არ იხდის შემოსავალზე, რომლის წყარო საქართველოში არ არის, მაგალითად უცხოური კომპანიის ხელფასზე. თქვენი ქვეყანა შეიძლება მაინც ითხოვდეს თავის წილს, ამიტომ სანამ ნაკლებ გადასახადზე იანგარიშებთ, გადაამოწმეთ მისი წესები და აქვს თუ არა საქართველოსთან ორმაგი დაბეგვრის ხელშეკრულება.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'თუ საკუთარ თავზე მუშაობთ',
            body: 'ინდივიდუალურ მეწარმედ რეგისტრაციის შემდეგ შეგიძლიათ მცირე ბიზნესის სტატუსი მოითხოვოთ. მაშინ ბრუნვის 1%-ს იხდით, სანამ წელიწადში 500 000 ლარს არ გადააჭარბებს, ზემოთ კი 3%-ს. თუ წლიური ბრუნვა 30 000 ლარზე ნაკლებია და დასაქმებული არ გყავთ, შეგიძლიათ მიკრო ბიზნესად დარეგისტრირდეთ და ამ შემოსავალზე გადასახადი არ გადაიხადოთ.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'ბინის გაქირავება ან გაყიდვა',
            body: 'თუ ბინას საცხოვრებლად აქირავებთ და ხარჯებს არ აკლებთ, ქირაზე გადასახადი 5%-ია. ბინის ან სახლის მიწასთან ერთად გაყიდვით მიღებული მოგებაც 5%-ით იბეგრება.',
          },
          {
            kind: 'NOTES',
            heading: '183 დღის გარეშე: მაღალი შემოსავლის გზა',
            body: 'მნიშვნელოვანი ქონების მქონე ადამიანებისთვის მეორე გზაც არსებობს. წესის მიხედვით, შემოსავლების სამსახურს შეგიძლიათ მიმართოთ, თუ თქვენი ქონება 3 მილიონ ლარზე მეტი ღირს ან ბოლო სამი წლის განმავლობაში ყოველწლიური შემოსავალი 200 000 ლარს აღემატებოდა, და თან გაქვთ ბინადრობის ნებართვა ან საქართველოდან მინიმუმ 25 000 ლარის შემოსავალი. კონსულტანტების თქმით, 2023 წელს დამატებითი პირობები შემოვიდა, ამიტომ განაცხადამდე მიმდინარე წესი შემოსავლების სამსახურთან გადაამოწმეთ.',
          },
          {
            kind: 'WHERE',
            heading: 'ვის ჰკითხოთ',
            body: 'რეზიდენტობაზე გადაწყვეტილებას შემოსავლების სამსახური (rs.ge) იღებს და ის გასცემს საგადასახადო რეზიდენტობის ცნობას, რომელსაც ბანკები და სხვა ქვეყნები ხშირად ითხოვენ. თუ საქმე ორ ქვეყანას ეხება, მიმართეთ საგადასახადო კონსულტანტს, რომელიც ორივეს იცნობს.',
          },
        ],
      },
      ru: {
        title: 'Налоговое резидентство в Грузии',
        summary:
          'Налоговым резидентом Грузии вы становитесь, если проводите здесь 183 дня или больше за любые двенадцать месяцев подряд. Подоходный налог в Грузии плоский, 20%, а резидент не платит грузинский налог с дохода не из Грузии.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'Коротко',
            body: 'Посчитайте дни. Если вы находитесь в Грузии 183 дня или больше за любые непрерывные двенадцать месяцев, которые заканчиваются в налоговом году, вы резидент за весь этот год. День засчитывается, даже если вы были здесь только его часть. Статус определяется заново каждый год.',
          },
          {
            kind: 'NOTES',
            heading: 'Что это значит для ваших денег',
            body: 'Доход физических лиц в Грузии облагается по ставке 20%. Резидент не платит грузинский налог с дохода, источник которого не в Грузии, например с зарплаты от иностранной компании. Ваша страна может всё равно потребовать свою долю, поэтому проверьте её правила и есть ли у неё с Грузией соглашение об избежании двойного налогообложения.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Если вы работаете на себя',
            body: 'Зарегистрировавшись индивидуальным предпринимателем, можно запросить статус малого бизнеса. Тогда вы платите 1% с оборота, пока он меньше 500 000 лари в год, и 3%, если больше. При обороте до 30 000 лари в год и без сотрудников можно зарегистрироваться как микробизнес и не платить налог с этого дохода.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Сдать или продать жильё',
            body: 'Если вы сдаёте квартиру для проживания и не вычитаете расходы, налог с аренды 5%. Прибыль от продажи квартиры или дома с землёй тоже облагается по ставке 5%.',
          },
          {
            kind: 'NOTES',
            heading: 'Без 183 дней: путь для состоятельных',
            body: 'Для людей со значительным состоянием есть второй путь. По правилам можно обратиться в Налоговую службу, если ваше имущество стоит больше 3 миллионов лари или доход превышал 200 000 лари в каждый из последних трёх лет, и при этом у вас есть ВНЖ Грузии или не менее 25 000 лари грузинского дохода. Консультанты сообщают о дополнительных условиях с 2023 года, поэтому уточните действующие правила в Налоговой службе до подачи.',
          },
          {
            kind: 'WHERE',
            heading: 'Куда обращаться',
            body: 'Решение о резидентстве принимает Налоговая служба Грузии (rs.ge), она же выдаёт справку о налоговом резидентстве, которую часто просят банки и другие страны. Если вопрос касается двух стран, поговорите с налоговым консультантом, который знает обе.',
          },
        ],
      },
      tr: {
        title: 'Gürcistan\'da vergi mukimliği',
        summary:
          'Herhangi bir kesintisiz on iki ay içinde Gürcistan\'da 183 gün veya daha fazla kalırsanız Gürcistan vergi mukimi olursunuz. Kişisel gelir vergisi düz %20\'dir ve mukim, Gürcistan kaynaklı olmayan gelirine Gürcistan vergisi ödemez.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'Kısa cevap',
            body: 'Günlerinizi sayın. Vergi yılında biten herhangi bir kesintisiz on iki ayda Gürcistan\'da 183 gün veya daha fazla bulunursanız o yılın tamamı için mukimsiniz. Günün sadece bir kısmını burada geçirseniz de o gün sayılır. Durumunuz her yıl yeniden belirlenir.',
          },
          {
            kind: 'NOTES',
            heading: 'Paranız için ne anlama gelir',
            body: 'Gürcistan\'da kişisel gelir düz %20 oranında vergilendirilir. Mukim, kaynağı Gürcistan olmayan gelirine, örneğin yurt dışındaki bir şirketten aldığı maaşa, Gürcistan vergisi ödemez. Kendi ülkeniz yine de payını isteyebilir; daha az vergi ödeyeceğinizi hesaplamadan önce o ülkenin kurallarına ve Gürcistan ile çifte vergilendirme anlaşması olup olmadığına bakın.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Kendi işinizi yapıyorsanız',
            body: 'Bireysel girişimci olarak kaydolursanız küçük işletme statüsü isteyebilirsiniz. Cironuz yılda 500.000 larinin altında kaldıkça %1, üstüne çıkarsa %3 ödersiniz. Yıllık cirosu 30.000 larinin altında olan ve çalışanı olmayanlar mikro işletme olarak kaydolup bu gelir için vergi ödemez.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Ev kiraya vermek veya satmak',
            body: 'Bir daireyi oturmak için kiraya verir ve gider düşmezseniz kira vergisi %5\'tir. Bir daireyi veya evi arsasıyla satmaktan elde edilen kazanç da %5 vergilendirilir.',
          },
          {
            kind: 'NOTES',
            heading: '183 gün olmadan: yüksek varlık yolu',
            body: 'Önemli varlığı olanlar için ikinci bir yol var. Kurallara göre, mal varlığınız 3 milyon lariden fazlaysa veya son üç yılın her birinde geliriniz 200.000 lariyi aştıysa, ayrıca Gürcistan oturma izniniz ya da en az 25.000 lari Gürcistan kaynaklı geliriniz varsa Gelir İdaresi\'ne başvurabilirsiniz. Danışmanlar 2023\'te ek koşullar geldiğini bildiriyor; başvurmadan önce güncel kuralları Gelir İdaresi\'ne sorun.',
          },
          {
            kind: 'WHERE',
            heading: 'Kime sormalı',
            body: 'Mukimlik kararını Gürcistan Gelir İdaresi (rs.ge) verir ve bankaların ve diğer ülkelerin sık istediği vergi mukimlik belgesini de o düzenler. İki ülkeyi ilgilendiren her konuda, ikisini de bilen bir vergi danışmanıyla konuşun.',
          },
        ],
      },
      ar: {
        title: 'الإقامة الضريبية في جورجيا',
        summary:
          'تصبح مقيمًا ضريبيًا في جورجيا إذا قضيت فيها 183 يومًا أو أكثر خلال أي اثني عشر شهرًا متتالية. ضريبة الدخل الشخصي في جورجيا ثابتة بنسبة 20%، ولا يدفع المقيم ضريبة جورجية على دخل لا يأتي من جورجيا.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'الإجابة المختصرة',
            body: 'احسب أيامك. إذا كنت في جورجيا 183 يومًا أو أكثر خلال أي اثني عشر شهرًا متصلة تنتهي في السنة الضريبية، فأنت مقيم عن تلك السنة كلها. يُحتسب اليوم حتى لو قضيت هنا جزءًا منه فقط. ويُحدَّد وضعك من جديد كل سنة.',
          },
          {
            kind: 'NOTES',
            heading: 'ماذا يعني ذلك لأموالك',
            body: 'يخضع دخل الأفراد في جورجيا لضريبة ثابتة نسبتها 20%. لا يدفع المقيم ضريبة جورجية على دخل مصدره خارج جورجيا، مثل راتب من شركة في الخارج. قد تطالب دولتك بحصتها رغم ذلك، فتحقق من قواعدها ومن وجود اتفاقية لتجنب الازدواج الضريبي مع جورجيا قبل أن تعتمد على دفع أقل.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'إذا كنت تعمل لحسابك',
            body: 'عند التسجيل كرائد أعمال فردي يمكنك طلب وضع الأعمال الصغيرة، فتدفع 1% من حجم أعمالك ما دام أقل من 500,000 لاري سنويًا، و3% إذا تجاوزه. ومن كان حجم أعماله أقل من 30,000 لاري سنويًا وليس لديه موظفون يستطيع التسجيل كمشروع متناهي الصغر ولا يدفع ضريبة على هذا الدخل.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'تأجير منزل أو بيعه',
            body: 'إذا أجّرت شقة للسكن ولم تخصم مصاريف منها، فالضريبة على الإيجار 5%. والربح من بيع شقة أو منزل مع أرضه يخضع أيضًا لضريبة 5%.',
          },
          {
            kind: 'NOTES',
            heading: 'دون 183 يومًا: طريق أصحاب الثروات',
            body: 'هناك طريق ثانٍ لأصحاب الثروات الكبيرة. تنص القواعد على أنه يمكنك التقدم إلى مصلحة الإيرادات إذا تجاوزت قيمة أملاكك 3 ملايين لاري أو تجاوز دخلك 200,000 لاري في كل سنة من السنوات الثلاث الأخيرة، مع تصريح إقامة جورجي أو دخل جورجي لا يقل عن 25,000 لاري. يذكر المستشارون شروطًا إضافية أُضيفت في 2023، فتحقق من القواعد الحالية لدى مصلحة الإيرادات قبل التقديم.',
          },
          {
            kind: 'WHERE',
            heading: 'إلى من تتوجه',
            body: 'مصلحة الإيرادات في جورجيا (rs.ge) هي التي تقرر الإقامة الضريبية وتصدر شهادتها التي تطلبها البنوك والدول الأخرى كثيرًا. وفي أي أمر يخص دولتين، تحدث إلى مستشار ضريبي يعرف الاثنتين.',
          },
        ],
      },
      he: {
        title: 'תושבות מס בגאורגיה',
        summary:
          'אתה הופך לתושב מס בגאורגיה כשאתה שוהה בה 183 ימים או יותר במהלך שנים עשר חודשים רצופים כלשהם. מס ההכנסה האישי בגאורגיה הוא 20% אחיד, ותושב לא משלם מס גאורגי על הכנסה שלא מגיעה מגאורגיה.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'התשובה הקצרה',
            body: 'ספור את הימים. אם אתה בגאורגיה 183 ימים או יותר בשנים עשר חודשים רצופים כלשהם שמסתיימים בשנת המס, אתה תושב לכל אותה שנה. יום נספר גם אם היית כאן רק בחלק ממנו. המעמד נקבע מחדש בכל שנה.',
          },
          {
            kind: 'NOTES',
            heading: 'מה זה אומר לכסף שלך',
            body: 'הכנסה של יחידים בגאורגיה ממוסה ב־20% אחיד. תושב לא משלם מס גאורגי על הכנסה שמקורה אינו בגאורגיה, למשל משכורת מחברה בחו"ל. המדינה שלך עדיין עשויה לרצות את חלקה, אז בדוק את הכללים שלה והאם יש לה אמנה למניעת כפל מס עם גאורגיה לפני שאתה סופר על פחות מס.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'אם אתה עובד עצמאי',
            body: 'אם תירשם כיזם יחיד תוכל לבקש מעמד של עסק קטן. אז תשלם 1% מהמחזור כל עוד הוא מתחת ל־500,000 לארי בשנה, ו־3% אם הוא עובר את זה. עסקים זעירים עם מחזור שנתי מתחת ל־30,000 לארי וללא עובדים יכולים להירשם כמיקרו עסק ולא לשלם מס על ההכנסה הזו.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'השכרה או מכירה של דירה',
            body: 'אם אתה משכיר דירה למגורים ולא מנכה הוצאות, המס על השכירות הוא 5%. גם רווח ממכירת דירה או בית עם הקרקע שלו ממוסה ב־5%.',
          },
          {
            kind: 'NOTES',
            heading: 'בלי 183 ימים: מסלול בעלי ההון',
            body: 'יש דרך שנייה לבעלי הון משמעותי. לפי הכללים אפשר לפנות לרשות ההכנסות אם הרכוש שלך שווה יותר מ־3 מיליון לארי או שההכנסה שלך עלתה על 200,000 לארי בכל אחת משלוש השנים האחרונות, ובנוסף יש לך היתר שהייה בגאורגיה או לפחות 25,000 לארי הכנסה גאורגית. יועצים מדווחים על תנאים נוספים מ־2023, אז בדוק את הכללים העדכניים ברשות ההכנסות לפני שאתה מגיש.',
          },
          {
            kind: 'WHERE',
            heading: 'את מי לשאול',
            body: 'רשות ההכנסות של גאורגיה (rs.ge) מחליטה על תושבות ומנפיקה את אישור תושבות המס שבנקים ומדינות אחרות מבקשים לעיתים קרובות. בכל דבר שנוגע לשתי מדינות, דבר עם יועץ מס שמכיר את שתיהן.',
          },
        ],
      },
    },
    facts: [
      {
        key: 'residency-183-days',
        factClass: 'LEGAL',
        register: 'OFFICIAL_REQUIREMENT',
        availability: 'ESTABLISHED',
        sources: ['oecdGeorgiaResidency'],
        value: { days: 183, windowMonths: 12 },
        statement: {
          en: 'Under Article 34 of the Tax Code, a person who actually stays in Georgia for 183 days or more in any continuous 12 month period ending in the tax year is a Georgian resident for that whole year. Residency is set for each tax period.',
          ka: 'საგადასახადო კოდექსის 34-ე მუხლით, პირი, რომელიც საგადასახადო წელს დასრულებულ ნებისმიერ უწყვეტ 12 თვეში საქართველოში ფაქტობრივად 183 დღე ან მეტი იმყოფება, მთელი ამ წლის რეზიდენტია. სტატუსი ყოველ საგადასახადო პერიოდზე დგინდება.',
          ru: 'Согласно статье 34 Налогового кодекса, лицо, фактически находившееся в Грузии 183 дня или больше в любом непрерывном 12 месячном периоде, заканчивающемся в налоговом году, является резидентом за весь этот год. Статус устанавливается на каждый налоговый период.',
          tr: 'Vergi Kanunu\'nun 34. maddesine göre, vergi yılında biten herhangi bir kesintisiz 12 aylık dönemde Gürcistan\'da fiilen 183 gün veya daha fazla kalan kişi o yılın tamamı için mukimdir. Statü her vergi dönemi için belirlenir.',
          ar: 'بموجب المادة 34 من قانون الضرائب، الشخص الذي يمكث فعليًا في جورجيا 183 يومًا أو أكثر خلال أي فترة متصلة من 12 شهرًا تنتهي في السنة الضريبية يُعد مقيمًا عن تلك السنة كلها، ويُحدَّد الوضع لكل فترة ضريبية.',
          he: 'לפי סעיף 34 לקוד המס, אדם ששוהה בפועל בגאורגיה 183 ימים או יותר בתקופה רצופה כלשהי של 12 חודשים שמסתיימת בשנת המס הוא תושב לכל אותה שנה. המעמד נקבע לכל תקופת מס.',
        },
      },
      {
        key: 'flat-income-tax-and-foreign-income',
        factClass: 'LEGAL',
        register: 'PRACTICAL_CONTEXT',
        availability: 'ESTABLISHED',
        sources: ['pwcGeorgiaIncome'],
        value: { rate: 0.2 },
        statement: {
          en: 'Personal income in Georgia is taxed at a flat 20%. Resident individuals are exempt from tax on income that does not have a Georgian source.',
          ka: 'ფიზიკური პირის შემოსავალი საქართველოში ერთიანი 20%-ით იბეგრება. რეზიდენტი ფიზიკური პირი გათავისუფლებულია გადასახადისგან შემოსავალზე, რომლის წყარო საქართველოში არ არის.',
          ru: 'Доход физических лиц в Грузии облагается по единой ставке 20%. Резиденты освобождены от налога на доход, источник которого не в Грузии.',
          tr: 'Gürcistan\'da kişisel gelir düz %20 oranında vergilendirilir. Mukim bireyler, kaynağı Gürcistan olmayan gelir için vergiden muaftır.',
          ar: 'يخضع الدخل الشخصي في جورجيا لضريبة ثابتة بنسبة 20%، ويُعفى الأفراد المقيمون من الضريبة على الدخل الذي ليس مصدره جورجيا.',
          he: 'הכנסה אישית בגאורגיה ממוסה ב־20% אחיד. תושבים פטורים ממס על הכנסה שמקורה אינו בגאורגיה.',
        },
      },
    ],
  },
];
