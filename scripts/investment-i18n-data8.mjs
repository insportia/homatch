// Part eight: the flip's own scenario tables.
//
// They replaced the shared stress grid and the capital diagram on the
// renovate-and-resell result, because those two are built on the rental
// engine and a flip's position is not the rental engine's — see the note
// at the top of RenovateResults.tsx.
//
// Same shape as parts one to seven: key -> [en, ka, ru, tr, ar, he].

export const INVESTMENT_STRINGS_8 = {
  inv_mod_resale_scenarios_title: [
    'If the sale goes differently',
    'თუ გაყიდვა სხვაგვარად წავა',
    'Если продажа пойдёт иначе',
    'Satış farklı giderse',
    'إذا سار البيع بشكل مختلف',
    'אם המכירה תלך אחרת',
  ],
  inv_mod_resale_scenarios_sub: [
    'Your resale assumption, moved up and down. Each row is the whole deal recalculated, not an approximation — and none of them is a forecast.',
    'თქვენი დაშვება გადაყიდვაზე, ზემოთ და ქვემოთ გადაწეული. ყოველი სტრიქონი მთელი გარიგების ხელახალი გამოთვლაა და არა მიახლოება — და არცერთი მათგანი პროგნოზი არ არის.',
    'Ваше допущение о перепродаже, сдвинутое вверх и вниз. Каждая строка — полный пересчёт сделки, а не приближение, и ни одна из них не прогноз.',
    'Satış varsayımınız, yukarı ve aşağı kaydırılmış hâliyle. Her satır işlemin tamamının yeniden hesaplanmasıdır, yaklaşık değer değil; hiçbiri öngörü değildir.',
    'افتراضك لإعادة البيع، محرَّكًا صعودًا وهبوطًا. كل صف إعادة حساب كاملة للصفقة لا تقريبًا، ولا أحد منها توقّع.',
    'הנחת המכירה שלכם, מוזזת מעלה ומטה. כל שורה היא חישוב מלא מחדש של העסקה, לא קירוב — ואף אחת מהן אינה תחזית.',
  ],
  inv_resale_scenarios_caption: [
    'Profit and return at different sale prices',
    'მოგება და უკუგება სხვადასხვა გასაყიდ ფასზე',
    'Прибыль и доходность при разных ценах продажи',
    'Farklı satış fiyatlarında kâr ve getiri',
    'الربح والعائد عند أسعار بيع مختلفة',
    'רווח ותשואה במחירי מכירה שונים',
  ],
  inv_resale_scenarios_note: [
    'Every row is the same deal with one number changed. Where the profit turns negative is the break-even, and how far away that row is is your margin of safety.',
    'ყოველი სტრიქონი იგივე გარიგებაა ერთი შეცვლილი ციფრით. სადაც მოგება უარყოფითი ხდება, ეს ნულოვანი წერტილია, და რამდენად შორსაა ის სტრიქონი — თქვენი უსაფრთხოების მარაგი.',
    'Каждая строка — та же сделка с одной изменённой цифрой. Там, где прибыль уходит в минус, находится точка безубыточности, а расстояние до неё — ваш запас прочности.',
    'Her satır, tek bir rakamı değiştirilmiş aynı işlemdir. Kârın eksiye döndüğü yer başabaş noktasıdır; o satırın uzaklığı da güvenlik payınızdır.',
    'كل صف هو الصفقة نفسها مع تغيير رقم واحد. حيث يصبح الربح سالبًا تكون نقطة التعادل، وبُعد ذلك الصف هو هامش أمانك.',
    'כל שורה היא אותה עסקה עם מספר אחד ששונה. היכן שהרווח הופך שלילי זו נקודת האיזון, והמרחק לשורה הזו הוא מרווח הביטחון שלכם.',
  ],
  inv_col_sale_price: [
    'Sale price',
    'გასაყიდი ფასი',
    'Цена продажи',
    'Satış fiyatı',
    'سعر البيع',
    'מחיר המכירה',
  ],
  inv_scenario_your_assumption: [
    'your assumption',
    'თქვენი დაშვება',
    'ваше допущение',
    'sizin varsayımınız',
    'افتراضك',
    'ההנחה שלכם',
  ],

  inv_mod_flip_timing_title: [
    'If it takes longer',
    'თუ მეტი დრო დასჭირდა',
    'Если займёт дольше',
    'Daha uzun sürerse',
    'إذا استغرق وقتًا أطول',
    'אם זה ייקח יותר זמן',
  ],
  inv_mod_flip_timing_sub: [
    'The profit barely moves — only the carry does. The annualised return moves a great deal, and that gap is the whole argument for getting it back on the market.',
    'მოგება თითქმის არ იცვლება — მხოლოდ ფლობის ხარჯი. წლიური უკუგება კი მკვეთრად იცვლება, და სწორედ ეს სხვაობაა მთავარი არგუმენტი სწრაფად გაყიდვის სასარგებლოდ.',
    'Прибыль почти не меняется — меняются только расходы на содержание. А годовая доходность меняется сильно, и именно этот разрыв — весь аргумент в пользу скорейшей продажи.',
    'Kâr neredeyse değişmez; değişen yalnızca taşıma maliyetidir. Yıllık getiri ise çok değişir, ve bu fark mülkü bir an önce piyasaya çıkarmanın bütün gerekçesidir.',
    'الربح لا يكاد يتغير، وإنما تتغير تكلفة الاحتفاظ وحدها. أما العائد السنوي فيتغير كثيرًا، وهذا الفارق هو كل الحجة لإعادته إلى السوق سريعًا.',
    'הרווח כמעט לא זז — רק עלות ההחזקה. התשואה השנתית זזה הרבה, והפער הזה הוא כל הנימוק להחזיר את הנכס לשוק מהר.',
  ],
  inv_timing_as_planned: [
    'As planned, {{n}} months',
    'როგორც დაგეგმილი, {{n}} თვე',
    'Как запланировано, {{n}} месяцев',
    'Planlandığı gibi, {{n}} ay',
    'كما هو مخطط، {{n}} أشهر',
    'כמתוכנן, {{n}} חודשים',
  ],
  inv_timing_months: [
    '{{n}} months',
    '{{n}} თვე',
    '{{n}} месяцев',
    '{{n}} ay',
    '{{n}} أشهر',
    '{{n}} חודשים',
  ],
  inv_flip_timing_note: [
    'Each row carries the extra months of holding costs and sells at the same price.',
    'ყოველი სტრიქონი ითვალისწინებს დამატებით თვეებს ფლობის ხარჯებით და იმავე ფასად ყიდის.',
    'Каждая строка учитывает дополнительные месяцы расходов на содержание и продаёт по той же цене.',
    'Her satır fazladan ayların elde tutma maliyetini taşır ve aynı fiyattan satar.',
    'كل صف يتحمل أشهر الاحتفاظ الإضافية ويبيع بالسعر نفسه.',
    'כל שורה נושאת את חודשי ההחזקה הנוספים ומוכרת באותו מחיר.',
  ],
};
