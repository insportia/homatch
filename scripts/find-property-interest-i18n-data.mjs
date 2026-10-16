/*
 * Find Property — saved listings, the customer's own activity history and the
 * paid social-network campaign, in the order [en, ka, ru, tr, ar, he].
 * Match = დამთხვევა, tenant = მოიჯარე, თბილისი. A paid campaign finds
 * listings people POSTED; it never promises a property or a seller.
 */
export const FIND_PROPERTY_INTEREST_STRINGS = {
  fpi_save: ['Save listing', 'განცხადების შენახვა', 'Сохранить объявление', 'İlanı kaydet', 'حفظ الإعلان', 'שמירת המודעה'],
  fpi_unsave: ['Remove from saved', 'შენახულიდან წაშლა', 'Убрать из сохранённых', 'Kayıtlılardan çıkar', 'إزالة من المحفوظات', 'הסרה מהשמורים'],
  fpi_save_failed: ['Could not update your saved listings. Try again.', 'შენახული განცხადებების განახლება ვერ მოხერხდა. სცადეთ თავიდან.', 'Не удалось обновить сохранённые объявления. Попробуйте ещё раз.', 'Kayıtlı ilanlar güncellenemedi. Tekrar deneyin.', 'تعذّر تحديث الإعلانات المحفوظة. حاول مرة أخرى.', 'לא ניתן לעדכן את המודעות השמורות. נסו שוב.'],
  p2d_admin_sw_find_property_social_enabled: [
    'Find Property: paid social-network campaigns',
    'ობიექტის ძიება: ფასიანი კამპანიები სოციალურ ქსელებში',
    'Поиск объекта: платные кампании в соцсетях',
    'Mülk arama: ücretli sosyal ağ kampanyaları',
    'البحث عن عقار: حملات مدفوعة على الشبكات الاجتماعية',
    'חיפוש נכס: קמפיינים בתשלום ברשתות חברתיות',
  ],
  p2d_admin_sw_find_property_social_enabled_d: [
    'Customers may pay for a campaign over Facebook, Instagram, Telegram and VK posts (memo23). 37% HOMATCH / 63% providers; stopped by the Apify provider switch too.',
    'მომხმარებლებს შეუძლიათ გადაიხადონ კამპანიაში Facebook-ის, Instagram-ის, Telegram-ისა და VK-ის პოსტებზე (memo23). 37% HOMATCH / 63% პროვაიდერები; Apify-ის გადამრთველიც აჩერებს.',
    'Клиенты могут оплатить кампанию по постам Facebook, Instagram, Telegram и VK (memo23). 37% HOMATCH / 63% провайдерам; также останавливается переключателем Apify.',
    'Müşteriler Facebook, Instagram, Telegram ve VK gönderilerinde bir kampanya için ödeme yapabilir (memo23). %37 HOMATCH / %63 sağlayıcılar; Apify anahtarı da durdurur.',
    'يمكن للعملاء الدفع مقابل حملة على منشورات Facebook وInstagram وTelegram وVK (memo23). ‏37% لـ HOMATCH و63% للمزوّدين؛ ويوقفها مفتاح Apify أيضًا.',
    'לקוחות יכולים לשלם על קמפיין בפוסטים ב-Facebook, Instagram, Telegram ו-VK (memo23). ‏37% ל-HOMATCH ו-63% לספקים; גם מתג Apify עוצר אותו.',
  ],
};
