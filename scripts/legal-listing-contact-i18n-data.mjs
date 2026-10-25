// English, Georgian, Russian, Turkish, Arabic, Hebrew.
// Legal round 4 (2026-10-25): owner clarification on PR #335 — listing contact
// phone (published by the advertiser's choice) vs private account phone (shared
// only through the member's separate opt-in) vs lead-database phones. Georgian
// for terms_listing_contact_* is the owner's exact wording. Applied with
// --overwrite: contact_phone_match_notice and the three Privacy matching texts
// are rewritten so none of them says every phone is private.
export const LEGAL_LISTING_CONTACT_STRINGS = {
  terms_listing_contact_title: ['Listing contact information', 'განცხადების საკონტაქტო ინფორმაცია', 'Контактная информация объявления', 'İlan iletişim bilgileri', 'معلومات الاتصال الخاصة بالإعلان', 'פרטי הקשר של המודעה'],
  terms_listing_contact_p1: [
    'When publishing a property listing, a user may provide a contact phone number that they wish to have published in that listing.',
    'უძრავი ქონების განცხადების განთავსებისას მომხმარებელს შეუძლია მიუთითოს საკონტაქტო ტელეფონის ნომერი, რომლის გამოქვეყნებაც სურს შესაბამის განცხადებაში.',
    'При размещении объявления о недвижимости пользователь может указать контактный номер телефона, который он хочет опубликовать в этом объявлении.',
    'Bir gayrimenkul ilanı yayınlarken kullanıcı, o ilanda yayınlanmasını istediği bir iletişim telefon numarası belirtebilir.',
    'عند نشر إعلان عقاري، يمكن للمستخدم تحديد رقم هاتف للتواصل يرغب في نشره ضمن ذلك الإعلان.',
    'בעת פרסום מודעת נדל"ן, המשתמש רשאי לציין מספר טלפון ליצירת קשר שהוא מעוניין שיפורסם במודעה זו.',
  ],
  terms_listing_contact_p2: [
    'If the user chooses to publish that number, HOMATCH is entitled to display it within the relevant listing so that people interested in the property can contact the advertiser.',
    'თუ მომხმარებელი ირჩევს აღნიშნული ნომრის საჯაროდ გამოქვეყნებას, HOMATCH უფლებამოსილია აჩვენოს იგი შესაბამისი განცხადების ფარგლებში, რათა უძრავი ქონებით დაინტერესებულ პირებს შეეძლოთ განმცხადებელთან დაკავშირება.',
    'Если пользователь решает опубликовать этот номер, HOMATCH вправе показывать его в рамках соответствующего объявления, чтобы лица, заинтересованные в недвижимости, могли связаться с автором объявления.',
    'Kullanıcı bu numarayı kamuya açık olarak yayınlamayı seçerse HOMATCH, mülkle ilgilenen kişilerin ilan sahibiyle iletişime geçebilmesi için numarayı ilgili ilan kapsamında gösterme yetkisine sahiptir.',
    'إذا اختار المستخدم نشر هذا الرقم علنًا، يحق لـ HOMATCH عرضه ضمن الإعلان المعني، لكي يتمكن المهتمون بالعقار من التواصل مع المعلِن.',
    'אם המשתמש בוחר לפרסם מספר זה ברבים, HOMATCH רשאית להציג אותו במסגרת המודעה הרלוונטית, כדי שהמתעניינים בנכס יוכלו ליצור קשר עם המפרסם.',
  ],
  terms_listing_contact_p3: [
    'A listing contact phone number is different from the private phone number stored for managing the HOMATCH account.',
    'განცხადების საკონტაქტო ტელეფონის ნომერი განსხვავდება HOMATCH-ის ანგარიშის მართვის მიზნით შენახული პირადი ტელეფონის ნომრისგან.',
    'Контактный номер телефона объявления отличается от личного номера телефона, хранящегося для управления учётной записью HOMATCH.',
    'İlan iletişim telefon numarası, HOMATCH hesabının yönetimi amacıyla saklanan kişisel telefon numarasından farklıdır.',
    'يختلف رقم هاتف التواصل الخاص بالإعلان عن رقم الهاتف الشخصي المحفوظ لإدارة حساب HOMATCH.',
    'מספר הטלפון ליצירת קשר של המודעה שונה ממספר הטלפון הפרטי הנשמר לצורך ניהול חשבון HOMATCH.',
  ],
  terms_listing_contact_p4: [
    'The private account phone number is not published automatically, and it is disclosed to another user only on an appropriate legal basis and in line with the settings the user has chosen.',
    'ანგარიშის პირადი ტელეფონის ნომერი არ ქვეყნდება ავტომატურად და მისი სხვა მომხმარებლისთვის გამჟღავნება ხორციელდება მხოლოდ შესაბამისი სამართლებრივი საფუძვლითა და მომხმარებლის მიერ არჩეული პარამეტრების შესაბამისად.',
    'Личный номер телефона учётной записи не публикуется автоматически, а его раскрытие другому пользователю осуществляется только при наличии соответствующего правового основания и в соответствии с выбранными пользователем настройками.',
    'Hesabın kişisel telefon numarası otomatik olarak yayınlanmaz ve başka bir kullanıcıya yalnızca uygun bir hukuki dayanakla ve kullanıcının seçtiği ayarlara uygun olarak açıklanır.',
    'لا يُنشر رقم الهاتف الشخصي للحساب تلقائيًا، ولا يتم الإفصاح عنه لمستخدم آخر إلا استنادًا إلى أساس قانوني مناسب ووفقًا للإعدادات التي اختارها المستخدم.',
    'מספר הטלפון הפרטי של החשבון אינו מתפרסם באופן אוטומטי, וגילויו למשתמש אחר נעשה רק על בסיס משפטי מתאים ובהתאם להגדרות שהמשתמש בחר.',
  ],

  privacy_portal_listing: [
    'Listings HOMATCH shows from other websites may include the seller contact that was published on the source listing. This is the advertiser\'s public listing contact, not data from HOMATCH accounts or from any lead database.',
    'სხვა ვებსაიტებიდან HOMATCH-ში ნაჩვენებ განცხადებებს შეიძლება ახლდეს წყარო განცხადებაში გამოქვეყნებული გამყიდველის კონტაქტი. ეს არის განმცხადებლის საჯარო საკონტაქტო ინფორმაცია და არა HOMATCH-ის ანგარიშების ან რომელიმე ლიდების ბაზის მონაცემი.',
    'Объявления с других сайтов, которые показывает HOMATCH, могут содержать контакт продавца, опубликованный в исходном объявлении. Это публичный контакт автора объявления, а не данные учётных записей HOMATCH или какой-либо базы лидов.',
    'HOMATCH\'in diğer web sitelerinden gösterdiği ilanlar, kaynak ilanda yayınlanmış satıcı iletişim bilgisini içerebilir. Bu, ilan sahibinin kamuya açık ilan iletişim bilgisidir; HOMATCH hesaplarından veya herhangi bir potansiyel müşteri veritabanından alınan veri değildir.',
    'قد تتضمن الإعلانات التي تعرضها HOMATCH من مواقع أخرى بيانات اتصال البائع المنشورة في الإعلان الأصلي. وهذه هي بيانات الاتصال العامة للمعلِن، وليست بيانات من حسابات HOMATCH أو من أي قاعدة بيانات للعملاء المحتملين.',
    'מודעות מאתרים אחרים ש-HOMATCH מציגה עשויות לכלול את פרטי הקשר של המוכר שפורסמו במודעת המקור. אלה פרטי הקשר הציבוריים של המפרסם, ולא נתונים מחשבונות HOMATCH או ממאגר לידים כלשהו.',
  ],

  // ── The listing form and the buyer's card ──
  contact_phone_publish_label: ['Show this number on my listing', 'ეს ნომერი გამოჩნდეს ჩემს განცხადებაში', 'Показывать этот номер в моём объявлении', 'Bu numarayı ilanımda göster', 'إظهار هذا الرقم في إعلاني', 'הצג את המספר הזה במודעה שלי'],
  contact_phone_publish_hint: [
    'Buyers and tenants who find this listing on HOMATCH can see it and call you. Off until you turn it on; your account phone is never used instead.',
    'ამ განცხადების HOMATCH-ზე მნახველ მყიდველებსა და მოიჯარეებს შეეძლებათ ნომრის ნახვა და დარეკვა. გამორთულია, სანამ თავად არ ჩართავთ; თქვენი ანგარიშის ნომერი მის ნაცვლად არასოდეს გამოიყენება.',
    'Покупатели и арендаторы, нашедшие это объявление в HOMATCH, смогут увидеть номер и позвонить вам. Выключено, пока вы не включите; номер вашей учётной записи вместо него никогда не используется.',
    'Bu ilanı HOMATCH\'te bulan alıcılar ve kiracılar numarayı görüp sizi arayabilir. Siz açana kadar kapalıdır; yerine hesap telefonunuz asla kullanılmaz.',
    'يمكن للمشترين والمستأجرين الذين يجدون هذا الإعلان على HOMATCH رؤية الرقم والاتصال بك. يبقى معطّلًا حتى تفعّله، ولا يُستخدم رقم هاتف حسابك بدلًا منه أبدًا.',
    'קונים ושוכרים שימצאו את המודעה ב-HOMATCH יוכלו לראות את המספר ולהתקשר אליך. כבוי עד שתפעיל אותו; מספר הטלפון של החשבון שלך לעולם אינו משמש במקומו.',
  ],
  contact_phone_publish_failed: [
    'Your listing was saved, but the choice to show the number could not be saved. Please try again from Edit.',
    'განცხადება შენახულია, მაგრამ ნომრის ჩვენების არჩევანი ვერ შეინახა. სცადეთ ხელახლა რედაქტირებიდან.',
    'Объявление сохранено, но выбор показывать номер сохранить не удалось. Попробуйте ещё раз в режиме редактирования.',
    'İlanınız kaydedildi ancak numarayı gösterme tercihi kaydedilemedi. Lütfen Düzenle bölümünden tekrar deneyin.',
    'تم حفظ إعلانك، لكن تعذّر حفظ اختيار إظهار الرقم. يُرجى المحاولة مرة أخرى من صفحة التعديل.',
    'המודעה נשמרה, אך לא ניתן היה לשמור את הבחירה להציג את המספר. נסה שוב ממסך העריכה.',
  ],
  contact_phone_match_notice: [
    'People whose search matches this property can always message you on HOMATCH. They see this number only if you choose to show it on the listing.',
    'ადამიანებს, ვისი ძიებაც ამ ქონებას ემთხვევა, ყოველთვის შეუძლიათ მოგწერონ HOMATCH-ში. ამ ნომერს ისინი მხოლოდ მაშინ ნახავენ, თუ მის ჩვენებას განცხადებაში თავად აირჩევთ.',
    'Люди, чей поиск совпадает с этим объектом, всегда могут написать вам в HOMATCH. Этот номер они увидят, только если вы решите показывать его в объявлении.',
    'Araması bu mülkle eşleşen kişiler size HOMATCH\'te her zaman mesaj gönderebilir. Bu numarayı yalnızca ilanda göstermeyi seçerseniz görürler.',
    'يمكن للأشخاص الذين يطابق بحثهم هذا العقار مراسلتك دائمًا على HOMATCH، ولن يروا هذا الرقم إلا إذا اخترت إظهاره في الإعلان.',
    'אנשים שהחיפוש שלהם תואם לנכס זה יכולים תמיד לשלוח לך הודעה ב-HOMATCH. הם יראו את המספר הזה רק אם תבחר להציג אותו במודעה.',
  ],
  native_call_not_published: [
    'The advertiser hasn\'t chosen to show a phone number on this listing. Send them a message instead.',
    'განმცხადებელს ამ განცხადებაში ტელეფონის ნომრის ჩვენება არ აურჩევია — მიწერეთ შეტყობინება.',
    'Автор объявления не стал показывать номер телефона. Напишите ему сообщение.',
    'İlan sahibi bu ilanda telefon numarası göstermeyi seçmedi. Bunun yerine mesaj gönderin.',
    'لم يختر المعلِن إظهار رقم هاتف في هذا الإعلان. أرسل له رسالة بدلًا من ذلك.',
    'המפרסם לא בחר להציג מספר טלפון במודעה זו. שלח לו הודעה במקום זאת.',
  ],

  // ── Privacy: no claim that every phone is private ──
  privacy_match_p4: [
    'In practice: other users first see an anonymous preview of a matching request. After a match is opened, communication takes place through HOMATCH\'s internal messaging. Your registered email address is made available to the other party only if you turn on email sharing in your contact preferences. Your account phone number is not part of the standard match result; it is shown only if you separately turn on phone sharing there. Both settings are off by default.',
    'პრაქტიკაში: სხვა მომხმარებლები თავდაპირველად ხედავენ შესაბამისი მოთხოვნის ანონიმურ მიმოხილვას. დამთხვევის გახსნის შემდეგ კომუნიკაცია მიმდინარეობს HOMATCH-ის შიდა მიმოწერის სისტემით. თქვენი რეგისტრირებული ელექტრონული ფოსტის მისამართი მეორე მხარისთვის ხელმისაწვდომი ხდება მხოლოდ მაშინ, თუ საკონტაქტო პარამეტრებში ელფოსტის გაზიარებას ჩართავთ. თქვენი ანგარიშის ტელეფონის ნომერი არ არის დამთხვევის სტანდარტული შედეგის ნაწილი; ის ჩანს მხოლოდ მაშინ, თუ იქვე ცალკე ჩართავთ ტელეფონის გაზიარებას. ორივე პარამეტრი ნაგულისხმევად გამორთულია.',
    'На практике: другие пользователи сначала видят анонимный предпросмотр подходящего запроса. После открытия совпадения общение идёт через внутреннюю систему сообщений HOMATCH. Ваш зарегистрированный адрес электронной почты становится доступен другой стороне, только если вы включили обмен email в настройках контактов. Номер телефона вашей учётной записи не входит в стандартный результат сопоставления; он показывается, только если вы отдельно включите там обмен номером. Обе настройки по умолчанию выключены.',
    'Uygulamada: diğer kullanıcılar önce eşleşen bir talebin anonim önizlemesini görür. Bir eşleşme açıldıktan sonra iletişim HOMATCH\'in dahili mesajlaşması üzerinden yürür. Kayıtlı e-posta adresiniz, yalnızca iletişim tercihlerinizde e-posta paylaşımını açtıysanız karşı tarafa açılır. Hesabınızın telefon numarası standart eşleşme sonucunun parçası değildir; yalnızca orada telefon paylaşımını ayrıca açarsanız gösterilir. Her iki ayar da varsayılan olarak kapalıdır.',
    'عمليًا: يرى المستخدمون الآخرون أولًا معاينة مجهولة الهوية للطلب المطابق. وبعد فتح المطابقة، يتم التواصل عبر نظام المراسلة الداخلي في HOMATCH. ولا يُتاح عنوان بريدك الإلكتروني المسجّل للطرف الآخر إلا إذا فعّلت مشاركة البريد الإلكتروني في تفضيلات التواصل. أما رقم هاتف حسابك فليس جزءًا من نتيجة المطابقة القياسية، ولا يظهر إلا إذا فعّلت مشاركة الهاتف هناك بشكل منفصل. والإعدادان معطّلان افتراضيًا.',
    'בפועל: משתמשים אחרים רואים תחילה תצוגה מקדימה אנונימית של בקשה תואמת. לאחר פתיחת ההתאמה, התקשורת מתנהלת דרך מערכת ההודעות הפנימית של HOMATCH. כתובת הדוא"ל הרשומה שלך נחשפת לצד השני רק אם הפעלת שיתוף דוא"ל בהעדפות יצירת הקשר. מספר הטלפון של החשבון שלך אינו חלק מתוצאת ההתאמה הסטנדרטית; הוא מוצג רק אם תפעיל שם בנפרד שיתוף טלפון. שתי ההגדרות כבויות כברירת מחדל.',
  ],
  privacy_s4_li5_body: [
    'While your account accepts property offers (a setting in your contact preferences you can turn off at any time), owners and brokers whose listing fits your property search, or a listing you calculated a mortgage for, can see an anonymous preview: the area, property type, a rounded budget and, where it applies, that you are interested in a mortgage. After they open you, they see your name and can message you in HOMATCH; your registered email is shown only if you chose to share it, and your account phone number only if you separately chose to share it, in your contact preferences (both off by default). Your income, debts, credit history, guarantor, residency and mortgage calculations are never shared. Turning property offers off removes you from Matching immediately.',
    'სანამ თქვენი ანგარიში ქონების შეთავაზებებს იღებს (საკონტაქტო პარამეტრი, რომლის გამორთვაც ნებისმიერ დროს შეგიძლიათ), მესაკუთრეებსა და ბროკერებს, რომელთა განცხადებაც შეესაბამება თქვენს ძიებას, ან რომლის განცხადებისთვისაც იპოთეკა გამოთვალეთ, შეუძლიათ ნახონ ანონიმური მიმოხილვა: უბანი, ქონების ტიპი, დამრგვალებული ბიუჯეტი და, საჭიროების შემთხვევაში, ის, რომ იპოთეკით ხართ დაინტერესებული. თქვენი ბარათის გახსნის შემდეგ ისინი ხედავენ თქვენს სახელს და შეუძლიათ მოგწერონ HOMATCH-ში; თქვენი რეგისტრირებული ელფოსტა ჩანს მხოლოდ მაშინ, თუ მისი გაზიარება აირჩიეთ, ხოლო ანგარიშის ტელეფონის ნომერი — მხოლოდ მაშინ, თუ საკონტაქტო პარამეტრებში ცალკე აირჩიეთ მისი გაზიარება (ორივე ნაგულისხმევად გამორთულია). თქვენი შემოსავალი, ვალები, საკრედიტო ისტორია, თავდები, რეზიდენტობა და იპოთეკის გამოთვლები არასოდეს ზიარდება. ქონების შეთავაზებების გამორთვა დაუყოვნებლივ გამოგრიცხავთ დამთხვევებიდან.',
    'Пока ваш аккаунт принимает предложения недвижимости (настройка в контактных предпочтениях, которую можно отключить в любое время), владельцы и брокеры, чьё объявление подходит под ваш поиск или для объявления которых вы рассчитали ипотеку, видят анонимный предпросмотр: район, тип недвижимости, округлённый бюджет и, если применимо, интерес к ипотеке. Открыв вашу карточку, они видят ваше имя и могут написать вам в HOMATCH; ваш зарегистрированный email виден, только если вы решили им поделиться, а номер телефона учётной записи — только если вы отдельно решили поделиться им в контактных предпочтениях (обе настройки по умолчанию выключены). Ваш доход, долги, кредитная история, поручитель, резидентство и расчёты ипотеки никогда не передаются. Отключение предложений недвижимости немедленно исключает вас из сопоставлений.',
    'Hesabınız mülk tekliflerini kabul ettiği sürece (iletişim tercihlerinizde istediğiniz zaman kapatabileceğiniz bir ayar), ilanı mülk aramanıza veya ipotek hesapladığınız bir ilana uyan mülk sahipleri ve komisyoncular anonim bir önizleme görebilir: bölge, mülk türü, yuvarlanmış bütçe ve uygun olduğunda ipotekle ilgilendiğiniz. Kartınızı açtıktan sonra adınızı görürler ve size HOMATCH\'te mesaj gönderebilirler; kayıtlı e-postanız yalnızca paylaşmayı seçtiyseniz, hesabınızın telefon numarası ise yalnızca iletişim tercihlerinizde ayrıca paylaşmayı seçtiyseniz görünür (ikisi de varsayılan olarak kapalı). Geliriniz, borçlarınız, kredi geçmişiniz, kefiliniz, ikametiniz ve ipotek hesaplarınız asla paylaşılmaz. Mülk tekliflerini kapatmak sizi eşleştirmeden hemen çıkarır.',
    'طالما أن حسابك يقبل عروض العقارات (إعداد في تفضيلات التواصل يمكنك إيقافه في أي وقت)، يمكن للمالكين والوسطاء الذين يطابق إعلانهم بحثك العقاري، أو إعلانًا حسبت له رهنًا عقاريًا، رؤية معاينة مجهولة الهوية: المنطقة ونوع العقار وميزانية مقرّبة، وعند الاقتضاء اهتمامك بالرهن العقاري. وبعد فتح بطاقتك يرون اسمك ويمكنهم مراسلتك داخل HOMATCH؛ ولا يظهر بريدك الإلكتروني المسجّل إلا إذا اخترت مشاركته، ولا يظهر رقم هاتف حسابك إلا إذا اخترت مشاركته بشكل منفصل في تفضيلات التواصل (والإعدادان معطّلان افتراضيًا). ولا تتم أبدًا مشاركة دخلك أو ديونك أو سجلك الائتماني أو الكفيل أو الإقامة أو حسابات الرهن العقاري. وإيقاف عروض العقارات يزيلك من المطابقة فورًا.',
    'כל עוד החשבון שלך מקבל הצעות נכסים (הגדרה בהעדפות יצירת הקשר שניתן לכבות בכל עת), בעלי נכסים ומתווכים שהמודעה שלהם מתאימה לחיפוש שלך, או למודעה שעבורה חישבת משכנתה, יכולים לראות תצוגה מקדימה אנונימית: האזור, סוג הנכס, תקציב מעוגל, ובמידת הרלוונטיות — שאתה מתעניין במשכנתה. לאחר שפתחו את הכרטיס שלך הם רואים את שמך ויכולים לשלוח לך הודעה ב-HOMATCH; הדוא"ל הרשום שלך מוצג רק אם בחרת לשתף אותו, ומספר הטלפון של החשבון — רק אם בחרת בנפרד לשתף אותו בהעדפות יצירת הקשר (שתיהן כבויות כברירת מחדל). ההכנסה, החובות, היסטוריית האשראי, הערב, התושבות וחישובי המשכנתה שלך לעולם אינם משותפים. כיבוי הצעות הנכסים מוציא אותך מההתאמות מיד.',
  ],
  privacy_lb_consent: [
    'Consent: optional analytics and marketing cookies, marketing communications, publishing a listing contact number, and sharing your registered email address or, if you separately choose, your account phone number with other users. You can withdraw consent at any time; this does not affect earlier processing.',
    'თანხმობა: არასავალდებულო ანალიტიკური და მარკეტინგული ქუქიები, მარკეტინგული კომუნიკაცია, განცხადების საკონტაქტო ნომრის გამოქვეყნება და თქვენი რეგისტრირებული ელფოსტის ან, თუ ცალკე აირჩევთ, ანგარიშის ტელეფონის ნომრის სხვა მომხმარებლებისთვის გაზიარება. თანხმობის გამოხმობა ნებისმიერ დროს შეგიძლიათ; ეს არ მოქმედებს მანამდე განხორციელებულ დამუშავებაზე.',
    'Согласие: необязательные аналитические и маркетинговые cookie, маркетинговые сообщения, публикация контактного номера объявления, а также передача другим пользователям вашего зарегистрированного адреса электронной почты или, если вы отдельно это выберете, номера телефона учётной записи. Вы можете отозвать согласие в любое время; это не влияет на обработку, осуществлённую ранее.',
    'Açık rıza: isteğe bağlı analitik ve pazarlama çerezleri, pazarlama iletişimleri, bir ilan iletişim numarasının yayınlanması ve kayıtlı e-posta adresinizin veya ayrıca seçerseniz hesap telefon numaranızın diğer kullanıcılarla paylaşılması. Rızanızı istediğiniz zaman geri çekebilirsiniz; bu, önceki işlemeleri etkilemez.',
    'الموافقة: ملفات تعريف الارتباط التحليلية والتسويقية الاختيارية، والاتصالات التسويقية، ونشر رقم اتصال الإعلان، ومشاركة بريدك الإلكتروني المسجّل أو، إذا اخترت ذلك بشكل منفصل، رقم هاتف حسابك مع مستخدمين آخرين. يمكنك سحب موافقتك في أي وقت، ولا يؤثر ذلك على المعالجة السابقة.',
    'הסכמה: קובצי Cookie אופציונליים לניתוח ולשיווק, דיוור שיווקי, פרסום מספר קשר של מודעה, ושיתוף כתובת הדוא"ל הרשומה שלך או, אם תבחר בכך בנפרד, מספר הטלפון של החשבון שלך עם משתמשים אחרים. ניתן לבטל את ההסכמה בכל עת; הדבר אינו משפיע על עיבוד שנעשה קודם לכן.',
  ],
};
