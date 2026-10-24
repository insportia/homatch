/*
 * Verify: the cadastral code check before a run (src/verify/cadastralInput.ts, VerifyPage).
 *
 * Order is en, ka, ru, tr, ar, he — LANGS in lib/i18nSplice.mjs.
 * {{code}} survives in every locale.
 */
export const VERIFY_CODE_CHECK_STRINGS = {
  verify_code_invalid: [
    'This is not a valid cadastral code. A code looks like 01.18.06.014.080, optionally followed by building, section and unit (.03.01.601).',
    'ეს არ არის სწორი საკადასტრო კოდი. კოდი ასე გამოიყურება: 01.18.06.014.080, სურვილისამებრ შენობის, სექციის და ერთეულის ნომრით (.03.01.601).',
    'Это не корректный кадастровый код. Код выглядит так: 01.18.06.014.080, при необходимости с номером здания, секции и помещения (.03.01.601).',
    'Bu geçerli bir kadastro kodu değil. Kod şöyle görünür: 01.18.06.014.080, isteğe bağlı olarak bina, bölüm ve birim numarasıyla (.03.01.601).',
    'هذا ليس رمزًا مساحيًا صالحًا. يبدو الرمز هكذا: 01.18.06.014.080، ويمكن أن يليه رقم المبنى والقسم والوحدة (.03.01.601).',
    'זה אינו קוד קדסטרי תקין. קוד נראה כך: 01.18.06.014.080, ולאחריו אפשר מספר בניין, אגף ויחידה (.03.01.601).',
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
