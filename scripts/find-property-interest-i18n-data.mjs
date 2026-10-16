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
};
