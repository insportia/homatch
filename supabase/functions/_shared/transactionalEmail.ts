// TRANSACTIONAL EMAIL — the email leg for the events a person asked to hear about.
//
// Only events the person caused themselves are emailed: a verification or
// contract analysis they started has finished, a payment they made went
// through or failed, a service they ran could not complete. Nothing here is
// marketing and nothing is sent in bulk: one notification, at most one email
// (notification_deliveries is unique on notification and channel).
//
// The language is the one the person chose (users.preferred_language),
// Georgian when they never chose. The person's email switch
// (notification_preferences.email_enabled) is honoured; a failed top-up is
// sent regardless, because a payment that silently did not arrive leaves the
// person believing they have Credits they do not. Billing is PAYG (10 Credits
// = $1): nothing here mentions a plan, a subscription or a renewal.

import { renderNotificationEmail, sendNotificationEmail } from './notifyEmail.ts';

export type EmailEvent = 'VERIFY_DONE' | 'CONTRACT_DONE' | 'PAYMENT_OK' | 'PAYMENT_FAILED' | 'SERVICE_FAILED';
type Lang = 'ka' | 'en' | 'ru' | 'tr' | 'ar' | 'he';
const LANGS: Lang[] = ['ka', 'en', 'ru', 'tr', 'ar', 'he'];

/** Which notifications earn an email. Everything else stays in-app and push. */
export function emailEventFor(type: string): EmailEvent | null {
  switch (type) {
    case 'VERIFY_COMPLETE': return 'VERIFY_DONE';
    case 'DOCUMENT_ANALYZED': return 'CONTRACT_DONE';
    case 'CREDITS_TOPPED_UP': return 'PAYMENT_OK';
    case 'PAYMENT_FAILED': return 'PAYMENT_FAILED';
    case 'SERVICE_FAILED': return 'SERVICE_FAILED';
    default: return null;
  }
}

/** Sent even when the email switch is off: a top-up that silently failed is worse than an email. */
const ALWAYS_SENT: EmailEvent[] = ['PAYMENT_FAILED'];

type Copy = { title: string; body: string; cta: string; next: string };
/* [ka, en, ru, tr, ar, he]. The Georgian titles and buttons are the owner-approved wording. */
const COPY: Record<EmailEvent, Copy[]> = {
  VERIFY_DONE: [
    { title: 'ქონების შემოწმება დასრულდა', body: 'შენი ქონების შემოწმების ანგარიში მზად არის.', cta: 'შედეგის ნახვა', next: 'გახსენი ანგარიში და ნახე, რა გადავამოწმეთ და რას უნდა მიაქციო ყურადღება.' },
    { title: 'Your property check is complete', body: 'Your property verification report is ready.', cta: 'View the result', next: 'Open the report to see what was checked and what deserves your attention.' },
    { title: 'Проверка недвижимости завершена', body: 'Отчёт о проверке недвижимости готов.', cta: 'Посмотреть результат', next: 'Открой отчёт, чтобы увидеть, что проверено и на что обратить внимание.' },
    { title: 'Mülk kontrolü tamamlandı', body: 'Mülk doğrulama raporun hazır.', cta: 'Sonucu gör', next: 'Neyin kontrol edildiğini ve nelere dikkat etmen gerektiğini görmek için raporu aç.' },
    { title: 'اكتمل فحص العقار', body: 'تقرير التحقق من عقارك جاهز.', cta: 'عرض النتيجة', next: 'افتح التقرير لترى ما تم فحصه وما يستحق انتباهك.' },
    { title: 'בדיקת הנכס הושלמה', body: 'דוח בדיקת הנכס שלך מוכן.', cta: 'צפה בתוצאה', next: 'פתח את הדוח כדי לראות מה נבדק ולמה כדאי לשים לב.' },
  ],
  CONTRACT_DONE: [
    { title: 'ხელშეკრულების ანალიზი დასრულდა', body: 'შენი დოკუმენტი მზად არის.', cta: 'დოკუმენტის გახსნა', next: 'ნახე, რომელი პუნქტები საჭიროებს ყურადღებას და რა ცვლილებების შეთავაზება შეიძლება.' },
    { title: 'Your contract analysis is complete', body: 'Your document is ready.', cta: 'Open the document', next: 'See which clauses need attention and which changes you could propose.' },
    { title: 'Анализ договора завершён', body: 'Твой документ готов.', cta: 'Открыть документ', next: 'Посмотри, какие пункты требуют внимания и какие изменения можно предложить.' },
    { title: 'Sözleşme analizi tamamlandı', body: 'Belgen hazır.', cta: 'Belgeyi aç', next: 'Hangi maddelerin dikkat gerektirdiğini ve hangi değişiklikleri önerebileceğini gör.' },
    { title: 'اكتمل تحليل العقد', body: 'مستندك جاهز.', cta: 'فتح المستند', next: 'اطلع على البنود التي تحتاج إلى انتباه والتغييرات التي يمكنك اقتراحها.' },
    { title: 'ניתוח החוזה הושלם', body: 'המסמך שלך מוכן.', cta: 'פתח את המסמך', next: 'ראה אילו סעיפים דורשים תשומת לב ואילו שינויים אפשר להציע.' },
  ],
  PAYMENT_OK: [
    { title: 'გადახდა წარმატებით შესრულდა', body: 'შენი კრედიტების ბალანსი განახლდა.', cta: 'გადახდის დეტალები', next: 'ბალანსი და გადახდების ისტორია ნებისმიერ დროს შეგიძლია ნახო.' },
    { title: 'Payment successful', body: 'Your credit balance has been updated.', cta: 'Payment details', next: 'You can see your balance and payment history at any time.' },
    { title: 'Оплата прошла успешно', body: 'Баланс кредитов обновлён.', cta: 'Детали оплаты', next: 'Баланс и историю платежей можно посмотреть в любое время.' },
    { title: 'Ödeme başarılı', body: 'Kredi bakiyen güncellendi.', cta: 'Ödeme ayrıntıları', next: 'Bakiyeni ve ödeme geçmişini istediğin zaman görebilirsin.' },
    { title: 'تمت عملية الدفع بنجاح', body: 'تم تحديث رصيدك.', cta: 'تفاصيل الدفع', next: 'يمكنك الاطلاع على رصيدك وسجل الدفعات في أي وقت.' },
    { title: 'התשלום בוצע בהצלחה', body: 'יתרת הקרדיטים שלך עודכנה.', cta: 'פרטי התשלום', next: 'אפשר לראות את היתרה ואת היסטוריית התשלומים בכל עת.' },
  ],
  /* PAYG only: a failed top-up adds nothing and changes nothing. No plan, no renewal, nothing automatic. */
  PAYMENT_FAILED: [
    { title: 'გადახდის შესრულება ვერ მოხერხდა', body: 'ბალანსის შევსება ვერ შესრულდა. კრედიტები არ დაგერიცხა და ბალანსი არ შეცვლილა.', cta: 'სცადე ხელახლა', next: 'შეამოწმე ბარათის მონაცემები ან აირჩიე სხვა გადახდის მეთოდი და ბალანსი ხელახლა შეავსე.' },
    { title: 'Payment could not be completed', body: 'Your top-up did not go through. No Credits were added and your balance has not changed.', cta: 'Try again', next: 'Check your card details or choose another payment method, then top up again.' },
    { title: 'Оплата не прошла', body: 'Пополнение баланса не прошло. Кредиты не начислены, баланс не изменился.', cta: 'Попробовать снова', next: 'Проверь данные карты или выбери другой способ оплаты и пополни баланс снова.' },
    { title: 'Ödeme tamamlanamadı', body: 'Bakiye yüklemen gerçekleşmedi. Kredi eklenmedi ve bakiyen değişmedi.', cta: 'Tekrar dene', next: 'Kart bilgilerini kontrol et veya başka bir ödeme yöntemi seç, sonra tekrar yükle.' },
    { title: 'تعذر إتمام الدفع', body: 'لم تكتمل عملية شحن الرصيد. لم تتم إضافة أي أرصدة ولم يتغير رصيدك.', cta: 'حاول مرة أخرى', next: 'تحقق من بيانات البطاقة أو اختر وسيلة دفع أخرى، ثم اشحن رصيدك من جديد.' },
    { title: 'התשלום לא הושלם', body: 'טעינת היתרה לא הושלמה. לא נוספו קרדיטים והיתרה שלך לא השתנתה.', cta: 'נסה שוב', next: 'בדוק את פרטי הכרטיס או בחר אמצעי תשלום אחר, ואז טען שוב.' },
  ],
  SERVICE_FAILED: [
    { title: 'დავალების შესრულებისას პრობლემა წარმოიშვა', body: 'სერვისი, რომელიც გაუშვი, ბოლომდე ვერ შესრულდა. გამოუყენებელი თანხა არ ჩამოგეჭრება.', cta: 'სცადე ხელახლა', next: 'თუ პრობლემა განმეორდა, დახმარების მიღება შეგიძლია.' },
    { title: 'There was a problem completing your task', body: 'A service you started could not finish. You are not charged for what was not delivered.', cta: 'Try again', next: 'If it happens again, you can get help.' },
    { title: 'При выполнении задачи возникла проблема', body: 'Запущенный сервис не смог завершиться. За невыполненное деньги не списываются.', cta: 'Попробовать снова', next: 'Если это повторится, можно получить помощь.' },
    { title: 'Görev tamamlanırken bir sorun oluştu', body: 'Başlattığın bir hizmet tamamlanamadı. Verilmeyen hizmet için ücret alınmaz.', cta: 'Tekrar dene', next: 'Tekrar olursa yardım alabilirsin.' },
    { title: 'حدثت مشكلة أثناء تنفيذ المهمة', body: 'تعذر إكمال خدمة بدأتها. لا يتم احتساب رسوم على ما لم يقدم.', cta: 'حاول مرة أخرى', next: 'إذا تكرر ذلك، يمكنك الحصول على المساعدة.' },
    { title: 'אירעה בעיה בביצוע המשימה', body: 'שירות שהפעלת לא הצליח להסתיים. לא תחויב על מה שלא סופק.', cta: 'נסה שוב', next: 'אם זה יקרה שוב, אפשר לקבל עזרה.' },
  ],
};

const LABELS: Record<Lang, { why: string; next: string; footer: string }> = {
  ka: { why: 'რატომ მოგწერეთ', next: 'შემდეგი ნაბიჯი', footer: 'ეს წერილი გამოგეგზავნა, რადგან ეს მოქმედება შენს HOMATCH-ის ანგარიშზე შესრულდა. ელფოსტით შეტყობინებების გამორთვა პარამეტრებში შეგიძლია.' },
  en: { why: 'Why you received this', next: 'Next step', footer: 'You received this because this happened on your HOMATCH account. You can turn off email notifications in your settings.' },
  ru: { why: 'Почему вы получили это письмо', next: 'Следующий шаг', footer: 'Это письмо отправлено, потому что действие произошло в вашем аккаунте HOMATCH. Отключить уведомления по почте можно в настройках.' },
  tr: { why: 'Bu e-postayı neden aldın', next: 'Sonraki adım', footer: 'Bu e-postayı HOMATCH hesabında gerçekleşen bir işlem nedeniyle aldın. E-posta bildirimlerini ayarlardan kapatabilirsin.' },
  ar: { why: 'لماذا وصلتك هذه الرسالة', next: 'الخطوة التالية', footer: 'وصلتك هذه الرسالة لأن هذا الإجراء تم على حسابك في HOMATCH. يمكنك إيقاف إشعارات البريد من الإعدادات.' },
  he: { why: 'למה קיבלת את זה', next: 'השלב הבא', footer: 'קיבלת את ההודעה כי הפעולה בוצעה בחשבון HOMATCH שלך. אפשר לכבות התראות דוא"ל בהגדרות.' },
};

const WHY: Record<Lang, string> = {
  ka: 'ეს სერვისი შენ გაუშვი და შედეგის შესახებ გაცნობებთ.',
  en: 'You started this service and we are letting you know the outcome.',
  ru: 'Вы запустили этот сервис, и мы сообщаем о результате.',
  tr: 'Bu hizmeti sen başlattın, sonucunu bildiriyoruz.',
  ar: 'لقد بدأت هذه الخدمة ونحن نبلغك بالنتيجة.',
  he: 'הפעלת את השירות הזה ואנחנו מעדכנים אותך בתוצאה.',
};

export function pickLang(raw: string | null | undefined): Lang {
  const l = String(raw ?? '').toLowerCase().slice(0, 2) as Lang;
  return LANGS.includes(l) ? l : 'ka';
}

const SITE = 'https://homatch.live';
/** Only an app path may become a link; anything else falls back to the home page. */
export function safeLink(deepLink: string | null | undefined): string {
  const p = String(deepLink ?? '');
  return /^\/(?!\/)[\w\-./?=&%:]*$/.test(p) ? SITE + p : SITE + '/';
}

export function buildTransactionalEmail(event: EmailEvent, langRaw: string | null | undefined, deepLink: string | null | undefined) {
  const lang = pickLang(langRaw);
  const copy = COPY[event][LANGS.indexOf(lang)];
  const l = LABELS[lang];
  return renderNotificationEmail({
    rtl: lang === 'ar' || lang === 'he', lang, title: copy.title, body: copy.body,
    whyLabel: l.why, why: WHY[lang], analysisLabel: '', analysis: null, nextLabel: l.next, next: copy.next,
    ctaLabel: copy.cta, ctaUrl: safeLink(deepLink), footer: l.footer,
  });
}

// deno-lint-ignore no-explicit-any
type Sb = any;

/** After a notification row exists: email it if the event earns one and the person allows it. Never throws. */
export async function maybeEmailNotification(sb: Sb, input: { notificationId: string; userId: string; type: string; deepLink?: string | null }): Promise<string> {
  try {
    const event = emailEventFor(input.type);
    if (!event || typeof sb?.from !== 'function') return 'NOT_EMAILED';
    const [{ data: user }, { data: prefs }] = await Promise.all([
      sb.from('users').select('preferred_language').eq('id', input.userId).maybeSingle(),
      sb.from('notification_preferences').select('email_enabled').eq('user_id', input.userId).maybeSingle(),
    ]);
    if (prefs && prefs.email_enabled === false && !ALWAYS_SENT.includes(event)) return 'OPTED_OUT';
    const content = buildTransactionalEmail(event, user?.preferred_language, input.deepLink);
    const r = await sendNotificationEmail(sb, { userId: input.userId, notificationId: input.notificationId, source: 'transactional', eventKey: event, content });
    return r.status;
  } catch (e) {
    console.error('[transactional-email] failed', e instanceof Error ? e.message : String(e));
    return 'ERROR';
  }
}
