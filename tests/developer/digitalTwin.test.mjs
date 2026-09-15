// The Digital Twin's two load-bearing claims, asserted against the migrations
// themselves rather than against a running database.
//
// These are the things that, if they silently regress, make the product either
// unsafe or uneconomic — and neither failure announces itself. A developer
// quietly gaining write access to the 3D looks like nothing at all until they
// break a published project; a manifest quietly starting to include unit rows
// looks like nothing at all until a 500-unit scheme costs a megabyte to open.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');

function migration(namePart) {
  const file = readdirSync(MIGRATIONS).find((f) => f.includes(namePart));
  assert.ok(file, `migration containing "${namePart}" exists`);
  return readFileSync(path.join(MIGRATIONS, file), 'utf8');
}

test('the 3D is writable by Homatch studio staff and by nobody else', () => {
  const twin = migration('digital_twin');

  // Every technical table's write policy goes through dev_is_studio().
  for (const table of ['dt_assets', 'dt_templates', 'dt_asset_refs']) {
    const policy = new RegExp(
      `create policy ${table}_write on public\\.${table}[\\s\\S]*?;`, 'm',
    ).exec(twin);
    assert.ok(policy, `${table} has a write policy`);
    assert.match(policy[0], /dev_is_studio\(\)/, `${table} write requires studio staff`);
    assert.doesNotMatch(
      policy[0], /dev_can\(/,
      `${table} write must not fall back to a developer capability`,
    );
  }

  // The scene tables are policed by a loop; assert the loop's body.
  assert.match(
    twin,
    /create policy %I_write on public\.%I for all to authenticated[\s\S]{0,120}dev_is_studio\(\)/,
    'scene and scene-version writes require studio staff',
  );

  /*
   * THE CORRECTION THIS MIGRATION EXISTS TO MAKE.
   *
   * dev_walkthroughs was created earlier in the same workstream with
   * dev_can(workspace,'inventory'), which let a customer's sales director
   * publish a 3D tour. If that ever comes back, this fails.
   */
  const walkthrough = /create policy dev_walkthroughs_write[\s\S]*?;/m.exec(twin);
  assert.ok(walkthrough, 'dev_walkthroughs write policy is redefined');
  assert.match(walkthrough[0], /dev_is_studio\(\)/);
  assert.doesNotMatch(walkthrough[0], /inventory/);
});

test('a developer can still READ everything built for them', () => {
  const twin = migration('digital_twin');
  // The boundary is about authorship, not secrecy. A customer who cannot see
  // their own project's assets and scenes has been sold a black box.
  for (const table of ['dt_assets', 'dt_templates', 'dt_experiences']) {
    const policy = new RegExp(
      `create policy ${table}_select on public\\.${table}[\\s\\S]*?;`, 'm',
    ).exec(twin);
    assert.ok(policy, `${table} has a select policy`);
    assert.match(
      policy[0], /dev_is_member\(|scope = 'GLOBAL'/,
      `${table} is readable by the workspace it belongs to`,
    );
  }

  // dt_scenes and dt_scene_versions get their select policy from the same
  // format() loop that grants their writes, so the literal policy name never
  // appears in the file. Assert the loop's body instead.
  assert.match(
    twin,
    /create policy %I_select on public\.%I for select to authenticated[\s\S]{0,140}dev_is_member\(workspace_id\)/,
    'scenes and scene versions are readable by the workspace they belong to',
  );
});

test('our cost data is not exposed to customers', () => {
  const twin = migration('digital_twin');
  const policy = /create policy dt_cost_rollup_select[\s\S]*?;/m.exec(twin);
  assert.ok(policy, 'cost rollup has a select policy');
  assert.match(policy[0], /dev_is_studio\(\)/);
  assert.doesNotMatch(
    policy[0], /dev_is_member\(/,
    'a developer must not be able to read what their project costs us',
  );
});

test('the public manifest returns counts, never unit rows', () => {
  const pub = migration('twin_public');
  const fn = /create or replace function public\.dt_experience_manifest[\s\S]*?\$\$;/m.exec(pub);
  assert.ok(fn, 'dt_experience_manifest exists');

  const body = fn[0];

  // Counts per building — the thing that makes payload size independent of
  // how many apartments a development has.
  assert.match(body, /count\(\*\) filter \(where u\.status = 'AVAILABLE'\)/);

  /*
   * The manifest must never select a unit's identity. If somebody adds
   * unit_number or price to it "just for convenience", a 500-unit project's
   * opening payload goes from kilobytes to megabytes and the cost model is
   * gone. The building aggregate legitimately reads u.status and u.price for
   * counts and a minimum; it must not emit a per-unit row.
   */
  assert.doesNotMatch(
    body, /'unit_number'/,
    'the manifest must not carry unit numbers — that is dt_floor_units\'s job',
  );
  assert.doesNotMatch(
    body, /jsonb_agg\(jsonb_build_object\([\s\S]{0,200}'id', u\.id/,
    'the manifest must not aggregate unit rows',
  );
});

test('a unit that is not available does not publish its price', () => {
  const pub = migration('twin_public');
  const fn = /create or replace function public\.dt_floor_units[\s\S]*?\$\$;/m.exec(pub);
  assert.ok(fn, 'dt_floor_units exists');
  assert.match(
    fn[0],
    /'price', case when u\.status = 'AVAILABLE' then u\.price else null end/,
    'price is withheld for anything not AVAILABLE',
  );
});

test('public twin functions are reachable by anon and the internals are not', () => {
  const pub = migration('twin_public');
  for (const fn of ['dt_experience_manifest', 'dt_building_floors', 'dt_floor_units', 'dt_track']) {
    assert.match(
      pub, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public;`),
      `${fn} is revoked from PUBLIC before being granted`,
    );
    assert.match(
      pub, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to anon, authenticated;`),
      `${fn} is a deliberate public entry point`,
    );
  }

  // The studio boundary must never be callable anonymously.
  const twin = migration('digital_twin');
  assert.match(twin, /revoke all on function public\.dev_is_studio\(\) from public;/);
  assert.doesNotMatch(twin, /grant execute on function public\.dev_is_studio\(\) to anon/);
});

test('analytics are capped and cannot be driven per frame', () => {
  const pub = migration('twin_public');
  const fn = /create or replace function public\.dt_track[\s\S]*?\$\$;/m.exec(pub);
  assert.ok(fn, 'dt_track exists');

  // A hard ceiling per call, so one request cannot become an unbounded write.
  assert.match(fn[0], /where n <= 50/, 'events per call are capped');

  // The allowlist is meaningful acts only. Anything camera- or frame-shaped
  // would have to be added here, and should not be.
  const allowed = /v_allowed constant text\[\] := array\[([\s\S]*?)\];/m.exec(fn[0]);
  assert.ok(allowed, 'the event allowlist is explicit');
  assert.doesNotMatch(allowed[1], /CAMERA|FRAME|TICK|POSITION|MOVE/i,
    'no frame-level or camera-level event kind may be accepted');
});

test('the import builds the reuse spine instead of only free text', () => {
  const imp = migration('import_unit_types');
  // A layout code from the developer's own sheet becomes a unit type, and the
  // unit is linked to it. Without this, 500 units means 500 models.
  assert.match(imp, /insert into public\.dev_unit_types/);
  assert.match(imp, /unit_type_id\s*=\s*coalesce\(v_type, unit_type_id\)/);
  assert.match(imp, /'unit_types_created', v_types_created/);

  // The original text column is still written, so nothing that reads it breaks.
  assert.match(imp, /unit_type\s*=\s*coalesce\(nullif\(v_row->>'unit_type', ''\), unit_type\)/);

  // An import must never attach 3D — that is studio work.
  const insertTypes = /insert into public\.dev_unit_types[\s\S]*?returning id into v_type;/m.exec(imp);
  assert.ok(insertTypes);
  assert.doesNotMatch(insertTypes[0], /template_id/,
    'an import must not assign a 3D template');
});

test('heavy assets are addressed immutably and through one resolver', () => {
  const twin = readFileSync(path.join(ROOT, 'src/services/developer/twin.ts'), 'utf8');

  // The version/hash is in the URL, which is what lets a CDN cache forever and
  // is why marking a unit sold invalidates nothing.
  assert.match(twin, /const cacheKey = asset\.content_hash \?\? String\(asset\.version\)/);
  assert.match(twin, /\?v=\$\{cacheKey\}/);

  // Storage provider is data, so heavy assets can move to R2/CDN without a
  // rewrite of the domain model.
  assert.match(twin, /case 'R2':/);
  assert.match(twin, /VITE_TWIN_ASSET_CDN/);

  // No paid per-view 3D runtime may creep into the serving path.
  assert.doesNotMatch(
    twin, /matterport|unity|unreal|sketchfab/i,
    'the twin runtime must not depend on a per-view 3D provider',
  );
});
