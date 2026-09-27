// Copy for native relationships — two real Homatch accounts, and what either may do.
// Order: en, ka, ru, tr, ar, he. Written per language, not translated line by line:
// "potential interest", never "buyer found", in every one of them.
export const NATIVE_STRINGS = {
  native_section_owner_title: [
    'HOMATCH members who may be interested',
    'HOMATCH-ის წევრები, რომლებიც შესაძლოა დაინტერესდნენ',
    'Участники HOMATCH, которых может заинтересовать ваш объект',
    'İlgilenebilecek HOMATCH üyeleri',
    'أعضاء في HOMATCH قد يهتمون بعقارك',
    'חברי HOMATCH שעשויים להתעניין',
  ],
  native_section_owner_hint: [
    'Their stated requirements fit this property, or they asked about it. This is potential interest, not a confirmed buyer or tenant.',
    'მათ მიერ დასახელებული მოთხოვნები ამ ქონებას ემთხვევა, ან მის შესახებ იკითხეს. ეს პოტენციური ინტერესია და არა დადასტურებული მყიდველი ან მოიჯარე.',
    'Их требования совпадают с этим объектом, или они о нём спрашивали. Это возможный интерес, а не подтверждённый покупатель или арендатор.',
    'Belirttikleri koşullar bu mülkle örtüşüyor ya da mülk hakkında bilgi istediler. Bu olası bir ilgidir; kesinleşmiş bir alıcı veya kiracı değildir.',
    'تتوافق متطلباتهم المعلنة مع هذا العقار، أو استفسروا عنه. هذا اهتمام محتمل، وليس مشتريًا أو مستأجرًا مؤكدًا.',
    'הדרישות שהם ציינו מתאימות לנכס הזה, או שהם שאלו עליו. זו התעניינות אפשרית, לא קונה או שוכר מאושר.',
  ],
  native_section_seeker_title: [
    'HOMATCH properties that may fit',
    'HOMATCH-ის ქონება, რომელიც შესაძლოა მოგერგოთ',
    'Объекты HOMATCH, которые могут вам подойти',
    'Size uygun olabilecek HOMATCH mülkleri',
    'عقارات على HOMATCH قد تناسبك',
    'נכסים ב-HOMATCH שעשויים להתאים לך',
  ],
  native_section_seeker_hint: [
    'Listed by HOMATCH members. They fit the requirements you described; nothing here was charged.',
    'განთავსებულია HOMATCH-ის წევრების მიერ. ისინი თქვენ მიერ აღწერილ მოთხოვნებს შეესაბამება; ამისთვის არაფერი ჩამოგეჭრათ.',
    'Размещены участниками HOMATCH. Они соответствуют описанным вами требованиям; за это ничего не списано.',
    'HOMATCH üyeleri tarafından yayınlandı. Belirttiğiniz koşullara uyuyorlar; bunun için ücret alınmadı.',
    'نشرها أعضاء في HOMATCH، وتتوافق مع المتطلبات التي وصفتها؛ ولم يُخصم أي رصيد مقابل ذلك.',
    'פורסמו על ידי חברי HOMATCH. הם מתאימים לדרישות שתיארת; לא חויבת על כך.',
  ],
  native_error_load: [
    'These results could not be loaded right now.',
    'ამ შედეგების ჩატვირთვა ახლა ვერ მოხერხდა.',
    'Сейчас не удалось загрузить эти результаты.',
    'Bu sonuçlar şu anda yüklenemedi.',
    'تعذّر تحميل هذه النتائج الآن.',
    'לא ניתן לטעון את התוצאות האלה כרגע.',
  ],
  native_kind_match: [
    'Requirements fit', 'მოთხოვნები ემთხვევა', 'Требования совпадают', 'Koşullar örtüşüyor', 'المتطلبات متوافقة', 'הדרישות מתאימות',
  ],
  native_kind_interest: [
    'Expressed interest', 'გამოხატა ინტერესი', 'Проявил(а) интерес', 'İlgi gösterdi', 'أبدى اهتمامًا', 'הביע/ה עניין',
  ],
  native_kind_viewing: [
    'Requested a viewing', 'მოითხოვა დათვალიერება', 'Запросил(а) просмотр', 'Görüntüleme talep etti', 'طلب معاينة', 'ביקש/ה לראות את הנכס',
  ],
  native_member_fallback: [
    'HOMATCH member', 'HOMATCH-ის წევრი', 'Участник HOMATCH', 'HOMATCH üyesi', 'عضو في HOMATCH', 'חבר/ת HOMATCH',
  ],
  native_property_fallback: [
    'HOMATCH property', 'HOMATCH-ის ქონება', 'Объект HOMATCH', 'HOMATCH mülkü', 'عقار على HOMATCH', 'נכס ב-HOMATCH',
  ],
  native_property_ref: [
    'Property ID', 'ქონების ID', 'ID объекта', 'Mülk No.', 'رقم العقار', 'מזהה נכס',
  ],
  native_fits_on: [
    'Fits on: {{list}}', 'ემთხვევა: {{list}}', 'Совпадает: {{list}}', 'Örtüşen: {{list}}', 'يتوافق في: {{list}}', 'מתאים ב: {{list}}',
  ],
  native_fact_bedrooms: [
    '{{n}} bedrooms', '{{n}} საძინებელი', 'Спален: {{n}}', '{{n}} yatak odası', 'غرف النوم: {{n}}', '{{n}} חדרי שינה',
  ],
  native_fact_rooms: [
    '{{n}} rooms', '{{n}} ოთახი', 'Комнат: {{n}}', '{{n}} oda', 'الغرف: {{n}}', '{{n}} חדרים',
  ],
  native_action_message: [
    'Message', 'მიწერა', 'Написать', 'Mesaj gönder', 'مراسلة', 'שליחת הודעה',
  ],
  native_action_call: [
    'Call', 'დარეკვა', 'Позвонить', 'Ara', 'اتصال', 'התקשרות',
  ],
  native_call_number_label: [
    'Contact number:', 'საკონტაქტო ნომერი:', 'Контактный номер:', 'İletişim numarası:', 'رقم التواصل:', 'מספר ליצירת קשר:',
  ],
  native_call_not_shared: [
    "They haven't shared a phone number. Send them a message instead.",
    'ტელეფონის ნომერი ჯერ არ გაუზიარებიათ — მიწერეთ შეტყობინება.',
    'Собеседник ещё не поделился номером. Напишите ему сообщение.',
    'Henüz telefon numarası paylaşmadılar. Bunun yerine mesaj gönderin.',
    'لم يشارك رقم هاتفه بعد. أرسل له رسالة بدلًا من ذلك.',
    'עדיין לא שיתפו מספר טלפון. אפשר לשלוח הודעה במקום.',
  ],
  native_call_no_number: [
    'No contact number is available for this property.',
    'ამ ქონებისთვის საკონტაქტო ნომერი მითითებული არ არის.',
    'Для этого объекта контактный номер не указан.',
    'Bu mülk için iletişim numarası yok.',
    'لا يتوفر رقم تواصل لهذا العقار.',
    'אין מספר ליצירת קשר עבור הנכס הזה.',
  ],
  native_error_action: [
    'This action is not available right now.',
    'ეს მოქმედება ახლა ხელმისაწვდომი არ არის.',
    'Это действие сейчас недоступно.',
    'Bu işlem şu anda kullanılamıyor.',
    'هذا الإجراء غير متاح حاليًا.',
    'הפעולה הזו לא זמינה כרגע.',
  ],
};
