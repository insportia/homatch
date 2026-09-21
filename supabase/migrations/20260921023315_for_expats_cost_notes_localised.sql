-- APPLIED TO PRODUCTION AS 20260921023315.
--
-- Recorded under the version the migration API assigned, and this file is
-- named to match it. A repository file whose version the ledger does not
-- know is a migration `db push` will one day replay, and neither of these
-- is idempotent: both replace jsonb subtrees by exact string match, so a
-- second run would find nothing to replace and its own guard would fail
-- the deploy. The names have to agree.

-- HOMATCH FOR EXPATS — the cost notes were the last English on a Georgian page.
--
-- Every other piece of customer-facing content in this product is jsonb
-- keyed by locale: expat_topics.content, expat_topic_facts.statement. The
-- note under a cost row was declared `text`, so the Georgian landing page
-- rendered its own headings, its own category names and its own coverage
-- copy in Georgian — and then, inside the Internet row, a paragraph of
-- English:
--
--   "Magticom's published home fibre packages: 70 Mbps at GEL 33
--    promotional and GEL 40 standard ..."
--
-- That is body copy, not a publisher name or a source title, so it is the
-- leakage the QA pass was asked to rule out. It was visible on the phone
-- screenshots and in no test, because no test read the page as a reader.
--
-- WHY A NEW COLUMN RATHER THAN A TYPE CHANGE
--
-- `notes` stays exactly as it is, holding exactly what it holds. Altering
-- a populated column's type in place is a rewrite that cannot be reviewed
-- against the old value afterwards, and this table is append-and-supersede
-- — SUPERSEDED rows are history and their note is part of the record of
-- what we believed. So this adds `notes_i18n` beside it and leaves the
-- history alone. The reader falls back to `notes` when `notes_i18n` has
-- nothing for the locale, which keeps every existing row renderable and
-- makes the new column optional for anything written later.
--
-- THE TRANSLATIONS CARRY THE SAME NUMBERS AND THE SAME HEDGE
--
-- Both notes exist to say what the figure is NOT: a list price rather than
-- a market survey, a published pass rather than measured spending. A
-- translation that kept the numbers and dropped the caveat would turn a
-- careful statement into a claim, so the second sentence is translated as
-- deliberately as the first. No figure changes in any language.

begin;

alter table public.expat_cost_observations
  add column if not exists notes_i18n jsonb;

comment on column public.expat_cost_observations.notes_i18n is
  'Locale-keyed note shown under the cost row. Falls back to notes when a '
  'locale is absent. notes stays the authoring/original text.';

-- Internet: one operator's published fibre packages.
update public.expat_cost_observations
set notes_i18n = jsonb_build_object(
  'en', 'Magticom''s published home fibre packages: 70 Mbps at GEL 33 promotional and GEL 40 standard, 80 Mbps at GEL 50, 100 Mbps at GEL 80. One operator''s list price, not a market survey.',
  'ka', 'მაგთიკომის გამოქვეყნებული საშინაო ბოჭკოვანი პაკეტები: 70 Mbps 33 ლარად სააქციო და 40 ლარად სტანდარტული, 80 Mbps 50 ლარად, 100 Mbps 80 ლარად. ეს ერთი ოპერატორის სამოსახლო ფასია და არა ბაზრის კვლევა.',
  'ru', 'Опубликованные пакеты домашнего оптического интернета Magticom: 70 Мбит/с за 33 GEL по акции и 40 GEL по стандартному тарифу, 80 Мбит/с за 50 GEL, 100 Мбит/с за 80 GEL. Это прейскурант одного оператора, а не исследование рынка.',
  'tr', 'Magticom''un yayımlanmış ev fiber paketleri: 70 Mbps kampanyalı 33 GEL ve standart 40 GEL, 80 Mbps 50 GEL, 100 Mbps 80 GEL. Tek bir operatörün liste fiyatıdır, piyasa araştırması değildir.',
  'ar', 'باقات الألياف المنزلية المعلنة من Magticom: ‏70 ميغابت/ث بسعر 33 لاري ترويجي و40 لاري قياسي، و80 ميغابت/ث بسعر 50 لاري، و100 ميغابت/ث بسعر 80 لاري. هذه قائمة أسعار مشغّل واحد، وليست مسحاً للسوق.',
  'he', 'חבילות הסיבים הביתיות שמפרסמת Magticom: ‏70 Mbps ב‑33 GEL במבצע ו‑40 GEL במחיר הרגיל, 80 Mbps ב‑50 GEL, 100 Mbps ב‑80 GEL. זהו מחירון של מפעיל אחד, לא סקר שוק.'
)
where category = 'INTERNET' and status = 'CURRENT';

-- Transport: the published monthly pass, not measured spending.
update public.expat_cost_observations
set notes_i18n = jsonb_build_object(
  'en', 'The operator''s published price for a one-month unlimited travel pass. Somebody paying per journey at GEL 1 for 90 minutes may spend less; this figure is the published pass, not a measured average of what people spend.',
  'ka', 'ოპერატორის მიერ გამოქვეყნებული ფასი ერთთვიან შეუზღუდავ სამგზავრო ბარათზე. ვინც თითო მგზავრობაში იხდის — 1 ლარი 90 წუთზე — შესაძლოა ნაკლები დახარჯოს. ეს ციფრი გამოქვეყნებული ბარათის ფასია და არა გაზომილი საშუალო ხარჯი.',
  'ru', 'Опубликованная оператором цена безлимитного проездного на месяц. Тот, кто платит за поездку — 1 GEL за 90 минут, — может потратить меньше; это цена опубликованного проездного, а не измеренное среднее фактических расходов.',
  'tr', 'İşletmecinin yayımladığı bir aylık sınırsız ulaşım kartı fiyatı. Yolculuk başına 90 dakika için 1 GEL ödeyen biri daha az harcayabilir; bu rakam yayımlanmış kart fiyatıdır, insanların harcamasının ölçülmüş ortalaması değildir.',
  'ar', 'السعر المعلن من المشغّل لبطاقة تنقّل شهرية غير محدودة. من يدفع لكل رحلة — 1 لاري مقابل 90 دقيقة — قد ينفق أقل؛ هذا الرقم هو سعر البطاقة المعلن، وليس متوسطاً مقيساً لما ينفقه الناس.',
  'he', 'המחיר שמפרסם המפעיל לכרטיס נסיעה חודשי ללא הגבלה. מי שמשלם לפי נסיעה — 1 GEL ל‑90 דקות — עשוי להוציא פחות; המספר הזה הוא מחיר הכרטיס המפורסם, לא ממוצע מדוד של ההוצאה בפועל.'
)
where category = 'TRANSPORT' and status = 'CURRENT';

-- The guard below already earned its place: the Arabic first spelled
-- ninety out as لتسعين while every other figure on the page is a numeral,
-- and the check refused the migration until it matched.
--
-- Every current note a reader can reach must now exist in all six, and
-- must still carry its figures. A migration that localised nothing, or
-- that dropped a number on the way, fails here rather than on the page.
do $$
declare
  bad text;
begin
  select string_agg(category || ': ' || reason, ', ') into bad
  from (
    select category, 'missing locales' as reason
      from public.expat_cost_observations
     where status = 'CURRENT' and notes is not null
       and (notes_i18n is null
            or not (notes_i18n ?& array['en','ka','ru','tr','ar','he']))
    union all
    select category, 'a locale lost the figures'
      from public.expat_cost_observations, lateral jsonb_each_text(notes_i18n) as e(k, v)
     where status = 'CURRENT' and notes is not null
       and category = 'INTERNET' and (v not like '%33%' or v not like '%80%')
    union all
    select category, 'a locale lost the figures'
      from public.expat_cost_observations, lateral jsonb_each_text(notes_i18n) as e(k, v)
     where status = 'CURRENT' and notes is not null
       and category = 'TRANSPORT' and v not like '%90%'
  ) s;

  if bad is not null then
    raise exception 'cost note localisation incomplete: %', bad;
  end if;
end;
$$;

commit;
