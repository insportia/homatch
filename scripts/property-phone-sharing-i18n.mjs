/*
 * Owner consent to share a listing's contact number with matched HOMATCH members.
 * Order is en, ka, ru, tr, ar, he — LANGS in lib/i18nSplice.mjs. Match is დამთხვევა.
 */
import { splice, validate } from './lib/i18nSplice.mjs';
const strings = {
  contact_phone_share_label: [
    'Let HOMATCH members whose search matches this property see and call this number',
    'ნება დართე HOMATCH-ის წევრებს, რომელთა ძიებაც ამ ქონებას ემთხვევა, ნახონ ეს ნომერი და დაგირეკონ',
    'Разрешить участникам HOMATCH, чей поиск совпадает с этим объектом, видеть этот номер и звонить',
    'Araması bu mülkle eşleşen HOMATCH üyelerinin bu numarayı görmesine ve aramasına izin ver',
    'السماح لأعضاء HOMATCH الذين يتطابق بحثهم مع هذا العقار برؤية هذا الرقم والاتصال به',
    'לאפשר לחברי HOMATCH שהחיפוש שלהם תואם לנכס הזה לראות את המספר ולהתקשר',
  ],
  contact_phone_share_hint: [
    'Off: your number stays hidden; they can still message you privately on HOMATCH.',
    'გამორთულია: ნომერი დამალულია; შეუძლიათ HOMATCH-ზე პირადად მოგწერონ.',
    'Выключено: номер скрыт; вам всё равно смогут написать лично в HOMATCH.',
    'Kapalı: numaranız gizli kalır; size HOMATCH üzerinden özel mesaj yine de gönderebilirler.',
    'عند الإيقاف: يبقى رقمك مخفياً؛ ويمكنهم مراسلتك بشكل خاص عبر HOMATCH.',
    'כבוי: המספר שלך מוסתר; עדיין יוכלו לשלוח לך הודעה פרטית ב-HOMATCH.',
  ],
};
const problems = validate(strings, 'property-phone-sharing');
if (problems.length) throw new Error(problems.join('\n'));
const result = splice(new URL('../src/i18n/translations.ts', import.meta.url), strings, { banner: 'PROPERTY PHONE SHARING', tag: 'property-phone-sharing', overwrite: process.argv.includes('--overwrite') });
if (result.collisions.length) throw new Error(result.collisions.join(', '));
console.log(`${result.added} phone-sharing strings added.`);
