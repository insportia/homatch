// English, Georgian, Russian, Turkish, Arabic, Hebrew.
// Legal round 3 (2026-10-25): owner correction on PR #335 — interest matching
// runs through HOMATCH messaging; a registered email may be shared; a member's
// account phone is not part of a match result. A listing's contact number is
// different: the owner gives it so buyers and tenants can call about that
// property. Georgian for terms_comm_p1–p5 is the owner's exact wording.
// Applied with --overwrite (privacy_match_p4, privacy_s4_li5_body,
// privacy_lb_consent are rewritten).
export const LEGAL_MATCHING_COMM_STRINGS = {
  terms_comm_title: ['Interest matching and communication', 'ინტერესთა დამთხვევა და კომუნიკაცია', 'Сопоставление интересов и коммуникация', 'İlgi eşleştirme ve iletişim', 'مطابقة الاهتمامات والتواصل', 'התאמת עניין ותקשורת'],
  terms_comm_p1: [
    'HOMATCH offers users a service for automatically matching property-related interests and for digital communication.',
    'HOMATCH მომხმარებლებს სთავაზობს უძრავ ქონებასთან დაკავშირებული ინტერესების ავტომატური შესაბამისობისა და ციფრული კომუნიკაციის მომსახურებას.',
    'HOMATCH предлагает пользователям услугу автоматического сопоставления интересов, связанных с недвижимостью, и цифровой коммуникации.',
    'HOMATCH, kullanıcılara gayrimenkulle ilgili ilgilerin otomatik eşleştirilmesi ve dijital iletişim hizmeti sunar.',
    'تقدّم HOMATCH للمستخدمين خدمة المطابقة الآلية للاهتمامات المتعلقة بالعقارات والتواصل الرقمي.',
    'HOMATCH מציעה למשתמשים שירות של התאמה אוטומטית של תחומי עניין הקשורים לנדל"ן ושל תקשורת דיגיטלית.',
  ],
  terms_comm_p2: [
    'Once a match is identified, users can communicate with each other through HOMATCH\'s internal messaging system.',
    'შესაბამისობის გამოვლენის შემდეგ მომხმარებლებს შეუძლიათ ერთმანეთთან კომუნიკაცია HOMATCH-ის შიდა მიმოწერის სისტემის მეშვეობით.',
    'После выявления соответствия пользователи могут общаться друг с другом через внутреннюю систему сообщений HOMATCH.',
    'Bir eşleşme belirlendikten sonra kullanıcılar, HOMATCH\'in dahili mesajlaşma sistemi aracılığıyla birbirleriyle iletişim kurabilir.',
    'بعد تحديد المطابقة، يمكن للمستخدمين التواصل فيما بينهم عبر نظام المراسلة الداخلي في HOMATCH.',
    'לאחר זיהוי התאמה, המשתמשים יכולים לתקשר זה עם זה באמצעות מערכת ההודעות הפנימית של HOMATCH.',
  ],
  terms_comm_p3: [
    'Within the service, where there is an appropriate legal basis, a user\'s registered email address may be made available to the relevant other party.',
    'მომსახურების ფარგლებში, შესაბამისი სამართლებრივი საფუძვლის არსებობისას, მომხმარებლის რეგისტრირებული ელექტრონული ფოსტის მისამართი შეიძლება ხელმისაწვდომი გახდეს შესაბამისი მეორე მხარისთვის.',
    'В рамках услуги, при наличии соответствующего правового основания, зарегистрированный адрес электронной почты пользователя может стать доступен соответствующей другой стороне.',
    'Hizmet kapsamında, uygun bir hukuki dayanak bulunması halinde, kullanıcının kayıtlı e-posta adresi ilgili karşı tarafa açılabilir.',
    'في إطار الخدمة، وعند وجود أساس قانوني مناسب، قد يُتاح عنوان البريد الإلكتروني المسجّل للمستخدم للطرف الآخر المعني.',
    'במסגרת השירות, כאשר קיים בסיס משפטי מתאים, כתובת הדוא"ל הרשומה של המשתמש עשויה להיות זמינה לצד השני הרלוונטי.',
  ],
  terms_comm_p4: [
    'A user\'s phone number is not part of the standard match result and is not passed to other users within this service.',
    'მომხმარებლის ტელეფონის ნომერი არ წარმოადგენს სტანდარტული შესაბამისობის შედეგის ნაწილს და არ გადაეცემა სხვა მომხმარებლებს აღნიშნული მომსახურების ფარგლებში.',
    'Номер телефона пользователя не входит в стандартный результат сопоставления и не передаётся другим пользователям в рамках данной услуги.',
    'Kullanıcının telefon numarası standart eşleşme sonucunun bir parçası değildir ve bu hizmet kapsamında diğer kullanıcılara aktarılmaz.',
    'لا يُعدّ رقم هاتف المستخدم جزءًا من نتيجة المطابقة القياسية، ولا يُنقل إلى مستخدمين آخرين في إطار هذه الخدمة.',
    'מספר הטלפון של המשתמש אינו חלק מתוצאת ההתאמה הסטנדרטית ואינו מועבר למשתמשים אחרים במסגרת שירות זה.',
  ],
  terms_comm_p5: [
    'HOMATCH charges a predetermined fee for the digital matching and intermediation service, not for selling a user\'s phone number.',
    'HOMATCH იღებს წინასწარ განსაზღვრულ საფასურს ციფრული შესაბამისობისა და შუამავლობის მომსახურებისთვის და არა მომხმარებლის ტელეფონის ნომრის გაყიდვისთვის.',
    'HOMATCH взимает заранее установленную плату за услугу цифрового сопоставления и посредничества, а не за продажу номера телефона пользователя.',
    'HOMATCH, kullanıcının telefon numarasının satışı için değil, dijital eşleştirme ve aracılık hizmeti için önceden belirlenmiş bir ücret alır.',
    'تتقاضى HOMATCH رسومًا محددة مسبقًا مقابل خدمة المطابقة والوساطة الرقمية، وليس مقابل بيع رقم هاتف المستخدم.',
    'HOMATCH גובה תשלום שנקבע מראש עבור שירות ההתאמה והתיווך הדיגיטלי, ולא עבור מכירת מספר הטלפון של המשתמש.',
  ],
  terms_comm_listing: [
    'A property listing is different: when you publish a property for sale or rent, the contact number you give for that listing is there so buyers or tenants can call you about it, and it may be shown to people who find the listing on HOMATCH.',
    'უძრავი ქონების განცხადება განსხვავებული შემთხვევაა: როდესაც ქონებას გასაყიდად ან გასაქირავებლად განათავსებთ, განცხადებისთვის მითითებული საკონტაქტო ნომერი განკუთვნილია იმისთვის, რომ მყიდველმა ან მოიჯარემ ამ ქონებასთან დაკავშირებით დაგირეკოთ, და ის შეიძლება ნახონ პირებმა, რომლებიც ამ განცხადებას HOMATCH-ზე იპოვიან.',
    'Объявление о недвижимости — другой случай: когда вы размещаете объект для продажи или аренды, контактный номер, указанный для этого объявления, нужен для того, чтобы покупатели или арендаторы могли позвонить вам по этому объекту, и его могут видеть те, кто найдёт объявление в HOMATCH.',
    'Bir gayrimenkul ilanı farklıdır: bir mülkü satılık veya kiralık olarak yayınladığınızda, o ilan için verdiğiniz iletişim numarası alıcıların veya kiracıların sizi bu mülk hakkında arayabilmesi içindir ve ilanı HOMATCH\'te bulan kişilere gösterilebilir.',
    'إعلان العقار حالة مختلفة: عندما تنشر عقارًا للبيع أو الإيجار، فإن رقم الاتصال الذي تحدده لذلك الإعلان مخصص لكي يتصل بك المشترون أو المستأجرون بشأنه، وقد يُعرض على من يجد الإعلان على HOMATCH.',
    'מודעת נדל"ן היא מקרה שונה: כאשר אתה מפרסם נכס למכירה או להשכרה, מספר הקשר שאתה מוסר למודעה נועד לכך שקונים או שוכרים יוכלו להתקשר אליך בנוגע לנכס, והוא עשוי להיות מוצג למי שמוצא את המודעה ב-HOMATCH.',
  ],
  privacy_match_p4: [
    'In practice: other users first see an anonymous preview of a matching request. After a match is opened, communication takes place through HOMATCH\'s internal messaging. Your registered email address is made available to the other party only if you turn on email sharing in your contact preferences (off by default). Your account phone number is kept in HOMATCH\'s internal systems and is not part of a match result.',
    'პრაქტიკაში: სხვა მომხმარებლები თავდაპირველად ხედავენ შესაბამისი მოთხოვნის ანონიმურ მიმოხილვას. დამთხვევის გახსნის შემდეგ კომუნიკაცია მიმდინარეობს HOMATCH-ის შიდა მიმოწერის სისტემით. თქვენი რეგისტრირებული ელექტრონული ფოსტის მისამართი მეორე მხარისთვის ხელმისაწვდომი ხდება მხოლოდ მაშინ, თუ საკონტაქტო პარამეტრებში ელფოსტის გაზიარებას ჩართავთ (ნაგულისხმევად გამორთულია). თქვენი ანგარიშის ტელეფონის ნომერი ინახება HOMATCH-ის შიდა სისტემებში და არ არის დამთხვევის შედეგის ნაწილი.',
    'На практике: другие пользователи сначала видят анонимный предпросмотр подходящего запроса. После открытия совпадения общение идёт через внутреннюю систему сообщений HOMATCH. Ваш зарегистрированный адрес электронной почты становится доступен другой стороне, только если вы включили обмен email в настройках контактов (по умолчанию выключено). Номер телефона вашей учётной записи хранится во внутренних системах HOMATCH и не входит в результат сопоставления.',
    'Uygulamada: diğer kullanıcılar önce eşleşen bir talebin anonim önizlemesini görür. Bir eşleşme açıldıktan sonra iletişim HOMATCH\'in dahili mesajlaşması üzerinden yürür. Kayıtlı e-posta adresiniz, yalnızca iletişim tercihlerinizde e-posta paylaşımını açtıysanız karşı tarafa açılır (varsayılan olarak kapalı). Hesabınızın telefon numarası HOMATCH\'in dahili sistemlerinde tutulur ve eşleşme sonucunun bir parçası değildir.',
    'عمليًا: يرى المستخدمون الآخرون أولًا معاينة مجهولة الهوية للطلب المطابق. وبعد فتح المطابقة، يتم التواصل عبر نظام المراسلة الداخلي في HOMATCH. ولا يُتاح عنوان بريدك الإلكتروني المسجّل للطرف الآخر إلا إذا فعّلت مشاركة البريد الإلكتروني في تفضيلات التواصل (معطّلة افتراضيًا). أما رقم هاتف حسابك فيُحفظ في الأنظمة الداخلية لـ HOMATCH وليس جزءًا من نتيجة المطابقة.',
    'בפועל: משתמשים אחרים רואים תחילה תצוגה מקדימה אנונימית של בקשה תואמת. לאחר פתיחת ההתאמה, התקשורת מתנהלת דרך מערכת ההודעות הפנימית של HOMATCH. כתובת הדוא"ל הרשומה שלך נחשפת לצד השני רק אם הפעלת שיתוף דוא"ל בהעדפות יצירת הקשר (כבוי כברירת מחדל). מספר הטלפון של החשבון שלך נשמר במערכות הפנימיות של HOMATCH ואינו חלק מתוצאת ההתאמה.',
  ],
  privacy_listing_phone: [
    'Listing contact numbers are separate from your account. When you publish a property for sale or rent, the contact number you enter for that listing is there so that buyers and tenants can call you about it, and it may be shown with the listing to people who find it on HOMATCH. Listings HOMATCH shows from other websites may include the seller contact published on the source listing.',
    'განცხადების საკონტაქტო ნომერი თქვენი ანგარიშისგან განცალკევებულია. როდესაც ქონებას გასაყიდად ან გასაქირავებლად განათავსებთ, განცხადებისთვის მითითებული ნომერი განკუთვნილია იმისთვის, რომ მყიდველებმა და მოიჯარეებმა ამ ქონებასთან დაკავშირებით დაგირეკონ, და ის შეიძლება ნაჩვენები იყოს განცხადებასთან ერთად პირებისთვის, რომლებიც მას HOMATCH-ზე იპოვიან. სხვა ვებსაიტებიდან ნაჩვენებ განცხადებებს შეიძლება ახლდეს წყარო განცხადებაში გამოქვეყნებული გამყიდველის კონტაქტი.',
    'Контактный номер объявления не связан с вашей учётной записью. Когда вы размещаете объект для продажи или аренды, номер, указанный для этого объявления, нужен для того, чтобы покупатели и арендаторы могли позвонить вам по этому объекту, и он может показываться вместе с объявлением тем, кто найдёт его в HOMATCH. Объявления с других сайтов, которые показывает HOMATCH, могут содержать контакт продавца, опубликованный в исходном объявлении.',
    'İlan iletişim numaraları hesabınızdan ayrıdır. Bir mülkü satılık veya kiralık olarak yayınladığınızda o ilan için girdiğiniz numara, alıcıların ve kiracıların sizi bu mülk hakkında arayabilmesi içindir ve ilanı HOMATCH\'te bulan kişilere ilanla birlikte gösterilebilir. HOMATCH\'in diğer web sitelerinden gösterdiği ilanlar, kaynak ilanda yayınlanan satıcı iletişim bilgisini içerebilir.',
    'رقم الاتصال الخاص بالإعلان منفصل عن حسابك. عندما تنشر عقارًا للبيع أو الإيجار، فإن الرقم الذي تُدخله لذلك الإعلان مخصص لكي يتصل بك المشترون والمستأجرون بشأنه، وقد يُعرض مع الإعلان على من يجده على HOMATCH. وقد تتضمن الإعلانات التي تعرضها HOMATCH من مواقع أخرى بيانات اتصال البائع المنشورة في الإعلان الأصلي.',
    'מספרי קשר של מודעות נפרדים מהחשבון שלך. כאשר אתה מפרסם נכס למכירה או להשכרה, המספר שאתה מזין למודעה נועד לכך שקונים ושוכרים יוכלו להתקשר אליך בנוגע לנכס, והוא עשוי להיות מוצג יחד עם המודעה למי שמוצא אותה ב-HOMATCH. מודעות מאתרים אחרים ש-HOMATCH מציגה עשויות לכלול את פרטי הקשר של המוכר שפורסמו במודעת המקור.',
  ],
  privacy_s4_li5_body: [
    'While your account accepts property offers (a setting in your contact preferences you can turn off at any time), owners and brokers whose listing fits your property search, or a listing you calculated a mortgage for, can see an anonymous preview: the area, property type, a rounded budget and, where it applies, that you are interested in a mortgage. After they open you, they see your name and can message you in HOMATCH; your registered email is shown only if you chose to share it in your contact preferences (off by default). Your account phone number is not shared. Your income, debts, credit history, guarantor, residency and mortgage calculations are never shared. Turning property offers off removes you from Matching immediately.',
    'სანამ თქვენი ანგარიში ქონების შეთავაზებებს იღებს (საკონტაქტო პარამეტრი, რომლის გამორთვაც ნებისმიერ დროს შეგიძლიათ), მესაკუთრეებსა და ბროკერებს, რომელთა განცხადებაც შეესაბამება თქვენს ძიებას, ან რომლის განცხადებისთვისაც იპოთეკა გამოთვალეთ, შეუძლიათ ნახონ ანონიმური მიმოხილვა: უბანი, ქონების ტიპი, დამრგვალებული ბიუჯეტი და, საჭიროების შემთხვევაში, ის, რომ იპოთეკით ხართ დაინტერესებული. თქვენი ბარათის გახსნის შემდეგ ისინი ხედავენ თქვენს სახელს და შეუძლიათ მოგწერონ HOMATCH-ში; თქვენი რეგისტრირებული ელფოსტა ჩანს მხოლოდ მაშინ, თუ საკონტაქტო პარამეტრებში მისი გაზიარება აირჩიეთ (ნაგულისხმევად გამორთულია). თქვენი ანგარიშის ტელეფონის ნომერი არ ზიარდება. თქვენი შემოსავალი, ვალები, საკრედიტო ისტორია, თავდები, რეზიდენტობა და იპოთეკის გამოთვლები არასოდეს ზიარდება. ქონების შეთავაზებების გამორთვა დაუყოვნებლივ გამოგრიცხავთ დამთხვევებიდან.',
    'Пока ваш аккаунт принимает предложения недвижимости (настройка в контактных предпочтениях, которую можно отключить в любое время), владельцы и брокеры, чьё объявление подходит под ваш поиск или для объявления которых вы рассчитали ипотеку, видят анонимный предпросмотр: район, тип недвижимости, округлённый бюджет и, если применимо, интерес к ипотеке. Открыв вашу карточку, они видят ваше имя и могут написать вам в HOMATCH; ваш зарегистрированный email виден, только если вы решили поделиться им в контактных предпочтениях (по умолчанию выключено). Номер телефона вашей учётной записи не передаётся. Ваш доход, долги, кредитная история, поручитель, резидентство и расчёты ипотеки никогда не передаются. Отключение предложений недвижимости немедленно исключает вас из сопоставлений.',
    'Hesabınız mülk tekliflerini kabul ettiği sürece (iletişim tercihlerinizde istediğiniz zaman kapatabileceğiniz bir ayar), ilanı mülk aramanıza veya ipotek hesapladığınız bir ilana uyan mülk sahipleri ve komisyoncular anonim bir önizleme görebilir: bölge, mülk türü, yuvarlanmış bütçe ve uygun olduğunda ipotekle ilgilendiğiniz. Kartınızı açtıktan sonra adınızı görürler ve size HOMATCH\'te mesaj gönderebilirler; kayıtlı e-postanız yalnızca iletişim tercihlerinizde paylaşmayı seçtiyseniz görünür (varsayılan olarak kapalı). Hesabınızın telefon numarası paylaşılmaz. Geliriniz, borçlarınız, kredi geçmişiniz, kefiliniz, ikametiniz ve ipotek hesaplarınız asla paylaşılmaz. Mülk tekliflerini kapatmak sizi eşleştirmeden hemen çıkarır.',
    'طالما أن حسابك يقبل عروض العقارات (إعداد في تفضيلات التواصل يمكنك إيقافه في أي وقت)، يمكن للمالكين والوسطاء الذين يطابق إعلانهم بحثك العقاري، أو إعلانًا حسبت له رهنًا عقاريًا، رؤية معاينة مجهولة الهوية: المنطقة ونوع العقار وميزانية مقرّبة، وعند الاقتضاء اهتمامك بالرهن العقاري. وبعد فتح بطاقتك يرون اسمك ويمكنهم مراسلتك داخل HOMATCH؛ ولا يظهر بريدك الإلكتروني المسجّل إلا إذا اخترت مشاركته في تفضيلات التواصل (معطّل افتراضيًا). لا تتم مشاركة رقم هاتف حسابك. ولا تتم أبدًا مشاركة دخلك أو ديونك أو سجلك الائتماني أو الكفيل أو الإقامة أو حسابات الرهن العقاري. وإيقاف عروض العقارات يزيلك من المطابقة فورًا.',
    'כל עוד החשבון שלך מקבל הצעות נכסים (הגדרה בהעדפות יצירת הקשר שניתן לכבות בכל עת), בעלי נכסים ומתווכים שהמודעה שלהם מתאימה לחיפוש שלך, או למודעה שעבורה חישבת משכנתה, יכולים לראות תצוגה מקדימה אנונימית: האזור, סוג הנכס, תקציב מעוגל, ובמידת הרלוונטיות — שאתה מתעניין במשכנתה. לאחר שפתחו את הכרטיס שלך הם רואים את שמך ויכולים לשלוח לך הודעה ב-HOMATCH; הדוא"ל הרשום שלך מוצג רק אם בחרת לשתף אותו בהעדפות יצירת הקשר (כבוי כברירת מחדל). מספר הטלפון של החשבון שלך אינו משותף. ההכנסה, החובות, היסטוריית האשראי, הערב, התושבות וחישובי המשכנתה שלך לעולם אינם משותפים. כיבוי הצעות הנכסים מוציא אותך מההתאמות מיד.',
  ],
  privacy_lb_consent: [
    'Consent: optional analytics and marketing cookies, marketing communications, and sharing your registered email address with other users when you choose to. You can withdraw consent at any time; this does not affect earlier processing.',
    'თანხმობა: არასავალდებულო ანალიტიკური და მარკეტინგული ქუქიები, მარკეტინგული კომუნიკაცია და თქვენი რეგისტრირებული ელფოსტის სხვა მომხმარებლებისთვის გაზიარება, როცა ამას თავად ირჩევთ. თანხმობის გამოხმობა ნებისმიერ დროს შეგიძლიათ; ეს არ მოქმედებს მანამდე განხორციელებულ დამუშავებაზე.',
    'Согласие: необязательные аналитические и маркетинговые cookie, маркетинговые сообщения, а также передача вашего зарегистрированного адреса электронной почты другим пользователям, если вы сами это выбрали. Вы можете отозвать согласие в любое время; это не влияет на обработку, осуществлённую ранее.',
    'Açık rıza: isteğe bağlı analitik ve pazarlama çerezleri, pazarlama iletişimleri ve tercih ettiğinizde kayıtlı e-posta adresinizin diğer kullanıcılarla paylaşılması. Rızanızı istediğiniz zaman geri çekebilirsiniz; bu, önceki işlemeleri etkilemez.',
    'الموافقة: ملفات تعريف الارتباط التحليلية والتسويقية الاختيارية، والاتصالات التسويقية، ومشاركة بريدك الإلكتروني المسجّل مع مستخدمين آخرين عندما تختار ذلك. يمكنك سحب موافقتك في أي وقت، ولا يؤثر ذلك على المعالجة السابقة.',
    'הסכמה: קובצי Cookie אופציונליים לניתוח ולשיווק, דיוור שיווקי ושיתוף כתובת הדוא"ל הרשומה שלך עם משתמשים אחרים כשתבחר בכך. ניתן לבטל את ההסכמה בכל עת; הדבר אינו משפיע על עיבוד שנעשה קודם לכן.',
  ],
};
