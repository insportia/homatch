// HOMATCH Design Studio — the walkthrough's secondary actions folded into one
// "More" menu (WalkthroughOverlay), so the walk keeps the screen.
//
// Order is [en, ka, ru, tr, ar, he].

export const DS_STRINGS_37 = {
  ds_walk_more: ['More', 'მეტი', 'Ещё', 'Daha fazla', 'المزيد', 'עוד'],
  // A tour stopped by its quality gate (walkthrough.ts NOT_PLAUSIBLE / NOT_WALKABLE / NOT_FAITHFUL): said plainly.
  dsx_walk_failed_quality: ['We could not furnish this home convincingly enough to walk through it — the furniture would block the way or stand where no one would put it. We did not publish a tour that would show it badly.', 'ამ ბინის დამაჯერებლად მოწყობა ვერ მოხერხდა, ავეჯი გზას გადაკეტავდა ან იქ იდგებოდა, სადაც არავინ დადგამდა. ცუდად ნაჩვენები ტური არ გამოვაქვეყნეთ.', 'Не удалось убедительно обставить этот дом для прогулки — мебель перекрыла бы проход или стояла бы там, где её никто не поставит. Мы не стали публиковать прогулку, которая показала бы его плохо.', 'Bu evi içinde gezilecek kadar inandırıcı biçimde döşeyemedik — mobilyalar yolu kapatacak ya da kimsenin koymayacağı yerlerde duracaktı. Evi kötü gösterecek bir gezinti yayımlamadık.', 'لم نتمكن من تأثيث هذا المنزل بشكل مقنع يكفي للتجول فيه — كان الأثاث سيسد الطريق أو يقف حيث لا يضعه أحد. لم ننشر جولة قد تعرضه بشكل سيئ.', 'לא הצלחנו לרהט את הבית הזה באופן משכנע מספיק כדי לסייר בו — הרהיטים היו חוסמים את הדרך או עומדים במקום שאיש לא היה מציב אותם. לא פרסמנו סיור שהיה מציג אותו רע.'],
  // Desktop mouse-look (SceneController endGesture): a double click captures the mouse, a double click gives it back.
  ds_ctrl_dbl_to_look: ['Double-click to look around with the mouse', 'ორჯერ სწრაფად დააწკაპუნეთ, მაუსით მიმოხედვა', 'Дважды щёлкните, чтобы осматриваться мышью', 'Fareyle etrafa bakmak için çift tıklayın', 'انقر نقرًا مزدوجًا للنظر حولك بالفأرة', 'לחצו פעמיים כדי להסתכל סביב עם העכבר'],
  ds_ctrl_dbl_to_release: ['Double-click (or Esc) to get the mouse pointer back', 'ორჯერ სწრაფად დააწკაპუნეთ (ან Esc), მაუსის ისრის დაბრუნება', 'Дважды щёлкните (или Esc), чтобы вернуть указатель мыши', 'Fare imlecini geri almak için çift tıklayın (veya Esc)', 'انقر نقرًا مزدوجًا (أو Esc) لاستعادة مؤشر الفأرة', 'לחצו פעמיים (או Esc) כדי להחזיר את סמן העכבר'],
  ds_ctrl_dbl_click: ['Double-click', 'ორჯერ დაწკაპუნება', 'Двойной щелчок', 'Çift tıklama', 'نقر مزدوج', 'לחיצה כפולה'],
  ds_ctrl_dbl_toggle: [
    'Mouse look on / off',
    'მაუსით მიმოხედვა: ჩართვა / გამორთვა',
    'Обзор мышью: вкл. / выкл.',
    'Fareyle bakış: aç / kapat',
    'النظر بالفأرة: تشغيل / إيقاف',
    'מבט בעכבר: הפעלה / כיבוי',
  ],
  // Walk sounds (walkSounds.ts): the visitor may turn them off.
  ds_set_sound: ['Sounds', 'ხმები', 'Звуки', 'Sesler', 'الأصوات', 'צלילים'],
  // Seated or lying: the same press gets you up (SceneController performAimed).
  ds_walk_stand_click: ['Click or press E to stand up', 'ადგომა: დააწკაპუნეთ ან დააჭირეთ E-ს', 'Щёлкните или нажмите E, чтобы встать', 'Kalkmak için tıklayın veya E’ye basın', 'انقر أو اضغط E للنهوض', 'לחצו או הקישו E כדי לקום'],
  ds_walk_stand_tap: ['Tap to stand up', 'ადგომა: შეეხეთ ეკრანს', 'Коснитесь, чтобы встать', 'Kalkmak için dokunun', 'المس للنهوض', 'געו כדי לקום'],
  // The walk's plan panel: shown and hidden by a labelled button, never an icon alone.
  ds_walk_plan_show: ['Show plan', 'გეგმის ჩვენება', 'Показать план', 'Planı göster', 'إظهار المخطط', 'הצג תוכנית'],
  ds_walk_plan_hide: ['Hide plan', 'გეგმის დამალვა', 'Скрыть план', 'Planı gizle', 'إخفاء المخطط', 'הסתר תוכנית'],
  // The walk's feature dock (WalkthroughOverlay FeatureDock): what each does, in a line.
  ds_feat_time_help: [
    'See the home in morning light, at sunset, in the evening or at night.',
    'ნახეთ ბინა დილის შუქზე, მზის ჩასვლისას, საღამოს ან ღამით.',
    'Посмотрите на дом при утреннем свете, на закате, вечером или ночью.',
    'Evi sabah ışığında, gün batımında, akşam ya da gece görün.',
    'شاهد المنزل في ضوء الصباح أو عند الغروب أو في المساء أو ليلًا.',
    'ראו את הבית באור בוקר, בשקיעה, בערב או בלילה.',
  ],
  ds_feat_live_help: ['Pick a moment — making coffee, cooking, an evening in — and watch it play out in this home.', 'აირჩიეთ მომენტი: ყავის მომზადება, სადილი, საღამო სახლში, და ნახეთ, როგორ გამოიყურება ეს ამ ბინაში.', 'Выберите момент — кофе, готовка, вечер дома — и посмотрите, как он проходит в этом доме.', 'Bir an seçin — kahve yapmak, yemek pişirmek, evde bir akşam — ve bu evde nasıl geçtiğini izleyin.', 'اختر لحظة — إعداد القهوة أو الطهي أو أمسية في المنزل — وشاهدها تحدث في هذا المنزل.', 'בחרו רגע — הכנת קפה, בישול, ערב בבית — וצפו בו קורה בבית הזה.'],
  ds_feat_share_help: ['Send a link to this walkthrough to family, a buyer or an agent — they walk it in their browser.', 'გაუგზავნეთ ამ ტურის ბმული ოჯახს, მყიდველს ან აგენტს, ის ბრაუზერში გაივლის ბინას.', 'Отправьте ссылку на эту прогулку семье, покупателю или агенту — они пройдут её в браузере.', 'Bu gezintinin bağlantısını ailenize, bir alıcıya ya da emlakçıya gönderin — tarayıcılarında gezsinler.', 'أرسل رابط هذه الجولة إلى العائلة أو مشترٍ أو وسيط — يتجولون فيها من متصفحهم.', 'שלחו קישור לסיור הזה למשפחה, לקונה או לסוכן — הם יסיירו בו בדפדפן.'],
};
