// Copy for the broker lifecycle: professional signup, onboarding, the broker
// desk, verification, lead workflow, and Admin broker verification / Broker
// Review. Order: [en, ka, ru, tr, ar, he].
export const BROKER_LIFECYCLE_STRINGS = {
  // ── Signup: professional path ───────────────────────────────────────────
  signup_professional_label: [
    "I'm a real-estate professional (broker or agency)",
    'ვარ უძრავი ქონების პროფესიონალი (ბროკერი ან სააგენტო)',
    'Я профессионал в сфере недвижимости (брокер или агентство)',
    'Gayrimenkul profesyoneliyim (emlakçı veya acente)',
    'أنا محترف في مجال العقارات (وسيط أو مكتب عقاري)',
    'אני איש מקצוע בתחום הנדל"ן (מתווך או סוכנות)',
  ],
  signup_professional_hint: [
    "After signing up you'll set up your professional profile. You can still list property and search as usual.",
    'რეგისტრაციის შემდეგ შექმნით თქვენს პროფესიულ პროფილს. ქონების განთავსება და ძიება ჩვეულებრივ შეგეძლებათ.',
    'После регистрации вы настроите профессиональный профиль. Размещать недвижимость и искать можно как обычно.',
    'Kayıt olduktan sonra profesyonel profilinizi oluşturacaksınız. Mülk ilanı vermeye ve aramaya her zamanki gibi devam edebilirsiniz.',
    'بعد التسجيل ستُعدّ ملفك المهني. يمكنك مواصلة إدراج العقارات والبحث كالمعتاد.',
    'אחרי ההרשמה תגדירו את הפרופיל המקצועי שלכם. עדיין אפשר לפרסם נכסים ולחפש כרגיל.',
  ],

  // ── Profile and verification states ─────────────────────────────────────
  broker_status_DRAFT: [
    'Draft', 'მონახაზი', 'Черновик', 'Taslak', 'مسودة', 'טיוטה',
  ],
  broker_verif_UNVERIFIED: [
    'Not verified', 'არ არის ვერიფიცირებული', 'Не подтверждён', 'Doğrulanmadı', 'غير موثَّق', 'לא מאומת',
  ],
  broker_verif_PENDING: [
    'Verification pending', 'ვერიფიკაცია მიმდინარეობს', 'Проверка на рассмотрении', 'Doğrulama bekliyor', 'التوثيق قيد المراجعة', 'האימות ממתין',
  ],
  broker_verif_VERIFIED: [
    'Verified professional', 'ვერიფიცირებული პროფესიონალი', 'Подтверждённый профессионал', 'Doğrulanmış profesyonel', 'محترف موثَّق', 'איש מקצוע מאומת',
  ],
  broker_verif_REJECTED: [
    'Verification declined', 'ვერიფიკაცია უარყოფილია', 'В подтверждении отказано', 'Doğrulama reddedildi', 'رُفض التوثيق', 'האימות נדחה',
  ],
  broker_verif_SUSPENDED: [
    'Verification suspended', 'ვერიფიკაცია შეჩერებულია', 'Подтверждение приостановлено', 'Doğrulama askıya alındı', 'التوثيق معلَّق', 'האימות הושהה',
  ],
  broker_verif_UNVERIFIED_body: [
    'Upload a licence, company registration or ID and send it for review. Verified professionals get a badge on their public profile.',
    'ატვირთეთ ლიცენზია, კომპანიის რეგისტრაციის დოკუმენტი ან პირადობის მოწმობა და გაგზავნეთ განსახილველად. ვერიფიცირებული პროფესიონალები საჯარო პროფილზე ნიშანს იღებენ.',
    'Загрузите лицензию, регистрационные документы компании или удостоверение личности и отправьте на проверку. Подтверждённые профессионалы получают значок в публичном профиле.',
    'Lisans, şirket tescil belgesi veya kimlik yükleyip incelemeye gönderin. Doğrulanmış profesyoneller herkese açık profillerinde bir rozet alır.',
    'ارفع ترخيصًا أو سجلًا تجاريًا أو وثيقة هوية وأرسله للمراجعة. يحصل المحترفون الموثَّقون على شارة في ملفهم العام.',
    'העלו רישיון, תעודת רישום חברה או תעודה מזהה ושלחו לבדיקה. אנשי מקצוע מאומתים מקבלים תג בפרופיל הציבורי.',
  ],
  broker_verif_PENDING_body: [
    "Your documents are with the HOMATCH team. You'll get a notification when the review is done.",
    'თქვენი დოკუმენტები HOMATCH-ის გუნდთანაა. განხილვის დასრულებისას შეტყობინებას მიიღებთ.',
    'Ваши документы у команды HOMATCH. Вы получите уведомление, когда проверка завершится.',
    'Belgeleriniz HOMATCH ekibinde. İnceleme tamamlandığında bildirim alacaksınız.',
    'مستنداتك لدى فريق HOMATCH. ستتلقى إشعارًا عند انتهاء المراجعة.',
    'המסמכים שלכם אצל צוות HOMATCH. תקבלו התראה כשהבדיקה תסתיים.',
  ],
  broker_verif_VERIFIED_body: [
    'Your professional status is verified. The badge shows on your public directory profile.',
    'თქვენი პროფესიული სტატუსი ვერიფიცირებულია. ნიშანი ჩანს კატალოგში თქვენს საჯარო პროფილზე.',
    'Ваш профессиональный статус подтверждён. Значок отображается в вашем публичном профиле в каталоге.',
    'Profesyonel durumunuz doğrulandı. Rozet, rehberdeki herkese açık profilinizde görünür.',
    'تم توثيق وضعك المهني. تظهر الشارة في ملفك العام في الدليل.',
    'הסטטוס המקצועי שלכם אומת. התג מוצג בפרופיל הציבורי שלכם במדריך.',
  ],
  broker_verif_REJECTED_body: [
    'Your verification was declined. Read the note, add the missing documents and send it again.',
    'თქვენი ვერიფიკაცია უარყოფილია. წაიკითხეთ შენიშვნა, დაამატეთ აკლებული დოკუმენტები და ხელახლა გაგზავნეთ.',
    'В подтверждении отказано. Прочитайте комментарий, добавьте недостающие документы и отправьте снова.',
    'Doğrulamanız reddedildi. Notu okuyun, eksik belgeleri ekleyin ve tekrar gönderin.',
    'تم رفض توثيقك. اقرأ الملاحظة وأضف المستندات الناقصة ثم أرسله مجددًا.',
    'האימות שלכם נדחה. קראו את ההערה, הוסיפו את המסמכים החסרים ושלחו שוב.',
  ],
  broker_verif_SUSPENDED_body: [
    'Your verification was suspended by the HOMATCH team. Read the note or contact support.',
    'HOMATCH-ის გუნდმა თქვენი ვერიფიკაცია შეაჩერა. წაიკითხეთ შენიშვნა ან დაუკავშირდით მხარდაჭერას.',
    'Команда HOMATCH приостановила ваше подтверждение. Прочитайте комментарий или обратитесь в поддержку.',
    'Doğrulamanız HOMATCH ekibi tarafından askıya alındı. Notu okuyun veya destekle iletişime geçin.',
    'علّق فريق HOMATCH توثيقك. اقرأ الملاحظة أو تواصل مع الدعم.',
    'צוות HOMATCH השהה את האימות שלכם. קראו את ההערה או פנו לתמיכה.',
  ],

  // ── Verification document types ─────────────────────────────────────────
  broker_doc_LICENSE: [
    'Professional licence', 'პროფესიული ლიცენზია', 'Профессиональная лицензия', 'Mesleki lisans', 'ترخيص مهني', 'רישיון מקצועי',
  ],
  broker_doc_COMPANY_REGISTRATION: [
    'Company registration', 'კომპანიის რეგისტრაცია', 'Регистрация компании', 'Şirket tescili', 'السجل التجاري', 'רישום חברה',
  ],
  broker_doc_ID_DOCUMENT: [
    'ID document', 'პირადობის დამადასტურებელი დოკუმენტი', 'Удостоверение личности', 'Kimlik belgesi', 'وثيقة هوية', 'תעודה מזהה',
  ],
  broker_doc_OTHER: [
    'Other document', 'სხვა დოკუმენტი', 'Другой документ', 'Diğer belge', 'مستند آخر', 'מסמך אחר',
  ],

  // ── Lead workflow states ────────────────────────────────────────────────
  lead_state_label: [
    'Lead status', 'ლიდის სტატუსი', 'Статус лида', 'Potansiyel müşteri durumu', 'حالة العميل المحتمل', 'סטטוס ליד',
  ],
  lead_state_NEW: [
    'New', 'ახალი', 'Новый', 'Yeni', 'جديد', 'חדש',
  ],
  lead_state_REVIEWED: [
    'Reviewed', 'განხილული', 'Просмотрен', 'İncelendi', 'تمت مراجعته', 'נבדק',
  ],
  lead_state_CONTACTED: [
    'Contacted', 'დაკავშირებული', 'Связались', 'İletişime geçildi', 'تم التواصل', 'נוצר קשר',
  ],
  lead_state_IN_PROGRESS: [
    'In progress', 'მიმდინარე', 'В работе', 'Devam ediyor', 'قيد التنفيذ', 'בטיפול',
  ],
  lead_state_WON: [
    'Won', 'წარმატებული', 'Успешно', 'Kazanıldı', 'تم الفوز', 'נסגר בהצלחה',
  ],
  lead_state_CLOSED: [
    'Closed', 'დახურული', 'Закрыт', 'Kapandı', 'مغلق', 'סגור',
  ],

  // ── Deal types and market segments ──────────────────────────────────────
  broker_deal_short_stay: [
    'Short stay', 'მოკლევადიანი', 'Краткосрочная аренда', 'Kısa süreli konaklama', 'إقامة قصيرة', 'שהייה קצרה',
  ],
  broker_deal_investment: [
    'Investment', 'ინვესტიცია', 'Инвестиции', 'Yatırım', 'استثمار', 'השקעה',
  ],
  broker_segment_residential: [
    'Residential', 'საცხოვრებელი', 'Жилая', 'Konut', 'سكني', 'מגורים',
  ],
  broker_segment_commercial: [
    'Commercial', 'კომერციული', 'Коммерческая', 'Ticari', 'تجاري', 'מסחרי',
  ],
  broker_segment_land: [
    'Land', 'მიწა', 'Земля', 'Arsa', 'أراضٍ', 'קרקעות',
  ],
  broker_segment_new_build: [
    'New build', 'ახალი აშენებული', 'Новостройки', 'Yeni yapı', 'مبانٍ جديدة', 'בנייה חדשה',
  ],

  // ── Errors ──────────────────────────────────────────────────────────────
  broker_err_suspended: [
    'This account is suspended. Contact HOMATCH support to restore access.',
    'ეს ანგარიში შეჩერებულია. წვდომის აღსადგენად დაუკავშირდით HOMATCH-ის მხარდაჭერას.',
    'Этот аккаунт приостановлен. Чтобы восстановить доступ, обратитесь в поддержку HOMATCH.',
    'Bu hesap askıya alındı. Erişimi geri kazanmak için HOMATCH desteğiyle iletişime geçin.',
    'هذا الحساب معلَّق. تواصل مع دعم HOMATCH لاستعادة الوصول.',
    'החשבון הזה מושהה. פנו לתמיכה של HOMATCH כדי לשחזר את הגישה.',
  ],
  broker_err_logo: [
    'The logo must be an image uploaded here.',
    'ლოგო უნდა იყოს აქ ატვირთული სურათი.',
    'Логотип должен быть изображением, загруженным здесь.',
    'Logo, buraya yüklenmiş bir görsel olmalıdır.',
    'يجب أن يكون الشعار صورة مرفوعة هنا.',
    'הלוגו חייב להיות תמונה שהועלתה כאן.',
  ],
  broker_err_file_too_large: [
    'This file is too large.', 'ეს ფაილი ძალიან დიდია.', 'Этот файл слишком большой.', 'Bu dosya çok büyük.', 'هذا الملف كبير جدًا.', 'הקובץ גדול מדי.',
  ],
  broker_err_upload: [
    "The upload didn't go through. Try again.",
    'ატვირთვა ვერ მოხერხდა. სცადეთ ხელახლა.',
    'Не удалось загрузить файл. Попробуйте ещё раз.',
    'Yükleme tamamlanamadı. Tekrar deneyin.',
    'لم يكتمل الرفع. حاول مرة أخرى.',
    'ההעלאה לא הצליחה. נסו שוב.',
  ],
  broker_err_too_many: [
    'Too many values selected. Remove a few and try again.',
    'არჩეულია ზედმეტად ბევრი მნიშვნელობა. ამოიღეთ რამდენიმე და სცადეთ ხელახლა.',
    'Выбрано слишком много значений. Уберите несколько и попробуйте снова.',
    'Çok fazla değer seçildi. Birkaçını kaldırıp tekrar deneyin.',
    'تم اختيار قيم كثيرة جدًا. أزل بعضها وحاول مرة أخرى.',
    'נבחרו יותר מדי ערכים. הסירו כמה ונסו שוב.',
  ],
  broker_err_too_long: [
    'One of the fields is too long.',
    'ერთ-ერთი ველი ძალიან გრძელია.',
    'Одно из полей слишком длинное.',
    'Alanlardan biri çok uzun.',
    'أحد الحقول طويل جدًا.',
    'אחד השדות ארוך מדי.',
  ],
  broker_err_experience: [
    'Years of experience must be a whole number from 0 to 80.',
    'გამოცდილების წლები უნდა იყოს მთელი რიცხვი 0-დან 80-მდე.',
    'Стаж должен быть целым числом от 0 до 80.',
    'Deneyim yılı 0 ile 80 arasında bir tam sayı olmalıdır.',
    'يجب أن تكون سنوات الخبرة عددًا صحيحًا من 0 إلى 80.',
    'שנות הניסיון חייבות להיות מספר שלם בין 0 ל-80.',
  ],
  broker_err_insufficient_credits: [
    'Not enough Credits. Top up and try again.',
    'კრედიტები არ არის საკმარისი. შეავსეთ ბალანსი და სცადეთ ხელახლა.',
    'Недостаточно кредитов. Пополните баланс и попробуйте снова.',
    'Yeterli Kredi yok. Bakiye yükleyip tekrar deneyin.',
    'الأرصدة غير كافية. اشحن رصيدك وحاول مرة أخرى.',
    'אין מספיק קרדיטים. טענו את היתרה ונסו שוב.',
  ],
  broker_err_not_purchasable: [
    'The directory listing can be bought once HOMATCH approves your profile.',
    'კატალოგში განთავსების შეძენა შესაძლებელი იქნება მას შემდეგ, რაც HOMATCH თქვენს პროფილს დაამტკიცებს.',
    'Размещение в каталоге можно купить после того, как HOMATCH одобрит ваш профиль.',
    'Rehber kaydı, HOMATCH profilinizi onayladıktan sonra satın alınabilir.',
    'يمكن شراء الإدراج في الدليل بعد أن توافق HOMATCH على ملفك.',
    'אפשר לרכוש רישום במדריך לאחר ש-HOMATCH תאשר את הפרופיל שלכם.',
  ],
  broker_err_product_unavailable: [
    "The directory listing isn't on sale right now.",
    'კატალოგში განთავსება ამჟამად არ იყიდება.',
    'Размещение в каталоге сейчас недоступно для покупки.',
    'Rehber kaydı şu anda satışta değil.',
    'الإدراج في الدليل غير متاح للشراء حاليًا.',
    'רישום במדריך אינו זמין לרכישה כרגע.',
  ],
  broker_err_not_submittable: [
    "This can't be sent for review in its current state.",
    'მიმდინარე მდგომარეობაში ამის განსახილველად გაგზავნა შეუძლებელია.',
    'В текущем состоянии это нельзя отправить на проверку.',
    'Bu, mevcut durumunda incelemeye gönderilemez.',
    'لا يمكن إرسال هذا للمراجعة في حالته الحالية.',
    'אי אפשר לשלוח את זה לבדיקה במצבו הנוכחי.',
  ],
  broker_err_document_required: [
    'Upload at least one document first.',
    'ჯერ ატვირთეთ მინიმუმ ერთი დოკუმენტი.',
    'Сначала загрузите хотя бы один документ.',
    'Önce en az bir belge yükleyin.',
    'ارفع مستندًا واحدًا على الأقل أولًا.',
    'העלו קודם מסמך אחד לפחות.',
  ],
  broker_err_unlock_required: [
    'Open the contact first — this status needs an opened contact.',
    'ჯერ გახსენით კონტაქტი — ამ სტატუსს გახსნილი კონტაქტი სჭირდება.',
    'Сначала откройте контакт — для этого статуса нужен открытый контакт.',
    'Önce iletişim bilgisini açın — bu durum için açılmış bir iletişim gerekir.',
    'افتح جهة الاتصال أولًا — تتطلب هذه الحالة جهة اتصال مفتوحة.',
    'פתחו קודם את איש הקשר — הסטטוס הזה דורש איש קשר פתוח.',
  ],
  broker_err_verification_closed: [
    'Verification is closed for this profile.',
    'ამ პროფილისთვის ვერიფიკაცია დახურულია.',
    'Для этого профиля подтверждение закрыто.',
    'Bu profil için doğrulama kapalı.',
    'التوثيق مغلق لهذا الملف.',
    'האימות סגור עבור הפרופיל הזה.',
  ],

  // ── Onboarding ──────────────────────────────────────────────────────────
  broker_onb_back: [
    'Back to the broker desk', 'ბროკერის პანელზე დაბრუნება', 'Назад в кабинет брокера', 'Emlakçı paneline dön', 'العودة إلى لوحة الوسيط', 'חזרה לשולחן המתווך',
  ],
  broker_onb_title_new: [
    'Set up your professional profile', 'შექმენით თქვენი პროფესიული პროფილი', 'Настройте профессиональный профиль', 'Profesyonel profilinizi oluşturun', 'أعدّ ملفك المهني', 'הגדירו את הפרופיל המקצועי שלכם',
  ],
  broker_onb_title_edit: [
    'Edit your professional profile', 'პროფესიული პროფილის რედაქტირება', 'Редактировать профессиональный профиль', 'Profesyonel profilinizi düzenleyin', 'عدّل ملفك المهني', 'עריכת הפרופיל המקצועי',
  ],
  broker_onb_sub: [
    'One profile per account. It stays private as a draft until you send it for review.',
    'ერთი პროფილი ერთ ანგარიშზე. ის მონახაზის სახით პირადი რჩება, სანამ განსახილველად არ გაგზავნით.',
    'Один профиль на аккаунт. Он остаётся закрытым черновиком, пока вы не отправите его на проверку.',
    'Hesap başına bir profil. İncelemeye gönderene kadar taslak olarak gizli kalır.',
    'ملف واحد لكل حساب. يبقى خاصًا كمسودة حتى ترسله للمراجعة.',
    'פרופיל אחד לכל חשבון. הוא נשאר פרטי כטיוטה עד שתשלחו אותו לבדיקה.',
  ],
  broker_onb_role_heading: [
    'How you work', 'როგორ მუშაობთ', 'Как вы работаете', 'Nasıl çalışıyorsunuz', 'طريقة عملك', 'איך אתם עובדים',
  ],
  broker_onb_role_broker: [
    'Individual broker', 'ინდივიდუალური ბროკერი', 'Частный брокер', 'Bireysel emlakçı', 'وسيط مستقل', 'מתווך עצמאי',
  ],
  broker_onb_role_broker_hint: [
    'You work on your own account.', 'მუშაობთ დამოუკიდებლად.', 'Вы работаете самостоятельно.', 'Kendi adınıza çalışıyorsunuz.', 'تعمل لحسابك الخاص.', 'אתם עובדים באופן עצמאי.',
  ],
  broker_onb_role_agency: [
    'Agency', 'სააგენტო', 'Агентство', 'Acente', 'مكتب عقاري', 'סוכנות',
  ],
  broker_onb_role_agency_hint: [
    'A company profile with its own name and logo.',
    'კომპანიის პროფილი საკუთარი სახელითა და ლოგოთი.',
    'Профиль компании с собственным названием и логотипом.',
    'Kendi adı ve logosu olan bir şirket profili.',
    'ملف شركة باسمها وشعارها الخاصين.',
    'פרופיל חברה עם שם ולוגו משלה.',
  ],
  broker_onb_role_member: [
    'Agent at an agency', 'სააგენტოს აგენტი', 'Агент агентства', 'Bir acentede danışman', 'وكيل في مكتب عقاري', 'סוכן בסוכנות',
  ],
  broker_onb_role_member_hint: [
    'You work for an agency.', 'მუშაობთ სააგენტოში.', 'Вы работаете в агентстве.', 'Bir acente için çalışıyorsunuz.', 'تعمل لدى مكتب عقاري.', 'אתם עובדים בסוכנות.',
  ],
  broker_onb_member_limit: [
    "Agency teams aren't available yet. For now, join as an individual broker under your own name; your profile can be linked to your agency when teams arrive.",
    'სააგენტოს გუნდები ჯერ ხელმისაწვდომი არ არის. ამ ეტაპზე შემოგვიერთდით როგორც ინდივიდუალური ბროკერი საკუთარი სახელით; გუნდების გამოჩენისას თქვენი პროფილი სააგენტოს შეიძლება დაუკავშირდეს.',
    'Команды агентств пока недоступны. Сейчас присоединяйтесь как частный брокер под своим именем; когда появятся команды, ваш профиль можно будет связать с агентством.',
    'Acente ekipleri henüz kullanılamıyor. Şimdilik kendi adınızla bireysel emlakçı olarak katılın; ekipler geldiğinde profiliniz acentenize bağlanabilir.',
    'فرق المكاتب العقارية غير متاحة بعد. انضم حاليًا كوسيط مستقل باسمك؛ ويمكن ربط ملفك بمكتبك عند إطلاق الفرق.',
    'צוותי סוכנות עדיין לא זמינים. בינתיים הצטרפו כמתווך עצמאי בשמכם; כשהצוותים יושקו, אפשר יהיה לקשר את הפרופיל שלכם לסוכנות.',
  ],
  broker_onb_display_name: [
    'Your professional name', 'თქვენი პროფესიული სახელი', 'Ваше профессиональное имя', 'Profesyonel adınız', 'اسمك المهني', 'השם המקצועי שלכם',
  ],
  broker_onb_agency_name: [
    'Agency name', 'სააგენტოს სახელი', 'Название агентства', 'Acente adı', 'اسم المكتب العقاري', 'שם הסוכנות',
  ],
  broker_onb_experience: [
    'Years of experience', 'გამოცდილება (წლები)', 'Опыт работы (лет)', 'Deneyim yılı', 'سنوات الخبرة', 'שנות ניסיון',
  ],
  broker_onb_logo: [
    'Logo or photo', 'ლოგო ან ფოტო', 'Логотип или фото', 'Logo veya fotoğraf', 'الشعار أو الصورة', 'לוגו או תמונה',
  ],
  broker_onb_logo_upload: [
    'Upload image', 'სურათის ატვირთვა', 'Загрузить изображение', 'Görsel yükle', 'رفع صورة', 'העלאת תמונה',
  ],
  broker_onb_logo_change: [
    'Change image', 'სურათის შეცვლა', 'Изменить изображение', 'Görseli değiştir', 'تغيير الصورة', 'החלפת תמונה',
  ],
  broker_onb_logo_remove: [
    'Remove', 'წაშლა', 'Удалить', 'Kaldır', 'إزالة', 'הסרה',
  ],
  broker_onb_market_heading: [
    'Where and what you work on', 'სად და რაზე მუშაობთ', 'Где и с чем вы работаете', 'Nerede ve ne üzerinde çalışıyorsunuz', 'أين تعمل وعلى ماذا', 'איפה ועל מה אתם עובדים',
  ],
  broker_onb_districts: [
    'Districts (optional, separated by commas)',
    'უბნები (არასავალდებულო, მძიმით გამოყოფილი)',
    'Районы (необязательно, через запятую)',
    'Semtler (isteğe bağlı, virgülle ayrılmış)',
    'الأحياء (اختياري، مفصولة بفواصل)',
    'שכונות (לא חובה, מופרדות בפסיקים)',
  ],
  broker_onb_segments: [
    'Segments', 'სეგმენტები', 'Сегменты', 'Segmentler', 'القطاعات', 'פלחים',
  ],
  broker_onb_contact_heading: [
    'How clients reach you', 'როგორ დაგიკავშირდებიან კლიენტები', 'Как клиенты с вами свяжутся', 'Müşteriler size nasıl ulaşır', 'كيف يتواصل معك العملاء', 'איך לקוחות יוצרים איתכם קשר',
  ],
  broker_onb_contact_note: [
    'Give at least one way to reach you. These details appear on your public profile only after it is approved and paid.',
    'მიუთითეთ დაკავშირების მინიმუმ ერთი საშუალება. ეს მონაცემები საჯარო პროფილზე გამოჩნდება მხოლოდ მისი დამტკიცებისა და გადახდის შემდეგ.',
    'Укажите хотя бы один способ связи. Эти данные появятся в публичном профиле только после его одобрения и оплаты.',
    'Size ulaşmak için en az bir yol belirtin. Bu bilgiler herkese açık profilinizde yalnızca onaylanıp ödendikten sonra görünür.',
    'أدخل وسيلة تواصل واحدة على الأقل. تظهر هذه التفاصيل في ملفك العام فقط بعد الموافقة عليه ودفع رسومه.',
    'ציינו לפחות דרך אחת ליצירת קשר. הפרטים יופיעו בפרופיל הציבורי רק לאחר שיאושר וישולם.',
  ],
  broker_onb_next_heading: [
    'What happens next', 'რა ხდება შემდეგ', 'Что дальше', 'Sonra ne olacak', 'ماذا يحدث بعد ذلك', 'מה קורה עכשיו',
  ],
  broker_onb_next_1: [
    'Your profile is saved as a draft on your broker desk.',
    'თქვენი პროფილი მონახაზის სახით ინახება ბროკერის პანელზე.',
    'Ваш профиль сохраняется как черновик в кабинете брокера.',
    'Profiliniz emlakçı panelinizde taslak olarak kaydedilir.',
    'يُحفظ ملفك كمسودة في لوحة الوسيط.',
    'הפרופיל שלכם נשמר כטיוטה בשולחן המתווך.',
  ],
  broker_onb_next_2: [
    'Send it for review, and upload documents to become a verified professional.',
    'გაგზავნეთ განსახილველად და ატვირთეთ დოკუმენტები, რომ გახდეთ ვერიფიცირებული პროფესიონალი.',
    'Отправьте его на проверку и загрузите документы, чтобы стать подтверждённым профессионалом.',
    'İncelemeye gönderin ve doğrulanmış profesyonel olmak için belgelerinizi yükleyin.',
    'أرسله للمراجعة وارفع المستندات لتصبح محترفًا موثَّقًا.',
    'שלחו אותו לבדיקה והעלו מסמכים כדי להפוך לאיש מקצוע מאומת.',
  ],
  broker_onb_next_3: [
    'Add properties and search for your clients — matches and leads appear on your desk.',
    'დაამატეთ ქონება და მოძებნეთ თქვენი კლიენტებისთვის — დამთხვევები და ლიდები თქვენს პანელზე გამოჩნდება.',
    'Добавляйте объекты и ищите для своих клиентов — совпадения и лиды появятся в вашем кабинете.',
    'Mülk ekleyin ve müşterileriniz için arama yapın — eşleşmeler ve potansiyel müşteriler panelinizde görünür.',
    'أضف العقارات وابحث لعملائك — تظهر التطابقات والعملاء المحتملون في لوحتك.',
    'הוסיפו נכסים וחפשו עבור הלקוחות שלכם — התאמות ולידים יופיעו בשולחן שלכם.',
  ],
  broker_onb_create: [
    'Create profile', 'პროფილის შექმნა', 'Создать профиль', 'Profil oluştur', 'إنشاء الملف', 'יצירת פרופיל',
  ],
  broker_onb_save: [
    'Save changes', 'ცვლილებების შენახვა', 'Сохранить изменения', 'Değişiklikleri kaydet', 'حفظ التغييرات', 'שמירת השינויים',
  ],

  // ── Broker desk: status, review and directory purchase ──────────────────
  broker_desk_load_error: [
    "We couldn't load this right now. Please try again.",
    'ამჟამად ჩატვირთვა ვერ მოხერხდა. გთხოვთ, სცადოთ ხელახლა.',
    'Сейчас не удалось загрузить данные. Попробуйте ещё раз.',
    'Şu anda yüklenemedi. Lütfen tekrar deneyin.',
    'تعذّر التحميل الآن. يُرجى المحاولة مرة أخرى.',
    'לא הצלחנו לטעון את זה כרגע. נסו שוב.',
  ],
  broker_desk_retry: [
    'Try again', 'ხელახლა ცდა', 'Повторить', 'Tekrar dene', 'حاول مرة أخرى', 'נסו שוב',
  ],
  broker_desk_submit_review: [
    'Send for review', 'განსახილველად გაგზავნა', 'Отправить на проверку', 'İncelemeye gönder', 'إرسال للمراجعة', 'שליחה לבדיקה',
  ],
  broker_desk_submitted: [
    "Sent for review. We'll notify you when it's decided.",
    'გაიგზავნა განსახილველად. გადაწყვეტილების მიღებისას შეგატყობინებთ.',
    'Отправлено на проверку. Мы сообщим вам о решении.',
    'İncelemeye gönderildi. Karar verildiğinde size bildireceğiz.',
    'أُرسل للمراجعة. سنُعلمك عند اتخاذ القرار.',
    'נשלח לבדיקה. נעדכן אתכם כשתתקבל החלטה.',
  ],
  broker_desk_pending_note: [
    'Your profile is being reviewed. You can keep editing it in the meantime.',
    'თქვენი პროფილი განხილვის პროცესშია. ამ დროს მისი რედაქტირება შეგიძლიათ.',
    'Ваш профиль на проверке. Пока можно продолжать его редактировать.',
    'Profiliniz inceleniyor. Bu sırada düzenlemeye devam edebilirsiniz.',
    'ملفك قيد المراجعة. يمكنك مواصلة تعديله في هذه الأثناء.',
    'הפרופיל שלכם בבדיקה. בינתיים אפשר להמשיך לערוך אותו.',
  ],
  broker_desk_buy: [
    'Buy directory listing', 'კატალოგში განთავსების შეძენა', 'Купить размещение в каталоге', 'Rehber kaydı satın al', 'شراء الإدراج في الدليل', 'רכישת רישום במדריך',
  ],
  broker_desk_renew: [
    'Extend directory listing', 'კატალოგში განთავსების გაგრძელება', 'Продлить размещение в каталоге', 'Rehber kaydını uzat', 'تمديد الإدراج في الدليل', 'הארכת הרישום במדריך',
  ],
  broker_desk_buy_title: [
    'Confirm directory listing', 'დაადასტურეთ კატალოგში განთავსება', 'Подтвердите размещение в каталоге', 'Rehber kaydını onaylayın', 'تأكيد الإدراج في الدليل', 'אישור רישום במדריך',
  ],
  broker_desk_buy_body: [
    '{{credits}} Credits for {{days}} days in the public broker directory. Your balance: {{balance}} Credits. Charged once, now.',
    '{{credits}} კრედიტი {{days}} დღით ბროკერების საჯარო კატალოგში. თქვენი ბალანსი: {{balance}} კრედიტი. ჩამოგეჭრებათ ერთხელ, ახლავე.',
    '{{credits}} кредитов за {{days}} дней в публичном каталоге брокеров. Ваш баланс: {{balance}} кредитов. Списывается один раз, сейчас.',
    'Herkese açık emlakçı rehberinde {{days}} gün için {{credits}} Kredi. Bakiyeniz: {{balance}} Kredi. Tek seferlik, şimdi tahsil edilir.',
    '{{credits}} رصيدًا مقابل {{days}} يومًا في دليل الوسطاء العام. رصيدك: {{balance}}. يُخصم مرة واحدة، الآن.',
    '{{credits}} קרדיטים עבור {{days}} ימים במדריך המתווכים הציבורי. היתרה שלכם: {{balance}} קרדיטים. חיוב חד-פעמי, עכשיו.',
  ],
  broker_desk_buy_confirm: [
    'Pay and publish', 'გადახდა და გამოქვეყნება', 'Оплатить и опубликовать', 'Öde ve yayınla', 'ادفع وانشر', 'תשלום ופרסום',
  ],
  broker_desk_cancel: [
    'Cancel', 'გაუქმება', 'Отмена', 'İptal', 'إلغاء', 'ביטול',
  ],
  broker_desk_bought: [
    'Done — your profile is in the public directory.',
    'მზადაა — თქვენი პროფილი საჯარო კატალოგშია.',
    'Готово — ваш профиль в публичном каталоге.',
    'Tamam — profiliniz herkese açık rehberde.',
    'تم — ملفك الآن في الدليل العام.',
    'בוצע — הפרופיל שלכם במדריך הציבורי.',
  ],

  // ── Broker desk: setup checklist ────────────────────────────────────────
  broker_desk_steps_heading: [
    'Your setup', 'თქვენი მომზადება', 'Ваша настройка', 'Kurulumunuz', 'إعدادك', 'ההגדרה שלכם',
  ],
  broker_desk_step_profile: [
    'Professional profile created', 'პროფესიული პროფილი შექმნილია', 'Профессиональный профиль создан', 'Profesyonel profil oluşturuldu', 'تم إنشاء الملف المهني', 'הפרופיל המקצועי נוצר',
  ],
  broker_desk_step_contact: [
    'Contact details and markets added', 'საკონტაქტო მონაცემები და ბაზრები დამატებულია', 'Контакты и рынки добавлены', 'İletişim bilgileri ve pazarlar eklendi', 'تمت إضافة بيانات التواصل والأسواق', 'פרטי קשר ושווקים נוספו',
  ],
  broker_desk_step_verification: [
    'Verification documents sent', 'ვერიფიკაციის დოკუმენტები გაგზავნილია', 'Документы для подтверждения отправлены', 'Doğrulama belgeleri gönderildi', 'تم إرسال مستندات التوثيق', 'מסמכי האימות נשלחו',
  ],
  broker_desk_step_review: [
    'Profile sent for review', 'პროფილი გაგზავნილია განსახილველად', 'Профиль отправлен на проверку', 'Profil incelemeye gönderildi', 'تم إرسال الملف للمراجعة', 'הפרופיל נשלח לבדיקה',
  ],
  broker_desk_step_property: [
    'First property added', 'პირველი ქონება დამატებულია', 'Первый объект добавлен', 'İlk mülk eklendi', 'تمت إضافة أول عقار', 'הנכס הראשון נוסף',
  ],
  broker_desk_step_public: [
    'Visible in the public directory', 'ჩანს საჯარო კატალოგში', 'Виден в публичном каталоге', 'Herkese açık rehberde görünür', 'ظاهر في الدليل العام', 'מוצג במדריך הציבורי',
  ],
  broker_desk_done: [
    'done', 'შესრულებულია', 'готово', 'tamamlandı', 'تم', 'בוצע',
  ],
  broker_desk_todo: [
    'to do', 'შესასრულებელი', 'сделать', 'yapılacak', 'للإنجاز', 'לביצוע',
  ],

  // ── Broker desk: verification ───────────────────────────────────────────
  broker_desk_verif_heading: [
    'Professional verification', 'პროფესიული ვერიფიკაცია', 'Профессиональное подтверждение', 'Profesyonel doğrulama', 'التوثيق المهني', 'אימות מקצועי',
  ],
  broker_desk_doc_kind: [
    'Document type', 'დოკუმენტის ტიპი', 'Тип документа', 'Belge türü', 'نوع المستند', 'סוג מסמך',
  ],
  broker_desk_doc_upload: [
    'Upload document', 'დოკუმენტის ატვირთვა', 'Загрузить документ', 'Belge yükle', 'رفع مستند', 'העלאת מסמך',
  ],
  broker_desk_doc_added: [
    'Document uploaded.', 'დოკუმენტი ატვირთულია.', 'Документ загружен.', 'Belge yüklendi.', 'تم رفع المستند.', 'המסמך הועלה.',
  ],
  broker_desk_verif_submit: [
    'Send for verification', 'ვერიფიკაციაზე გაგზავნა', 'Отправить на подтверждение', 'Doğrulamaya gönder', 'إرسال للتوثيق', 'שליחה לאימות',
  ],
  broker_desk_verif_sent: [
    'Sent for verification.', 'გაიგზავნა ვერიფიკაციაზე.', 'Отправлено на подтверждение.', 'Doğrulamaya gönderildi.', 'أُرسل للتوثيق.', 'נשלח לאימות.',
  ],
  broker_desk_doc_private: [
    'Documents are private: only you and the HOMATCH review team can open them.',
    'დოკუმენტები პირადია: მათი გახსნა მხოლოდ თქვენ და HOMATCH-ის განხილვის გუნდს შეუძლია.',
    'Документы конфиденциальны: открыть их можете только вы и команда проверки HOMATCH.',
    'Belgeler gizlidir: yalnızca siz ve HOMATCH inceleme ekibi açabilir.',
    'المستندات خاصة: لا يمكن فتحها إلا لك ولفريق المراجعة في HOMATCH.',
    'המסמכים פרטיים: רק אתם וצוות הבדיקה של HOMATCH יכולים לפתוח אותם.',
  ],

  // ── Broker desk: portfolio ──────────────────────────────────────────────
  broker_desk_portfolio_heading: [
    'Your properties', 'თქვენი ქონება', 'Ваши объекты', 'Mülkleriniz', 'عقاراتك', 'הנכסים שלכם',
  ],
  broker_desk_add_property: [
    'Add property', 'ქონების დამატება', 'Добавить объект', 'Mülk ekle', 'إضافة عقار', 'הוספת נכס',
  ],
  broker_desk_import_property: [
    'Import from a link', 'ბმულიდან იმპორტი', 'Импорт по ссылке', 'Bağlantıdan içe aktar', 'استيراد من رابط', 'ייבוא מקישור',
  ],
  broker_desk_leads_window: [
    "Current leads count people who posted in the last {{days}} days and haven't been opened yet.",
    'მიმდინარე ლიდები მოიცავს ადამიანებს, რომლებმაც ბოლო {{days}} დღეში დაწერეს და ჯერ არ გახსნილან.',
    'Текущие лиды — это люди, которые написали за последние {{days}} дней и ещё не были открыты.',
    'Güncel potansiyel müşteriler, son {{days}} gün içinde paylaşım yapan ve henüz açılmamış kişileri sayar.',
    'يشمل العملاء المحتملون الحاليون الأشخاص الذين نشروا خلال آخر {{days}} يومًا ولم تُفتح بياناتهم بعد.',
    'לידים עדכניים הם אנשים שפרסמו ב-{{days}} הימים האחרונים ועדיין לא נפתחו.',
  ],
  broker_desk_portfolio_empty: [
    'No properties yet. Add one to start finding potentially interested people.',
    'ქონება ჯერ არ გაქვთ. დაამატეთ, რომ დაიწყოთ პოტენციურად დაინტერესებული პირების მოძიება.',
    'Объектов пока нет. Добавьте объект, чтобы начать находить потенциально заинтересованных людей.',
    'Henüz mülk yok. Potansiyel olarak ilgili kişileri bulmaya başlamak için bir mülk ekleyin.',
    'لا توجد عقارات بعد. أضف عقارًا لتبدأ في العثور على أشخاص مهتمين محتملين.',
    'עדיין אין נכסים. הוסיפו נכס כדי להתחיל למצוא אנשים שעשויים להתעניין.',
  ],
  broker_desk_untitled_property: [
    'Untitled property', 'უსათაურო ქონება', 'Объект без названия', 'Başlıksız mülk', 'عقار بلا عنوان', 'נכס ללא כותרת',
  ],
  broker_desk_current_leads: [
    'Current leads', 'მიმდინარე ლიდები', 'Текущие лиды', 'Güncel potansiyel müşteriler', 'العملاء المحتملون الحاليون', 'לידים עדכניים',
  ],
  broker_desk_opened_contacts: [
    'Opened contacts', 'გახსნილი კონტაქტები', 'Открытые контакты', 'Açılan iletişimler', 'جهات الاتصال المفتوحة', 'אנשי קשר שנפתחו',
  ],
  broker_desk_open_leads: [
    'Leads', 'ლიდები', 'Лиды', 'Potansiyel müşteriler', 'العملاء المحتملون', 'לידים',
  ],
  broker_desk_open_property: [
    'Property', 'ქონება', 'Объект', 'Mülk', 'العقار', 'נכס',
  ],

  // ── Broker desk: lead workflow ──────────────────────────────────────────
  broker_desk_leads_heading: [
    'Lead workflow', 'ლიდებთან მუშაობა', 'Работа с лидами', 'Potansiyel müşteri akışı', 'سير العمل مع العملاء المحتملين', 'תהליך עבודה עם לידים',
  ],
  broker_desk_leads_empty: [
    'No current leads yet.', 'მიმდინარე ლიდები ჯერ არ არის.', 'Текущих лидов пока нет.', 'Henüz güncel potansiyel müşteri yok.', 'لا يوجد عملاء محتملون حاليون بعد.', 'עדיין אין לידים עדכניים.',
  ],
  broker_desk_leads_note: [
    "Move a lead along from its property's matches. Contacted, In progress and Won need an opened contact.",
    'ლიდის სტატუსი შეცვალეთ მისი ქონების დამთხვევებიდან. სტატუსებს „დაკავშირებული“, „მიმდინარე“ და „წარმატებული“ გახსნილი კონტაქტი სჭირდება.',
    'Продвигайте лид из совпадений его объекта. Для статусов «Связались», «В работе» и «Успешно» нужен открытый контакт.',
    'Bir potansiyel müşteriyi mülkünün eşleşmelerinden ilerletin. İletişime geçildi, Devam ediyor ve Kazanıldı durumları için açılmış bir iletişim gerekir.',
    'انقل العميل المحتمل بين المراحل من تطابقات عقاره. تتطلب حالات «تم التواصل» و«قيد التنفيذ» و«تم الفوز» جهة اتصال مفتوحة.',
    'קדמו ליד מתוך ההתאמות של הנכס שלו. הסטטוסים "נוצר קשר", "בטיפול" ו"נסגר בהצלחה" דורשים איש קשר פתוח.',
  ],

  // ── Broker desk: client searches ────────────────────────────────────────
  broker_desk_clients_heading: [
    'Client searches', 'კლიენტების ძიებები', 'Поиски для клиентов', 'Müşteri aramaları', 'عمليات البحث للعملاء', 'חיפושים עבור לקוחות',
  ],
  broker_desk_new_client_search: [
    'Search for a client', 'ძიება კლიენტისთვის', 'Искать для клиента', 'Bir müşteri için ara', 'البحث لعميل', 'חיפוש עבור לקוח',
  ],
  broker_desk_clients_note: [
    "Search on a client's behalf, then give the search a private label. Labels are visible only to you.",
    'მოძებნეთ კლიენტის სახელით და ძიებას მიანიჭეთ პირადი იარლიყი. იარლიყები მხოლოდ თქვენთვის ჩანს.',
    'Ищите от имени клиента, затем дайте поиску личную метку. Метки видны только вам.',
    'Bir müşteri adına arama yapın, ardından aramaya özel bir etiket verin. Etiketleri yalnızca siz görürsünüz.',
    'ابحث نيابةً عن عميل، ثم امنح البحث تسمية خاصة. التسميات مرئية لك فقط.',
    'חפשו בשם לקוח, ואז תנו לחיפוש תווית פרטית. התוויות גלויות רק לכם.',
  ],
  broker_desk_clients_empty: [
    'No client searches yet.', 'კლიენტების ძიებები ჯერ არ არის.', 'Поисков для клиентов пока нет.', 'Henüz müşteri araması yok.', 'لا توجد عمليات بحث للعملاء بعد.', 'עדיין אין חיפושים עבור לקוחות.',
  ],
  broker_desk_search_untitled: [
    'Search', 'ძიება', 'Поиск', 'Arama', 'بحث', 'חיפוש',
  ],
  broker_desk_search_active: [
    'Active', 'აქტიური', 'Активен', 'Etkin', 'نشط', 'פעיל',
  ],
  broker_desk_search_paused: [
    'Paused', 'შეჩერებული', 'Приостановлен', 'Duraklatıldı', 'متوقف مؤقتًا', 'מושהה',
  ],
  broker_desk_client_label: [
    'Private client label', 'კლიენტის პირადი იარლიყი', 'Личная метка клиента', 'Özel müşteri etiketi', 'تسمية خاصة للعميل', 'תווית לקוח פרטית',
  ],
  broker_desk_save: [
    'Save', 'შენახვა', 'Сохранить', 'Kaydet', 'حفظ', 'שמירה',
  ],

  // ── Broker desk: Credits ────────────────────────────────────────────────
  broker_desk_credits_heading: [
    'Credits', 'კრედიტები', 'Кредиты', 'Krediler', 'الأرصدة', 'קרדיטים',
  ],
  broker_desk_credits_open: [
    'Credits and history', 'კრედიტები და ისტორია', 'Кредиты и история', 'Krediler ve geçmiş', 'الأرصدة والسجل', 'קרדיטים והיסטוריה',
  ],
  broker_desk_purchase_row: [
    'Directory listing: {{credits}} Credits, until {{date}}',
    'კატალოგში განთავსება: {{credits}} კრედიტი, {{date}}-მდე',
    'Размещение в каталоге: {{credits}} кредитов, до {{date}}',
    'Rehber kaydı: {{credits}} Kredi, {{date}} tarihine kadar',
    'الإدراج في الدليل: {{credits}} رصيدًا، حتى {{date}}',
    'רישום במדריך: {{credits}} קרדיטים, עד {{date}}',
  ],

  // ── Admin: broker verification ──────────────────────────────────────────
  admin_brokers_tab_verification: [
    'Verification', 'ვერიფიკაცია', 'Подтверждение', 'Doğrulama', 'التوثيق', 'אימות',
  ],
  admin_brokers_tab_review: [
    'Broker Review', 'ბროკერების განხილვა', 'Проверка брокеров', 'Emlakçı İncelemesi', 'مراجعة الوسطاء', 'בדיקת מתווכים',
  ],
  admin_broker_open: [
    'Details', 'დეტალები', 'Подробнее', 'Ayrıntılar', 'التفاصيل', 'פרטים',
  ],
  admin_broker_detail_title: [
    'Broker', 'ბროკერი', 'Брокер', 'Emlakçı', 'الوسيط', 'מתווך',
  ],
  admin_broker_detail_sub: [
    'Profile, verification, account and purchases. Every action is logged.',
    'პროფილი, ვერიფიკაცია, ანგარიში და შესყიდვები. ყველა მოქმედება აღირიცხება.',
    'Профиль, подтверждение, аккаунт и покупки. Каждое действие записывается в журнал.',
    'Profil, doğrulama, hesap ve satın alımlar. Her işlem kayıt altına alınır.',
    'الملف والتوثيق والحساب والمشتريات. يُسجَّل كل إجراء.',
    'פרופיל, אימות, חשבון ורכישות. כל פעולה נרשמת.',
  ],
  admin_broker_account_type: [
    'Account type', 'ანგარიშის ტიპი', 'Тип аккаунта', 'Hesap türü', 'نوع الحساب', 'סוג חשבון',
  ],
  admin_broker_verification: [
    'Verification', 'ვერიფიკაცია', 'Подтверждение', 'Doğrulama', 'التوثيق', 'אימות',
  ],
  admin_broker_properties: [
    'Properties', 'ქონება', 'Объекты', 'Mülkler', 'العقارات', 'נכסים',
  ],
  admin_broker_documents: [
    'Verification documents', 'ვერიფიკაციის დოკუმენტები', 'Документы для подтверждения', 'Doğrulama belgeleri', 'مستندات التوثيق', 'מסמכי אימות',
  ],
  admin_broker_no_documents: [
    'No documents uploaded.', 'დოკუმენტები არ არის ატვირთული.', 'Документы не загружены.', 'Yüklenmiş belge yok.', 'لم يتم رفع أي مستندات.', 'לא הועלו מסמכים.',
  ],
  admin_broker_open_document: [
    'Open', 'გახსნა', 'Открыть', 'Aç', 'فتح', 'פתיחה',
  ],
  admin_broker_note: [
    'Note to the broker', 'შენიშვნა ბროკერისთვის', 'Комментарий для брокера', 'Emlakçıya not', 'ملاحظة للوسيط', 'הערה למתווך',
  ],
  admin_broker_note_hint: [
    'A note is required to decline or suspend. The broker sees it.',
    'უარყოფისთვის ან შეჩერებისთვის შენიშვნა სავალდებულოა. ბროკერი მას დაინახავს.',
    'Для отказа или приостановки нужен комментарий. Брокер его увидит.',
    'Reddetmek veya askıya almak için not gereklidir. Emlakçı notu görür.',
    'الملاحظة مطلوبة للرفض أو التعليق. يراها الوسيط.',
    'נדרשת הערה כדי לדחות או להשהות. המתווך יראה אותה.',
  ],
  admin_broker_verify: [
    'Verify', 'ვერიფიცირება', 'Подтвердить', 'Doğrula', 'توثيق', 'אימות',
  ],
  admin_broker_reject_verification: [
    'Decline', 'უარყოფა', 'Отклонить', 'Reddet', 'رفض', 'דחייה',
  ],
  admin_broker_suspend_verification: [
    'Suspend verification', 'ვერიფიკაციის შეჩერება', 'Приостановить подтверждение', 'Doğrulamayı askıya al', 'تعليق التوثيق', 'השהיית אימות',
  ],
  admin_broker_reset_verification: [
    'Reset', 'გადატვირთვა', 'Сбросить', 'Sıfırla', 'إعادة تعيين', 'איפוס',
  ],
  admin_broker_account: [
    'Account', 'ანგარიში', 'Аккаунт', 'Hesap', 'الحساب', 'חשבון',
  ],
  admin_broker_suspended_since: [
    'Suspended since {{date}}', 'შეჩერებულია {{date}}-დან', 'Приостановлен с {{date}}', '{{date}} tarihinden beri askıda', 'معلَّق منذ {{date}}', 'מושהה מאז {{date}}',
  ],
  admin_broker_unsuspend: [
    'Lift suspension', 'შეჩერების მოხსნა', 'Снять приостановку', 'Askıyı kaldır', 'رفع التعليق', 'ביטול ההשהיה',
  ],
  admin_broker_suspend_reason: [
    'Reason for suspension', 'შეჩერების მიზეზი', 'Причина приостановки', 'Askıya alma nedeni', 'سبب التعليق', 'סיבת ההשהיה',
  ],
  admin_broker_suspend_account: [
    'Suspend account', 'ანგარიშის შეჩერება', 'Приостановить аккаунт', 'Hesabı askıya al', 'تعليق الحساب', 'השהיית החשבון',
  ],
  admin_broker_suspend_hint: [
    "A suspended account can't buy, unlock, launch campaigns or edit its profile. Contacts it already bought stay available.",
    'შეჩერებულ ანგარიშს არ შეუძლია შეძენა, კონტაქტების გახსნა, კამპანიების გაშვება ან პროფილის რედაქტირება. უკვე შეძენილი კონტაქტები ხელმისაწვდომი რჩება.',
    'Приостановленный аккаунт не может покупать, открывать контакты, запускать кампании или редактировать профиль. Уже купленные контакты остаются доступны.',
    'Askıya alınmış bir hesap satın alamaz, kilit açamaz, kampanya başlatamaz veya profilini düzenleyemez. Daha önce satın aldığı iletişimler erişilebilir kalır.',
    'لا يمكن للحساب المعلَّق الشراء أو فتح جهات الاتصال أو إطلاق الحملات أو تعديل ملفه. تبقى جهات الاتصال التي اشتراها متاحة.',
    'חשבון מושהה אינו יכול לרכוש, לפתוח אנשי קשר, להפעיל קמפיינים או לערוך את הפרופיל. אנשי קשר שכבר נרכשו נשארים זמינים.',
  ],
  admin_broker_purchases: [
    'Directory purchases', 'კატალოგის შესყიდვები', 'Покупки размещения в каталоге', 'Rehber satın alımları', 'مشتريات الدليل', 'רכישות במדריך',
  ],
  admin_broker_audit: [
    'Audit log', 'აუდიტის ჟურნალი', 'Журнал аудита', 'Denetim kaydı', 'سجل التدقيق', 'יומן ביקורת',
  ],
  admin_broker_verification_empty: [
    'Nothing in this state.', 'ამ სტატუსში არაფერია.', 'В этом статусе ничего нет.', 'Bu durumda kayıt yok.', 'لا شيء في هذه الحالة.', 'אין פריטים במצב הזה.',
  ],
  admin_broker_docs_count: [
    '{{count}} document(s)', '{{count}} დოკუმენტი', 'Документов: {{count}}', '{{count}} belge', 'المستندات: {{count}}', '{{count}} מסמכים',
  ],

  // ── Admin: Broker Review (classifier-identified broker posts) ───────────
  admin_broker_review_note: [
    "Posts the classifier identified as an agency or broker speaking. They never become demand. Accept records the firm's public identity in broker intelligence; Dismiss closes the item.",
    'პოსტები, რომლებიც კლასიფიკატორმა სააგენტოს ან ბროკერის ნაწერად ამოიცნო. ისინი მოთხოვნად არასოდეს იქცევა. „მიღება“ ფირმის საჯარო იდენტობას ბროკერების ანალიტიკაში აღრიცხავს; „უარყოფა“ ელემენტს ხურავს.',
    'Публикации, которые классификатор определил как написанные агентством или брокером. Они никогда не становятся спросом. «Принять» записывает публичные данные фирмы в аналитику брокеров; «Отклонить» закрывает элемент.',
    'Sınıflandırıcının bir acente veya emlakçı tarafından yazıldığını belirlediği gönderiler. Bunlar asla talebe dönüşmez. Kabul et, firmanın herkese açık kimliğini emlakçı istihbaratına kaydeder; Yok say öğeyi kapatır.',
    'منشورات حدّدها المصنِّف على أنها صادرة عن مكتب عقاري أو وسيط. لا تتحول أبدًا إلى طلب. «قبول» يسجّل الهوية العامة للشركة في معلومات الوسطاء؛ «تجاهل» يُغلق العنصر.',
    'פוסטים שהמסווג זיהה ככתובים על ידי סוכנות או מתווך. הם לעולם לא הופכים לביקוש. "אישור" רושם את הזהות הציבורית של המשרד במודיעין המתווכים; "דחייה" סוגרת את הפריט.',
  ],
  admin_broker_review_PENDING: [
    'Waiting', 'მოლოდინში', 'Ожидает', 'Bekliyor', 'بانتظار المراجعة', 'ממתין',
  ],
  admin_broker_review_ACCEPTED: [
    'Accepted', 'მიღებული', 'Принято', 'Kabul edildi', 'مقبول', 'אושר',
  ],
  admin_broker_review_DISMISSED: [
    'Dismissed', 'უარყოფილი', 'Отклонено', 'Yok sayıldı', 'تم التجاهل', 'נדחה',
  ],
  admin_broker_review_DUPLICATE: [
    'Already known', 'უკვე ცნობილი', 'Уже известно', 'Zaten biliniyor', 'معروف مسبقًا', 'כבר ידוע',
  ],
  admin_broker_review_accept: [
    'Accept', 'მიღება', 'Принять', 'Kabul et', 'قبول', 'אישור',
  ],
  admin_broker_review_dismiss: [
    'Dismiss', 'უარყოფა', 'Отклонить', 'Yok say', 'تجاهل', 'דחייה',
  ],
  admin_broker_review_duplicate: [
    'This firm was already known; its record was updated.',
    'ეს ფირმა უკვე ცნობილი იყო; მისი ჩანაწერი განახლდა.',
    'Эта фирма уже была известна; её запись обновлена.',
    'Bu firma zaten biliniyordu; kaydı güncellendi.',
    'كانت هذه الشركة معروفة مسبقًا؛ وتم تحديث سجلها.',
    'המשרד הזה כבר היה ידוע; הרשומה שלו עודכנה.',
  ],
  admin_broker_review_no_identity: [
    "The post has no public profile link, so it can't be recorded. Dismiss it instead.",
    'პოსტს საჯარო პროფილის ბმული არ აქვს, ამიტომ მისი აღრიცხვა შეუძლებელია. სანაცვლოდ უარყავით.',
    'У публикации нет ссылки на публичный профиль, поэтому её нельзя записать. Отклоните её.',
    'Gönderide herkese açık profil bağlantısı yok, bu yüzden kaydedilemez. Bunun yerine yok sayın.',
    'لا يحتوي المنشور على رابط لملف عام، لذا لا يمكن تسجيله. تجاهله بدلًا من ذلك.',
    'לפוסט אין קישור לפרופיל ציבורי, ולכן אי אפשר לרשום אותו. דחו אותו במקום זאת.',
  ],
  admin_broker_review_empty: [
    'Nothing to review.', 'განსახილველი არაფერია.', 'Нечего проверять.', 'İncelenecek bir şey yok.', 'لا شيء للمراجعة.', 'אין מה לבדוק.',
  ],
  admin_broker_review_source: [
    'Source', 'წყარო', 'Источник', 'Kaynak', 'المصدر', 'מקור',
  ],
};
