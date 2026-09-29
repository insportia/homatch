// The REAL development catalogue, read from its seed migration — so tests
// that match or build against the catalogue use exactly what production
// gets, not a hand-made stand-in.

import fs from 'node:fs';
import path from 'node:path';
import { assetFromRow, materialFromRow } from '../catalog.ts';

const SEED = path.join(process.cwd(), 'supabase/migrations/20260930091000_design_studio_dev_catalog.sql');
const ARRAYS = new Set(['room_kinds', 'style_tags', 'color_tags', 'material_tags', 'dominant_colors', 'capabilities', 'applies_to', 'colors', 'tags']);
const JSONS = new Set(['procedural', 'material_slots', 'variants', 'pbr', 'interactions']);

/** Split `(a, 'b', ...), (...)` into tuples of raw SQL literals. */
function tuples(values) {
  const out = [];
  let depth = 0; let cur = null; let tok = ''; let inStr = false;
  for (let i = 0; i < values.length; i += 1) {
    const ch = values[i];
    if (inStr) {
      if (ch === "'" && values[i + 1] === "'") { tok += "''"; i += 1; continue; }
      if (ch === "'") inStr = false;
      tok += ch;
      continue;
    }
    if (ch === '-' && values[i + 1] === '-') { while (i < values.length && values[i] !== '\n') i += 1; continue; }
    if (ch === "'") { inStr = true; tok += ch; continue; }
    if (ch === '(') { depth += 1; if (depth === 1) { cur = []; tok = ''; continue; } }
    if (ch === ')') { depth -= 1; if (depth === 0) { cur.push(tok.trim()); out.push(cur); cur = null; tok = ''; continue; } }
    if (ch === ',' && depth === 1) { cur.push(tok.trim()); tok = ''; continue; }
    if (depth >= 1) tok += ch;
  }
  return out;
}

function literal(raw, column) {
  if (/^'.*'$/s.test(raw)) {
    const s = raw.slice(1, -1).replace(/''/g, "'");
    if (ARRAYS.has(column)) return s.replace(/^\{|\}$/g, '').split(',').map((x) => x.trim()).filter(Boolean);
    if (JSONS.has(column)) return JSON.parse(s);
    return s;
  }
  if (raw === 'true' || raw === 'false') return raw === 'true';
  if (/^null$/i.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : raw;
}

function rows(table) {
  const sql = fs.readFileSync(SEED, 'utf8');
  const re = new RegExp(`INSERT INTO public\\.${table}\\s*\\(([^)]*)\\)\\s*VALUES([\\s\\S]*?)ON CONFLICT`, 'g');
  const out = [];
  for (const m of sql.matchAll(re)) {
    const cols = m[1].split(',').map((c) => c.trim());
    for (const t of tuples(m[2])) {
      const row = {};
      cols.forEach((c, i) => { row[c] = literal(t[i], c); });
      out.push(row);
    }
  }
  return out;
}

export function seedAssets() {
  return rows('ds_catalog_assets').map((r, i) => assetFromRow({ id: `seed-${i}`, lods: [], ...r }));
}

export function seedMaterials() {
  return rows('ds_catalog_materials').map((r, i) => materialFromRow({ id: `mat-${i}`, ...r }));
}
