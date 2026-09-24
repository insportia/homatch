// HOMATCH Admin copy, part 2 — the AI & Communication control centre.
//
// Order is [en, ka, ru, tr, ar, he].
//
// THE TRANSLATION RULE HERE
//
// Translate the MEANING, not the jargon. "Pause before answering" is what
// `complete_silence_ms` does; a reader who is told "complete silence ms"
// has been given the variable name and no help. Provider names stay in
// Latin script in every language because that is what the reader will see
// in the provider's own dashboard.

export const ADMIN_STRINGS_2 = {
  /* ── AI & Communication overview ────────────────────────────────── */
  comms_admin_title: [
    'AI & communication', 'AI და კომუნიკაცია', 'ИИ и связь',
    'Yapay zekâ ve iletişim', 'الذكاء الاصطناعي والتواصل', 'בינה מלאכותית ותקשורת',
  ],
  comms_admin_subtitle: [
    'How Homatch talks to people — by voice, by phone, by email and on WhatsApp.',
    'როგორ ესაუბრება Homatch ადამიანებს — ხმით, ტელეფონით, ელფოსტითა და WhatsApp-ით.',
    'Как Homatch общается с людьми — голосом, по телефону, по email и в WhatsApp.',
    'Homatch insanlarla nasıl konuşur — sesle, telefonla, e-postayla ve WhatsApp ile.',
    'كيف يتحدث Homatch إلى الناس — بالصوت وبالهاتف وبالبريد وعبر واتساب.',
    'איך Homatch מדבר עם אנשים — בקול, בטלפון, באימייל ובוואטסאפ.',
  ],
  comms_card_ai_talk: [
    'AI TALK', 'AI TALK', 'AI TALK', 'AI TALK', 'AI TALK', 'AI TALK',
  ],
  comms_card_ai_talk_desc: [
    'Voice conversation inside the Homatch website.',
    'ხმოვანი საუბარი Homatch-ის საიტზე.',
    'Голосовой разговор внутри сайта Homatch.',
    'Homatch web sitesi içinde sesli konuşma.',
    'محادثة صوتية داخل موقع Homatch.',
    'שיחה קולית בתוך אתר Homatch.',
  ],
  comms_card_call_center_desc: [
    'AI that makes and answers phone calls.',
    'AI, რომელიც რეკავს და პასუხობს ზარებს.',
    'ИИ, который звонит и отвечает на звонки.',
    'Telefon araması yapan ve yanıtlayan yapay zekâ.',
    'ذكاء اصطناعي يُجري المكالمات ويردّ عليها.',
    'בינה מלאכותית שמתקשרת ועונה לשיחות.',
  ],
  comms_card_email_desc: [
    'Sending and receiving email.',
    'ელფოსტის გაგზავნა და მიღება.',
    'Отправка и получение почты.',
    'E-posta gönderme ve alma.',
    'إرسال البريد الإلكتروني واستقباله.',
    'שליחה וקבלה של אימייל.',
  ],
  comms_card_whatsapp_desc: [
    'Messaging people on WhatsApp.',
    'შეტყობინებები WhatsApp-ით.',
    'Сообщения людям в WhatsApp.',
    'WhatsApp üzerinden mesajlaşma.',
    'مراسلة الناس عبر واتساب.',
    'התכתבות עם אנשים בוואטסאפ.',
  ],
  comms_manage: [
    'Manage', 'მართვა', 'Управлять', 'Yönet', 'إدارة', 'ניהול',
  ],
  comms_fix_setup: [
    'Fix setup', 'დაყენების გასწორება', 'Исправить настройку',
    'Kurulumu düzelt', 'إصلاح الإعداد', 'תיקון ההגדרה',
  ],
  comms_current_voice: [
    'Voice', 'ხმა', 'Голос', 'Ses', 'الصوت', 'קול',
  ],
  comms_speed: [
    'Speed', 'სიჩქარე', 'Скорость', 'Hız', 'السرعة', 'מהירות',
  ],
  comms_provider: [
    'Provider', 'მომწოდებელი', 'Поставщик', 'Sağlayıcı', 'المزوّد', 'ספק',
  ],
  comms_not_loaded: [
    'Could not be read', 'ვერ წაიკითხა', 'Не удалось прочитать',
    'Okunamadı', 'تعذّرت القراءة', 'לא ניתן לקרוא',
  ],

  /* ── Voice ──────────────────────────────────────────────────────── */
  voice_page_title: [
    'AI voices', 'AI ხმები', 'Голоса ИИ', 'Yapay zekâ sesleri', 'أصوات الذكاء الاصطناعي', 'קולות AI',
  ],
  voice_page_subtitle: [
    'Choose how Homatch sounds in AI TALK and the AI Call Center.',
    'აირჩიეთ, როგორ ჟღერს Homatch AI TALK-სა და AI ქოლ-ცენტრში.',
    'Выберите, как Homatch звучит в AI TALK и ИИ колл-центре.',
    'Homatch’in AI TALK ve AI Çağrı Merkezi’nde nasıl duyulacağını seçin.',
    'اختر كيف يبدو صوت Homatch في AI TALK ومركز الاتصال.',
    'בחרו איך Homatch נשמע ב‑AI TALK ובמוקד הטלפוני.',
  ],
  voice_ai_talk_desc: [
    'The voice visitors hear when they speak with Homatch on the website.',
    'ხმა, რომელსაც ვიზიტორები ისმენენ, როცა საიტზე Homatch-ს ესაუბრებიან.',
    'Голос, который слышат посетители, разговаривая с Homatch на сайте.',
    'Ziyaretçilerin sitede Homatch ile konuşurken duyduğu ses.',
    'الصوت الذي يسمعه الزوّار عند التحدث مع Homatch على الموقع.',
    'הקול שמבקרים שומעים כשהם מדברים עם Homatch באתר.',
  ],
  voice_current: [
    'Current voice', 'მიმდინარე ხმა', 'Текущий голос',
    'Geçerli ses', 'الصوت الحالي', 'הקול הנוכחי',
  ],
  voice_id_label: [
    'Voice ID', 'ხმის ID', 'ID голоса', 'Ses kimliği', 'معرّف الصوت', 'מזהה קול',
  ],
  voice_id_help: [
    'Paste a Cartesia Voice ID. You can copy it from the Cartesia dashboard.',
    'ჩასვით Cartesia-ს ხმის ID. მისი კოპირება Cartesia-ს პანელიდან შეგიძლიათ.',
    'Вставьте Voice ID из Cartesia. Скопировать его можно в панели Cartesia.',
    'Cartesia Ses Kimliğini yapıştırın. Cartesia panelinden kopyalayabilirsiniz.',
    'الصق معرّف صوت Cartesia. يمكنك نسخه من لوحة Cartesia.',
    'הדביקו מזהה קול של Cartesia. אפשר להעתיק אותו מלוח הבקרה של Cartesia.',
  ],
  voice_id_invalid: [
    'That is not a Voice ID. It should look like 794f9389-aac1-45b6-b726-9d9369183238.',
    'ეს ხმის ID არ არის. ის ასე გამოიყურება: 794f9389-aac1-45b6-b726-9d9369183238.',
    'Это не Voice ID. Он выглядит так: 794f9389-aac1-45b6-b726-9d9369183238.',
    'Bu bir Ses Kimliği değil. Şuna benzemeli: 794f9389-aac1-45b6-b726-9d9369183238.',
    'هذا ليس معرّف صوت. يجب أن يبدو هكذا: 794f9389-aac1-45b6-b726-9d9369183238.',
    'זה לא מזהה קול. הוא אמור להיראות כך: 794f9389-aac1-45b6-b726-9d9369183238.',
  ],
  voice_speed_label: [
    'Voice speed', 'ხმის სიჩქარე', 'Скорость речи', 'Konuşma hızı', 'سرعة الصوت', 'מהירות הדיבור',
  ],
  voice_speed_help: [
    'How fast the AI speaks. 1.0 is the voice’s own pace.',
    'რამდენად სწრაფად საუბრობს AI. 1.0 არის ხმის საკუთარი ტემპი.',
    'Насколько быстро говорит ИИ. 1.0 — собственный темп голоса.',
    'Yapay zekânın ne kadar hızlı konuştuğu. 1.0 sesin kendi temposudur.',
    'مدى سرعة كلام الذكاء الاصطناعي. القيمة 1.0 هي إيقاع الصوت نفسه.',
    'כמה מהר הבינה המלאכותית מדברת. 1.0 הוא הקצב הטבעי של הקול.',
  ],
  voice_test: [
    'Test voice', 'ხმის მოსმენა', 'Прослушать голос',
    'Sesi dene', 'اختبار الصوت', 'האזנה לקול',
  ],
  voice_test_hint: [
    'Plays the Voice ID in the box above. Nothing is saved.',
    'უკრავს ზემოთ მითითებულ ხმის ID-ს. არაფერი ინახება.',
    'Проигрывает Voice ID из поля выше. Ничего не сохраняется.',
    'Yukarıdaki kutudaki Ses Kimliğini çalar. Hiçbir şey kaydedilmez.',
    'يشغّل معرّف الصوت الموجود في الحقل أعلاه. لا يُحفظ أي شيء.',
    'משמיע את מזהה הקול שבשדה למעלה. שום דבר לא נשמר.',
  ],
  voice_save: [
    'Save changes', 'შენახვა', 'Сохранить', 'Değişiklikleri kaydet', 'حفظ التغييرات', 'שמירת שינויים',
  ],
  voice_saved_toast: [
    'The AI TALK voice has changed.',
    'AI TALK-ის ხმა შეიცვალა.',
    'Голос AI TALK изменён.',
    'AI TALK sesi değişti.',
    'تم تغيير صوت AI TALK.',
    'הקול של AI TALK הוחלף.',
  ],
  voice_save_failed: [
    'The voice was not saved.', 'ხმა არ შენახულა.', 'Голос не сохранён.',
    'Ses kaydedilmedi.', 'لم يُحفظ الصوت.', 'הקול לא נשמר.',
  ],
  voice_test_failed: [
    'The voice could not be played.', 'ხმის დაკვრა ვერ მოხერხდა.', 'Не удалось воспроизвести голос.',
    'Ses çalınamadı.', 'تعذّر تشغيل الصوت.', 'לא ניתן היה להשמיע את הקול.',
  ],
  voice_unsaved: [
    'Not saved yet', 'ჯერ არ შენახულა', 'Ещё не сохранено',
    'Henüz kaydedilmedi', 'لم يُحفظ بعد', 'עדיין לא נשמר',
  ],
  voice_restore_previous: [
    'Restore previous voice', 'წინა ხმის დაბრუნება', 'Вернуть прежний голос',
    'Önceki sesi geri al', 'استعادة الصوت السابق', 'שחזור הקול הקודם',
  ],
  voice_cc_desc: [
    'Each calling agent speaks with its own voice, set on the agent itself.',
    'თითოეული სატელეფონო აგენტი საკუთარი ხმით საუბრობს, რომელიც თავად აგენტზეა მითითებული.',
    'Каждый телефонный агент говорит своим голосом, заданным на самом агенте.',
    'Her arama temsilcisi, kendi üzerinde tanımlı sesiyle konuşur.',
    'يتحدث كل وكيل اتصال بصوته الخاص المحدَّد في الوكيل نفسه.',
    'כל סוכן שיחות מדבר בקול משלו, שנקבע בסוכן עצמו.',
  ],
  voice_cc_not_shared: [
    'This is a different setting from the AI TALK voice above. Changing one does not change the other.',
    'ეს ზემოთ მოცემული AI TALK-ის ხმისგან განსხვავებული პარამეტრია. ერთის შეცვლა მეორეს არ ცვლის.',
    'Это другая настройка, не голос AI TALK выше. Изменение одной не меняет другую.',
    'Bu, yukarıdaki AI TALK sesinden farklı bir ayardır. Birini değiştirmek diğerini değiştirmez.',
    'هذا إعداد مختلف عن صوت AI TALK أعلاه. تغيير أحدهما لا يغيّر الآخر.',
    'זו הגדרה שונה מהקול של AI TALK שלמעלה. שינוי אחת אינו משנה את השנייה.',
  ],
  voice_cc_open_agents: [
    'Open calling agents', 'სატელეფონო აგენტების გახსნა', 'Открыть телефонных агентов',
    'Arama temsilcilerini aç', 'فتح وكلاء الاتصال', 'פתיחת סוכני השיחות',
  ],

  /* ── Conversation behaviour, in plain words ─────────────────────── */
  voice_behaviour_title: [
    'Conversation behaviour', 'საუბრის ქცევა', 'Поведение в разговоре',
    'Konuşma davranışı', 'سلوك المحادثة', 'התנהגות בשיחה',
  ],
  voice_pause_label: [
    'Pause before answering', 'პაუზა პასუხამდე', 'Пауза перед ответом',
    'Yanıttan önceki bekleme', 'التوقّف قبل الرد', 'השהיה לפני מענה',
  ],
  voice_pause_help: [
    'How long Homatch waits after the person stops speaking.',
    'რამდენ ხანს იცდის Homatch მას შემდეგ, რაც ადამიანი ლაპარაკს შეწყვეტს.',
    'Сколько Homatch ждёт после того, как человек замолчал.',
    'Kişi konuşmayı bıraktıktan sonra Homatch ne kadar bekler.',
    'كم ينتظر Homatch بعد أن يتوقف الشخص عن الكلام.',
    'כמה זמן Homatch ממתין אחרי שהאדם מפסיק לדבר.',
  ],
  voice_interrupt_label: [
    'Allow interruptions', 'შეწყვეტის დაშვება', 'Разрешить перебивать',
    'Sözünün kesilmesine izin ver', 'السماح بالمقاطعة', 'לאפשר הפרעה',
  ],
  voice_interrupt_help: [
    'Lets the person interrupt the AI while it is speaking.',
    'აძლევს ადამიანს საშუალებას, შეაწყვეტინოს AI-ს ლაპარაკის დროს.',
    'Позволяет человеку перебить ИИ во время речи.',
    'Kişinin, yapay zekâ konuşurken sözünü kesmesine izin verir.',
    'يتيح للشخص مقاطعة الذكاء الاصطناعي أثناء حديثه.',
    'מאפשר לאדם להפריע לבינה המלאכותית בזמן שהיא מדברת.',
  ],
  voice_maxcall_label: [
    'Maximum call length', 'ზარის მაქსიმალური ხანგრძლივობა', 'Максимальная длительность звонка',
    'En uzun çağrı süresi', 'أقصى مدة للمكالمة', 'אורך שיחה מרבי',
  ],
  voice_maxcall_help: [
    'Automatically ends very long calls after this time.',
    'ავტომატურად წყვეტს ძალიან გრძელ ზარებს ამ დროის შემდეგ.',
    'Автоматически завершает очень длинные звонки по истечении этого времени.',
    'Çok uzun çağrıları bu süreden sonra otomatik sonlandırır.',
    'ينهي المكالمات الطويلة جداً تلقائياً بعد هذه المدة.',
    'מסיים אוטומטית שיחות ארוכות מאוד לאחר הזמן הזה.',
  ],
  voice_recording_label: [
    'Record calls', 'ზარების ჩაწერა', 'Запись звонков',
    'Çağrıları kaydet', 'تسجيل المكالمات', 'הקלטת שיחות',
  ],
  voice_recording_help: [
    'Records AI Call Center calls where the law allows it.',
    'წერს AI ქოლ-ცენტრის ზარებს იქ, სადაც კანონი ამის უფლებას იძლევა.',
    'Записывает звонки ИИ колл-центра там, где это разрешено законом.',
    'Yasaların izin verdiği yerlerde AI Çağrı Merkezi çağrılarını kaydeder.',
    'يسجّل مكالمات مركز الاتصال حيث يسمح القانون بذلك.',
    'מקליט שיחות של המוקד הטלפוני במקומות שהחוק מתיר.',
  ],
  voice_seconds_short: [
    '{{n}} s', '{{n}} წმ', '{{n}} с', '{{n}} sn', '{{n}} ث', '{{n}} שנ׳',
  ],
  voice_minutes_short: [
    '{{n}} min', '{{n}} წთ', '{{n}} мин', '{{n}} dk', '{{n}} د', '{{n}} דק׳',
  ],
};
