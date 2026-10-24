# HOMI — Georgian copy glossary and voice

Owner: HOMI workstream (branch `claude/homi-experience`). Applies to every string HOMI, Mortgage,
Investment, Expat, Contract and Notification surfaces show in Georgian.

## Voice

- Informal singular (შენ, შენი, გინდა, სცადე). The polite plural (თქვენ, შეიყვანეთ, გთხოვთ) is not used;
  `src/mortgage/__tests__/humanCopy.acceptance.test.mjs` fails on it for every `mortgage_*` key.
- No semicolons and no em or en dashes in sentences. A numeric range uses a hyphen (1-3 თვეში).
  HOMI's own answers are cleaned of AI-style dashes in `src/lib/homi/style.ts` and on the server.
- Headings, labels and chips have no full stop. Sentences do.
- Friendly and plain, never a lawyer, never a guarantee. Financial and legal outcomes are described,
  not promised: no approval probability, no "you will get the loan", no "this clause is illegal".

## Fixed terms

| English | Georgian | Notes |
|---|---|---|
| match (matching) | დამთხვევა | project-wide rule |
| tenant | მოიჯარე | project-wide rule |
| Tbilisi | თბილისი | |
| potentially interested person | პოტენციურად დაინტერესებული პირი | never "lead" in customer copy |
| potential buyer | პოტენციური მყიდველი | seller side of mortgage-origin buyers |
| mortgage-interested buyer | იპოთეკით დაინტერესებული მყიდველი | |
| unlock (contact details) | საკონტაქტო ინფორმაციის განბლოკვა | price line: განბლოკვის ფასი: $0.30 |
| already unlocked | უკვე განბლოკილია | |
| nominal interest rate | ნომინალური საპროცენტო განაკვეთი | |
| effective interest rate | ეფექტური საპროცენტო განაკვეთი | never confused with nominal |
| principal | ძირი თანხა | |
| monthly payment | ყოველთვიური შენატანი | |
| down payment | პირველადი შენატანი | |
| amortisation schedule | ამორტიზაციის გრაფიკი | |
| co-borrower | თანამსესხებელი | not interchangeable with guarantor |
| guarantor | თავდები | |
| collateral / additional collateral | უზრუნველყოფა / დამატებითი უზრუნველყოფა | |
| appraisal | ქონების შეფასება | |
| refinancing | რეფინანსირება | |
| currency risk | სავალუტო რისკი | |
| readiness assessment | სესხისთვის მზადყოფნის შეფასება | a score with stated limits, never a probability |
| contract analysis | ხელშეკრულების ანალიზი | |
| suggested wording | შემოთავაზებული ტექსტი | |
| original text | ორიგინალი ტექსტი | |
| revision history | ვერსიების ისტორია | |
| notification delivery | შეტყობინებების მიწოდება | admin |
| AI usage and costs | AI-ის გამოყენება და ხარჯები | admin |
| default language | ნაგულისხმევი ენა | admin |

## Owner-approved strings

The owner's Georgian strings from the HOMI specification are used verbatim. Where they live:

- HOMI greeting and homepage copy: `scripts/homi-i18n-data.mjs`.
- Expat journey: `scripts/homi-expat-i18n-data.mjs` (`HOMI_EXPAT_STRINGS`), Georgian fixes of older expat
  copy: `HOMI_EXPAT_KA_FIXES` (other languages untouched).
- Mortgage readiness: `scripts/homi-mortgage-i18n-data.mjs`; financial literacy, saved scenarios and buyer
  leads: `scripts/homi-mortgage2-i18n-data.mjs` (the eleven glossary explanations the owner supplied are
  pinned word for word by `src/mortgage/__tests__/glossary.test.mjs`).
- Investment: `scripts/homi-investment-i18n-data.mjs`.
- Contract review: `scripts/homi-contract-i18n-data.mjs`.
- Notifications: `scripts/homi-notify-i18n-data.mjs` (in-app) and
  `supabase/functions/_shared/transactionalEmail.ts` (email; Georgian is the default language).
- Admin: `scripts/homi-admin-i18n-data.mjs`.

All are spliced by `node scripts/homi-i18n-apply.mjs` (idempotent; re-running is a no-op).
