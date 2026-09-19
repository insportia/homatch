/*
 * PART 7 — the rest of the Georgian, found by reading the live page
 * with every disclosure open.
 *
 * WHY THIS PART EXISTS SEPARATELY
 *
 * Parts 1 to 6 rewrote the copy that is on screen when the page loads.
 * A scan of the live Georgian page with the disclosures forced open
 * then found four more sentences carrying a semicolon or an em dash,
 * and a Unicode-aware sweep of the bundle found seventy-four strings
 * still speaking in the formal plural: შეიყვანეთ where the rest of the
 * page says შეიყვანე, თქვენი სესხი above a panel headed შენი შედეგი.
 *
 * The sweep that missed them the first time is worth recording. It was
 * a JavaScript regex using \\b and \\w, both of which are ASCII-only, so
 * over Georgian text it matched nothing and reported a clean result.
 * A gate that cannot fail is worse than no gate; the test now uses the
 * Georgian block explicitly.
 *
 * KEEP, AND WHY MOST LANGUAGES ARE NOT HERE
 *
 * These are register and punctuation fixes on copy whose Russian,
 * Turkish, Arabic and Hebrew were written and reviewed when it shipped
 * and remain correct. Retyping four languages to move a dash is how a
 * good translation acquires a mistake. KEEP leaves them exactly as they
 * are; the English changes only where it carried the same dash.
 *
 * key -> [en, ka, ru, tr, ar, he], with KEEP for "leave this one".
 */

import { KEEP } from './mortgage-human-keep.mjs';

const K = KEEP;

export const PART_7 = {
  /* ── The section and field labels: one voice ─────────────────────── */

  mortgage_input_title: ['Your loan', 'შენი სესხი', K, K, K, K],
  mortgage_section_loan: ['Your loan', 'შენი სესხი', K, K, K, K],
  mortgage_label_own_rate: ['Your current rate', 'შენი ამჟამინდელი განაკვეთი', K, K, K, K],
  mortgage_accuracy_user_provided: ['You provided this', 'შენ მიუთითე', K, K, K, K],
  mortgage_term_compare_selected: ['Your choice', 'შენი არჩევანი', K, K, K, K],
  mortgage_afford_your_value: ['Your value', 'შენი მაჩვენებელი', K, K, K, K],
  mortgage_rate_bank_stated: ['Your bank says', 'შენი ბანკი ამბობს', K, K, K, K],
  mortgage_refi_current: ['The loan you have', 'სესხი, რომელიც გაქვს', K, K, K, K],
  mortgage_needs_income: ['your monthly income', 'შენი თვიური შემოსავალი', K, K, K, K],
  mortgage_needs_own_loan: ['the loan you already have', 'სესხი, რომელიც უკვე გაქვს', K, K, K, K],
  mortgage_first_payment_split: [
    'Where your first payment goes', 'სად მიდის შენი პირველი გადასახადი', K, K, K, K,
  ],
  mortgage_mod_bank_rate_title: [
    'Against the rate your bank stated', 'შენი ბანკის დასახელებულ განაკვეთთან', K, K, K, K,
  ],
  mortgage_mod_refi_title: [
    'Your loan, and the one you are offered', 'შენი სესხი და ის, რასაც გთავაზობენ', K, K, K, K,
  ],
  mortgage_mod_offers_title: ['The offers you have', 'შეთავაზებები, რომლებიც გაქვს', K, K, K, K],
  mortgage_affordability_title: [
    'Can you comfortably afford this?', 'შეძლებ ამის კომფორტულად გადახდას?', K, K, K, K,
  ],
  mortgage_scenario_saved_toast: [
    'Saved to your mortgage calculations', 'შენახულია შენს გამოთვლებში', K, K, K, K,
  ],
  mortgage_prefilled_from_property: [
    'Filled in from the property you were looking at. Change any field you like.',
    'შევსებულია იმ განცხადებიდან, რომელსაც ათვალიერებდი. ნებისმიერი ველი თავისუფლად შეცვალე.',
    K, K, K, K,
  ],

  /* ── Validation, which is where people are already annoyed ───────── */

  mortgage_error_property_price_invalid: [
    'Enter a property price above 0.', 'შეიყვანე ქონების ფასი, რომელიც 0-ზე მეტია.', K, K, K, K,
  ],
  mortgage_error_currency_required: ['Choose a currency.', 'აირჩიე ვალუტა.', K, K, K, K],
  mortgage_error_term_invalid: [
    'Choose a loan term between 1 and 50 years.', 'აირჩიე სესხის ვადა 1-დან 50 წლამდე.', K, K, K, K,
  ],
  mortgage_error_rate_invalid: [
    'Enter a rate between 0% and 100%.', 'შეიყვანე განაკვეთი 0%-დან 100%-მდე.', K, K, K, K,
  ],
  mortgage_error_down_payment_exceeds_price: [
    'The down payment has to be smaller than the price. Otherwise there is nothing left to borrow.',
    'პირველადი შენატანი ფასზე ნაკლები უნდა იყოს. სხვა შემთხვევაში სასესხებელი აღარაფერი რჩება.',
    K, K, K, K,
  ],

  /* ── The five tools, and what each opens with ────────────────────── */

  mortgage_topic_offers_desc: [
    'Two or three offers side by side on the real rate, the cost on the day, the ongoing cost and the total. The trade-offs are named and no winner is declared.',
    'ორი ან სამი შეთავაზება გვერდიგვერდ, რეალური განაკვეთით, ხელმოწერის დღის ხარჯით, მუდმივი ხარჯით და ჯამით. კომპრომისები დასახელებულია, გამარჯვებული არა.',
    K, K, K, K,
  ],
  mortgage_topic_early_desc: [
    'A one-off payment, a standing extra, or both, and how many months and how much interest each one removes.',
    'ერთჯერადი გადახდა, მუდმივი დანამატი ან ორივე, და რამდენ თვეს და რამდენ პროცენტს აშორებს თითოეული.',
    K, K, K, K,
  ],
  mortgage_topic_refi_desc: [
    'Your current loan against a new offer: both payments, both remaining costs, the break-even month, and why a lower payment does not settle it.',
    'შენი ამჟამინდელი სესხი ახალი შეთავაზების გვერდით: ორივე გადასახადი, ორივე დარჩენილი ღირებულება, ნულოვანი წერტილის თვე და რატომ არ წყვეტს საკითხს დაბალი გადასახადი.',
    K, K, K, K,
  ],
  mortgage_topic_sign_desc: [
    'The fifteen things worth checking in an offer, and the clauses people most often agree to without reading. Each one says what to ask and what to find in the contract.',
    'თხუთმეტი რამ, რაც შეთავაზებაში გადასამოწმებელია, და პუნქტები, რომლებსაც ყველაზე ხშირად წაუკითხავად თანხმდებიან. თითოეული გეუბნება, რა ჰკითხო და რა იპოვო ხელშეკრულებაში.',
    K, K, K, K,
  ],
  mortgage_mod_payment_sub: [
    'The payment is the first month after any lighter start, at the rate you entered. The totals include every cost you have given us.',
    'გადასახადი არის შემსუბუქებული დასაწყისის შემდგომი პირველი თვე, შენ მიერ შეყვანილი განაკვეთით. ჯამები მოიცავს ყველა ხარჯს, რომელიც შეიყვანე.',
    K, K, K, K,
  ],
  mortgage_mod_unknown_sub: [
    'These are not errors. Most loans genuinely have none of some of them. But each one, if it exists, raises the real cost.',
    'ეს შეცდომები არ არის. ბევრ სესხს ნამდვილად არ აქვს ზოგიერთი მათგანი. მაგრამ თითოეული, თუ არსებობს, რეალურ ღირებულებას ზრდის.',
    K, K, K, K,
  ],
  mortgage_mod_bank_rate_sub: [
    'A difference is usually not an error. It normally means the bank’s figure includes a cost you have not entered here.',
    'სხვაობა ჩვეულებრივ შეცდომა არ არის. როგორც წესი, ის ნიშნავს, რომ ბანკის ციფრი მოიცავს ხარჯს, რომელიც აქ არ შეგიყვანია.',
    K, K, K, K,
  ],
  mortgage_mod_early_sub: [
    'Paying extra shortens the loan rather than lowering the required payment. That is the usual product, and it is what is modelled here.',
    'დამატებითი გადახდა სესხს ამოკლებს და სავალდებულო გადასახადს არ ამცირებს. ეს ჩვეულებრივი პროდუქტია და სწორედ ეს არის დათვლილი.',
    K, K, K, K,
  ],
  mortgage_mod_refi_sub: [
    'Only what is left of the current loan matters. Fees you have already paid are gone either way.',
    'მნიშვნელობა აქვს მხოლოდ იმას, რაც ამჟამინდელი სესხიდან დარჩა. უკვე გადახდილი საკომისიოები ორივე შემთხვევაში დაკარგულია.',
    K, K, K, K,
  ],
  mortgage_mod_offers_sub: [
    'Two or three. Enter what each bank quoted. Anything left blank is reported as unknown rather than treated as zero.',
    'ორი ან სამი. ჩაწერე, რა შემოგთავაზა თითოეულმა ბანკმა. ცარიელი დარჩენილი უცნობად აღინიშნება და არა ნულად.',
    K, K, K, K,
  ],
  mortgage_mod_compare_sub: [
    'No offer is marked best. The labels say what each one is actually better at, which is the only comparison that survives contact with a different borrower.',
    'არცერთი შეთავაზება საუკეთესოდ არ არის მონიშნული. იარლიყები ამბობს, რაში არის თითოეული რეალურად უკეთესი. ეს ერთადერთი შედარებაა, რომელიც სხვა მსესხებელთანაც გამოდგება.',
    K, K, K, K,
  ],

  /* ── Hints under the optional fields ─────────────────────────────── */

  mortgage_label_nominal_rate_hint: [
    'The rate the bank quoted you. If you do not have one yet, ask for it in writing. Every other figure here depends on it.',
    'განაკვეთი, რომელიც ბანკმა დაგისახელა. თუ ჯერ არ გაქვს, ითხოვე წერილობით. აქ ყველა დანარჩენი ციფრი მასზეა დამოკიდებული.',
    K, K, K, K,
  ],
  mortgage_label_rate_type_hint: [
    'If you do not say, Homatch does not assume it is fixed. An unstated rate type is reported as unknown, because a rate that can move is a risk that has not been ruled out.',
    'თუ არ მიუთითებ, Homatch არ ივარაუდებს, რომ ფიქსირებულია. მიუთითებელი ტიპი უცნობად აღინიშნება, რადგან განაკვეთი, რომელიც შეიძლება შეიცვალოს, გამორიცხული რისკი არ არის.',
    K, K, K, K,
  ],
  mortgage_label_grace_period_hint: [
    'Months at the start when you pay interest only. It lowers the early payments and raises what the loan costs in total.',
    'თვეები დასაწყისში, როცა მხოლოდ პროცენტს იხდი. ეს ამცირებს ადრეულ გადასახადებს და ზრდის სესხის ჯამურ ღირებულებას.',
    K, K, K, K,
  ],
  mortgage_label_effective_rate_bank_hint: [
    'If the bank stated one, enter it. It takes precedence, and Homatch shows it beside the figure calculated here rather than replacing it.',
    'თუ ბანკმა დაასახელა, ჩაწერე. მას უპირატესობა აქვს და Homatch აჩვენებს მას აქ გამოთვლილის გვერდით, ჩანაცვლების ნაცვლად.',
    K, K, K, K,
  ],
  mortgage_label_extra_month_hint: [
    'The month you make it. Earlier is worth more, because interest is charged on what is still owed.',
    'თვე, როცა ამას გააკეთებ. რაც უფრო ადრე, მით უკეთესი, რადგან პროცენტი დარჩენილ ვალზე ერიცხება.',
    K, K, K, K,
  ],
  mortgage_label_early_fee_hint: [
    'Enter this only if your contract states it. Left blank, it is reported as not included, never as zero.',
    'ჩაწერე მხოლოდ მაშინ, თუ ხელშეკრულებაში წერია. ცარიელი დატოვებისას ჩაურთველად აღინიშნება და არასდროს ნულად.',
    K, K, K, K,
  ],
  mortgage_offer_effective_hint: [
    'Enter it only if the bank stated it. Left blank, Homatch works one out from the costs you give and labels it as calculated.',
    'ჩაწერე მხოლოდ მაშინ, თუ ბანკმა დაასახელა. ცარიელი დატოვებისას Homatch თავად დათვლის შეყვანილი ხარჯებიდან და მონიშნავს როგორც გამოთვლილს.',
    K, K, K, K,
  ],

  /* ── Notes inside the tools ──────────────────────────────────────── */

  mortgage_first_payment_note: [
    '{{interest}} is interest and {{principal}} comes off the debt. That balance shifts slowly over the life of the loan.',
    '{{interest}} პროცენტია და {{principal}} ვალს ამცირებს. ეს თანაფარდობა სესხის მანძილზე ნელა იცვლება.',
    K, K, K, K,
  ],
  mortgage_terms_tradeoff_note: [
    'A shorter term costs less overall and more each month. A longer one does the reverse. Which matters more is a fact about your life rather than about the loan, so nothing here is recommended.',
    'მოკლე ვადა ჯამში ნაკლები ჯდება და თვეში მეტი. გრძელი პირიქით. რომელი უფრო მნიშვნელოვანია, ეს შენი ცხოვრების ფაქტია და არა სესხის, ამიტომ აქ არაფერია რეკომენდებული.',
    K, K, K, K,
  ],
  mortgage_term_compare_explainer: [
    'A shorter term means a higher monthly payment and less interest overall. A longer term lowers the monthly payment and costs more in total. There is no universally better choice, only the one that fits your budget.',
    'უფრო მოკლე ვადა ნიშნავს უფრო მაღალ თვიურ გადასახადს და ნაკლებ პროცენტს. უფრო გრძელი ვადა ამცირებს თვიურ გადასახადს და ჯამში მეტი ჯდება. უნივერსალურად უკეთესი არჩევანი არ არსებობს, არსებობს მხოლოდ ის, რაც შენს ბიუჯეტს შეესაბამება.',
    K, K, K, K,
  ],
  mortgage_rate_unknown_note: [
    'Ask the bank for each of these in writing. Any one of them, if it applies, raises the real cost above the figure shown here.',
    'ითხოვე ბანკისგან თითოეული მათგანი წერილობით. ნებისმიერი მათგანი, თუ მოქმედებს, რეალურ ღირებულებას აქ ნაჩვენებზე მაღლა სწევს.',
    K, K, K, K,
  ],
  mortgage_rate_difference_note: [
    'If the bank’s figure is higher, ask which cost accounts for it.',
    'თუ ბანკის ციფრი მეტია, ჰკითხე, რომელი ხარჯი ხსნის სხვაობას.',
    K, K, K, K,
  ],
  mortgage_early_fee_not_included: [
    'A contractual early-repayment fee, if your bank charges one, is not included here. You have not entered it, and assuming it is zero would overstate the saving. Ask the bank what it charges in the first years of the loan.',
    'ვადამდე დაფარვის საკომისიო, თუ ბანკი ასეთს იღებს, აქ ჩართული არ არის. ის არ შეგიყვანია, ნულად დაშვება კი დანაზოგს გაზვიადებდა. ჰკითხე ბანკს, რას იღებს სესხის პირველ წლებში.',
    K, K, K, K,
  ],
  mortgage_refi_no_fee_entered: [
    'You have not entered a cost of switching, so this comparison assumes there is none. Arrangement, valuation and release fees are common. Ask for them before you decide.',
    'გადასვლის ხარჯი არ შეგიყვანია, ამიტომ ეს შედარება უშვებს, რომ ის არ არსებობს. გაფორმების, შეფასებისა და მოხსნის საკომისიოები ჩვეულებრივია. ჰკითხე მათზე გადაწყვეტამდე.',
    K, K, K, K,
  ],
  mortgage_refi_verdict_cheaper: [
    'Under these assumptions the new loan costs less in total. Check that the rate type and the fees are what you were told, because a difference in either changes this.',
    'ამ დაშვებებით ახალი სესხი ჯამში ნაკლები ჯდება. გადაამოწმე, რომ განაკვეთის ტიპი და საკომისიოები ისეთია, როგორც გითხრეს, რადგან რომელიმეში სხვაობა ამას ცვლის.',
    K, K, K, K,
  ],
  mortgage_offers_empty: [
    'Add the first offer. Two are enough to compare, and three is the most this can hold at once.',
    'დაამატე პირველი შეთავაზება. შესადარებლად ორიც საკმარისია, სამი კი მაქსიმუმია.',
    K, K, K, K,
  ],
  mortgage_offers_assumptions_note: [
    'Every figure assumes the costs you entered and nothing else. An offer that looks cheaper here can be dearer in reality because of a cost nobody mentioned, which is what the checklist is for.',
    'ყოველი ციფრი მხოლოდ შენ მიერ შეყვანილ ხარჯებს ეყრდნობა. შეთავაზება, რომელიც აქ იაფად გამოიყურება, სინამდვილეში შეიძლება ძვირი აღმოჩნდეს ხარჯის გამო, რომელიც არავინ ახსენა. სწორედ ამისთვისაა შესამოწმებელი სია.',
    K, K, K, K,
  ],

  /* ── Affordability ───────────────────────────────────────────────── */

  mortgage_afford_pti_explain: [
    'How much of your monthly income is already committed to debt payments. That is this mortgage plus anything else you owe.',
    'შენი თვიური შემოსავლის რა ნაწილი მიდის უკვე სავალო გადასახადებში. ეს არის ეს იპოთეკა და ყველაფერი დანარჩენი.',
    K, K, K, K,
  ],
  mortgage_afford_ltv_explain: [
    'How much of the property’s value the bank is financing. The rest is your down payment.',
    'ქონების ღირებულების რა ნაწილს აფინანსებს ბანკი. დანარჩენი შენი პირველადი შენატანია.',
    K, K, K, K,
  ],
  mortgage_afford_pti_acronym: [
    'Banks call this PTI, payment to income.',
    'ბანკები ამას PTI-ს უწოდებენ, გადასახადის შეფარდებას შემოსავალთან.',
    K, K, K, K,
  ],
  mortgage_afford_ltv_acronym: [
    'Banks call this LTV, loan to value.',
    'ბანკები ამას LTV-ს უწოდებენ, სესხის შეფარდებას ქონების ფასთან.',
    K, K, K, K,
  ],
  mortgage_affordability_disclaimer: [
    'This compares your numbers with the general limits that are currently published. It is not a pre-approval and it does not mean a bank will approve you. Approval always depends on the bank’s own assessment.',
    'ეს ადარებს შენს მონაცემებს ამჟამად გამოქვეყნებულ ზოგად ზღვრებს. ეს არ არის წინასწარი დამტკიცება და არ ნიშნავს, რომ ბანკი დაგიმტკიცებს. დამტკიცება ყოველთვის ბანკის საკუთარ შეფასებაზეა დამოკიდებული.',
    K, K, K, K,
  ],

  /* ── The knowledge base, read by a customer ──────────────────────── */

  mortgage_kb_explain_pti_gel_low_income: [
    'For a loan in lari, if your monthly income after tax is below 1,500 GEL, the National Bank limits total monthly debt payments to 25% of that income.',
    'ლარში სესხისთვის, თუ შენი თვიური შემოსავალი გადასახადის შემდეგ 1,500 ლარზე ნაკლებია, ეროვნული ბანკი თვიურ სავალო გადასახადებს ამ შემოსავლის 25%-ით ზღუდავს.',
    K, K, K, K,
  ],
  mortgage_kb_explain_pti_gel_high_income: [
    'For a loan in lari, if your monthly income after tax is 1,500 GEL or more, the National Bank limits total monthly debt payments to 50% of that income.',
    'ლარში სესხისთვის, თუ შენი თვიური შემოსავალი გადასახადის შემდეგ 1,500 ლარი ან მეტია, ეროვნული ბანკი თვიურ სავალო გადასახადებს ამ შემოსავლის 50%-ით ზღუდავს.',
    K, K, K, K,
  ],
  mortgage_kb_explain_pti_fx_low_income: [
    'For a loan in a foreign currency, if your monthly income after tax is below the equivalent of 1,500 GEL, the limit is stricter at 20% of that income.',
    'უცხოურ ვალუტაში სესხისთვის, თუ შენი თვიური შემოსავალი გადასახადის შემდეგ 1,500 ლარის ეკვივალენტზე ნაკლებია, ზღვარი უფრო მკაცრია და ამ შემოსავლის 20%-ია.',
    K, K, K, K,
  ],
  mortgage_kb_explain_pti_fx_high_income: [
    'For a loan in a foreign currency, if your monthly income after tax is the equivalent of 1,500 GEL or more, the limit is 30% of that income. It is stricter than for a loan in lari because your income and your debt would be in different currencies.',
    'უცხოურ ვალუტაში სესხისთვის, თუ შენი თვიური შემოსავალი გადასახადის შემდეგ 1,500 ლარის ეკვივალენტი ან მეტია, ზღვარი ამ შემოსავლის 30%-ია. ის ლარში სესხზე უფრო მკაცრია, რადგან შემოსავალი და ვალი სხვადასხვა ვალუტაში იქნება.',
    K, K, K, K,
  ],
  mortgage_kb_explain_effective_rate_methodology: [
    'The National Bank publishes its own calculator for the real yearly cost, and Homatch asks for the same inputs. The figure here uses the standard cash-flow method consumer-credit regulators use. It is labelled as calculated, and a figure your bank states itself always takes precedence.',
    'ეროვნული ბანკი აქვეყნებს საკუთარ კალკულატორს რეალური წლიური ხარჯისთვის და Homatch იმავე მონაცემებს ითხოვს. აქ მოცემული ციფრი გამოთვლილია სტანდარტული მეთოდით, რომელსაც სამომხმარებლო კრედიტის მარეგულირებლები იყენებენ. ის მონიშნულია როგორც გამოთვლილი, ხოლო ბანკის მიერ დასახელებულ ციფრს ყოველთვის უპირატესობა აქვს.',
    K, K, K, K,
  ],

  /* ── The two that still name an internal category ────────────────── */

  mortgage_picture_crit_unknown_costs: [
    'cost classes you have not entered',
    'ხარჯების კატეგორიები, რომლებიც არ შეგიყვანია',
    K, K, K, K,
  ],
  mortgage_home_body: [
    'Choose what you want to understand. Homatch asks only for the figures that question needs, calculates as you enter them, and says which costs it does not know about.',
    'აირჩიე, რისი გაგება გინდა. Homatch მხოლოდ იმ ციფრებს ითხოვს, რაც ამ კითხვას სჭირდება, თვლის შეყვანისთანავე და გეუბნება, რომელი ხარჯების შესახებ არაფერი იცის.',
    K, K, K, K,
  ],
  mortgage_home_footnote: [
    'Every figure is calculated from what you enter and can be reproduced from it. Official limits and programmes come from published sources with the date they were last checked. Homatch is not a lender and does not arrange finance.',
    'ყოველი ციფრი შენ მიერ შეყვანილიდან გამოითვლება და მისგან აღწარმოებადია. ოფიციალური ზღვრები და პროგრამები გამოქვეყნებული წყაროებიდან მოდის, ბოლო შემოწმების თარიღით. Homatch არ არის გამსესხებელი და დაფინანსებას არ აწყობს.',
    K, K, K, K,
  ],

  /* ── Dead but still in the bundle ────────────────────────────────── */

  /* Rendered by nothing since the result panel was rebuilt, but a key
     that exists is a key somebody can put back on a screen. */
  mortgage_result_explainer: [
    'You would borrow {{loanAmount}}. Over {{years}} years, the payment would be about {{monthlyPayment}} a month.',
    'ისესხებ {{loanAmount}}-ს. {{years}} წლის განმავლობაში გადასახადი დაახლოებით {{monthlyPayment}} იქნება თვეში.',
    K, K, K, K,
  ],
  mortgage_subsidy_worth_note: [
    'Off your interest, for {{months}} months, worked out against a policy rate of {{reference}}.',
    'გამოაკლდება შენს პროცენტს {{months}} თვის განმავლობაში, {{reference}} რეფინანსირების განაკვეთის მიხედვით.',
    K, K, K, K,
  ],
};
