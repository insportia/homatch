/*
 * Verify market card: the "not enough evidence" explanation for a land plot
 * (src/verify/marketPresentation.ts insufficiencyOf → bodyKey).
 *
 * Order is en, ka, ru, tr, ar, he — LANGS in lib/i18nSplice.mjs.
 * {{need}} and {{have}} survive in every locale.
 */
export const VERIFY_MARKET_LAND_STRINGS = {
  vfm6_insufficient_body_land: [
    'A price range needs at least {{need}} comparable plots of the same land designation nearby. We found {{have}}, so we are not giving a number for this plot. Any listing shown is context, not a valuation.',
    'ფასის დიაპაზონის დასადგენად საჭიროა მინიმუმ {{need}} იმავე დანიშნულების შესადარებელი მიწის ნაკვეთი ახლომდებარე ტერიტორიაზე. ვიპოვეთ {{have}}, ამიტომ ამ ნაკვეთისთვის ციფრს არ ვასახელებთ. ნაჩვენები განცხადებები მხოლოდ კონტექსტია და არა შეფასება.',
    'Для ценового диапазона нужно не менее {{need}} сопоставимых участков того же назначения поблизости. Мы нашли {{have}}, поэтому не называем цифру для этого участка. Показанные объявления — контекст, а не оценка.',
    'Bir fiyat aralığı için yakında aynı arazi niteliğinde en az {{need}} karşılaştırılabilir parsel gerekir. {{have}} bulduk, bu yüzden bu parsel için bir rakam vermiyoruz. Gösterilen ilanlar değerleme değil, bağlamdır.',
    'يتطلب نطاق السعر ما لا يقل عن {{need}} قطع أراضٍ مماثلة بالتصنيف نفسه في المنطقة. وجدنا {{have}}، لذلك لا نذكر رقمًا لهذه القطعة. أي إعلان معروض هو سياق وليس تقييمًا.',
    'טווח מחירים דורש לפחות {{need}} מגרשים דומים באותו ייעוד קרקע בסביבה. מצאנו {{have}}, ולכן איננו נוקבים במספר עבור המגרש הזה. מודעות שמוצגות הן הקשר, לא הערכת שווי.',
  ],
};
