// HOMATCH public navigation — the two group headings.
//
// Order is [en, ka, ru, tr, ar, he].
//
// WHY ONLY TWO KEYS
//
// Every other label in the public header already exists and is already
// translated: nav_verify, nav_investment, nav_mortgage, nav_pricing,
// nav_about, nav_for_expats, mp_nav_developers, home_nav_partners. The header
// was crowded because nine pages each declared their own flat list, not
// because it was missing words, so consolidating it needs headings for the
// two groups and nothing else.
//
// "Company" and "For professionals" are the two things that were competing
// with the product for space in the primary row. Grouping them is what gives
// Expat, Intelligence, Verify and Investment room to breathe at the widths
// where six languages disagree most about how long a word is.

export const NAV_STRINGS = {
  nav_company: [
    'Company',
    'კომპანია',
    'Компания',
    'Kurumsal',
    'الشركة',
    'החברה',
  ],
  nav_professional: [
    'For professionals',
    'პროფესიონალებს',
    'Профессионалам',
    'Profesyonellere',
    'للمحترفين',
    'לאנשי מקצוע',
  ],
  nav_on_this_page: [
    'On this page',
    'ამ გვერდზე',
    'На этой странице',
    'Bu sayfada',
    'في هذه الصفحة',
    'בדף הזה',
  ],
};
