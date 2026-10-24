// FOR EXPATS content — the everyday guide: getting around, phones, where to
// live, renting, health, a small business, trips and small daily things.
//
// Written on 2026-10-24 from the pages in sources-guide.mjs, every one of
// them opened and read that day. Same rules as the other topic files:
// friendly, plain, no dashes, and nothing stated as fact that a source did
// not say. Where we could not read the authority (Georgian Railway fares,
// Batumi bus fares, lease registration rules in the Civil Code, pharmacy
// rules, state healthcare eligibility), the text says to ask the office
// named instead of guessing.
//
// Prices appear only where the authority publishes them: Tbilisi Transport
// Company fares and Public Registry fees. Everything else that costs money
// is left without a number on purpose, because operator plans and rents
// change faster than this page is reviewed.

export const GUIDE_TOPICS = [
  {
    slug: 'public-transport',
    domain: 'TRANSPORT',
    pathway: 'LIVE',
    factClass: 'FEE',
    register: 'OFFICIAL_REQUIREMENT',
    sortOrder: 50,
    content: {
      en: {
        title: 'Getting around: metro, buses, trains and taxis',
        summary:
          'In Tbilisi the metro and buses are cheap and simple once you have a card. Between cities you can take the train or a minibus, and for taxis an app is the easy way.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'The short answer',
            body: 'In Tbilisi one ride on the metro, a city bus or a city minibus costs 1 lari and gives you 90 minutes of travel. Tap a Metromoney card or your own bank card on the reader. If you travel every day, a pass on a transport card works out cheaper. For a taxi, use an app so you see the price before you get in.',
          },
          {
            kind: 'COST',
            heading: 'Tbilisi fares',
            body: '1 lari for 90 minutes, 3 lari for a day, 20 lari for a week, 40 lari for a month. These cover the metro, buses, minibuses and the Bagebi University ropeway. Passes of a day or longer only work on a transport card, not on a bank card. If you pay in the mobile app or with cash, you do not get the 90 minutes. These are the Tbilisi Transport Company fares as we read them in October 2026.',
          },
          {
            kind: 'WHERE',
            heading: 'Where to get a transport card',
            body: 'At the ticket office of any metro station and at Bank of Georgia express branches. The card itself costs 2 lari. Keep the receipt, because it is the only way to get your money back on a card you lose or break.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Batumi, trains and minibuses',
            body: 'In Batumi the city buses are cheapest with the Batumi Card. A contactless bank card also works but costs a little more, and city buses do not take cash, though minibuses do. Trains from Tbilisi go to Batumi, Kutaisi, Poti, Zugdidi, Ozurgeti and other towns. Buy the ticket online, it arrives by email as a QR code, and carry your passport, because without an ID you will not be let on. Intercity minibuses, called marshrutkas, leave from the bus stations. Times and prices depend on the route, so ask at the station.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Taxis',
            body: 'Bolt, Yandex Go and Maxim all work in Tbilisi and show the price before you order. Street taxis have no meter, so agree the price before you sit down.',
          },
        ],
      },
      ka: {
        title: 'გადაადგილება: მეტრო, ავტობუსი, მატარებელი და ტაქსი',
        summary:
          'თბილისში მეტრო და ავტობუსი იაფი და მარტივია, როცა ბარათი გაქვთ. ქალაქებს შორის შეგიძლიათ მატარებლით ან მიკროავტობუსით იმგზავროთ, ტაქსისთვის კი აპლიკაცია ყველაზე მოსახერხებელია.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'მოკლე პასუხი',
            body: 'თბილისში მეტროში, ქალაქის ავტობუსში ან მიკროავტობუსში ერთი მგზავრობა 1 ლარი ღირს და 90 წუთის განმავლობაში მოქმედებს. მიადეთ წამკითხველს მეტრომანის ბარათი ან თქვენი საბანკო ბარათი. თუ ყოველდღე მგზავრობთ, სამგზავრო ბარათზე აბონემენტი უფრო იაფი გამოვა. ტაქსისთვის გამოიყენეთ აპლიკაცია, რომ ფასი ჩაჯდომამდე იცოდეთ.',
          },
          {
            kind: 'COST',
            heading: 'ტარიფები თბილისში',
            body: '1 ლარი 90 წუთზე, 3 ლარი ერთ დღეზე, 20 ლარი ერთ კვირაზე, 40 ლარი ერთ თვეზე. ეს მოქმედებს მეტროზე, ავტობუსზე, მიკროავტობუსზე და ბაგები-უნივერსიტეტის საბაგიროზე. ერთდღიანი და უფრო გრძელი აბონემენტი მხოლოდ სამგზავრო ბარათზე მუშაობს, საბანკო ბარათზე არა. მობილური აპლიკაციით ან ნაღდი ფულით გადახდისას 90 წუთი არ მოქმედებს. ეს თბილისის სატრანსპორტო კომპანიის ტარიფებია, როგორც 2026 წლის ოქტომბერში წავიკითხეთ.',
          },
          {
            kind: 'WHERE',
            heading: 'სად აიღოთ სამგზავრო ბარათი',
            body: 'ნებისმიერი მეტროსადგურის სალაროში და საქართველოს ბანკის ექსპრეს ფილიალებში. ბარათი 2 ლარი ღირს. შეინახეთ ქვითარი, რადგან დაკარგული ან დაზიანებული ბარათის აღდგენა მხოლოდ მისით შეიძლება.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'ბათუმი, მატარებელი და მარშრუტკა',
            body: 'ბათუმში ქალაქის ავტობუსი ყველაზე იაფია ბათუმის ბარათით. უკონტაქტო საბანკო ბარათიც მუშაობს, ოღონდ ცოტა უფრო ძვირი ჯდება. ქალაქის ავტობუსი ნაღდ ფულს არ იღებს, მიკროავტობუსი კი იღებს. თბილისიდან მატარებელი დადის ბათუმში, ქუთაისში, ფოთში, ზუგდიდში, ოზურგეთში და სხვა ქალაქებში. ბილეთი იყიდეთ ონლაინ, ელფოსტაზე QR კოდად მოგივათ. თან იქონიეთ პასპორტი, პირადობის დამადასტურებელი დოკუმენტის გარეშე მატარებელში არ შეგიშვებენ. ქალაქთაშორისი მარშრუტკები ავტოსადგურებიდან გადის. დრო და ფასი მარშრუტზეა დამოკიდებული, ამიტომ იკითხეთ ადგილზე.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'ტაქსი',
            body: 'თბილისში მუშაობს Bolt, Yandex Go და Maxim, და სამივე შეკვეთამდე გაჩვენებთ ფასს. ქუჩის ტაქსს მრიცხველი არ აქვს, ამიტომ ფასზე ჩაჯდომამდე შეთანხმდით.',
          },
        ],
      },
      ru: {
        title: 'Как передвигаться: метро, автобусы, поезда и такси',
        summary:
          'В Тбилиси метро и автобусы дешёвые и простые, если у вас есть карта. Между городами можно ехать поездом или маршруткой, а такси проще всего заказывать через приложение.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'Коротко',
            body: 'В Тбилиси одна поездка на метро, городском автобусе или маршрутке стоит 1 лари и действует 90 минут. Приложите к валидатору карту Metromoney или свою банковскую карту. Если ездите каждый день, абонемент на транспортной карте выйдет дешевле. Такси лучше заказывать через приложение, чтобы видеть цену заранее.',
          },
          {
            kind: 'COST',
            heading: 'Тарифы в Тбилиси',
            body: '1 лари за 90 минут, 3 лари за день, 20 лари за неделю, 40 лари за месяц. Это действует в метро, автобусах, маршрутках и на канатной дороге Багеби Университет. Абонементы на день и дольше работают только на транспортной карте, не на банковской. При оплате через мобильное приложение или наличными 90 минут не действуют. Это тарифы Тбилисской транспортной компании, как мы их прочитали в октябре 2026 года.',
          },
          {
            kind: 'WHERE',
            heading: 'Где взять транспортную карту',
            body: 'В кассе любой станции метро и в экспресс филиалах Bank of Georgia. Сама карта стоит 2 лари. Сохраните чек: только по нему можно восстановить потерянную или сломанную карту.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Батуми, поезда и маршрутки',
            body: 'В Батуми городские автобусы дешевле всего с Batumi Card. Бесконтактная банковская карта тоже работает, но выходит чуть дороже. Городские автобусы наличные не берут, маршрутки берут. Из Тбилиси поезда ходят в Батуми, Кутаиси, Поти, Зугдиди, Озургети и другие города. Билет покупайте онлайн, он придёт на почту QR кодом. Возьмите паспорт: без документа в поезд не пустят. Междугородние маршрутки уходят с автовокзалов. Время и цена зависят от маршрута, так что спрашивайте на месте.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Такси',
            body: 'В Тбилиси работают Bolt, Yandex Go и Maxim, и все показывают цену до заказа. У уличного такси нет счётчика, поэтому договоритесь о цене до того, как сядете.',
          },
        ],
      },
      tr: {
        title: 'Ulaşım: metro, otobüs, tren ve taksi',
        summary:
          'Tiflis\'te metro ve otobüs, bir kartınız olduğunda ucuz ve kolaydır. Şehirler arasında tren ya da minibüsle gidebilirsiniz, taksi için en kolayı uygulamadır.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'Kısaca',
            body: 'Tiflis\'te metro, şehir otobüsü ya da şehir içi minibüste bir yolculuk 1 lari tutar ve 90 dakika geçerlidir. Metromoney kartınızı ya da kendi banka kartınızı okutun. Her gün yolculuk ediyorsanız ulaşım kartına abonman daha ucuza gelir. Taksi için uygulama kullanın, böylece fiyatı binmeden görürsünüz.',
          },
          {
            kind: 'COST',
            heading: 'Tiflis\'te ücretler',
            body: '90 dakika 1 lari, bir gün 3 lari, bir hafta 20 lari, bir ay 40 lari. Metro, otobüs, minibüs ve Bagebi Üniversite teleferiğinde geçerlidir. Bir günlük ve daha uzun abonmanlar yalnızca ulaşım kartında çalışır, banka kartında çalışmaz. Mobil uygulamayla ya da nakit ödediğinizde 90 dakika hakkı olmaz. Bunlar Tiflis Ulaşım Şirketi\'nin ücretleri, Ekim 2026\'da okuduğumuz şekliyle.',
          },
          {
            kind: 'WHERE',
            heading: 'Ulaşım kartı nereden alınır',
            body: 'Herhangi bir metro istasyonunun gişesinden ve Bank of Georgia ekspres şubelerinden. Kartın kendisi 2 lari. Fişi saklayın, kaybolan ya da bozulan kartı geri almanın tek yolu bu.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Batum, trenler ve minibüsler',
            body: 'Batum\'da şehir otobüsleri en ucuz Batumi Card ile. Temassız banka kartı da çalışır ama biraz daha pahalıdır. Şehir otobüsleri nakit almaz, minibüsler alır. Tiflis\'ten trenler Batum, Kutaisi, Poti, Zugdidi, Ozurgeti ve başka şehirlere gider. Bileti internetten alın, e-postanıza QR kod olarak gelir. Pasaportunuzu yanınıza alın, kimlik olmadan trene bindirilmezsiniz. Şehirlerarası minibüsler, yani marşrutkalar, otogarlardan kalkar. Saat ve fiyat güzergâha göre değişir, otogarda sorun.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Taksi',
            body: 'Tiflis\'te Bolt, Yandex Go ve Maxim çalışır ve hepsi siparişten önce fiyatı gösterir. Sokak taksilerinde taksimetre yoktur, binmeden fiyatta anlaşın.',
          },
        ],
      },
      ar: {
        title: 'التنقل: المترو والحافلات والقطارات وسيارات الأجرة',
        summary:
          'في تبليسي المترو والحافلات رخيصة وسهلة متى صارت معك بطاقة. وبين المدن تستطيع ركوب القطار أو الميني باص، أما سيارة الأجرة فأسهل طريقة لها هي التطبيق.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'باختصار',
            body: 'في تبليسي تكلّف الرحلة الواحدة بالمترو أو الحافلة أو الميني باص داخل المدينة لاري واحدًا، وتصلح لمدة 90 دقيقة. مرّر بطاقة Metromoney أو بطاقتك البنكية على الجهاز. وإذا كنت تتنقل كل يوم فالاشتراك على بطاقة النقل أوفر. ولسيارة الأجرة استخدم تطبيقًا لترى السعر قبل أن تركب.',
          },
          {
            kind: 'COST',
            heading: 'الأسعار في تبليسي',
            body: 'لاري واحد لـ 90 دقيقة، و3 لاري ليوم، و20 لاري لأسبوع، و40 لاري لشهر. تشمل المترو والحافلات والميني باص وتلفريك باغيبي الجامعة. الاشتراك ليوم أو أكثر يعمل على بطاقة النقل فقط، لا على البطاقة البنكية. وإذا دفعت عبر التطبيق أو نقدًا فلا تحصل على الـ 90 دقيقة. هذه أسعار شركة النقل في تبليسي كما قرأناها في أكتوبر 2026.',
          },
          {
            kind: 'WHERE',
            heading: 'من أين تحصل على بطاقة النقل',
            body: 'من شباك التذاكر في أي محطة مترو، ومن فروع Bank of Georgia السريعة. ثمن البطاقة نفسها 2 لاري. احتفظ بالإيصال، فهو الطريقة الوحيدة لاسترجاع رصيد بطاقة ضاعت أو تلفت.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'باتومي والقطارات والميني باص',
            body: 'في باتومي أرخص طريقة لركوب الحافلات هي Batumi Card. البطاقة البنكية اللاتلامسية تعمل أيضًا لكنها أغلى قليلًا. حافلات المدينة لا تقبل النقد، أما الميني باص فيقبله. من تبليسي تذهب القطارات إلى باتومي وكوتايسي وبوتي وزوغديدي وأوزورغيتي ومدن أخرى. اشترِ التذكرة عبر الإنترنت وستصلك بالبريد الإلكتروني على شكل رمز QR. خذ جوازك معك، فبدون هوية لن يسمحوا لك بالصعود. الميني باص بين المدن، ويسمّونه مارشروتكا، ينطلق من محطات الحافلات، والمواعيد والأسعار تختلف حسب الخط، فاسأل في المحطة.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'سيارات الأجرة',
            body: 'في تبليسي تعمل تطبيقات Bolt وYandex Go وMaxim، وكلها تعرض السعر قبل الطلب. سيارات الأجرة في الشارع بلا عدّاد، فاتفق على السعر قبل أن تركب.',
          },
        ],
      },
      he: {
        title: 'להתנייד: מטרו, אוטובוסים, רכבות ומוניות',
        summary:
          'בטביליסי המטרו והאוטובוסים זולים ופשוטים ברגע שיש לכם כרטיס. בין ערים נוסעים ברכבת או במיניבוס, ולמונית הכי קל להזמין באפליקציה.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'בקצרה',
            body: 'בטביליסי נסיעה אחת במטרו, באוטובוס עירוני או במיניבוס עירוני עולה לארי אחד ותקפה ל־90 דקות. מצמידים לקורא כרטיס Metromoney או את כרטיס האשראי שלכם. אם נוסעים כל יום, מנוי על כרטיס תחבורה יוצא זול יותר. למונית השתמשו באפליקציה, כדי לראות את המחיר לפני שעולים.',
          },
          {
            kind: 'COST',
            heading: 'מחירים בטביליסי',
            body: 'לארי אחד ל־90 דקות, 3 לארי ליום, 20 לארי לשבוע, 40 לארי לחודש. זה תקף במטרו, באוטובוסים, במיניבוסים וברכבל באגבי אוניברסיטה. מנוי ליום ומעלה עובד רק על כרטיס תחבורה, לא על כרטיס אשראי. מי שמשלם באפליקציה או במזומן לא מקבל את 90 הדקות. אלה המחירים של חברת התחבורה של טביליסי, כפי שקראנו אותם באוקטובר 2026.',
          },
          {
            kind: 'WHERE',
            heading: 'איפה משיגים כרטיס תחבורה',
            body: 'בקופה של כל תחנת מטרו ובסניפי האקספרס של Bank of Georgia. הכרטיס עצמו עולה 2 לארי. שמרו את הקבלה, כי רק איתה אפשר לשחזר כרטיס שאבד או נשבר.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'בטומי, רכבות ומיניבוסים',
            body: 'בבטומי האוטובוסים העירוניים הכי זולים עם Batumi Card. כרטיס אשראי ללא מגע עובד גם, אבל עולה קצת יותר. האוטובוסים העירוניים לא מקבלים מזומן, המיניבוסים כן. מטביליסי יש רכבות לבטומי, קוטאיסי, פוטי, זוגדידי, אוזורגטי ועוד. קונים כרטיס באינטרנט והוא מגיע במייל כקוד QR. קחו דרכון, כי בלי תעודה מזהה לא יתנו לכם לעלות. מיניבוסים בין עירוניים, שנקראים מרשרוטקות, יוצאים מתחנות האוטובוס המרכזיות. השעות והמחירים תלויים בקו, אז שאלו בתחנה.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'מוניות',
            body: 'בטביליסי עובדות Bolt, Yandex Go ו־Maxim, וכולן מראות מחיר לפני ההזמנה. למוניות ברחוב אין מונה, אז סגרו מחיר לפני שאתם עולים.',
          },
        ],
      },
    },
    facts: [
      {
        key: 'tbilisi-fares',
        factClass: 'FEE',
        register: 'OFFICIAL_REQUIREMENT',
        availability: 'ESTABLISHED',
        sources: ['ttcFares'],
        value: { currency: 'GEL', minutes90: 1, day: 3, week: 20, month: 40, card: 2 },
        statement: {
          en: 'Tbilisi public transport costs 1 lari for 90 minutes of unlimited travel, 3 lari for a day, 20 lari for a week and 40 lari for a month. Passes of a day or longer only work on a transport card, which costs 2 lari.',
          ka: 'თბილისის საზოგადოებრივი ტრანსპორტი ღირს 1 ლარი 90 წუთის შეუზღუდავ მგზავრობაზე, 3 ლარი ერთ დღეზე, 20 ლარი ერთ კვირაზე და 40 ლარი ერთ თვეზე. ერთდღიანი და უფრო გრძელი აბონემენტი მხოლოდ სამგზავრო ბარათზე მოქმედებს, რომელიც 2 ლარი ღირს.',
          ru: 'Общественный транспорт Тбилиси стоит 1 лари за 90 минут неограниченных поездок, 3 лари за день, 20 лари за неделю и 40 лари за месяц. Абонементы на день и дольше работают только на транспортной карте, которая стоит 2 лари.',
          tr: 'Tiflis toplu taşıması 90 dakika sınırsız yolculuk için 1 lari, bir gün için 3 lari, bir hafta için 20 lari ve bir ay için 40 lari tutar. Bir günlük ve daha uzun abonmanlar yalnızca 2 lari olan ulaşım kartında geçerlidir.',
          ar: 'تكلّف المواصلات العامة في تبليسي لاريًا واحدًا لـ 90 دقيقة من التنقل غير المحدود، و3 لاري ليوم، و20 لاري لأسبوع، و40 لاري لشهر. الاشتراك ليوم أو أكثر يعمل فقط على بطاقة النقل وثمنها 2 لاري.',
          he: 'התחבורה הציבורית בטביליסי עולה לארי אחד ל־90 דקות של נסיעות ללא הגבלה, 3 לארי ליום, 20 לארי לשבוע ו־40 לארי לחודש. מנוי ליום ומעלה עובד רק על כרטיס תחבורה, שעולה 2 לארי.',
        },
      },
      {
        key: 'train-id-required',
        factClass: 'PROCESS',
        register: 'PRACTICAL_CONTEXT',
        availability: 'ESTABLISHED',
        sources: ['tktRailway'],
        value: null,
        statement: {
          en: 'Georgian Railway tickets can be bought online and arrive as a QR code by email. Passengers must carry an ID card or passport on the train.',
          ka: 'საქართველოს რკინიგზის ბილეთის ყიდვა ონლაინ შეიძლება და ელფოსტაზე QR კოდად მოდის. მგზავრს მატარებელში პირადობის მოწმობა ან პასპორტი უნდა ჰქონდეს.',
          ru: 'Билеты Грузинской железной дороги можно купить онлайн, они приходят на почту QR кодом. В поезде у пассажира должно быть удостоверение личности или паспорт.',
          tr: 'Gürcistan Demiryolları biletleri internetten alınabilir ve e-postayla QR kod olarak gelir. Yolcuların trende kimlik kartı ya da pasaport taşıması gerekir.',
          ar: 'يمكن شراء تذاكر سكك حديد جورجيا عبر الإنترنت، وتصل بالبريد الإلكتروني على شكل رمز QR. ويجب أن يحمل الراكب بطاقة هوية أو جواز سفر في القطار.',
          he: 'כרטיסים של רכבת גאורגיה אפשר לקנות באינטרנט, והם מגיעים במייל כקוד QR. נוסעים חייבים להחזיק ברכבת תעודת זהות או דרכון.',
        },
      },
      {
        key: 'batumi-card-and-taxi-apps',
        factClass: 'PROCESS',
        register: 'PRACTICAL_CONTEXT',
        availability: 'ESTABLISHED',
        sources: ['madlobaBatumiBus', 'madlobaTaxi'],
        value: null,
        statement: {
          en: 'Batumi city buses are cheapest with the Batumi Card, a contactless bank card costs more, and city buses do not take cash. In Tbilisi, taxi apps such as Bolt, Yandex Go and Maxim show the price in advance, while street taxis have no meter.',
          ka: 'ბათუმში ქალაქის ავტობუსი ყველაზე იაფია ბათუმის ბარათით, უკონტაქტო საბანკო ბარათით უფრო ძვირია, ნაღდ ფულს კი ქალაქის ავტობუსი არ იღებს. თბილისში ტაქსის აპლიკაციები, მაგალითად Bolt, Yandex Go და Maxim, ფასს წინასწარ აჩვენებს, ქუჩის ტაქსს კი მრიცხველი არ აქვს.',
          ru: 'Городские автобусы Батуми дешевле всего с Batumi Card, бесконтактная банковская карта дороже, а наличные городские автобусы не берут. В Тбилиси приложения такси, например Bolt, Yandex Go и Maxim, показывают цену заранее, а у уличного такси нет счётчика.',
          tr: 'Batum şehir otobüsleri en ucuz Batumi Card ile, temassız banka kartı daha pahalıdır ve şehir otobüsleri nakit almaz. Tiflis\'te Bolt, Yandex Go ve Maxim gibi taksi uygulamaları fiyatı önceden gösterir, sokak taksilerinde ise taksimetre yoktur.',
          ar: 'حافلات باتومي أرخص مع Batumi Card، والبطاقة البنكية اللاتلامسية أغلى، وحافلات المدينة لا تقبل النقد. وفي تبليسي تعرض تطبيقات الأجرة مثل Bolt وYandex Go وMaxim السعر مسبقًا، أما سيارات الأجرة في الشارع فبلا عدّاد.',
          he: 'האוטובוסים העירוניים בבטומי הכי זולים עם Batumi Card, כרטיס אשראי ללא מגע יקר יותר, והאוטובוסים העירוניים לא מקבלים מזומן. בטביליסי אפליקציות מוניות כמו Bolt, Yandex Go ו־Maxim מראות את המחיר מראש, ולמוניות ברחוב אין מונה.',
        },
      },
    ],
  },

  {
    slug: 'mobile-and-internet',
    domain: 'DAILY_LIFE',
    pathway: 'LIVE',
    factClass: 'PROCESS',
    register: 'PRACTICAL_CONTEXT',
    sortOrder: 60,
    content: {
      en: {
        title: 'A phone number and internet at home',
        summary:
          'Getting a Georgian number is quick. Bring your passport to an operator shop and you can walk out connected. Home internet is usually fibre and is easy to set up.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'The short answer',
            body: 'There are three mobile operators: Magti, Silknet and Cellfie. Go to one of their shops with your passport, because the number is registered in your name. If your phone takes an eSIM, the operators offer that too, and you can even set one up online before you arrive.',
          },
          {
            kind: 'WHERE',
            heading: 'Where to buy',
            body: 'At the operators\' own shops in every city, and at the airports in Tbilisi, Kutaisi and Batumi. Airport shops are handy on day one. Magti sells SIM cards for tourists at the airports.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Which operator',
            body: 'All three work well in the cities. In the mountains Magti usually has the best coverage, which matters if you travel to places like Svaneti or Kazbegi. Plans and prices change often, so look at the operator\'s own website for what is on offer today. We do not list prices here for that reason.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Internet at home',
            body: 'Most homes in the cities can get fibre optic internet, and the operators often sell it together with TV. Many rented flats already have internet, so ask the owner whose name the contract is in and whether it is included in the rent. To sign a new contract, bring your passport and the address.',
          },
          {
            kind: 'NOTES',
            heading: 'Before you buy an eSIM',
            body: 'Check that your phone supports eSIM and is not locked to an operator back home. Magti lets you activate an eSIM in its MyMagti app.',
          },
        ],
      },
      ka: {
        title: 'ტელეფონის ნომერი და ინტერნეტი სახლში',
        summary:
          'ქართული ნომრის აღება სწრაფად ხდება. მიიტანეთ პასპორტი ოპერატორის მაღაზიაში და იქიდან უკვე კავშირით გამოხვალთ. სახლის ინტერნეტი, როგორც წესი, ოპტიკურია და მარტივად ერთდება.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'მოკლე პასუხი',
            body: 'მობილური ოპერატორი სამია: მაგთი, სილქნეტი და სელფი. მიდით რომელიმე მათგანის მაღაზიაში პასპორტით, რადგან ნომერი თქვენს სახელზე რეგისტრირდება. თუ თქვენი ტელეფონი eSIM-ს იღებს, ოპერატორები ამასაც გთავაზობენ, და მისი გააქტიურება ჩამოსვლამდე ონლაინაც შეგიძლიათ.',
          },
          {
            kind: 'WHERE',
            heading: 'სად იყიდოთ',
            body: 'ოპერატორების მაღაზიებში ყველა ქალაქში და თბილისის, ქუთაისისა და ბათუმის აეროპორტებში. აეროპორტის მაღაზია პირველ დღეს ძალიან მოსახერხებელია. მაგთი აეროპორტებში ტურისტულ სიმ ბარათებს ყიდის.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'რომელი ოპერატორი',
            body: 'სამივე კარგად მუშაობს ქალაქებში. მთაში, როგორც წესი, მაგთის აქვს საუკეთესო დაფარვა, რაც მნიშვნელოვანია, თუ სვანეთში ან ყაზბეგში აპირებთ წასვლას. ტარიფები და ფასები ხშირად იცვლება, ამიტომ დღევანდელი შეთავაზება ოპერატორის საიტზე ნახეთ. ამ მიზეზით ფასებს აქ არ ვწერთ.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'ინტერნეტი სახლში',
            body: 'ქალაქებში სახლების უმეტესობაში ოპტიკური ინტერნეტის შეყვანა შეიძლება და ოპერატორები მას ხშირად ტელევიზიასთან ერთად ყიდიან. ბევრ ნაქირავებ ბინაში ინტერნეტი უკვე არის, ამიტომ ჰკითხეთ მესაკუთრეს, ვის სახელზეა ხელშეკრულება და შედის თუ არა ქირაში. ახალი ხელშეკრულებისთვის წაიღეთ პასპორტი და იცოდეთ მისამართი.',
          },
          {
            kind: 'NOTES',
            heading: 'სანამ eSIM-ს იყიდით',
            body: 'გადაამოწმეთ, რომ თქვენი ტელეფონი eSIM-ს უჭერს მხარს და სამშობლოს ოპერატორზე დაბლოკილი არ არის. მაგთი eSIM-ის გააქტიურების საშუალებას MyMagti აპლიკაციაში იძლევა.',
          },
        ],
      },
      ru: {
        title: 'Номер телефона и домашний интернет',
        summary:
          'Получить грузинский номер можно быстро. Придите с паспортом в салон оператора и выйдете уже на связи. Домашний интернет обычно оптоволоконный и подключается легко.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'Коротко',
            body: 'Мобильных операторов три: Magti, Silknet и Cellfie. Идите в салон любого из них с паспортом, потому что номер регистрируется на ваше имя. Если телефон поддерживает eSIM, операторы предлагают и его, причём оформить его можно онлайн ещё до приезда.',
          },
          {
            kind: 'WHERE',
            heading: 'Где купить',
            body: 'В салонах операторов в любом городе и в аэропортах Тбилиси, Кутаиси и Батуми. Салон в аэропорту удобен в первый день. Magti продаёт в аэропортах туристические SIM карты.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Какого оператора выбрать',
            body: 'В городах хорошо работают все три. В горах лучшее покрытие обычно у Magti, это важно, если поедете в Сванетию или Казбеги. Тарифы и цены часто меняются, поэтому смотрите актуальные предложения на сайте оператора. По этой причине цен здесь нет.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Интернет дома',
            body: 'В большинстве домов в городах можно провести оптоволокно, и операторы часто продают его вместе с ТВ. Во многих съёмных квартирах интернет уже есть, так что спросите хозяина, на кого оформлен договор и входит ли он в аренду. Для нового договора возьмите паспорт и знайте адрес.',
          },
          {
            kind: 'NOTES',
            heading: 'Перед покупкой eSIM',
            body: 'Проверьте, что телефон поддерживает eSIM и не привязан к оператору у вас дома. У Magti eSIM можно активировать в приложении MyMagti.',
          },
        ],
      },
      tr: {
        title: 'Telefon numarası ve evde internet',
        summary:
          'Gürcü numarası almak hızlıdır. Pasaportunuzla bir operatör mağazasına gidin, bağlanmış olarak çıkarsınız. Ev interneti genellikle fiberdir ve kolayca kurulur.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'Kısaca',
            body: 'Üç mobil operatör var: Magti, Silknet ve Cellfie. Birinin mağazasına pasaportunuzla gidin, çünkü numara sizin adınıza kaydedilir. Telefonunuz eSIM destekliyorsa operatörler bunu da sunar, hatta gelmeden önce internetten alabilirsiniz.',
          },
          {
            kind: 'WHERE',
            heading: 'Nereden alınır',
            body: 'Her şehirde operatörlerin kendi mağazalarından ve Tiflis, Kutaisi ve Batum havalimanlarından. Havalimanı mağazası ilk gün için pratiktir. Magti havalimanlarında turistlere SIM kart satar.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Hangi operatör',
            body: 'Şehirlerde üçü de iyi çalışır. Dağlarda genellikle en iyi kapsama Magti\'dedir, Svaneti ya da Kazbegi gibi yerlere gidecekseniz bu önemlidir. Tarifeler ve fiyatlar sık değişir, bugünkü teklifleri operatörün sitesinden bakın. Bu yüzden burada fiyat yazmıyoruz.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Evde internet',
            body: 'Şehirlerdeki çoğu eve fiber internet bağlanabilir ve operatörler bunu çoğu zaman TV ile birlikte satar. Birçok kiralık dairede internet zaten vardır, ev sahibine sözleşmenin kimin adına olduğunu ve kiraya dahil olup olmadığını sorun. Yeni sözleşme için pasaportunuzu ve adresi getirin.',
          },
          {
            kind: 'NOTES',
            heading: 'eSIM almadan önce',
            body: 'Telefonunuzun eSIM desteklediğini ve kendi ülkenizdeki bir operatöre kilitli olmadığını kontrol edin. Magti\'de eSIM, MyMagti uygulamasından etkinleştirilebilir.',
          },
        ],
      },
      ar: {
        title: 'رقم هاتف وإنترنت في البيت',
        summary:
          'الحصول على رقم جورجي سريع. خذ جوازك إلى متجر إحدى الشركات وستخرج وهاتفك يعمل. وإنترنت البيت غالبًا ألياف ضوئية وتركيبه سهل.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'باختصار',
            body: 'هناك ثلاث شركات اتصالات: Magti وSilknet وCellfie. اذهب إلى متجر أي منها ومعك جوازك، لأن الرقم يُسجَّل باسمك. وإذا كان هاتفك يدعم eSIM فالشركات توفرها أيضًا، ويمكنك ترتيبها عبر الإنترنت قبل أن تصل.',
          },
          {
            kind: 'WHERE',
            heading: 'من أين تشتري',
            body: 'من متاجر الشركات في كل المدن، ومن مطارات تبليسي وكوتايسي وباتومي. متجر المطار مريح في اليوم الأول، وMagti تبيع في المطارات شرائح خاصة بالسياح.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'أي شركة تختار',
            body: 'الثلاث تعمل جيدًا في المدن. أما في الجبال فتغطية Magti هي الأفضل عادة، وهذا مهم إذا كنت ستزور سفانيتي أو كازبيغي. الباقات والأسعار تتغير كثيرًا، فاطّلع على العروض الحالية في موقع الشركة نفسها، ولهذا لا نذكر أسعارًا هنا.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'الإنترنت في البيت',
            body: 'معظم البيوت في المدن يمكن توصيلها بإنترنت الألياف الضوئية، وكثيرًا ما تبيعه الشركات مع التلفزيون. وفي شقق إيجار كثيرة يكون الإنترنت موجودًا أصلًا، فاسأل المالك باسم من العقد وهل هو داخل في الإيجار. ولعقد جديد خذ جوازك واعرف العنوان.',
          },
          {
            kind: 'NOTES',
            heading: 'قبل أن تشتري eSIM',
            body: 'تأكد أن هاتفك يدعم eSIM وأنه غير مقفل على شركة في بلدك. وفي Magti يمكنك تفعيل eSIM من تطبيق MyMagti.',
          },
        ],
      },
      he: {
        title: 'מספר טלפון ואינטרנט בבית',
        summary:
          'להשיג מספר גאורגי זה מהיר. באים עם דרכון לחנות של מפעיל ויוצאים עם קליטה. אינטרנט ביתי הוא בדרך כלל סיבים, וקל לחבר אותו.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'בקצרה',
            body: 'יש שלושה מפעילים סלולריים: Magti, Silknet ו־Cellfie. לכו לחנות של אחד מהם עם דרכון, כי המספר נרשם על שמכם. אם הטלפון תומך ב־eSIM, המפעילים מציעים גם את זה, ואפשר אפילו להסדיר אותו באינטרנט לפני שמגיעים.',
          },
          {
            kind: 'WHERE',
            heading: 'איפה קונים',
            body: 'בחנויות של המפעילים בכל עיר ובשדות התעופה של טביליסי, קוטאיסי ובטומי. החנות בשדה נוחה ביום הראשון. Magti מוכרת בשדות התעופה סים לתיירים.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'איזה מפעיל',
            body: 'בערים שלושתם עובדים טוב. בהרים לרוב הכיסוי הכי טוב הוא של Magti, וזה חשוב אם אתם נוסעים למקומות כמו סוואנטי או קזבגי. החבילות והמחירים משתנים לעיתים קרובות, אז בדקו באתר של המפעיל מה מוצע היום. בגלל זה אנחנו לא כותבים כאן מחירים.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'אינטרנט בבית',
            body: 'ברוב הבתים בערים אפשר לחבר אינטרנט סיבים, והמפעילים מוכרים אותו הרבה פעמים יחד עם טלוויזיה. בהרבה דירות שכורות כבר יש אינטרנט, אז שאלו את בעל הדירה על שם מי החוזה והאם הוא כלול בשכירות. לחוזה חדש הביאו דרכון ואת הכתובת.',
          },
          {
            kind: 'NOTES',
            heading: 'לפני שקונים eSIM',
            body: 'בדקו שהטלפון תומך ב־eSIM ושהוא לא נעול למפעיל בבית. ב־Magti אפשר להפעיל eSIM דרך האפליקציה MyMagti.',
          },
        ],
      },
    },
    facts: [
      {
        key: 'sim-needs-passport',
        factClass: 'PROCESS',
        register: 'PRACTICAL_CONTEXT',
        availability: 'ESTABLISHED',
        sources: ['madlobaSim'],
        value: { operators: ['Magti', 'Silknet', 'Cellfie'] },
        statement: {
          en: 'Georgia has three mobile operators, Magti, Silknet and Cellfie. You need your passport to buy a SIM card, and the operators also offer eSIMs.',
          ka: 'საქართველოში სამი მობილური ოპერატორია: მაგთი, სილქნეტი და სელფი. სიმ ბარათის საყიდლად პასპორტი გჭირდებათ, ოპერატორები eSIM-საც გთავაზობენ.',
          ru: 'В Грузии три мобильных оператора: Magti, Silknet и Cellfie. Чтобы купить SIM карту, нужен паспорт, операторы также предлагают eSIM.',
          tr: 'Gürcistan\'da üç mobil operatör var: Magti, Silknet ve Cellfie. SIM kart almak için pasaport gerekir, operatörler eSIM de sunar.',
          ar: 'في جورجيا ثلاث شركات اتصالات: Magti وSilknet وCellfie. تحتاج إلى جوازك لشراء شريحة، والشركات توفر eSIM أيضًا.',
          he: 'בגאורגיה יש שלושה מפעילים סלולריים: Magti, Silknet ו־Cellfie. כדי לקנות סים צריך דרכון, והמפעילים מציעים גם eSIM.',
        },
      },
      {
        key: 'magti-esim-and-fibre',
        factClass: 'GENERAL',
        register: 'PRACTICAL_CONTEXT',
        availability: 'ESTABLISHED',
        sources: ['magticomHome'],
        value: null,
        statement: {
          en: 'Magti offers eSIM, activated in the MyMagti app, sells tourist SIM cards at Georgian airports, and sells fibre optic home internet.',
          ka: 'მაგთი გთავაზობთ eSIM-ს, რომელიც MyMagti აპლიკაციაში აქტიურდება, აეროპორტებში ტურისტულ სიმ ბარათებს ყიდის და ოპტიკურ სახლის ინტერნეტსაც გთავაზობთ.',
          ru: 'Magti предлагает eSIM с активацией в приложении MyMagti, продаёт туристические SIM карты в аэропортах Грузии и подключает оптоволоконный домашний интернет.',
          tr: 'Magti, MyMagti uygulamasından etkinleştirilen eSIM sunar, Gürcistan havalimanlarında turist SIM kartları satar ve fiber ev interneti sağlar.',
          ar: 'تقدّم Magti شريحة eSIM تُفعَّل من تطبيق MyMagti، وتبيع شرائح للسياح في مطارات جورجيا، وتوفر إنترنت الألياف الضوئية للبيوت.',
          he: 'Magti מציעה eSIM שמופעל באפליקציה MyMagti, מוכרת סים לתיירים בשדות התעופה בגאורגיה ומספקת אינטרנט סיבים לבית.',
        },
      },
    ],
  },
  {
    slug: 'cities-and-neighbourhoods',
    domain: 'DAILY_LIFE',
    pathway: 'LIVE',
    factClass: 'GENERAL',
    register: 'PRACTICAL_CONTEXT',
    sortOrder: 70,
    content: {
      en: {
        title: 'Cities and neighbourhoods',
        summary:
          'Most newcomers settle in Tbilisi or Batumi, and some choose Kutaisi. Each Tbilisi district has its own feel, so walk around a few before you decide.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'The short answer',
            body: 'Tbilisi is the capital and the biggest city, with the most work, schools and services. Batumi is the seaside city on the Black Sea. Kutaisi in the west is calmer and smaller. Inside Tbilisi, the old centre is lively and close to everything, Vake and Vera are greener and quieter, and Saburtalo is practical for everyday life with the metro close by.',
          },
          {
            kind: 'WHERE',
            heading: 'Tbilisi, district by district',
            body: 'Old Tbilisi and Sololaki: the historic heart, hilly and cobbled, with the sulphur baths and everything within walking distance. Expect visitors and some noise. Mtatsminda and Rustaveli Avenue: central, with the hill and its park above the city. Vera and Vake: quieter and greener, and Vake is seen as one of the most prestigious places to live. Saburtalo: good for longer stays, with the metro, shops and moderate prices. Didube: a bit cheaper, with good metro links. Marjanishvili, around Fabrika: lively and full of bars. Didi Dighomi and Gldani: large residential districts further from the centre, with lots of apartment blocks and a more local, everyday feel.',
          },
          {
            kind: 'WHERE',
            heading: 'Batumi',
            body: 'Batumi sits on the Black Sea coast and is the main city of Adjara. Life here is built around the sea and the long Boulevard by the beach. It is busy in summer and much quieter in the cold months, so if you can, visit in both seasons before you sign a long lease.',
          },
          {
            kind: 'WHERE',
            heading: 'Kutaisi, Zugdidi and other cities',
            body: 'Kutaisi was the capital of old Imereti and is now a calm city with Bagrati Cathedral and Gelati Monastery close by, and its own airport. Zugdidi is the main city of Samegrelo, home to the Dadiani Palace museum and the usual road to Svaneti. Other towns people move to include Rustavi near Tbilisi, Telavi in the Kakheti wine country, and seaside towns along the coast such as Kobuleti.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'How to choose',
            body: 'Visit a street in the morning and again at night. Check how far the nearest metro or bus stop is, how steep the hill is, and how the flat is heated in winter. Ask neighbours what it is like. For what things cost, see our cost of living page, because we keep prices there and update them.',
          },
        ],
      },
      ka: {
        title: 'ქალაქები და უბნები',
        summary:
          'ახალჩამოსულთა უმეტესობა თბილისში ან ბათუმში სახლდება, ზოგი ქუთაისს ირჩევს. თბილისში ყველა უბანს თავისი ხასიათი აქვს, ამიტომ არჩევამდე რამდენიმე მათგანი მოიარეთ.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'მოკლე პასუხი',
            body: 'თბილისი დედაქალაქი და ყველაზე დიდი ქალაქია, აქ არის ყველაზე მეტი სამსახური, სკოლა და მომსახურება. ბათუმი შავი ზღვის სანაპიროს ქალაქია. ქუთაისი დასავლეთში უფრო მშვიდი და პატარაა. თბილისში ძველი ცენტრი ცოცხალია და ყველაფერთან ახლოს, ვაკე და ვერა უფრო მწვანე და წყნარია, საბურთალო კი ყოველდღიური ცხოვრებისთვის მოსახერხებელია და მეტრო ახლოსაა.',
          },
          {
            kind: 'WHERE',
            heading: 'თბილისი, უბან უბან',
            body: 'ძველი თბილისი და სოლოლაკი: ისტორიული გული, აღმართები და ქვაფენილი, აბანოები და ყველაფერი ფეხით სავალ მანძილზე. აქ ბევრი სტუმარია და ხანდახან ხმაურია. მთაწმინდა და რუსთაველის გამზირი: ცენტრი, ქალაქს ზემოთ მთა და მისი პარკი. ვერა და ვაკე: უფრო წყნარი და მწვანე, ვაკე კი ერთ-ერთ ყველაზე პრესტიჟულ საცხოვრებელ უბნად ითვლება. საბურთალო: კარგია ხანგრძლივად ცხოვრებისთვის, მეტროთი, მაღაზიებით და ზომიერი ფასებით. დიდუბე: ცოტა უფრო იაფი, კარგი მეტრო კავშირით. მარჯანიშვილი, ფაბრიკის მიდამოები: ცოცხალი, ბევრი ბარით. დიდი დიღომი და გლდანი: ცენტრიდან მოშორებული დიდი საცხოვრებელი უბნები, ბევრი მრავალბინიანი სახლით და უფრო ადგილობრივი, ყოველდღიური ცხოვრებით.',
          },
          {
            kind: 'WHERE',
            heading: 'ბათუმი',
            body: 'ბათუმი შავი ზღვის სანაპიროზეა და აჭარის მთავარი ქალაქია. აქ ცხოვრება ზღვისა და სანაპიროს გრძელი ბულვარის გარშემო ტრიალებს. ზაფხულში ხალხმრავალია, ცივ თვეებში კი გაცილებით წყნარი, ამიტომ, თუ შეძლებთ, გრძელვადიან ქირაობამდე ორივე სეზონში ნახეთ.',
          },
          {
            kind: 'WHERE',
            heading: 'ქუთაისი, ზუგდიდი და სხვა ქალაქები',
            body: 'ქუთაისი ძველი იმერეთის დედაქალაქი იყო, დღეს კი მშვიდი ქალაქია, ახლოს ბაგრატის ტაძრით და გელათის მონასტრით, საკუთარი აეროპორტით. ზუგდიდი სამეგრელოს მთავარი ქალაქია, აქ არის დადიანების სასახლის მუზეუმი და აქედან მიდის ჩვეული გზა სვანეთისკენ. ხალხი ასევე სახლდება რუსთავში თბილისთან ახლოს, თელავში კახეთის ღვინის მხარეში და ზღვისპირა ქალაქებში, მაგალითად ქობულეთში.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'როგორ აირჩიოთ',
            body: 'ქუჩა ნახეთ დილით და ერთხელ ღამითაც. გადაამოწმეთ, რამდენად შორსაა მეტრო ან გაჩერება, რამდენად ციცაბოა აღმართი და როგორ თბება ბინა ზამთარში. ჰკითხეთ მეზობლებს, როგორია აქ ცხოვრება. ფასებისთვის ნახეთ ჩვენი გვერდი ცხოვრების ღირებულებაზე, იქ ვინახავთ და ვაახლებთ ფასებს.',
          },
        ],
      },
      ru: {
        title: 'Города и районы',
        summary:
          'Большинство приезжих живёт в Тбилиси или Батуми, некоторые выбирают Кутаиси. У каждого района Тбилиси свой характер, так что прогуляйтесь по нескольким, прежде чем решать.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'Коротко',
            body: 'Тбилиси это столица и самый большой город, здесь больше всего работы, школ и услуг. Батуми это город у Чёрного моря. Кутаиси на западе спокойнее и меньше. В Тбилиси старый центр оживлённый и близко ко всему, Ваке и Вера зеленее и тише, а Сабуртало удобно для повседневной жизни, и метро рядом.',
          },
          {
            kind: 'WHERE',
            heading: 'Тбилиси по районам',
            body: 'Старый Тбилиси и Сололаки: историческое сердце, холмы и брусчатка, серные бани, всё в пешей доступности. Здесь много гостей и бывает шумно. Мтацминда и проспект Руставели: центр, над городом гора и её парк. Вера и Ваке: тише и зеленее, а Ваке считается одним из самых престижных районов для жизни. Сабуртало: хорошо для долгого проживания, есть метро, магазины и умеренные цены. Дидубе: чуть дешевле, с хорошим метро. Марджанишвили, около Фабрики: оживлённо, много баров. Диди Дигоми и Глдани: большие спальные районы дальше от центра, много многоэтажек и более местная, будничная жизнь.',
          },
          {
            kind: 'WHERE',
            heading: 'Батуми',
            body: 'Батуми стоит на берегу Чёрного моря и это главный город Аджарии. Жизнь здесь крутится вокруг моря и длинного Бульвара вдоль пляжа. Летом многолюдно, в холодные месяцы гораздо тише, поэтому, если можете, посмотрите город в оба сезона, прежде чем подписывать долгую аренду.',
          },
          {
            kind: 'WHERE',
            heading: 'Кутаиси, Зугдиди и другие города',
            body: 'Кутаиси был столицей древней Имеретии, а сейчас это спокойный город, рядом храм Баграта и монастырь Гелати, есть свой аэропорт. Зугдиди это главный город Самегрело, здесь музей во дворце Дадиани и обычная дорога в Сванетию. Ещё переезжают в Рустави рядом с Тбилиси, в Телави в винной Кахетии и в приморские города, например Кобулети.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Как выбрать',
            body: 'Посмотрите улицу утром и ещё раз вечером. Проверьте, далеко ли метро или остановка, насколько крутой подъём и как квартира отапливается зимой. Спросите соседей, как тут живётся. Цены смотрите на нашей странице о стоимости жизни, мы держим их там и обновляем.',
          },
        ],
      },
      tr: {
        title: 'Şehirler ve semtler',
        summary:
          'Yeni gelenlerin çoğu Tiflis ya da Batum\'a yerleşir, bazıları Kutaisi\'yi seçer. Tiflis\'in her semtinin kendine özgü bir havası var, karar vermeden önce birkaçını gezin.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'Kısaca',
            body: 'Tiflis başkent ve en büyük şehirdir, en çok iş, okul ve hizmet buradadır. Batum Karadeniz kıyısındaki şehirdir. Batıdaki Kutaisi daha sakin ve küçüktür. Tiflis\'te eski merkez canlı ve her yere yakındır, Vake ve Vera daha yeşil ve sakindir, Saburtalo ise metroya yakınlığıyla günlük hayat için pratiktir.',
          },
          {
            kind: 'WHERE',
            heading: 'Tiflis, semt semt',
            body: 'Eski Tiflis ve Sololaki: tarihi kalp, yokuşlu ve parke taşlı, kükürt hamamları ve her şey yürüme mesafesinde. Ziyaretçi çoktur, biraz gürültü olabilir. Mtatsminda ve Rustaveli Caddesi: merkez, şehrin üstünde tepe ve parkı. Vera ve Vake: daha sakin ve yeşil, Vake en prestijli oturma semtlerinden biri sayılır. Saburtalo: uzun kalış için iyi, metro, mağazalar ve makul fiyatlar. Didube: biraz daha ucuz, metro bağlantısı iyi. Marjanishvili, Fabrika çevresi: canlı, bol barlı. Didi Dighomi ve Gldani: merkezden uzak büyük konut semtleri, çok sayıda apartman ve daha yerel, gündelik bir hayat.',
          },
          {
            kind: 'WHERE',
            heading: 'Batum',
            body: 'Batum Karadeniz kıyısında, Acara\'nın ana şehridir. Hayat deniz ve plaj boyunca uzanan Bulvar etrafında döner. Yazın kalabalık, soğuk aylarda çok daha sakindir. Mümkünse uzun bir kira sözleşmesi imzalamadan önce iki mevsimde de görün.',
          },
          {
            kind: 'WHERE',
            heading: 'Kutaisi, Zugdidi ve diğer şehirler',
            body: 'Kutaisi eski İmereti\'nin başkentiydi, bugün Bagrati Katedrali ve Gelati Manastırı\'na yakın, kendi havalimanı olan sakin bir şehir. Zugdidi Samegrelo\'nun ana şehri, Dadiani Sarayı müzesi burada ve Svaneti\'ye giden yol genelde buradan geçer. İnsanlar ayrıca Tiflis yakınındaki Rustavi\'ye, Kaheti şarap bölgesindeki Telavi\'ye ve Kobuleti gibi sahil kasabalarına taşınır.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Nasıl seçilir',
            body: 'Sokağa sabah bir kez, akşam bir kez bakın. En yakın metro ya da durağın ne kadar uzak olduğunu, yokuşun ne kadar dik olduğunu ve dairenin kışın nasıl ısındığını kontrol edin. Komşulara sorun. Fiyatlar için yaşam maliyeti sayfamıza bakın, fiyatları orada tutup güncelliyoruz.',
          },
        ],
      },
      ar: {
        title: 'المدن والأحياء',
        summary:
          'معظم القادمين الجدد يستقرون في تبليسي أو باتومي، وبعضهم يختار كوتايسي. ولكل حي في تبليسي طابعه، فتجوّل في عدة أحياء قبل أن تقرر.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'باختصار',
            body: 'تبليسي هي العاصمة وأكبر مدينة، وفيها أكثر فرص العمل والمدارس والخدمات. باتومي مدينة ساحلية على البحر الأسود. وكوتايسي في الغرب أهدأ وأصغر. داخل تبليسي، المركز القديم حيوي وقريب من كل شيء، وفاكي وفيرا أكثر خضرة وهدوءًا، وسابورتالو عملي للحياة اليومية والمترو قريب منه.',
          },
          {
            kind: 'WHERE',
            heading: 'تبليسي حيًّا حيًّا',
            body: 'تبليسي القديمة وسولولاكي: القلب التاريخي، تلال وشوارع مرصوفة بالحجر، وحمامات الكبريت، وكل شيء على مسافة مشي. توقّع زوارًا كثيرين وبعض الضجيج. متاتسميندا وشارع روستافيلي: وسط المدينة، وفوقها الجبل وحديقته. فيرا وفاكي: أهدأ وأكثر خضرة، وفاكي يُعد من أرقى أحياء السكن. سابورتالو: مناسب للإقامة الطويلة، فيه مترو ومحلات وأسعار معتدلة. ديدوبي: أرخص قليلًا ومتصل جيدًا بالمترو. مارجانيشفيلي حول فابريكا: حيوي ومليء بالمقاهي والبارات. ديدي ديغومي وغلداني: أحياء سكنية كبيرة بعيدة عن المركز، فيها عمارات كثيرة وحياة يومية محلية أكثر.',
          },
          {
            kind: 'WHERE',
            heading: 'باتومي',
            body: 'تقع باتومي على ساحل البحر الأسود، وهي المدينة الرئيسية في أجاريا. الحياة فيها تدور حول البحر والكورنيش الطويل بجانب الشاطئ. مزدحمة في الصيف وأهدأ بكثير في الأشهر الباردة، فإن استطعت زُرها في الموسمين قبل أن توقّع عقد إيجار طويل.',
          },
          {
            kind: 'WHERE',
            heading: 'كوتايسي وزوغديدي ومدن أخرى',
            body: 'كانت كوتايسي عاصمة إيميريتي قديمًا، وهي اليوم مدينة هادئة قريبة من كاتدرائية باغراتي ودير غيلاتي، ولها مطارها. زوغديدي هي المدينة الرئيسية في ساميغريلو، وفيها متحف قصر دادياني، ومنها يمر الطريق المعتاد إلى سفانيتي. ويسكن الناس أيضًا في روستافي قرب تبليسي، وفي تيلافي في منطقة النبيذ كاخيتي، وفي مدن ساحلية مثل كوبوليتي.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'كيف تختار',
            body: 'زُر الشارع صباحًا ثم مرة أخرى ليلًا. انظر كم تبعد أقرب محطة مترو أو حافلة، وكم الطلعة شديدة، وكيف تُدفأ الشقة في الشتاء. واسأل الجيران عن الحياة هناك. أما الأسعار فتجدها في صفحتنا عن تكاليف المعيشة، حيث نحفظها ونحدّثها.',
          },
        ],
      },
      he: {
        title: 'ערים ושכונות',
        summary:
          'רוב מי שמגיעים מתיישבים בטביליסי או בבטומי, וחלק בוחרים בקוטאיסי. לכל שכונה בטביליסי יש אופי משלה, אז הסתובבו בכמה לפני שמחליטים.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'בקצרה',
            body: 'טביליסי היא הבירה והעיר הגדולה ביותר, ויש בה הכי הרבה עבודה, בתי ספר ושירותים. בטומי היא עיר החוף על הים השחור. קוטאיסי במערב שקטה וקטנה יותר. בתוך טביליסי, המרכז הישן תוסס וקרוב להכול, ואקה ו־ורה ירוקות ושקטות יותר, וסבורטלו נוחה לחיי היומיום עם מטרו קרוב.',
          },
          {
            kind: 'WHERE',
            heading: 'טביליסי, שכונה אחרי שכונה',
            body: 'טביליסי העתיקה וסולולאקי: הלב ההיסטורי, גבעות ורחובות אבן, מרחצאות הגופרית והכול במרחק הליכה. יש הרבה מבקרים ולפעמים רעש. מטצמינדה ושדרות רוסטאוולי: מרכז העיר, ומעליה ההר והפארק שלו. ורה ו־ואקה: שקטות וירוקות יותר, וואקה נחשבת לאחת משכונות המגורים היוקרתיות. סבורטלו: טובה לשהייה ארוכה, עם מטרו, חנויות ומחירים סבירים. דידובה: קצת זולה יותר, עם חיבור טוב למטרו. מרג׳נישווילי, סביב פבריקה: תוססת ומלאה בברים. דידי דיגומי וגלדאני: שכונות מגורים גדולות רחוק יותר מהמרכז, עם הרבה בנייני דירות ואווירה מקומית ויומיומית.',
          },
          {
            kind: 'WHERE',
            heading: 'בטומי',
            body: 'בטומי שוכנת על חוף הים השחור והיא העיר הראשית של אג׳ריה. החיים בה סובבים סביב הים והטיילת הארוכה לאורך החוף. בקיץ היא עמוסה, ובחודשים הקרים הרבה יותר שקטה, אז אם אפשר, בקרו בשתי העונות לפני שחותמים על שכירות ארוכה.',
          },
          {
            kind: 'WHERE',
            heading: 'קוטאיסי, זוגדידי וערים אחרות',
            body: 'קוטאיסי הייתה בירת אימרתי בעבר, והיום היא עיר שקטה עם קתדרלת בגרטי ומנזר גלאטי בסביבה, ושדה תעופה משלה. זוגדידי היא העיר הראשית של סמגרלו, יש בה מוזיאון ארמון דדיאני, ודרכה עובר בדרך כלל הכביש לסוואנטי. אנשים עוברים גם לרוסטאווי ליד טביליסי, לתלאווי באזור היין קאחתי ולעיירות חוף כמו קובולטי.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'איך בוחרים',
            body: 'בקרו ברחוב בבוקר ושוב בלילה. בדקו כמה רחוקה תחנת המטרו או האוטובוס, כמה תלולה העלייה ואיך הדירה מחוממת בחורף. שאלו שכנים איך החיים שם. את המחירים תמצאו בעמוד שלנו על יוקר המחיה, שם אנחנו שומרים ומעדכנים אותם.',
          },
        ],
      },
    },
    facts: [
      {
        key: 'tbilisi-district-character',
        factClass: 'GENERAL',
        register: 'PRACTICAL_CONTEXT',
        availability: 'ESTABLISHED',
        sources: ['madlobaWhereToStay', 'gntaTbilisi'],
        value: null,
        statement: {
          en: 'In Tbilisi, the Old Town is hilly and close to everything, Vera and Vake are quieter and greener, Vake is considered one of the most prestigious residential districts, and Saburtalo suits longer stays with the metro, shops and moderate prices.',
          ka: 'თბილისში ძველი ქალაქი აღმართიანია და ყველაფერთან ახლოსაა, ვერა და ვაკე უფრო წყნარი და მწვანეა, ვაკე ერთ-ერთ ყველაზე პრესტიჟულ საცხოვრებელ უბნად ითვლება, საბურთალო კი ხანგრძლივი ცხოვრებისთვის ვარგა მეტროთი, მაღაზიებით და ზომიერი ფასებით.',
          ru: 'В Тбилиси Старый город холмистый и близко ко всему, Вера и Ваке тише и зеленее, Ваке считается одним из самых престижных жилых районов, а Сабуртало подходит для долгого проживания: метро, магазины и умеренные цены.',
          tr: 'Tiflis\'te Eski Şehir yokuşludur ve her yere yakındır, Vera ve Vake daha sakin ve yeşildir, Vake en prestijli konut semtlerinden biri sayılır, Saburtalo ise metro, mağazalar ve makul fiyatlarla uzun kalışa uygundur.',
          ar: 'في تبليسي، المدينة القديمة تلّية وقريبة من كل شيء، وفيرا وفاكي أهدأ وأكثر خضرة، وفاكي يُعد من أرقى الأحياء السكنية، وسابورتالو يناسب الإقامة الطويلة بفضل المترو والمحلات والأسعار المعتدلة.',
          he: 'בטביליסי, העיר העתיקה הררית וקרובה להכול, ורה ו־ואקה שקטות וירוקות יותר, ואקה נחשבת לאחת משכונות המגורים היוקרתיות, וסבורטלו מתאימה לשהייה ארוכה עם מטרו, חנויות ומחירים סבירים.',
        },
      },
      {
        key: 'batumi-adjara',
        factClass: 'GENERAL',
        register: 'PRACTICAL_CONTEXT',
        availability: 'ESTABLISHED',
        sources: ['gntaBatumi', 'gntaImereti', 'gntaSvaneti'],
        value: null,
        statement: {
          en: 'Batumi is on the Black Sea coast and is the administrative centre of the Autonomous Republic of Adjara. Kutaisi was the capital of Imereti until the Middle Ages, and Zugdidi is the main city of Samegrelo.',
          ka: 'ბათუმი შავი ზღვის სანაპიროზეა და აჭარის ავტონომიური რესპუბლიკის ადმინისტრაციული ცენტრია. ქუთაისი შუა საუკუნეებამდე იმერეთის დედაქალაქი იყო, ზუგდიდი კი სამეგრელოს მთავარი ქალაქია.',
          ru: 'Батуми находится на побережье Чёрного моря и является административным центром Автономной Республики Аджария. Кутаиси был столицей Имеретии до Средних веков, а Зугдиди это главный город Самегрело.',
          tr: 'Batum Karadeniz kıyısındadır ve Acara Özerk Cumhuriyeti\'nin idari merkezidir. Kutaisi Orta Çağ\'a kadar İmereti\'nin başkentiydi, Zugdidi ise Samegrelo\'nun ana şehridir.',
          ar: 'تقع باتومي على ساحل البحر الأسود وهي المركز الإداري لجمهورية أجاريا ذات الحكم الذاتي. وكانت كوتايسي عاصمة إيميريتي حتى العصور الوسطى، أما زوغديدي فهي المدينة الرئيسية في ساميغريلو.',
          he: 'בטומי שוכנת לחוף הים השחור והיא המרכז המנהלי של הרפובליקה האוטונומית אג׳ריה. קוטאיסי הייתה בירת אימרתי עד ימי הביניים, וזוגדידי היא העיר הראשית של סמגרלו.',
        },
      },
    ],
  },

  {
    slug: 'renting-a-home',
    domain: 'PROPERTY',
    pathway: 'LIVE',
    factClass: 'PROCESS',
    register: 'PRACTICAL_CONTEXT',
    sortOrder: 80,
    content: {
      en: {
        title: 'Renting a home',
        summary:
          'Renting in Georgia is mostly a matter of agreement between you and the owner. That makes it fast, and it also means the protection you get is what you write down.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'The short answer',
            body: 'Find a place, see it in person, check that the person renting it to you really owns it, and sign a written lease. You usually pay the first month and a deposit when you sign. The law does not require a written lease for a household rental, but without one you have very little to show if something goes wrong, so always have one.',
          },
          {
            kind: 'WHAT_YOU_NEED',
            heading: 'What to have ready',
            body: 'Your passport, the first month\'s rent and a deposit. A deposit of one or two months is common practice for long rentals. It is a custom, not a fixed amount in law, so agree in the lease how much it is, when you get it back and what can be taken from it. If an agent shows you the flat, ask before the viewing whether you pay them anything.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Check who owns the flat',
            body: 'The Public Registry (NAPR) keeps the real estate register, and an extract from it shows who owns a property and whether there are restrictions, mortgages or leases on it. You can request one on napr.gov.ge or at a Public Service Hall. Compare the owner\'s name with the passport of the person signing. If someone else signs for the owner, ask to see their power of attorney.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Bills and utilities',
            body: 'For flats, electricity, gas, water and internet are usually paid separately by the tenant. Agree in writing who pays what. On the day you move in, take photos of every meter, and of the flat and furniture, and keep them.',
          },
          {
            kind: 'NOTES',
            heading: 'Notary and registering the lease',
            body: 'Most leases are simply signed by both sides. A notarised lease is needed only in some cases, for example when you use it for a residence permit or to register your place of residence. The Public Registry also keeps a register of leases if you want yours recorded. Ask at a Public Service Hall what that involves for your case. Get the lease in a language you understand, or side by side with a translation.',
          },
          {
            kind: 'PROBLEMS',
            heading: 'What usually goes wrong',
            body: 'The deposit is not returned, because nobody wrote down what state the flat was in. A bill from before you arrived turns up in your name. The person who signed was not the owner. Do not sign on the first visit, pay by bank transfer with a note, and keep every photo and receipt.',
          },
        ],
      },
      ka: {
        title: 'ბინის ქირაობა',
        summary:
          'საქართველოში ქირაობა ძირითადად თქვენსა და მესაკუთრეს შორის შეთანხმებაა. ეს საქმეს აჩქარებს, თუმცა ნიშნავს იმასაც, რომ თქვენი დაცვა ის არის, რასაც ქაღალდზე ჩაწერთ.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'მოკლე პასუხი',
            body: 'იპოვეთ ბინა, ნახეთ ის პირადად, გადაამოწმეთ, რომ ვინც გაქირავებთ, ნამდვილად მესაკუთრეა, და გააფორმეთ წერილობითი ხელშეკრულება. ხელმოწერისას, როგორც წესი, პირველი თვის ქირას და დეპოზიტს იხდით. საყოფაცხოვრებო ქირაობისთვის კანონი წერილობით ხელშეკრულებას არ ითხოვს, მაგრამ მის გარეშე პრობლემის დროს თითქმის ვერაფერს დაამტკიცებთ, ამიტომ ყოველთვის გააფორმეთ.',
          },
          {
            kind: 'WHAT_YOU_NEED',
            heading: 'რა უნდა გქონდეთ',
            body: 'პასპორტი, პირველი თვის ქირა და დეპოზიტი. გრძელვადიან ქირაობაზე ერთი ან ორი თვის დეპოზიტი გავრცელებული პრაქტიკაა. ეს ჩვეულებაა და არა კანონით დადგენილი თანხა, ამიტომ ხელშეკრულებაში შეთანხმდით, რამდენია, როდის დაგიბრუნდებათ და რა შეიძლება დაიქვითოს. თუ ბინას აგენტი გაჩვენებთ, ნახვამდე ჰკითხეთ, გიწევთ თუ არა მისთვის გადახდა.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'გადაამოწმეთ, ვისია ბინა',
            body: 'საჯარო რეესტრის ეროვნული სააგენტო უძრავი ქონების რეესტრს აწარმოებს, და ამონაწერი აჩვენებს, ვისია ქონება და აქვს თუ არა შეზღუდვა, იპოთეკა ან იჯარა. მოითხოვეთ napr.gov.ge-ზე ან იუსტიციის სახლში. შეადარეთ მესაკუთრის სახელი ხელმომწერის პასპორტს. თუ მესაკუთრის ნაცვლად სხვა აწერს ხელს, სთხოვეთ მინდობილობა.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'კომუნალური გადასახადები',
            body: 'ბინაში დენს, გაზს, წყალს და ინტერნეტს, როგორც წესი, მოიჯარე ცალკე იხდის. წერილობით შეთანხმდით, ვინ რას იხდის. შესვლის დღეს გადაუღეთ ფოტო ყველა მრიცხველს, ბინას და ავეჯს, და შეინახეთ.',
          },
          {
            kind: 'NOTES',
            heading: 'ნოტარიუსი და ხელშეკრულების რეგისტრაცია',
            body: 'ხელშეკრულებების უმეტესობას უბრალოდ ორივე მხარე აწერს ხელს. ნოტარიულად დამოწმებული ხელშეკრულება მხოლოდ ზოგ შემთხვევაშია საჭირო, მაგალითად ბინადრობის ნებართვისთვის ან საცხოვრებელი ადგილის რეგისტრაციისთვის. საჯარო რეესტრი იჯარის რეესტრსაც აწარმოებს, თუ გსურთ, რომ თქვენი ხელშეკრულება აღირიცხოს. იუსტიციის სახლში იკითხეთ, რას მოითხოვს ეს თქვენს შემთხვევაში. ხელშეკრულება გქონდეთ თქვენთვის გასაგებ ენაზე ან თარგმანთან ერთად, გვერდიგვერდ.',
          },
          {
            kind: 'PROBLEMS',
            heading: 'რა ფუჭდება ყველაზე ხშირად',
            body: 'დეპოზიტს არ აბრუნებენ, რადგან არავის ჩაუწერია, რა მდგომარეობაში იყო ბინა. თქვენს სახელზე ჩნდება ძველი გადასახადი, რომელიც თქვენს მოსვლამდე დაგროვდა. ხელი მესაკუთრემ არ მოაწერა. პირველივე ნახვაზე ხელს ნუ მოაწერთ, გადაიხადეთ საბანკო გადარიცხვით დანიშნულების მითითებით და შეინახეთ ყველა ფოტო და ქვითარი.',
          },
        ],
      },
      ru: {
        title: 'Аренда жилья',
        summary:
          'Аренда в Грузии это в основном договорённость между вами и хозяином. Поэтому всё быстро, но и защищает вас только то, что записано.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'Коротко',
            body: 'Найдите жильё, посмотрите его лично, проверьте, что сдающий действительно собственник, и подпишите письменный договор. Обычно при подписании платят первый месяц и депозит. Для бытовой аренды закон не требует письменного договора, но без него при проблеме вам почти нечего показать, так что делайте его всегда.',
          },
          {
            kind: 'WHAT_YOU_NEED',
            heading: 'Что подготовить',
            body: 'Паспорт, плату за первый месяц и депозит. Депозит в один или два месяца это обычная практика при долгой аренде. Это обычай, а не сумма из закона, поэтому впишите в договор, сколько он, когда возвращается и что из него могут удержать. Если квартиру показывает агент, спросите до просмотра, платите ли вы ему что-то.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Проверьте, чья квартира',
            body: 'Национальное агентство публичного реестра (NAPR) ведёт реестр недвижимости, и выписка из него показывает, кому принадлежит объект и есть ли на нём ограничения, ипотека или аренда. Запросить выписку можно на napr.gov.ge или в Доме юстиции. Сравните имя собственника с паспортом того, кто подписывает. Если за собственника подписывает другой человек, попросите доверенность.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Коммунальные платежи',
            body: 'В квартирах свет, газ, воду и интернет обычно оплачивает арендатор отдельно. Договоритесь письменно, кто за что платит. В день въезда сфотографируйте все счётчики, квартиру и мебель и сохраните фото.',
          },
          {
            kind: 'NOTES',
            heading: 'Нотариус и регистрация договора',
            body: 'Большинство договоров просто подписывают обе стороны. Нотариальный договор нужен только в некоторых случаях, например для вида на жительство или регистрации места жительства. В публичном реестре также есть реестр аренды, если хотите, чтобы ваш договор был внесён. В Доме юстиции спросите, что для этого нужно в вашем случае. Договор должен быть на понятном вам языке или рядом с переводом.',
          },
          {
            kind: 'PROBLEMS',
            heading: 'Что чаще всего идёт не так',
            body: 'Депозит не возвращают, потому что никто не записал, в каком состоянии была квартира. На вас всплывает старый счёт, набежавший до вашего въезда. Подписал не собственник. Не подписывайте в первый же визит, платите банковским переводом с назначением платежа и храните все фото и чеки.',
          },
        ],
      },
      tr: {
        title: 'Ev kiralamak',
        summary:
          'Gürcistan\'da kiralama büyük ölçüde sizinle ev sahibi arasındaki bir anlaşmadır. Bu işi hızlandırır, ama korumanızın yazıya döktüğünüz kadar olduğu anlamına da gelir.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'Kısaca',
            body: 'Bir yer bulun, kendiniz gidip görün, size kiralayan kişinin gerçekten sahibi olduğunu kontrol edin ve yazılı bir sözleşme imzalayın. İmzada genellikle ilk ayın kirası ve depozito ödenir. Konut kiralamasında kanun yazılı sözleşme şart koşmaz, ama sözleşme olmadan bir sorun çıktığında gösterecek pek bir şeyiniz olmaz, bu yüzden her zaman yapın.',
          },
          {
            kind: 'WHAT_YOU_NEED',
            heading: 'Hazır olması gerekenler',
            body: 'Pasaportunuz, ilk ayın kirası ve depozito. Uzun kiralamalarda bir ya da iki aylık depozito yaygın bir uygulamadır. Bu bir alışkanlıktır, kanunda belirlenmiş bir tutar değildir. Sözleşmede ne kadar olduğunu, ne zaman iade edileceğini ve neyin kesilebileceğini yazın. Daireyi bir emlakçı gösteriyorsa, görmeden önce ona bir ücret ödeyip ödemeyeceğinizi sorun.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Dairenin kime ait olduğunu kontrol edin',
            body: 'Kamu Sicili Ulusal Ajansı (NAPR) gayrimenkul sicilini tutar. Sicil özeti mülkün kime ait olduğunu ve üzerinde kısıtlama, ipotek ya da kira kaydı olup olmadığını gösterir. napr.gov.ge üzerinden ya da bir Kamu Hizmetleri Salonu\'ndan isteyebilirsiniz. Malikin adını imzalayan kişinin pasaportuyla karşılaştırın. Malik yerine başkası imzalıyorsa vekâletnamesini görmek isteyin.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Faturalar',
            body: 'Dairelerde elektrik, gaz, su ve interneti genellikle kiracı ayrıca öder. Kimin neyi ödediğini yazılı olarak kararlaştırın. Taşındığınız gün tüm sayaçların, dairenin ve eşyaların fotoğrafını çekin ve saklayın.',
          },
          {
            kind: 'NOTES',
            heading: 'Noter ve sözleşmenin tescili',
            body: 'Sözleşmelerin çoğunu iki taraf imzalar, o kadar. Noter onaylı sözleşme yalnızca bazı durumlarda gerekir, örneğin oturma izni başvurusu ya da ikamet adresi kaydı için. Kamu Sicili, sözleşmenizin kayda geçmesini isterseniz bir kira sicili de tutar. Sizin durumunuzda bunun ne gerektirdiğini Kamu Hizmetleri Salonu\'nda sorun. Sözleşme anladığınız bir dilde ya da yanında çevirisiyle olsun.',
          },
          {
            kind: 'PROBLEMS',
            heading: 'En sık ne ters gider',
            body: 'Depozito iade edilmez, çünkü kimse dairenin durumunu yazmamıştır. Siz gelmeden önceki eski bir fatura sizin adınıza çıkar. İmzalayan kişi malik değildir. İlk ziyarette imzalamayın, açıklamalı banka havalesiyle ödeyin ve tüm fotoğrafları ve makbuzları saklayın.',
          },
        ],
      },
      ar: {
        title: 'استئجار بيت',
        summary:
          'الإيجار في جورجيا في الغالب اتفاق بينك وبين المالك. هذا يجعل الأمر سريعًا، لكنه يعني أيضًا أن حمايتك هي ما تكتبه على الورق.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'باختصار',
            body: 'ابحث عن مكان، وعاينه بنفسك، وتأكد أن من يؤجرك هو المالك فعلًا، ووقّع عقد إيجار مكتوبًا. عادة تدفع إيجار الشهر الأول والتأمين عند التوقيع. القانون لا يشترط عقدًا مكتوبًا لإيجار السكن، لكن بدونه لن يكون لديك ما تثبت به حقك إذا حصلت مشكلة، فاحرص عليه دائمًا.',
          },
          {
            kind: 'WHAT_YOU_NEED',
            heading: 'ما تجهّزه',
            body: 'جوازك، وإيجار الشهر الأول، والتأمين. التأمين بقيمة شهر أو شهرين عادة شائعة في الإيجار الطويل. هو عُرف وليس مبلغًا يحدده القانون، فاكتب في العقد كم هو، ومتى يُعاد إليك، وما الذي يمكن خصمه منه. وإذا عرض عليك وسيط الشقة، فاسأله قبل المعاينة هل ستدفع له شيئًا.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'تحقق من مالك الشقة',
            body: 'الوكالة الوطنية للسجل العام (NAPR) تمسك سجل العقارات، ومستخرج السجل يبيّن مالك العقار وما إذا كانت عليه قيود أو رهن أو عقود إيجار. يمكنك طلبه من napr.gov.ge أو من أي قاعة للخدمات العامة. قارن اسم المالك بجواز الشخص الذي يوقّع، وإذا وقّع شخص آخر بدل المالك فاطلب رؤية توكيله.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'الفواتير والخدمات',
            body: 'في الشقق يدفع المستأجر عادة الكهرباء والغاز والماء والإنترنت بشكل منفصل. اتفقوا كتابةً على من يدفع ماذا. ويوم دخولك صوّر كل العدادات والشقة والأثاث واحتفظ بالصور.',
          },
          {
            kind: 'NOTES',
            heading: 'كاتب العدل وتسجيل العقد',
            body: 'معظم العقود يوقّعها الطرفان وحسب. العقد الموثّق عند كاتب العدل مطلوب في حالات معينة فقط، مثل طلب الإقامة أو تسجيل مكان السكن. والسجل العام يمسك أيضًا سجلًا لعقود الإيجار إذا أردت تسجيل عقدك. اسأل في قاعة الخدمات العامة عما يتطلبه ذلك في حالتك. واجعل العقد بلغة تفهمها، أو مع ترجمته جنبًا إلى جنب.',
          },
          {
            kind: 'PROBLEMS',
            heading: 'ما الذي يحدث عادة',
            body: 'لا يُعاد التأمين لأن أحدًا لم يدوّن حالة الشقة. تظهر باسمك فاتورة قديمة من قبل وصولك. الشخص الذي وقّع لم يكن المالك. لا توقّع في الزيارة الأولى، وادفع بتحويل بنكي مع ملاحظة، واحتفظ بكل صورة وإيصال.',
          },
        ],
      },
      he: {
        title: 'לשכור דירה',
        summary:
          'שכירות בגאורגיה היא בעיקר הסכם בינכם לבין בעל הדירה. זה הופך את התהליך למהיר, אבל זה גם אומר שההגנה שלכם היא מה שכתוב על הנייר.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'בקצרה',
            body: 'מצאו דירה, ראו אותה בעצמכם, בדקו שמי שמשכיר לכם באמת הבעלים, וחתמו על חוזה בכתב. בדרך כלל משלמים בחתימה את החודש הראשון ופיקדון. החוק לא דורש חוזה כתוב לשכירות למגורים, אבל בלי חוזה אין לכם כמעט מה להראות אם משהו משתבש, אז תמיד תעשו אחד.',
          },
          {
            kind: 'WHAT_YOU_NEED',
            heading: 'מה להכין',
            body: 'דרכון, שכר דירה לחודש הראשון ופיקדון. פיקדון של חודש או חודשיים נהוג בשכירות ארוכה. זה מנהג ולא סכום שנקבע בחוק, אז כתבו בחוזה כמה הוא, מתי מקבלים אותו בחזרה ומה מותר לקזז ממנו. אם מתווך מראה לכם את הדירה, שאלו לפני הביקור אם אתם משלמים לו משהו.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'בדקו של מי הדירה',
            body: 'הסוכנות הלאומית לרישום ציבורי (NAPR) מנהלת את מרשם המקרקעין, ונסח מהמרשם מראה מי הבעלים של הנכס והאם יש עליו הגבלות, משכנתאות או שכירויות. אפשר לבקש נסח ב־napr.gov.ge או באולם שירותים ציבוריים. השוו את שם הבעלים לדרכון של מי שחותם. אם מישהו אחר חותם בשם הבעלים, בקשו לראות ייפוי כוח.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'חשבונות',
            body: 'בדירות, חשמל, גז, מים ואינטרנט משולמים בדרך כלל בנפרד על ידי השוכר. סכמו בכתב מי משלם מה. ביום הכניסה צלמו כל מונה, את הדירה ואת הרהיטים, ושמרו את התמונות.',
          },
          {
            kind: 'NOTES',
            heading: 'נוטריון ורישום החוזה',
            body: 'את רוב החוזים פשוט חותמים שני הצדדים. חוזה נוטריוני נדרש רק במקרים מסוימים, למשל לבקשת אשרת שהייה או לרישום מקום מגורים. במרשם הציבורי יש גם מרשם שכירויות, אם רוצים שהחוזה יירשם. שאלו באולם שירותים ציבוריים מה זה דורש במקרה שלכם. דאגו שהחוזה יהיה בשפה שאתם מבינים, או לצד תרגום.',
          },
          {
            kind: 'PROBLEMS',
            heading: 'מה בדרך כלל משתבש',
            body: 'הפיקדון לא מוחזר, כי אף אחד לא רשם באיזה מצב הייתה הדירה. חשבון ישן מלפני שהגעתם מופיע על שמכם. מי שחתם לא היה הבעלים. אל תחתמו בביקור הראשון, שלמו בהעברה בנקאית עם הערה, ושמרו כל תמונה וקבלה.',
          },
        ],
      },
    },
    facts: [
      {
        key: 'written-lease-not-required',
        factClass: 'LEGAL',
        register: 'PRACTICAL_CONTEXT',
        availability: 'ESTABLISHED',
        sources: ['madlobaRentingLaw'],
        value: null,
        statement: {
          en: 'A written rental agreement is not legally required for household rentals, but it is advisable. Notarisation is needed only in certain situations, such as a residence permit application or registering a place of residence.',
          ka: 'საყოფაცხოვრებო ქირაობისთვის წერილობითი ხელშეკრულება კანონით სავალდებულო არ არის, მაგრამ სასურველია. ნოტარიული დამოწმება მხოლოდ ზოგ შემთხვევაშია საჭირო, მაგალითად ბინადრობის ნებართვისთვის ან საცხოვრებელი ადგილის რეგისტრაციისთვის.',
          ru: 'Для бытовой аренды письменный договор по закону не обязателен, но желателен. Нотариальное заверение нужно только в некоторых случаях, например для вида на жительство или регистрации места жительства.',
          tr: 'Konut kiralamasında yazılı sözleşme kanunen zorunlu değildir, ama tavsiye edilir. Noter onayı yalnızca bazı durumlarda gerekir, örneğin oturma izni başvurusu ya da ikamet adresi kaydı.',
          ar: 'لا يشترط القانون عقدًا مكتوبًا لإيجار السكن، لكنه مستحسن. والتوثيق عند كاتب العدل مطلوب في حالات معينة فقط، مثل طلب الإقامة أو تسجيل مكان السكن.',
          he: 'לשכירות למגורים החוק לא מחייב חוזה כתוב, אבל מומלץ לעשות אותו. אישור נוטריוני נדרש רק במקרים מסוימים, למשל לבקשת אשרת שהייה או לרישום מקום מגורים.',
        },
      },
      {
        key: 'deposit-common-practice',
        factClass: 'MARKET',
        register: 'COMMUNITY_EXPERIENCE',
        availability: 'ESTABLISHED',
        sources: ['madlobaRentHousing'],
        value: { depositMonthsLow: 1, depositMonthsHigh: 2 },
        statement: {
          en: 'For long rentals a contract is often asked for, with a deposit of one to two months, and utilities are usually paid separately. This is common practice, not a rule in law.',
          ka: 'გრძელვადიან ქირაობაზე ხშირად ითხოვენ ხელშეკრულებას ერთი ან ორი თვის დეპოზიტით, კომუნალურს კი, როგორც წესი, ცალკე იხდიან. ეს გავრცელებული პრაქტიკაა და არა კანონის მოთხოვნა.',
          ru: 'При долгой аренде часто просят договор и депозит в один или два месяца, а коммунальные услуги обычно оплачиваются отдельно. Это обычная практика, а не норма закона.',
          tr: 'Uzun kiralamalarda genellikle sözleşme ve bir ya da iki aylık depozito istenir, faturalar çoğunlukla ayrıca ödenir. Bu yaygın bir uygulamadır, kanuni bir kural değildir.',
          ar: 'في الإيجار الطويل يُطلب غالبًا عقد مع تأمين بقيمة شهر أو شهرين، وتُدفع الخدمات عادة بشكل منفصل. هذه عادة شائعة وليست قاعدة في القانون.',
          he: 'בשכירות ארוכה מבקשים לרוב חוזה ופיקדון של חודש עד חודשיים, והחשבונות משולמים בדרך כלל בנפרד. זה נוהג מקובל, לא כלל בחוק.',
        },
      },
      {
        key: 'registry-extract',
        factClass: 'PROCESS',
        register: 'PRACTICAL_CONTEXT',
        availability: 'ESTABLISHED',
        sources: ['naprRegistry'],
        value: null,
        statement: {
          en: 'The National Agency of Public Registry keeps the real estate register and issues extracts from the public register, including information on restrictions, liens and leases.',
          ka: 'საჯარო რეესტრის ეროვნული სააგენტო აწარმოებს უძრავი ქონების რეესტრს და გასცემს ამონაწერს საჯარო რეესტრიდან, მათ შორის ინფორმაციას შეზღუდვების, იპოთეკისა და იჯარის შესახებ.',
          ru: 'Национальное агентство публичного реестра ведёт реестр недвижимости и выдаёт выписки из публичного реестра, включая сведения об ограничениях, залогах и аренде.',
          tr: 'Kamu Sicili Ulusal Ajansı gayrimenkul sicilini tutar ve kısıtlamalar, rehinler ve kiralar hakkındaki bilgiler dahil sicil özetleri verir.',
          ar: 'تمسك الوكالة الوطنية للسجل العام سجل العقارات، وتصدر مستخرجات من السجل العام تشمل معلومات عن القيود والرهون وعقود الإيجار.',
          he: 'הסוכנות הלאומית לרישום ציבורי מנהלת את מרשם המקרקעין ומנפיקה נסחים מהמרשם הציבורי, כולל מידע על הגבלות, שעבודים ושכירויות.',
        },
      },
    ],
  },
  {
    slug: 'health-and-safety',
    domain: 'HEALTHCARE',
    pathway: 'LIVE',
    factClass: 'PROCESS',
    register: 'OFFICIAL_REQUIREMENT',
    sortOrder: 90,
    content: {
      en: {
        title: 'Health and safety',
        summary:
          'One number covers every emergency in Georgia: 112. For everything else there are pharmacies on almost every corner and private clinics in the cities.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'The short answer',
            body: 'In an emergency call 112 for police, an ambulance or the fire service. It works all over Georgia, day and night, and you can call it even from a phone with no SIM card or no credit. Save it in your phone now.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Pharmacies',
            body: 'Cities have many pharmacies, including large chains, and some stay open through the night. The pharmacist can help with everyday things. Some medicines need a doctor\'s prescription, so if you take something regularly, bring your prescription and know the generic name of the medicine, not only the brand.',
          },
          {
            kind: 'WHERE',
            heading: 'Doctors, clinics and tests',
            body: 'Most foreigners use private clinics, which are easy to find in Tbilisi and Batumi. Blood tests and other checks are done at private laboratories and multi specialty clinics, and most do not need a referral from a doctor. When you book, ask whether the doctor speaks a language you are comfortable in.',
          },
          {
            kind: 'NOTES',
            heading: 'Insurance',
            body: 'Private care is paid for, so health insurance that works in Georgia is worth having from the first day. Before you buy, check which clinics it works with and whether you pay first and claim back later. Whether a foreign resident can join the state health programme is something we have not been able to confirm. Ask the Ministry of Health (moh.gov.ge) about your own status before you count on it.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Staying safe day to day',
            body: 'Take care crossing roads, because drivers can be fast, and use crossings and underpasses where you can. In the mountains the weather changes quickly, so tell someone your route and check the forecast before a hike. If you are unsure about anything, 112 is the number to call.',
          },
        ],
      },
      ka: {
        title: 'ჯანმრთელობა და უსაფრთხოება',
        summary:
          'საქართველოში ყველა გადაუდებელ შემთხვევაზე ერთი ნომერია: 112. დანარჩენისთვის აფთიაქი თითქმის ყველა კუთხეშია, ქალაქებში კი კერძო კლინიკებია.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'მოკლე პასუხი',
            body: 'გადაუდებელ შემთხვევაში დარეკეთ 112-ზე პოლიციის, სასწრაფოს ან სახანძრო სამსახურის გამოსაძახებლად. ის მთელ საქართველოში მუშაობს, დღე და ღამე, და დარეკვა შეგიძლიათ სიმ ბარათის ან ბალანსის გარეშეც. შეინახეთ ტელეფონში ახლავე.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'აფთიაქები',
            body: 'ქალაქებში ბევრი აფთიაქია, მათ შორის დიდი ქსელები, და ზოგი მთელი ღამე მუშაობს. ფარმაცევტი ყოველდღიურ საკითხებში დაგეხმარებათ. ზოგი წამალი ექიმის რეცეპტით გაიცემა, ამიტომ, თუ რამეს რეგულარულად იღებთ, თან იქონიეთ რეცეპტი და იცოდეთ წამლის ზოგადი სახელი და არა მხოლოდ ბრენდი.',
          },
          {
            kind: 'WHERE',
            heading: 'ექიმები, კლინიკები და ანალიზები',
            body: 'უცხოელების უმეტესობა კერძო კლინიკებით სარგებლობს, რომლებიც თბილისსა და ბათუმში ადვილად მოიძებნება. სისხლის ანალიზი და სხვა კვლევები კერძო ლაბორატორიებსა და მრავალპროფილიან კლინიკებში კეთდება და უმეტესობას ექიმის მიმართვა არ სჭირდება. ჩაწერისას ჰკითხეთ, ლაპარაკობს თუ არა ექიმი თქვენთვის მოსახერხებელ ენაზე.',
          },
          {
            kind: 'NOTES',
            heading: 'დაზღვევა',
            body: 'კერძო მომსახურება ფასიანია, ამიტომ საქართველოში მოქმედი ჯანმრთელობის დაზღვევა პირველივე დღიდან ღირს. ყიდვამდე გადაამოწმეთ, რომელ კლინიკებთან მუშაობს და ჯერ თქვენ იხდით და მერე ანაზღაურებას იღებთ თუ არა. შეუძლია თუ არა უცხოელ რეზიდენტს სახელმწიფო ჯანდაცვის პროგრამაში ჩართვა, ჯერ ვერ დავადასტურეთ. სანამ ამის იმედი გექნებათ, თქვენი სტატუსის შესახებ ჰკითხეთ ჯანდაცვის სამინისტროს (moh.gov.ge).',
          },
          {
            kind: 'PRACTICAL',
            heading: 'ყოველდღიური უსაფრთხოება',
            body: 'ფრთხილად გადადით გზაზე, რადგან მძღოლები შეიძლება სწრაფად მოძრაობდნენ, და სადაც შეგიძლიათ, გამოიყენეთ გადასასვლელი და მიწისქვეშა გადასასვლელი. მთაში ამინდი სწრაფად იცვლება, ამიტომ ლაშქრობამდე ვინმეს უთხარით თქვენი მარშრუტი და ნახეთ პროგნოზი. თუ რამეში დარწმუნებული არ ხართ, დარეკეთ 112-ზე.',
          },
        ],
      },
      ru: {
        title: 'Здоровье и безопасность',
        summary:
          'В Грузии на любой экстренный случай один номер: 112. Для всего остального аптеки есть почти на каждом углу, а в городах работают частные клиники.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'Коротко',
            body: 'В экстренной ситуации звоните 112, чтобы вызвать полицию, скорую или пожарных. Номер работает по всей Грузии днём и ночью, и позвонить можно даже с телефона без SIM карты или без денег на счёте. Сохраните его в телефоне прямо сейчас.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Аптеки',
            body: 'В городах много аптек, в том числе крупные сети, и некоторые работают круглосуточно. Фармацевт поможет с повседневными вещами. Некоторые лекарства отпускают только по рецепту врача, поэтому, если вы что-то принимаете постоянно, возьмите рецепт и знайте международное название лекарства, а не только бренд.',
          },
          {
            kind: 'WHERE',
            heading: 'Врачи, клиники и анализы',
            body: 'Большинство иностранцев ходит в частные клиники, в Тбилиси и Батуми их легко найти. Анализы крови и другие обследования делают в частных лабораториях и многопрофильных клиниках, и для большинства не нужно направление врача. При записи спросите, говорит ли врач на удобном вам языке.',
          },
          {
            kind: 'NOTES',
            heading: 'Страховка',
            body: 'Частная медицина платная, поэтому медицинская страховка, которая работает в Грузии, нужна с первого дня. Перед покупкой проверьте, с какими клиниками она работает и платите ли вы сначала сами, а потом получаете возмещение. Может ли иностранный резидент участвовать в государственной программе здравоохранения, мы подтвердить не смогли. Прежде чем на это рассчитывать, спросите о своём статусе в Министерстве здравоохранения (moh.gov.ge).',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Безопасность каждый день',
            body: 'Осторожно переходите дорогу, водители бывают быстрыми, и по возможности пользуйтесь переходами и подземными переходами. В горах погода меняется быстро, так что перед походом скажите кому-нибудь свой маршрут и посмотрите прогноз. Если в чём-то не уверены, звоните 112.',
          },
        ],
      },
      tr: {
        title: 'Sağlık ve güvenlik',
        summary:
          'Gürcistan\'da her acil durum için tek numara var: 112. Geri kalan her şey için neredeyse her köşede eczane, şehirlerde de özel klinikler var.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'Kısaca',
            body: 'Acil durumda polis, ambulans ya da itfaiye için 112\'yi arayın. Tüm Gürcistan\'da gece gündüz çalışır ve SIM kartı ya da bakiyesi olmayan bir telefondan bile arayabilirsiniz. Şimdi telefonunuza kaydedin.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Eczaneler',
            body: 'Şehirlerde büyük zincirler dahil çok sayıda eczane var, bazıları gece boyunca açık. Eczacı günlük konularda yardımcı olur. Bazı ilaçlar yalnızca reçeteyle verilir, düzenli bir ilaç kullanıyorsanız reçetenizi getirin ve ilacın sadece marka adını değil etken madde adını da bilin.',
          },
          {
            kind: 'WHERE',
            heading: 'Doktorlar, klinikler ve tahliller',
            body: 'Yabancıların çoğu, Tiflis ve Batum\'da kolayca bulunan özel klinikleri kullanır. Kan tahlilleri ve diğer kontroller özel laboratuvarlarda ve çok branşlı kliniklerde yapılır, çoğu için doktor sevki gerekmez. Randevu alırken doktorun rahat ettiğiniz bir dili konuşup konuşmadığını sorun.',
          },
          {
            kind: 'NOTES',
            heading: 'Sigorta',
            body: 'Özel sağlık hizmeti ücretlidir, bu yüzden Gürcistan\'da geçerli bir sağlık sigortası ilk günden işe yarar. Almadan önce hangi kliniklerle çalıştığını ve önce sizin ödeyip sonra geri mi aldığınızı kontrol edin. Yabancı bir mukimin devlet sağlık programına katılıp katılamayacağını doğrulayamadık. Buna güvenmeden önce kendi durumunuzu Sağlık Bakanlığı\'na (moh.gov.ge) sorun.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Günlük güvenlik',
            body: 'Yolu dikkatli geçin, sürücüler hızlı olabilir, mümkün olduğunda yaya geçidi ve alt geçit kullanın. Dağlarda hava hızlı değişir, yürüyüşten önce birine rotanızı söyleyin ve hava tahminine bakın. Emin olmadığınız bir şey olursa 112\'yi arayın.',
          },
        ],
      },
      ar: {
        title: 'الصحة والسلامة',
        summary:
          'رقم واحد لكل حالات الطوارئ في جورجيا: 112. ولكل ما عدا ذلك هناك صيدليات في كل زاوية تقريبًا، وعيادات خاصة في المدن.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'باختصار',
            body: 'في الطوارئ اتصل بـ 112 لطلب الشرطة أو الإسعاف أو الدفاع المدني. يعمل في كل جورجيا ليلًا ونهارًا، ويمكنك الاتصال به حتى من هاتف بلا شريحة أو بلا رصيد. احفظه في هاتفك الآن.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'الصيدليات',
            body: 'في المدن صيدليات كثيرة، منها سلاسل كبيرة، وبعضها يفتح طوال الليل. والصيدلي يساعدك في الأمور اليومية. بعض الأدوية لا تُصرف إلا بوصفة طبيب، فإن كنت تتناول دواء بانتظام فخذ وصفتك معك واعرف الاسم العلمي للدواء لا الاسم التجاري فقط.',
          },
          {
            kind: 'WHERE',
            heading: 'الأطباء والعيادات والتحاليل',
            body: 'معظم الأجانب يراجعون عيادات خاصة، وهي سهلة الإيجاد في تبليسي وباتومي. تحاليل الدم والفحوص الأخرى تُجرى في مختبرات خاصة وعيادات متعددة التخصصات، ومعظمها لا يحتاج إلى تحويل من طبيب. عند الحجز اسأل هل يتكلم الطبيب لغة ترتاح لها.',
          },
          {
            kind: 'NOTES',
            heading: 'التأمين',
            body: 'الرعاية الخاصة مدفوعة، لذلك يستحق التأمين الصحي الذي يعمل في جورجيا أن يكون معك من أول يوم. قبل الشراء تأكد من العيادات التي يتعامل معها، وهل تدفع أنت أولًا ثم تسترد المبلغ. أما هل يستطيع المقيم الأجنبي الانضمام إلى البرنامج الصحي الحكومي فلم نتمكن من التأكد منه، فاسأل وزارة الصحة (moh.gov.ge) عن وضعك قبل أن تعتمد عليه.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'السلامة في الحياة اليومية',
            body: 'انتبه عند عبور الطريق لأن السائقين قد يسرعون، واستخدم ممرات المشاة والأنفاق متى استطعت. في الجبال يتغير الطقس بسرعة، فأخبر أحدًا بمسارك وتابع النشرة الجوية قبل أي رحلة مشي. وإذا لم تكن متأكدًا من شيء، اتصل بـ 112.',
          },
        ],
      },
      he: {
        title: 'בריאות ובטיחות',
        summary:
          'בגאורגיה יש מספר אחד לכל מקרה חירום: 112. לכל השאר יש בתי מרקחת כמעט בכל פינה ומרפאות פרטיות בערים.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'בקצרה',
            body: 'במקרה חירום התקשרו ל־112 כדי להזמין משטרה, אמבולנס או כבאות. המספר עובד בכל גאורגיה, ביום ובלילה, ואפשר להתקשר אליו אפילו מטלפון בלי סים או בלי יתרה. שמרו אותו בטלפון עכשיו.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'בתי מרקחת',
            body: 'בערים יש הרבה בתי מרקחת, כולל רשתות גדולות, וחלקם פתוחים כל הלילה. הרוקח יכול לעזור בדברים יומיומיים. חלק מהתרופות ניתנות רק במרשם רופא, אז אם אתם לוקחים משהו באופן קבוע, הביאו את המרשם ודעו את השם הגנרי של התרופה, לא רק את המותג.',
          },
          {
            kind: 'WHERE',
            heading: 'רופאים, מרפאות ובדיקות',
            body: 'רוב הזרים משתמשים במרפאות פרטיות, וקל למצוא אותן בטביליסי ובבטומי. בדיקות דם ובדיקות אחרות נעשות במעבדות פרטיות ובמרפאות רב תחומיות, ולרובן לא צריך הפניה מרופא. כשקובעים תור, שאלו אם הרופא מדבר בשפה שנוחה לכם.',
          },
          {
            kind: 'NOTES',
            heading: 'ביטוח',
            body: 'רפואה פרטית עולה כסף, אז ביטוח בריאות שעובד בגאורגיה שווה מהיום הראשון. לפני שקונים, בדקו עם אילו מרפאות הוא עובד והאם משלמים קודם ומקבלים החזר אחר כך. אם תושב זר יכול להצטרף לתוכנית הבריאות הממלכתית, את זה לא הצלחנו לאמת. שאלו את משרד הבריאות (moh.gov.ge) על המעמד שלכם לפני שסומכים על זה.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'בטיחות ביומיום',
            body: 'היזהרו כשחוצים כביש, כי נהגים יכולים לנסוע מהר, והשתמשו במעברי חצייה ובמעברים תת קרקעיים כשאפשר. בהרים מזג האוויר משתנה מהר, אז ספרו למישהו על המסלול ובדקו תחזית לפני טיול. אם אתם לא בטוחים במשהו, 112 הוא המספר.',
          },
        ],
      },
    },
    facts: [
      {
        key: 'emergency-number-112',
        factClass: 'PROCESS',
        register: 'OFFICIAL_REQUIREMENT',
        availability: 'ESTABLISHED',
        sources: ['police112', 'madlobaHealth'],
        value: { number: '112' },
        statement: {
          en: '112 is the single emergency number in Georgia for police, ambulance and fire and rescue. It works 24 hours a day across the whole country, including from mobile phones without a SIM card or with a negative balance.',
          ka: '112 საქართველოში ერთიანი საგანგებო ნომერია პოლიციის, სასწრაფოს და სახანძრო სამაშველო სამსახურისთვის. ის მთელ ქვეყანაში 24 საათი მუშაობს, მათ შორის სიმ ბარათის გარეშე ან უარყოფითი ბალანსით მობილურიდანაც.',
          ru: '112 это единый номер экстренных служб в Грузии: полиция, скорая и пожарно спасательная служба. Он работает круглосуточно по всей стране, в том числе с мобильного без SIM карты или с отрицательным балансом.',
          tr: '112, Gürcistan\'da polis, ambulans ve itfaiye ve kurtarma için tek acil durum numarasıdır. Tüm ülkede 24 saat çalışır, SIM kartı olmayan ya da bakiyesi eksi olan cep telefonlarından da aranabilir.',
          ar: 'الرقم 112 هو رقم الطوارئ الموحد في جورجيا للشرطة والإسعاف والإطفاء والإنقاذ. يعمل على مدار الساعة في كل البلاد، حتى من هاتف محمول بلا شريحة أو برصيد سالب.',
          he: '112 הוא מספר החירום האחיד בגאורגיה למשטרה, לאמבולנס ולכבאות והצלה. הוא פועל 24 שעות ביממה בכל הארץ, גם מטלפון נייד בלי סים או עם יתרה שלילית.',
        },
      },
    ],
  },

  {
    slug: 'starting-a-business',
    domain: 'BUSINESS',
    pathway: 'INVEST',
    factClass: 'FEE',
    register: 'OFFICIAL_REQUIREMENT',
    sortOrder: 100,
    content: {
      en: {
        title: 'Starting a small business',
        summary:
          'Registering a business in Georgia is quick and done at one counter. Most freelancers and small traders start as an individual entrepreneur and apply for small business status.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'The short answer',
            body: 'The two usual choices are an individual entrepreneur, which is you trading in your own name, and a limited liability company (LLC). Both are registered by the Public Registry, and you do it at a Public Service Hall. Registering an individual entrepreneur costs 26 lari for next working day, or 75 lari the same day. Registering a company costs 200 lari, or 400 lari the same day.',
          },
          {
            kind: 'WHAT_YOU_NEED',
            heading: 'What to bring',
            body: 'For an individual entrepreneur, your passport and an address for the business. For a company you also need the charter signed by every founder, the consent of the person who will be director, and proof of the legal address, such as a lease or a letter from the owner. Papers signed abroad must be notarised and apostilled or legalised. A landlord letter has to be notarised in Georgia unless it is signed in front of the registry staff. If you do not speak Georgian, bring an interpreter, and ask the Public Service Hall for the current list before you go.',
          },
          {
            kind: 'COST',
            heading: 'Small business status, 1%',
            body: 'An individual entrepreneur with yearly turnover under 500,000 lari can register as a small business and pay 1% of turnover instead of tax on profit. Above 500,000 lari the rate becomes 3%. A micro business, with turnover under 30,000 lari and no employees, pays no tax on that business income. These statuses are not automatic, you have to register for them. The Revenue Service (rs.ge) can tell you how. An LLC is taxed differently. Once taxable turnover passes 100,000 lari you must register for VAT.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'A business bank account',
            body: 'Once registered, open a business account at a Georgian bank. Each bank decides which papers it wants, so take your registration extract, your passport and a short, clear description of what the business does and where the money comes from. Our page on opening a bank account explains what to expect.',
          },
          {
            kind: 'NOTES',
            heading: 'Worth doing',
            body: 'Talk to a local accountant before you register. They can tell you which form suits your work, whether small business status fits it, and what you must file each month. Your home country may also tax you, so check that side too.',
          },
        ],
      },
      ka: {
        title: 'მცირე ბიზნესის დაწყება',
        summary:
          'საქართველოში ბიზნესის რეგისტრაცია სწრაფია და ერთ ფანჯარაში ხდება. ფრილანსერებისა და მცირე მოვაჭრეების უმეტესობა ინდივიდუალური მეწარმით იწყებს და მცირე ბიზნესის სტატუსს ითხოვს.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'მოკლე პასუხი',
            body: 'ჩვეულებრივ ორ ფორმას ირჩევენ: ინდივიდუალური მეწარმე, ანუ საქმიანობა თქვენი სახელით, და შეზღუდული პასუხისმგებლობის საზოგადოება (შპს). ორივეს საჯარო რეესტრი არეგისტრირებს და ამას იუსტიციის სახლში აკეთებთ. ინდივიდუალური მეწარმის რეგისტრაცია 26 ლარი ღირს მომდევნო სამუშაო დღეს, ან 75 ლარი იმავე დღეს. კომპანიის რეგისტრაცია 200 ლარია, ან 400 ლარი იმავე დღეს.',
          },
          {
            kind: 'WHAT_YOU_NEED',
            heading: 'რა წაიღოთ',
            body: 'ინდივიდუალური მეწარმისთვის პასპორტი და ბიზნესის მისამართი. კომპანიისთვის ასევე გჭირდებათ ყველა დამფუძნებლის ხელმოწერილი წესდება, დირექტორად დანიშნული პირის თანხმობა და იურიდიული მისამართის დამადასტურებელი დოკუმენტი, მაგალითად იჯარის ხელშეკრულება ან მესაკუთრის წერილი. საზღვარგარეთ ხელმოწერილი საბუთი ნოტარიულად დამოწმებული და აპოსტილირებული ან ლეგალიზებული უნდა იყოს. მესაკუთრის წერილი საქართველოში ნოტარიულად უნდა დამოწმდეს, თუ რეესტრის თანამშრომლის თანდასწრებით არ არის ხელმოწერილი. თუ ქართული არ იცით, წაიყვანეთ თარჯიმანი, და წასვლამდე იუსტიციის სახლში მოქმედი სია გადაამოწმეთ.',
          },
          {
            kind: 'COST',
            heading: 'მცირე ბიზნესის სტატუსი, 1%',
            body: 'ინდივიდუალურ მეწარმეს, რომლის წლიური ბრუნვა 500 000 ლარზე ნაკლებია, შეუძლია მცირე ბიზნესის სტატუსი მიიღოს და მოგების გადასახადის ნაცვლად ბრუნვის 1% გადაიხადოს. 500 000 ლარს ზემოთ განაკვეთი 3% ხდება. მიკრო ბიზნესი, 30 000 ლარზე ნაკლები ბრუნვით და დაქირავებულების გარეშე, ამ შემოსავალზე გადასახადს არ იხდის. ეს სტატუსები ავტომატურად არ ენიჭება, მათთვის რეგისტრაცია გჭირდებათ. როგორ, ამას შემოსავლების სამსახური (rs.ge) გეტყვით. შპს სხვანაირად იბეგრება. როცა დასაბეგრი ბრუნვა 100 000 ლარს გადააჭარბებს, დღგ-ის გადამხდელად რეგისტრაცია სავალდებულოა.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'ბიზნეს ანგარიში ბანკში',
            body: 'რეგისტრაციის შემდეგ გახსენით ბიზნეს ანგარიში ქართულ ბანკში. რა საბუთს მოითხოვს, ყოველი ბანკი თავად წყვეტს, ამიტომ წაიღეთ რეგისტრაციის ამონაწერი, პასპორტი და მოკლე, გასაგები აღწერა, რას აკეთებს ბიზნესი და საიდან მოდის ფული. რას უნდა ელოდოთ, ჩვენს გვერდზე საბანკო ანგარიშის გახსნის შესახებ წაიკითხავთ.',
          },
          {
            kind: 'NOTES',
            heading: 'ღირს გააკეთოთ',
            body: 'რეგისტრაციამდე გაესაუბრეთ ადგილობრივ ბუღალტერს. ის გეტყვით, რომელი ფორმა უხდება თქვენს საქმიანობას, შეესაბამება თუ არა მცირე ბიზნესის სტატუსი და რა უნდა წარადგინოთ ყოველთვე. შეიძლება თქვენმა ქვეყანამაც დაგაბეგროთ, ამიტომ ესეც გადაამოწმეთ.',
          },
        ],
      },
      ru: {
        title: 'Как открыть небольшой бизнес',
        summary:
          'Регистрация бизнеса в Грузии быстрая и проходит в одном окне. Большинство фрилансеров и небольших торговцев начинают как индивидуальный предприниматель и оформляют статус малого бизнеса.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'Коротко',
            body: 'Обычно выбирают одно из двух: индивидуальный предприниматель, то есть деятельность на ваше имя, или общество с ограниченной ответственностью (ООО). Оба регистрирует Публичный реестр, и делается это в Доме юстиции. Регистрация ИП стоит 26 лари на следующий рабочий день или 75 лари в тот же день. Регистрация компании стоит 200 лари или 400 лари в тот же день.',
          },
          {
            kind: 'WHAT_YOU_NEED',
            heading: 'Что взять с собой',
            body: 'Для ИП паспорт и адрес для бизнеса. Для компании ещё нужен устав, подписанный всеми учредителями, согласие будущего директора и подтверждение юридического адреса, например договор аренды или письмо собственника. Документы, подписанные за границей, должны быть нотариально заверены и апостилированы или легализованы. Письмо собственника нужно заверить у нотариуса в Грузии, если его не подписывают при сотруднике реестра. Если не говорите по-грузински, возьмите переводчика и заранее уточните актуальный список в Доме юстиции.',
          },
          {
            kind: 'COST',
            heading: 'Статус малого бизнеса, 1%',
            body: 'ИП с годовым оборотом меньше 500 000 лари может зарегистрироваться как малый бизнес и платить 1% от оборота вместо налога на прибыль. Свыше 500 000 лари ставка становится 3%. Микробизнес с оборотом меньше 30 000 лари и без сотрудников не платит налог с этого дохода. Эти статусы не присваиваются автоматически, для них нужно зарегистрироваться. Как именно, подскажет Служба доходов (rs.ge). ООО облагается иначе. Когда облагаемый оборот превышает 100 000 лари, нужно встать на учёт по НДС.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Бизнес счёт в банке',
            body: 'После регистрации откройте бизнес счёт в грузинском банке. Какие документы нужны, каждый банк решает сам, поэтому возьмите выписку о регистрации, паспорт и короткое понятное описание, чем занимается бизнес и откуда деньги. Чего ожидать, мы рассказываем на странице об открытии банковского счёта.',
          },
          {
            kind: 'NOTES',
            heading: 'Стоит сделать',
            body: 'До регистрации поговорите с местным бухгалтером. Он подскажет, какая форма подходит вашей работе, подходит ли статус малого бизнеса и что нужно сдавать каждый месяц. Ваша страна тоже может облагать вас налогом, так что проверьте и это.',
          },
        ],
      },
      tr: {
        title: 'Küçük bir işletme kurmak',
        summary:
          'Gürcistan\'da işletme kaydı hızlıdır ve tek bir gişede yapılır. Serbest çalışanların ve küçük esnafın çoğu bireysel girişimci olarak başlar ve küçük işletme statüsüne başvurur.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'Kısaca',
            body: 'Genelde iki seçenek var: bireysel girişimci, yani kendi adınıza ticaret, ve limited şirket (LLC). İkisini de Kamu Sicili kaydeder, bunu bir Kamu Hizmetleri Salonu\'nda yaparsınız. Bireysel girişimci kaydı ertesi iş günü için 26 lari, aynı gün için 75 lari. Şirket kaydı 200 lari, aynı gün için 400 lari.',
          },
          {
            kind: 'WHAT_YOU_NEED',
            heading: 'Yanınıza alın',
            body: 'Bireysel girişimci için pasaportunuz ve işletme adresi. Şirket için ayrıca tüm kurucuların imzaladığı ana sözleşme, müdür olacak kişinin onayı ve kira sözleşmesi ya da malikten bir yazı gibi yasal adres belgesi gerekir. Yurt dışında imzalanan belgeler noter onaylı ve apostilli ya da tasdikli olmalıdır. Malik yazısı, sicil görevlisinin önünde imzalanmıyorsa Gürcistan\'da notere onaylatılmalıdır. Gürcüce bilmiyorsanız bir tercüman götürün ve gitmeden önce güncel listeyi Kamu Hizmetleri Salonu\'na sorun.',
          },
          {
            kind: 'COST',
            heading: 'Küçük işletme statüsü, %1',
            body: 'Yıllık cirosu 500.000 larinin altında olan bireysel girişimci küçük işletme olarak kaydolabilir ve kâr vergisi yerine cironun %1\'ini öder. 500.000 lariyi aşınca oran %3 olur. Cirosu 30.000 larinin altında ve çalışanı olmayan mikro işletme bu gelir üzerinden vergi ödemez. Bu statüler otomatik değildir, bunlar için kayıt olmanız gerekir. Nasıl yapılacağını Gelir İdaresi (rs.ge) söyler. Limited şirket farklı vergilendirilir. Vergiye tabi ciro 100.000 lariyi geçince KDV kaydı zorunludur.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'İşletme banka hesabı',
            body: 'Kayıttan sonra bir Gürcü bankasında işletme hesabı açın. Her banka hangi belgeleri istediğine kendi karar verir, bu yüzden kayıt özetinizi, pasaportunuzu ve işletmenin ne yaptığını ve paranın nereden geldiğini anlatan kısa, net bir açıklama götürün. Neler beklemeniz gerektiğini banka hesabı açma sayfamızda anlatıyoruz.',
          },
          {
            kind: 'NOTES',
            heading: 'Yapmaya değer',
            body: 'Kaydolmadan önce yerel bir muhasebeciyle konuşun. Hangi biçimin işinize uyduğunu, küçük işletme statüsünün uygun olup olmadığını ve her ay neleri beyan etmeniz gerektiğini söyler. Kendi ülkeniz de sizi vergilendirebilir, onu da kontrol edin.',
          },
        ],
      },
      ar: {
        title: 'تأسيس عمل صغير',
        summary:
          'تسجيل النشاط التجاري في جورجيا سريع ويتم عند شباك واحد. معظم العاملين المستقلين وأصحاب التجارة الصغيرة يبدؤون كرائد أعمال فردي ثم يطلبون صفة العمل الصغير.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'باختصار',
            body: 'الخياران المعتادان هما رائد الأعمال الفردي، أي أن تعمل باسمك، والشركة ذات المسؤولية المحدودة. كلاهما يسجّله السجل العام، وتقوم بذلك في قاعة الخدمات العامة. تسجيل رائد الأعمال الفردي يكلّف 26 لاري في يوم العمل التالي، أو 75 لاري في اليوم نفسه. وتسجيل الشركة يكلّف 200 لاري، أو 400 لاري في اليوم نفسه.',
          },
          {
            kind: 'WHAT_YOU_NEED',
            heading: 'ما تحضره معك',
            body: 'لرائد الأعمال الفردي: جوازك وعنوان للنشاط. وللشركة تحتاج أيضًا إلى النظام الأساسي موقّعًا من كل المؤسسين، وموافقة الشخص الذي سيكون مديرًا، وإثبات العنوان القانوني مثل عقد إيجار أو رسالة من المالك. الأوراق الموقّعة في الخارج يجب أن تكون موثّقة وعليها أبوستيل أو مصدّقة. ورسالة المالك يجب توثيقها عند كاتب عدل في جورجيا ما لم تُوقَّع أمام موظف السجل. وإذا كنت لا تتكلم الجورجية فخذ مترجمًا، واسأل قاعة الخدمات العامة عن القائمة الحالية قبل أن تذهب.',
          },
          {
            kind: 'COST',
            heading: 'صفة العمل الصغير، 1%',
            body: 'رائد الأعمال الفردي الذي يقل دورانه السنوي عن 500,000 لاري يستطيع التسجيل كعمل صغير ودفع 1% من الدوران بدل ضريبة الأرباح. وفوق 500,000 لاري تصبح النسبة 3%. أما العمل المتناهي الصغر، بدوران أقل من 30,000 لاري ومن دون موظفين، فلا يدفع ضريبة على ذلك الدخل. هذه الصفات لا تُمنح تلقائيًا، بل يجب أن تسجّل لها، ومصلحة الإيرادات (rs.ge) تخبرك كيف. والشركة ذات المسؤولية المحدودة تخضع لضرائب مختلفة. وعندما يتجاوز الدوران الخاضع للضريبة 100,000 لاري يجب التسجيل في ضريبة القيمة المضافة.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'حساب بنكي للعمل',
            body: 'بعد التسجيل افتح حسابًا تجاريًا في بنك جورجي. كل بنك يقرر بنفسه الأوراق التي يريدها، فخذ مستخرج التسجيل وجوازك ووصفًا قصيرًا وواضحًا لما يفعله نشاطك ومن أين يأتي المال. وفي صفحتنا عن فتح حساب بنكي نشرح ما تتوقعه.',
          },
          {
            kind: 'NOTES',
            heading: 'يستحق أن تفعله',
            body: 'تحدّث مع محاسب محلي قبل التسجيل. سيخبرك أي شكل يناسب عملك، وهل تناسبك صفة العمل الصغير، وما الذي يجب أن تقدّمه كل شهر. وقد يفرض بلدك أيضًا ضرائب عليك، فتحقق من ذلك أيضًا.',
          },
        ],
      },
      he: {
        title: 'לפתוח עסק קטן',
        summary:
          'רישום עסק בגאורגיה מהיר ונעשה בדלפק אחד. רוב הפרילנסרים והסוחרים הקטנים מתחילים כיזם יחיד ומבקשים מעמד של עסק קטן.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'בקצרה',
            body: 'שתי האפשרויות הרגילות הן יזם יחיד, כלומר עסק על שמכם, וחברה בערבון מוגבל. את שתיהן רושם המרשם הציבורי, ועושים את זה באולם שירותים ציבוריים. רישום יזם יחיד עולה 26 לארי ליום העבודה הבא, או 75 לארי באותו יום. רישום חברה עולה 200 לארי, או 400 לארי באותו יום.',
          },
          {
            kind: 'WHAT_YOU_NEED',
            heading: 'מה להביא',
            body: 'ליזם יחיד: דרכון וכתובת לעסק. לחברה צריך גם תקנון חתום על ידי כל המייסדים, הסכמה של מי שיהיה המנהל, והוכחת כתובת רשומה, כמו חוזה שכירות או מכתב מבעל הנכס. מסמכים שנחתמו בחו״ל צריכים אישור נוטריוני ואפוסטיל או אישור קונסולרי. מכתב מבעל הנכס צריך אישור נוטריון בגאורגיה, אלא אם נחתם מול עובד המרשם. אם אתם לא מדברים גאורגית, הביאו מתורגמן, ושאלו באולם השירותים מה הרשימה העדכנית לפני שאתם הולכים.',
          },
          {
            kind: 'COST',
            heading: 'מעמד עסק קטן, 1%',
            body: 'יזם יחיד עם מחזור שנתי מתחת ל־500,000 לארי יכול להירשם כעסק קטן ולשלם 1% מהמחזור במקום מס על הרווח. מעל 500,000 לארי השיעור עולה ל־3%. מיקרו עסק, עם מחזור מתחת ל־30,000 לארי ובלי עובדים, לא משלם מס על ההכנסה הזו. המעמדות האלה לא אוטומטיים, צריך להירשם אליהם. רשות המסים (rs.ge) תסביר לכם איך. חברה בערבון מוגבל ממוסה אחרת. כשהמחזור החייב עובר 100,000 לארי, חובה להירשם למע״מ.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'חשבון בנק לעסק',
            body: 'אחרי הרישום פתחו חשבון עסקי בבנק גאורגי. כל בנק מחליט בעצמו אילו מסמכים הוא רוצה, אז הביאו את נסח הרישום, דרכון ותיאור קצר וברור של מה העסק עושה ומאיפה מגיע הכסף. בעמוד שלנו על פתיחת חשבון בנק אנחנו מסבירים למה לצפות.',
          },
          {
            kind: 'NOTES',
            heading: 'כדאי לעשות',
            body: 'דברו עם רואה חשבון מקומי לפני הרישום. הוא יגיד לכם איזו צורה מתאימה לעבודה שלכם, האם מעמד עסק קטן מתאים, ומה צריך להגיש כל חודש. גם המדינה שלכם עשויה למסות אתכם, אז בדקו גם את הצד הזה.',
          },
        ],
      },
    },
    facts: [
      {
        key: 'registration-fees',
        factClass: 'FEE',
        register: 'OFFICIAL_REQUIREMENT',
        availability: 'ESTABLISHED',
        sources: ['naprFees', 'investGeorgiaRegister'],
        value: { currency: 'GEL', individualEntrepreneur: 26, individualEntrepreneurSameDay: 75, company: 200, companySameDay: 400 },
        statement: {
          en: 'Businesses are registered by the National Agency of Public Registry through the Public Service Hall. Registering an individual entrepreneur costs 26 GEL in one working day or 75 GEL on the day of application. Registering any other entrepreneur, such as an LLC, costs 200 GEL in one working day or 400 GEL on the day.',
          ka: 'ბიზნესს საჯარო რეესტრის ეროვნული სააგენტო არეგისტრირებს იუსტიციის სახლის მეშვეობით. ინდივიდუალური მეწარმის რეგისტრაცია ღირს 26 ლარი ერთ სამუშაო დღეში ან 75 ლარი განცხადების დღეს. სხვა მეწარმის, მაგალითად შპს-ის, რეგისტრაცია ღირს 200 ლარი ერთ სამუშაო დღეში ან 400 ლარი იმავე დღეს.',
          ru: 'Бизнес регистрирует Национальное агентство публичного реестра через Дом юстиции. Регистрация ИП стоит 26 лари за один рабочий день или 75 лари в день подачи. Регистрация другого предпринимателя, например ООО, стоит 200 лари за один рабочий день или 400 лари в тот же день.',
          tr: 'İşletmeleri Kamu Sicili Ulusal Ajansı, Kamu Hizmetleri Salonu aracılığıyla kaydeder. Bireysel girişimci kaydı bir iş gününde 26 GEL, başvuru günü 75 GEL\'dir. Limited şirket gibi diğer girişimcilerin kaydı bir iş gününde 200 GEL, aynı gün 400 GEL\'dir.',
          ar: 'تسجّل الوكالة الوطنية للسجل العام الأنشطة التجارية عبر قاعة الخدمات العامة. تسجيل رائد الأعمال الفردي يكلّف 26 لاري خلال يوم عمل واحد أو 75 لاري في يوم تقديم الطلب. وتسجيل أي كيان آخر، مثل الشركة ذات المسؤولية المحدودة، يكلّف 200 لاري خلال يوم عمل أو 400 لاري في اليوم نفسه.',
          he: 'את העסקים רושמת הסוכנות הלאומית לרישום ציבורי דרך אולם השירותים הציבוריים. רישום יזם יחיד עולה 26 לארי תוך יום עבודה אחד או 75 לארי ביום הגשת הבקשה. רישום כל יזם אחר, כמו חברה בערבון מוגבל, עולה 200 לארי תוך יום עבודה או 400 לארי באותו יום.',
        },
      },
      {
        key: 'small-business-status',
        factClass: 'LEGAL',
        register: 'PRACTICAL_CONTEXT',
        availability: 'ESTABLISHED',
        sources: ['pwcSmallBusiness', 'pwcVat'],
        value: { rate: 0.01, rateAbove: 0.03, turnoverLimitGel: 500000, microLimitGel: 30000, vatThresholdGel: 100000 },
        statement: {
          en: 'An individual entrepreneur with turnover under 500,000 GEL may register as a small business and pay 1% of turnover, rising to 3% above that. A micro business with turnover under 30,000 GEL and no employees is exempt on its business income. VAT registration is required once taxable turnover exceeds 100,000 GEL.',
          ka: 'ინდივიდუალურ მეწარმეს 500 000 ლარზე ნაკლები ბრუნვით შეუძლია მცირე ბიზნესად დარეგისტრირდეს და ბრუნვის 1% გადაიხადოს, ამ ზღვრის ზემოთ კი 3%. მიკრო ბიზნესი 30 000 ლარზე ნაკლები ბრუნვით და დაქირავებულების გარეშე სამეწარმეო შემოსავალზე გადასახადისგან თავისუფალია. დღგ-ის რეგისტრაცია სავალდებულოა, როცა დასაბეგრი ბრუნვა 100 000 ლარს აჭარბებს.',
          ru: 'ИП с оборотом меньше 500 000 лари может зарегистрироваться как малый бизнес и платить 1% от оборота, а выше этого порога 3%. Микробизнес с оборотом меньше 30 000 лари и без сотрудников освобождён от налога на доход от бизнеса. Регистрация по НДС обязательна, когда облагаемый оборот превышает 100 000 лари.',
          tr: 'Cirosu 500.000 GEL\'in altındaki bireysel girişimci küçük işletme olarak kaydolup cironun %1\'ini ödeyebilir, bu sınırın üstünde oran %3 olur. Cirosu 30.000 GEL\'in altında ve çalışanı olmayan mikro işletme ticari gelirinde vergiden muaftır. Vergiye tabi ciro 100.000 GEL\'i aşınca KDV kaydı zorunludur.',
          ar: 'يمكن لرائد الأعمال الفردي الذي يقل دورانه عن 500,000 لاري أن يسجّل كعمل صغير ويدفع 1% من الدوران، وترتفع النسبة إلى 3% فوق ذلك. والعمل المتناهي الصغر بدوران أقل من 30,000 لاري ومن دون موظفين معفى من الضريبة على دخله التجاري. ويجب التسجيل في ضريبة القيمة المضافة متى تجاوز الدوران الخاضع للضريبة 100,000 لاري.',
          he: 'יזם יחיד עם מחזור מתחת ל־500,000 לארי יכול להירשם כעסק קטן ולשלם 1% מהמחזור, ומעל לסף הזה 3%. מיקרו עסק עם מחזור מתחת ל־30,000 לארי ובלי עובדים פטור ממס על ההכנסה העסקית. רישום למע״מ חובה כשהמחזור החייב במס עובר 100,000 לארי.',
        },
      },
    ],
  },
  {
    slug: 'places-to-visit',
    domain: 'DAILY_LIFE',
    pathway: 'LIVE',
    factClass: 'GENERAL',
    register: 'PRACTICAL_CONTEXT',
    sortOrder: 110,
    content: {
      en: {
        title: 'Places to visit',
        summary:
          'Georgia is small, and that is the good news: high mountains, old churches, wine country and the sea are all within a day of Tbilisi.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'The short answer',
            body: 'Start close to home with Mtskheta, then spend a weekend in Kakheti for wine and Sighnaghi. Go north to Kazbegi for the mountains, west to Kutaisi for monasteries and caves, and save a few days for Svaneti. In summer, Batumi and the sea. The national tourism site, georgia.travel, has more on every place here.',
          },
          {
            kind: 'WHERE',
            heading: 'Easy trips from Tbilisi',
            body: 'Mtskheta, the old capital, is about 20 minutes away by road. Svetitskhoveli Cathedral and Jvari Church are there, and three of its churches are on the UNESCO World Heritage List. Kakheti, to the east, is Georgia\'s main wine region, where wine is still made in clay qvevri. Sighnaghi, known as the City of Love, has an old town wall and wide views over the Alazani Valley to the Caucasus. Telavi has the palace of King Erekle II.',
          },
          {
            kind: 'WHERE',
            heading: 'The mountains',
            body: 'Kazbegi is one of the most visited places in Georgia after Tbilisi and Batumi. From the village of Stepantsminda you can walk or drive up to the 14th century Gergeti Trinity Church below Mount Kazbek, 5054 metres high. On the way is Gudauri, the country\'s best known ski resort. Further west, Svaneti is high mountain country with Mestia at its centre and its famous stone towers, 20 to 25 metres tall. The usual road there goes through Zugdidi.',
          },
          {
            kind: 'WHERE',
            heading: 'The west and the sea',
            body: 'Kutaisi was the capital until the Middle Ages. See Bagrati Cathedral, built in 1003, and Gelati Monastery, which is on the UNESCO list, then the Prometheus Cave and Sataplia nearby. Batumi is the place for the seaside, with a long Boulevard by the water, and early autumn is a lovely time to go.',
          },
          {
            kind: 'WHERE',
            heading: 'Borjomi and Vardzia',
            body: 'Borjomi is a small mountain town famous for its mineral water, which you can drink from a spring in the central park. The Borjomi Kharagauli National Park around it has hikes of one to three days. Further south, Vardzia is a medieval town and monastery cut into a cliff.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Before you go',
            body: 'Mountain roads and weather change with the season, so check the forecast and the road before a winter trip north or to Svaneti. Take your passport on trains. In villages, carry some cash, and a Magti SIM tends to have the best signal in the mountains.',
          },
        ],
      },
      ka: {
        title: 'სანახავი ადგილები',
        summary:
          'საქართველო პატარაა და ეს კარგი ამბავია: მაღალი მთები, ძველი ეკლესიები, ღვინის მხარე და ზღვა თბილისიდან ერთი დღის სავალზეა.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'მოკლე პასუხი',
            body: 'დაიწყეთ ახლოდან, მცხეთით, შემდეგ შაბათ-კვირა გაატარეთ კახეთში ღვინისა და სიღნაღისთვის. მთებისთვის წადით ჩრდილოეთით, ყაზბეგში, მონასტრებისა და მღვიმეებისთვის დასავლეთით, ქუთაისში, და რამდენიმე დღე სვანეთს დაუთმეთ. ზაფხულში კი ბათუმი და ზღვა. ეროვნული ტურისტული საიტი georgia.travel ყოველ ამ ადგილზე მეტს მოგიყვებათ.',
          },
          {
            kind: 'WHERE',
            heading: 'მარტივი გასვლები თბილისიდან',
            body: 'მცხეთა, ძველი დედაქალაქი, მანქანით დაახლოებით 20 წუთის სავალზეა. აქ არის სვეტიცხოველი და ჯვრის მონასტერი, მისი სამი ეკლესია კი იუნესკოს მსოფლიო მემკვიდრეობის სიაშია. კახეთი, აღმოსავლეთით, საქართველოს მთავარი ღვინის მხარეა, სადაც ღვინოს დღესაც ქვევრში აყენებენ. სიღნაღს, რომელსაც სიყვარულის ქალაქს ეძახიან, ძველი გალავანი და ალაზნის ველისა და კავკასიონის ფართო ხედი აქვს. თელავში ერეკლე მეორის სასახლეა.',
          },
          {
            kind: 'WHERE',
            heading: 'მთები',
            body: 'ყაზბეგი თბილისისა და ბათუმის შემდეგ ერთ-ერთი ყველაზე მონახულებადი ადგილია. სოფელ სტეფანწმინდიდან ფეხით ან მანქანით შეგიძლიათ ახვიდეთ XIV საუკუნის გერგეტის სამებამდე, 5054 მეტრის სიმაღლის მყინვარწვერის ძირას. გზაზე გუდაურია, ქვეყნის ყველაზე ცნობილი სათხილამურო კურორტი. დასავლეთით სვანეთია, მაღალმთიანი მხარე, რომლის ცენტრია მესტია, თავისი ცნობილი ქვის კოშკებით, რომელთა სიმაღლე 20-დან 25 მეტრამდეა. იქ ჩვეულებრივ ზუგდიდის გავლით მიდიან.',
          },
          {
            kind: 'WHERE',
            heading: 'დასავლეთი და ზღვა',
            body: 'ქუთაისი შუა საუკუნეებამდე დედაქალაქი იყო. ნახეთ 1003 წელს აგებული ბაგრატის ტაძარი და იუნესკოს სიაში შეტანილი გელათის მონასტერი, შემდეგ კი ახლომდებარე პრომეთეს მღვიმე და სათაფლია. ზღვისთვის ბათუმია, წყლის პირას გრძელი ბულვარით, და ადრეული შემოდგომა მისთვის საუკეთესო დროა.',
          },
          {
            kind: 'WHERE',
            heading: 'ბორჯომი და ვარძია',
            body: 'ბორჯომი პატარა მთის ქალაქია, ცნობილი თავისი მინერალური წყლით, რომლის დალევაც ცენტრალური პარკის წყაროდან შეგიძლიათ. ირგვლივ ბორჯომ ხარაგაულის ეროვნული პარკია ერთიდან სამ დღემდე ლაშქრობებით. სამხრეთით ვარძიაა, კლდეში ნაკვეთი შუა საუკუნეების ქალაქი და მონასტერი.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'წასვლამდე',
            body: 'მთის გზები და ამინდი სეზონთან ერთად იცვლება, ამიტომ ზამთარში ჩრდილოეთით ან სვანეთში გამგზავრებამდე ნახეთ პროგნოზი და გზის მდგომარეობა. მატარებელში პასპორტი თან იქონიეთ. სოფლებში ცოტა ნაღდი ფული გქონდეთ, მთაში კი, როგორც წესი, მაგთის სიმ ბარათს აქვს საუკეთესო კავშირი.',
          },
        ],
      },
      ru: {
        title: 'Куда поехать',
        summary:
          'Грузия маленькая, и это хорошая новость: высокие горы, древние храмы, винный край и море в пределах дня пути от Тбилиси.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'Коротко',
            body: 'Начните с близкого: Мцхета. Потом проведите выходные в Кахетии ради вина и Сигнахи. За горами езжайте на север, в Казбеги, за монастырями и пещерами на запад, в Кутаиси, и оставьте несколько дней на Сванетию. Летом Батуми и море. На национальном туристическом сайте georgia.travel есть больше о каждом из этих мест.',
          },
          {
            kind: 'WHERE',
            heading: 'Близкие поездки из Тбилиси',
            body: 'Мцхета, древняя столица, примерно в 20 минутах езды. Здесь Светицховели и монастырь Джвари, а три её храма входят в список Всемирного наследия ЮНЕСКО. Кахетия на востоке это главный винный регион Грузии, где вино до сих пор делают в глиняных квеври. В Сигнахи, который называют городом любви, сохранилась крепостная стена и широкий вид на Алазанскую долину и Кавказ. В Телави есть дворец царя Ираклия II.',
          },
          {
            kind: 'WHERE',
            heading: 'Горы',
            body: 'Казбеги одно из самых посещаемых мест Грузии после Тбилиси и Батуми. Из посёлка Степанцминда можно подняться пешком или на машине к церкви Гергети Самеба XIV века у подножия Казбека высотой 5054 метра. По дороге Гудаури, самый известный горнолыжный курорт страны. Западнее Сванетия, высокогорный край с центром в Местиа и знаменитыми каменными башнями высотой от 20 до 25 метров. Обычно туда едут через Зугдиди.',
          },
          {
            kind: 'WHERE',
            heading: 'Запад и море',
            body: 'Кутаиси был столицей до Средних веков. Посмотрите храм Баграта, построенный в 1003 году, и монастырь Гелати из списка ЮНЕСКО, а рядом пещеру Прометея и Сатаплиа. Для моря есть Батуми с длинным Бульваром вдоль воды, и ранняя осень там особенно хороша.',
          },
          {
            kind: 'WHERE',
            heading: 'Боржоми и Вардзия',
            body: 'Боржоми небольшой горный город, известный минеральной водой, которую можно пить прямо из источника в центральном парке. Вокруг Боржоми Харагаульский национальный парк с походами от одного до трёх дней. Южнее Вардзия, средневековый город и монастырь, вырезанные в скале.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Перед поездкой',
            body: 'Горные дороги и погода меняются по сезону, поэтому перед зимней поездкой на север или в Сванетию проверьте прогноз и состояние дороги. В поезде нужен паспорт. В сёлах держите немного наличных, а в горах лучшая связь обычно у Magti.',
          },
        ],
      },
      tr: {
        title: 'Gezilecek yerler',
        summary:
          'Gürcistan küçük ve bu iyi haber: yüksek dağlar, eski kiliseler, şarap bölgesi ve deniz Tiflis\'ten bir günlük mesafede.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'Kısaca',
            body: 'Yakından, Mtsheta\'dan başlayın, sonra şarap ve Sighnaghi için bir hafta sonunu Kaheti\'de geçirin. Dağlar için kuzeye, Kazbegi\'ye, manastırlar ve mağaralar için batıya, Kutaisi\'ye gidin, Svaneti\'ye de birkaç gün ayırın. Yazın Batum ve deniz. Ulusal turizm sitesi georgia.travel her yer hakkında daha fazlasını anlatıyor.',
          },
          {
            kind: 'WHERE',
            heading: 'Tiflis\'ten kolay geziler',
            body: 'Eski başkent Mtsheta arabayla yaklaşık 20 dakika uzaklıkta. Svetitskhoveli Katedrali ve Cvari Kilisesi burada, üç kilisesi UNESCO Dünya Mirası Listesi\'nde. Doğudaki Kaheti, şarabın hâlâ toprak küplerde, kvevride yapıldığı Gürcistan\'ın ana şarap bölgesi. Aşk Şehri diye bilinen Sighnaghi\'nin eski sur duvarı ve Alazani Vadisi\'ne, Kafkaslara bakan geniş manzarası var. Telavi\'de Kral II. Erekle\'nin sarayı bulunur.',
          },
          {
            kind: 'WHERE',
            heading: 'Dağlar',
            body: 'Kazbegi, Tiflis ve Batum\'dan sonra Gürcistan\'ın en çok ziyaret edilen yerlerinden biri. Stepantsminda köyünden yürüyerek ya da arabayla 14. yüzyıldan kalma Gergeti Sameba Kilisesi\'ne çıkabilirsiniz, arkasında 5054 metrelik Kazbek Dağı yükselir. Yolda ülkenin en bilinen kayak merkezi Gudauri var. Daha batıda, merkezi Mestia olan ve 20 ila 25 metre yüksekliğindeki ünlü taş kuleleriyle bilinen yüksek dağ bölgesi Svaneti bulunur. Oraya genelde Zugdidi üzerinden gidilir.',
          },
          {
            kind: 'WHERE',
            heading: 'Batı ve deniz',
            body: 'Kutaisi Orta Çağ\'a kadar başkentti. 1003\'te yapılan Bagrati Katedrali\'ni ve UNESCO listesindeki Gelati Manastırı\'nı görün, ardından yakındaki Prometheus Mağarası ve Sataplia\'ya gidin. Deniz için Batum var, su kenarında uzun bir Bulvar ile, erken sonbahar özellikle güzel.',
          },
          {
            kind: 'WHERE',
            heading: 'Borjomi ve Vardzia',
            body: 'Borjomi, maden suyuyla ünlü küçük bir dağ kasabası, suyu merkez parktaki kaynaktan içebilirsiniz. Çevresindeki Borjomi Kharagauli Milli Parkı\'nda bir ila üç günlük yürüyüş rotaları var. Daha güneyde Vardzia, kayalara oyulmuş Orta Çağ\'dan kalma bir şehir ve manastır.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Gitmeden önce',
            body: 'Dağ yolları ve hava mevsime göre değişir, kışın kuzeye ya da Svaneti\'ye gitmeden önce hava tahminine ve yol durumuna bakın. Trende pasaportunuz yanınızda olsun. Köylerde biraz nakit taşıyın, dağlarda genelde en iyi çekim Magti\'dedir.',
          },
        ],
      },
      ar: {
        title: 'أماكن تستحق الزيارة',
        summary:
          'جورجيا بلد صغير، وهذا خبر جيد: الجبال العالية والكنائس القديمة وأرض النبيذ والبحر كلها على بعد يوم من تبليسي.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'باختصار',
            body: 'ابدأ بالقريب، متسخيتا، ثم اقضِ عطلة نهاية أسبوع في كاخيتي من أجل النبيذ وسيغناغي. اتجه شمالًا إلى كازبيغي للجبال، وغربًا إلى كوتايسي للأديرة والكهوف، واترك بضعة أيام لسفانيتي. وفي الصيف باتومي والبحر. وفي موقع السياحة الوطني georgia.travel معلومات أكثر عن كل هذه الأماكن.',
          },
          {
            kind: 'WHERE',
            heading: 'رحلات سهلة من تبليسي',
            body: 'متسخيتا، العاصمة القديمة، على بعد نحو 20 دقيقة بالسيارة. فيها كاتدرائية سفيتيتسخوفيلي وكنيسة جفاري، وثلاث من كنائسها مدرجة في قائمة اليونسكو للتراث العالمي. وكاخيتي في الشرق هي منطقة النبيذ الأولى في جورجيا، وما زال النبيذ يُصنع فيها في جرار الفخار المسماة قفيفري. وسيغناغي، التي يسمونها مدينة الحب، فيها سور قديم وإطلالة واسعة على وادي ألازاني وجبال القوقاز. وفي تيلافي قصر الملك إريكلي الثاني.',
          },
          {
            kind: 'WHERE',
            heading: 'الجبال',
            body: 'كازبيغي من أكثر الأماكن زيارة في جورجيا بعد تبليسي وباتومي. من قرية ستيبانتسميندا تصعد مشيًا أو بالسيارة إلى كنيسة الثالوث في غيرغيتي من القرن الرابع عشر، تحت جبل كازبيك بارتفاع 5054 مترًا. وفي الطريق غوداوري، أشهر منتجع تزلج في البلاد. وإلى الغرب تقع سفانيتي، أرض الجبال العالية، ومركزها ميستيا بأبراجها الحجرية الشهيرة التي يبلغ ارتفاعها بين 20 و25 مترًا، والطريق المعتاد إليها يمر عبر زوغديدي.',
          },
          {
            kind: 'WHERE',
            heading: 'الغرب والبحر',
            body: 'كانت كوتايسي العاصمة حتى العصور الوسطى. زُر كاتدرائية باغراتي التي بُنيت عام 1003، ودير غيلاتي المدرج في قائمة اليونسكو، ثم كهف بروميثيوس وساتابليا القريبين. وللبحر هناك باتومي بكورنيشها الطويل على الماء، وأوائل الخريف وقت جميل لزيارتها.',
          },
          {
            kind: 'WHERE',
            heading: 'بورجومي وفاردزيا',
            body: 'بورجومي بلدة جبلية صغيرة مشهورة بمياهها المعدنية، ويمكنك الشرب من نبع في الحديقة المركزية. وحولها حديقة بورجومي خاراغاولي الوطنية بمسارات مشي من يوم إلى ثلاثة أيام. وإلى الجنوب فاردزيا، مدينة ودير من العصور الوسطى منحوتان في الصخر.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'قبل أن تذهب',
            body: 'طرق الجبال وطقسها يتغيران مع الفصول، فتحقق من النشرة الجوية وحالة الطريق قبل أي رحلة شتوية إلى الشمال أو إلى سفانيتي. خذ جوازك في القطار. وفي القرى احمل بعض النقود، وفي الجبال تكون تغطية Magti عادة هي الأفضل.',
          },
        ],
      },
      he: {
        title: 'מקומות לבקר בהם',
        summary:
          'גאורגיה קטנה, וזו בדיוק החדשה הטובה: הרים גבוהים, כנסיות עתיקות, ארץ היין והים נמצאים כולם במרחק יום מטביליסי.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'בקצרה',
            body: 'התחילו קרוב, במצחטה, ואז סוף שבוע בקאחתי בשביל היין וסיגנאגי. צפונה לקזבגי בשביל ההרים, מערבה לקוטאיסי בשביל מנזרים ומערות, ושמרו כמה ימים לסוואנטי. בקיץ, בטומי והים. באתר התיירות הלאומי georgia.travel יש עוד על כל אחד מהמקומות.',
          },
          {
            kind: 'WHERE',
            heading: 'טיולים קלים מטביליסי',
            body: 'מצחטה, הבירה העתיקה, נמצאת בערך 20 דקות נסיעה. שם קתדרלת סווטיצחובלי וכנסיית ג׳ווארי, ושלוש מהכנסיות שלה ברשימת המורשת העולמית של אונסק״ו. קאחתי במזרח היא אזור היין המרכזי של גאורגיה, ועדיין מכינים בה יין בכדי חרס שנקראים קווברי. בסיגנאגי, שקוראים לה עיר האהבה, יש חומה עתיקה ונוף רחב לעמק אלאזאני ולקווקז. בתלאווי נמצא הארמון של המלך ארקלה השני.',
          },
          {
            kind: 'WHERE',
            heading: 'ההרים',
            body: 'קזבגי הוא אחד המקומות המתוירים ביותר בגאורגיה אחרי טביליסי ובטומי. מהכפר סטפנצמינדה עולים ברגל או ברכב לכנסיית השילוש של גרגטי מהמאה ה־14, מתחת להר קזבק בגובה 5054 מטר. בדרך נמצא גודאורי, אתר הסקי המוכר ביותר במדינה. מערבה משם סוואנטי, ארץ הרים גבוהים שמרכזה מסטיה, עם מגדלי האבן המפורסמים בגובה 20 עד 25 מטר. בדרך כלל מגיעים לשם דרך זוגדידי.',
          },
          {
            kind: 'WHERE',
            heading: 'המערב והים',
            body: 'קוטאיסי הייתה הבירה עד ימי הביניים. בקרו בקתדרלת בגרטי שנבנתה ב־1003 ובמנזר גלאטי שברשימת אונסק״ו, ואחר כך במערת פרומתאוס ובסטאפליה הסמוכות. בשביל הים יש את בטומי, עם טיילת ארוכה לאורך המים, ותחילת הסתיו היא זמן נהדר להגיע.',
          },
          {
            kind: 'WHERE',
            heading: 'בורג׳ומי וורדזיה',
            body: 'בורג׳ומי היא עיירת הרים קטנה שמפורסמת במים המינרליים שלה, ואפשר לשתות אותם ממעיין בפארק המרכזי. סביבה פארק בורג׳ומי חרגאולי הלאומי, עם מסלולי הליכה של יום עד שלושה ימים. דרומה משם ורדזיה, עיר ומנזר מימי הביניים שחצובים בצוק.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'לפני שיוצאים',
            body: 'כבישי ההרים ומזג האוויר משתנים לפי העונה, אז לפני טיול חורף צפונה או לסוואנטי בדקו תחזית ומצב כבישים. ברכבת צריך דרכון. בכפרים כדאי להחזיק קצת מזומן, ובהרים הקליטה הכי טובה היא בדרך כלל של Magti.',
          },
        ],
      },
    },
    facts: [
      {
        key: 'mtskheta-unesco',
        factClass: 'GENERAL',
        register: 'PRACTICAL_CONTEXT',
        availability: 'ESTABLISHED',
        sources: ['gntaMtskheta', 'gntaImereti'],
        value: null,
        statement: {
          en: 'Three of Mtskheta\'s churches, Jvari, Svetitskhoveli and Samtavro, are on the UNESCO World Heritage List, and Mtskheta is about 20 minutes by road from Tbilisi. Gelati Monastery near Kutaisi is also a UNESCO World Heritage monument.',
          ka: 'მცხეთის სამი ეკლესია, ჯვარი, სვეტიცხოველი და სამთავრო, იუნესკოს მსოფლიო მემკვიდრეობის სიაშია, მცხეთა კი თბილისიდან მანქანით დაახლოებით 20 წუთშია. ქუთაისთან ახლოს მდებარე გელათის მონასტერიც იუნესკოს მსოფლიო მემკვიდრეობის ძეგლია.',
          ru: 'Три храма Мцхеты, Джвари, Светицховели и Самтавро, входят в список Всемирного наследия ЮНЕСКО, а сама Мцхета примерно в 20 минутах езды от Тбилиси. Монастырь Гелати под Кутаиси также памятник Всемирного наследия ЮНЕСКО.',
          tr: 'Mtsheta\'nın üç kilisesi, Cvari, Svetitskhoveli ve Samtavro, UNESCO Dünya Mirası Listesi\'ndedir ve Mtsheta Tiflis\'e arabayla yaklaşık 20 dakikadır. Kutaisi yakınındaki Gelati Manastırı da UNESCO Dünya Mirası anıtıdır.',
          ar: 'ثلاث من كنائس متسخيتا، جفاري وسفيتيتسخوفيلي وسامتافرو، مدرجة في قائمة اليونسكو للتراث العالمي، وتبعد متسخيتا نحو 20 دقيقة بالسيارة عن تبليسي. ودير غيلاتي قرب كوتايسي معلم من معالم التراث العالمي لليونسكو أيضًا.',
          he: 'שלוש כנסיות במצחטה, ג׳ווארי, סווטיצחובלי וסמטברו, נמצאות ברשימת המורשת העולמית של אונסק״ו, ומצחטה נמצאת בערך 20 דקות נסיעה מטביליסי. גם מנזר גלאטי ליד קוטאיסי הוא אתר מורשת עולמית של אונסק״ו.',
        },
      },
      {
        key: 'kazbegi-popular',
        factClass: 'GENERAL',
        register: 'PRACTICAL_CONTEXT',
        availability: 'ESTABLISHED',
        sources: ['gntaKazbegi', 'gntaSvaneti', 'gntaKakheti', 'gntaSighnaghi', 'gntaBorjomi'],
        value: null,
        statement: {
          en: 'After Tbilisi and Batumi, Kazbegi is one of Georgia\'s most popular destinations, with the 14th century Gergeti Trinity Church below Mount Kazbek (5054 m). Kakheti is Georgia\'s main wine region, Mestia is the centre of Zemo Svaneti, and Borjomi is known for its mineral water.',
          ka: 'თბილისისა და ბათუმის შემდეგ ყაზბეგი საქართველოს ერთ-ერთი ყველაზე პოპულარული მიმართულებაა, XIV საუკუნის გერგეტის სამებით მყინვარწვერის (5054 მ) ძირას. კახეთი საქართველოს მთავარი ღვინის მხარეა, მესტია ზემო სვანეთის ცენტრია, ბორჯომი კი მინერალური წყლით არის ცნობილი.',
          ru: 'После Тбилиси и Батуми Казбеги одно из самых популярных направлений Грузии, с церковью Гергети Самеба XIV века у подножия Казбека (5054 м). Кахетия главный винный регион Грузии, Местиа центр Верхней Сванетии, а Боржоми известен минеральной водой.',
          tr: 'Tiflis ve Batum\'dan sonra Kazbegi, Kazbek Dağı\'nın (5054 m) eteğindeki 14. yüzyıl Gergeti Sameba Kilisesi ile Gürcistan\'ın en popüler yerlerinden biridir. Kaheti Gürcistan\'ın ana şarap bölgesi, Mestia Yukarı Svaneti\'nin merkezidir, Borjomi ise maden suyuyla bilinir.',
          ar: 'بعد تبليسي وباتومي تُعد كازبيغي من أشهر الوجهات في جورجيا، وفيها كنيسة الثالوث في غيرغيتي من القرن الرابع عشر تحت جبل كازبيك (5054 م). وكاخيتي منطقة النبيذ الرئيسية في جورجيا، وميستيا مركز سفانيتي العليا، وبورجومي معروفة بمياهها المعدنية.',
          he: 'אחרי טביליסי ובטומי, קזבגי הוא אחד היעדים הפופולריים ביותר בגאורגיה, עם כנסיית השילוש של גרגטי מהמאה ה־14 מתחת להר קזבק (5054 מ׳). קאחתי הוא אזור היין המרכזי של גאורגיה, מסטיה היא מרכז סוואנטי העליונה, ובורג׳ומי ידועה במים המינרליים שלה.',
        },
      },
    ],
  },

  {
    slug: 'everyday-tips',
    domain: 'DAILY_LIFE',
    pathway: 'LIVE',
    factClass: 'GENERAL',
    register: 'PRACTICAL_CONTEXT',
    sortOrder: 120,
    content: {
      en: {
        title: 'Everyday tips',
        summary:
          'The small things that make the first weeks easier: money, tipping, water, finding your way and a few words of Georgian.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'The short answer',
            body: 'The money is the Georgian lari (GEL), and smaller coins are tetri. Cards work in most shops and cafes in the cities, but keep some cash for markets, minibuses and villages. Tipping is welcome but not required. Learn to say hello and thank you in Georgian, and people will smile.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Money',
            body: 'Prices are in lari. Paying by card, including tapping your phone, is normal in city shops, supermarkets and most cafes. Small shops, markets, minibuses and village guesthouses often want cash. Cash machines and exchange offices are easy to find in cities.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Tipping',
            body: 'Tipping is a custom, not a rule. For good service in a restaurant, 10% to 15% is a common guide, but it is up to you. Look at the bill first, because some places already add a service charge. With some bank cards you can add the tip on the card machine.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Tap water',
            body: 'In Tbilisi and Batumi the water companies say tap water meets drinking standards. Old buildings can have old pipes, so a filter or bottled water is the safer choice there. In villages and the mountains spring water is not always tested, so boil it first. If you have a sensitive stomach or small children, start with bottled water.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Finding your way',
            body: 'Street names are written in Georgian script and spelled in many ways in Latin letters, so a map pin is easier than an address. Share your location when you order a taxi or a delivery. Ask a neighbour or your landlord which apps people use locally.',
          },
          {
            kind: 'NOTES',
            heading: 'A few words of Georgian',
            body: 'Georgian has its own alphabet, and a few words go a long way. Gamarjoba is hello. Madloba is thank you. Ki is yes, ara is no. Nakhvamdis is goodbye. In the cities many younger people speak English, and many older people speak Russian.',
          },
        ],
      },
      ka: {
        title: 'ყოველდღიური რჩევები',
        summary:
          'წვრილმანები, რომლებიც პირველ კვირებს ამარტივებს: ფული, გასამრჯელო, წყალი, გზის პოვნა და რამდენიმე ქართული სიტყვა.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'მოკლე პასუხი',
            body: 'ფული ქართული ლარია (GEL), წვრილი მონეტები კი თეთრია. ქალაქებში მაღაზიებისა და კაფეების უმეტესობაში ბარათი მუშაობს, მაგრამ ბაზრისთვის, მარშრუტკისა და სოფლებისთვის ცოტა ნაღდი ფული იქონიეთ. გასამრჯელოს დატოვება მისასალმებელია, მაგრამ სავალდებულო არ არის. ისწავლეთ ქართულად გამარჯობა და მადლობა, და ხალხი გაგიღიმებთ.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'ფული',
            body: 'ფასები ლარშია. ბარათით გადახდა, ტელეფონის მიდებითაც, ჩვეულებრივია ქალაქის მაღაზიებში, სუპერმარკეტებში და კაფეების უმეტესობაში. პატარა მაღაზიები, ბაზრები, მარშრუტკები და სოფლის საოჯახო სასტუმროები ხშირად ნაღდს ითხოვენ. ქალაქებში ბანკომატი და ვალუტის გადამცვლელი ადვილად მოიძებნება.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'გასამრჯელო',
            body: 'გასამრჯელო ჩვეულებაა და არა წესი. რესტორანში კარგი მომსახურებისთვის 10%-დან 15%-მდე ჩვეულებრივი ორიენტირია, მაგრამ ეს თქვენი გადასაწყვეტია. ჯერ ანგარიში ნახეთ, რადგან ზოგან მომსახურების საფასური უკვე დამატებულია. ზოგი საბანკო ბარათით გასამრჯელოს დამატება ტერმინალზეც შეიძლება.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'ონკანის წყალი',
            body: 'თბილისსა და ბათუმში წყალმომარაგების კომპანიები ამბობენ, რომ ონკანის წყალი სასმელი წყლის სტანდარტებს აკმაყოფილებს. ძველ შენობებში მილები შეიძლება ძველი იყოს, ამიტომ იქ ფილტრი ან ბოთლის წყალი უფრო უსაფრთხოა. სოფლებსა და მთაში წყაროს წყალი ყოველთვის არ მოწმდება, ამიტომ ჯერ აადუღეთ. თუ მგრძნობიარე კუჭი გაქვთ ან პატარა ბავშვები გყავთ, ბოთლის წყლით დაიწყეთ.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'როგორ იპოვოთ გზა',
            body: 'ქუჩების სახელები ქართული ასოებითაა დაწერილი და ლათინურად ბევრნაირად იწერება, ამიტომ რუკაზე წერტილი მისამართზე მარტივია. ტაქსის ან მიტანის შეკვეთისას გაუზიარეთ თქვენი ადგილმდებარეობა. ჰკითხეთ მეზობელს ან მესაკუთრეს, რომელ აპლიკაციებს იყენებენ აქ.',
          },
          {
            kind: 'NOTES',
            heading: 'რამდენიმე ქართული სიტყვა',
            body: 'ქართულს თავისი ანბანი აქვს და უცხოელისთვის რამდენიმე სიტყვაც ბევრს ნიშნავს: გამარჯობა, მადლობა, კი, არა, ნახვამდის. ქალაქებში ბევრი ახალგაზრდა ინგლისურად ლაპარაკობს, უფროსი თაობიდან კი ბევრი რუსულად.',
          },
        ],
      },
      ru: {
        title: 'Полезные мелочи на каждый день',
        summary:
          'Мелочи, которые облегчают первые недели: деньги, чаевые, вода, как ориентироваться и несколько грузинских слов.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'Коротко',
            body: 'Валюта это грузинский лари (GEL), мелкие монеты называются тетри. В городах карта работает в большинстве магазинов и кафе, но держите немного наличных для рынков, маршруток и сёл. Чаевые приветствуются, но не обязательны. Выучите, как по-грузински сказать «здравствуйте» и «спасибо», и люди будут улыбаться.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Деньги',
            body: 'Цены указаны в лари. Платить картой, в том числе телефоном, обычное дело в городских магазинах, супермаркетах и большинстве кафе. Маленькие магазины, рынки, маршрутки и гостевые дома в сёлах часто хотят наличные. Банкоматы и обменники в городах легко найти.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Чаевые',
            body: 'Чаевые это обычай, а не правило. За хорошее обслуживание в ресторане обычно ориентируются на 10% до 15%, но решать вам. Сначала посмотрите счёт: в некоторых местах плата за обслуживание уже добавлена. С некоторыми банковскими картами чаевые можно добавить прямо на терминале.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Вода из крана',
            body: 'В Тбилиси и Батуми водоканалы говорят, что вода из крана соответствует стандартам питьевой воды. В старых домах трубы могут быть старыми, поэтому там надёжнее фильтр или бутилированная вода. В сёлах и горах родниковую воду не всегда проверяют, так что сначала прокипятите. Если у вас чувствительный желудок или маленькие дети, начните с бутилированной воды.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Как ориентироваться',
            body: 'Названия улиц написаны грузинскими буквами и по-разному передаются латиницей, поэтому точка на карте проще адреса. Когда заказываете такси или доставку, делитесь геолокацией. Спросите соседа или хозяина квартиры, какими приложениями здесь пользуются.',
          },
          {
            kind: 'NOTES',
            heading: 'Несколько грузинских слов',
            body: 'У грузинского свой алфавит, и даже пара слов очень помогает. Гамарджоба значит здравствуйте. Мадлоба значит спасибо. Ки это да, ара это нет. Нахвамдис значит до свидания. В городах многие молодые говорят по-английски, а многие люди постарше по-русски.',
          },
        ],
      },
      tr: {
        title: 'Günlük ipuçları',
        summary:
          'İlk haftaları kolaylaştıran küçük şeyler: para, bahşiş, su, yol bulmak ve birkaç Gürcüce kelime.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'Kısaca',
            body: 'Para birimi Gürcü larisi (GEL), küçük bozukluklar tetri. Şehirlerde çoğu mağaza ve kafede kart geçer, ama pazarlar, minibüsler ve köyler için biraz nakit bulundurun. Bahşiş hoş karşılanır ama zorunlu değildir. Gürcüce merhaba ve teşekkür ederim demeyi öğrenin, insanlar gülümser.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Para',
            body: 'Fiyatlar lari cinsindendir. Kartla ödemek, telefonla temassız ödeme dahil, şehirdeki mağazalarda, süpermarketlerde ve çoğu kafede olağandır. Küçük dükkânlar, pazarlar, minibüsler ve köy pansiyonları çoğu zaman nakit ister. Şehirlerde ATM ve döviz bürosu bulmak kolaydır.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Bahşiş',
            body: 'Bahşiş bir gelenektir, kural değildir. Restoranda iyi hizmet için %10 ila %15 yaygın bir ölçüdür, ama karar sizin. Önce hesaba bakın, bazı yerler servis ücretini zaten ekler. Bazı banka kartlarıyla bahşişi kart makinesinde ekleyebilirsiniz.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Musluk suyu',
            body: 'Tiflis ve Batum\'da su şirketleri musluk suyunun içme suyu standartlarını karşıladığını söylüyor. Eski binalarda borular eski olabilir, oralarda filtre ya da şişe suyu daha güvenlidir. Köylerde ve dağlarda kaynak suyu her zaman test edilmez, önce kaynatın. Hassas bir mideniz ya da küçük çocuklarınız varsa şişe suyuyla başlayın.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'Yol bulmak',
            body: 'Sokak adları Gürcü alfabesiyle yazılır ve Latin harfleriyle pek çok şekilde yazılır, bu yüzden haritada bir konum işareti adresten kolaydır. Taksi ya da sipariş verirken konumunuzu paylaşın. Komşunuza ya da ev sahibinize burada hangi uygulamaların kullanıldığını sorun.',
          },
          {
            kind: 'NOTES',
            heading: 'Birkaç Gürcüce kelime',
            body: 'Gürcücenin kendi alfabesi var ve birkaç kelime bile çok işe yarar. Gamarjoba merhaba demek. Madloba teşekkürler. Ki evet, ara hayır. Nakhvamdis hoşça kal. Şehirlerde birçok genç İngilizce, birçok yaşlı ise Rusça konuşur.',
          },
        ],
      },
      ar: {
        title: 'نصائح للحياة اليومية',
        summary:
          'أشياء صغيرة تسهّل الأسابيع الأولى: المال والبقشيش والماء ومعرفة الطريق وبضع كلمات جورجية.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'باختصار',
            body: 'العملة هي اللاري الجورجي (GEL)، والقطع النقدية الصغيرة اسمها تيتري. البطاقة تعمل في معظم المحلات والمقاهي في المدن، لكن احتفظ ببعض النقود للأسواق والميني باص والقرى. البقشيش مُرحَّب به لكنه غير واجب. وتعلّم أن تقول مرحبًا وشكرًا بالجورجية، وسترى الابتسامات.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'المال',
            body: 'الأسعار باللاري. الدفع بالبطاقة، ومنه الدفع بالهاتف، أمر عادي في محلات المدن والسوبرماركت ومعظم المقاهي. أما المحلات الصغيرة والأسواق والميني باص وبيوت الضيافة في القرى فكثيرًا ما تطلب النقد. وأجهزة الصراف ومكاتب الصرافة سهلة الإيجاد في المدن.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'البقشيش',
            body: 'البقشيش عادة وليس قاعدة. للخدمة الجيدة في المطعم يُعد 10% إلى 15% دليلًا شائعًا، لكن القرار لك. انظر إلى الفاتورة أولًا، فبعض الأماكن تضيف رسم الخدمة مسبقًا. ومع بعض البطاقات البنكية يمكنك إضافة البقشيش على جهاز الدفع.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'ماء الحنفية',
            body: 'في تبليسي وباتومي تقول شركات المياه إن ماء الحنفية مطابق لمعايير مياه الشرب. لكن المباني القديمة قد تكون أنابيبها قديمة، فالفلتر أو الماء المعبأ أكثر أمانًا هناك. وفي القرى والجبال لا تُفحص مياه الينابيع دائمًا، فاغلِها أولًا. وإن كانت معدتك حساسة أو معك أطفال صغار فابدأ بالماء المعبأ.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'كيف تجد طريقك',
            body: 'أسماء الشوارع مكتوبة بالحروف الجورجية وتُكتب بالحروف اللاتينية بطرق كثيرة، لذلك تحديد الموقع على الخريطة أسهل من العنوان. شارك موقعك عند طلب سيارة أجرة أو توصيل. واسأل جارك أو المالك عن التطبيقات التي يستخدمها الناس هنا.',
          },
          {
            kind: 'NOTES',
            heading: 'بضع كلمات جورجية',
            body: 'للجورجية أبجدية خاصة بها، وبضع كلمات تفتح لك قلوبًا كثيرة. غامارجوبا تعني مرحبًا. مادلوبا تعني شكرًا. كي تعني نعم، وآرا تعني لا. ناخفامديس تعني إلى اللقاء. في المدن يتكلم كثير من الشباب الإنجليزية، وكثير من الأكبر سنًا الروسية.',
          },
        ],
      },
      he: {
        title: 'טיפים ליומיום',
        summary:
          'הדברים הקטנים שמקלים על השבועות הראשונים: כסף, טיפ, מים, איך מתמצאים וכמה מילים בגאורגית.',
        sections: [
          {
            kind: 'SHORT_ANSWER',
            heading: 'בקצרה',
            body: 'המטבע הוא הלארי הגאורגי (GEL), והמטבעות הקטנים נקראים טטרי. בערים כרטיס אשראי עובד ברוב החנויות ובתי הקפה, אבל כדאי להחזיק קצת מזומן לשווקים, למיניבוסים ולכפרים. טיפ מתקבל בברכה אבל הוא לא חובה. למדו להגיד שלום ותודה בגאורגית, ואנשים יחייכו.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'כסף',
            body: 'המחירים בלארי. תשלום בכרטיס, כולל בהצמדת הטלפון, הוא דבר רגיל בחנויות בעיר, בסופרמרקטים וברוב בתי הקפה. חנויות קטנות, שווקים, מיניבוסים ובתי הארחה בכפרים רוצים הרבה פעמים מזומן. כספומטים ומשרדי המרה קל למצוא בערים.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'טיפ',
            body: 'טיפ הוא מנהג, לא חוק. על שירות טוב במסעדה, 10% עד 15% זו הנחיה מקובלת, אבל ההחלטה שלכם. הסתכלו קודם על החשבון, כי יש מקומות שכבר מוסיפים דמי שירות. עם חלק מכרטיסי הבנק אפשר להוסיף את הטיפ במסוף התשלום.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'מי ברז',
            body: 'בטביליסי ובבטומי חברות המים אומרות שמי הברז עומדים בתקני מי שתייה. בבניינים ישנים הצנרת יכולה להיות ישנה, אז שם עדיף פילטר או מים בבקבוק. בכפרים ובהרים מי המעיינות לא תמיד נבדקים, אז הרתיחו קודם. אם יש לכם קיבה רגישה או ילדים קטנים, התחילו עם מים בבקבוק.',
          },
          {
            kind: 'PRACTICAL',
            heading: 'איך מתמצאים',
            body: 'שמות הרחובות כתובים באותיות גאורגיות ונכתבים באותיות לטיניות בהרבה צורות, אז נעץ במפה פשוט יותר מכתובת. כשמזמינים מונית או משלוח, שתפו מיקום. שאלו שכן או את בעל הדירה באילו אפליקציות משתמשים כאן.',
          },
          {
            kind: 'NOTES',
            heading: 'כמה מילים בגאורגית',
            body: 'לגאורגית יש אלפבית משלה, וכמה מילים עושות הרבה. גמרג׳ובה זה שלום. מדלובה זה תודה. קי זה כן, ארה זה לא. נחוומדיס זה להתראות. בערים הרבה צעירים מדברים אנגלית, והרבה מבוגרים מדברים רוסית.',
          },
        ],
      },
    },
    facts: [
      {
        key: 'currency-lari',
        factClass: 'GENERAL',
        register: 'OFFICIAL_REQUIREMENT',
        availability: 'ESTABLISHED',
        sources: ['nbgLari'],
        value: { currency: 'GEL' },
        statement: {
          en: 'The lari (GEL) is the basic monetary unit of Georgia\'s national currency, issued by the National Bank of Georgia. Smaller coins are in tetri.',
          ka: 'ლარი (GEL) საქართველოს ეროვნული ვალუტის ძირითადი ერთეულია, რომელსაც საქართველოს ეროვნული ბანკი უშვებს. წვრილი მონეტები თეთრშია.',
          ru: 'Лари (GEL) это основная денежная единица национальной валюты Грузии, её выпускает Национальный банк Грузии. Мелкие монеты в тетри.',
          tr: 'Lari (GEL), Gürcistan Ulusal Bankası\'nın çıkardığı Gürcistan ulusal para biriminin temel birimidir. Küçük madeni paralar tetri cinsindendir.',
          ar: 'اللاري (GEL) هو الوحدة النقدية الأساسية للعملة الوطنية في جورجيا، ويصدرها البنك الوطني الجورجي. والقطع الصغيرة بالتيتري.',
          he: 'הלארי (GEL) הוא יחידת המטבע הבסיסית של המטבע הלאומי של גאורגיה, ומנפיק אותו הבנק הלאומי של גאורגיה. המטבעות הקטנים הם בטטרי.',
        },
      },
      {
        key: 'tipping-custom',
        factClass: 'GENERAL',
        register: 'COMMUNITY_EXPERIENCE',
        availability: 'ESTABLISHED',
        sources: ['gntaTipping'],
        value: { tipPctLow: 10, tipPctHigh: 15 },
        statement: {
          en: 'Tipping is a custom, not a rule. Georgia\'s national tourism site gives 10% to 15% of the bill as a good guide, and says it depends on you.',
          ka: 'გასამრჯელო ჩვეულებაა და არა წესი. საქართველოს ეროვნული ტურისტული საიტი კარგ ორიენტირად ანგარიშის 10%-დან 15%-მდე ასახელებს და ამბობს, რომ ეს თქვენზეა დამოკიდებული.',
          ru: 'Чаевые это обычай, а не правило. Национальный туристический сайт Грузии называет хорошим ориентиром 10% до 15% от счёта и пишет, что решать вам.',
          tr: 'Bahşiş bir gelenektir, kural değildir. Gürcistan\'ın ulusal turizm sitesi hesabın %10 ila %15\'ini iyi bir ölçü olarak verir ve bunun size bağlı olduğunu söyler.',
          ar: 'البقشيش عادة وليس قاعدة. ويذكر موقع السياحة الوطني في جورجيا أن 10% إلى 15% من الفاتورة دليل جيد، وأن الأمر يعود إليك.',
          he: 'טיפ הוא מנהג, לא חוק. אתר התיירות הלאומי של גאורגיה מציין 10% עד 15% מהחשבון כהנחיה טובה, ואומר שזה תלוי בכם.',
        },
      },
      {
        key: 'tap-water',
        factClass: 'GENERAL',
        register: 'PRACTICAL_CONTEXT',
        availability: 'ESTABLISHED',
        sources: ['madlobaTapWater'],
        value: null,
        statement: {
          en: 'In Tbilisi and Batumi the water utilities say tap water meets drinking standards. In older buildings a filter or bottled water is safer, and spring water in villages and mountains is not always tested.',
          ka: 'თბილისსა და ბათუმში წყალმომარაგების კომპანიები ამბობენ, რომ ონკანის წყალი სასმელი წყლის სტანდარტებს აკმაყოფილებს. ძველ შენობებში ფილტრი ან ბოთლის წყალი უფრო უსაფრთხოა, სოფლებსა და მთაში კი წყაროს წყალი ყოველთვის არ მოწმდება.',
          ru: 'В Тбилиси и Батуми водоканалы говорят, что вода из крана соответствует стандартам питьевой воды. В старых домах надёжнее фильтр или бутилированная вода, а родниковую воду в сёлах и горах проверяют не всегда.',
          tr: 'Tiflis ve Batum\'da su şirketleri musluk suyunun içme suyu standartlarını karşıladığını söylüyor. Eski binalarda filtre ya da şişe suyu daha güvenlidir, köylerde ve dağlarda kaynak suyu her zaman test edilmez.',
          ar: 'في تبليسي وباتومي تقول شركات المياه إن ماء الحنفية مطابق لمعايير مياه الشرب. وفي المباني القديمة الفلتر أو الماء المعبأ أكثر أمانًا، ومياه الينابيع في القرى والجبال لا تُفحص دائمًا.',
          he: 'בטביליסי ובבטומי חברות המים אומרות שמי הברז עומדים בתקני מי שתייה. בבניינים ישנים פילטר או מים בבקבוק בטוחים יותר, ומי מעיינות בכפרים ובהרים לא תמיד נבדקים.',
        },
      },
    ],
  },
];
