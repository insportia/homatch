/*
 * Copy for the Verify gallery's VISUAL EVOLUTION (owner, 2026-10-11): the
 * five tabs (დღეს / ბოლო პროექტი / ცვლილებები / ძველი ვერსიები / ნახაზები),
 * the mandatory historical label of a verified old render (owner-approved
 * Georgian, verbatim), the "no newer render" empty state (verbatim), the
 * file-name date phrase and the card's field labels.
 *
 * Order is en, ka, ru, tr, ar, he (LANGS in lib/i18nSplice.mjs).
 * Placeholders ({{year}}, {{date}}) survive in every locale. No em dashes.
 */
export const VERIFY_V6_VISUALS_STRINGS = {
  /* ── tabs ── */
  vev_tab_today: ['Today', 'დღეს', 'Сегодня', 'Bugün', 'اليوم', 'היום'],
  vev_tab_latest: ['Latest design', 'ბოლო პროექტი', 'Последний проект', 'Son proje', 'أحدث تصميم', 'התכנון האחרון'],
  vev_tab_changes: ['Changes', 'ცვლილებები', 'Изменения', 'Değişiklikler', 'التغييرات', 'שינויים'],
  vev_tab_old: ['Earlier versions', 'ძველი ვერსიები', 'Прежние версии', 'Eski sürümler', 'الإصدارات السابقة', 'גרסאות קודמות'],
  vev_tab_drawings: ['Drawings', 'ნახაზები', 'Чертежи', 'Çizimler', 'الرسومات', 'שרטוטים'],
  vev_tabs_label: ['Gallery sections', 'გალერეის განყოფილებები', 'Разделы галереи', 'Galeri bölümleri', 'أقسام المعرض', 'מדורי הגלריה'],

  /* ── the mandatory historical label (badge above AND on the image) ── */
  vev_hist_render_badge: [
    'Earlier design version | {{year}}',
    'ძველი საპროექტო ვერსია | {{year}} წელი',
    'Прежняя проектная версия | {{year}} год',
    'Eski proje sürümü | {{year}}',
    'نسخة تصميم سابقة | {{year}}',
    'גרסת תכנון קודמת | {{year}}',
  ],
  vev_hist_render_note: [
    'This image shows an earlier architectural concept of the project. The project may have changed since, so this render should not be taken as an exact picture of the building today.',
    'ეს გამოსახულება პროექტის ადრინდელ არქიტექტურულ ჩანაფიქრს ასახავს. მოგვიანებით პროექტი შესაძლოა შეცვლილიყო, ამიტომ ეს რენდერი არ უნდა აღიქვათ როგორც დღევანდელი შენობის ზუსტი გამოსახულება.',
    'Это изображение отражает более ранний архитектурный замысел проекта. Позже проект мог измениться, поэтому этот рендер не стоит воспринимать как точное изображение здания сегодня.',
    'Bu görsel projenin daha önceki mimari tasarımını gösterir. Proje sonradan değişmiş olabilir; bu nedenle bu görsel binanın bugünkü hâlinin birebir görüntüsü olarak algılanmamalıdır.',
    'تعرض هذه الصورة تصوّرًا معماريًا سابقًا للمشروع. ربما تغيّر المشروع لاحقًا، لذلك لا ينبغي اعتبار هذا التصميم صورة دقيقة للمبنى اليوم.',
    'תמונה זו מציגה תפיסה אדריכלית מוקדמת של הפרויקט. ייתכן שהפרויקט השתנה מאז, ולכן אין לראות בהדמיה זו תמונה מדויקת של הבניין כיום.',
  ],
  vev_hist_photo_badge: [
    'Historical photo | {{year}}',
    'ისტორიული ფოტო | {{year}} წელი',
    'Историческое фото | {{year}} год',
    'Tarihi fotoğraf | {{year}}',
    'صورة تاريخية | {{year}}',
    'תמונה היסטורית | {{year}}',
  ],
  vev_hist_photo_note: [
    'This photo was filed with a {{year}} case and shows the site as it was then. It does not show the building as it is today.',
    'ეს ფოტო {{year}} წლის საქმეს ერთვის და იმდროინდელ მდგომარეობას ასახავს. შენობის დღევანდელ მდგომარეობას ის არ აჩვენებს.',
    'Это фото приложено к делу {{year}} года и показывает участок таким, каким он был тогда. Сегодняшнее состояние здания оно не отражает.',
    'Bu fotoğraf {{year}} yılı dosyasına eklenmiştir ve o dönemki durumu gösterir. Binanın bugünkü hâlini göstermez.',
    'أُرفقت هذه الصورة بملف عام {{year}} وتُظهر الموقع كما كان آنذاك. وهي لا تُظهر المبنى كما هو اليوم.',
    'תמונה זו צורפה לתיק משנת {{year}} ומציגה את המצב כפי שהיה אז. היא אינה מציגה את הבניין כפי שהוא היום.',
  ],
  vev_hist_image_badge: [
    'Archive image | {{year}}',
    'საარქივო გამოსახულება | {{year}} წელი',
    'Архивное изображение | {{year}} год',
    'Arşiv görseli | {{year}}',
    'صورة أرشيفية | {{year}}',
    'תמונת ארכיון | {{year}}',
  ],
  vev_hist_image_note: [
    'This image was filed with a {{year}} case. It belongs to the project’s history and may not match the building today.',
    'ეს გამოსახულება {{year}} წლის საქმეს ერთვის. ის პროექტის ისტორიას ეკუთვნის და დღევანდელ შენობას შეიძლება არ შეესაბამებოდეს.',
    'Это изображение приложено к делу {{year}} года. Оно относится к истории проекта и может не совпадать со зданием сегодня.',
    'Bu görsel {{year}} yılı dosyasına eklenmiştir. Projenin geçmişine aittir ve bugünkü binayla örtüşmeyebilir.',
    'أُرفقت هذه الصورة بملف عام {{year}}. وهي جزء من تاريخ المشروع وقد لا تطابق المبنى اليوم.',
    'תמונה זו צורפה לתיק משנת {{year}}. היא שייכת להיסטוריה של הפרויקט וייתכן שאינה תואמת את הבניין כיום.',
  ],

  /* ── no newer verified render (owner-approved Georgian, verbatim) ── */
  vev_no_newer_title: [
    'No updated render was found',
    'განახლებული რენდერი ვერ მოიძებნა',
    'Обновлённый рендер не найден',
    'Güncel bir görselleştirme bulunamadı',
    'لم يُعثر على تصميم محدَّث',
    'לא נמצאה הדמיה מעודכנת',
  ],
  vev_no_newer_body: [
    'At this stage we could not find a newer, verified render showing the latest design of the building. That is why the older image is shown only so you can follow the project’s history.',
    'ამ ეტაპზე ვერ მოვიძიეთ უფრო ახალი, დადასტურებული რენდერი, რომელიც შენობის ბოლო საპროექტო ვერსიას ასახავს. ამიტომ ძველ გამოსახულებას მხოლოდ პროექტის ისტორიის გასაცნობად გაჩვენებთ.',
    'На данном этапе нам не удалось найти более новый подтверждённый рендер, отражающий последнюю проектную версию здания. Поэтому старое изображение показано только для знакомства с историей проекта.',
    'Şu aşamada binanın son proje sürümünü gösteren daha yeni ve doğrulanmış bir görselleştirme bulamadık. Bu nedenle eski görseli yalnızca projenin geçmişini tanımanız için gösteriyoruz.',
    'لم نتمكن في هذه المرحلة من العثور على تصميم أحدث وموثَّق يُظهر آخر نسخة من تصميم المبنى. لذلك نعرض الصورة القديمة فقط للتعرّف على تاريخ المشروع.',
    'בשלב זה לא מצאנו הדמיה חדשה ומאומתת יותר המציגה את גרסת התכנון האחרונה של הבניין. לכן התמונה הישנה מוצגת רק כדי להכיר את ההיסטוריה של הפרויקט.',
  ],

  /* ── a date the official file name states ── */
  vev_date_filename: [
    'dated {{date}} in the official file name',
    'ოფიციალური ფაილის სახელში მითითებული თარიღი: {{date}}',
    'дата в названии официального файла: {{date}}',
    'resmî dosya adındaki tarih: {{date}}',
    'التاريخ المذكور في اسم الملف الرسمي: {{date}}',
    'התאריך בשם הקובץ הרשמי: {{date}}',
  ],

  /* ── the card's fields ── */
  vev_card_type: ['Type', 'ტიპი', 'Тип', 'Tür', 'النوع', 'סוג'],
  vev_card_date: ['Date', 'თარიღი', 'Дата', 'Tarih', 'التاريخ', 'תאריך'],
  vev_card_scope: ['Concerns', 'რას ეხება', 'Относится к', 'Kapsam', 'يتعلق بـ', 'מתייחס ל'],
  vev_card_what: ['What it shows', 'რას გვიჩვენებს', 'Что показывает', 'Ne gösteriyor', 'ماذا يُظهر', 'מה רואים'],
  vev_card_why: ['Why it matters', 'რატომ არის მნიშვნელოვანი', 'Почему это важно', 'Neden önemli', 'لماذا يهم', 'למה זה חשוב'],

  /* ── why a picture in each tab matters (when synthesis wrote nothing) ── */
  vev_why_today: [
    'The documented condition closest to today. Still worth seeing in person before you decide.',
    'ეს დღევანდელ დღესთან ყველაზე ახლოს დოკუმენტირებული მდგომარეობაა. გადაწყვეტილებამდე მაინც ღირს შენობის პირადად ნახვა.',
    'Задокументированное состояние, ближайшее к сегодняшнему дню. Перед решением всё же стоит увидеть здание лично.',
    'Bugüne en yakın belgelenmiş durum. Karar vermeden önce binayı yerinde görmeye yine de değer.',
    'الحالة الموثَّقة الأقرب إلى اليوم. ومع ذلك يستحق المبنى المعاينة شخصيًا قبل اتخاذ القرار.',
    'המצב המתועד הקרוב ביותר להיום. עדיין כדאי לראות את הבניין בעיניים לפני שמחליטים.',
  ],
  vev_why_latest: [
    'The newest design on file. Compare it with what is actually being built and with your contract.',
    'ეს ოფიციალურ საქმეებში არსებული ყველაზე ახალი საპროექტო ვერსიაა. შეადარეთ ის რეალურად აშენებულს და თქვენს ხელშეკრულებას.',
    'Самая новая проектная версия в делах. Сравните её с тем, что строится на самом деле, и с вашим договором.',
    'Dosyalardaki en yeni proje sürümü. Gerçekte inşa edilenle ve sözleşmenizle karşılaştırın.',
    'أحدث نسخة تصميم في الملفات. قارنها بما يُبنى فعلًا وبعقدك.',
    'גרסת התכנון החדשה ביותר בתיקים. השוו אותה למה שנבנה בפועל ולחוזה שלכם.',
  ],
  vev_why_changes: [
    'Shows how the project changed between versions: what was added, removed or moved.',
    'გვიჩვენებს, როგორ იცვლებოდა პროექტი ვერსიებს შორის: რა დაემატა, რა მოიხსნა ან რა გადაადგილდა.',
    'Показывает, как проект менялся между версиями: что добавилось, исчезло или сместилось.',
    'Projenin sürümler arasında nasıl değiştiğini gösterir: neyin eklendiğini, kaldırıldığını veya taşındığını.',
    'يُظهر كيف تغيّر المشروع بين النسخ: ما أُضيف أو أُزيل أو نُقل.',
    'מראה כיצד הפרויקט השתנה בין הגרסאות: מה נוסף, מה הוסר ומה זז.',
  ],
  vev_why_old: [
    'History only: useful to understand how the project began, not to judge the building today.',
    'მხოლოდ ისტორიისთვის: გვეხმარება გავიგოთ, როგორ დაიწყო პროექტი, მაგრამ დღევანდელი შენობის შესაფასებლად არ გამოდგება.',
    'Только история: помогает понять, с чего начался проект, но не подходит для оценки здания сегодня.',
    'Yalnızca geçmiş: projenin nasıl başladığını anlamaya yarar, bugünkü binayı değerlendirmeye değil.',
    'للتاريخ فقط: يساعد على فهم بداية المشروع، لا على تقييم المبنى اليوم.',
    'היסטוריה בלבד: עוזר להבין איך הפרויקט התחיל, לא להעריך את הבניין כיום.',
  ],
  vev_why_drawings: [
    'The layout as designed. Check it against the apartment and floor you are considering.',
    'დაპროექტებული განლაგება. შეამოწმეთ ის იმ ბინასა და სართულთან მიმართებით, რომელსაც განიხილავთ.',
    'Планировка по проекту. Сверьте её с квартирой и этажом, которые вы рассматриваете.',
    'Tasarlanan yerleşim. İncelediğiniz daire ve kat ile karşılaştırın.',
    'المخطط كما صُمّم. طابِقه مع الشقة والطابق اللذين تفكر فيهما.',
    'הפריסה כפי שתוכננה. בדקו אותה מול הדירה והקומה שאתם שוקלים.',
  ],
};
