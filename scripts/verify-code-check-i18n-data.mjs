/*
 * Verify: the cadastral code check before a run (src/verify/cadastralInput.ts, VerifyPage).
 *
 * Order is en, ka, ru, tr, ar, he — LANGS in lib/i18nSplice.mjs.
 * {{code}} survives in every locale.
 */
export const VERIFY_CODE_CHECK_STRINGS = {
  verify_code_invalid: [
    'This cannot be read as a cadastral code. A code looks like 01.18.06.014.080, optionally followed by building, section and unit (.03.01.601).',
    'ეს საკადასტრო კოდად ვერ იკითხება. კოდი ასე გამოიყურება: 01.18.06.014.080, სურვილისამებრ შენობის, სექციის და ერთეულის ნომრით (.03.01.601).',
    'Это не распознаётся как кадастровый код. Код выглядит так: 01.18.06.014.080, при необходимости с номером здания, секции и помещения (.03.01.601).',
    'Bu bir kadastro kodu olarak okunamıyor. Kod şöyle görünür: 01.18.06.014.080, isteğe bağlı olarak bina, bölüm ve birim numarasıyla (.03.01.601).',
    'لا يمكن قراءة هذا كرمز مساحي. يبدو الرمز هكذا: 01.18.06.014.080، ويمكن أن يليه رقم المبنى والقسم والوحدة (.03.01.601).',
    'לא ניתן לקרוא זאת כקוד קדסטרי. קוד נראה כך: 01.18.06.014.080, ולאחריו אפשר מספר בניין, אגף ויחידה (.03.01.601).',
  ],
  verify_code_normalized: [
    'Will be searched as {{code}}.',
    'მოიძებნება როგორც {{code}}.',
    'Будет найдено как {{code}}.',
    '{{code}} olarak aranacak.',
    'سيُبحث عنه بصيغة {{code}}.',
    'ייחפש כ-{{code}}.',
  ],
  verify_err_code_not_found: [
    'No cadastral code like this exists: the Public Registry has no record of it, nor of its parent parcel. Nothing was charged. Please check the code and try again.',
    'ასეთი საკადასტრო კოდი არ არსებობს: საჯარო რეესტრში არ არის ჩანაწერი არც ამ კოდზე და არც მის დედა ნაკვეთზე. თანხა არ ჩამოგეჭრათ. გთხოვთ, გადაამოწმოთ კოდი და სცადოთ თავიდან.',
    'Такого кадастрового кода не существует: в Публичном реестре нет записи ни о нём, ни о родительском участке. Средства не списаны. Проверьте код и попробуйте снова.',
    'Böyle bir kadastro kodu yok: Tapu Sicilinde ne bu koda ne de ana parsele ait bir kayıt var. Ücret alınmadı. Lütfen kodu kontrol edip tekrar deneyin.',
    'لا يوجد رمز مساحي كهذا: لا يحتوي السجل العام على أي قيد له ولا لقطعة الأرض الأم. لم يتم خصم أي مبلغ. يرجى التحقق من الرمز والمحاولة مرة أخرى.',
    'קוד קדסטרי כזה אינו קיים: במרשם הציבורי אין רישום שלו וגם לא של חלקת האם. לא חויבת. אנא בדוק את הקוד ונסה שוב.',
  ],
  verify_code_did_you_mean: [
    'Did you mean {{code}}?',
    'ხომ არ გულისხმობთ {{code}}-ს?',
    'Возможно, вы имели в виду {{code}}?',
    '{{code}} mi demek istediniz?',
    'هل تقصد {{code}}؟',
    'האם התכוונת ל-{{code}}?',
  ],
};
