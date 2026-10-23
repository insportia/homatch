/*
 * Admin → Providers: the Verify engine selector (src/components/admin/VerifyEngineCard.tsx).
 *
 * Order is en, ka, ru, tr, ar, he — LANGS in lib/i18nSplice.mjs.
 * {{engine}} survives in every locale.
 */
export const VERIFY_ENGINE_STRINGS = {
  adm_engine_title: ['Verify engine', 'Verify-ის ძრავა', 'Движок Verify', 'Verify motoru', 'محرك Verify', 'מנוע Verify'],
  adm_engine_active: ['New jobs run on', 'ახალი job-ები მუშაობს', 'Новые задания выполняются на', 'Yeni işler şunda çalışır', 'المهام الجديدة تعمل على', 'משימות חדשות רצות על'],
  adm_engine_v1: ['V1 — Original', 'V1 — ორიგინალი', 'V1 — Оригинал', 'V1 — Orijinal', 'V1 — الأصلي', 'V1 — מקורי'],
  adm_engine_v2: ['V2 — Code-First', 'V2 — კოდზე დაფუძნებული', 'V2 — На основе кода', 'V2 — Kod öncelikli', 'V2 — قائم على الكود', 'V2 — מבוסס קוד'],
  adm_engine_new_jobs_only: [
    'A switch applies to new verifications only. A verification already running finishes on the engine it started with.',
    'გადართვა მხოლოდ ახალ ვერიფიკაციებზე ვრცელდება. უკვე დაწყებული ვერიფიკაცია იმავე ძრავაზე სრულდება, რომლითაც დაიწყო.',
    'Переключение действует только для новых проверок. Уже запущенная проверка завершается на том движке, на котором началась.',
    'Değişiklik yalnızca yeni doğrulamalara uygulanır. Başlamış bir doğrulama, başladığı motorla tamamlanır.',
    'ينطبق التبديل على عمليات التحقق الجديدة فقط. أما عملية التحقق الجارية فتكتمل على المحرك الذي بدأت به.',
    'ההחלפה חלה על אימותים חדשים בלבד. אימות שכבר רץ מסתיים במנוע שבו התחיל.',
  ],
  adm_engine_v2_unavailable: [
    'V2 is not deployed yet, so it cannot be selected.',
    'V2 ჯერ არ არის გაშვებული, ამიტომ მისი არჩევა შეუძლებელია.',
    'V2 ещё не развёрнут, поэтому его нельзя выбрать.',
    'V2 henüz devreye alınmadı, bu yüzden seçilemez.',
    'لم يُنشر V2 بعد، لذا لا يمكن اختياره.',
    'V2 עדיין לא הופעל, ולכן אי אפשר לבחור בו.',
  ],
  adm_engine_confirm_title: [
    'Switch new verifications to {{engine}}?',
    'გადავრთოთ ახალი ვერიფიკაციები {{engine}}-ზე?',
    'Переключить новые проверки на {{engine}}?',
    'Yeni doğrulamalar {{engine}} motoruna geçirilsin mi?',
    'هل تريد تحويل عمليات التحقق الجديدة إلى {{engine}}؟',
    'להעביר אימותים חדשים ל-{{engine}}?',
  ],
  adm_engine_confirm_body: [
    'Running verifications are not affected. The change is recorded in the audit log with your reason.',
    'მიმდინარე ვერიფიკაციებზე გავლენა არ ექნება. ცვლილება თქვენი მიზეზით აუდიტის ჟურნალში ჩაიწერება.',
    'Текущие проверки не затрагиваются. Изменение записывается в журнал аудита вместе с причиной.',
    'Devam eden doğrulamalar etkilenmez. Değişiklik, gerekçenizle birlikte denetim kaydına yazılır.',
    'لا تتأثر عمليات التحقق الجارية. يُسجَّل التغيير في سجل التدقيق مع السبب الذي تذكره.',
    'אימותים שכבר רצים לא מושפעים. השינוי נרשם ביומן הביקורת יחד עם הסיבה שלך.',
  ],
  adm_engine_confirm: ['Switch engine', 'ძრავის გადართვა', 'Переключить движок', 'Motoru değiştir', 'تبديل المحرك', 'החלפת מנוע'],
  adm_engine_reason: ['Reason (required)', 'მიზეზი (სავალდებულო)', 'Причина (обязательно)', 'Gerekçe (zorunlu)', 'السبب (مطلوب)', 'סיבה (חובה)'],
  adm_engine_customers: ['Customers', 'მომხმარებლები', 'Клиенты', 'Müşteriler', 'العملاء', 'לקוחות'],
  adm_engine_admin_preview: [
    'Your own test verifications (admin accounts)',
    'თქვენი სატესტო ვერიფიკაციები (ადმინის ანგარიშები)',
    'Ваши тестовые проверки (аккаунты администраторов)',
    'Kendi test doğrulamalarınız (yönetici hesapları)',
    'عمليات التحقق التجريبية الخاصة بك (حسابات المسؤولين)',
    'אימותי הבדיקה שלך (חשבונות מנהל)',
  ],
  adm_engine_admin_preview_note: [
    'Applies only to verifications started from an admin account. Customers stay on the engine above.',
    'ვრცელდება მხოლოდ ადმინის ანგარიშიდან დაწყებულ ვერიფიკაციებზე. მომხმარებლები ზემოთ მითითებულ ძრავაზე რჩებიან.',
    'Действует только для проверок, запущенных из аккаунта администратора. Клиенты остаются на движке выше.',
    'Yalnızca yönetici hesabından başlatılan doğrulamalara uygulanır. Müşteriler yukarıdaki motorda kalır.',
    'ينطبق فقط على عمليات التحقق التي تبدأ من حساب مسؤول. يبقى العملاء على المحرك أعلاه.',
    'חל רק על אימותים שהופעלו מחשבון מנהל. הלקוחות נשארים על המנוע שלמעלה.',
  ],
  adm_engine_confirm_admin_title: [
    'Run your own test verifications on {{engine}}?',
    'გაეშვას თქვენი სატესტო ვერიფიკაციები {{engine}}-ზე?',
    'Запускать ваши тестовые проверки на {{engine}}?',
    'Kendi test doğrulamalarınız {{engine}} motorunda çalışsın mı?',
    'هل تريد تشغيل عمليات التحقق التجريبية الخاصة بك على {{engine}}؟',
    'להריץ את אימותי הבדיקה שלך על {{engine}}?',
  ],
  adm_engine_saved: ['Engine updated for new verifications', 'ძრავა განახლდა ახალი ვერიფიკაციებისთვის', 'Движок обновлён для новых проверок', 'Yeni doğrulamalar için motor güncellendi', 'تم تحديث المحرك لعمليات التحقق الجديدة', 'המנוע עודכן לאימותים חדשים'],
};
