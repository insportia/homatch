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
  adm_vos_queue_title: ['Durable queue', 'მდგრადი რიგი', 'Надёжная очередь', 'Kalıcı kuyruk', 'الطابور الدائم', 'תור עמיד'],
  adm_vos_queue_mode: ['Execution mode', 'შესრულების რეჟიმი', 'Режим выполнения', 'Çalışma modu', 'وضع التنفيذ', 'מצב הרצה'],
  adm_vos_queue_captcha_24h: ['CAPTCHA, 24 h', 'CAPTCHA, 24 სთ', 'CAPTCHA, 24 ч', 'CAPTCHA, 24 sa', 'CAPTCHA، 24 ساعة', 'CAPTCHA, 24 שעות'],
  adm_vos_queue_captcha_30d: ['CAPTCHA, 30 days', 'CAPTCHA, 30 დღე', 'CAPTCHA, 30 дней', 'CAPTCHA, 30 gün', 'CAPTCHA، 30 يومًا', 'CAPTCHA, 30 ימים'],
  adm_vos_queue_backlog: ['Backlog', 'რიგში', 'В очереди', 'Bekleyen', 'قيد الانتظار', 'ממתינים'],
  adm_vos_queue_oldest: ['Oldest waiting', 'ყველაზე დიდხანს მოლოდინში', 'Дольше всех ждёт', 'En uzun bekleyen', 'الأطول انتظارًا', 'הממתין הוותיק'],
  adm_vos_queue_dead: ['Dead-lettered, 24 h', 'შეჩერებული, 24 სთ', 'Остановлено, 24 ч', 'Durdurulan, 24 sa', 'متوقفة، 24 ساعة', 'נעצרו, 24 שעות'],
  adm_vos_queue_reused: ['Reused results, 24 h', 'ხელახლა გამოყენებული შედეგები, 24 სთ', 'Повторно использовано, 24 ч', 'Yeniden kullanılan, 24 sa', 'نتائج أُعيد استخدامها، 24 ساعة', 'תוצאות שנעשה בהן שימוש חוזר, 24 שעות'],
};
