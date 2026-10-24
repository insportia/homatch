-- Homepage: the HOMI region (section type 'homatch_ai') becomes the second
-- section, directly after the hero (owner instruction, 2026-10-24).
--
-- The code default (src/site/render/order.ts) already says so, but the live
-- homepage renders a Site Studio-published order (site_pages.published,
-- published 2026-09-27) in which the region is tenth, and a published order
-- supersedes the code default. This moves that one section in the published
-- and draft documents and changes nothing else: every other section keeps its
-- content and its relative order, the hero stays first.
--
-- Idempotent: running it again finds the section already second and rewrites
-- the same array. A page without a homatch_ai section is left untouched.

update public.site_pages p
   set published = jsonb_set(
         p.published, '{sections}',
         (select jsonb_agg(e order by case when e->>'type' = 'hero' then 0
                                           when e->>'type' = 'homatch_ai' then 1
                                           else 2 end, ord)
            from jsonb_array_elements(p.published->'sections') with ordinality as t(e, ord)))
 where p.slug = 'home'
   and p.published is not null
   and jsonb_typeof(p.published->'sections') = 'array'
   and exists (select 1 from jsonb_array_elements(p.published->'sections') e where e->>'type' = 'homatch_ai');

update public.site_pages p
   set draft = jsonb_set(
         p.draft, '{sections}',
         (select jsonb_agg(e order by case when e->>'type' = 'hero' then 0
                                           when e->>'type' = 'homatch_ai' then 1
                                           else 2 end, ord)
            from jsonb_array_elements(p.draft->'sections') with ordinality as t(e, ord)))
 where p.slug = 'home'
   and jsonb_typeof(p.draft->'sections') = 'array'
   and exists (select 1 from jsonb_array_elements(p.draft->'sections') e where e->>'type' = 'homatch_ai');
