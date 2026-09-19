// Part nine: the two operating-cost lines that reached the engine before
// they reached the bundle.
//
// OPERATING_COST_KEYS in src/investment/calculations/income.ts gained 'hoa'
// and 'repairsReserve' when the rental form started collecting them; the
// cost breakdown renders `inv_cost_${key}` for each, so the page printed
// "inv_cost_hoa" at a customer. scripts/investment-i18n-coverage.mjs now
// reads that list and checks every key it implies, which is why this is a
// one-time gap rather than a recurring one.
//
// Same shape as parts one to eight: key -> [en, ka, ru, tr, ar, he].

export const INVESTMENT_STRINGS_9 = {
  inv_cost_hoa: [
    'Building fee',
    'შენობის მოსაკრებელი',
    'Плата за обслуживание дома',
    'Aidat',
    'رسوم المبنى',
    'דמי ועד בית',
  ],
  inv_cost_repairsReserve: [
    'Repairs reserve',
    'სარემონტო რეზერვი',
    'Резерв на ремонт',
    'Onarım rezervi',
    'احتياطي الإصلاحات',
    'רזרבה לתיקונים',
  ],
};

/* The location the market search needs, asked inside the market panel. */
export const INVESTMENT_STRINGS_9B = {
  inv_field_district: ['District', 'უბანი', 'Район', 'Semt', 'الحي', 'שכונה'],
  inv_location_city_placeholder: [
    'e.g. Tbilisi',
    'მაგ. თბილისი',
    'напр. Тбилиси',
    'örn. Tiflis',
    'مثال: تبليسي',
    'לדוגמה: טביליסי',
  ],
  inv_location_district_placeholder: [
    'optional, narrows the search',
    'არასავალდებულო, ავიწროებს ძიებას',
    'необязательно, сужает поиск',
    'isteğe bağlı, aramayı daraltır',
    'اختياري، يضيّق نطاق البحث',
    'רשות, מצמצם את החיפוש',
  ],
  inv_location_needed: [
    'Add a city and Homatch will look up what similar homes are asking. Nothing you have entered changes.',
    'მიუთითეთ ქალაქი და Homatch მოძებნის, რას ითხოვენ მსგავს ბინებზე. თქვენ მიერ შეყვანილი არაფერი შეიცვლება.',
    'Укажите город, и Homatch посмотрит, сколько просят за похожие объекты. Ничего из введённого вами не изменится.',
    'Bir şehir girin; Homatch benzer evlerin ne istediğine baksın. Girdiğiniz hiçbir şey değişmez.',
    'أضف مدينة ليبحث Homatch عمّا تُطلب به المنازل المشابهة. لن يتغير أي شيء أدخلته.',
    'הוסיפו עיר ו-Homatch יבדוק מה מבקשים על דירות דומות. שום דבר שהזנתם לא ישתנה.',
  ],
};
