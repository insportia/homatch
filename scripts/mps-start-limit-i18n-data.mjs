/*
 * Find Property — the per-user search start quota (2026-10-18, resilience): what a person sees
 * when they started many searches in a short time. Order: en, ka, ru, tr, ar, he.
 */
export const MPS_START_LIMIT_ADDED = {
  mps_error_start_rate_limited: [
    'You have started many searches in a short time. Please wait a few minutes before starting another.',
    'მოკლე დროში ბევრი ძიება დაიწყეთ. ახალი ძიების დაწყებამდე რამდენიმე წუთი დაელოდეთ.',
    'Вы начали много поисков за короткое время. Подождите несколько минут, прежде чем начать новый.',
    'Kısa sürede çok sayıda arama başlattınız. Yeni bir arama başlatmadan önce lütfen birkaç dakika bekleyin.',
    'لقد بدأت عمليات بحث كثيرة في وقت قصير. يُرجى الانتظار بضع دقائق قبل بدء بحث جديد.',
    'התחלתם חיפושים רבים בזמן קצר. אנא המתינו כמה דקות לפני שתתחילו חיפוש נוסף.',
  ],
};
