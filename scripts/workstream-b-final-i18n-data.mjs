// Copy for Workstream B's final hardening: Meta connection states and launch
// refusals, the forum schedule switch, the Telegram owner hand-off in Admin
// Discovery, the broker desk's last search and Meta entry, lead transitions,
// and the signup toasts. Order: [en, ka, ru, tr, ar, he].
export const WORKSTREAM_B_FINAL_STRINGS = {
  // ── Meta Ads ─────────────────────────────────────────────────────────────
  madsb_property_not_owned: [
    'That property is not in your account. Choose one of your own properties.',
    'ეს ქონება თქვენს ანგარიშში არ არის. აირჩიეთ თქვენი საკუთარი ქონება.',
    'Этот объект не принадлежит вашему аккаунту. Выберите свой объект.',
    'Bu mülk hesabınızda değil. Kendi mülklerinizden birini seçin.',
    'هذا العقار ليس في حسابك. اختر أحد عقاراتك.',
    'הנכס הזה אינו בחשבון שלכם. בחרו אחד מהנכסים שלכם.',
  ],
  madsb_launch_retry: [
    'That launch attempt was already used. Press Launch again to try once more — you will not be charged twice.',
    'ეს გაშვების მცდელობა უკვე გამოყენებულია. ხელახლა დააჭირეთ „გაშვებას“ — ორჯერ არ ჩამოგეჭრებათ.',
    'Эта попытка запуска уже использована. Нажмите «Запустить» ещё раз — дважды списания не будет.',
    'Bu başlatma denemesi zaten kullanıldı. Tekrar denemek için Başlat’a yeniden basın — iki kez ücret alınmaz.',
    'تم استخدام محاولة الإطلاق هذه بالفعل. اضغط «إطلاق» مرة أخرى للمحاولة — لن يُخصم منك مرتين.',
    'ניסיון ההשקה הזה כבר נוצל. לחצו שוב על "השקה" כדי לנסות שוב — לא תחויבו פעמיים.',
  ],
  madsb_money_meta_bills: [
    'Meta bills your ad account directly for the ad budget (up to {{amount}}).',
    'სარეკლამო ბიუჯეტს (მაქსიმუმ {{amount}}) Meta პირდაპირ თქვენს სარეკლამო ანგარიშს ჩამოაჭრის.',
    'Рекламный бюджет (до {{amount}}) Meta списывает напрямую с вашего рекламного аккаунта.',
    'Reklam bütçesini (en fazla {{amount}}) Meta doğrudan reklam hesabınızdan tahsil eder.',
    'تُحصّل Meta ميزانية الإعلان (حتى {{amount}}) مباشرةً من حسابك الإعلاني.',
    'את תקציב המודעות (עד {{amount}}) Meta מחייבת ישירות מחשבון המודעות שלכם.',
  ],
  madsb_health_connecting: [
    'Connecting…', 'მიმდინარეობს დაკავშირება…', 'Подключение…', 'Bağlanıyor…', 'جارٍ الاتصال…', 'מתחבר…',
  ],
  madsb_health_connecting_d: [
    'Finish the Facebook login in the window that opened. If you closed it, connect again.',
    'დაასრულეთ Facebook-ით შესვლა გახსნილ ფანჯარაში. თუ დახურეთ, ხელახლა დაკავშირდით.',
    'Завершите вход в Facebook в открывшемся окне. Если вы его закрыли, подключитесь снова.',
    'Açılan pencerede Facebook girişini tamamlayın. Kapattıysanız yeniden bağlanın.',
    'أكمل تسجيل الدخول إلى Facebook في النافذة التي فُتحت. إذا أغلقتها، فاتصل مرة أخرى.',
    'סיימו את ההתחברות ל-Facebook בחלון שנפתח. אם סגרתם אותו, התחברו שוב.',
  ],
  madsb_health_reconnect_required: [
    'Reconnect required', 'საჭიროა ხელახლა დაკავშირება', 'Нужно переподключиться', 'Yeniden bağlanma gerekli', 'إعادة الاتصال مطلوبة', 'נדרשת התחברות מחדש',
  ],
  madsb_health_reconnect_required_d: [
    'HOMATCH can no longer use the saved Facebook access. Reconnect to continue — your drafts are kept.',
    'HOMATCH-ს შენახული Facebook-ის წვდომის გამოყენება აღარ შეუძლია. გასაგრძელებლად ხელახლა დაკავშირდით — მონახაზები შენახულია.',
    'HOMATCH больше не может использовать сохранённый доступ к Facebook. Переподключитесь — черновики сохранены.',
    'HOMATCH kayıtlı Facebook erişimini artık kullanamıyor. Devam etmek için yeniden bağlanın — taslaklarınız saklanır.',
    'لم يعد بإمكان HOMATCH استخدام صلاحية Facebook المحفوظة. أعد الاتصال للمتابعة — مسوداتك محفوظة.',
    'HOMATCH כבר לא יכול להשתמש בגישה השמורה ל-Facebook. התחברו מחדש כדי להמשיך — הטיוטות נשמרות.',
  ],
  madsb_health_no_eligible_ad_account: [
    'No usable ad account', 'გამოსადეგი სარეკლამო ანგარიში არ არის', 'Нет доступного рекламного аккаунта', 'Kullanılabilir reklam hesabı yok', 'لا يوجد حساب إعلاني صالح', 'אין חשבון מודעות זמין',
  ],
  madsb_health_no_eligible_ad_account_d: [
    'Facebook is connected, but no ad account you can advertise from was shared. Create one in Meta Business settings or grant access, then refresh.',
    'Facebook დაკავშირებულია, მაგრამ სარეკლამო ანგარიში, საიდანაც რეკლამის გაშვება შეგიძლიათ, არ არის გაზიარებული. შექმენით ის Meta Business-ის პარამეტრებში ან მიეცით წვდომა, შემდეგ განაახლეთ.',
    'Facebook подключён, но нет рекламного аккаунта, с которого можно запускать рекламу. Создайте его в настройках Meta Business или выдайте доступ, затем обновите.',
    'Facebook bağlı, ancak reklam verebileceğiniz bir reklam hesabı paylaşılmadı. Meta Business ayarlarında oluşturun veya erişim verin, ardından yenileyin.',
    'تم ربط Facebook، لكن لم تتم مشاركة أي حساب إعلاني يمكنك الإعلان منه. أنشئ حسابًا في إعدادات Meta Business أو امنح الصلاحية، ثم حدّث.',
    'Facebook מחובר, אך לא שותף חשבון מודעות שאפשר לפרסם ממנו. צרו אחד בהגדרות Meta Business או תנו גישה, ואז רעננו.',
  ],
  madsb_connect_encryption_missing: [
    'Meta connection is not ready yet: HOMATCH has not finished its secure token setup. Please try again later.',
    'Meta-სთან კავშირი ჯერ მზად არ არის: HOMATCH-ს ტოკენის უსაფრთხო კონფიგურაცია ჯერ არ დაუსრულებია. სცადეთ მოგვიანებით.',
    'Подключение к Meta пока не готово: HOMATCH ещё не завершил защищённую настройку токенов. Попробуйте позже.',
    'Meta bağlantısı henüz hazır değil: HOMATCH güvenli token kurulumunu tamamlamadı. Lütfen daha sonra tekrar deneyin.',
    'اتصال Meta غير جاهز بعد: لم تُكمل HOMATCH إعداد الرموز الآمن. يُرجى المحاولة لاحقًا.',
    'החיבור ל-Meta עדיין לא מוכן: HOMATCH טרם השלים את ההגדרה המאובטחת של האסימונים. נסו שוב מאוחר יותר.',
  ],
  mads_check_property_owned: [
    'Property belongs to you', 'ქონება თქვენ გეკუთვნით', 'Объект принадлежит вам', 'Mülk size ait', 'العقار ملكك', 'הנכס שייך לכם',
  ],

  // ── Admin Discovery ─────────────────────────────────────────────────────
  admin_disc_sw_discovery_background_refresh_enabled: [
    'Telegram scheduled refresh', 'Telegram-ის დაგეგმილი განახლება', 'Плановое обновление Telegram', 'Telegram zamanlanmış yenileme', 'التحديث المجدول لـ Telegram', 'רענון מתוזמן של Telegram',
  ],
  admin_disc_sw_discovery_background_refresh_enabled_d: [
    'Read enabled Telegram communities every 15 minutes. Needs Telegram reading on and the worker configured.',
    'ჩართული Telegram-ის საზოგადოებების წაკითხვა ყოველ 15 წუთში. საჭიროა ჩართული Telegram-ის წაკითხვა და კონფიგურირებული worker.',
    'Читать включённые сообщества Telegram каждые 15 минут. Нужны включённое чтение Telegram и настроенный worker.',
    'Etkin Telegram topluluklarını 15 dakikada bir okur. Telegram okumanın açık ve worker’ın yapılandırılmış olması gerekir.',
    'قراءة مجتمعات Telegram المفعّلة كل 15 دقيقة. يتطلب تشغيل قراءة Telegram وتهيئة الـ worker.',
    'קריאת קהילות Telegram מופעלות כל 15 דקות. דורש קריאת Telegram פעילה ו-worker מוגדר.',
  ],
  admin_disc_sw_forum_schedule_enabled: [
    'Forum schedule', 'ფორუმების განრიგი', 'Расписание форумов', 'Forum zamanlaması', 'جدولة المنتديات', 'תזמון פורומים',
  ],
  admin_disc_sw_forum_schedule_enabled_d: [
    'Read the permitted forum boards every hour. Independent of Telegram; needs forum reading on.',
    'ნებადართული ფორუმების წაკითხვა ყოველ საათში. Telegram-ისგან დამოუკიდებელია; საჭიროა ჩართული ფორუმების წაკითხვა.',
    'Читать разрешённые форумы каждый час. Не зависит от Telegram; нужно включённое чтение форумов.',
    'İzin verilen forumları saatte bir okur. Telegram’dan bağımsızdır; forum okumanın açık olması gerekir.',
    'قراءة المنتديات المسموح بها كل ساعة. مستقل عن Telegram؛ يتطلب تشغيل قراءة المنتديات.',
    'קריאת הפורומים המותרים כל שעה. בלתי תלוי ב-Telegram; דורש קריאת פורומים פעילה.',
  ],
  admin_disc_tg_not_configured: [
    'Not configured', 'არ არის კონფიგურირებული', 'Не настроено', 'Yapılandırılmadı', 'غير مُهيّأ', 'לא מוגדר',
  ],
  admin_disc_tg_worker_off: [
    'Configured, switched off', 'კონფიგურირებულია, გამორთულია', 'Настроено, выключено', 'Yapılandırıldı, kapalı', 'مُهيّأ، مُعطّل', 'מוגדר, כבוי',
  ],
  admin_disc_tg_configured: [
    'Credentials', 'მონაცემები', 'Учётные данные', 'Kimlik bilgileri', 'بيانات الاعتماد', 'פרטי גישה',
  ],
  admin_disc_tg_enabled: [
    'Collection', 'შეგროვება', 'Сбор', 'Toplama', 'الجمع', 'איסוף',
  ],
  admin_disc_tg_unknown: [
    'Not tested yet', 'ჯერ არ შემოწმებულა', 'Ещё не проверено', 'Henüz test edilmedi', 'لم يُختبر بعد', 'טרם נבדק',
  ],
  admin_disc_tg_yes: [
    'Yes', 'კი', 'Да', 'Evet', 'نعم', 'כן',
  ],
  admin_disc_tg_no: [
    'No', 'არა', 'Нет', 'Hayır', 'لا', 'לא',
  ],
  admin_disc_tg_test: [
    'Test Telegram', 'Telegram-ის შემოწმება', 'Проверить Telegram', 'Telegram’ı test et', 'اختبار Telegram', 'בדיקת Telegram',
  ],
  admin_disc_tg_setup_title: [
    'Telegram is intentionally off until you add credentials',
    'Telegram განზრახ გამორთულია, სანამ მონაცემებს არ დაამატებთ',
    'Telegram намеренно выключен, пока вы не добавите учётные данные',
    'Kimlik bilgilerini ekleyene kadar Telegram bilerek kapalıdır',
    'Telegram مُعطّل عمدًا حتى تضيف بيانات الاعتماد',
    'Telegram כבוי בכוונה עד שתוסיפו פרטי גישה',
  ],
  admin_disc_tg_setup_d: [
    'HOMATCH never invents Telegram credentials. Forums and campaigns work without it. To turn Telegram on:',
    'HOMATCH Telegram-ის მონაცემებს არასდროს იგონებს. ფორუმები და კამპანიები მის გარეშეც მუშაობს. Telegram-ის ჩასართავად:',
    'HOMATCH никогда не придумывает учётные данные Telegram. Форумы и кампании работают без него. Чтобы включить Telegram:',
    'HOMATCH Telegram kimlik bilgilerini asla uydurmaz. Forumlar ve kampanyalar onsuz da çalışır. Telegram’ı açmak için:',
    'لا تختلق HOMATCH بيانات اعتماد Telegram أبدًا. تعمل المنتديات والحملات بدونه. لتشغيل Telegram:',
    'HOMATCH לעולם לא ממציא פרטי גישה ל-Telegram. פורומים וקמפיינים עובדים גם בלעדיו. כדי להפעיל את Telegram:',
  ],
  admin_disc_tg_step_credentials: [
    'Add the credentials to the Railway worker:', 'დაამატეთ მონაცემები Railway worker-ში:', 'Добавьте учётные данные в Railway worker:', 'Kimlik bilgilerini Railway worker’a ekleyin:', 'أضف بيانات الاعتماد إلى Railway worker:', 'הוסיפו את פרטי הגישה ל-Railway worker:',
  ],
  admin_disc_tg_step_enable: [
    'Enable the worker gateway:', 'ჩართეთ worker-ის კარიბჭე:', 'Включите шлюз worker:', 'Worker ağ geçidini etkinleştirin:', 'فعّل بوابة الـ worker:', 'הפעילו את שער ה-worker:',
  ],
  admin_disc_tg_step_health: [
    'Press "Test Telegram" and confirm it reports healthy.',
    'დააჭირეთ „Telegram-ის შემოწმებას“ და დარწმუნდით, რომ სტატუსი ჯანსაღია.',
    'Нажмите «Проверить Telegram» и убедитесь, что статус исправен.',
    '"Telegram’ı test et"e basın ve sağlıklı olduğunu doğrulayın.',
    'اضغط «اختبار Telegram» وتأكد من أنه يُظهر حالة سليمة.',
    'לחצו על "בדיקת Telegram" וודאו שהוא מדווח תקין.',
  ],
  admin_disc_tg_step_test: [
    'Switch on "Telegram reading" and run one campaign to test safely.',
    'ჩართეთ „Telegram-ის წაკითხვა“ და უსაფრთხო შესამოწმებლად გაუშვით ერთი კამპანია.',
    'Включите «Чтение Telegram» и запустите одну кампанию для безопасной проверки.',
    '"Telegram okuma"yı açın ve güvenli test için bir kampanya çalıştırın.',
    'شغّل «قراءة Telegram» وشغّل حملة واحدة للاختبار بأمان.',
    'הפעילו את "קריאת Telegram" והריצו קמפיין אחד לבדיקה בטוחה.',
  ],
  admin_disc_tg_step_schedule: [
    'Then switch on "Telegram scheduled refresh".',
    'შემდეგ ჩართეთ „Telegram-ის დაგეგმილი განახლება“.',
    'Затем включите «Плановое обновление Telegram».',
    'Ardından "Telegram zamanlanmış yenileme"yi açın.',
    'ثم شغّل «التحديث المجدول لـ Telegram».',
    'לאחר מכן הפעילו את "רענון מתוזמן של Telegram".',
  ],

  // ── Broker desk ─────────────────────────────────────────────────────────
  broker_desk_last_search: [
    'Last client search', 'ბოლო კლიენტების ძიება', 'Последний поиск клиентов', 'Son müşteri araması', 'آخر بحث عن عملاء', 'חיפוש לקוחות אחרון',
  ],
  broker_desk_no_search: [
    'No search yet', 'ძიება ჯერ არ ყოფილა', 'Поиска ещё не было', 'Henüz arama yok', 'لا يوجد بحث بعد', 'עדיין אין חיפוש',
  ],
  broker_desk_promote_meta: [
    'Promote on Facebook', 'Facebook-ზე რეკლამა', 'Реклама в Facebook', 'Facebook’ta tanıt', 'روّج على Facebook', 'קידום ב-Facebook',
  ],
  broker_err_invalid_transition: [
    'A lead cannot move to that stage from where it is now.',
    'ლიდი ამ ეტაპზე მიმდინარე მდგომარეობიდან ვერ გადავა.',
    'Лид не может перейти на этот этап из текущего.',
    'Potansiyel müşteri mevcut aşamadan bu aşamaya geçemez.',
    'لا يمكن نقل العميل المحتمل إلى هذه المرحلة من مرحلته الحالية.',
    'אי אפשר להעביר את הליד לשלב הזה מהשלב הנוכחי.',
  ],
  broker_err_match_closed: [
    'This match is closed and can no longer be updated.',
    'ეს დამთხვევა დახურულია და მისი განახლება აღარ შეიძლება.',
    'Это совпадение закрыто и больше не может обновляться.',
    'Bu eşleşme kapatıldı ve artık güncellenemez.',
    'هذه المطابقة مغلقة ولم يعد بالإمكان تحديثها.',
    'ההתאמה הזו סגורה ולא ניתן לעדכן אותה עוד.',
  ],

  // ── Signup ──────────────────────────────────────────────────────────────
  auth_password_min6: [
    'Password must be at least 6 characters.',
    'პაროლი უნდა შედგებოდეს მინიმუმ 6 სიმბოლოსგან.',
    'Пароль должен содержать не менее 6 символов.',
    'Şifre en az 6 karakter olmalıdır.',
    'يجب أن تتكون كلمة المرور من 6 أحرف على الأقل.',
    'הסיסמה חייבת להכיל לפחות 6 תווים.',
  ],
  auth_account_created: [
    'Account created! Welcome to HOMATCH.',
    'ანგარიში შეიქმნა! კეთილი იყოს თქვენი მობრძანება HOMATCH-ში.',
    'Аккаунт создан! Добро пожаловать в HOMATCH.',
    'Hesap oluşturuldu! HOMATCH’e hoş geldiniz.',
    'تم إنشاء الحساب! مرحبًا بك في HOMATCH.',
    'החשבון נוצר! ברוכים הבאים ל-HOMATCH.',
  ],
  // ── Admin Meta Ads ──────────────────────────────────────────────────────
  admin_mads_load_failed: [
    'Could not load this list.', 'სია ვერ ჩაიტვირთა.', 'Не удалось загрузить список.', 'Liste yüklenemedi.', 'تعذّر تحميل هذه القائمة.', 'לא ניתן לטעון את הרשימה.',
  ],
  admin_mads_action_failed: [
    'The action did not go through.', 'მოქმედება ვერ შესრულდა.', 'Действие не выполнено.', 'İşlem gerçekleşmedi.', 'لم يتم تنفيذ الإجراء.', 'הפעולה לא בוצעה.',
  ],
  admin_mads_saved: [
    'Saved.', 'შენახულია.', 'Сохранено.', 'Kaydedildi.', 'تم الحفظ.', 'נשמר.',
  ],
  admin_mads_adjust_required: [
    'A user, a non-zero amount and a reason are required.',
    'საჭიროა მომხმარებელი, ნულისგან განსხვავებული თანხა და მიზეზი.',
    'Нужны пользователь, ненулевая сумма и причина.',
    'Bir kullanıcı, sıfırdan farklı bir tutar ve bir gerekçe gereklidir.',
    'يلزم مستخدم ومبلغ غير صفري وسبب.',
    'נדרשים משתמש, סכום שאינו אפס וסיבה.',
  ],
  admin_mads_invalid_json: [
    'That value is not valid JSON.', 'ეს მნიშვნელობა სწორი JSON არ არის.', 'Это значение не является корректным JSON.', 'Bu değer geçerli bir JSON değil.', 'هذه القيمة ليست JSON صالحًا.', 'הערך הזה אינו JSON תקין.',
  ],
  madsb_goal_needs_form_permissions: [
    'Needs extra Meta permissions', 'საჭიროა Meta-ს დამატებითი ნებართვები', 'Нужны дополнительные разрешения Meta', 'Ek Meta izinleri gerekli', 'يتطلب أذونات Meta إضافية', 'נדרשות הרשאות Meta נוספות',
  ],
  madsb_instant_forms_permission: [
    'Instant Forms need the Meta permissions leads_retrieval, pages_manage_ads and pages_manage_metadata. Choose a website or message goal, or ask HOMATCH to enable Instant Forms.',
    'მყისიერ ფორმებს სჭირდება Meta-ს ნებართვები leads_retrieval, pages_manage_ads და pages_manage_metadata. აირჩიეთ ვებსაიტის ან შეტყობინების მიზანი, ან სთხოვეთ HOMATCH-ს მყისიერი ფორმების ჩართვა.',
    'Мгновенным формам нужны разрешения Meta leads_retrieval, pages_manage_ads и pages_manage_metadata. Выберите цель «сайт» или «сообщения» либо попросите HOMATCH включить мгновенные формы.',
    'Anlık Formlar için leads_retrieval, pages_manage_ads ve pages_manage_metadata Meta izinleri gerekir. Web sitesi veya mesaj hedefi seçin ya da HOMATCH’ten Anlık Formları etkinleştirmesini isteyin.',
    'تحتاج النماذج الفورية إلى أذونات Meta التالية: leads_retrieval وpages_manage_ads وpages_manage_metadata. اختر هدف موقع ويب أو رسائل، أو اطلب من HOMATCH تفعيل النماذج الفورية.',
    'טפסים מיידיים דורשים את הרשאות Meta leads_retrieval, ‏pages_manage_ads ו-pages_manage_metadata. בחרו מטרה של אתר או הודעות, או בקשו מ-HOMATCH להפעיל טפסים מיידיים.',
  ],
  // ── /brokers ─────────────────────────────────────────────────────────────
  broker_found_evidence: [
    'Seen on', 'ნანახია', 'Замечено на', 'Görüldüğü yer', 'شوهد على', 'נראה ב־',
  ],
  broker_directory_empty_compact: [
    'No broker or agency has a current paid Homatch listing yet.',
    'ჯერ არცერთ ბროკერს ან სააგენტოს არ აქვს მოქმედი ფასიანი Homatch-ის განცხადება.',
    'Пока ни у одного брокера или агентства нет действующего платного размещения в Homatch.',
    'Henüz hiçbir emlakçı veya ajansın geçerli ücretli Homatch listelemesi yok.',
    'لا يوجد حتى الآن وسيط أو وكالة لديهم إدراج مدفوع ساري في Homatch.',
    'עדיין לאף מתווך או סוכנות אין רישום בתשלום פעיל ב-Homatch.',
  ],
};
