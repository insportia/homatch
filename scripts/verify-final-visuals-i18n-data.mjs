/*
 * Copy for the Verify gallery as a visual chronology (owner, 2026-10-11):
 * the project's story in five chapters, a prominent label on every picture
 * ("Project render · from the September 2026 application"), render vs
 * photograph said plainly, and one sentence when no recent photograph exists.
 *
 * Order is en, ka, ru, tr, ar, he (LANGS in lib/i18nSplice.mjs).
 * Placeholders ({{month}}, {{year}}, {{date}}) survive in every locale.
 * vfv_month_<n> is the month as it reads inside vfv_date_application in that
 * language (KA genitive, RU prepositional).
 */
export const VERIFY_FINAL_VISUALS_STRINGS = {
  vfv_chapters_label: ['The project in pictures, oldest to newest', 'პროექტი სურათებში, ძველიდან ახლამდე', 'Проект в изображениях, от ранних к новым', 'Eskiden yeniye resimlerle proje', 'المشروع بالصور من الأقدم إلى الأحدث', 'הפרויקט בתמונות, מהישן לחדש'],

  vfv_ch_original: ['Original concept & early renders', 'საწყისი კონცეფცია და ადრეული რენდერები', 'Исходная концепция и ранние визуализации', 'İlk konsept ve erken görselleştirmeler', 'الفكرة الأصلية والتصورات المبكرة', 'הקונספט המקורי והדמיות מוקדמות'],
  vfv_ch_designs: ['Approved designs & revisions', 'შეთანხმებული პროექტი და ცვლილებები', 'Согласованные проекты и изменения', 'Onaylı projeler ve revizyonlar', 'التصاميم المعتمدة والتعديلات', 'תכנונים מאושרים ועדכונים'],
  vfv_ch_construction: ['Construction progress & documented changes', 'მშენებლობის მიმდინარეობა და დოკუმენტირებული ცვლილებები', 'Ход строительства и задокументированные изменения', 'İnşaatın ilerleyişi ve belgelenmiş değişiklikler', 'تقدّم البناء والتغييرات الموثّقة', 'התקדמות הבנייה ושינויים מתועדים'],
  vfv_ch_latest: ['Latest available renders & images', 'უახლესი რენდერები და გამოსახულებები', 'Последние визуализации и изображения', 'En güncel görselleştirmeler ve görüntüler', 'أحدث التصورات والصور المتاحة', 'ההדמיות והתמונות העדכניות ביותר'],
  vfv_ch_current: ['Current documented condition', 'დოკუმენტირებული მიმდინარე მდგომარეობა', 'Текущее задокументированное состояние', 'Belgelenmiş güncel durum', 'الحالة الراهنة الموثّقة', 'המצב הנוכחי המתועד'],

  vfv_type_render: ['Project render', 'პროექტის რენდერი', 'Визуализация проекта', 'Proje görselleştirmesi', 'تصوّر المشروع', 'הדמיית הפרויקט'],
  vfv_type_photo: ['Photograph', 'ფოტო', 'Фотография', 'Fotoğraf', 'صورة فوتوغرافية', 'תצלום'],
  vfv_type_construction_photo: ['Construction photograph', 'სამშენებლო ფოტო', 'Фотография стройки', 'İnşaat fotoğrafı', 'صورة من موقع البناء', 'תצלום מאתר הבנייה'],
  vfv_type_drawing: ['Project drawing', 'პროექტის ნახაზი', 'Чертёж проекта', 'Proje çizimi', 'رسم المشروع', 'שרטוט הפרויקט'],
  vfv_type_image: ['Project image, type not stated', 'პროექტის გამოსახულება, ტიპი მითითებული არ არის', 'Изображение проекта, тип не указан', 'Proje görüntüsü, türü belirtilmemiş', 'صورة للمشروع، نوعها غير مذكور', 'תמונת הפרויקט, הסוג לא צוין'],

  vfv_date_application: ['from the {{month}} {{year}} application', '{{year}} წლის {{month}} განაცხადიდან', 'из заявления, поданного в {{month}} {{year}} г.', '{{month}} {{year}} başvurusundan', 'من طلب {{month}} {{year}}', 'מהבקשה של {{month}} {{year}}'],
  vfv_date_exif: ['photographed {{date}}', 'გადაღების თარიღი {{date}}', 'снято {{date}}', 'çekim tarihi {{date}}', 'التُقطت في {{date}}', 'צולם ב-{{date}}'],
  vfv_date_unknown: ['filing date not stated', 'წარდგენის თარიღი მითითებული არ არის', 'дата подачи не указана', 'başvuru tarihi belirtilmemiş', 'تاريخ التقديم غير مذكور', 'מועד ההגשה לא צוין'],

  vfv_month_1: ['January', 'იანვრის', 'январе', 'Ocak', 'يناير', 'ינואר'],
  vfv_month_2: ['February', 'თებერვლის', 'феврале', 'Şubat', 'فبراير', 'פברואר'],
  vfv_month_3: ['March', 'მარტის', 'марте', 'Mart', 'مارس', 'מרץ'],
  vfv_month_4: ['April', 'აპრილის', 'апреле', 'Nisan', 'أبريل', 'אפריל'],
  vfv_month_5: ['May', 'მაისის', 'мае', 'Mayıs', 'مايو', 'מאי'],
  vfv_month_6: ['June', 'ივნისის', 'июне', 'Haziran', 'يونيو', 'יוני'],
  vfv_month_7: ['July', 'ივლისის', 'июле', 'Temmuz', 'يوليو', 'יולי'],
  vfv_month_8: ['August', 'აგვისტოს', 'августе', 'Ağustos', 'أغسطس', 'אוגוסט'],
  vfv_month_9: ['September', 'სექტემბრის', 'сентябре', 'Eylül', 'سبتمبر', 'ספטמבר'],
  vfv_month_10: ['October', 'ოქტომბრის', 'октябре', 'Ekim', 'أكتوبر', 'אוקטובר'],
  vfv_month_11: ['November', 'ნოემბრის', 'ноябре', 'Kasım', 'نوفمبر', 'נובמבר'],
  vfv_month_12: ['December', 'დეკემბრის', 'декабре', 'Aralık', 'ديسمبر', 'דצמבר'],

  vfv_render_not_evidence: [
    'A render shows what was designed. It is not evidence that the building was completed this way.',
    'რენდერი აჩვენებს დაპროექტებულს. ის არ ადასტურებს, რომ შენობა ასე დასრულდა.',
    'Визуализация показывает замысел проекта. Она не подтверждает, что здание достроено именно так.',
    'Bir görselleştirme tasarlananı gösterir. Binanın bu şekilde tamamlandığının kanıtı değildir.',
    'يُظهر التصوّر ما صُمِّم فقط، وليس دليلًا على أن المبنى اكتمل على هذا النحو.',
    'הדמיה מראה את מה שתוכנן. היא אינה הוכחה שהבניין הושלם כך.',
  ],
  vfv_image_type_note: [
    'The file does not say whether this is a photograph or a render, so it is not treated as evidence of what was built.',
    'ფაილში არ წერია, ფოტოა თუ რენდერი, ამიტომ მას აშენებულის მტკიცებულებად არ განვიხილავთ.',
    'В файле не указано, фотография это или визуализация, поэтому оно не считается подтверждением построенного.',
    'Dosya bunun fotoğraf mı yoksa görselleştirme mi olduğunu belirtmiyor; bu yüzden inşa edilenin kanıtı sayılmaz.',
    'لا يذكر الملف إن كانت هذه صورة فوتوغرافية أم تصوّرًا، لذا لا تُعدّ دليلًا على ما بُني.',
    'בקובץ לא צוין אם זה תצלום או הדמיה, ולכן הוא אינו נחשב הוכחה למה שנבנה.',
  ],
  vfv_no_current_photos: [
    'No photographs of the building\'s current condition were filed in the official record.',
    'შენობის მიმდინარე მდგომარეობის ფოტოები ოფიციალურ ჩანაწერებში წარდგენილი არ არის.',
    'Фотографии текущего состояния здания в официальные материалы не подавались.',
    'Resmî kayıtlara binanın güncel durumunu gösteren fotoğraf sunulmamış.',
    'لم تُقدَّم إلى السجل الرسمي صور فوتوغرافية للحالة الراهنة للمبنى.',
    'לא הוגשו לרשומה הרשמית תצלומים של מצבו הנוכחי של הבניין.',
  ],
  vfv_no_current_photos_since: [
    'No recent photographs of the building are on file; the newest official photographs date from {{year}}.',
    'შენობის ბოლოდროინდელი ფოტოები ჩანაწერებში არ არის; უახლესი ოფიციალური ფოტოები {{year}} წლისაა.',
    'Недавних фотографий здания в материалах нет; самые новые официальные фотографии относятся к {{year}} году.',
    'Binanın yakın tarihli fotoğrafı kayıtlarda yok; en yeni resmî fotoğraflar {{year}} yılına ait.',
    'لا توجد في السجل صور حديثة للمبنى؛ وأحدث الصور الرسمية تعود إلى عام {{year}}.',
    'אין ברשומה תצלומים עדכניים של הבניין; התצלומים הרשמיים החדשים ביותר הם משנת {{year}}.',
  ],
};
