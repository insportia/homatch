/*
 * PANEL POLISH (owner, 2026-10-17): earlier internal matches as a closed band that can be
 * hidden, the opened-contacts choice in the clear dialog, and a push "Turn off" button that
 * no longer reads as the status sentence. Order: en, ka, ru, tr, ar, he.
 * Terminology: match = დამთხვევა; never "confirmed buyer".
 */
export const PANEL_POLISH_ADDED = {
  notif_push_turn_off: ['Turn off', 'გამორთვა', 'Выключить', 'Kapat', 'إيقاف', 'כיבוי'],
  fbrx_legacy_hint: [
    'From earlier internal searches. The current search’s people are above.',
    'ადრინდელი შიდა ძიებებიდან. მიმდინარე ძიების ადამიანები ზემოთაა.',
    'Из прежних внутренних поисков. Люди из текущего поиска — выше.',
    'Önceki iç aramalardan. Güncel aramanın kişileri yukarıda.',
    'من عمليات بحث داخلية سابقة. أشخاص البحث الحالي في الأعلى.',
    'מחיפושים פנימיים קודמים. האנשים מהחיפוש הנוכחי מופיעים למעלה.',
  ],
  fbrx_legacy_expand: ['Show them', 'ნახვა', 'Показать', 'Göster', 'عرضها', 'הצגה'],
  fbrx_legacy_collapse: ['Hide the list', 'სიის დაკეცვა', 'Свернуть список', 'Listeyi kapat', 'طيّ القائمة', 'סגירת הרשימה'],
  fbrx_legacy_hide: ['Remove from my lists', 'სიებიდან მოშორება', 'Убрать из моих списков', 'Listelerimden kaldır', 'إزالتها من قوائمي', 'הסרה מהרשימות שלי'],
  fbrx_clear_include_opened: [
    'Also hide the contacts you already opened: {{n}}',
    'ასევე დაიმალოს უკვე გახსნილი კონტაქტები: {{n}}',
    'Скрыть и уже открытые контакты: {{n}}',
    'Daha önce açtığınız kişileri de gizle: {{n}}',
    'إخفاء جهات الاتصال التي فتحتها أيضًا: {{n}}',
    'להסתיר גם אנשי קשר שכבר פתחתם: {{n}}',
  ],
  fbrx_clear_include_opened_hint: [
    'They leave these lists only. Nothing is deleted, and the payment and contact record stay.',
    'ისინი მხოლოდ ამ სიებიდან გაქრება. არაფერი იშლება — გადახდა და კონტაქტის ჩანაწერი რჩება.',
    'Они исчезнут только из этих списков. Ничего не удаляется — оплата и запись контакта сохраняются.',
    'Yalnızca bu listelerden kalkar. Hiçbir şey silinmez; ödeme ve kişi kaydı kalır.',
    'تختفي من هذه القوائم فقط. لا يُحذف شيء، ويبقى الدفع وسجل جهة الاتصال.',
    'הם יוסרו רק מהרשימות האלה. דבר אינו נמחק — התשלום ורשומת איש הקשר נשמרים.',
  ],
};
