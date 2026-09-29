-- ═══════════════════════════════════════════════════════════════════════
-- HOMATCH DESIGN STUDIO — the DEVELOPMENT concept set.
--
-- A small set of PROCEDURAL placeholder pieces, placeholder materials and
-- palettes, so placement, collision, replacement, materials, colours,
-- versioning and walkthrough can be proven end to end before the real
-- catalogue exists.
--
-- WHAT THESE ARE NOT
--   Not products. No brand, no retailer, no SKU, no price, no model file
--   from anywhere: every piece is drawn by HOMATCH code from its dimensions
--   (`procedural`), every material is a colour and a finish. They are
--   flagged is_placeholder / HOMATCH_DEV_PLACEHOLDER, the product labels them
--   as concept blocks, and Admin can deactivate every one of them. The real
--   catalogue is added later as properly licensed or owned assets, in the
--   same tables, with `is_placeholder = false`.
--
-- Idempotent: re-running inserts nothing that already exists and never
-- overwrites an Admin's edits (ON CONFLICT (code) DO NOTHING).
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO public.ds_catalog_assets
  (code, name, category, subcategory, room_kinds, style_tags, color_tags, material_tags,
   width_m, depth_m, height_m, placement, anchor, clearance_m, procedural, material_slots,
   variants, dominant_colors, provenance, is_placeholder, active)
VALUES
  -- Living
  ('dev/sofa-3', 'Three-seat sofa', 'SOFA', 'SOFA_3', '{LIVING}', '{contemporary,minimal,warm-minimal,scandinavian}', '{neutral}', '{fabric}',
   2.20, 0.95, 0.82, 'FLOOR', 'WALL', 0.90, '{"kind":"SOFA"}',
   '[{"id":"body","defaultColor":"#cfc6b8","roughness":0.95},{"id":"legs","defaultColor":"#3b3128","roughness":0.6}]',
   '[{"id":"sand","name":"Sand","colors":{"body":"#d8c8b0"}},{"id":"charcoal","name":"Charcoal","colors":{"body":"#4a4d52"}},{"id":"sage","name":"Sage","colors":{"body":"#a9b39a"}}]',
   '{#cfc6b8}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/sofa-2', 'Two-seat sofa', 'SOFA', 'SOFA_2', '{LIVING,BEDROOM}', '{contemporary,minimal,scandinavian}', '{neutral}', '{fabric}',
   1.70, 0.90, 0.82, 'FLOOR', 'WALL', 0.80, '{"kind":"SOFA"}',
   '[{"id":"body","defaultColor":"#bfb6a8","roughness":0.95},{"id":"legs","defaultColor":"#3b3128","roughness":0.6}]',
   '[{"id":"sand","name":"Sand","colors":{"body":"#d8c8b0"}},{"id":"navy","name":"Navy","colors":{"body":"#2e3a52"}}]',
   '{#bfb6a8}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/sofa-corner', 'Corner sofa', 'SOFA', 'SOFA_CORNER', '{LIVING}', '{contemporary,family}', '{neutral}', '{fabric}',
   2.70, 1.70, 0.82, 'FLOOR', 'CORNER', 0.90, '{"kind":"SOFA"}',
   '[{"id":"body","defaultColor":"#c9c2b6","roughness":0.95},{"id":"legs","defaultColor":"#2a2a2a","roughness":0.6}]',
   '[]', '{#c9c2b6}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/armchair', 'Armchair', 'ARMCHAIR', NULL, '{LIVING,BEDROOM}', '{contemporary,classic,scandinavian}', '{neutral}', '{fabric}',
   0.85, 0.85, 0.85, 'FLOOR', 'FREE', 0.60, '{"kind":"ARMCHAIR"}',
   '[{"id":"body","defaultColor":"#b9a58a","roughness":0.9},{"id":"legs","defaultColor":"#5b4432","roughness":0.6}]',
   '[{"id":"terracotta","name":"Terracotta","colors":{"body":"#b8735a"}},{"id":"cream","name":"Cream","colors":{"body":"#e6dccb"}}]',
   '{#b9a58a}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/coffee-table', 'Coffee table', 'TABLE', 'COFFEE', '{LIVING}', '{contemporary,minimal,japandi}', '{wood}', '{wood}',
   1.10, 0.60, 0.42, 'FLOOR', 'CENTRE', 0.00, '{"kind":"TABLE"}',
   '[{"id":"top","defaultColor":"#9c7a55","roughness":0.6},{"id":"legs","defaultColor":"#6d5238","roughness":0.6}]',
   '[{"id":"walnut","name":"Walnut","colors":{"top":"#5f4232","legs":"#4a3326"}},{"id":"white","name":"White","colors":{"top":"#efece6","legs":"#d9d5cd"}}]',
   '{#9c7a55}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/coffee-table-round', 'Round coffee table', 'TABLE', 'COFFEE', '{LIVING}', '{contemporary,japandi,luxury}', '{stone}', '{stone}',
   0.90, 0.90, 0.40, 'FLOOR', 'CENTRE', 0.00, '{"kind":"ROUND_TABLE"}',
   '[{"id":"top","defaultColor":"#e6e2dc","roughness":0.3},{"id":"legs","defaultColor":"#8a7f70","roughness":0.5}]',
   '[]', '{#e6e2dc}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/side-table', 'Side table', 'TABLE', 'SIDE', '{LIVING,BEDROOM}', '{contemporary,minimal}', '{wood}', '{wood}',
   0.45, 0.45, 0.55, 'FLOOR', 'FREE', 0.00, '{"kind":"ROUND_TABLE"}',
   '[{"id":"top","defaultColor":"#8b6b4c","roughness":0.6},{"id":"legs","defaultColor":"#6d5238","roughness":0.6}]',
   '[]', '{#8b6b4c}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/tv-unit', 'Media unit', 'STORAGE', 'MEDIA', '{LIVING}', '{contemporary,minimal}', '{wood}', '{wood}',
   1.80, 0.45, 0.50, 'FLOOR', 'WALL', 0.60, '{"kind":"CABINET"}',
   '[{"id":"body","defaultColor":"#8e6f50","roughness":0.6},{"id":"legs","defaultColor":"#2a2a2a","roughness":0.5}]',
   '[{"id":"white","name":"White","colors":{"body":"#efece6"}},{"id":"black","name":"Black","colors":{"body":"#2b2d31"}}]',
   '{#8e6f50}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/bookshelf', 'Bookshelf', 'STORAGE', 'SHELVING', '{LIVING,BEDROOM,OFFICE}', '{scandinavian,industrial}', '{wood}', '{wood}',
   1.00, 0.35, 1.90, 'FLOOR', 'WALL', 0.60, '{"kind":"SHELF"}',
   '[{"id":"body","defaultColor":"#a4845f","roughness":0.6}]',
   '[]', '{#a4845f}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/rug-large', 'Large rug', 'RUG', NULL, '{LIVING,BEDROOM}', '{contemporary,scandinavian,warm-minimal}', '{neutral}', '{textile}',
   2.40, 1.70, 0.01, 'FLOOR', 'CENTRE', 0.00, '{"kind":"RUG"}',
   '[{"id":"body","defaultColor":"#d9cfbf","roughness":1}]',
   '[{"id":"oat","name":"Oat","colors":{"body":"#ddd1bd"}},{"id":"slate","name":"Slate","colors":{"body":"#6b7078"}},{"id":"rust","name":"Rust","colors":{"body":"#a8664a"}}]',
   '{#d9cfbf}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/rug-medium', 'Medium rug', 'RUG', NULL, '{LIVING,BEDROOM,OFFICE}', '{contemporary,minimal}', '{neutral}', '{textile}',
   2.00, 1.40, 0.01, 'FLOOR', 'CENTRE', 0.00, '{"kind":"RUG"}',
   '[{"id":"body","defaultColor":"#cbbfad","roughness":1}]',
   '[]', '{#cbbfad}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/floor-lamp', 'Floor lamp', 'LIGHTING', 'FLOOR_LAMP', '{LIVING,BEDROOM,OFFICE}', '{contemporary,minimal}', '{metal}', '{metal}',
   0.40, 0.40, 1.60, 'FLOOR', 'FREE', 0.00, '{"kind":"LAMP"}',
   '[{"id":"body","defaultColor":"#2b2d31","roughness":0.4,"metalness":0.6},{"id":"shade","defaultColor":"#f1ebe0","roughness":0.9}]',
   '[]', '{#2b2d31}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/plant-large', 'Large plant', 'DECOR', 'PLANT', '{LIVING,BEDROOM,OFFICE,BALCONY,TERRACE}', '{natural,scandinavian,japandi}', '{green}', '{natural}',
   0.55, 0.55, 1.30, 'FLOOR', 'FREE', 0.00, '{"kind":"PLANT"}',
   '[{"id":"pot","defaultColor":"#c8b8a2","roughness":0.9},{"id":"leaves","defaultColor":"#56724a","roughness":0.9}]',
   '[]', '{#56724a}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  -- Bedroom
  ('dev/bed-double', 'Double bed', 'BED', 'DOUBLE', '{BEDROOM}', '{contemporary,minimal,scandinavian,japandi}', '{neutral}', '{fabric,wood}',
   1.60, 2.05, 0.95, 'FLOOR', 'WALL', 0.60, '{"kind":"BED"}',
   '[{"id":"body","defaultColor":"#a88b6c","roughness":0.7},{"id":"linen","defaultColor":"#efeae2","roughness":1}]',
   '[{"id":"oak","name":"Oak","colors":{"body":"#b8976f"}},{"id":"grey","name":"Grey","colors":{"body":"#8c8f95"}}]',
   '{#a88b6c}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/bed-single', 'Single bed', 'BED', 'SINGLE', '{BEDROOM}', '{contemporary,scandinavian,family}', '{neutral}', '{wood}',
   0.90, 2.00, 0.90, 'FLOOR', 'WALL', 0.60, '{"kind":"BED"}',
   '[{"id":"body","defaultColor":"#b39a7c","roughness":0.7},{"id":"linen","defaultColor":"#eef0f2","roughness":1}]',
   '[]', '{#b39a7c}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/bedside', 'Bedside table', 'STORAGE', 'BEDSIDE', '{BEDROOM}', '{contemporary,minimal}', '{wood}', '{wood}',
   0.45, 0.40, 0.50, 'FLOOR', 'WALL', 0.00, '{"kind":"CABINET"}',
   '[{"id":"body","defaultColor":"#9c7a55","roughness":0.6}]',
   '[]', '{#9c7a55}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/wardrobe-2', 'Two-door wardrobe', 'WARDROBE', NULL, '{BEDROOM,HALL}', '{contemporary,minimal}', '{white}', '{wood}',
   1.20, 0.60, 2.20, 'FLOOR', 'WALL', 0.80, '{"kind":"WARDROBE"}',
   '[{"id":"body","defaultColor":"#ebe7e0","roughness":0.6}]',
   '[{"id":"oak","name":"Oak","colors":{"body":"#bfa07a"}}]', '{#ebe7e0}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/wardrobe-3', 'Three-door wardrobe', 'WARDROBE', NULL, '{BEDROOM}', '{contemporary,minimal}', '{white}', '{wood}',
   1.80, 0.60, 2.20, 'FLOOR', 'WALL', 0.80, '{"kind":"WARDROBE"}',
   '[{"id":"body","defaultColor":"#ebe7e0","roughness":0.6}]',
   '[{"id":"oak","name":"Oak","colors":{"body":"#bfa07a"}},{"id":"graphite","name":"Graphite","colors":{"body":"#3d4046"}}]',
   '{#ebe7e0}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/dresser', 'Chest of drawers', 'STORAGE', 'DRESSER', '{BEDROOM}', '{classic,contemporary}', '{wood}', '{wood}',
   1.20, 0.50, 0.80, 'FLOOR', 'WALL', 0.70, '{"kind":"CABINET"}',
   '[{"id":"body","defaultColor":"#8e6f50","roughness":0.6}]',
   '[]', '{#8e6f50}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  -- Dining
  ('dev/dining-table-4', 'Dining table for four', 'TABLE', 'DINING', '{LIVING,KITCHEN}', '{contemporary,scandinavian,japandi}', '{wood}', '{wood}',
   1.40, 0.85, 0.75, 'FLOOR', 'CENTRE', 0.70, '{"kind":"TABLE"}',
   '[{"id":"top","defaultColor":"#a4845f","roughness":0.6},{"id":"legs","defaultColor":"#6d5238","roughness":0.6}]',
   '[{"id":"white","name":"White","colors":{"top":"#efece6","legs":"#d9d5cd"}}]', '{#a4845f}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/dining-table-6', 'Dining table for six', 'TABLE', 'DINING', '{LIVING,KITCHEN}', '{contemporary,luxury,family}', '{wood}', '{wood}',
   1.90, 0.95, 0.75, 'FLOOR', 'CENTRE', 0.70, '{"kind":"TABLE"}',
   '[{"id":"top","defaultColor":"#7a5a40","roughness":0.55},{"id":"legs","defaultColor":"#3b3128","roughness":0.6}]',
   '[]', '{#7a5a40}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/dining-chair', 'Dining chair', 'CHAIR', 'DINING', '{LIVING,KITCHEN}', '{contemporary,scandinavian}', '{wood}', '{wood}',
   0.45, 0.50, 0.85, 'FLOOR', 'FREE', 0.00, '{"kind":"CHAIR"}',
   '[{"id":"body","defaultColor":"#a4845f","roughness":0.6}]',
   '[{"id":"black","name":"Black","colors":{"body":"#2b2d31"}}]', '{#a4845f}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  -- Kitchen
  ('dev/kitchen-run', 'Kitchen run', 'KITCHEN', 'RUN', '{KITCHEN}', '{contemporary,minimal}', '{white}', '{laminate,stone}',
   2.40, 0.62, 0.90, 'FLOOR', 'WALL', 1.00, '{"kind":"KITCHEN_RUN"}',
   '[{"id":"body","defaultColor":"#eeebe5","roughness":0.5},{"id":"top","defaultColor":"#d7d2ca","roughness":0.3}]',
   '[{"id":"graphite","name":"Graphite","colors":{"body":"#3d4046"}},{"id":"sage","name":"Sage","colors":{"body":"#a6b09a"}}]',
   '{#eeebe5}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/kitchen-island', 'Kitchen island', 'KITCHEN', 'ISLAND', '{KITCHEN,LIVING}', '{contemporary,luxury}', '{white}', '{stone}',
   1.60, 0.90, 0.90, 'FLOOR', 'CENTRE', 0.90, '{"kind":"KITCHEN_RUN"}',
   '[{"id":"body","defaultColor":"#eeebe5","roughness":0.5},{"id":"top","defaultColor":"#e4e0da","roughness":0.25}]',
   '[]', '{#eeebe5}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/bar-stool', 'Bar stool', 'CHAIR', 'STOOL', '{KITCHEN,LIVING}', '{contemporary,industrial}', '{metal}', '{metal}',
   0.40, 0.40, 0.75, 'FLOOR', 'FREE', 0.00, '{"kind":"STOOL"}',
   '[{"id":"body","defaultColor":"#2b2d31","roughness":0.5,"metalness":0.4}]',
   '[]', '{#2b2d31}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  -- Office
  ('dev/desk', 'Desk', 'TABLE', 'DESK', '{BEDROOM,LIVING,OFFICE}', '{contemporary,minimal,scandinavian}', '{wood}', '{wood}',
   1.20, 0.60, 0.75, 'FLOOR', 'WALL', 0.80, '{"kind":"TABLE"}',
   '[{"id":"top","defaultColor":"#b8976f","roughness":0.6},{"id":"legs","defaultColor":"#2b2d31","roughness":0.5}]',
   '[]', '{#b8976f}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/office-chair', 'Desk chair', 'CHAIR', 'OFFICE', '{BEDROOM,LIVING,OFFICE}', '{contemporary}', '{neutral}', '{fabric}',
   0.60, 0.60, 1.00, 'FLOOR', 'FREE', 0.00, '{"kind":"CHAIR"}',
   '[{"id":"body","defaultColor":"#4a4d52","roughness":0.8}]',
   '[]', '{#4a4d52}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  -- Bathroom
  ('dev/vanity', 'Vanity unit', 'BATHROOM', 'VANITY', '{BATHROOM,WC}', '{contemporary,minimal}', '{white}', '{ceramic}',
   0.80, 0.48, 0.85, 'FLOOR', 'WALL', 0.70, '{"kind":"VANITY"}',
   '[{"id":"body","defaultColor":"#f2f0ec","roughness":0.3},{"id":"top","defaultColor":"#ffffff","roughness":0.2}]',
   '[{"id":"oak","name":"Oak","colors":{"body":"#bfa07a"}}]', '{#f2f0ec}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  -- Outdoor
  ('dev/outdoor-chair', 'Outdoor chair', 'OUTDOOR', 'CHAIR', '{BALCONY,TERRACE}', '{natural,mediterranean}', '{natural}', '{rattan}',
   0.60, 0.60, 0.80, 'FLOOR', 'FREE', 0.00, '{"kind":"ARMCHAIR"}',
   '[{"id":"body","defaultColor":"#b89a6e","roughness":0.9},{"id":"legs","defaultColor":"#8a7353","roughness":0.8}]',
   '[]', '{#b89a6e}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/outdoor-table', 'Outdoor table', 'OUTDOOR', 'TABLE', '{BALCONY,TERRACE}', '{natural,mediterranean}', '{natural}', '{wood}',
   0.70, 0.70, 0.72, 'FLOOR', 'CENTRE', 0.00, '{"kind":"ROUND_TABLE"}',
   '[{"id":"top","defaultColor":"#a88b6c","roughness":0.8},{"id":"legs","defaultColor":"#2b2d31","roughness":0.5}]',
   '[]', '{#a88b6c}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/planter', 'Planter', 'OUTDOOR', 'PLANTER', '{BALCONY,TERRACE,LIVING}', '{natural,mediterranean}', '{green}', '{ceramic}',
   0.50, 0.50, 0.70, 'FLOOR', 'FREE', 0.00, '{"kind":"PLANTER"}',
   '[{"id":"pot","defaultColor":"#b8735a","roughness":0.9},{"id":"leaves","defaultColor":"#5f7a4f","roughness":0.9}]',
   '[]', '{#5f7a4f}', 'HOMATCH_DEV_PLACEHOLDER', true, true)
ON CONFLICT (code) DO NOTHING;

-- Materials: colour + finish only. No texture files, so nothing here claims
-- to reproduce a real product's grain or pattern.
INSERT INTO public.ds_catalog_materials
  (code, name, category, applies_to, style_tags, color_family, pbr, provenance, is_placeholder, active)
VALUES
  ('dev/paint-warm-white', 'Warm white paint', 'WALL', '{WALL,CEILING}', '{warm-minimal,scandinavian,japandi}', 'white', '{"baseColor":"#f2eee6","roughness":0.9,"metalness":0}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/paint-pure-white', 'Pure white paint', 'WALL', '{WALL,CEILING}', '{minimal,contemporary}', 'white', '{"baseColor":"#f8f8f6","roughness":0.9,"metalness":0}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/paint-greige', 'Greige paint', 'WALL', '{WALL}', '{warm-minimal,contemporary}', 'beige', '{"baseColor":"#d8d0c3","roughness":0.9,"metalness":0}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/paint-sage', 'Sage paint', 'WALL', '{WALL}', '{natural,scandinavian}', 'green', '{"baseColor":"#b6bfa7","roughness":0.9,"metalness":0}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/paint-dusty-blue', 'Dusty blue paint', 'WALL', '{WALL}', '{calm,contemporary}', 'blue', '{"baseColor":"#a9b6c2","roughness":0.9,"metalness":0}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/paint-terracotta', 'Terracotta paint', 'WALL', '{WALL}', '{mediterranean,bold}', 'orange', '{"baseColor":"#c27f63","roughness":0.9,"metalness":0}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/paint-charcoal', 'Charcoal paint', 'WALL', '{WALL}', '{dark-contemporary,industrial}', 'grey', '{"baseColor":"#3f4348","roughness":0.9,"metalness":0}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/paint-sand', 'Sand paint', 'WALL', '{WALL}', '{mediterranean,warm-minimal}', 'beige', '{"baseColor":"#e2d3b9","roughness":0.9,"metalness":0}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/floor-light-oak', 'Light oak (concept)', 'FLOOR', '{FLOOR}', '{scandinavian,japandi,warm-minimal}', 'wood', '{"baseColor":"#cdb28b","roughness":0.7,"metalness":0}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/floor-natural-oak', 'Natural oak (concept)', 'FLOOR', '{FLOOR}', '{contemporary,natural}', 'wood', '{"baseColor":"#b48b5e","roughness":0.7,"metalness":0}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/floor-walnut', 'Walnut (concept)', 'FLOOR', '{FLOOR}', '{classic,luxury,dark-contemporary}', 'wood', '{"baseColor":"#6d4b36","roughness":0.65,"metalness":0}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/floor-grey-oak', 'Grey oak (concept)', 'FLOOR', '{FLOOR}', '{contemporary,industrial}', 'grey', '{"baseColor":"#a39a8d","roughness":0.7,"metalness":0}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/floor-white-stone', 'Pale stone (concept)', 'STONE', '{FLOOR}', '{luxury,minimal,mediterranean}', 'white', '{"baseColor":"#e7e3dc","roughness":0.3,"metalness":0}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/floor-concrete', 'Polished concrete (concept)', 'FLOOR', '{FLOOR}', '{industrial,minimal}', 'grey', '{"baseColor":"#9e9c98","roughness":0.55,"metalness":0}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/floor-terracotta-tile', 'Terracotta tile (concept)', 'TILE', '{FLOOR}', '{mediterranean,natural}', 'orange', '{"baseColor":"#b9765a","roughness":0.8,"metalness":0}', 'HOMATCH_DEV_PLACEHOLDER', true, true),
  ('dev/floor-dark-tile', 'Dark tile (concept)', 'TILE', '{FLOOR}', '{dark-contemporary,luxury}', 'grey', '{"baseColor":"#44474c","roughness":0.4,"metalness":0}', 'HOMATCH_DEV_PLACEHOLDER', true, true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.ds_palettes (code, name, colors, tags, sort, active)
VALUES
  ('warm-neutral', 'Warm neutral', '["#f2eee6","#e2d3b9","#cdb28b","#9c7a55","#4a3f36"]', '{warm,calm,natural}', 10, true),
  ('scandinavian', 'Scandinavian', '["#f8f8f6","#e6e2dc","#cdb28b","#8c8f95","#2e3a52"]', '{bright,minimal,natural}', 20, true),
  ('japandi', 'Japandi', '["#efeae2","#d8d0c3","#a88b6c","#6d4b36","#3f4348"]', '{calm,natural,minimal}', 30, true),
  ('dark-contemporary', 'Dark contemporary', '["#2b2d31","#3f4348","#6d4b36","#b48b5e","#e6e2dc"]', '{dark,elegant,bold}', 40, true),
  ('mediterranean', 'Mediterranean', '["#f2eee6","#e2d3b9","#c27f63","#6f8fa6","#5f7a4f"]', '{warm,bright,bold}', 50, true),
  ('botanical', 'Botanical', '["#f2eee6","#b6bfa7","#56724a","#a88b6c","#3b3128"]', '{natural,calm}', 60, true)
ON CONFLICT (code) DO NOTHING;
