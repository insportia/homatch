// Part ten: the Investment Value flow's own sensitivity.
//
// Every other strategy is sensitive to things outside the investor's
// control. This one is sensitive to the requirement, which is a choice —
// so the table says what insisting on it costs in buying power.
//
// Same shape as parts one to nine: key -> [en, ka, ru, tr, ar, he].

export const INVESTMENT_STRINGS_10 = {
  inv_mod_requirement_eyebrow: [
    'Your requirement',
    'თქვენი მოთხოვნა',
    'Ваше требование',
    'Sizin şartınız',
    'شرطك',
    'הדרישה שלכם',
  ],
  inv_mod_requirement_title: [
    'What the requirement costs you',
    'რა გიჯდებათ ეს მოთხოვნა',
    'Во что обходится ваше требование',
    'Bu şart size neye mal oluyor',
    'كم يكلفك هذا الشرط',
    'כמה הדרישה הזו עולה לכם',
  ],
  inv_mod_requirement_sub: [
    'The same property at a different required return. Insisting on more means paying less, and this is exactly how much less.',
    'იგივე ქონება სხვა მოთხოვნილ უკუგებაზე. მეტის მოთხოვნა ნაკლების გადახდას ნიშნავს, და აი, ზუსტად რამდენით ნაკლების.',
    'Тот же объект при другой требуемой доходности. Требовать больше — значит платить меньше, и вот ровно насколько меньше.',
    'Aynı mülk, farklı bir hedef getiriyle. Daha fazlasında ısrar etmek daha azını ödemek demektir; işte tam olarak ne kadar azı.',
    'العقار نفسه بعائد مطلوب مختلف. الإصرار على عائد أعلى يعني دفع سعر أقل، وهذا هو مقدار الفرق بالضبط.',
    'אותו נכס בתשואה נדרשת אחרת. להתעקש על יותר פירושו לשלם פחות, וזה בדיוק כמה פחות.',
  ],
  inv_requirement_caption: [
    'Maximum and target entry price at each required return',
    'მაქსიმალური და სამიზნე შესვლის ფასი თითოეულ მოთხოვნილ უკუგებაზე',
    'Максимальная и целевая цена входа при каждой требуемой доходности',
    'Her hedef getiride azami ve hedef giriş fiyatı',
    'الحد الأقصى وسعر الدخول المستهدف عند كل عائد مطلوب',
    'מחיר מרבי ומחיר כניסה מטרה בכל תשואה נדרשת',
  ],
  inv_requirement_note: [
    'Each row is a full re-solve, not a straight line through the middle: the cost of buying scales with the price, so the relationship bends.',
    'ყოველი სტრიქონი სრული ხელახალი ამოხსნაა და არა სწორი ხაზი შუაში: ყიდვის ხარჯი ფასთან ერთად იზრდება, ამიტომ დამოკიდებულება იღუნება.',
    'Каждая строка — полный пересчёт, а не прямая через середину: расходы на покупку растут вместе с ценой, поэтому зависимость нелинейна.',
    'Her satır tam bir yeniden çözümdür, ortadan geçen bir doğru değil: alım maliyeti fiyatla birlikte arttığı için ilişki eğrilir.',
    'كل صف إعادة حل كاملة لا خطًا مستقيمًا في المنتصف: تكلفة الشراء تزداد مع السعر، فتنحني العلاقة.',
    'כל שורה היא פתרון מלא מחדש, לא קו ישר באמצע: עלות הרכישה גדלה עם המחיר, ולכן היחס מתעקם.',
  ],
  inv_requirement_yours: ['yours', 'თქვენი', 'ваше', 'sizinki', 'شرطك', 'שלכם'],
  inv_col_required_return: [
    'Required return',
    'მოთხოვნილი უკუგება',
    'Требуемая доходность',
    'Hedef getiri',
    'العائد المطلوب',
    'תשואה נדרשת',
  ],
  inv_col_required_yield: [
    'Required yield',
    'მოთხოვნილი სარგებელი',
    'Требуемая доходность',
    'Hedef getiri oranı',
    'العائد المشترط',
    'תשואה נדרשת',
  ],
};
