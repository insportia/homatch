/*
 * Copy for Verify at scale: a dropped connection is never shown as a raw
 * transport error.
 *
 * Order is en, ka, ru, tr, ar, he — LANGS in lib/i18nSplice.mjs.
 */
export const VERIFY_SCALE_STRINGS = {
  verify_err_connection: [
    'The connection was interrupted. Please check your internet and try again.',
    'კავშირი შეწყდა. შეამოწმეთ ინტერნეტი და სცადეთ თავიდან.',
    'Соединение прервалось. Проверьте интернет и попробуйте ещё раз.',
    'Bağlantı kesildi. İnternetinizi kontrol edip tekrar deneyin.',
    'انقطع الاتصال. يُرجى التحقق من الإنترنت والمحاولة مرة أخرى.',
    'החיבור נקטע. בדקו את חיבור האינטרנט ונסו שוב.',
  ],
  verify_err_busy: [
    'Many verifications are running right now. Please try again in a moment.',
    'ამ წუთას ბევრი შემოწმება მიმდინარეობს. სცადეთ ცოტა ხანში თავიდან.',
    'Сейчас выполняется много проверок. Пожалуйста, повторите попытку через минуту.',
    'Şu anda çok sayıda doğrulama yapılıyor. Lütfen birazdan tekrar deneyin.',
    'تُجرى الآن عمليات تحقق كثيرة. يُرجى المحاولة مرة أخرى بعد قليل.',
    'כרגע מתבצעות בדיקות רבות. נסו שוב בעוד רגע.',
  ],
};
