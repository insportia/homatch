// COPY QUALITY GATES (owner, 2026-10-30: UX writing, Georgian copy and localization overhaul).
//
// Context-aware, not a blanket ban: em dashes and English are legitimate in identifiers, brand
// names, ranges and the archived legal editions. What these gates refuse is copy that tells a
// customer something untrue about money or the product:
//   - the old "first analysis free EVERY MONTH, then a fixed price each" model;
//   - top-up buttons that lead to a page where nothing can be bought;
//   - subscription screens that drift from the owner's terms (გამოწერა, გამოწერის გეგმა);
//   - English left in a Georgian subscription, Verify or Find flow;
//   - voice promises (HOMI voice messages were removed) and Stripe in the current legal edition;
//   - a "nothing was used" message shown where the backend has not released the usage.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const { translations } = await import(new URL('src/i18n/translations.ts', ROOT).href);
const LANGS = ['en', 'ka', 'ru', 'tr', 'ar', 'he'];
const KA = translations.ka;
const HOLES = /\{\{\s*(\w+)\s*\}\}/g;
const holes = (v) => [...String(v).matchAll(HOLES)].map((m) => m[1]).sort().join(',');
const customerKeys = Object.keys(translations.en).filter((k) => !k.endsWith('_e1029') && !/^(admin_|adm_)/.test(k));

test('no copy promises a free analysis every month or a fixed price per analysis', () => {
  const monthlyFree = {
    ka: /ყოველთვიურად პირველი|ყოველ ?თვე პირველი|ამ თვის უფასო|თვეში ერთი უფასო/,
    en: /first [a-z ]{0,30}(each|every) month is free|free [a-z ]{0,20}(each|every) month|this month['’]s free|after that it is \d+ credits/i,
    ru: /первый [а-яё ]{0,30}каждый месяц бесплат|бесплатный анализ этого месяца/i,
    tr: /her ay ilk [a-zçğıöşü ]{0,20}ücretsiz/i,
  };
  const perAnalysis = {
    ka: /თითოეულს ფიქსირებული ფასი|თითოეულ ანალიზს ფასი/,
    en: /each one costs a fixed price|per[- ]analysis price|per[- ]report price/i,
  };
  const bad = [];
  for (const k of customerKeys) {
    for (const [lang, re] of Object.entries(monthlyFree)) if (re.test(translations[lang][k])) bad.push(`${k} (${lang}) monthly free: ${translations[lang][k]}`);
    for (const [lang, re] of Object.entries(perAnalysis)) if (re.test(translations[lang][k])) bad.push(`${k} (${lang}) per-analysis price: ${translations[lang][k]}`);
  }
  assert.deepEqual(bad, []);
});

test('the owner\'s subscription wording is what the screens say, in Georgian', () => {
  const exact = {
    ux_ct_price_free_hint: 'პირველი ანალიზი უფასოა. სერვისით სარგებლობის გასაგრძელებლად აირჩიეთ თქვენთვის სასურველი გამოწერის გეგმა.',
    sub_first_free_detail: 'პირველად შეგიძლიათ უფასოდ შეამოწმოთ ქონება და გააანალიზოთ ხელშეკრულება. შემდეგ სარგებლობის გასაგრძელებლად დაგჭირდებათ გამოწერა.',
    sub_badge_first_free_contract: 'პირველი ანალიზი უფასოა',
    sub_trial_used_prompt: 'უფასო ანალიზი უკვე გამოიყენეთ. გასაგრძელებლად აირჩიეთ გამოწერის გეგმა.',
    sub_prompt_subscribe: 'სერვისით სარგებლობის გასაგრძელებლად გაააქტიურეთ გამოწერა.',
    sub_prompt_exhausted: 'ამ თვის ლიმიტი ამოიწურა. შეგიძლიათ აირჩიოთ უფრო მაღალი გეგმა ან დაელოდოთ ლიმიტის განახლებას.',
    sub_report_failed_not_charged: 'შემოწმება ვერ დასრულდა. თქვენი უფასო გამოყენება ან გეგმის ლიმიტი არ დახარჯულა.',
    sub_payments_unavailable: 'ონლაინ გადახდის დამატებაზე ვმუშაობთ. გამოწერის გააქტიურება მალე იქნება შესაძლებელი.',
    sub_pricing_title: 'გამოწერის გეგმები',
    sub_pricing_sub: 'აირჩიეთ გეგმა თქვენი საჭიროებების მიხედვით. ყველა გეგმა მოქმედებს ერთი თვის განმავლობაში.',
    sub_trials_title: 'სცადეთ უფასოდ',
    sub_trials_body: 'პირველი ქონების შემოწმება და პირველი ხელშეკრულების ანალიზი უფასოა. გამოსაცდელად საბანკო ბარათი არ გჭირდებათ.',
    sub_active_note: 'თქვენი გამოწერა აქტიურია.',
    sub_expired_note: 'გამოწერის ვადა ამოიწურა. სერვისებით სარგებლობის გასაგრძელებლად განაახლეთ გამოწერა.',
    sub_payments_pending_body: 'ონლაინ გადახდა ჯერ არ არის ხელმისაწვდომი. გამოწერის გააქტიურებას გადახდის სისტემის ამოქმედებისთანავე შეძლებთ.',
    sub_used_of: 'ამ თვეში გამოყენებულია {{used}} / {{limit}}',
    sub_unlimited: 'შეუზღუდავი გამოყენება',
    sub_feat_verify: '{{count}} ქონების შემოწმება',
    sub_feat_contract: '{{count}} ხელშეკრულების ანალიზი',
    sub_feat_verify_unlimited: 'ქონების შეუზღუდავი შემოწმება',
    sub_feat_contract_unlimited: 'ხელშეკრულებების შეუზღუდავი ანალიზი',
    sub_see_plans: 'გეგმების ნახვა',
    sub_cta_activate: 'გამოწერის გააქტიურება',
    sub_go_subscription: 'ჩემი გამოწერა',
    sub_cta_change_plan: 'გეგმის შეცვლა',
    sub_cta_continue: 'გაგრძელება',
    sub_cta_start_check: 'შემოწმების დაწყება',
    sub_cta_view_report: 'ანგარიშის ნახვა',
    sub_cta_retry: 'ხელახლა ცდა',
    verify_state_starting: 'ქონების შემოწმება იწყება.',
    verify_state_official_sources: 'ვამოწმებთ ინფორმაციას ოფიციალურ წყაროებში.',
    verify_state_checking_data: 'მიმდინარეობს ქონებასთან დაკავშირებული მონაცემების შემოწმება.',
    verify_state_preparing_report: 'ვამზადებთ შემოწმების ანგარიშს.',
    verify_state_report_ready: 'შემოწმების ანგარიში მზადაა.',
    verify_state_failed_retry: 'შემოწმება ვერ დასრულდა. სცადეთ ხელახლა.',
    verify_state_resuming: 'ვცდილობთ შემოწმების გაგრძელებას.',
    verify_state_unconfirmed: 'ამ ინფორმაციის დადასტურება ხელმისაწვდომი წყაროებით ვერ მოხერხდა.',
    plan_page_title: 'იპოვეთ თქვენთვის სასურველი ქონება',
    plan_page_subtitle: 'მოძებნეთ ბინები, სახლები და კომერციული ფართები თქვენთვის სასურველი მდებარეობისა და პირობების მიხედვით.',
    mw_entry_title: 'იპოვეთ პოტენციური მყიდველები',
    mw_entry_body: 'ნახეთ ადამიანები, რომელთა მოთხოვნებიც თქვენს ქონებას შეესაბამება.',
    mw_empty_title: 'ამ ეტაპზე შესაბამისი მყიდველი ვერ მოიძებნა.',
    mw_contact_show: 'კონტაქტის ნახვა',
    mw_contact_available: 'კონტაქტი ხელმისაწვდომია',
  };
  for (const [k, v] of Object.entries(exact)) assert.equal(KA[k], v, k);
  // Every one exists in all six languages with the same placeholders.
  for (const k of Object.keys(exact)) {
    for (const lang of LANGS) {
      assert.ok(translations[lang][k], `${k} missing in ${lang}`);
      assert.equal(holes(translations[lang][k]), holes(translations.en[k]), `${k} (${lang}) placeholders`);
    }
  }
});

test('subscription terminology is consistent and Georgian flows carry no English', () => {
  const flow = Object.keys(KA).filter((k) => /^(sub_|verify_state_|ux_ct_price|mw_entry|plan_page_)/.test(k) && !/^sub_plan_|^sub_sandbox|^sub_confirm_sandbox/.test(k));
  assert.ok(flow.length > 60, `the gate found only ${flow.length} keys; the filter broke`);
  for (const k of flow) {
    const v = KA[k];
    assert.match(v, /[ა-ჿ]/, `${k}: no Georgian at all`);
    // Allowed Latin: brand and product names, plan names and placeholders.
    const latin = v.replace(/\{\{\w+\}\}/g, '').replace(/HOMATCH|HOMI|Verify|VIP|Standard|Unlimited|SANDBOX|Meta Ads|Design Studio|ID|PDF|DOCX|AI/g, '');
    assert.doesNotMatch(latin, /[A-Za-z]{3,}/, `${k}: English inside Georgian: ${v}`);
    assert.doesNotMatch(v, /პაკეტ/, `${k}: a plan is a გეგმა, not a პაკეტი`);
    assert.doesNotMatch(v, /—/, `${k}: em dash in ordinary UI copy`);
  }
  // The pricing title and the trial heading use the owner's subscription words.
  assert.match(KA.sub_pricing_title, /გამოწერის გეგმები/);
  // Never "შესატყვისი" for a match, anywhere a customer reads.
  for (const k of customerKeys) assert.doesNotMatch(KA[k], /შესატყვის/, k);
});

test('credit top-up links say what the page does: show the balance (new credits are not sold)', () => {
  for (const k of ['cta_top_up', 'hl_top_up', 'fpi_paid_top_up', 'mm_c_ai_top_up', 'emp_top_up', 'matches_topup_btn']) {
    assert.equal(KA[k], 'ბალანსის ნახვა', k);
    for (const lang of LANGS) assert.doesNotMatch(translations[lang][k], /top.?up|пополн|შევსებ|yükle|شحن|טעינ/i, `${k} (${lang})`);
  }
  for (const k of ['doc_error_billing', 'research_purchase_insufficient', 'broker_err_insufficient_credits', 'emp_err_insufficient', 'matches_insufficient_desc']) {
    assert.doesNotMatch(translations.en[k], /top up/i, k);
    assert.doesNotMatch(KA[k], /შეავსეთ|შევსებ/, k);
  }
});

test('the em dash sweep holds: Georgian UI copy keeps them only where they are a template or legal text', () => {
  const left = Object.entries(KA)
    .filter(([k, v]) => /—/.test(v) && !k.endsWith('_e1029') && !/^(privacy_|terms_|cookie_|legal_)/.test(k))
    .filter(([, v]) => !/^[\s—–-]*$/.test(v));
  // Admin date/number range labels ("შექმნილია —დან") are fill-in templates around an input.
  const allowed = left.filter(([, v]) => /—\s?(დან|მდე)/.test(v));
  assert.deepEqual(left.filter((e) => !allowed.includes(e)).map(([k]) => k), []);
  // "ლიდი" (lead) reads as jargon: a contact or a potential buyer, by context.
  const lead = Object.entries(KA).filter(([k, v]) => !/^(privacy_|terms_)/.test(k) && !k.endsWith('_e1029') && /(^|[^ა-ჿ])ლიდ(?!ერ)/.test(v));
  assert.deepEqual(lead.map(([k]) => k), []);
});

test('no voice promises in subscription copy, and Stripe only in archived legal editions', () => {
  for (const k of Object.keys(KA).filter((x) => /^(sub_|terms_sub_)/.test(x) && !x.endsWith('_e1029'))) {
    for (const lang of LANGS) assert.doesNotMatch(translations[lang][k], /voice|ხმოვ|голос|sesli|صوت|קולי/i, `${k} (${lang})`);
  }
  const archivedOnly = new Set(['terms_s4_stripe', 'cookie_third_stripe', 'cookie_inv_stripe']);
  for (const k of Object.keys(translations.en)) {
    if (k.endsWith('_e1029') || archivedOnly.has(k) || /^admin_/.test(k)) continue;
    for (const lang of LANGS) assert.doesNotMatch(translations[lang][k], /Stripe/, `${k} (${lang})`);
  }
  // The archived-only keys are rendered only for archived editions.
  const cookies = read('src/pages/CookiesPage.tsx');
  assert.match(cookies, /\.\.\.\(stripe \? \[t\('cookie_third_stripe'\)\] : \[\]\)/);
  assert.match(cookies, /INVENTORY\.filter\(\(r\) => stripe \|\| r\.provider !== 'Stripe'\)/);
  const terms = read('src/pages/TermsPage.tsx');
  assert.ok(terms.indexOf("t('terms_s4_stripe')") < terms.indexOf(': <>', terms.indexOf("t('terms_s4_refund')")), 'terms_s4_stripe sits in the archived branch');
});

test('success and failure labels match what the backend did', () => {
  const contracts = read('src/pages/ContractsPage.tsx');
  // The free-first hint only when the server says the trial is available.
  assert.match(contracts, /contract\?\.trialAvailable \? t\('ux_ct_price_free_hint'\)/);
  // A plan-funded analysis shows its usage, never the free-first sentence.
  assert.match(contracts, /t\('sub_used_of', \{ used: String\(contract\?\.used \?\? 0\), limit: String\(contract\?\.limit \?\? 0\) \}\)/);
  const result = read('src/pages/ContractResultPage.tsx');
  // "Nothing was used" only for a run that failed after starting (usage is success-only and was released).
  assert.match(result, /state === 'FAILED' && failure !== 'BILLING_REQUIRED' \? \(\s*<p[^>]*>\{t\('sub_analysis_failed_not_charged'\)\}/);
  const pricing = read('src/pages/PricingPage.tsx');
  // The free trial is advertised only when the server lists both trials.
  assert.match(pricing, /plans\?\.trials\?\.includes\('VERIFY'\) && plans\.trials\.includes\('CONTRACT_ANALYSIS'\)/);
  // No live activation button while payment is not connected.
  assert.match(pricing, /disabled=\{!connected \|\| busy !== null\}/);
});

test('every placeholder in the changed copy is double-braced and present in all six languages', async () => {
  const { STAB_COPY_STRINGS, STAB_COPY_KA } = await import(new URL('scripts/stab-copy-i18n-data.mjs', ROOT).href);
  for (const [k, values] of Object.entries(STAB_COPY_STRINGS)) {
    values.forEach((v, i) => {
      assert.equal(translations[LANGS[i]][k], v, `${k} (${LANGS[i]}) is not what the data script says`);
      assert.equal(holes(v), holes(values[0]), `${k} (${LANGS[i]}) placeholders`);
      assert.doesNotMatch(v.replace(HOLES, ''), /\{\{|\}\}/, `${k} (${LANGS[i]}) unbalanced braces`);
    });
  }
  for (const [k, v] of Object.entries(STAB_COPY_KA)) {
    assert.equal(KA[k], v, k);
    assert.equal(holes(v), holes(translations.en[k]), `${k} placeholders`);
  }
});
