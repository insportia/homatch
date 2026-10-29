/* HOMI chat UX round (back control, service cards, service notes) — [en, ka, ru, tr, ar, he].
 * Georgian first: everyday language, informal "შენ", no dashes as punctuation.
 * Service notes (homi_pitch_*) are HOMATCH's reviewed claims, shown only when
 * HOMI picks that service (src/lib/homi/pitch.ts); keep them strictly true. */
export const UX_HOMICHAT_STRINGS = {
  homi_back: ['Back', 'უკან', 'Назад', 'Geri', 'رجوع', 'חזרה'],
  homi_back_aria: ['Back to where you were', 'დაბრუნება იქ, სადაც იყავი', 'Вернуться туда, где ты был', 'Kaldığın yere dön', 'العودة إلى حيث كنت', 'חזרה למקום שבו היית'],

  homi_svc_verify_desc: ['Owner, mortgages, restrictions and price in one report', 'მესაკუთრე, იპოთეკა, შეზღუდვები და ფასი ერთ ანგარიშში', 'Собственник, ипотеки, ограничения и цена в одном отчёте', 'Sahip, ipotek, kısıtlamalar ve fiyat tek raporda', 'المالك والرهون والقيود والسعر في تقرير واحد', 'בעלים, משכנתאות, הגבלות ומחיר בדוח אחד'],
  homi_svc_find_property_desc: ['Describe what you want and HOMATCH searches for you', 'აღწერე, რას ეძებ, და HOMATCH შენ მაგივრად მოძებნის', 'Опиши, что ищешь, и HOMATCH найдёт за тебя', 'Ne aradığını anlat, HOMATCH senin yerine arasın', 'صف ما تبحث عنه وسيبحث HOMATCH عنك', 'תאר מה אתה מחפש ו־HOMATCH יחפש בשבילך'],
  homi_svc_find_buyers_tenants_desc: ['Add your property and HOMATCH finds people looking for one like it', 'დაამატე ქონება და HOMATCH მოძებნის მათ, ვინც ასეთს ეძებს', 'Добавь объект, и HOMATCH найдёт тех, кто ищет похожий', 'Mülkünü ekle, HOMATCH benzerini arayanları bulsun', 'أضف عقارك وسيجد HOMATCH من يبحث عن مثله', 'הוסף את הנכס ו־HOMATCH ימצא מי שמחפש נכס כזה'],
  homi_svc_contract_intelligence_desc: ['Upload a contract and see what it really says', 'ატვირთე ხელშეკრულება და გაიგე, რას ამბობს სინამდვილეში', 'Загрузи договор и узнай, что в нём на самом деле', 'Sözleşmeyi yükle, gerçekte ne dediğini gör', 'ارفع العقد واعرف ما يقوله فعلًا', 'העלה חוזה וראה מה הוא אומר באמת'],
  homi_svc_mortgage_desc: ['Your real monthly payment and the full cost', 'რეალური ყოველთვიური შენატანი და სრული ღირებულება', 'Реальный ежемесячный платёж и полная стоимость', 'Gerçek aylık taksit ve toplam maliyet', 'القسط الشهري الحقيقي والتكلفة الكاملة', 'ההחזר החודשי האמיתי והעלות המלאה'],
  homi_svc_investment_desc: ['Income, return and risk worked out with your numbers', 'შემოსავალი, უკუგება და რისკი შენი ციფრებით', 'Доход, доходность и риски по твоим цифрам', 'Gelir, getiri ve risk senin rakamlarınla', 'الدخل والعائد والمخاطر بأرقامك أنت', 'הכנסה, תשואה וסיכון לפי המספרים שלך'],
  homi_svc_for_expats_desc: ['A personal step by step plan for moving to Georgia', 'პირადი გეგმა საქართველოში გადმოსასვლელად, ნაბიჯ-ნაბიჯ', 'Личный пошаговый план переезда в Грузию', 'Gürcistan’a taşınmak için adım adım kişisel plan', 'خطة شخصية خطوة بخطوة للانتقال إلى جورجيا', 'תוכנית אישית צעד אחר צעד למעבר לגאורגיה'],
  homi_svc_brokers_desc: ['Find a professional by market and language', 'იპოვე პროფესიონალი ბაზრისა და ენის მიხედვით', 'Найди специалиста по рынку и языку', 'Pazara ve dile göre bir uzman bul', 'اعثر على محترف حسب السوق واللغة', 'מצא איש מקצוע לפי שוק ושפה'],
  homi_svc_meta_ads_desc: ['Ads on Facebook and Instagram, HOMATCH builds the campaign', 'რეკლამა Facebook-სა და Instagram-ზე, კამპანიას HOMATCH აწყობს', 'Реклама в Facebook и Instagram, кампанию собирает HOMATCH', 'Facebook ve Instagram reklamı, kampanyayı HOMATCH kurar', 'إعلانات على فيسبوك وإنستغرام، وHOMATCH يبني الحملة', 'מודעות בפייסבוק ובאינסטגרם, HOMATCH בונה את הקמפיין'],
  homi_svc_contact_desc: ['The official way to reach the HOMATCH team', 'HOMATCH-ის გუნდთან დაკავშირების ოფიციალური გზა', 'Официальный способ связаться с командой HOMATCH', 'HOMATCH ekibine ulaşmanın resmi yolu', 'الطريقة الرسمية للتواصل مع فريق HOMATCH', 'הדרך הרשמית לפנות לצוות HOMATCH'],

  homi_pitch_eyebrow: ['From HOMATCH', 'HOMATCH-ისგან', 'От HOMATCH', 'HOMATCH’ten', 'من HOMATCH', 'מ־HOMATCH'],
  homi_pitch_cta: ['See how it works', 'ნახე, როგორ მუშაობს', 'Посмотреть, как это работает', 'Nasıl çalıştığını gör', 'شاهد كيف يعمل', 'לראות איך זה עובד'],

  /* One confident, concrete note per service (owner, 2026-10-25): what is genuinely
     unique about each, from what the product really does. */
  homi_pitch_verify_title: ['Verify: the first of its kind in Georgia', 'Verify: საქართველოში პირველი', 'Verify: первый такой сервис в Грузии', 'Verify: Gürcistan’da bir ilk', 'Verify: الأول من نوعه في جورجيا', 'Verify: הראשון מסוגו בגאורגיה'],
  homi_pitch_verify_body: [
    'Verify is the first service of its kind in Georgia, and you will only find it on HOMATCH. One report brings the official registry and public sources together: who owns the property, whether there is a mortgage or a restriction, whether the developer is real and whether the price makes sense.',
    'Verify საქართველოში პირველია და მხოლოდ HOMATCH-ზე იპოვი. ერთ ანგარიშში ოფიციალური რეესტრი და საჯარო წყაროები ერთად გხვდება: ვინ არის მესაკუთრე, ადევს თუ არა იპოთეკა ან შეზღუდვა, ნამდვილია თუ არა დეველოპერი და რამდენად სწორია ფასი.',
    'Verify первый такой сервис в Грузии, и он есть только на HOMATCH. В одном отчёте официальный реестр и открытые источники: кто собственник, есть ли ипотека или ограничение, реален ли застройщик и адекватна ли цена.',
    'Verify Gürcistan’da bir ilk ve yalnızca HOMATCH’te var. Tek raporda resmi sicil ve açık kaynaklar bir arada: sahibi kim, ipotek ya da kısıtlama var mı, müteahhit gerçek mi, fiyat makul mü.',
    'Verify هو الأول من نوعه في جورجيا، ولا تجده إلا على HOMATCH. تقرير واحد يجمع السجل الرسمي والمصادر العامة: من المالك، وهل يوجد رهن أو قيد، وهل المطوّر حقيقي، وهل السعر معقول.',
    'Verify הוא הראשון מסוגו בגאורגיה, וקיים רק ב־HOMATCH. דוח אחד מאחד את המרשם הרשמי ומקורות ציבוריים: מי הבעלים, האם יש משכנתא או הגבלה, האם היזם אמיתי והאם המחיר הגיוני.',
  ],
  homi_pitch_find_property_title: ['Say it once, HOMATCH does the searching', 'ერთხელ თქვი, ძებნას HOMATCH აკეთებს', 'Скажи один раз, искать будет HOMATCH', 'Bir kez söyle, aramayı HOMATCH yapsın', 'قلها مرة واحدة وHOMATCH يبحث', 'אומרים פעם אחת, HOMATCH מחפש'],
  homi_pitch_find_property_body: [
    'No filters to fight with. Write what you want in your own words: area, budget, rooms. HOMATCH turns it into a search plan you can edit, looks through several property sites at once and brings the results together in one place.',
    'ფილტრებთან ჭიდილი აღარ გჭირდება. შენი სიტყვებით დაწერე, რა გინდა: უბანი, ბიუჯეტი, ოთახები. HOMATCH ამას ძებნის გეგმად აქცევს, რომლის შეცვლაც შეგიძლია, ერთდროულად რამდენიმე საიტზე ეძებს და შედეგებს ერთ ადგილას გიკრებს.',
    'Никакой возни с фильтрами. Напиши своими словами, что нужно: район, бюджет, комнаты. HOMATCH превратит это в план поиска, который можно править, сразу ищет на нескольких сайтах и собирает результаты в одном месте.',
    'Filtrelerle uğraşmak yok. Ne istediğini kendi sözlerinle yaz: semt, bütçe, oda sayısı. HOMATCH bunu düzenleyebileceğin bir arama planına çevirir, aynı anda birkaç sitede arar ve sonuçları tek yerde toplar.',
    'لا حاجة لمعاناة الفلاتر. اكتب بكلماتك ما تريده: الحي والميزانية وعدد الغرف. يحوّل HOMATCH ذلك إلى خطة بحث يمكنك تعديلها، ويبحث في عدة مواقع عقارية معًا، ويجمع النتائج في مكان واحد.',
    'בלי להיאבק בפילטרים. כתוב במילים שלך מה אתה רוצה: אזור, תקציב, חדרים. HOMATCH הופך את זה לתוכנית חיפוש שאפשר לערוך, מחפש בכמה אתרי נדל״ן בבת אחת ומרכז את התוצאות במקום אחד.',
  ],
  homi_pitch_find_buyers_tenants_title: ['People who are already looking, found for you', 'მათ, ვინც უკვე ეძებს, HOMATCH გიპოვის', 'Те, кто уже ищет, найдены для тебя', 'Zaten arayanları HOMATCH senin için bulur', 'من يبحثون فعلًا، يجدهم لك HOMATCH', 'מי שכבר מחפש, HOMATCH מוצא בשבילך'],
  homi_pitch_find_buyers_tenants_body: [
    'Instead of waiting for calls, HOMATCH looks for people who have said they want a place like yours and shows each match with the reasons it fits: area, budget, size. They are potentially interested people, and you decide who to contact.',
    'ზარების ლოდინის ნაცვლად HOMATCH ეძებს ადამიანებს, ვისაც უკვე უთქვამს, რომ შენნაირი ქონება სჭირდება, და თითოეულ დამთხვევას მიზეზებით გაჩვენებს: უბანი, ბიუჯეტი, ფართი. ესენი პოტენციურად დაინტერესებული ადამიანები არიან და ვის დაუკავშირდე, შენ წყვეტ.',
    'Вместо ожидания звонков HOMATCH ищет людей, которые уже сказали, что им нужно жильё как у тебя, и показывает каждое совпадение с причинами: район, бюджет, площадь. Это потенциально заинтересованные люди, а с кем связаться, решаешь ты.',
    'Telefon beklemek yerine HOMATCH, seninki gibi bir yer istediğini söylemiş kişileri arar ve her eşleşmeyi nedenleriyle gösterir: semt, bütçe, büyüklük. Bunlar potansiyel olarak ilgilenen kişiler; kiminle iletişime geçeceğine sen karar verirsin.',
    'بدل انتظار الاتصالات، يبحث HOMATCH عن أشخاص قالوا إنهم يريدون مكانًا مثل مكانك، ويعرض كل تطابق مع أسبابه: الحي والميزانية والمساحة. هؤلاء أشخاص قد يهتمون، وأنت تقرر بمن تتواصل.',
    'במקום לחכות לטלפונים, HOMATCH מחפש אנשים שכבר אמרו שהם רוצים נכס כמו שלך, ומציג כל התאמה עם הסיבות: אזור, תקציב, גודל. אלה אנשים שעשויים להתעניין, ואתה מחליט למי לפנות.',
  ],
  homi_pitch_contract_intelligence_title: ['Know what you sign, in plain words', 'იცოდე, რას აწერ ხელს, მარტივი სიტყვებით', 'Знай, что подписываешь, простыми словами', 'Neyi imzaladığını sade bir dille bil', 'اعرف ما توقّع عليه بكلمات بسيطة', 'לדעת על מה חותמים, במילים פשוטות'],
  homi_pitch_contract_intelligence_body: ['Upload a purchase or rental contract and HOMATCH reads all of it for you: what it commits you to, where the risks hide, the money and the deadlines. Your first analysis is free; after that you will need a subscription plan.', 'ატვირთე ყიდვის ან ქირის ხელშეკრულება და HOMATCH ბოლომდე წაიკითხავს შენ მაგივრად: რას გავალდებულებს, სად იმალება რისკი, რა თანხებია და რა ვადები. პირველი ანალიზი უფასოა, შემდეგ კი გამოწერის გეგმა დაგჭირდება.', 'Загрузи договор покупки или аренды, и HOMATCH прочитает его целиком за тебя: обязательства, скрытые риски, суммы и сроки. Первый анализ бесплатный, дальше понадобится тариф подписки.', 'Satış ya da kira sözleşmesini yükle, HOMATCH senin yerine baştan sona okusun: yükümlülükler, gizli riskler, tutarlar ve süreler. İlk analiz ücretsiz, sonrası için bir abonelik planı gerekir.', 'ارفع عقد شراء أو إيجار وسيقرؤه HOMATCH كاملًا عنك: الالتزامات، والمخاطر المخفية، والمبالغ، والمواعيد. التحليل الأول مجاني، وبعده ستحتاج إلى خطة اشتراك.', 'העלה חוזה רכישה או שכירות ו־HOMATCH יקרא אותו כולו בשבילך: התחייבויות, סיכונים מוסתרים, סכומים ומועדים. הניתוח הראשון בחינם, ואחריו תצטרך תוכנית מנוי.'],
  homi_pitch_mortgage_title: ['The real price of a mortgage, before the bank', 'იპოთეკის ნამდვილი ფასი, ბანკამდე', 'Настоящая цена ипотеки, ещё до банка', 'Bankaya gitmeden kredinin gerçek maliyeti', 'السعر الحقيقي للرهن قبل البنك', 'המחיר האמיתי של המשכנתא, עוד לפני הבנק'],
  homi_pitch_mortgage_body: [
    'HOMATCH shows your real monthly payment and the full cost, including the fees a bank quote often leaves out, and checks your numbers against the published lending limits in Georgia. You walk into the bank already knowing the answer.',
    'HOMATCH გიჩვენებს რეალურ ყოველთვიურ შენატანს და სრულ ღირებულებას, იმ საკომისიოებითაც, რასაც ბანკის შეთავაზება ხშირად არ აჩვენებს, და შენს ციფრებს საქართველოში მოქმედ სესხის ლიმიტებთან ადარებს. ბანკში უკვე პასუხის ცოდნით მიდიხარ.',
    'HOMATCH покажет реальный ежемесячный платёж и полную стоимость, включая комиссии, которые банк часто не указывает, и сверит твои цифры с действующими в Грузии лимитами кредитования. В банк идёшь, уже зная ответ.',
    'HOMATCH gerçek aylık taksitini ve toplam maliyeti, bankanın teklifinde çoğu zaman görünmeyen ücretlerle birlikte gösterir ve rakamlarını Gürcistan’daki kredi sınırlarıyla karşılaştırır. Bankaya cevabı bilerek gidersin.',
    'يعرض HOMATCH قسطك الشهري الحقيقي والتكلفة الكاملة، بما فيها رسوم يغفلها عرض البنك غالبًا، ويقارن أرقامك بحدود الإقراض المعمول بها في جورجيا. تذهب إلى البنك وأنت تعرف الجواب.',
    'HOMATCH מראה את ההחזר החודשי האמיתי ואת העלות המלאה, כולל עמלות שהצעת הבנק לרוב לא מציגה, ובודק את המספרים שלך מול מגבלות האשראי בגאורגיה. מגיעים לבנק כשכבר יודעים את התשובה.',
  ],
  homi_pitch_investment_title: ['Invest with numbers, not guesses', 'ინვესტიცია ციფრებით, არა ვარაუდით', 'Инвестиции по цифрам, а не наугад', 'Tahminle değil rakamlarla yatırım', 'استثمر بالأرقام لا بالتخمين', 'השקעה לפי מספרים, לא לפי ניחוש'],
  homi_pitch_investment_body: [
    'Four real strategies in one place: renting out, renovate and sell, buying from a developer, and the investment value of a specific property. HOMATCH works out income, return and risk from your own figures, and the result moves as you change them.',
    'ოთხი რეალური სტრატეგია ერთ ადგილას: გაქირავება, გარემონტება და გაყიდვა, დეველოპერისგან ყიდვა და კონკრეტული ქონების საინვესტიციო ღირებულება. HOMATCH შენი ციფრებით ითვლის შემოსავალს, უკუგებას და რისკს, და შედეგი იცვლება, როგორც კი რამეს შეცვლი.',
    'Четыре реальные стратегии в одном месте: аренда, ремонт и продажа, покупка у застройщика и инвестиционная стоимость конкретного объекта. HOMATCH считает доход, доходность и риски по твоим цифрам, и результат меняется вместе с ними.',
    'Dört gerçek strateji tek yerde: kiraya verme, yenileyip satma, müteahhitten alma ve belirli bir mülkün yatırım değeri. HOMATCH geliri, getiriyi ve riski senin rakamlarınla hesaplar; sen değiştirdikçe sonuç da değişir.',
    'أربع استراتيجيات حقيقية في مكان واحد: التأجير، والترميم والبيع، والشراء من المطوّر، والقيمة الاستثمارية لعقار محدد. يحسب HOMATCH الدخل والعائد والمخاطر من أرقامك، وتتغير النتيجة كلما غيّرتها.',
    'ארבע אסטרטגיות אמיתיות במקום אחד: השכרה, שיפוץ ומכירה, קנייה מיזם, ושווי ההשקעה של נכס מסוים. HOMATCH מחשב הכנסה, תשואה וסיכון לפי הנתונים שלך, והתוצאה משתנה כשאתה משנה אותם.',
  ],
  homi_pitch_for_expats_title: ['Moving to Georgia, with HOMI beside you', 'საქართველოში გადმოსვლა, HOMI-სთან ერთად', 'Переезд в Грузию вместе с HOMI', 'Gürcistan’a taşınırken yanında HOMI', 'الانتقال إلى جورجيا وHOMI معك', 'מעבר לגאורגיה, עם HOMI לצידך'],
  homi_pitch_for_expats_body: [
    'Tell HOMI your plans once and My Georgia builds a personal plan that stays saved: where to live, documents, everyday matters. HOMI remembers your answers, so you never have to explain yourself twice.',
    'ერთხელ მოუყევი HOMI-ს შენი გეგმები და My Georgia შეგიდგენს პირად გეგმას, რომელიც შენახული რჩება: სად იცხოვრო, საბუთები, ყოველდღიური საკითხები. HOMI შენს პასუხებს იმახსოვრებს, ამიტომ ორჯერ ახსნა არ მოგიწევს.',
    'Расскажи HOMI о планах один раз, и My Georgia составит личный план, который сохранится: где жить, документы, повседневные дела. HOMI помнит твои ответы, так что объяснять дважды не придётся.',
    'Planlarını HOMI’ye bir kez anlat, My Georgia kayıtlı kalan kişisel bir plan hazırlasın: nerede yaşayacağın, belgeler, günlük işler. HOMI cevaplarını hatırlar, iki kez anlatman gerekmez.',
    'أخبر HOMI بخططك مرة واحدة، وستُعدّ لك My Georgia خطة شخصية تبقى محفوظة: أين تسكن، والمستندات، والأمور اليومية. يتذكر HOMI إجاباتك، فلا تحتاج إلى الشرح مرتين.',
    'ספר ל־HOMI על התוכניות פעם אחת, ו־My Georgia תבנה תוכנית אישית שנשמרת: איפה לגור, מסמכים, עניינים יומיומיים. HOMI זוכר את התשובות שלך, כך שלא תצטרך להסביר פעמיים.',
  ],
  homi_pitch_brokers_title: ['The right broker, in your language', 'სწორი ბროკერი, შენს ენაზე', 'Нужный брокер на твоём языке', 'Doğru emlakçı, senin dilinde', 'الوسيط المناسب بلغتك', 'המתווך הנכון, בשפה שלך'],
  homi_pitch_brokers_body: [
    'The HOMATCH broker directory lets you pick a professional by the market they work in and the languages they speak, and see their profile before you get in touch.',
    'HOMATCH-ის ბროკერების ცნობარში პროფესიონალს ირჩევ იმის მიხედვით, რომელ ბაზარზე მუშაობს და რომელ ენებზე საუბრობს, და დაკავშირებამდე მის პროფილს ნახულობ.',
    'В каталоге брокеров HOMATCH специалиста можно выбрать по рынку, на котором он работает, и языкам, на которых говорит, и посмотреть профиль до звонка.',
    'HOMATCH emlakçı rehberinde bir uzmanı çalıştığı pazara ve konuştuğu dillere göre seçer, iletişime geçmeden önce profilini görürsün.',
    'في دليل وسطاء HOMATCH تختار المحترف حسب السوق الذي يعمل فيه واللغات التي يتحدثها، وترى ملفه قبل أن تتواصل معه.',
    'במדריך המתווכים של HOMATCH בוחרים איש מקצוע לפי השוק שבו הוא עובד והשפות שהוא מדבר, ורואים את הפרופיל שלו לפני שפונים.',
  ],
  homi_pitch_meta_ads_title: ['Facebook and Instagram ads, built for you', 'Facebook-ისა და Instagram-ის რეკლამა, შენთვის აწყობილი', 'Реклама в Facebook и Instagram, собранная за тебя', 'Senin için hazırlanan Facebook ve Instagram reklamı', 'إعلانات فيسبوك وإنستغرام مبنية لك', 'מודעות פייסבוק ואינסטגרם, בנויות בשבילך'],
  homi_pitch_meta_ads_body: [
    'You choose the goal, the budget and the photos. HOMATCH builds the campaign and runs it on Facebook and Instagram, so you never have to learn the ads manager.',
    'შენ ირჩევ მიზანს, ბიუჯეტს და ფოტოებს. კამპანიას HOMATCH აწყობს და Facebook-სა და Instagram-ზე უშვებს, ასე რომ, სარეკლამო კაბინეტის სწავლა არ მოგიწევს.',
    'Ты выбираешь цель, бюджет и фото. HOMATCH собирает кампанию и запускает её в Facebook и Instagram, так что разбираться в рекламном кабинете не придётся.',
    'Hedefi, bütçeyi ve fotoğrafları sen seçersin. HOMATCH kampanyayı kurar ve Facebook ile Instagram’da yayınlar; reklam yöneticisini öğrenmen gerekmez.',
    'أنت تختار الهدف والميزانية والصور. يبني HOMATCH الحملة ويشغّلها على فيسبوك وإنستغرام، فلا تحتاج إلى تعلّم مدير الإعلانات.',
    'אתה בוחר מטרה, תקציב ותמונות. HOMATCH בונה את הקמפיין ומריץ אותו בפייסבוק ובאינסטגרם, כך שלא צריך ללמוד את מנהל המודעות.',
  ],
};
