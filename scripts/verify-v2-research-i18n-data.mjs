/*
 * Admin → Providers: V2 research routing (src/components/admin/VerifyV2ResearchCard.tsx).
 *
 * Order is en, ka, ru, tr, ar, he — LANGS in lib/i18nSplice.mjs.
 */
export const VERIFY_V2_RESEARCH_STRINGS = {
  adm_v2r_title: ['V2 research spending', 'V2 კვლევის ხარჯი', 'Расходы на исследование V2', 'V2 araştırma harcaması', 'إنفاق بحث V2', 'הוצאות מחקר V2'],
  adm_v2r_note: [
    'Applies only to V2 verifications. Each job reads these settings once, when it starts. Empty fields mean the same as V1.',
    'ვრცელდება მხოლოდ V2 ვერიფიკაციებზე. თითო job ამ პარამეტრებს ერთხელ კითხულობს, დაწყებისას. ცარიელი ველი ნიშნავს იმავეს, რაც V1-ში.',
    'Действует только для проверок V2. Каждое задание читает эти настройки один раз, при запуске. Пустое поле означает то же, что в V1.',
    'Yalnızca V2 doğrulamalarına uygulanır. Her iş bu ayarları başlarken bir kez okur. Boş alanlar V1 ile aynı anlama gelir.',
    'ينطبق على عمليات تحقق V2 فقط. تقرأ كل مهمة هذه الإعدادات مرة واحدة عند بدئها. الحقل الفارغ يعني نفس سلوك V1.',
    'חל רק על אימותי V2. כל משימה קוראת את ההגדרות פעם אחת, כשהיא מתחילה. שדה ריק פירושו כמו ב-V1.',
  ],
  adm_v2r_stage_identity: ['Identity', 'იდენტიფიკაცია', 'Идентификация', 'Kimlik', 'الهوية', 'זיהוי'],
  adm_v2r_stage_official: ['Official documents', 'ოფიციალური დოკუმენტები', 'Официальные документы', 'Resmi belgeler', 'الوثائق الرسمية', 'מסמכים רשמיים'],
  adm_v2r_stage_public: ['Public research', 'საჯარო კვლევა', 'Открытое исследование', 'Kamu araştırması', 'البحث العام', 'מחקר ציבורי'],
  adm_v2r_stage_market: ['Market', 'ბაზარი', 'Рынок', 'Piyasa', 'السوق', 'שוק'],
  adm_v2r_model: ['Model', 'მოდელი', 'Модель', 'Yapay zekâ modeli', 'النموذج', 'מודל'],
  adm_v2r_default: ['As V1', 'როგორც V1', 'Как в V1', 'V1 gibi', 'كما في V1', 'כמו V1'],
  adm_v2r_max_searches: ['Max searches', 'მაქს. ძიება', 'Макс. поисков', 'En çok arama', 'أقصى عدد بحث', 'מקס׳ חיפושים'],
  adm_v2r_market_mode: ['Market mode', 'ბაზრის რეჟიმი', 'Режим рынка', 'Piyasa modu', 'وضع السوق', 'מצב שוק'],
  adm_v2r_market_auto: ['Code when enough comparables', 'კოდი, თუ საკმარისი ანალოგია', 'Код, если аналогов достаточно', 'Yeterli emsal varsa kod', 'الكود عند كفاية المقارنات', 'קוד כשיש מספיק השוואות'],
  adm_v2r_market_code: ['Code only', 'მხოლოდ კოდი', 'Только код', 'Yalnızca kod', 'الكود فقط', 'קוד בלבד'],
  adm_v2r_market_ai: ['Always AI', 'ყოველთვის AI', 'Всегда ИИ', 'Her zaman YZ', 'الذكاء الاصطناعي دائمًا', 'תמיד AI'],
  adm_v2r_report: ['Final report', 'საბოლოო ანგარიში', 'Итоговый отчёт', 'Nihai rapor', 'التقرير النهائي', 'הדוח הסופי'],
  adm_v2r_report_auto: [
    'Auto (Luna; Terra only if Luna fails the quality check)',
    'ავტო (Luna; Terra მხოლოდ თუ Luna ხარისხის შემოწმებას ვერ გაივლის)',
    'Авто (Luna; Terra, только если Luna не прошла проверку качества)',
    'Otomatik (Luna; yalnızca Luna kalite kontrolünü geçemezse Terra)',
    'تلقائي (Luna؛ Terra فقط إذا لم يجتز Luna فحص الجودة)',
    'אוטומטי (Luna; Terra רק אם Luna נכשל בבדיקת האיכות)',
  ],
  adm_v2r_budget: ['Research budget', 'კვლევის ბიუჯეტი', 'Бюджет исследования', 'Araştırma bütçesi', 'ميزانية البحث', 'תקציב מחקר'],
  adm_v2r_ceiling: ['Ceiling, USD', 'ზღვარი, USD', 'Предел, USD', 'Tavan, USD', 'الحد، دولار', 'תקרה, USD'],
  adm_v2r_escalation: [
    'Retry an unusable Luna answer once on Terra',
    'Luna-ს გამოუსადეგარი პასუხი ერთხელ თავიდან Terra-ზე',
    'Повторить непригодный ответ Luna один раз на Terra',
    'Kullanılamayan Luna yanıtını Terra ile bir kez yeniden dene',
    'إعادة محاولة إجابة Luna غير الصالحة مرة واحدة على Terra',
    'לנסות שוב פעם אחת ב-Terra תשובת Luna לא שמישה',
  ],
  adm_v2r_save: ['Save V2 research settings', 'V2 კვლევის პარამეტრების შენახვა', 'Сохранить настройки V2', 'V2 ayarlarını kaydet', 'حفظ إعدادات بحث V2', 'שמירת הגדרות מחקר V2'],
  adm_v2r_saved: ['V2 research settings saved', 'V2 კვლევის პარამეტრები შენახულია', 'Настройки V2 сохранены', 'V2 ayarları kaydedildi', 'تم حفظ إعدادات بحث V2', 'הגדרות מחקר V2 נשמרו'],
};
