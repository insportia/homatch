/*
 * HOW HOMI LOOKS WHILE YOU WAIT, from what you just wrote.
 *
 * A face for the moment between sending and the first word of the answer:
 * surprised at an exclamation, searching for a property, warm at thanks,
 * encouraging when someone is worried, thinking otherwise. It is presentation
 * only. It never claims to show what the model is doing.
 *
 * Six languages, plain patterns, no model. Runtime-neutral.
 */

export type WaitingMood = 'surprised' | 'searching' | 'happy' | 'greeting' | 'encouraging' | 'thinking';

const norm = (t: string) => t.toLocaleLowerCase().replace(/\s+/g, ' ').trim();

const SURPRISE = /(!{2,}|\?!|!\?|\bwow\b|really\?|seriously|unbelievable|ვაუ|მართლა|ნამდვილად\?|წარმოუდგენელ|вау|неужели|серьёзно|серьезно|ничего себе|vay|gerçekten mi|inanılmaz|واو|حقا|حقًا|معقول|וואו|באמת\?|לא יאמן)/u;
const WORRY = /(worried|afraid|scared|problem|help me|stuck|lost money|fraud|scam|ვღელავ|მეშინია|შემეშინდა|პრობლემ|დამეხმარე|მოტყუ|თაღლით|переживаю|боюсь|проблем|помоги|обман|мошенн|endişe|korkuyorum|sorun|yardım et|dolandır|قلق|أخاف|مشكلة|ساعدني|احتيال|מודאג|מפחד|בעיה|תעזור|הונאה)/u;
const THANKS = /(thank|thanks|მადლობ|გმადლობ|спасибо|благодар|teşekkür|sağ ol|شكر|תודה)/u;
const HELLO = /^(hi|hello|hey|გამარჯობა|სალამი|привет|здравствуй|merhaba|selam|مرحبا|اهلا|أهلا|שלום|היי)\b/u;
const SEARCH = /(find|search|look(ing)? for|show me|apartment|flat|house|listing|price of|ვეძებ|მოძებნ|მაჩვენე|ბინა|სახლ|ფასი|ищу|найди|найти|покажи|квартир|дом|цена|arıyorum|bul|göster|daire|ev |fiyat|ابحث|أبحث|اعثر|شقة|منزل|سعر|מחפש|למצוא|תראה לי|דירה|בית|מחיר)/u;

export function waitingMoodFor(text: string): WaitingMood {
  const t = norm(text);
  if (!t) return 'thinking';
  if (HELLO.test(t) && t.length < 40) return 'greeting';
  if (THANKS.test(t) && t.length < 60) return 'happy';
  if (WORRY.test(t)) return 'encouraging';
  if (SURPRISE.test(t)) return 'surprised';
  if (SEARCH.test(t)) return 'searching';
  return 'thinking';
}
