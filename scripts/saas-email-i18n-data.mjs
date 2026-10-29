/* Email Marketing hidden (owner, 2026-10-29) and the lead "Copy email" flow, [en, ka, ru, tr, ar, he].
 * Georgian is the product's first language: plain, friendly, no dashes.
 *
 * SAAS_EMAIL_STRINGS are new keys. SAAS_EMAIL_RELABEL rewrites two existing keys: the historic
 * service key `email_campaigns` now governs SMS campaigns only (migration 20261207140000), so its
 * Admin name and description say SMS. */
export const SAAS_EMAIL_STRINGS = {
  svc_name_email_marketing: ['Email Marketing', 'ელფოსტის მარკეტინგი', 'Email-маркетинг', 'E-posta Pazarlaması', 'التسويق عبر البريد الإلكتروني', 'שיווק בדוא"ל'],
  svc_desc_email_marketing: [
    'Email campaigns, Email Studio, email plans, sending domains and the email inbox. While off it is hidden and nothing is sent or charged; campaigns, schedules and contacts are kept. Transactional email is not affected.',
    'ელფოსტის კამპანიები, Email Studio, ელფოსტის პაკეტები, გამგზავნი დომენები და ელფოსტის შემოსულები. გამორთვისას დამალულია, არაფერი იგზავნება და თანხაც არ ჩამოიჭრება. კამპანიები, განრიგები და კონტაქტები ინახება. სისტემურ წერილებზე ეს გავლენას არ ახდენს.',
    'Email-кампании, Email Studio, тарифы email, домены отправки и почтовый ящик. Пока выключено, раздел скрыт, ничего не отправляется и не списывается; кампании, расписания и контакты сохраняются. Служебные письма не затрагиваются.',
    'E-posta kampanyaları, Email Studio, e-posta paketleri, gönderim alan adları ve e-posta gelen kutusu. Kapalıyken gizlidir, hiçbir şey gönderilmez ve ücret alınmaz; kampanyalar, zamanlamalar ve kişiler saklanır. İşlemsel e-postalar etkilenmez.',
    'حملات البريد الإلكتروني وEmail Studio وباقات البريد ونطاقات الإرسال وصندوق الوارد. عند الإيقاف يكون مخفيًا ولا يُرسل شيء ولا تُخصم أي رسوم، وتُحفظ الحملات والجداول وجهات الاتصال. لا يتأثر البريد الخدمي.',
    'קמפיינים בדוא"ל, Email Studio, חבילות דוא"ל, דומיינים לשליחה ותיבת הדואר. כשהשירות כבוי הוא מוסתר, שום דבר לא נשלח ולא מחויב, והקמפיינים, התזמונים ואנשי הקשר נשמרים. דוא"ל מערכת אינו מושפע.',
  ],

  lead_copy_email: ['Copy email', 'ელფოსტის კოპირება', 'Скопировать email', 'E-postayı kopyala', 'نسخ البريد الإلكتروني', 'העתקת הדוא"ל'],
  lead_email_copied: ['Email copied', 'ელფოსტა დაკოპირდა', 'Email скопирован', 'E-posta kopyalandı', 'تم نسخ البريد الإلكتروني', 'הדוא"ל הועתק'],
  lead_copy_email_aria: ['Copy the email address {{email}}', 'ელფოსტის მისამართის კოპირება: {{email}}', 'Скопировать адрес {{email}}', '{{email}} e-posta adresini kopyala', 'نسخ عنوان البريد الإلكتروني {{email}}', 'העתקת כתובת הדוא"ל {{email}}'],
  lead_copy_email_failed: ['Could not copy. Select the address and copy it by hand.', 'კოპირება ვერ მოხერხდა. მონიშნეთ მისამართი და ხელით დააკოპირეთ.', 'Не удалось скопировать. Выделите адрес и скопируйте его вручную.', 'Kopyalanamadı. Adresi seçip elle kopyalayın.', 'تعذّر النسخ. حدّد العنوان وانسخه يدويًا.', 'ההעתקה נכשלה. סמנו את הכתובת והעתיקו אותה ידנית.'],
  mw_copy_hint: ['Open a contact to see their email, copy it and write to them from your own mailbox.', 'გახსენით კონტაქტი, დააკოპირეთ მისი ელფოსტა და მისწერეთ საკუთარი ელფოსტიდან.', 'Откройте контакт, скопируйте его email и напишите со своей почты.', 'Bir kişiyi açın, e-postasını kopyalayın ve kendi e-posta hesabınızdan yazın.', 'افتح جهة الاتصال وانسخ بريدها الإلكتروني واكتب لها من بريدك الخاص.', 'פתחו איש קשר, העתיקו את הדוא"ל שלו וכתבו לו מתיבת הדואר שלכם.'],
};

export const SAAS_EMAIL_RELABEL = {
  svc_name_email_campaigns: ['SMS campaigns', 'SMS კამპანიები', 'SMS-кампании', 'SMS kampanyaları', 'حملات الرسائل القصيرة', 'קמפיינים ב-SMS'],
  svc_desc_email_campaigns: [
    'SMS campaigns. Sending also needs its own SMS sending switch. Email campaigns and Email Studio are Email Marketing.',
    'SMS კამპანიები. გაგზავნას საკუთარი SMS გაგზავნის გადამრთველიც სჭირდება. ელფოსტის კამპანიები და Email Studio ელფოსტის მარკეტინგს ეკუთვნის.',
    'SMS-кампании. Для отправки нужен и собственный переключатель отправки SMS. Email-кампании и Email Studio относятся к Email-маркетингу.',
    'SMS kampanyaları. Gönderim için kendi SMS gönderim anahtarı da gerekir. E-posta kampanyaları ve Email Studio, E-posta Pazarlaması altındadır.',
    'حملات الرسائل القصيرة. يحتاج الإرسال أيضًا إلى مفتاح إرسال الرسائل القصيرة الخاص به. حملات البريد الإلكتروني وEmail Studio تتبع التسويق عبر البريد الإلكتروني.',
    'קמפיינים ב-SMS. השליחה דורשת גם את מתג שליחת ה-SMS שלה. קמפיינים בדוא"ל ו-Email Studio שייכים לשיווק בדוא"ל.',
  ],
};
