// HOMATCH Design Studio — admin economics: what an AI job costs us, and a
// planning calculator that never sets a price.
//
// Order is [en, ka, ru, tr, ar, he].

export const DS_STRINGS_16 = {
  ds_fin_title: ['Design Studio AI economics', 'Design Studio — AI ეკონომიკა', 'Экономика ИИ Design Studio', 'Design Studio yapay zekâ ekonomisi', 'اقتصاديات الذكاء الاصطناعي في Design Studio', 'כלכלת ה-AI של Design Studio'],
  ds_fin_hint: [
    'Variable AI cost per job from real samples, last 90 days. Unpriced jobs are counted but never averaged as zero. Fixed costs are in the Fixed costs tab.',
    'AI-ს ცვლადი ხარჯი ერთ სამუშაოზე რეალური ნიმუშებიდან, ბოლო 90 დღე. ფასის არმქონე სამუშაოები ითვლება, მაგრამ ნულად არასოდეს საშუალოვდება. ფიქსირებული ხარჯები ფიქსირებული ხარჯების ჩანართშია.',
    'Переменная стоимость ИИ за задачу по реальным выборкам за 90 дней. Задачи без цены учитываются, но никогда не усредняются как ноль. Постоянные расходы — во вкладке постоянных расходов.',
    'Son 90 günün gerçek örneklerinden iş başına değişken yapay zekâ maliyeti. Fiyatlandırılmamış işler sayılır ama asla sıfır olarak ortalamaya katılmaz. Sabit maliyetler Sabit maliyetler sekmesindedir.',
    'تكلفة الذكاء الاصطناعي المتغيرة لكل مهمة من عينات حقيقية خلال آخر 90 يومًا. تُحتسب المهام غير المسعّرة لكنها لا تُحسب صفرًا في المتوسط أبدًا. التكاليف الثابتة في تبويب التكاليف الثابتة.',
    'עלות AI משתנה לכל משימה מדגימות אמיתיות, 90 הימים האחרונים. משימות ללא תמחור נספרות אך לעולם אינן ממוצעות כאפס. עלויות קבועות נמצאות בלשונית העלויות הקבועות.',
  ],
  ds_fin_no_samples: ['No Design Studio AI jobs in this period.', 'ამ პერიოდში Design Studio-ს AI სამუშაოები არ ყოფილა.', 'За этот период задач ИИ Design Studio не было.', 'Bu dönemde Design Studio yapay zekâ işi yok.', 'لا توجد مهام ذكاء اصطناعي في Design Studio خلال هذه الفترة.', 'אין משימות AI של Design Studio בתקופה זו.'],
  ds_fin_samples: ['Priced / samples', 'ფასიანი / ნიმუშები', 'С ценой / выборки', 'Fiyatlı / örnek', 'مسعّرة / عينات', 'מתומחרות / דגימות'],
  ds_fin_tokens: ['Avg tokens in / out', 'საშ. ტოკენები შემ. / გამ.', 'Ср. токены вход / выход', 'Ort. token giriş / çıkış', 'متوسط الرموز دخول / خروج', 'ממוצע טוקנים קלט / פלט'],
  ds_fin_avg_ai: ['Avg raw AI', 'საშ. AI (ნედლი)', 'Ср. ИИ (сырая)', 'Ort. ham yapay zekâ', 'متوسط الذكاء الاصطناعي الخام', 'ממוצע AI גולמי'],
  ds_fin_avg_landed: ['Avg landed', 'საშ. სრული', 'Ср. полная', 'Ort. toplam', 'متوسط التكلفة الكاملة', 'ממוצע עלות כוללת'],
  ds_fin_median: ['Median', 'მედიანა', 'Медиана', 'Medyan', 'الوسيط', 'חציון'],
  ds_fin_candidate: ['Candidate price (credits)', 'საცდელი ფასი (კრედიტები)', 'Пробная цена (кредиты)', 'Aday fiyat (kredi)', 'السعر المرشّح (أرصدة)', 'מחיר מועמד (קרדיטים)'],
  ds_fin_credits_eq: ['= ${{usd}} (10 credits = $1)', '= ${{usd}} (10 კრედიტი = $1)', '= ${{usd}} (10 кредитов = $1)', '= ${{usd}} (10 kredi = 1 $)', '= ${{usd}} (10 أرصدة = 1$)', '= ${{usd}} (10 קרדיטים = $1)'],
  ds_fin_planning_only: [
    'Planning only: this sets no price. 30% margin is the safety floor; 70%+ and 75–85% are planning targets.',
    'მხოლოდ დაგეგმვისთვის: ეს ფასს არ ადგენს. 30% მარჟა უსაფრთხოების ზღვარია; 70%+ და 75–85% დაგეგმვის მიზნებია.',
    'Только для планирования: цена не устанавливается. Маржа 30% — нижний предел безопасности; 70%+ и 75–85% — плановые цели.',
    'Yalnızca planlama: bu bir fiyat belirlemez. %30 marj güvenlik tabanıdır; %70+ ve %75–85 planlama hedefleridir.',
    'للتخطيط فقط: لا يحدد هذا أي سعر. هامش 30% هو حد الأمان الأدنى؛ و70%+ و75–85% أهداف تخطيطية.',
    'לתכנון בלבד: זה לא קובע מחיר. מרווח 30% הוא רצפת הבטיחות; 70%+ ו-75–85% הם יעדי תכנון.',
  ],
  ds_fin_basis: ['Cost basis', 'ხარჯის საფუძველი', 'База затрат', 'Maliyet esası', 'أساس التكلفة', 'בסיס עלות'],
  ds_fin_margin: ['Margin', 'მარჟა', 'Маржа', 'Marj', 'الهامش', 'מרווח'],
  ds_fin_markup: ['Markup', 'ნამატი', 'Наценка', 'Kâr oranı', 'نسبة الإضافة', 'תוספת'],
  ds_fin_scenario_100: ['A $100 customer', '$100-იანი მომხმარებელი', 'Клиент на $100', '100 $ harcayan müşteri', 'عميل بـ 100$', 'לקוח של $100'],
  ds_fin_scenario_cell: ['{{jobs}} jobs · ${{profit}} profit', '{{jobs}} სამუშაო · ${{profit}} მოგება', '{{jobs}} задач · ${{profit}} прибыли', '{{jobs}} iş · {{profit}} $ kâr', '{{jobs}} مهمة · ربح {{profit}}$', '{{jobs}} משימות · רווח ${{profit}}'],
  ds_fin_below_floor: ['Below 30% floor', '30%-იან ზღვარს ქვემოთ', 'Ниже порога 30%', '%30 tabanın altında', 'أقل من حد 30%', 'מתחת לרצפת 30%'],
  ds_fin_above_floor: ['Above floor', 'ზღვარს ზემოთ', 'Выше порога', 'Tabanın üstünde', 'فوق الحد الأدنى', 'מעל הרצפה'],
  ds_fin_above_70: ['70%+ target', '70%+ მიზანი', 'Цель 70%+', '%70+ hedef', 'هدف 70%+', 'יעד 70%+'],
  ds_fin_in_band: ['In 75–85% band', '75–85% დიაპაზონში', 'В диапазоне 75–85%', '%75–85 aralığında', 'ضمن نطاق 75–85%', 'בטווח 75–85%'],
};
