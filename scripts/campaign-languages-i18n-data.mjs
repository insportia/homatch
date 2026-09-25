/*
 * Search-languages copy, in the order [en, ka, ru, tr, ar, he].
 *
 * THE DISTINCTION THIS COPY HAS TO CARRY
 *
 * Three things are called "language" on this screen and a customer will
 * conflate them unless the words stop them:
 *
 *   the language they are READING Homatch in
 *   the languages Homatch SEARCHES in
 *   whether a person found this way has to SPEAK one of them
 *
 * A Georgian-speaking broker running a Hebrew + Russian campaign is the
 * normal case, not an edge case, so the copy says so on the screen rather
 * than in a tooltip.
 */
export const CAMPAIGN_LANGUAGE_STRINGS = {
  campaign_langs_title: [
    'Search languages',
    'ძიების ენები',
    'Языки поиска',
    'Arama dilleri',
    'لغات البحث',
    'שפות חיפוש',
  ],
  campaign_langs_help: [
    'Which languages we look in. Buyers in Tbilisi write in several, and a search in one finds only one of them.',
    'რომელ ენებზე ვეძებთ. თბილისში მყიდველები რამდენიმე ენაზე წერენ და ერთ ენაზე ძიება მხოლოდ ერთ ნაწილს პოულობს.',
    'На каких языках мы ищем. Покупатели в Тбилиси пишут на нескольких, и поиск на одном найдёт только часть.',
    'Hangi dillerde aradığımız. Tiflis\'teki alıcılar birkaç dilde yazıyor; tek dilde arama yalnızca bir kısmını bulur.',
    'اللغات التي نبحث بها. المشترون في تبليسي يكتبون بعدة لغات، والبحث بلغة واحدة يجد جزءًا منهم فقط.',
    'באילו שפות אנחנו מחפשים. קונים בטביליסי כותבים בכמה שפות, וחיפוש באחת מוצא רק חלק מהם.',
  ],
  campaign_langs_not_ui: [
    'This is not the language Homatch is shown in, and it does not require anyone to speak it.',
    'ეს არ არის ენა, რომელზეც Homatch გეჩვენებათ, და არავისგან არ მოითხოვს ამ ენის ცოდნას.',
    'Это не язык интерфейса Homatch и не требование, чтобы кто-то на нём говорил.',
    'Bu, Homatch\'in gösterildiği dil değildir ve kimsenin o dili konuşmasını gerektirmez.',
    'هذه ليست لغة عرض Homatch ولا تشترط أن يتحدث بها أحد.',
    'זו אינה השפה שבה Homatch מוצג, והיא אינה דורשת מאיש לדבר בה.',
  ],
  campaign_langs_mode_auto: [
    'Recommended',
    'რეკომენდებული',
    'Рекомендуемые',
    'Önerilen',
    'موصى به',
    'מומלץ',
  ],
  campaign_langs_mode_auto_desc: [
    'Homatch picks the languages your buyers are most likely writing in.',
    'Homatch ირჩევს ენებს, რომლებზეც თქვენი მყიდველები სავარაუდოდ წერენ.',
    'Homatch выбирает языки, на которых ваши покупатели вероятнее всего пишут.',
    'Homatch, alıcılarınızın büyük olasılıkla yazdığı dilleri seçer.',
    'يختار Homatch اللغات التي يُرجَّح أن يكتب بها المشترون لديك.',
    'Homatch בוחר את השפות שבהן הקונים שלך ככל הנראה כותבים.',
  ],
  campaign_langs_mode_choose: [
    'Choose languages',
    'ენების არჩევა',
    'Выбрать языки',
    'Dilleri seç',
    'اختيار اللغات',
    'בחירת שפות',
  ],
  campaign_langs_mode_choose_desc: [
    'Search only the languages you pick. Nothing is added to them.',
    'ვეძებთ მხოლოდ თქვენ მიერ არჩეულ ენებზე. სხვა არაფერი დაემატება.',
    'Ищем только на выбранных вами языках. Ничего не добавляется.',
    'Yalnızca seçtiğiniz dillerde ararız. Üzerine hiçbir şey eklenmez.',
    'نبحث فقط باللغات التي تختارها. لا يُضاف إليها شيء.',
    'מחפשים רק בשפות שבחרת. שום דבר לא מתווסף אליהן.',
  ],
  campaign_langs_mode_all: [
    'Every supported language',
    'ყველა მხარდაჭერილი ენა',
    'Все поддерживаемые языки',
    'Desteklenen tüm diller',
    'كل اللغات المدعومة',
    'כל השפות הנתמכות',
  ],
  campaign_langs_mode_all_desc: [
    'The widest reach, and the most work.',
    'ყველაზე ფართო მოცვა და ყველაზე მეტი სამუშაო.',
    'Самый широкий охват и больше всего работы.',
    'En geniş erişim ve en çok iş.',
    'أوسع نطاق وأكبر قدر من العمل.',
    'ההיקף הרחב ביותר, והכי הרבה עבודה.',
  ],
  campaign_langs_suggestion: [
    'We would suggest {{languages}}.',
    'ჩვენ შემოგთავაზებდით {{languages}}.',
    'Мы бы предложили {{languages}}.',
    'Biz {{languages}} önerirdik.',
    'كنا سنقترح {{languages}}.',
    'היינו מציעים {{languages}}.',
  ],
  campaign_langs_pick_one: [
    'Pick at least one language.',
    'აირჩიეთ სულ მცირე ერთი ენა.',
    'Выберите хотя бы один язык.',
    'En az bir dil seçin.',
    'اختر لغة واحدة على الأقل.',
    'בחר לפחות שפה אחת.',
  ],
  campaign_langs_why: [
    'Why these languages',
    'რატომ ეს ენები',
    'Почему эти языки',
    'Neden bu diller',
    'لماذا هذه اللغات',
    'למה השפות האלה',
  ],
  campaign_langs_new_this_run: [
    'New in this run: {{languages}}',
    'ახალი ამ გაშვებაში: {{languages}}',
    'Новое в этом запуске: {{languages}}',
    'Bu çalışmada yeni: {{languages}}',
    'جديد في هذا التشغيل: {{languages}}',
    'חדש בהרצה הזו: {{languages}}',
  ],
  campaign_langs_already_searched: [
    'Already searched, and not paid for again: {{languages}}',
    'უკვე მოძებნილია და ხელახლა არ ანაზღაურდება: {{languages}}',
    'Уже искали, повторно не оплачивается: {{languages}}',
    'Zaten arandı, tekrar ücretlendirilmez: {{languages}}',
    'سبق البحث فيها ولن تُحتسب مرة أخرى: {{languages}}',
    'כבר חיפשנו, ולא משלמים שוב: {{languages}}',
  ],
  campaign_langs_coverage_title: [
    'What each language reached',
    'რას მიაღწია თითოეულმა ენამ',
    'Что нашёл каждый язык',
    'Her dilin ulaştığı',
    'ما وصلت إليه كل لغة',
    'למה הגיעה כל שפה',
  ],
  campaign_langs_attempted: [
    'Attempted',
    'სცადა',
    'Попыток',
    'Denenen',
    'المحاولات',
    'ניסיונות',
  ],
  campaign_langs_reached: [
    'Reached',
    'მიღწეული',
    'Доступно',
    'Ulaşılan',
    'تم الوصول',
    'הושגו',
  ],
  campaign_langs_blocked: [
    'Refused',
    'უარყოფილი',
    'Отказано',
    'Reddedilen',
    'مرفوضة',
    'סורבו',
  ],
  campaign_langs_found: [
    'Found',
    'ნაპოვნი',
    'Найдено',
    'Bulunan',
    'تم العثور',
    'נמצאו',
  ],
  campaign_langs_unique: [
    'New and useful',
    'ახალი და სასარგებლო',
    'Новых и полезных',
    'Yeni ve faydalı',
    'جديدة ومفيدة',
    'חדשים ומועילים',
  ],
  campaign_langs_duplicate: [
    'Already held',
    'უკვე გვქონდა',
    'Уже было',
    'Zaten vardı',
    'موجودة مسبقًا',
    'כבר היו אצלנו',
  ],
  campaign_langs_none_reached: [
    'Nothing could be read in this language on this run.',
    'ამ გაშვებაზე ამ ენაზე ვერაფერი წავიკითხეთ.',
    'В этом запуске на этом языке ничего прочитать не удалось.',
    'Bu çalışmada bu dilde hiçbir şey okunamadı.',
    'لم نتمكن من قراءة أي شيء بهذه اللغة في هذا التشغيل.',
    'בהרצה הזו לא הצלחנו לקרוא דבר בשפה הזו.',
  ],
  campaign_langs_original_evidence: [
    'Original, in {{language}}',
    'ორიგინალი, {{language}}',
    'Оригинал, {{language}}',
    'Orijinal, {{language}}',
    'الأصل، {{language}}',
    'מקור, {{language}}',
  ],
  campaign_langs_machine_summary: [
    'Summary written by Homatch, not by the author',
    'რეზიუმე დაწერილია Homatch-ის და არა ავტორის მიერ',
    'Краткое изложение составлено Homatch, а не автором',
    'Özet yazarı değil Homatch yazdı',
    'ملخّص كتبه Homatch وليس صاحب النص',
    'תקציר שנכתב על ידי Homatch, לא על ידי הכותב',
  ],
};
