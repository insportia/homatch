/*
 * The listing contact number, said plainly where it is entered: people whose search
 * matches this property can call it; it is never published. Order en, ka, ru, tr, ar, he.
 */
import { splice, validate } from './lib/i18nSplice.mjs';
const strings = {
  contact_phone_match_notice: [
    'People whose search matches this property will be able to call this number and message you on HOMATCH. It is never published publicly.',
    'ამ ნომერზე დაგირეკავენ ის ადამიანები, ვისი ძიებაც ამ ქონებას ემთხვევა; ასევე შეძლებენ HOMATCH-ზე მოგწერონ. ნომერი საჯაროდ არ ქვეყნდება.',
    'Люди, чей поиск совпадает с этим объектом, смогут позвонить по этому номеру и написать вам в HOMATCH. Номер никогда не публикуется открыто.',
    'Araması bu mülkle eşleşen kişiler bu numarayı arayabilecek ve size HOMATCH üzerinden mesaj gönderebilecek. Numara asla herkese açık yayımlanmaz.',
    'سيتمكن الأشخاص الذين يتطابق بحثهم مع هذا العقار من الاتصال بهذا الرقم ومراسلتك عبر HOMATCH. لا يُنشر الرقم علناً أبداً.',
    'אנשים שהחיפוש שלהם תואם לנכס הזה יוכלו להתקשר למספר הזה ולשלוח לך הודעה ב-HOMATCH. המספר לעולם אינו מתפרסם בפומבי.',
  ],
};
const problems = validate(strings, 'property-contact-notice');
if (problems.length) throw new Error(problems.join('\n'));
const result = splice(new URL('../src/i18n/translations.ts', import.meta.url), strings, { banner: 'PROPERTY CONTACT NOTICE', tag: 'property-contact-notice', overwrite: process.argv.includes('--overwrite') });
if (result.collisions.length) throw new Error(result.collisions.join(', '));
console.log(`${result.added} contact-notice strings added.`);
