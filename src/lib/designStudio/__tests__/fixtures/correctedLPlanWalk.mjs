// Walkthrough revision 2 of project 149f8b85, as production built it: the plan read again (one staircase,
// both bedrooms opening to the living room) and the design's validated scene plan with the catalogue rows it used.
const it = (code, type, pose, scale = 1, color = null) => ({ code, type, pose, scale, color, origin: pose ? 'PLANNED' : 'PROGRAMME' });
const P = (x, y, rotationDeg) => ({ x, y, rotationDeg });
const room = (roomId, items, floorMaterial = 'dev/floor-light-oak') => ({ roomId, floorMaterial, floorColor: '#d8bc91', wallMaterial: 'dev/paint-pure-white', wallColor: '#f4f6f7', wallFinish: 'MATTE', accent: null, ceilingColor: '#f5f2ed', items });
export const plan = {
  lighting: { timeOfDay: 'DAY', temperature: 'NEUTRAL', interiorIntensity: 0.82 },
  palette: ['#f4f6f7', '#dce2e5', '#d8bc91', '#d4d2cb', '#17191a', '#e8e1d5'],
  styleCode: 'contemporary',
  rooms: [
    room('r1', [it('dev/sofa-3', 'SOFA', P(2.28, 3.05, 90)), it('dev/coffee-table-round', 'COFFEE_TABLE', P(1.42, 3.05, 0), 0.95), it('dev/tv-unit', 'MEDIA', P(0.32, 3.05, 270)), it('dev/armchair', 'ARMCHAIR', P(2.55, 4.55, 180), 0.95), it('dev/rug-large', 'RUG', P(1.45, 3.05, 0), 0.95), it('dev/floor-lamp', 'LAMP', P(2.95, 4.55, 0), 0.9)]),
    room('r2', [it('dev/bed-double', 'BED', P(1.35, 2.18, 0)), it('dev/bedside', 'BEDSIDE', P(0.28, 2.18, 0), 0.9), it('dev/wardrobe-2', 'WARDROBE', P(2.55, 3.65, 90), 0.95), it('dev/bedside', 'BEDSIDE', P(2.42, 2.18, 0), 0.9), it('dev/rug-medium', 'RUG', P(1.35, 2.15, 0), 0.95)]),
    room('r3', [it('dev/bed-double', 'BED', P(1.32, 2.2, 0)), it('dev/bedside', 'BEDSIDE', null), it('dev/wardrobe-2', 'WARDROBE', P(2.55, 3.45, 90), 0.9), it('dev/desk', 'DESK', P(1, 0.92, 180), 0.9), it('dev/office-chair', 'DESK_CHAIR', P(1, 1.55, 180), 0.85), it('dev/rug-medium', 'RUG', P(1.28, 2.25, 0), 0.85), it('dev/floor-lamp', 'LAMP', P(1.95, 1, 0), 0.85)]),
    room('r4', [it('dev/kitchen-run', 'KITCHEN_RUN', P(0.36, 1.72, 270)), it('dev/dining-table-4', 'DINING_TABLE', P(1.55, 2.75, 0), 0.9), it('dev/dining-chair', 'DINING_CHAIR', P(0.72, 2.75, 90), 0.9), it('dev/dining-chair', 'DINING_CHAIR', P(2.38, 2.75, 270), 0.9), it('dev/dining-chair', 'DINING_CHAIR', P(1.55, 2.18, 180), 0.9), it('dev/dining-chair', 'DINING_CHAIR', P(1.55, 3.32, 0), 0.9), it('dev/fridge', 'KITCHEN_OTHER', P(2.5, 1, 270), 0.9)]),
    room('r7', [it('dev/toilet', 'TOILET', P(0.52, 0.34, 0), 0.85), it('dev/vanity', 'VANITY', P(0.53, 1.02, 180), 0.85)], 'dev/floor-white-stone'),
    room('r8', [it('dev/toilet', 'TOILET', P(1.08, 0.35, 0), 0.85), it('dev/vanity', 'VANITY', P(1, 1.05, 180), 0.85), it('dev/shower', 'SHOWER', P(0.42, 0.67, 0), 0.85)], 'dev/floor-white-stone'),
    room('r5', [it('dev/planter', 'PLANTER', P(2.78, 0.72, 0), 0.85), it('dev/outdoor-chair', 'OUTDOOR_CHAIR', P(0.78, 1.15, 0), 0.9), it('dev/outdoor-table', 'OUTDOOR_TABLE', P(1.3, 1.15, 0), 0.85), it('dev/outdoor-chair', 'OUTDOOR_CHAIR', P(1.82, 1.15, 0), 0.9)], 'dev/floor-white-stone'),
    room('r9', [it('dev/planter', 'PLANTER', P(5.78, 0.31, 0), 0.85), it('dev/outdoor-chair', 'OUTDOOR_CHAIR', P(1.65, 0.31, 0), 0.88), it('dev/outdoor-chair', 'OUTDOOR_CHAIR', P(4.72, 0.31, 0), 0.88)], 'dev/floor-white-stone'),
  ],
};
const A = (code, category, subcategory, w, d, h, anchor, clearance, kind, rooms) => ({ id: `id-${code}`, code, name: code, category, subcategory, room_kinds: rooms, width_m: w, depth_m: d, height_m: h, placement: 'FLOOR', anchor, clearance_m: clearance, procedural: { kind }, active: true, material_slots: [], variants: [] });
export const assetRows = [
  A('dev/sofa-3', 'SOFA', 'SOFA_3', 2.2, 0.95, 0.82, 'WALL', 0.9, 'SOFA', ['LIVING']),
  A('dev/armchair', 'ARMCHAIR', null, 0.85, 0.85, 0.85, 'FREE', 0.6, 'ARMCHAIR', ['LIVING', 'BEDROOM']),
  A('dev/coffee-table-round', 'TABLE', 'COFFEE', 0.9, 0.9, 0.4, 'CENTRE', 0, 'ROUND_TABLE', ['LIVING']),
  A('dev/tv-unit', 'STORAGE', 'MEDIA', 1.8, 0.45, 0.5, 'WALL', 0.6, 'TV_UNIT', ['LIVING']),
  A('dev/rug-large', 'RUG', null, 2.4, 1.7, 0.01, 'CENTRE', 0, 'RUG', ['LIVING', 'BEDROOM']),
  A('dev/rug-medium', 'RUG', null, 2.0, 1.4, 0.01, 'CENTRE', 0, 'RUG', ['LIVING', 'BEDROOM', 'OFFICE']),
  A('dev/floor-lamp', 'LIGHTING', 'FLOOR_LAMP', 0.4, 0.4, 1.6, 'FREE', 0, 'LAMP', ['LIVING', 'BEDROOM', 'OFFICE']),
  A('dev/bed-double', 'BED', 'DOUBLE', 1.6, 2.05, 0.95, 'WALL', 0.6, 'BED', ['BEDROOM']),
  A('dev/bedside', 'STORAGE', 'BEDSIDE', 0.45, 0.4, 0.5, 'WALL', 0, 'DRESSER', ['BEDROOM']),
  A('dev/wardrobe-2', 'WARDROBE', null, 1.2, 0.6, 2.2, 'WALL', 0.8, 'WARDROBE', ['BEDROOM', 'HALL']),
  A('dev/dining-table-4', 'TABLE', 'DINING', 1.4, 0.85, 0.75, 'CENTRE', 0.7, 'TABLE', ['LIVING', 'KITCHEN']),
  A('dev/dining-chair', 'CHAIR', 'DINING', 0.45, 0.5, 0.85, 'FREE', 0, 'CHAIR', ['LIVING', 'KITCHEN']),
  A('dev/shower', 'BATHROOM', 'SHOWER', 0.9, 0.9, 2.0, 'CORNER', 0.6, 'SHOWER', ['BATHROOM']),
  A('dev/kitchen-run', 'KITCHEN', 'RUN', 2.4, 0.62, 0.9, 'WALL', 1.0, 'KITCHEN_RUN', ['KITCHEN']),
  A('dev/desk', 'TABLE', 'DESK', 1.2, 0.6, 0.75, 'WALL', 0.8, 'TABLE', ['BEDROOM', 'LIVING', 'OFFICE']),
  A('dev/office-chair', 'CHAIR', 'OFFICE', 0.6, 0.6, 1.0, 'FREE', 0, 'CHAIR', ['BEDROOM', 'LIVING', 'OFFICE']),
  A('dev/vanity', 'BATHROOM', 'VANITY', 0.8, 0.48, 0.85, 'WALL', 0.7, 'VANITY', ['BATHROOM', 'WC']),
  A('dev/outdoor-chair', 'OUTDOOR', 'CHAIR', 0.6, 0.6, 0.8, 'FREE', 0, 'ARMCHAIR', ['BALCONY', 'TERRACE']),
  A('dev/outdoor-table', 'OUTDOOR', 'TABLE', 0.7, 0.7, 0.72, 'CENTRE', 0, 'ROUND_TABLE', ['BALCONY', 'TERRACE']),
  A('dev/planter', 'OUTDOOR', 'PLANTER', 0.5, 0.5, 0.7, 'FREE', 0, 'PLANTER', ['BALCONY', 'TERRACE', 'LIVING']),
  A('dev/fridge', 'KITCHEN', 'APPLIANCE', 0.6, 0.65, 1.85, 'WALL', 1.0, 'FRIDGE', ['KITCHEN']),
  A('dev/toilet', 'BATHROOM', 'TOILET', 0.38, 0.62, 0.8, 'WALL', 0.6, 'TOILET', ['BATHROOM', 'WC']),
];
