// Part four: strings added after the first live pass through the page.
// Same shape as parts one to three: key -> [en, ka, ru, tr, ar, he].

export const INVESTMENT_STRINGS_4 = {
  // A gap of zero is the two figures agreeing, which is worth saying as
  // such rather than as "$0 above". See PricePositionModule.
  inv_price_matches_implied: [
    'What you would pay and what the income implies at your benchmark are the same figure. That is a coincidence of your own two assumptions, not a market fact.',
    'თქვენი გადასახდელი და შემოსავლით ნაგულისხმევი ღირებულება თქვენს ორიენტირზე ერთი და იგივე ციფრია. ეს თქვენივე ორი დაშვების დამთხვევაა და არა საბაზრო ფაქტი.',
    'То, что вы платите, и то, что доход подразумевает при вашем ориентире, — одна и та же цифра. Это совпадение двух ваших собственных допущений, а не рыночный факт.',
    'Ödeyeceğiniz tutar ile gelirin referansınızda ima ettiği değer aynı rakam. Bu, kendi iki varsayımınızın çakışmasıdır; bir piyasa gerçeği değil.',
    'ما ستدفعه وما يشير إليه الدخل عند مرجعك هما الرقم نفسه. هذا تطابق بين افتراضيك أنت، وليس حقيقة سوقية.',
    'מה שתשלמו ומה שההכנסה מרמזת ברף שלכם הם אותו מספר. זו הצטלבות של שתי ההנחות שלכם, לא עובדת שוק.',
  ],

  // The singular of the hold-period control. A dedicated key rather than
  // "1 year(s)", so each locale uses its own singular form.
  inv_hold_one_year: ['1 year', '1 წელი', '1 год', '1 yıl', 'سنة واحدة', 'שנה אחת'],
};
