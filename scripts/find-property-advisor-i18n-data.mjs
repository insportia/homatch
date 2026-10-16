/*
 * Find Property advisor copy (2026-10-16): the human reading of each property against
 * the customer's own request, the compact results page, the original description and
 * the search animation. Order [en, ka, ru, tr, ar, he]. Match = დამთხვევა, თბილისი.
 *
 * Voice (owner): friendly, plain, like a good property advisor talking. No dashes in
 * customer text, no field names, no scores. Georgian uses the formal "თქვენ" like the
 * rest of Find Property. Silence in a listing is "not stated", never "no".
 */
export const FIND_PROPERTY_ADVISOR_STRINGS = {
  // Amenities, as nouns that read well alone and inside "X: confirmed in the listing."
  fpv_amenity_PARKING: ['Parking', 'პარკინგი', 'Парковка', 'Otopark', 'موقف سيارات', 'חניה'],
  fpv_amenity_BALCONY: ['Balcony', 'აივანი', 'Балкон', 'Balkon', 'شرفة', 'מרפסת'],
  fpv_amenity_TERRACE: ['Terrace', 'ტერასა', 'Терраса', 'Teras', 'تراس', 'טרסה'],
  fpv_amenity_ELEVATOR: ['Elevator', 'ლიფტი', 'Лифт', 'Asansör', 'مصعد', 'מעלית'],
  fpv_amenity_GARDEN: ['Garden', 'ბაღი', 'Сад', 'Bahçe', 'حديقة', 'גינה'],
  fpv_amenity_POOL: ['Pool', 'აუზი', 'Бассейн', 'Havuz', 'مسبح', 'בריכה'],
  fpv_amenity_FURNISHED: ['Furniture', 'ავეჯი', 'Мебель', 'Mobilya', 'أثاث', 'ריהוט'],
  fpv_amenity_CENTRAL_HEATING: ['Central heating', 'ცენტრალური გათბობა', 'Центральное отопление', 'Merkezi ısıtma', 'تدفئة مركزية', 'חימום מרכזי'],
  fpv_amenity_VIEW: ['View', 'ხედი', 'Вид из окна', 'Manzara', 'إطلالة', 'נוף'],
  fpv_amenity_PET_FRIENDLY: ['Pets allowed', 'შინაური ცხოველი დაშვებულია', 'Можно с животными', 'Evcil hayvan kabul', 'يُسمح بالحيوانات الأليفة', 'מותר עם חיות מחמד'],
  fpv_amenity_STORAGE: ['Storage room', 'სათავსო', 'Кладовая', 'Depo', 'مخزن', 'מחסן'],
  fpv_amenity_AIR_CONDITIONING: ['Air conditioning', 'კონდიციონერი', 'Кондиционер', 'Klima', 'تكييف', 'מיזוג אוויר'],
  fpv_amenity_OTHER: ['This feature', 'ეს პირობა', 'Это условие', 'Bu özellik', 'هذه الميزة', 'התנאי הזה'],

  // Short nouns used inside list sentences.
  fpv_noun_BUDGET: ['budget', 'ბიუჯეტი', 'бюджет', 'bütçe', 'الميزانية', 'התקציב'],
  fpv_noun_PRICE: ['price', 'ფასი', 'цена', 'fiyat', 'السعر', 'המחיר'],
  fpv_noun_AREA: ['size', 'ფართი', 'площадь', 'büyüklük', 'المساحة', 'הגודל'],
  fpv_noun_ROOMS: ['rooms', 'ოთახები', 'комнаты', 'oda sayısı', 'عدد الغرف', 'מספר החדרים'],
  fpv_noun_BEDROOMS: ['bedrooms', 'საძინებლები', 'спальни', 'yatak odaları', 'غرف النوم', 'חדרי השינה'],
  fpv_noun_DISTRICT: ['location', 'მდებარეობა', 'район', 'konum', 'الموقع', 'המיקום'],
  fpv_noun_BUILDING: ['building type', 'შენობის ტიპი', 'тип дома', 'bina tipi', 'نوع المبنى', 'סוג הבניין'],
  fpv_noun_RENOVATION: ['condition', 'მდგომარეობა', 'состояние', 'durum', 'الحالة', 'המצב'],
  fpv_noun_BUILD_YEAR: ['year built', 'აშენების წელი', 'год постройки', 'yapım yılı', 'سنة البناء', 'שנת הבנייה'],
  fpv_noun_FLOOR: ['floor', 'სართული', 'этаж', 'kat', 'الطابق', 'הקומה'],
  fpv_noun_NOT_FIRST_FLOOR: ['floor', 'სართული', 'этаж', 'kat', 'الطابق', 'הקומה'],
  fpv_noun_NOT_LAST_FLOOR: ['floor', 'სართული', 'этаж', 'kat', 'الطابق', 'הקומה'],
  fpv_noun_FURNISHED: ['furniture', 'ავეჯი', 'мебель', 'mobilya', 'الأثاث', 'הריהוט'],
  fpv_noun_UNFURNISHED: ['furniture', 'ავეჯი', 'мебель', 'mobilya', 'الأثاث', 'הריהוט'],

  // What fits: confirmed by the listing and matching the request.
  fpv_fit_BUDGET: ['Within your budget.', 'თქვენს ბიუჯეტში ჯდება.', 'Укладывается в ваш бюджет.', 'Bütçenize uyuyor.', 'ضمن ميزانيتك.', 'בתוך התקציב שלכם.'],
  fpv_fit_AREA: ['{{v}} m², the size you wanted.', '{{v}} მ², სწორედ ის ფართი, რაც გინდოდათ.', '{{v}} м², нужная вам площадь.', '{{v}} m², istediğiniz büyüklükte.', '{{v}} م²، المساحة التي تريدها.', '{{v}} מ״ר, הגודל שרציתם.'],
  fpv_fit_ROOMS: ['{{n}} rooms, as you asked.', '{{n}} ოთახი, როგორც ითხოვეთ.', 'Комнат: {{n}}, как вы и хотели.', '{{n}} oda, istediğiniz gibi.', '{{n}} غرف، كما طلبت.', '{{n}} חדרים, כמו שביקשתם.'],
  fpv_fit_BEDROOMS: ['{{n}} bedrooms, as you asked.', '{{n}} საძინებელი, როგორც ითხოვეთ.', 'Спален: {{n}}, как вы и хотели.', '{{n}} yatak odası, istediğiniz gibi.', '{{n}} غرف نوم، كما طلبت.', '{{n}} חדרי שינה, כמו שביקשתם.'],
  fpv_fit_DISTRICT: ['In {{district}}, one of the areas you chose.', 'მდებარეობს {{district}}ში, თქვენ მიერ არჩეულ უბანში.', 'Район {{district}}, один из выбранных вами.', '{{district}} bölgesinde, seçtiğiniz yerlerden biri.', 'في {{district}}، إحدى المناطق التي اخترتها.', 'ב{{district}}, אחד האזורים שבחרתם.'],
  fpv_fit_BUILDING: ['{{status}}, as you wanted.', '{{status}}, როგორც გინდოდათ.', '{{status}}, как вы и хотели.', '{{status}}, istediğiniz gibi.', '{{status}}، كما أردت.', '{{status}}, כמו שרציתם.'],
  fpv_fit_RENOVATION: ['{{status}}, the condition you wanted.', '{{status}}, ზუსტად ის მდგომარეობა, რაც გინდოდათ.', '{{status}}, нужное вам состояние.', '{{status}}, istediğiniz durumda.', '{{status}}، الحالة التي تريدها.', '{{status}}, במצב שרציתם.'],
  fpv_fit_BUILD_YEAR: ['Built in {{year}}, new enough for you.', 'აშენებულია {{year}} წელს, საკმარისად ახალია.', 'Построен в {{year}} году, достаточно новый.', '{{year}} yapımı, istediğiniz kadar yeni.', 'بُني عام {{year}}، حديث بما يكفي.', 'נבנה ב-{{year}}, חדש מספיק בשבילכם.'],
  fpv_fit_FLOOR: ['Floor {{n}}, within your range.', '{{n}} სართული, თქვენთვის სასურველ ფარგლებში.', '{{n}} этаж, в нужном вам диапазоне.', '{{n}}. kat, istediğiniz aralıkta.', 'الطابق {{n}}، ضمن ما تريده.', 'קומה {{n}}, בטווח שרציתם.'],
  fpv_fit_NOT_FIRST_FLOOR: ['Not on the first floor.', 'პირველ სართულზე არ არის.', 'Не на первом этаже.', 'Giriş katında değil.', 'ليس في الطابق الأول.', 'לא בקומה הראשונה.'],
  fpv_fit_NOT_LAST_FLOOR: ['Not on the top floor.', 'ბოლო სართულზე არ არის.', 'Не на последнем этаже.', 'En üst katta değil.', 'ليس في الطابق الأخير.', 'לא בקומה העליונה.'],
  fpv_fit_FURNISHED: ['Comes furnished, as you wanted.', 'ავეჯით, როგორც გინდოდათ.', 'С мебелью, как вы и хотели.', 'İstediğiniz gibi eşyalı.', 'مفروش، كما أردت.', 'מרוהטת, כמו שרציתם.'],
  fpv_fit_UNFURNISHED: ['Unfurnished, as you wanted.', 'ავეჯის გარეშე, როგორც გინდოდათ.', 'Без мебели, как вы и хотели.', 'İstediğiniz gibi eşyasız.', 'غير مفروش، كما أردت.', 'לא מרוהטת, כמו שרציתם.'],
  fpv_fit_AMENITY: ['{{amenity}}: confirmed in the listing.', '{{amenity}}: განცხადებაში დადასტურებულია.', '{{amenity}}: указано в объявлении.', '{{amenity}}: ilanda belirtilmiş.', '{{amenity}}: مذكور في الإعلان.', '{{amenity}}: מופיע במודעה.'],
  fpv_fit_AMENITY_MENTIONED: ['{{amenity}}: mentioned in the description.', '{{amenity}}: აღწერაშია ნახსენები.', '{{amenity}}: упоминается в описании.', '{{amenity}}: açıklamada geçiyor.', '{{amenity}}: مذكور في الوصف.', '{{amenity}}: מוזכר בתיאור.'],

  // What differs: stated by the listing and not what was asked for.
  fpv_miss_OVER_BUDGET: ['{{amount}} over your budget ({{pct}}% more).', 'თქვენს ბიუჯეტს {{amount}}ით აღემატება ({{pct}}%ით მეტი).', 'Дороже вашего бюджета на {{amount}} ({{pct}}%).', 'Bütçenizin {{amount}} üzerinde (%{{pct}} fazla).', 'أعلى من ميزانيتك بـ {{amount}} ({{pct}}% أكثر).', '{{amount}} מעל התקציב שלכם ({{pct}}% יותר).'],
  fpv_miss_AREA_SMALLER: ['{{v}} m², smaller than you wanted.', '{{v}} მ², სასურველზე პატარაა.', '{{v}} м², меньше, чем вы хотели.', '{{v}} m², istediğinizden küçük.', '{{v}} م²، أصغر مما أردت.', '{{v}} מ״ר, קטנה ממה שרציתם.'],
  fpv_miss_AREA_LARGER: ['{{v}} m², larger than you asked for.', '{{v}} მ², სასურველზე დიდია.', '{{v}} м², больше, чем вы искали.', '{{v}} m², istediğinizden büyük.', '{{v}} م²، أكبر مما طلبت.', '{{v}} מ״ר, גדולה ממה שביקשתם.'],
  fpv_miss_ROOMS: ['{{n}} rooms, not the number you asked for.', '{{n}} ოთახი, თქვენ სხვა რაოდენობას ეძებდით.', 'Комнат: {{n}}, вы искали другое количество.', '{{n}} oda, farklı bir sayı istemiştiniz.', '{{n}} غرف، وأنت طلبت عددًا آخر.', '{{n}} חדרים, ביקשתם מספר אחר.'],
  fpv_miss_BEDROOMS: ['{{n}} bedrooms, not what you asked for.', '{{n}} საძინებელი, თქვენ სხვა რაოდენობას ეძებდით.', 'Спален: {{n}}, вы искали другое количество.', '{{n}} yatak odası, farklı bir sayı istemiştiniz.', '{{n}} غرف نوم، وأنت طلبت عددًا آخر.', '{{n}} חדרי שינה, ביקשתם מספר אחר.'],
  fpv_miss_DISTRICT: ['In {{district}}, outside the areas you chose.', 'მდებარეობს {{district}}ში, თქვენ მიერ არჩეული უბნების გარეთ.', 'Район {{district}}, не из выбранных вами.', '{{district}} bölgesinde, seçtiğiniz yerlerin dışında.', 'في {{district}}، خارج المناطق التي اخترتها.', 'ב{{district}}, מחוץ לאזורים שבחרתם.'],
  fpv_miss_BUILDING: ['{{status}}, not the type you chose.', '{{status}}, თქვენ სხვა ტიპს ეძებდით.', '{{status}}, вы искали другой тип.', '{{status}}, farklı bir tip istemiştiniz.', '{{status}}، وأنت اخترت نوعًا آخر.', '{{status}}, בחרתם סוג אחר.'],
  fpv_miss_RENOVATION: ['{{status}}, not the condition you wanted.', '{{status}}, თქვენ სხვა მდგომარეობას ეძებდით.', '{{status}}, вы хотели другое состояние.', '{{status}}, farklı bir durum istemiştiniz.', '{{status}}، وأنت أردت حالة أخرى.', '{{status}}, רציתם מצב אחר.'],
  fpv_miss_BUILD_YEAR: ['Built in {{year}}, older than you wanted.', 'აშენებულია {{year}} წელს, სასურველზე ძველია.', 'Построен в {{year}} году, старше, чем вы хотели.', '{{year}} yapımı, istediğinizden eski.', 'بُني عام {{year}}، أقدم مما أردت.', 'נבנה ב-{{year}}, ישן ממה שרציתם.'],
  fpv_miss_FLOOR: ['Floor {{n}}, outside your range.', '{{n}} სართული, თქვენთვის სასურველ ფარგლებს გარეთაა.', '{{n}} этаж, вне нужного вам диапазона.', '{{n}}. kat, istediğiniz aralığın dışında.', 'الطابق {{n}}، خارج ما تريده.', 'קומה {{n}}, מחוץ לטווח שרציתם.'],
  fpv_miss_FIRST_FLOOR: ['On the first floor, which you wanted to avoid.', 'პირველ სართულზეა, რაც არ გინდოდათ.', 'На первом этаже, а вы этого не хотели.', 'Giriş katında, bunu istememiştiniz.', 'في الطابق الأول، وهذا ما أردت تجنبه.', 'בקומה הראשונה, ורציתם להימנע מזה.'],
  fpv_miss_LAST_FLOOR: ['On the top floor, which you wanted to avoid.', 'ბოლო სართულზეა, რაც არ გინდოდათ.', 'На последнем этаже, а вы этого не хотели.', 'En üst katta, bunu istememiştiniz.', 'في الطابق الأخير، وهذا ما أردت تجنبه.', 'בקומה העליונה, ורציתם להימנע מזה.'],
  fpv_miss_FURNISHED: ['Comes furnished, and you wanted it empty.', 'ავეჯითაა, თქვენ კი ცარიელს ეძებდით.', 'С мебелью, а вы искали без неё.', 'Eşyalı, siz eşyasız istemiştiniz.', 'مفروش، وأنت أردته فارغًا.', 'מרוהטת, ורציתם ריקה.'],
  fpv_miss_UNFURNISHED: ['Not furnished, and you wanted furniture.', 'ავეჯის გარეშეა, თქვენ კი ავეჯიანს ეძებდით.', 'Без мебели, а вы искали с мебелью.', 'Eşyasız, siz eşyalı istemiştiniz.', 'غير مفروش، وأنت أردته مفروشًا.', 'לא מרוהטת, ורציתם ריהוט.'],
  fpv_miss_AMENITY: ['{{amenity}}: the listing says there is none.', '{{amenity}}: განცხადების მიხედვით, არ აქვს.', '{{amenity}}: по объявлению, нет.', '{{amenity}}: ilana göre yok.', '{{amenity}}: حسب الإعلان، غير متوفر.', '{{amenity}}: לפי המודעה, אין.'],
  fpv_miss_EXCLUDED: ['{{amenity}}: you wanted to avoid this.', '{{amenity}}: ამის თავიდან არიდება გინდოდათ.', '{{amenity}}: вы хотели этого избежать.', '{{amenity}}: bundan kaçınmak istemiştiniz.', '{{amenity}}: أردت تجنب هذا.', '{{amenity}}: רציתם להימנע מזה.'],

  fpv_unknown_line: ['The listing doesn’t say: {{list}}. Worth asking the seller.', 'განცხადებაში არ წერია: {{list}}. ღირს გამყიდველს ჰკითხოთ.', 'В объявлении не указано: {{list}}. Стоит уточнить у продавца.', 'İlanda belirtilmemiş: {{list}}. Satıcıya sormaya değer.', 'لم يذكر الإعلان: {{list}}. يستحق أن تسأل البائع.', 'במודעה לא כתוב: {{list}}. כדאי לשאול את המוכר.'],

  // Worth knowing beyond the request.
  fpv_hi_BELOW_MARKET: ['About {{pct}}% cheaper per m² than similar homes in this search.', 'კვადრატული მეტრი დაახლოებით {{pct}}%ით იაფია, ვიდრე ამ ძიების მსგავს ბინებში.', 'Квадратный метр примерно на {{pct}}% дешевле, чем у похожих вариантов в этом поиске.', 'Metrekaresi bu aramadaki benzer evlerden yaklaşık %{{pct}} daha ucuz.', 'سعر المتر أرخص بنحو {{pct}}% من منازل مشابهة في هذا البحث.', 'המטר הרבוע זול בכ-{{pct}}% מבתים דומים בחיפוש הזה.'],
  fpv_hi_OWNER: ['Probably listed by the owner.', 'სავარაუდოდ, მეპატრონემ განათავსა.', 'Скорее всего, объявление от собственника.', 'Muhtemelen ev sahibi tarafından ilan edilmiş.', 'على الأرجح نشره المالك.', 'כנראה פורסם על ידי הבעלים.'],
  fpv_hi_FRESH: ['Listed or updated in the last two days.', 'ბოლო ორ დღეში განთავსდა ან განახლდა.', 'Опубликовано или обновлено за последние два дня.', 'Son iki günde yayınlandı veya güncellendi.', 'نُشر أو حُدّث خلال اليومين الماضيين.', 'פורסם או עודכן ביומיים האחרונים.'],
  fpv_hi_MULTI_SITE: ['Listed on {{n}} sites, so you can compare.', '{{n}} საიტზეა განთავსებული, ასე რომ შეგიძლიათ შეადაროთ.', 'Есть на {{n}} сайтах, можно сравнить.', '{{n}} sitede ilanı var, karşılaştırabilirsiniz.', 'منشور على {{n}} مواقع، فيمكنك المقارنة.', 'מופיע ב-{{n}} אתרים, אפשר להשוות.'],
  fpv_hi_PRICE_DIFFERS: ['The price differs between sites by {{amount}}.', 'საიტებზე ფასი {{amount}}ით განსხვავდება.', 'Цена на разных сайтах отличается на {{amount}}.', 'Fiyat siteler arasında {{amount}} farklı.', 'يختلف السعر بين المواقع بمقدار {{amount}}.', 'המחיר שונה בין האתרים ב-{{amount}}.'],

  // One-line recommendations.
  fpv_sum_top: ['Matches everything you asked for: {{list}}.', 'ყველაფერი ემთხვევა, რაც ითხოვეთ: {{list}}.', 'Подходит по всем вашим пожеланиям: {{list}}.', 'İstediğiniz her şeye uyuyor: {{list}}.', 'يطابق كل ما طلبته: {{list}}.', 'מתאים לכל מה שביקשתם: {{list}}.'],
  fpv_sum_top_plain: ['Matches everything you asked for.', 'ყველაფერი ემთხვევა, რაც ითხოვეთ.', 'Подходит по всем вашим пожеланиям.', 'İstediğiniz her şeye uyuyor.', 'يطابق كل ما طلبته.', 'מתאים לכל מה שביקשתם.'],
  fpv_sum_good: ['Good match on {{list}}. Ask the seller about {{ask}}.', 'კარგი დამთხვევაა: {{list}}. გამყიდველს ჰკითხეთ: {{ask}}.', 'Хорошо подходит: {{list}}. Уточните у продавца: {{ask}}.', 'İyi uyuyor: {{list}}. Satıcıya sorun: {{ask}}.', 'مطابقة جيدة: {{list}}. اسأل البائع عن: {{ask}}.', 'התאמה טובה: {{list}}. שאלו את המוכר על: {{ask}}.'],
  fpv_sum_good_plain: ['Good match on {{list}}.', 'კარგი დამთხვევაა: {{list}}.', 'Хорошо подходит: {{list}}.', 'İyi uyuyor: {{list}}.', 'مطابقة جيدة: {{list}}.', 'התאמה טובה: {{list}}.'],
  fpv_sum_ask_only: ['Could suit you. Ask the seller about {{ask}}.', 'შეიძლება მოგერგოთ. გამყიდველს ჰკითხეთ: {{ask}}.', 'Может подойти. Уточните у продавца: {{ask}}.', 'Size uyabilir. Satıcıya sorun: {{ask}}.', 'قد يناسبك. اسأل البائع عن: {{ask}}.', 'יכול להתאים לכם. שאלו את המוכר על: {{ask}}.'],
  fpv_sum_consider: ['Fits on {{list}}. One difference: {{miss}}', 'ემთხვევა: {{list}}. ერთი განსხვავება: {{miss}}', 'Подходит: {{list}}. Одно отличие: {{miss}}', 'Uyuyor: {{list}}. Bir fark var: {{miss}}', 'يناسب في: {{list}}. فرق واحد: {{miss}}', 'מתאים ב: {{list}}. הבדל אחד: {{miss}}'],
  fpv_sum_upgrade: ['A little above your budget, with more to offer: {{list}}.', 'ბიუჯეტზე ოდნავ ძვირია, მაგრამ მეტს გთავაზობთ: {{list}}.', 'Чуть дороже бюджета, но предлагает больше: {{list}}.', 'Bütçenizin biraz üzerinde ama daha fazlasını sunuyor: {{list}}.', 'أعلى قليلًا من ميزانيتك، لكنه يقدم أكثر: {{list}}.', 'קצת מעל התקציב, אבל מציע יותר: {{list}}.'],
  fpv_sum_upgrade_plain: ['A little above your budget, with more to offer.', 'ბიუჯეტზე ოდნავ ძვირია, მაგრამ მეტს გთავაზობთ.', 'Чуть дороже бюджета, но предлагает больше.', 'Bütçenizin biraz üzerinde ama daha fazlasını sunuyor.', 'أعلى قليلًا من ميزانيتك، لكنه يقدم أكثر.', 'קצת מעל התקציב, אבל מציע יותר.'],

  fpv_verdict_TOP: ['Best match', 'საუკეთესო დამთხვევა', 'Лучшее совпадение', 'En iyi eşleşme', 'أفضل تطابق', 'ההתאמה הטובה ביותר'],
  fpv_verdict_GOOD: ['Good match', 'კარგი დამთხვევა', 'Хорошо подходит', 'İyi eşleşme', 'مطابقة جيدة', 'התאמה טובה'],
  fpv_verdict_CONSIDER: ['Worth a look', 'ღირს ნახვა', 'Стоит посмотреть', 'Bakmaya değer', 'يستحق النظر', 'שווה הצצה'],
  fpv_verdict_UPGRADE: ['Slightly above budget', 'ბიუჯეტზე ოდნავ ძვირი', 'Чуть дороже бюджета', 'Bütçenin biraz üzerinde', 'أعلى قليلًا من الميزانية', 'קצת מעל התקציב'],

  // Results page.
  fpv_you_asked: ['You asked for', 'თქვენი მოთხოვნა', 'Вы искали', 'Aradığınız', 'طلبك', 'ביקשתם'],
  fpv_found_line: ['We found {{total}} homes. {{strong}} of them match everything you asked for.', 'ვიპოვეთ {{total}} ბინა. აქედან {{strong}} ყველაფერში ემთხვევა თქვენს მოთხოვნას.', 'Мы нашли {{total}} вариантов. {{strong}} из них подходят по всем пожеланиям.', '{{total}} ev bulduk. {{strong}} tanesi istediğiniz her şeye uyuyor.', 'وجدنا {{total}} منزلًا. {{strong}} منها تطابق كل ما طلبته.', 'מצאנו {{total}} בתים. {{strong}} מהם מתאימים לכל מה שביקשתם.'],
  fpv_found_line_none: ['We found {{total}} homes. None ticks every box yet, but many come close.', 'ვიპოვეთ {{total}} ბინა. ჯერ არცერთი არ ემთხვევა ყველა დეტალში, მაგრამ ბევრი ძალიან ახლოსაა.', 'Мы нашли {{total}} вариантов. Пока ни один не подходит идеально, но многие очень близки.', '{{total}} ev bulduk. Henüz hepsine tam uyan yok ama birçoğu çok yakın.', 'وجدنا {{total}} منزلًا. لا يطابق أيّ منها كل التفاصيل بعد، لكن كثيرًا منها قريب جدًا.', 'מצאנו {{total}} בתים. עדיין אין אחד שעונה על הכול, אבל רבים קרובים מאוד.'],
  fpv_rec_title: ['Recommended for you', 'თქვენთვის შერჩეული', 'Рекомендуем вам', 'Size önerdiklerimiz', 'نوصي لك بها', 'מומלצים בשבילכם'],
  fpv_rec_body: ['These fit what you asked for. A few details may still be worth a quick check with the seller.', 'ეს ბინები თქვენს მოთხოვნას ერგება. ზოგ დეტალზე შეიძლება გამყიდველს მოკლედ ჰკითხოთ.', 'Эти варианты подходят под ваш запрос. Некоторые детали стоит уточнить у продавца.', 'Bunlar isteğinize uyuyor. Bazı ayrıntıları satıcıya kısaca sormak isteyebilirsiniz.', 'هذه تناسب ما طلبته. قد يستحق بعض التفاصيل سؤالًا سريعًا للبائع.', 'אלה מתאימים למה שביקשתם. על כמה פרטים כדאי אולי לשאול את המוכר.'],
  fpv_other_title: ['Also worth a look', 'ასევე ღირს ნახვა', 'Тоже стоит посмотреть', 'Bunlara da bakın', 'تستحق النظر أيضًا', 'שווה להציץ גם ב'],
  fpv_other_body: ['Close to what you want. We point out the difference on each one.', 'თქვენს სურვილთან ახლოსაა. თითოეულზე გეტყვით, რით განსხვავდება.', 'Близко к тому, что вы ищете. На каждом указываем, в чём разница.', 'İstediğinize yakın. Her birinde farkı belirtiyoruz.', 'قريبة مما تريده. نوضح الفرق في كل واحد منها.', 'קרובים למה שאתם רוצים. בכל אחד נציין מה שונה.'],
  fpv_see_assessment: ['See our assessment', 'ნახეთ ჩვენი შეფასება', 'Наша оценка', 'Değerlendirmemizi görün', 'اطّلع على تقييمنا', 'לחוות הדעת שלנו'],
  fpv_rooms_area: ['{{rooms}} rooms · {{area}} m²', '{{rooms}} ოთახი · {{area}} მ²', 'Комнат: {{rooms}} · {{area}} м²', '{{rooms}} oda · {{area}} m²', '{{rooms}} غرف · {{area}} م²', '{{rooms}} חדרים · {{area}} מ״ר'],
  fpv_area_only: ['{{area}} m²', '{{area}} მ²', '{{area}} м²', '{{area}} m²', '{{area}} م²', '{{area}} מ״ר'],
  fpv_rooms_only: ['{{rooms}} rooms', '{{rooms}} ოთახი', 'Комнат: {{rooms}}', '{{rooms}} oda', '{{rooms}} غرف', '{{rooms}} חדרים'],
  fpv_filters: ['Filters and sorting', 'ფილტრები და დალაგება', 'Фильтры и сортировка', 'Filtreler ve sıralama', 'التصفية والترتيب', 'סינון ומיון'],
  fpv_status_done: ['All {{n}} sites checked.', '{{n}}ვე საიტი შემოწმდა.', 'Проверены все сайты: {{n}}.', '{{n}} sitenin hepsi kontrol edildi.', 'تم فحص جميع المواقع ({{n}}).', 'כל {{n}} האתרים נבדקו.'],
  fpv_status_partial: ['{{done}} of {{n}} sites answered.', '{{n}} საიტიდან {{done}}მა უპასუხა.', 'Ответили {{done}} из {{n}} сайтов.', '{{n}} siteden {{done}} tanesi yanıt verdi.', 'استجاب {{done}} من أصل {{n}} مواقع.', '{{done}} מתוך {{n}} אתרים ענו.'],
  fpv_status_running: ['Still checking {{n}} of the sites.', 'ჯერ კიდევ ვამოწმებთ {{n}} საიტს.', 'Ещё проверяем сайтов: {{n}}.', 'Hâlâ {{n}} siteyi kontrol ediyoruz.', 'ما زلنا نتحقق من {{n}} مواقع.', 'עדיין בודקים {{n}} אתרים.'],
  fpv_status_details: ['Details', 'დეტალები', 'Подробнее', 'Ayrıntılar', 'التفاصيل', 'פרטים'],
  fpv_search_again: ['Search again', 'თავიდან მოძებნა', 'Искать заново', 'Yeniden ara', 'ابحث مجددًا', 'לחפש שוב'],
  fpv_search_again_note: ['Some sites did not answer this time. Searching again often finds more.', 'ზოგმა საიტმა ამჯერად არ უპასუხა. თავიდან ძიება ხშირად მეტს პოულობს.', 'Некоторые сайты сейчас не ответили. Повторный поиск часто находит больше.', 'Bazı siteler bu sefer yanıt vermedi. Yeniden aramak çoğu zaman daha fazlasını bulur.', 'لم تستجب بعض المواقع هذه المرة. البحث مجددًا يجد المزيد غالبًا.', 'חלק מהאתרים לא ענו הפעם. חיפוש חוזר מוצא לרוב יותר.'],

  // Property assessment page.
  fpv_desc_title: ['Original description', 'ორიგინალი აღწერა', 'Оригинальное описание', 'Orijinal açıklama', 'الوصف الأصلي', 'התיאור המקורי'],
  fpv_desc_note: ['As published on {{source}}, in its original language.', 'როგორც {{source}}ზე გამოქვეყნდა, ორიგინალ ენაზე.', 'Как опубликовано на {{source}}, на языке оригинала.', '{{source}} sitesinde yayınlandığı gibi, orijinal dilinde.', 'كما نُشر على {{source}}، بلغته الأصلية.', 'כפי שפורסם ב-{{source}}, בשפת המקור.'],
  fpv_desc_more: ['Show the full description', 'სრული აღწერის ნახვა', 'Показать полностью', 'Tamamını göster', 'عرض الوصف كاملًا', 'להצגת התיאור המלא'],
  fpv_desc_less: ['Show less', 'ნაკლების ნახვა', 'Свернуть', 'Daha az göster', 'عرض أقل', 'להציג פחות'],
  fpv_assess_title: ['Our assessment', 'ჩვენი შეფასება', 'Наша оценка', 'Değerlendirmemiz', 'تقييمنا', 'חוות הדעת שלנו'],
  fpv_g_fits: ['What fits your request', 'რა ემთხვევა თქვენს მოთხოვნას', 'Что подходит', 'İsteğinize uyanlar', 'ما يناسب طلبك', 'מה מתאים לבקשה שלכם'],
  fpv_g_misses: ['What differs from your request', 'რით განსხვავდება', 'Чем отличается', 'İsteğinizden farklı olanlar', 'ما يختلف عن طلبك', 'במה זה שונה'],
  fpv_g_unknown: ['Not stated, worth asking', 'არ წერია, ღირს კითხვა', 'Не указано, стоит уточнить', 'Belirtilmemiş, sormaya değer', 'غير مذكور، يستحق السؤال', 'לא כתוב, כדאי לשאול'],
  fpv_g_highlights: ['Worth knowing', 'კარგია, თუ იცით', 'Полезно знать', 'Bilmeniz iyi olur', 'من المفيد معرفته', 'כדאי לדעת'],
  fpv_g_summary: ['In short', 'მოკლედ', 'Коротко', 'Kısacası', 'باختصار', 'בקצרה'],
  fpv_assess_note: ['Our reading uses only what the listing says. If something isn’t mentioned, we don’t assume it’s missing.', 'ჩვენი შეფასება მხოლოდ იმას ეყრდნობა, რაც განცხადებაში წერია. თუ რამე არ არის ნახსენები, არ ვთვლით, რომ არ არსებობს.', 'Мы опираемся только на то, что написано в объявлении. Если что-то не упомянуто, мы не считаем, что этого нет.', 'Yalnızca ilanda yazanlara dayanıyoruz. Bir şey belirtilmemişse, olmadığını varsaymıyoruz.', 'نعتمد فقط على ما يذكره الإعلان. إن لم يُذكر شيء فلا نفترض أنه غير موجود.', 'אנחנו נשענים רק על מה שכתוב במודעה. אם משהו לא מוזכר, אנחנו לא מניחים שהוא חסר.'],

  // Search animation.
  fpv_elapsed: ['Searching for {{time}}', 'ვეძებთ უკვე {{time}}', 'Ищем уже {{time}}', '{{time}} süredir arıyoruz', 'نبحث منذ {{time}}', 'מחפשים כבר {{time}}'],
  fpv_duration_note: ['A search usually takes 10 to 30 minutes, depending on how wide it is and how quickly the sites answer. You can leave this page; we keep looking.', 'ძიებას ჩვეულებრივ 10-დან 30 წუთამდე სჭირდება, იმის მიხედვით, რამდენად ფართოა და რა სისწრაფით პასუხობენ საიტები. შეგიძლიათ ეს გვერდი დატოვოთ, ჩვენ ძებნას გავაგრძელებთ.', 'Обычно поиск занимает от 10 до 30 минут, в зависимости от охвата и скорости ответа сайтов. Можно уйти со страницы, мы продолжим искать.', 'Arama genellikle 10 ila 30 dakika sürer; kapsamına ve sitelerin ne kadar hızlı yanıt verdiğine bağlıdır. Bu sayfadan çıkabilirsiniz, aramaya devam ederiz.', 'يستغرق البحث عادةً من 10 إلى 30 دقيقة، حسب اتساعه وسرعة استجابة المواقع. يمكنك مغادرة هذه الصفحة، وسنواصل البحث.', 'חיפוש לוקח בדרך כלל 10 עד 30 דקות, לפי ההיקף ומהירות התגובה של האתרים. אפשר לעזוב את הדף, אנחנו ממשיכים לחפש.'],
  fpv_field_label: ['Sites being searched for you', 'საიტები, სადაც თქვენთვის ვეძებთ', 'Сайты, где мы ищем для вас', 'Sizin için aradığımız siteler', 'المواقع التي نبحث فيها من أجلك', 'האתרים שבהם אנחנו מחפשים בשבילכם'],
  // Source selector on the results.
  fpv_sources_nav: ['Property sites', 'საიტები', 'Сайты недвижимости', 'Emlak siteleri', 'مواقع العقارات', 'אתרי נדל״ן'],
  fpv_all_sources: ['All sources', 'ყველა წყარო', 'Все источники', 'Tüm kaynaklar', 'جميع المصادر', 'כל המקורות'],
  fpv_and: ['and', 'და', 'и', 've', 'و', 'ו'],

  // Results pages (owner, 2026-10-16): best matches and possible duplicates open as their own pages.
  fpv_quick_views: ['Quick views', 'სწრაფი ხედები', 'Быстрый просмотр', 'Hızlı görünümler', 'عروض سريعة', 'תצוגות מהירות'],
  fpv_best_cta: ['Best matches ({{n}})', 'საუკეთესო დამთხვევები ({{n}})', 'Лучшие совпадения ({{n}})', 'En iyi eşleşmeler ({{n}})', 'أفضل التطابقات ({{n}})', 'ההתאמות הטובות ביותר ({{n}})'],
  fpv_dups_cta: ['Possible duplicates ({{n}})', 'შესაძლო დუბლიკატები ({{n}})', 'Возможные дубликаты ({{n}})', 'Olası kopyalar ({{n}})', 'تكرارات محتملة ({{n}})', 'כפילויות אפשריות ({{n}})'],
  fpv_best_title: ['Your best matches', 'თქვენი საუკეთესო დამთხვევები', 'Ваши лучшие совпадения', 'En iyi eşleşmeleriniz', 'أفضل التطابقات لك', 'ההתאמות הטובות ביותר עבורכם'],
  fpv_best_body: ['These homes fit everything you asked for and were checked recently.', 'ეს ბინები ყველაფერში ერგება თქვენს მოთხოვნას და ცოტა ხნის წინ გადავამოწმეთ.', 'Эти квартиры подходят по всем вашим условиям и недавно проверены.', 'Bu evler istediğiniz her şeye uyuyor ve yakın zamanda kontrol edildi.', 'هذه المنازل تطابق كل ما طلبته وتم التحقق منها مؤخرًا.', 'הדירות האלה מתאימות לכל מה שביקשתם ונבדקו לאחרונה.'],
  fpv_dups_title: ['Homes that may be listed twice', 'ბინები, რომლებიც შეიძლება ორჯერ იყოს გამოქვეყნებული', 'Квартиры, которые могут быть опубликованы дважды', 'İki kez ilan edilmiş olabilecek evler', 'منازل قد تكون معروضة مرتين', 'דירות שאולי פורסמו פעמיים'],
  fpv_dups_body: ['Each home is shown together with the listings that look like the same flat, so you can compare prices and choose.', 'თითოეულ ბინასთან ერთად ხედავთ განცხადებებს, რომლებიც იგივე ბინას ჰგავს. ასე ფასებს ადვილად შეადარებთ და აირჩევთ.', 'Рядом с каждой квартирой показаны объявления, похожие на ту же квартиру, чтобы вы могли сравнить цены и выбрать.', 'Her ev, aynı daire gibi görünen ilanlarla birlikte gösterilir; fiyatları karşılaştırıp seçebilirsiniz.', 'يظهر كل منزل مع الإعلانات التي تبدو للشقة نفسها، لتتمكن من مقارنة الأسعار والاختيار.', 'כל דירה מוצגת יחד עם המודעות שנראות כמו אותה דירה, כדי שתוכלו להשוות מחירים ולבחור.'],
  fpv_all_results: ['All results', 'ყველა შედეგი', 'Все результаты', 'Tüm sonuçlar', 'كل النتائج', 'כל התוצאות'],
  fpv_filter_best: ['Best matches only', 'მხოლოდ საუკეთესო დამთხვევები', 'Только лучшие совпадения', 'Yalnızca en iyi eşleşmeler', 'أفضل التطابقات فقط', 'רק ההתאמות הטובות ביותר'],
  fpv_filter_dups: ['Possible duplicates', 'შესაძლო დუბლიკატები', 'Возможные дубликаты', 'Olası kopyalar', 'تكرارات محتملة', 'כפילויות אפשריות'],
  // Live search controls.
  fpv_play_sub: ['A short game while we search', 'პატარა თამაში, სანამ ვეძებთ', 'Небольшая игра, пока мы ищем', 'Biz ararken kısa bir oyun', 'لعبة قصيرة بينما نبحث', 'משחק קצר בזמן שאנחנו מחפשים'],
  fpv_stop_confirm: ['Stop this search?', 'შევწყვიტოთ ძიება?', 'Остановить поиск?', 'Arama durdurulsun mu?', 'إيقاف هذا البحث؟', 'לעצור את החיפוש?'],
  fpv_stop_yes: ['Yes, stop', 'დიახ, შევწყვიტოთ', 'Да, остановить', 'Evet, durdur', 'نعم، أوقف', 'כן, לעצור'],
  fpv_keep_searching: ['Keep searching', 'ძიების გაგრძელება', 'Продолжить поиск', 'Aramaya devam et', 'متابعة البحث', 'להמשיך לחפש'],
  fpv_sites_n: ['{{n}} property sites', '{{n}} უძრავი ქონების საიტი', 'Сайтов недвижимости: {{n}}', '{{n}} emlak sitesi', '{{n}} مواقع عقارية', '{{n}} אתרי נדל״ן'],
  fpv_sites_generic: ["Georgia's leading property sites", 'საქართველოს წამყვანი უძრავი ქონების საიტები', 'Ведущие сайты недвижимости Грузии', "Gürcistan'ın önde gelen emlak siteleri", 'أبرز مواقع العقارات في جورجيا', 'אתרי הנדל״ן המובילים בגאורגיה'],
};
