-- Additional web-search-verified communities: more Batumi-focused real
-- estate groups, plus general Russian-speaking / expat community chats where
-- housing topics come up alongside other subjects (per user request — not
-- just dedicated Georgian real-estate groups, but the broader expat/
-- Russian-speaking community ecosystem). Every canonical_url below was found
-- via live web search (mostly via TGStat listings for Telegram); none are
-- guessed. member_count left NULL where no source reported a number.
-- No VK groups or Reddit subreddits are included in this batch — repeated
-- searches did not surface any I could confirm actually exist (VK/Reddit
-- content isn't reliably indexed by the search tool available), so nothing
-- was fabricated. VK/REDDIT/WHATSAPP remain supported platforms for future
-- curation once verifiable ones are found.
INSERT INTO public.community_directory
  (platform, canonical_url, name, description, language, country, city, member_count, posting_policy, posting_allowed, allows_auto_post, tags, topics, housing_focus, is_active, last_verified_at, metadata)
VALUES
  ('FACEBOOK', 'https://www.facebook.com/groups/1685243068265407/', 'Недвижимость Батуми ( Аренда, Покупка, Продажа )', 'Facebook group dedicated to Batumi real estate — rent, buy, sell.', 'ru', 'Georgia', 'Batumi', NULL, 'APPROVAL_REQUIRED', true, false, ARRAY['rent','sale'], ARRAY['real_estate'], 'primary', true, now(), '{"verification_source":"web_search"}'::jsonb),
  ('FACEBOOK', 'https://www.facebook.com/groups/batumihelp/', 'Недвижимость Батуми | Аренда и продажа квартир', 'Facebook group dedicated to Batumi apartment rental and sale.', 'ru', 'Georgia', 'Batumi', NULL, 'APPROVAL_REQUIRED', true, false, ARRAY['rent','sale'], ARRAY['real_estate'], 'primary', true, now(), '{"verification_source":"web_search"}'::jsonb),
  ('TELEGRAM', 'https://t.me/mybatumi_apartments', 'Квартиры Батуми | My Apartments', 'Telegram chat for Batumi and Tbilisi apartment rental/sale listings.', 'ru', 'Georgia', 'Batumi', NULL, 'UNKNOWN', NULL, false, ARRAY['rent','sale'], ARRAY['real_estate'], 'primary', true, now(), '{"verification_source":"tgstat","note":"Existence confirmed via TGStat; posting policy unconfirmed."}'::jsonb),
  ('TELEGRAM', 'https://t.me/Gruzia_chat', 'ГРУЗИЯ ЧАТ | ЗНАКОМСТВА | ОБЪЯВЛЕНИЯ Батуми Тбилиси Кобулети Рустави Кутаиси', 'General Georgia-wide classifieds/announcements chat covering multiple cities — housing ads appear alongside other listings.', 'ru', 'Georgia', NULL, NULL, 'UNKNOWN', NULL, false, ARRAY['general','classifieds'], ARRAY['community'], 'secondary', true, now(), '{"verification_source":"tgstat","note":"General classifieds chat, not a dedicated real-estate group — kept for visibility."}'::jsonb),
  ('TELEGRAM', 'https://t.me/batumi_360', 'Батуми 360 | объявления', 'General Batumi classifieds/announcements chat.', 'ru', 'Georgia', 'Batumi', NULL, 'UNKNOWN', NULL, false, ARRAY['general','classifieds'], ARRAY['community'], 'secondary', true, now(), '{"verification_source":"tgstat","note":"General classifieds chat, not a dedicated real-estate group — kept for visibility."}'::jsonb),
  ('TELEGRAM', 'https://t.me/baraholka_avito_batumi', 'Барахолка Батуми', 'General Batumi secondhand-marketplace chat; housing occasionally posted alongside other items.', 'ru', 'Georgia', 'Batumi', NULL, 'UNKNOWN', NULL, false, ARRAY['general','classifieds'], ARRAY['community'], 'secondary', true, now(), '{"verification_source":"tgstat","note":"General marketplace chat, not a dedicated real-estate group — kept for visibility."}'::jsonb),
  ('TELEGRAM', 'https://t.me/batumi_group', 'Батуми чат', 'General Batumi community chat.', 'ru', 'Georgia', 'Batumi', NULL, 'UNKNOWN', NULL, false, ARRAY['general'], ARRAY['community'], 'secondary', true, now(), '{"verification_source":"tgstat","note":"General community chat, not a dedicated real-estate group — kept for visibility."}'::jsonb),
  ('TELEGRAM', 'https://t.me/russians_in_tbilisi', 'Русские в Тбилиси', 'General Russian-speaking expat chat for people living in or moving to Tbilisi; housing questions are a recurring topic.', 'ru', 'Georgia', 'Tbilisi', NULL, 'UNKNOWN', NULL, false, ARRAY['general','expat'], ARRAY['community','real_estate'], 'secondary', true, now(), '{"verification_source":"tgstat","note":"General expat community chat, not a dedicated real-estate group — kept for expat-buyer visibility."}'::jsonb),
  ('TELEGRAM', 'https://t.me/GeorgiaRelocated', 'Georgia expats | релокация экспаты в Грузии', 'General relocation/expat chat for Georgia (IT and non-IT); housing/apartment topics come up alongside relocation logistics.', 'ru', 'Georgia', NULL, NULL, 'UNKNOWN', NULL, false, ARRAY['general','expat'], ARRAY['community','real_estate'], 'secondary', true, now(), '{"verification_source":"tgstat","note":"General relocation/expat chat, not a dedicated real-estate group — kept for expat-buyer visibility."}'::jsonb)
ON CONFLICT DO NOTHING;
