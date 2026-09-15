// THE TECHNICAL BOUNDARY, asserted rather than trusted.
//
// Two editing levels: a DEVELOPER maintains price, status and availability;
// HOMATCH STUDIO STAFF build the 3D. The whole value of that separation is
// that neither side can quietly become the other — a developer publishing a
// half-finished scene onto their own website, or a 3D artist reading a
// customer's prices.
//
// Both halves of the boundary fail silently if they break, which is why they
// are checked here and not only reviewed.

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

const STUDIO = migration('developer_os_studio');

/** Every studio function, by the name it is declared under. */
function studioFunctions(sql) {
  return [...sql.matchAll(/create or replace function public\.(dt_studio_[a-z_]+)\(/g)]
    .map((m) => m[1]);
}

test('every studio function refuses a caller who is not studio staff', () => {
  const names = studioFunctions(STUDIO);
  assert.ok(names.length >= 10, `found ${names.length} studio functions`);

  for (const name of names) {
    const body = new RegExp(
      `create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, 'm',
    ).exec(STUDIO);
    assert.ok(body, `${name} is defined`);
    assert.match(
      body[0], /dev_is_studio\(\)/,
      `${name} must check dev_is_studio()`,
    );
  }
});

test('the studio read carries no price, buyer or money', () => {
  const body = /create or replace function public\.dt_studio_project\([\s\S]*?\n\$\$;/m
    .exec(STUDIO)[0];

  // A 3D artist has no business knowing what floor eleven costs, and the
  // answer is absent from the SELECT list rather than filtered in the client.
  for (const forbidden of ['u.price', 'sale_price', 'dev_leads', 'dev_deals', 'dev_payments']) {
    assert.ok(!body.includes(forbidden),
      `the studio project read must not expose ${forbidden}`);
  }

  // What it DOES carry: the geometry-relevant shape.
  assert.match(body, /'unit_types',/, 'layouts are the unit of work');
  assert.match(body, /'buildings',/);
  assert.match(body, /'unit_number', u\.unit_number/,
    'hotspots need to point at real apartments');
});

test('the studio list exposes no commercial position either', () => {
  const body = /create or replace function public\.dt_studio_projects\([\s\S]*?\n\$\$;/m
    .exec(STUDIO)[0];
  for (const forbidden of ['price', 'sale', 'revenue', 'dev_leads']) {
    assert.ok(!body.includes(forbidden),
      `the studio work queue must not expose ${forbidden}`);
  }
});

test('no existing policy is widened to make the studio work', () => {
  // The obvious fix — adding `or dev_is_studio()` to dev_projects,
  // dev_buildings or dev_units — would hand every 3D artist read access to
  // every customer's prices. This migration must not contain it.
  assert.ok(!/create policy dev_projects_select/.test(STUDIO));
  assert.ok(!/create policy dev_units_select/.test(STUDIO));
  assert.ok(!/create policy dev_buildings_select/.test(STUDIO));
  assert.ok(!/alter table public\.dev_(projects|units|buildings)/.test(STUDIO),
    'the studio migration must not alter the developer-facing tables');
});

test('what a project costs us stays internal', () => {
  const body = /create or replace function public\.dt_studio_costs\([\s\S]*?\n\$\$;/m
    .exec(STUDIO)[0];
  assert.match(body, /case when not public\.dev_is_studio\(\) then null/,
    'a developer reading this gets null, not a number');
  // The developer's own analytics are a different function entirely, and it
  // reports interest rather than our margin.
  const analytics = /create or replace function public\.dt_analytics\([\s\S]*?\n\$\$;/m
    .exec(migration('developer_os_offers_extraction'))[0];
  for (const forbidden of ['cost', 'bytes', 'bandwidth', 'dt_cost_rollup']) {
    assert.ok(!analytics.includes(forbidden),
      `developer analytics must not expose ${forbidden}`);
  }
});

test('publishing a scene is a pointer move, never an edit in place', () => {
  const save = /create or replace function public\.dt_studio_save_version\([\s\S]*?\n\$\$;/m
    .exec(STUDIO)[0];
  // A new row every time. That is what lets a published page stay completely
  // still while somebody works on the next version — and it is the same
  // property that makes asset URLs safe to cache forever.
  assert.match(save, /select coalesce\(max\(version\), 0\) \+ 1 into v_next/);
  assert.match(save, /insert into public\.dt_scene_versions/);
  assert.ok(!/update public\.dt_scene_versions\s+set graph/.test(save),
    'a version is never rewritten');

  const publish = /create or replace function public\.dt_studio_publish_scene\([\s\S]*?\n\$\$;/m
    .exec(STUDIO)[0];
  assert.match(
    publish,
    /if not exists \([\s\S]{0,160}where id = p_version_id and scene_id = p_scene_id\)[\s\S]{0,140}raise exception/,
    'a version from another scene cannot be published',
  );
  assert.match(publish, /insert into public\.dev_audit_log/);
});

test('assets are deduplicated by content, not by name', () => {
  const body = /create or replace function public\.dt_studio_register_asset\([\s\S]*?\n\$\$;/m
    .exec(STUDIO)[0];
  assert.match(
    body,
    /where content_hash = p_content_hash[\s\S]{0,160}return jsonb_build_object\('id', v_existing\.id, 'reused', true/,
    'identical bytes resolve to the row that already exists',
  );

  // And the client hashes before it uploads, so a duplicate never crosses
  // the network at all.
  const service = readFileSync(path.join(ROOT, 'src/services/developer/studio.ts'), 'utf8');
  const begin = service.indexOf('export async function uploadStudioAsset(');
  assert.ok(begin > 0, 'uploadStudioAsset is defined');
  const upload = service.slice(
    begin, service.indexOf('export async function attachAsset', begin),
  );
  const hashAt = upload.indexOf('await hashFile(');
  const registerAt = upload.indexOf('await registerAsset(');
  const uploadAt = upload.indexOf('.upload(');
  assert.ok(hashAt > 0 && registerAt > hashAt && uploadAt > registerAt,
    'hash, then register, then upload only if it is new');
  assert.match(upload, /if \(registered\.reused\) return registered;/);

  // The hash IS the key, which is what makes ?v=<hash> a real immutability
  // guarantee rather than a convention somebody has to keep.
  assert.match(upload, /const storageKey = `\$\{prefix\}\/\$\{hash\}\.\$\{extension\}`/);
  assert.match(upload, /cacheControl: '31536000'/);
});

test('a visitor can only load a scene that is genuinely published', () => {
  const body = /create or replace function public\.dt_scene\([\s\S]*?\n\$\$;/m
    .exec(migration('twin_scene_public'))[0];

  // Three gates, because the caller is anonymous.
  assert.match(body, /and s\.status = 'PUBLISHED'/);
  assert.match(body, /and v\.published_at is not null/);
  assert.match(body, /and p\.is_published/);
  assert.match(
    body,
    /exists \([\s\S]{0,180}from public\.dt_experiences e[\s\S]{0,120}e\.status = 'PUBLISHED'\)/,
    'the experience must be published too',
  );

  // Deliverables only: a source file or a 300MB master is ours, not
  // something to hand a phone.
  assert.match(body, /and a\.is_deliverable/);

  // Assets are returned as addressing fields, so moving them to R2 stays a
  // column change rather than a rewrite.
  assert.match(body, /'storage_provider', a\.storage_provider/);
  assert.ok(!body.includes('getPublicUrl'), 'SQL does not build URLs');
});

// ── The viewer ─────────────────────────────────────────────────────────────

test('the viewer never depends on a per-view 3D provider', () => {
  const canvas = readFileSync(
    path.join(ROOT, 'src/components/developer/TwinCanvas.tsx'), 'utf8',
  );

  /* Comments are stripped first. The file EXPLAINS at length why a
     pixel-streamed Unreal or Unity scene is the wrong trade, and a blunt
     search would fail on the explanation rather than on a dependency. What
     matters is the executable text. */
  const code = canvas
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  assert.doesNotMatch(code, /matterport|unity|unreal|sketchfab/i);
  assert.ok(!/cdn|unpkg|jsdelivr|gstatic/i.test(code),
    'no runtime CDN dependency in the viewer');

  // Decoders come from our own origin instead: a viewer that breaks when
  // somebody else's free tier changes is not a viewer we own.
  assert.match(code, /setDecoderPath\('\/three\/draco\/'\)/);
  assert.match(code, /setTranscoderPath\('\/three\/basis\/'\)/);

  const vite = readFileSync(path.join(ROOT, 'vite.config.ts'), 'utf8');
  assert.match(vite, /fileName: asset\.to/, 'the decoder paths are unhashed');
  assert.match(vite, /three\/draco\/draco_decoder\.wasm/);
  assert.match(vite, /three\/basis\/basis_transcoder\.wasm/);
});

test('the viewer draws no frames when nothing is happening', () => {
  const canvas = readFileSync(
    path.join(ROOT, 'src/components/developer/TwinCanvas.tsx'), 'utf8',
  );
  // On-demand rendering is most of the battery story and most of the reason
  // a million opens a month is affordable. A permanent rAF loop here would
  // undo both without any visible symptom.
  assert.match(
    canvas,
    /state\.invalidate = \(\) => \{[\s\S]{0,400}if \(state\.frame !== null\) return;/,
    'a frame is requested only when one is not already pending',
  );
  assert.match(canvas, /if \(moving\) state\.invalidate\(\);/,
    'the loop continues only while the camera is still settling');

  // Everything the renderer allocated is released on unmount. A leaked WebGL
  // context survives the route change and eventually exhausts the browser.
  assert.match(canvas, /renderer\.dispose\(\);/);
  assert.match(canvas, /renderer\.forceContextLoss\(\);/);
  assert.match(canvas, /function disposeTree\(root: THREE\.Object3D\)/);
});

test('the schematic says it is a schematic', () => {
  const canvas = readFileSync(
    path.join(ROOT, 'src/components/developer/TwinCanvas.tsx'), 'utf8',
  );
  // Inventing a plausible tower from nothing would be a lie told in 3D. The
  // fallback is a labelled diagram of real floor counts, and the label is not
  // optional.
  assert.match(canvas, /mode === 'SCHEMATIC'/);
  assert.match(canvas, /t\('twin_schematic_badge'\)/);
  assert.match(canvas, /t\(failed \? 'twin_model_failed' : 'twin_schematic_note'\)/);

  // MODEL mode requires an actual published asset, never an assumption.
  assert.match(
    canvas,
    /const mode: TwinMode = scene && scene\.assets\.length > 0 \? 'MODEL' : 'SCHEMATIC'/,
  );
});

test('the studio UI is offered only to studio staff', () => {
  for (const file of ['StudioPage.tsx', 'StudioProjectPage.tsx']) {
    const page = readFileSync(
      path.join(ROOT, 'src/pages/developer', file), 'utf8',
    );
    assert.match(page, /const \{[^}]*isStudio[^}]*\} = useDeveloperWorkspace\(\)/);
    assert.match(page, /if \(!isStudio\)/,
      `${file} renders an explanation rather than the tool`);
    assert.match(page, /studio_internal_only/);
  }
});
