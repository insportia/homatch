/*
 * System health — queues and stuck work (2026-10-18): the Admin card that shows how much
 * background work is waiting, what is stuck mid-finish, which credit holds outlived their
 * expiry and which provider runs were never booked. Order: en, ka, ru, tr, ar, he.
 */
export const OPS_HEALTH_ADDED = {
  admin_ops_title: ['Queues and stuck work', 'რიგები და გაჭედილი სამუშაო', 'Очереди и зависшие задачи', 'Kuyruklar ve takılan işler', 'قوائم الانتظار والأعمال المتوقفة', 'תורים ועבודה תקועה'],
  admin_ops_subtitle: ['Waiting work, its oldest item, and anything stuck. Read-only.', 'მოლოდინში მყოფი სამუშაო, ყველაზე ძველი ჩანაწერი და ყველაფერი, რაც გაიჭედა. მხოლოდ წაკითხვა.', 'Ожидающая работа, самый старый элемент и всё зависшее. Только чтение.', 'Bekleyen işler, en eski öğe ve takılan her şey. Salt okunur.', 'العمل المنتظر وأقدم عنصر فيه وكل ما توقف. للقراءة فقط.', 'עבודה ממתינה, הפריט הוותיק ביותר וכל מה שנתקע. קריאה בלבד.'],
  admin_ops_unreadable: ['not readable', 'ვერ წაიკითხა', 'не прочитано', 'okunamadı', 'تعذّرت القراءة', 'לא נקרא'],
  admin_ops_oldest: ['Oldest item', 'ყველაზე ძველი ჩანაწერი', 'Самый старый элемент', 'En eski öğe', 'أقدم عنصر', 'הפריט הוותיק ביותר'],
  admin_ops_level_ok: ['OK', 'OK', 'OK', 'OK', 'سليم', 'תקין'],
  admin_ops_level_warn: ['Warning', 'გაფრთხილება', 'Предупреждение', 'Uyarı', 'تحذير', 'אזהרה'],
  admin_ops_level_alert: ['Alert', 'განგაში', 'Тревога', 'Alarm', 'إنذار', 'התראה'],
  admin_ops_discovery_queue_open: ['Discovery queue: waiting or running', 'აღმოჩენის რიგი: მოლოდინში ან მიმდინარე', 'Очередь поиска: ожидают или выполняются', 'Keşif kuyruğu: bekleyen veya çalışan', 'قائمة الاكتشاف: منتظرة أو قيد التشغيل', 'תור הגילוי: ממתינים או רצים'],
  admin_ops_discovery_queue_lease_lapsed: ['Discovery queue: lapsed leases', 'აღმოჩენის რიგი: ვადაგასული ლიზინგი', 'Очередь поиска: истёкшие аренды', 'Keşif kuyruğu: süresi dolmuş kiralamalar', 'قائمة الاكتشاف: عقود حجز منتهية', 'תור הגילוי: חכירות שפגו'],
  admin_ops_verify_tasks_open: ['Verify tasks: waiting or running', 'Verify ამოცანები: მოლოდინში ან მიმდინარე', 'Задачи Verify: ожидают или выполняются', 'Verify görevleri: bekleyen veya çalışan', 'مهام Verify: منتظرة أو قيد التشغيل', 'משימות Verify: ממתינות או רצות'],
  admin_ops_verify_tasks_dead_24h: ['Verify tasks given up (24 h)', 'Verify ამოცანები, რომლებიც შეწყდა (24 სთ)', 'Задачи Verify, от которых отказались (24 ч)', 'Vazgeçilen Verify görevleri (24 sa)', 'مهام Verify المتوقف عنها (24 ساعة)', 'משימות Verify שננטשו (24 ש׳)'],
  admin_ops_marketplace_runs_open: ['Portal searches: waiting or running', 'პორტალების ძიება: მოლოდინში ან მიმდინარე', 'Поиск по порталам: ожидают или выполняются', 'Portal aramaları: bekleyen veya çalışan', 'عمليات البحث في البوابات: منتظرة أو قيد التشغيل', 'חיפושי פורטלים: ממתינים או רצים'],
  admin_ops_native_match_queue: ['Matching queue', 'დამთხვევების რიგი', 'Очередь сопоставления', 'Eşleşme kuyruğu', 'قائمة المطابقة', 'תור ההתאמות'],
  admin_ops_campaigns_stuck_finishing: ['Campaigns stuck while finishing', 'კამპანიები, რომლებიც დასრულებისას გაიჭედა', 'Кампании, зависшие при завершении', 'Bitirirken takılan kampanyalar', 'حملات متوقفة أثناء الإنهاء', 'קמפיינים שנתקעו בסיום'],
  admin_ops_campaigns_past_deadline: ['Campaigns past their search window', 'კამპანიები, რომელთა ძიების ვადა გავიდა', 'Кампании после окончания окна поиска', 'Arama süresi geçmiş kampanyalar', 'حملات تجاوزت نافذة البحث', 'קמפיינים שחלון החיפוש שלהם עבר'],
  admin_ops_verify_jobs_long_running: ['Verify reports running over an hour', 'Verify ანგარიშები, რომლებიც საათზე მეტხანს მიმდინარეობს', 'Отчёты Verify дольше часа', 'Bir saatten uzun süren Verify raporları', 'تقارير Verify قيد التشغيل لأكثر من ساعة', 'דוחות Verify שרצים יותר משעה'],
  admin_ops_reservations_overdue: ['Credit holds past expiry', 'კრედიტის დაკავებები ვადის გასვლის შემდეგ', 'Резервы кредитов после истечения срока', 'Süresi geçmiş kredi blokajları', 'حجوزات رصيد تجاوزت مدتها', 'החזקות קרדיט שתוקפן עבר'],
  admin_ops_find_buyers_runs_unbooked: ['Find Buyers provider runs not booked', 'Find Buyers პროვაიდერის გაშვებები, რომლებიც არ აღირიცხა', 'Запуски провайдера Find Buyers без учёта', 'Kaydedilmemiş Find Buyers sağlayıcı çalıştırmaları', 'عمليات مزود Find Buyers غير المسجلة', 'הרצות ספק של Find Buyers שלא נרשמו'],
  admin_ops_find_property_runs_unbooked: ['Find Property provider runs not booked', 'Find Property პროვაიდერის გაშვებები, რომლებიც არ აღირიცხა', 'Запуски провайдера Find Property без учёта', 'Kaydedilmemiş Find Property sağlayıcı çalıştırmaları', 'عمليات مزود Find Property غير المسجلة', 'הרצות ספק של Find Property שלא נרשמו'],
};
