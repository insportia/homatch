/*
 * Copy for the Verify gallery's v7 photo dating (owner, 2026-10-11):
 * the photo tab is "უახლესი ფოტოები" (never "დღეს"), its header says whether
 * the photos are the newest VERIFIED ones or only the last available, every
 * photograph says whether its capture date is verified or only the date of
 * the material it was filed in, and a fresh photo carries its source,
 * author, license, capture date and, separately, publication/retrieval date.
 *
 * Georgian is owner-approved, verbatim (V7_SHARED). {{date}} of
 * vg_archival_note is phrased per language by documentDatePhrase()
 * (KA instrumental: "2025 წლის 14 აპრილით").
 *
 * Order is en, ka, ru, tr, ar, he (LANGS in lib/i18nSplice.mjs).
 * Placeholders survive in every locale. No em dashes.
 */
export const VERIFY_V7_GALLERY_STRINGS = {
  /* ── the photo tab ── */
  vev_tab_latest_photos: ['Latest photos', 'უახლესი ფოტოები', 'Последние фото', 'En yeni fotoğraflar', 'أحدث الصور', 'התמונות העדכניות'],
  vg_why_latest_photos: [
    'The newest photographs we found. Check each date: a photo shows the building when it was taken, not necessarily as it is now.',
    'ეს ჩვენ მიერ მოძიებული უახლესი ფოტოებია. ყურადღება მიაქციეთ თითოეულის თარიღს: ფოტო შენობას გადაღების მომენტში აჩვენებს და არა აუცილებლად მის ამჟამინდელ მდგომარეობას.',
    'Самые новые найденные нами фотографии. Обращайте внимание на дату: фото показывает здание на момент съёмки, а не обязательно его нынешнее состояние.',
    'Bulduğumuz en yeni fotoğraflar. Her birinin tarihine dikkat edin: fotoğraf binayı çekildiği andaki hâliyle gösterir, şu anki hâliyle değil.',
    'أحدث الصور التي عثرنا عليها. انتبه إلى تاريخ كل صورة: فالصورة تُظهر المبنى لحظة التقاطها، وليس بالضرورة حالته الآن.',
    'התמונות העדכניות ביותר שמצאנו. שימו לב לתאריך של כל אחת: תמונה מציגה את הבניין ברגע הצילום, ולא בהכרח את מצבו כעת.',
  ],

  /* ── the tab header: newest verified photos ── */
  vg_photos_fresh_title: ['Newest photos of the building', 'შენობის უახლესი ფოტოები', 'Новейшие фотографии здания', 'Binanın en yeni fotoğrafları', 'أحدث صور المبنى', 'התמונות העדכניות ביותר של הבניין'],
  vg_photos_fresh_body: [
    'These photos show the most recent condition of the building that we could find. Each image states its source and its verified date.',
    'ეს ფოტოები ასახავს შენობის ჩვენ მიერ მოძიებულ უახლეს მდგომარეობას. თითოეულ გამოსახულებას მითითებული აქვს წყარო და დადასტურებული თარიღი.',
    'Эти фотографии отражают самое новое состояние здания, которое нам удалось найти. У каждого изображения указаны источник и подтверждённая дата.',
    'Bu fotoğraflar, binanın bulabildiğimiz en güncel durumunu gösterir. Her görselin kaynağı ve doğrulanmış tarihi belirtilmiştir.',
    'تُظهر هذه الصور أحدث حالة للمبنى تمكّنا من العثور عليها. ولكل صورة مصدرها وتاريخها المؤكَّد.',
    'תמונות אלה מציגות את המצב העדכני ביותר של הבניין שהצלחנו למצוא. לכל תמונה מצוינים המקור והתאריך המאומת.',
  ],

  /* ── the tab header: only older photos ── */
  vg_photos_last_title: ['Last available photo', 'ბოლო ხელმისაწვდომი ფოტო', 'Последнее доступное фото', 'Erişilebilen son fotoğraf', 'آخر صورة متاحة', 'התמונה האחרונה הזמינה'],
  vg_photos_last_body: [
    'We could not find a newer, verified photo of the building at this stage. So we show the last available image, which may no longer reflect its current condition.',
    'შენობის უფრო ახალი, დადასტურებული ფოტო ამ ეტაპზე ვერ მოვიძიეთ. ამიტომ გაჩვენებთ ბოლო ხელმისაწვდომ გამოსახულებას, რომელიც შესაძლოა დღევანდელ მდგომარეობას აღარ ასახავდეს.',
    'Более новое подтверждённое фото здания на данном этапе найти не удалось. Поэтому мы показываем последнее доступное изображение, которое может уже не отражать нынешнее состояние.',
    'Şu aşamada binanın daha yeni ve doğrulanmış bir fotoğrafını bulamadık. Bu yüzden, bugünkü durumu artık yansıtmayabilecek erişilebilen son görseli gösteriyoruz.',
    'لم نتمكن في هذه المرحلة من العثور على صورة أحدث ومؤكَّدة للمبنى. لذلك نعرض آخر صورة متاحة، وقد لا تعكس حالته الراهنة.',
    'בשלב זה לא מצאנו תמונה חדשה ומאומתת יותר של הבניין. לכן אנו מציגים את התמונה האחרונה הזמינה, שייתכן שכבר אינה משקפת את מצבו הנוכחי.',
  ],
  vg_photos_badge: [
    'Newest photo found | {{year}}',
    'უახლესი მოძიებული ფოტო | {{year}} წელი',
    'Самое новое найденное фото | {{year}} год',
    'Bulunan en yeni fotoğraf | {{year}}',
    'أحدث صورة عُثر عليها | {{year}}',
    'התמונה העדכנית ביותר שנמצאה | {{year}}',
  ],
  vg_photos_badge_note: [
    'This is one of the newest photos we found, but it dates from {{year}} and may no longer fully reflect the building as it is today.',
    'ეს არის ჩვენ მიერ მოძიებული ერთ-ერთი უახლესი ფოტო, თუმცა იგი {{year}} წლით თარიღდება და შესაძლოა შენობის დღევანდელ მდგომარეობას სრულად აღარ ასახავდეს.',
    'Это одно из самых новых найденных нами фото, однако оно датируется {{year}} годом и может уже не полностью отражать нынешнее состояние здания.',
    'Bu, bulduğumuz en yeni fotoğraflardan biri; ancak {{year}} tarihlidir ve binanın bugünkü durumunu artık tam olarak yansıtmayabilir.',
    'هذه إحدى أحدث الصور التي عثرنا عليها، لكنها تعود إلى عام {{year}} وقد لا تعكس حالة المبنى اليوم بالكامل.',
    'זוהי אחת התמונות העדכניות ביותר שמצאנו, אך היא משנת {{year}} וייתכן שכבר אינה משקפת במלואו את מצב הבניין כיום.',
  ],

  /* ── a photo dated only by the material it was filed in ── */
  vg_archival_photo: [
    'Archival photo, {{year}}',
    '{{year}} წლის საარქივო ფოტო',
    'Архивное фото {{year}} года',
    '{{year}} tarihli arşiv fotoğrafı',
    'صورة أرشيفية من عام {{year}}',
    'תמונת ארכיון משנת {{year}}',
  ],
  vg_archival_note: [
    'This photo appears in official materials dated {{date}}. The exact date it was taken still has to be confirmed separately. It shows the building as documented at that time, not necessarily as it is today.',
    'ეს ფოტო წარმოდგენილია ოფიციალურ მასალებში, რომლებიც {{date}} თარიღდება. ფოტოს გადაღების ზუსტი თარიღი ცალკე უნდა დადასტურდეს. იგი გვიჩვენებს შენობის იმ პერიოდში დოკუმენტირებულ მდგომარეობას და არა აუცილებლად დღევანდელ სურათს.',
    'Это фото представлено в официальных материалах, датированных {{date}}. Точную дату съёмки нужно подтвердить отдельно. Фото показывает состояние здания, задокументированное в тот период, а не обязательно сегодняшнее.',
    'Bu fotoğraf {{date}} tarihli resmî belgelerde yer alıyor. Çekildiği kesin tarih ayrıca doğrulanmalıdır. Binanın o dönemde belgelenmiş hâlini gösterir, bugünkü hâlini değil.',
    'تظهر هذه الصورة في مواد رسمية مؤرَّخة في {{date}}. ويجب التحقق من تاريخ التقاطها الدقيق بشكل منفصل. وهي تُظهر حالة المبنى الموثَّقة في تلك الفترة، وليس بالضرورة حالته اليوم.',
    'תמונה זו מופיעה בחומרים רשמיים מתאריך {{date}}. את מועד הצילום המדויק יש לאמת בנפרד. היא מציגה את מצב הבניין כפי שתועד באותה תקופה, ולא בהכרח את מצבו כיום.',
  ],

  /* ── capture date unknown (date line of every such card) ── */
  vg_capture_unknown_title: ['Date the photo was taken is unknown', 'ფოტოს გადაღების თარიღი უცნობია', 'Дата съёмки неизвестна', 'Fotoğrafın çekildiği tarih bilinmiyor', 'تاريخ التقاط الصورة غير معروف', 'מועד צילום התמונה אינו ידוע'],
  vg_capture_unknown_body: [
    'The image was found in official materials, but the exact date it was taken could not be confirmed.',
    'გამოსახულება მოძიებულია ოფიციალურ მასალებში, თუმცა მისი გადაღების ზუსტი თარიღი ვერ დადასტურდა.',
    'Изображение найдено в официальных материалах, однако точную дату съёмки подтвердить не удалось.',
    'Görsel resmî belgelerde bulundu, ancak çekildiği kesin tarih doğrulanamadı.',
    'عُثر على الصورة في مواد رسمية، لكن تعذّر التحقق من تاريخ التقاطها الدقيق.',
    'התמונה נמצאה בחומרים רשמיים, אך לא ניתן היה לאמת את מועד הצילום המדויק.',
  ],
  vg_undated: ['date unknown', 'თარიღი უცნობია', 'дата неизвестна', 'tarih bilinmiyor', 'التاريخ غير معروف', 'התאריך אינו ידוע'],

  /* ── a fresh photo's credit ── */
  vg_fresh_source: ['Source', 'წყარო', 'Источник', 'Kaynak', 'المصدر', 'מקור'],
  vg_fresh_author: ['Author', 'ავტორი', 'Автор', 'Yazar', 'المؤلف', 'יוצר'],
  vg_fresh_license: ['License', 'ლიცენზია', 'Лицензия', 'Lisans', 'الترخيص', 'רישיון'],
  vg_fresh_captured: ['Taken on', 'გადაღების თარიღი', 'Дата съёмки', 'Çekim tarihi', 'تاريخ الالتقاط', 'מועד הצילום'],
  vg_fresh_published: ['Published on', 'გამოქვეყნების თარიღი', 'Дата публикации', 'Yayın tarihi', 'تاريخ النشر', 'מועד הפרסום'],
  vg_fresh_retrieved: ['Retrieved on', 'მოძიების თარიღი', 'Дата получения', 'Erişim tarihi', 'تاريخ الاسترجاع', 'מועד האחזור'],
  vg_src_wikimedia_commons: ['Wikimedia Commons', 'ვიკიმედია კომონსი', 'Викисклад (Wikimedia Commons)', 'Wikimedia Commons arşivi', 'ويكيميديا كومنز', 'ויקישיתוף'],
  vg_src_mapillary: ['Mapillary street-level imagery', 'Mapillary, ქუჩის ფოტოები', 'Mapillary, уличные фото', 'Mapillary sokak fotoğrafları', 'Mapillary، صور الشوارع', 'Mapillary, צילומי רחוב'],
  vg_src_developer_site: ['Developer website', 'დეველოპერის ვებგვერდი', 'Сайт застройщика', 'Geliştirici web sitesi', 'موقع المطوّر', 'אתר היזם'],
  vg_src_other: ['Open web source', 'ღია ვებ წყარო', 'Открытый веб-источник', 'Açık web kaynağı', 'مصدر ويب مفتوح', 'מקור פתוח ברשת'],
};
