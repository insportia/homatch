/*
 * Copy for Admin → Verify end-to-end performance (Start → report READY).
 *
 * Order is en, ka, ru, tr, ar, he — LANGS in lib/i18nSplice.mjs.
 */
export const VERIFY_PERF_STRINGS = {
  adm_vperf_title: ['Performance: Start → report ready', 'სისწრაფე: დაწყება → ანგარიში მზადაა', 'Скорость: старт → отчёт готов', 'Performans: Başlat → rapor hazır', 'الأداء: البدء → التقرير جاهز', 'ביצועים: התחלה → הדוח מוכן'],
  adm_vperf_hint: [
    'Server timestamps only. Bars show each stage on the job’s own timeline; gaps are hand-offs between stages.',
    'მხოლოდ სერვერის დროის ნიშნულები. ზოლები აჩვენებს თითოეულ ეტაპს სამუშაოს საკუთარ დროის ხაზზე; შუალედები ეტაპებს შორის გადაცემაა.',
    'Только серверные отметки времени. Полосы показывают этапы на шкале задания; промежутки — передачи между этапами.',
    'Yalnızca sunucu zaman damgaları. Çubuklar her aşamayı işin kendi zaman çizelgesinde gösterir; boşluklar aşamalar arası devirlerdir.',
    'طوابع زمنية من الخادم فقط. تعرض الأشرطة كل مرحلة على الخط الزمني للمهمة؛ الفجوات هي عمليات التسليم بين المراحل.',
    'חותמות זמן של השרת בלבד. הפסים מציגים כל שלב על ציר הזמן של המשימה; הרווחים הם מסירות בין שלבים.',
  ],
  adm_vperf_total: ['Total', 'სულ', 'Всего', 'Toplam', 'الإجمالي', 'סה״כ'],
  adm_vperf_research: ['Research', 'კვლევა', 'Исследование', 'Araştırma', 'البحث', 'מחקר'],
  adm_vperf_report: ['Report', 'ანგარიში', 'Отчёт', 'Rapor', 'التقرير', 'דוח'],
  adm_vperf_queue: ['Queue wait', 'რიგში ლოდინი', 'Ожидание в очереди', 'Kuyruk bekleme', 'انتظار الطابور', 'המתנה בתור'],
  adm_vperf_worker: ['Worker time', 'ვორკერის დრო', 'Время воркера', 'İşçi süresi', 'وقت العامل', 'זמן עובד'],
  adm_vperf_handoff: ['Hand-offs', 'გადაცემები', 'Передачи', 'Devirler', 'عمليات التسليم', 'מסירות'],
  adm_vperf_retries: ['Retries', 'განმეორებები', 'Повторы', 'Yeniden denemeler', 'إعادة المحاولات', 'ניסיונות חוזרים'],
  adm_vperf_bottleneck: ['Bottleneck', 'შემაფერხებელი ეტაპი', 'Узкое место', 'Darboğaz', 'عنق الزجاجة', 'צוואר בקבוק'],
  adm_vperf_newest_two: ['newest two cases', 'ორი უახლესი საქმე', 'два новейших дела', 'en yeni iki dosya', 'أحدث قضيتين', 'שני התיקים האחרונים'],
};
