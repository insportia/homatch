// DESIGN STUDIO — RLS AND GUARD CHECK AGAINST A REAL POSTGRES.
//
// Applies supabase/migrations/*_design_studio_*.sql to PGlite (Postgres 17
// in WebAssembly) on top of minimal stubs of the Supabase/HOMATCH objects it
// references (auth.uid/role, users, properties, dev_units, dt_unit_scene),
// then drives it as anon, two customers, an admin and service_role.
//
// Not part of `npm test` because it needs PGlite, which is deliberately not a
// project dependency. Run it without touching the lockfile:
//
//   npm i --no-save @electric-sql/pglite@0.3
//   node scripts/design-studio/rls-check.mjs //     supabase/migrations/20260930090000_design_studio_foundation.sql //     supabase/migrations/20260930092000_design_studio_storage_categories.sql
//     supabase/migrations/20260930094000_design_studio_shares.sql
//     supabase/migrations/20260930091000_design_studio_dev_catalog.sql
//     supabase/migrations/20260930095000_design_studio_reconstruction.sql
//
// It proves the migration's behaviour; it is not a substitute for applying
// the migration through the deploy workflow.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { createHash } from 'node:crypto';
import fs from 'node:fs';

const MIGRATION = process.argv[2];
const STORAGE_MIGRATION = process.argv[3] ?? null;
const SHARES_MIGRATION = process.argv[4] ?? null;
const CATALOG_SEED = process.argv[5] ?? null;
const RECON_MIGRATION = process.argv[6] ?? null;
const DELETE_MIGRATION = process.argv[7] ?? null;
const ORIGIN_MIGRATION = process.argv[8] ?? null;
const SHARE_ORIGIN_MIGRATION = process.argv[9] ?? null;
const ORIGINAL_MIGRATION = process.argv[10] ?? null;
const FRAME_MIGRATION = process.argv[11] ?? null;
const FACTORY_MIGRATION = process.argv[12] ?? null;
const VIEWS_MIGRATION = process.argv[13] ?? null;
const db = new PGlite({ extensions: { pgcrypto } });
let failures = 0;
const ok = (name) => console.log(`  ok   ${name}`);
const bad = (name, detail) => { failures++; console.log(`  FAIL ${name}\n       ${detail}`); };

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const ADM = '00000000-0000-0000-0000-0000000000ad';
const UA = '10000000-0000-0000-0000-00000000000a'; // users.id
const UB = '10000000-0000-0000-0000-00000000000b';
const UADM = '10000000-0000-0000-0000-0000000000ad';

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  create schema auth; grant usage on schema auth to anon, authenticated, service_role;
  create schema extensions; create extension pgcrypto schema extensions;
  grant usage on schema extensions to anon, authenticated, service_role;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub','')::uuid $$;
  create function auth.role() returns text language sql stable as $$
    select coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role','anon') $$;
  grant execute on all functions in schema auth to anon, authenticated, service_role;

  create table public.users (id uuid primary key, auth_id uuid unique, is_admin boolean not null default false);
  create table public.properties (id uuid primary key default gen_random_uuid(), user_id uuid references public.users(id),
    title text, is_deleted boolean not null default false);
  create function public.auth_user_id() returns uuid language sql stable security definer set search_path to '' as $$
    select id from public.users where auth_id = auth.uid() $$;
  create function public.is_admin() returns boolean language sql stable security definer set search_path to '' as $$
    select coalesce((select is_admin from public.users where auth_id = auth.uid()), false) $$;

  create table public.dev_projects (id uuid primary key, name text not null, is_published boolean not null default false);
  create table public.dev_buildings (id uuid primary key, name text not null);
  create table public.dev_units (id uuid primary key, project_id uuid not null references public.dev_projects(id),
    building_id uuid references public.dev_buildings(id), unit_number text not null, floor_level int,
    area_total numeric, ceiling_height numeric, is_published boolean not null default false);
  create table public._stub_scene (unit_id uuid primary key, scene_id uuid, version int);
  create function public.dt_unit_scene(p uuid) returns jsonb language sql stable security definer set search_path to '' as $$
    select coalesce((select jsonb_build_object('id', s.scene_id, 'version', s.version, 'unit_type_id', null)
      from public._stub_scene s join public.dev_units u on u.id = s.unit_id join public.dev_projects dp on dp.id = u.project_id
      where s.unit_id = p and u.is_published and dp.is_published), jsonb_build_object('error','NO_SCENE')) $$;

  insert into public.users values ('${UA}','${A}',false),('${UB}','${B}',false),('${UADM}','${ADM}',true);
  insert into public.properties (id, user_id, title) values
    ('20000000-0000-0000-0000-00000000000a','${UA}','A flat'),('20000000-0000-0000-0000-00000000000b','${UB}','B flat');
  insert into public.dev_projects values ('30000000-0000-0000-0000-000000000001','Riverside',true),
    ('30000000-0000-0000-0000-000000000002','Draft',false);
  insert into public.dev_buildings values ('40000000-0000-0000-0000-000000000001','Building A');
  insert into public.dev_units values
    ('50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','704',7,82,2.8,true),
    ('50000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002',null,'101',1,50,2.7,true);
  insert into public._stub_scene values ('50000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001',3),
    ('50000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000002',1);
`);

await db.exec(fs.readFileSync(MIGRATION, 'utf8'));
ok('migration applies cleanly');
await db.exec(fs.readFileSync(MIGRATION, 'utf8'));
ok('migration re-applies (idempotent DDL)');

async function as(who, fn) {
  const claims = who === 'anon' ? { role: 'anon' }
    : who === 'service' ? { role: 'service_role' }
    : { sub: who, role: 'authenticated' };
  const role = who === 'anon' ? 'anon' : who === 'service' ? 'service_role' : 'authenticated';
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    await tx.query(`set local role ${role}`);
    return fn(tx);
  });
}
async function expectError(name, code, fn) {
  try { await fn(); bad(name, `expected ${code}, succeeded`); }
  catch (e) { (String(e.message).includes(code) ? ok : (n) => bad(n, e.message))(name); }
}
const one = async (tx, sql, params = []) => (await tx.query(sql, params)).rows[0];

// ── projects
const pA = (await as(A, (tx) => one(tx, `insert into ds_projects (user_id, name, property_id)
  values ($1,'Mine','20000000-0000-0000-0000-00000000000a') returning id, active_source_id, status`, [UA])));
pA.id ? ok('A creates a project on their own property') : bad('create', 'no id');
await expectError('A cannot create a project on B\'s property', 'DS_PROPERTY_NOT_OWNED', () => as(A, (tx) =>
  tx.query(`insert into ds_projects (user_id, name, property_id) values ($1,'x','20000000-0000-0000-0000-00000000000b')`, [UA])));
await expectError('A cannot create a project owned by B', 'row-level security', () => as(A, (tx) =>
  tx.query(`insert into ds_projects (user_id, name) values ($1,'x')`, [UB])));
const bSees = await as(B, (tx) => tx.query(`select id from ds_projects where id = $1`, [pA.id]));
bSees.rows.length === 0 ? ok('B cannot read A\'s project') : bad('isolation', 'B read A');
const bUpd = await as(B, (tx) => tx.query(`update ds_projects set name='pwned' where id = $1`, [pA.id]));
bUpd.affectedRows === 0 ? ok('B cannot update A\'s project') : bad('isolation', 'B updated A');
const admSees = await as(ADM, (tx) => tx.query(`select id from ds_projects where id = $1`, [pA.id]));
admSees.rows.length === 1 ? ok('admin can read any project') : bad('admin read', 'no row');
await expectError('anon has no table privilege', 'permission denied', () => as('anon', (tx) => tx.query(`select * from ds_projects`)));
await expectError('anon cannot call the attach function', 'permission denied', () => as('anon', (tx) =>
  tx.query(`select ds_attach_developer_unit($1,'50000000-0000-0000-0000-000000000001')`, [pA.id])));

// ── sources: never inserted by a browser
await expectError('A cannot insert a source row directly', 'permission denied', () => as(A, (tx) =>
  tx.query(`insert into ds_spatial_sources (project_id,user_id,kind,geometry_state,upstream)
    values ($1,$2,'DEVELOPER_UNIT','VERIFIED','{}')`, [pA.id, UA])));

// ── developer unit attachment
const s1 = await as(A, (tx) => one(tx, `select ds_attach_developer_unit($1,'50000000-0000-0000-0000-000000000001') as id`, [pA.id]));
const srow = await as(A, (tx) => one(tx, `select * from ds_spatial_sources where id=$1`, [s1.id]));
srow.geometry_state === 'VERIFIED' && srow.upstream.version === '3' && srow.provenance.unit_number === '704'
  ? ok('attach pins the published scene version, VERIFIED, with unit context') : bad('attach', JSON.stringify(srow));
const s1again = await as(A, (tx) => one(tx, `select ds_attach_developer_unit($1,'50000000-0000-0000-0000-000000000001') as id`, [pA.id]));
s1again.id === s1.id ? ok('attach is idempotent per published version') : bad('idempotent', 'new row');
await expectError('an unpublished project\'s unit cannot be attached', 'DS_NO_PUBLISHED_SCENE', () => as(A, (tx) =>
  tx.query(`select ds_attach_developer_unit($1,'50000000-0000-0000-0000-000000000002')`, [pA.id])));
await expectError('B cannot attach into A\'s project', 'DS_PROJECT_NOT_OWNED', () => as(B, (tx) =>
  tx.query(`select ds_attach_developer_unit($1,'50000000-0000-0000-0000-000000000001')`, [pA.id])));
const devRows = await db.query(`select count(*)::int n from dev_units where unit_number <> '704' and unit_number <> '101'`);
devRows.rows[0].n === 0 ? ok('developer tables untouched') : bad('dev', 'rows changed');

// ── active source
await as(A, (tx) => tx.query(`update ds_projects set active_source_id=$1 where id=$2`, [s1.id, pA.id]));
ok('A sets their own source active');
const pB = await as(B, (tx) => one(tx, `insert into ds_projects (user_id,name) values ($1,'B') returning id`, [UB]));
const sB = await as(B, (tx) => one(tx, `select ds_attach_developer_unit($1,'50000000-0000-0000-0000-000000000001') as id`, [pB.id]));
await expectError('A cannot point their project at B\'s source', 'DS_SOURCE_MISMATCH', () => as(A, (tx) =>
  tx.query(`update ds_projects set active_source_id=$1 where id=$2`, [sB.id, pA.id])));
await expectError('A cannot edit a source row', 'permission denied', () => as(A, (tx) =>
  tx.query(`update ds_spatial_sources set geometry_state='ESTIMATED' where id=$1`, [s1.id])));
await expectError('even service_role-free definer paths cannot mutate a READY source', 'DS_SOURCE_IMMUTABLE', () =>
  db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', '{"role":"authenticated"}', true)`);
    await tx.query(`update ds_spatial_sources set geometry_state='ESTIMATED' where id=$1`, [s1.id]);
  }));

// ── versions
const v1 = await as(A, (tx) => one(tx, `insert into ds_versions (project_id,user_id,source_id,name,origin,state,revision)
  values ($1,$2,$3,'Original','ORIGINAL','{"schema":1}',99) returning id, revision`, [pA.id, UA, s1.id]));
v1.revision === 0 ? ok('a new version starts at revision 0 whatever the client sends') : bad('revision', v1.revision);
const r1 = await as(A, (tx) => one(tx, `update ds_versions set state='{"schema":1,"objects":[]}', revision=500 where id=$1 returning revision`, [v1.id]));
r1.revision === 1 ? ok('a state change advances the revision by exactly one') : bad('revision', r1.revision);
const r2 = await as(A, (tx) => one(tx, `update ds_versions set name='Renamed' where id=$1 returning revision`, [v1.id]));
r2.revision === 1 ? ok('a rename does not advance the revision') : bad('revision', r2.revision);
const conflict = await as(A, (tx) => tx.query(`update ds_versions set state='{"schema":1,"x":1}' where id=$1 and revision=0`, [v1.id]));
conflict.affectedRows === 0 ? ok('a save against a stale revision matches nothing (conflict detectable)') : bad('conflict', 'updated');
await expectError('a version cannot be moved onto other geometry', 'DS_VERSION_IDENTITY_IMMUTABLE', () => as(A, (tx) =>
  tx.query(`update ds_versions set source_id=source_id, parent_id=$2 where id=$1`, [v1.id, v1.id])));
await expectError('a version cannot reference another project\'s source', 'DS_SOURCE_MISMATCH', () => as(A, (tx) =>
  tx.query(`insert into ds_versions (project_id,user_id,source_id,name) values ($1,$2,$3,'x')`, [pA.id, UA, sB.id])));
await as(A, (tx) => tx.query(`update ds_projects set head_version_id=$1 where id=$2`, [v1.id, pA.id]));
ok('A sets their head version');
await expectError('state larger than 1 MB is refused', 'check constraint', () => as(A, (tx) =>
  tx.query(`update ds_versions set state=jsonb_build_object('pad', repeat('x', 1100000)) where id=$1`, [v1.id])));

// ── events (append-only)
await as(A, (tx) => tx.query(`insert into ds_version_events (version_id,user_id,revision,origin,ops) values ($1,$2,1,'USER','[]')`, [v1.id, UA]));
ok('A appends an operation event');
await expectError('events cannot be rewritten', 'permission denied', () => as(A, (tx) =>
  tx.query(`update ds_version_events set ops='[1]'`)));
await expectError('a browser cannot write a SYSTEM event', 'DS_ORIGIN_NOT_ALLOWED', () => as(A, (tx) =>
  tx.query(`insert into ds_version_events (version_id,user_id,revision,origin,ops) values ($1,$2,1,'SYSTEM','[]')`, [v1.id, UA])));
await expectError('an AI event needs a finished AI job', 'DS_ORIGIN_NOT_ALLOWED', () => as(A, (tx) =>
  tx.query(`insert into ds_version_events (version_id,user_id,revision,origin,ops) values ($1,$2,1,'AI','[]')`, [v1.id, UA])));
const aiJob = await as('service', (tx) => one(tx, `insert into ds_jobs (user_id,project_id,kind,status) values ($1,$2,'AI_DESIGN','SUCCEEDED') returning id`, [UA, pA.id]));
await as(A, (tx) => tx.query(`insert into ds_version_events (version_id,user_id,revision,origin,ops,job_id) values ($1,$2,1,'AI','[]',$3)`, [v1.id, UA, aiJob.id]));
ok('an AI event with the customer\'s own finished AI job is recorded');
await expectError('a second ORIGINAL for the same space is refused', 'DS_ORIGIN_NOT_ALLOWED', () => as(A, (tx) =>
  tx.query(`insert into ds_versions (project_id,user_id,source_id,name,origin) values ($1,$2,$3,'x','ORIGINAL')`, [pA.id, UA, s1.id])));
await expectError('an AI version needs a finished AI job', 'DS_ORIGIN_NOT_ALLOWED', () => as(A, (tx) =>
  tx.query(`insert into ds_versions (project_id,user_id,source_id,name,origin) values ($1,$2,$3,'x','AI')`, [pA.id, UA, s1.id])));
const aiV = await as(A, (tx) => one(tx, `insert into ds_versions (project_id,user_id,source_id,name,origin,job_id) values ($1,$2,$3,'Idea','AI',$4) returning job_id`, [pA.id, UA, s1.id, aiJob.id]));
aiV.job_id === aiJob.id ? ok('an AI version names the job that proposed it') : bad('ai version', JSON.stringify(aiV));
const userV = await as(A, (tx) => one(tx, `insert into ds_versions (project_id,user_id,source_id,name,origin,job_id) values ($1,$2,$3,'Mine','USER',$4) returning job_id`, [pA.id, UA, s1.id, aiJob.id]));
userV.job_id === null ? ok('a user version cannot borrow an AI job reference') : bad('user version job', JSON.stringify(userV));
await expectError('B cannot append to A\'s version', 'row-level security', () => as(B, (tx) =>
  tx.query(`insert into ds_version_events (version_id,user_id,revision,origin,ops) values ($1,$2,1,'USER','[]')`, [v1.id, UA])));
await expectError('B cannot append to A\'s version under her own id', 'DS_VERSION_NOT_OWNED', () => as(B, (tx) =>
  tx.query(`insert into ds_version_events (version_id,user_id,revision,origin,ops) values ($1,$2,1,'USER','[]')`, [v1.id, UB])));

// ── saved views
await as(A, (tx) => tx.query(`insert into ds_saved_views (project_id,user_id,name,camera) values ($1,$2,'Living','{}')`, [pA.id, UA]));
ok('A saves a view');
await expectError('B cannot save a view into A\'s project', 'DS_PROJECT_NOT_OWNED', () => as(B, (tx) =>
  tx.query(`insert into ds_saved_views (project_id,user_id,name,camera) values ($1,$2,'x','{}')`, [pA.id, UB])));

// ── floor plans
await expectError('a floor-plan row cannot point at someone else\'s object', 'DS_OBJECT_KEY_INVALID', () => as(A, (tx) =>
  tx.query(`insert into ds_floorplans (project_id,user_id,object_key,mime,bytes) values ($1,$2,$3,'image/png',1000)`,
    [pA.id, UA, `users/${UB}/design-studio-floorplans/${pA.id}/x.png`])));
await expectError('a floor-plan key cannot climb out of its folder', 'DS_OBJECT_KEY_INVALID', () => as(A, (tx) =>
  tx.query(`insert into ds_floorplans (project_id,user_id,object_key,mime,bytes) values ($1,$2,$3,'image/png',1000)`,
    [pA.id, UA, `users/${UA}/design-studio-floorplans/${pA.id}/../../x.png`])));
const f = await as(A, (tx) => one(tx, `insert into ds_floorplans (project_id,user_id,object_key,mime,bytes,status,interpretation)
  values ($1,$2,$3,'image/png',1000,'INTERPRETED','{"x":1}') returning id, status, interpretation`,
  [pA.id, UA, `users/${UA}/design-studio-floorplans/${pA.id}/plan.png`]));
f.status === 'UPLOADED' && f.interpretation === null ? ok('a browser cannot insert an interpretation') : bad('fp', JSON.stringify(f));
await expectError('a browser cannot write the interpretation', 'DS_SERVER_FIELD', () => as(A, (tx) =>
  tx.query(`update ds_floorplans set interpretation='{}' where id=$1`, [f.id])));
await as(A, (tx) => tx.query(`update ds_floorplans set corrections='[{"a":1}]' where id=$1`, [f.id]));
ok('a browser writes corrections');
await expectError('no geometry from an uninterpreted plan', 'DS_FLOORPLAN_NOT_INTERPRETED', () => as(A, (tx) =>
  tx.query(`select ds_create_floorplan_source($1,'{"schema":1}','ESTIMATED',null,'ds-1')`, [f.id])));
await as('service', (tx) => tx.query(`update ds_floorplans set status='INTERPRETED', interpretation='{"rooms":[]}' where id=$1`, [f.id]));
const est = await as(A, (tx) => one(tx, `select ds_create_floorplan_source($1,'{"schema":1}','ESTIMATED',null,'ds-1') as id`, [f.id]));
ok('ESTIMATED geometry needs no anchor');
await expectError('CALIBRATED needs an anchor', 'DS_CALIBRATION_REQUIRED', () => as(A, (tx) =>
  tx.query(`select ds_create_floorplan_source($1,'{"schema":1}','CALIBRATED','{"anchors":[]}','ds-1')`, [f.id])));
await expectError('VERIFIED needs two anchors', 'DS_VERIFICATION_REQUIRED', () => as(A, (tx) =>
  tx.query(`select ds_create_floorplan_source($1,'{"schema":1}','VERIFIED','{"anchors":[{}]}','ds-1')`, [f.id])));
// VERIFIED is checked against the geometry being stored.
const scene = JSON.stringify({ schema: 1, scene: {
  floors: [{ id: 'r1', areaM2: 40, outdoor: false }, { id: 'r2', areaM2: 30, outdoor: false }, { id: 'b', areaM2: 5, outdoor: true }],
  walls: [{ id: 'w1', lengthM: 10 }],
} });
const anchors = (list) => JSON.stringify({ anchors: list });
await expectError('VERIFIED with two anchors on the same thing is refused', 'DS_VERIFICATION_REQUIRED', () => as(A, (tx) =>
  tx.query(`select ds_create_floorplan_source($1,$2,'VERIFIED',$3,'ds-1')`, [f.id, scene,
    anchors([{ kind: 'TOTAL_AREA', valueM2: 70 }, { kind: 'TOTAL_AREA', valueM2: 70 }])])));
await expectError('VERIFIED with measurements that disagree with the geometry is refused', 'DS_VERIFICATION_DISAGREES', () => as(A, (tx) =>
  tx.query(`select ds_create_floorplan_source($1,$2,'VERIFIED',$3,'ds-1')`, [f.id, scene,
    anchors([{ kind: 'TOTAL_AREA', valueM2: 70 }, { kind: 'WALL_LENGTH', wallId: 'w1', valueM: 12 }])])));
await expectError('VERIFIED naming a wall that does not exist is refused', 'DS_VERIFICATION_DISAGREES', () => as(A, (tx) =>
  tx.query(`select ds_create_floorplan_source($1,$2,'VERIFIED',$3,'ds-1')`, [f.id, scene,
    anchors([{ kind: 'TOTAL_AREA', valueM2: 70 }, { kind: 'WALL_LENGTH', wallId: 'nope', valueM: 10 }])])));
const ver = await as(A, (tx) => one(tx, `select ds_create_floorplan_source($1,$2,'VERIFIED',$3,'ds-1') as id`, [f.id, scene,
  anchors([{ kind: 'TOTAL_AREA', valueM2: 71 }, { kind: 'ROOM_AREA', roomId: 'r1', valueM2: 40.5 }, { kind: 'WALL_LENGTH', wallId: 'w1', valueM: 10.1 }])]));
const verRow = await as(A, (tx) => one(tx, `select geometry_state, provenance from ds_spatial_sources where id=$1`, [ver.id]));
verRow.geometry_state === 'VERIFIED' && verRow.provenance.verified_by === 'CUSTOMER_MEASUREMENTS'
  ? ok('agreeing measurements of different things verify, and say so') : bad('verified', JSON.stringify(verRow));
const cal = await as(A, (tx) => one(tx, `select ds_create_floorplan_source($1,'{"schema":1}','CALIBRATED','{"anchors":[{}]}','ds-1') as id`, [f.id]));
const states = await as(A, (tx) => tx.query(`select id, status from ds_spatial_sources where floorplan_id=$1`, [f.id]));
const map = Object.fromEntries(states.rows.map((r) => [r.id, r.status]));
map[est.id] === 'SUPERSEDED' && map[ver.id] === 'SUPERSEDED' && map[cal.id] === 'READY'
  ? ok('recalibration supersedes, never overwrites') : bad('supersede', JSON.stringify(map));
await expectError('B cannot generate geometry from A\'s plan', 'DS_FLOORPLAN_NOT_OWNED', () => as(B, (tx) =>
  tx.query(`select ds_create_floorplan_source($1,'{"schema":1}','ESTIMATED',null,'ds-1')`, [f.id])));

// ── payload constraint (even service_role)
await expectError('a READY source must carry its payload', 'ds_sources_payload', () => as('service', (tx) =>
  tx.query(`insert into ds_spatial_sources (project_id,user_id,kind,geometry_state) values ($1,$2,'UPLOADED_MODEL','ESTIMATED')`, [pA.id, UA])));

// ── privileges are explicit
await expectError('a browser cannot insert a job', 'permission denied', () => as(A, (tx) =>
  tx.query(`insert into ds_jobs (user_id,kind) values ($1,'AI_DESIGN')`, [UA])));
await expectError('a browser cannot delete a version', 'permission denied', () => as(A, (tx) =>
  tx.query(`delete from ds_versions where id=$1`, [v1.id])));

// ── catalog
await as(ADM, (tx) => tx.query(`insert into ds_catalog_assets (code,name,category,width_m,depth_m,height_m,provenance,is_placeholder,procedural,active)
  values ('dev/sofa','Sofa','SOFA',2,0.9,0.8,'HOMATCH_DEV_PLACEHOLDER',true,'{"kind":"SOFA"}',true),
         ('dev/hidden','Hidden','SOFA',2,0.9,0.8,'HOMATCH_DEV_PLACEHOLDER',true,'{"kind":"SOFA"}',false)`));
ok('admin writes catalog rows');
const cat = await as(A, (tx) => tx.query(`select code from ds_catalog_assets order by code`));
cat.rows.map((r) => r.code).join() === 'dev/sofa' ? ok('customers read only active catalog rows') : bad('catalog', JSON.stringify(cat.rows));
await expectError('customers cannot write the catalog', 'row-level security', () => as(A, (tx) =>
  tx.query(`insert into ds_catalog_assets (code,name,category,width_m,depth_m,height_m,provenance,model_key)
    values ('x/y','x','SOFA',1,1,1,'HOMATCH_OWNED','k')`)));
await expectError('a placeholder must be marked as one', 'ds_catalog_assets_shape', () => as(ADM, (tx) =>
  tx.query(`insert into ds_catalog_assets (code,name,category,width_m,depth_m,height_m,provenance,is_placeholder)
    values ('x/z','x','SOFA',1,1,1,'LICENSED',true)`)));

// ── capabilities and interactions (what a piece may do; how its parts open)
const caps = await db.query(`select capabilities, interactions from ds_catalog_assets where code='dev/sofa'`);
caps.rows[0].capabilities.join() === 'MOVABLE,ROTATABLE,REPLACEABLE,DUPLICATABLE' && Array.isArray(caps.rows[0].interactions) && caps.rows[0].interactions.length === 0
  ? ok('catalog: a piece moves, turns, swaps and duplicates by default, and opens nothing') : bad('capability defaults', JSON.stringify(caps.rows[0]));
await expectError('catalog: an unknown capability is refused', 'check constraint', () => as(ADM, (tx) =>
  tx.query(`update ds_catalog_assets set capabilities = '{MOVABLE,FLY}' where code='dev/sofa'`)));
await expectError('catalog: interactions must be a list', 'check constraint', () => as(ADM, (tx) =>
  tx.query(`update ds_catalog_assets set interactions = '{"kind":"HINGED"}' where code='dev/sofa'`)));
if (CATALOG_SEED) {
  await db.exec(fs.readFileSync(CATALOG_SEED, 'utf8'));
  await db.exec(fs.readFileSync(CATALOG_SEED, 'utf8'));
  const seeded = await db.query(`select code, capabilities from ds_catalog_assets where code in ('dev/fridge','dev/wardrobe-2','dev/kitchen-run','dev/sofa-3') order by code`);
  const by = Object.fromEntries(seeded.rows.map((r) => [r.code, r.capabilities]));
  const opens = (c) => (by[c] ?? []).filter((x) => x === 'OPENABLE').length === 1;
  opens('dev/fridge') && opens('dev/wardrobe-2') && opens('dev/kitchen-run') && by['dev/sofa-3'] && !by['dev/sofa-3'].includes('OPENABLE')
    ? ok('seed: applies twice; fridge, wardrobe and kitchen open once-marked, a sofa does not') : bad('seed capabilities', JSON.stringify(by));
}

// ── jobs
await expectError('customers cannot create jobs', 'permission denied', () => as(A, (tx) =>
  tx.query(`insert into ds_jobs (user_id, kind) values ($1,'AI_DESIGN')`, [UA])));

// ── object storage (the R2 authorisation function, Design Studio branch)
if (STORAGE_MIGRATION) {
  await db.exec(fs.readFileSync(STORAGE_MIGRATION, 'utf8'));
  const pB2 = await as(B, (tx) => one(tx, `insert into ds_projects (user_id,name) values ($1,'B2') returning id`, [UB]));
  const key = (acct, cat, proj) => `users/${acct}/${cat}/${proj}/00000000-0000-4000-8000-000000000001.glb`;
  const verdict = (who, k, action) => as(who, (tx) => one(tx, 'select public.storage_authorize($1,$2) as v', [k, action]));
  const cases = [
    [B, key(UB, 'design-studio-models', pB2.id), 'WRITE', 'ALLOW', 'the owner may upload into their own project'],
    [B, key(UB, 'design-studio-thumbnails', pB2.id), 'READ', 'ALLOW', 'the owner may read their own thumbnails'],
    [A, key(UB, 'design-studio-models', pB2.id), 'READ', 'NOT_OWNER', 'another customer may not read it'],
    [A, key(UA, 'design-studio-models', pB2.id), 'WRITE', 'NOT_OWNER', 'another customer may not write into it under their own account'],
    [ADM, key(UB, 'design-studio-floorplans', pB2.id), 'READ', 'ALLOW', 'Admin may read'],
    [ADM, key(UB, 'design-studio-floorplans', pB2.id), 'DELETE', 'NOT_OWNER', 'Admin may not delete a customer file'],
    [B, `users/${UB}/design-studio-models/not-a-uuid/x.glb`, 'WRITE', 'INVALID_KEY', 'a malformed key is refused'],
    [B, `users/${UB}/design-studio-unknown/${pB2.id}/x.glb`, 'WRITE', 'INVALID_KEY', 'an unlisted category is refused'],
    ['anon', key(UB, 'design-studio-models', pB2.id), 'READ', 'UNAUTHENTICATED', 'anonymous callers are refused'],
  ];
  for (const [who, k, action, expected, name] of cases) {
    try {
      const r = await verdict(who, k, action);
      r.v === expected ? ok(`storage: ${name}`) : bad(`storage: ${name}`, `got ${r.v}`);
    } catch (e) { bad(`storage: ${name}`, e.message); }
  }
}

// ── public share links
if (SHARES_MIGRATION) {
  await db.exec(fs.readFileSync(SHARES_MIGRATION, 'utf8'));
  await db.exec(fs.readFileSync(SHARES_MIGRATION, 'utf8'));
  ok('shares: migration applies and re-applies');

  const scene = { schema: 1, geometryState: 'CALIBRATED', scene: { floors: [{ id: 'r1', kind: 'LIVING', areaM2: 20 }], walls: [] } };
  const src = await as('service', (tx) => one(tx, `insert into ds_spatial_sources (project_id,user_id,kind,status,geometry_state,editability,floorplan_id,canonical)
    values ($1,$2,'FLOORPLAN_SCENE','READY','CALIBRATED','GENERATED',$3,$4) returning id`, [pA.id, UA, f.id, JSON.stringify(scene)]));
  const ver = await as(A, (tx) => one(tx, `insert into ds_versions (project_id,user_id,source_id,name,origin,state)
    values ($1,$2,$3,'Warm','USER',$4) returning id`, [pA.id, UA, src.id, JSON.stringify({ schema: 1, objects: [], surfaces: {}, palette: ['#f2eee6'] })]));
  const create = (who, versionId, type = 'WALKTHROUGH', label = null, expires = null) =>
    as(who, (tx) => one(tx, 'select public.ds_create_share($1,$2,$3,$4) as r', [versionId, type, label, expires])).then((x) => x.r);
  const view = (token) => as('anon', (tx) => one(tx, 'select public.ds_public_share($1) as r', [token])).then((x) => x.r);

  const first = await create(A, ver.id, 'WALKTHROUGH', 'For my parents');
  /^[A-Za-z0-9_-]{43}$/.test(first.token) ? ok('share: a 256-bit URL-safe token (43 chars)') : bad('share token', first.token);
  const row = await db.query('select * from ds_shares where id=$1', [first.id]);
  const stored = row.rows[0];
  stored.token_hash === createHash('sha256').update(first.token).digest('hex') && stored.token_hint === first.token.slice(-4)
    && !JSON.stringify(stored).includes(first.token)
    ? ok('share: only the token hash (and a 4-character hint) is stored') : bad('share storage', JSON.stringify(stored));

  const many = [];
  for (let i = 0; i < 50; i += 1) many.push(await create(A, ver.id));
  const tokens = new Set([first.token, ...many.map((m) => m.token)]);
  const snaps = await db.query('select count(*)::int n from ds_published_designs where version_id=$1', [ver.id]);
  tokens.size === 51 ? ok('share: 51 links for one version, all different') : bad('unique', String(tokens.size));
  snaps.rows[0].n === 1 ? ok('share: 51 links reference ONE frozen snapshot (nothing duplicated)') : bad('dedupe', String(snaps.rows[0].n));

  const pub = await view(first.token);
  pub.status === 'ACTIVE' && pub.shareType === 'WALKTHROUGH' && pub.state.palette[0] === '#f2eee6' && pub.scene.floors[0].id === 'r1'
    ? ok('public: anyone with the link gets the presentation') : bad('public read', JSON.stringify(pub).slice(0, 200));
  const text = JSON.stringify(pub);
  const leaks = [pA.id, UA, A, ver.id, src.id, f.id, first.id, 'For my parents', 'user_id', 'project_id', 'object_key'].filter((x) => text.includes(x));
  leaks.length === 0 ? ok('public: no ids, owner, project, label or storage key in the payload') : bad('leak', leaks.join(', '));

  await expectError('public: anon cannot read the share table', 'permission denied', () => as('anon', (tx) => tx.query('select * from ds_shares')));
  await expectError('public: anon cannot read snapshots', 'permission denied', () => as('anon', (tx) => tx.query('select * from ds_published_designs')));
  await expectError('public: anon cannot create a link', 'permission denied', () => as('anon', (tx) => tx.query("select public.ds_create_share($1,'WALKTHROUGH')", [ver.id])));
  await expectError('public: anon cannot revoke a link', 'permission denied', () => as('anon', (tx) => tx.query('select public.ds_revoke_share($1)', [first.id])));
  await expectError('public: anon cannot read a version', 'permission denied', () => as('anon', (tx) => tx.query('select * from ds_versions')));
  await expectError('public: anon cannot write a version', 'permission denied', () => as('anon', (tx) => tx.query("update ds_versions set name='x'")));
  await expectError('public: anon cannot start an AI job', 'permission denied', () => as('anon', (tx) => tx.query("insert into ds_jobs (user_id,kind) values ($1,'AI_DESIGN')", [UA])));

  await expectError('owner: another customer cannot share A\'s version', 'DS_VERSION_NOT_OWNED', () => create(B, ver.id));
  await expectError('owner: another customer cannot revoke A\'s link', 'DS_SHARE_NOT_OWNED', () => as(B, (tx) => tx.query('select public.ds_revoke_share($1)', [first.id])));
  const bSees = await as(B, (tx) => tx.query('select id from ds_shares'));
  bSees.rows.length === 0 ? ok('owner: another customer cannot list A\'s links') : bad('enumerate', String(bSees.rows.length));
  const aSees = await as(A, (tx) => tx.query('select id, view_count from ds_shares where project_id=$1', [pA.id]));
  aSees.rows.length === 51 ? ok('owner: the owner lists their links') : bad('owner list', String(aSees.rows.length));
  aSees.rows.find((r) => r.id === first.id)?.view_count === 1 ? ok('owner: views are counted') : bad('views', JSON.stringify(aSees.rows.find((r) => r.id === first.id)));
  await expectError('owner: a link cannot be edited directly', 'permission denied', () => as(A, (tx) => tx.query('update ds_shares set expires_at=null where id=$1', [first.id])));

  // Frozen: later edits never reach an existing link.
  await as(A, (tx) => tx.query('update ds_versions set state=$2 where id=$1', [ver.id, JSON.stringify({ schema: 1, objects: [], surfaces: {}, palette: ['#000000'] })]));
  (await view(first.token)).state.palette[0] === '#f2eee6' ? ok('frozen: editing the version does not change an existing link') : bad('frozen', 'changed');
  const newer = await create(A, ver.id);
  const newerView = await view(newer.token);
  const snaps2 = await db.query('select count(*)::int n from ds_published_designs where version_id=$1', [ver.id]);
  newerView.state.palette[0] === '#000000' && snaps2.rows[0].n === 2
    ? ok('frozen: a new link shares the newer design as a new snapshot') : bad('newer', JSON.stringify(newerView.state));
  const ver2 = await as(A, (tx) => one(tx, `insert into ds_versions (project_id,user_id,source_id,name,origin,state)
    values ($1,$2,$3,'Other','USER','{"schema":1,"palette":["#123456"]}') returning id`, [pA.id, UA, src.id]));
  const other = await create(A, ver2.id, 'DESIGN');
  const otherView = await view(other.token);
  otherView.shareType === 'DESIGN' && otherView.state.palette[0] === '#123456' ? ok('share: links for different versions show their own version') : bad('versions', JSON.stringify(otherView));

  // Revocation is per link.
  await as(A, (tx) => tx.query('select public.ds_revoke_share($1)', [first.id]));
  (await view(first.token)).status === 'REVOKED' ? ok('revoke: the revoked link stops at once') : bad('revoke', 'still active');
  (await view(many[0].token)).status === 'ACTIVE' ? ok('revoke: other links to the same design keep working') : bad('revoke scope', 'other revoked');
  await expectError('revoke: a revoked link cannot be revived', 'DS_SHARE_IMMUTABLE', () => as('service', (tx) => tx.query('update ds_shares set revoked_at=null where id=$1', [first.id])));

  // Expiry.
  await expectError('expiry: a past expiry is refused', 'DS_SHARE_EXPIRY', () => create(A, ver.id, 'WALKTHROUGH', null, '2000-01-01T00:00:00Z'));
  const soon = await create(A, ver.id, 'WALKTHROUGH', null, new Date(Date.now() + 1500).toISOString());
  (await view(soon.token)).status === 'ACTIVE' ? ok('expiry: active until it expires') : bad('expiry active', 'not active');
  await new Promise((r) => setTimeout(r, 1800));
  (await view(soon.token)).status === 'EXPIRED' ? ok('expiry: expired links say so') : bad('expiry', 'still active');

  // Guessing.
  (await view('A'.repeat(43))).status === 'NOT_FOUND' ? ok('guess: a random token finds nothing') : bad('guess', 'found');
  (await view(first.token.slice(0, 42))).status === 'NOT_FOUND' && (await view("x' or 1=1 --")).status === 'NOT_FOUND'
    ? ok('guess: malformed tokens find nothing') : bad('malformed', 'found');

  // Immutability and what may be shared.
  await expectError('snapshot: a frozen design cannot be changed, even by the service', 'DS_SNAPSHOT_IMMUTABLE', () =>
    as('service', (tx) => tx.query("update ds_published_designs set title='x'")));
  await expectError('share: a developer-scene version is not published by customer link', 'DS_SHARE_SOURCE_UNSUPPORTED', () => create(A, v1.id));
  await as('service', (tx) => tx.query(`insert into ds_catalog_assets (code,name,category,room_kinds,width_m,depth_m,height_m,model_key,provenance,is_placeholder,active)
    values ('lic/sofa','Licensed sofa','SOFA','{LIVING}',2,1,0.8,'catalog/lic-sofa.glb','LICENSED',false,true)`));
  const lic = await as(A, (tx) => one(tx, `insert into ds_versions (project_id,user_id,source_id,name,origin,state)
    values ($1,$2,$3,'Licensed','USER','{"schema":1,"objects":[{"assetId":"lic/sofa"}]}') returning id`, [pA.id, UA, src.id]));
  await expectError('share: a design with licensed models is not published by link', 'DS_SHARE_ASSET_NOT_PUBLIC', () => create(A, lic.id));
  await as(A, (tx) => tx.query('update ds_versions set archived_at=now() where id=$1', [ver2.id]));
  await expectError('share: an archived version cannot be shared', 'DS_VERSION_NOT_OWNED', () => create(A, ver2.id));

  const withSofa = await as(A, (tx) => one(tx, `insert into ds_versions (project_id,user_id,source_id,name,origin,state)
    values ($1,$2,$3,'Sofa','USER',$4) returning id`, [pA.id, UA, src.id, JSON.stringify({ schema: 1, objects: [{ instanceId: 'o1', assetId: 'dev/sofa' }], surfaces: {}, palette: [] })]));
  const sofaPub = await view((await create(A, withSofa.id)).token);
  const sa = (sofaPub.assets ?? []).find((a) => a.code === 'dev/sofa');
  sa && Array.isArray(sa.capabilities) && sa.capabilities.includes('MOVABLE') && Array.isArray(sa.interactions)
    ? ok('public: shared pieces carry their capabilities and interactions') : bad('payload capabilities', JSON.stringify(sofaPub.assets));

  // A piece read from the owner's picture keeps its provenance in the design, never in a public link.
  const withProv = await as(A, (tx) => one(tx, `insert into ds_versions (project_id,user_id,source_id,name,origin,state)
    values ($1,$2,$3,'From picture','USER',$4) returning id`, [pA.id, UA, src.id, JSON.stringify({ schema: 1, objects: [
      { instanceId: 'p1', assetId: 'dev/sofa', provenance: { source: 'IMAGE_RECONSTRUCTION', ref: 'sofa', images: ['secret-ref-id-1'], confidence: 0.8 } },
    ], surfaces: {}, palette: [] })]));
  const provPub = await view((await create(A, withProv.id)).token);
  const provText = JSON.stringify(provPub);
  !JSON.stringify(provPub.state).includes('provenance') && !provText.includes('secret-ref-id-1') && provPub.state.objects.length === 1
    ? ok('public: a shared design never carries where its pieces came from') : bad('provenance leak', provText.slice(0, 300));
}

// ── reconstruction from pictures
if (RECON_MIGRATION) {
  await db.exec(fs.readFileSync(RECON_MIGRATION, 'utf8'));
  await db.exec(fs.readFileSync(RECON_MIGRATION, 'utf8'));
  ok('reconstruction: migration applies and re-applies');
  const pR = await as(A, (tx) => one(tx, `insert into ds_projects (user_id,name) values ($1,'Pictures') returning id`, [UA]));
  const pRB = await as(B, (tx) => one(tx, `insert into ds_projects (user_id,name) values ($1,'B pictures') returning id`, [UB]));
  const refKey = (u, p, n) => `users/${u}/design-studio-floorplans/${p}/0000000${n}-0000-4000-8000-000000000001.jpg`;
  const ref1 = await as(A, (tx) => one(tx, `insert into ds_floorplans (project_id,user_id,object_key,mime,bytes,purpose)
    values ($1,$2,$3,'image/jpeg',1000,'REFERENCE') returning id, status, purpose`, [pR.id, UA, refKey(UA, pR.id, 1)]));
  ref1.purpose === 'REFERENCE' && ref1.status === 'UPLOADED' ? ok('reconstruction: the owner uploads a reference picture') : bad('ref insert', JSON.stringify(ref1));
  const refB = await as(B, (tx) => one(tx, `insert into ds_floorplans (project_id,user_id,object_key,mime,bytes,purpose)
    values ($1,$2,$3,'image/jpeg',1000,'REFERENCE') returning id`, [pRB.id, UB, refKey(UB, pRB.id, 2)]));
  const plan = await as(A, (tx) => one(tx, `insert into ds_floorplans (project_id,user_id,object_key,mime,bytes)
    values ($1,$2,$3,'image/png',1000) returning id, purpose`, [pR.id, UA, refKey(UA, pR.id, 3).replace('.jpg', '.png')]));
  plan.purpose === 'PLAN' ? ok('reconstruction: a floor plan is still a PLAN by default') : bad('purpose default', plan.purpose);
  await expectError('reconstruction: a picture cannot be turned into a plan afterwards', 'DS_SERVER_FIELD', () => as(A, (tx) =>
    tx.query(`update ds_floorplans set purpose='PLAN' where id=$1`, [ref1.id])));
  await expectError("reconstruction: another customer's picture cannot be used", 'DS_REFERENCE_NOT_OWNED', () => as(A, (tx) =>
    tx.query(`insert into ds_reconstructions (project_id,user_id,reference_ids) values ($1,$2,$3)`, [pR.id, UA, [ref1.id, refB.id]])));
  await expectError('reconstruction: a floor plan is not a reference picture', 'DS_REFERENCE_NOT_OWNED', () => as(A, (tx) =>
    tx.query(`insert into ds_reconstructions (project_id,user_id,reference_ids) values ($1,$2,$3)`, [pR.id, UA, [plan.id]])));
  await expectError('reconstruction: at most six pictures', 'DS_TOO_MANY_REFERENCES', () => as(A, (tx) =>
    tx.query(`insert into ds_reconstructions (project_id,user_id,reference_ids) values ($1,$2,$3)`, [pR.id, UA, Array(7).fill(ref1.id)])));
  const rec = await as(A, (tx) => one(tx, `insert into ds_reconstructions (project_id,user_id,reference_ids,status,analysis)
    values ($1,$2,$3,'READ','{"rooms":[]}') returning id, status, analysis`, [pR.id, UA, [ref1.id]]));
  rec.status === 'QUEUED' && rec.analysis === null ? ok("reconstruction: a browser cannot claim a reading (status and analysis are the server's)") : bad('recon insert', JSON.stringify(rec));
  await expectError('reconstruction: the analysis is written only by the server', 'DS_SERVER_FIELD', () => as(A, (tx) =>
    tx.query(`update ds_reconstructions set analysis='{"rooms":[1]}' where id=$1`, [rec.id])));
  await expectError('reconstruction: the browser cannot mark a reading as read', 'DS_SERVER_FIELD', () => as(A, (tx) =>
    tx.query(`update ds_reconstructions set status='READ' where id=$1`, [rec.id])));
  const seenB = await as(B, (tx) => tx.query(`select id from ds_reconstructions where id=$1`, [rec.id]));
  seenB.rows.length === 0 ? ok('reconstruction: another customer cannot see it') : bad('recon rls', 'visible');
  await as('service', (tx) => tx.query(`update ds_reconstructions set status='READ', analysis='{"rooms":[]}' where id=$1`, [rec.id]));
  await as(A, (tx) => tx.query(`update ds_reconstructions set corrections='{"rejected":["plant"]}' where id=$1`, [rec.id]));
  ok('reconstruction: the owner records corrections');
  const srcR = await as('service', (tx) => one(tx, `insert into ds_spatial_sources (project_id,user_id,kind,status,geometry_state,editability,floorplan_id,canonical)
    values ($1,$2,'FLOORPLAN_SCENE','READY','ESTIMATED','GENERATED',$3,'{"schema":1}') returning id`, [pR.id, UA, ref1.id]));
  const verR = await as(A, (tx) => one(tx, `insert into ds_versions (project_id,user_id,source_id,name) values ($1,$2,$3,'Rebuilt') returning id`, [pR.id, UA, srcR.id]));
  const srcRB = await as('service', (tx) => one(tx, `insert into ds_spatial_sources (project_id,user_id,kind,status,geometry_state,editability,floorplan_id,canonical)
    values ($1,$2,'FLOORPLAN_SCENE','READY','ESTIMATED','GENERATED',$3,'{"schema":1}') returning id`, [pRB.id, UB, refB.id]));
  const verB = await as(B, (tx) => one(tx, `insert into ds_versions (project_id,user_id,source_id,name) values ($1,$2,$3,'B') returning id`, [pRB.id, UB, srcRB.id]));
  await as(A, (tx) => tx.query(`update ds_reconstructions set status='BUILT', built_source_id=$2, built_version_id=$3 where id=$1`, [rec.id, srcR.id, verR.id]));
  ok('reconstruction: the owner records what was built from it');
  await expectError("reconstruction: it cannot point at someone else's version", 'DS_VERSION_NOT_OWNED', () => as(A, (tx) =>
    tx.query(`update ds_reconstructions set built_version_id=$2 where id=$1`, [rec.id, verB.id])));
  await expectError("reconstruction: it cannot point at someone else's geometry", 'DS_SOURCE_NOT_OWNED', () => as(A, (tx) =>
    tx.query(`update ds_reconstructions set built_source_id=$2 where id=$1`, [rec.id, srcRB.id])));
  await expectError('reconstruction: a customer cannot write a RECONSTRUCT job', 'permission denied', () => as(A, (tx) =>
    tx.query(`insert into ds_jobs (user_id,kind) values ($1,'RECONSTRUCT')`, [UA])));
}

// ── a space built from pictures says so (20261001180000)
if (ORIGIN_MIGRATION) {
  const pO = await as(A, (tx) => one(tx, `insert into ds_projects (user_id,name) values ($1,'Origins') returning id`, [UA]));
  const key = (n, ext) => `users/${UA}/design-studio-floorplans/${pO.id}/0000000${n}-0000-4000-8000-00000000000${n}.${ext}`;
  const plan = await as(A, (tx) => one(tx, `insert into ds_floorplans (project_id,user_id,object_key,mime,bytes) values ($1,$2,$3,'image/png',1000) returning id`, [pO.id, UA, key(1, 'png')]));
  const pic = await as(A, (tx) => one(tx, `insert into ds_floorplans (project_id,user_id,object_key,mime,bytes,purpose) values ($1,$2,$3,'image/jpeg',1000,'REFERENCE') returning id`, [pO.id, UA, key(2, 'jpg')]));
  const pic2 = await as(A, (tx) => one(tx, `insert into ds_floorplans (project_id,user_id,object_key,mime,bytes,purpose) values ($1,$2,$3,'image/jpeg',1000,'REFERENCE') returning id`, [pO.id, UA, key(3, 'jpg')]));
  await as('service', (tx) => tx.query(`update ds_floorplans set status='INTERPRETED', interpretation='{"rooms":[]}' where id = any($1)`, [[plan.id, pic.id, pic2.id]]));
  // Built BEFORE the fix: a picture-built source still labelled a floor plan.
  const legacy = await as(A, (tx) => one(tx, `select ds_create_floorplan_source($1,'{"schema":1}','ESTIMATED',null,'ds-1') as id`, [pic2.id]));
  const legacyPlan = await as(A, (tx) => one(tx, `select ds_create_floorplan_source($1,'{"schema":1}','ESTIMATED',null,'ds-1') as id`, [plan.id]));
  const before = await db.query(`select provenance->>'origin' o from ds_spatial_sources where id=$1`, [legacy.id]);
  before.rows[0].o === 'CUSTOMER_FLOORPLAN' ? ok('origin: before the fix, a picture-built space was labelled a floor plan') : bad('origin before', before.rows[0].o);

  await db.exec(fs.readFileSync(ORIGIN_MIGRATION, 'utf8'));
  await db.exec(fs.readFileSync(ORIGIN_MIGRATION, 'utf8'));
  ok('origin: migration applies and re-applies');
  const originOf = async (id) => (await db.query(`select provenance->>'origin' o, status from ds_spatial_sources where id=$1`, [id])).rows[0];
  (await originOf(legacy.id)).o === 'CUSTOMER_PICTURES' ? ok('origin: an existing picture-built space is corrected in place') : bad('origin backfill', JSON.stringify(await originOf(legacy.id)));
  (await originOf(legacyPlan.id)).o === 'CUSTOMER_FLOORPLAN' ? ok('origin: a real floor plan\'s space is left alone') : bad('origin plan untouched', JSON.stringify(await originOf(legacyPlan.id)));
  (await originOf(legacy.id)).status === 'READY' ? ok('origin: the backfill changed nothing but the label (still READY)') : bad('origin status', JSON.stringify(await originOf(legacy.id)));

  const fromPic = await as(A, (tx) => one(tx, `select ds_create_floorplan_source($1,'{"schema":1}','ESTIMATED',null,'ds-2') as id`, [pic.id]));
  const fromPlan = await as(A, (tx) => one(tx, `select ds_create_floorplan_source($1,'{"schema":1}','ESTIMATED',null,'ds-2') as id`, [plan.id]));
  (await originOf(fromPic.id)).o === 'CUSTOMER_PICTURES' ? ok('origin: a space built from pictures now says so') : bad('origin new pic', JSON.stringify(await originOf(fromPic.id)));
  (await originOf(fromPlan.id)).o === 'CUSTOMER_FLOORPLAN' ? ok('origin: a space built from a floor plan still says floor plan') : bad('origin new plan', JSON.stringify(await originOf(fromPlan.id)));
  (await originOf(legacyPlan.id)).status === 'SUPERSEDED' ? ok('origin: rebuilding still supersedes, never overwrites') : bad('origin supersede', JSON.stringify(await originOf(legacyPlan.id)));
  await expectError('origin: another customer still cannot build from A\'s pictures', 'DS_FLOORPLAN_NOT_OWNED', () => as(B, (tx) =>
    tx.query(`select ds_create_floorplan_source($1,'{"schema":1}','ESTIMATED',null,'x')`, [pic.id])));
  await expectError('origin: CALIBRATED still needs a measurement', 'DS_CALIBRATION_REQUIRED', () => as(A, (tx) =>
    tx.query(`select ds_create_floorplan_source($1,'{"schema":1}','CALIBRATED',null,'x')`, [pic.id])));

  // ── a shared design says where it came from (20261001200000)
  if (SHARE_ORIGIN_MIGRATION) {
    await db.exec(fs.readFileSync(SHARE_ORIGIN_MIGRATION, 'utf8'));
    await db.exec(fs.readFileSync(SHARE_ORIGIN_MIGRATION, 'utf8'));
    ok('share origin: migration applies and re-applies');
    const scene = JSON.stringify({ schema: 1, geometryState: 'ESTIMATED', scene: { floors: [{ id: 'r1', kind: 'LIVING', areaM2: 20 }], walls: [] } });
    await as('service', (tx) => tx.query(`update ds_spatial_sources set canonical=$1 where id = any($2)`, [scene, [fromPic.id, fromPlan.id]]));
    const shareOf = async (sourceId) => {
      const v = await as(A, (tx) => one(tx, `insert into ds_versions (project_id,user_id,source_id,name,origin,state) values ($1,$2,$3,'S','USER','{"schema":1,"objects":[],"surfaces":{}}') returning id`, [pO.id, UA, sourceId]));
      const c = await as(A, (tx) => one(tx, `select public.ds_create_share($1,'WALKTHROUGH',null,null) as r`, [v.id]));
      return (await as('anon', (tx) => one(tx, 'select public.ds_public_share($1) as r', [c.r.token]))).r;
    };
    const fromPictures = await shareOf(fromPic.id);
    const fromAPlan = await shareOf(fromPlan.id);
    fromPictures.status === 'ACTIVE' && fromPictures.origin === 'PICTURES'
      ? ok('share origin: a design from pictures tells the visitor so') : bad('share origin pictures', JSON.stringify(fromPictures).slice(0, 200));
    fromAPlan.origin === 'FLOORPLAN' ? ok('share origin: a design from a floor plan still says floor plan') : bad('share origin plan', String(fromAPlan.origin));
    const leaked = ['provenance', 'CUSTOMER_PICTURES', 'object_key', 'floorplan_id', UA].filter((w) => JSON.stringify(fromPictures).includes(w));
    !leaked.length ? ok('share origin: nothing but the coarse origin is exposed') : bad('share origin leak', leaked.join(','));
  }
}

// ── permanent deletion (server-authorised, storage first, tombstoned)
if (DELETE_MIGRATION) {
  // Only the columns ds_project_delete_finish reads; production's table is richer.
  await db.exec(`create table if not exists public.storage_objects (id uuid primary key default gen_random_uuid(),
    object_key text not null, entity_type text, entity_id uuid, lifecycle text not null default 'ACTIVE', deleted_at timestamptz);
    grant all on public.storage_objects to service_role;`);
  await db.exec(fs.readFileSync(DELETE_MIGRATION, 'utf8'));
  await db.exec(fs.readFileSync(DELETE_MIGRATION, 'utf8'));
  ok('deletion: migration applies and re-applies');

  const pD = await as(A, (tx) => one(tx, `insert into ds_projects (user_id,name) values ($1,'Doomed') returning id`, [UA]));
  const pKeep = await as(B, (tx) => one(tx, `insert into ds_projects (user_id,name) values ($1,'Keep') returning id`, [UB]));
  const srcD = await as('service', (tx) => one(tx, `insert into ds_spatial_sources (project_id,user_id,kind,status,geometry_state,editability,canonical)
    values ($1,$2,'FLOORPLAN_SCENE','READY','ESTIMATED','GENERATED','{"schema":1}') returning id`, [pD.id, UA]));
  const verD = await as(A, (tx) => one(tx, `insert into ds_versions (project_id,user_id,source_id,name) values ($1,$2,$3,'V') returning id`, [pD.id, UA, srcD.id]));
  const jobD = await as('service', (tx) => one(tx, `insert into ds_jobs (user_id,project_id,kind,status) values ($1,$2,'AI_DESIGN','SUCCEEDED') returning id`, [UA, pD.id]));
  const pub = await as('service', (tx) => one(tx, `insert into ds_published_designs (project_id,user_id,version_id,source_id,state,state_hash,title)
    values ($1,$2,$3,$4,'{}',repeat('a',64),'Doomed') returning id`, [pD.id, UA, verD.id, srcD.id]));
  const token = 'doomedShareToken_'.padEnd(43, 'x'); // the shape ds_public_share accepts
  await as('service', (tx) => tx.query(`insert into ds_shares (token_hash,token_hint,published_id,project_id,user_id,share_type)
    values (encode(extensions.digest($1,'sha256'),'hex'),'0001',$2,$3,$4,'WALKTHROUGH')`, [token, pub.id, pD.id, UA]));
  const key = (n) => `users/${UA}/design-studio-floorplans/${pD.id}/0000000${n}-0000-4000-8000-000000000001.jpg`;
  await as('service', (tx) => tx.query(`insert into storage_objects (object_key,entity_type,entity_id,lifecycle) values
    ($1,'ds_project',$2,'ACTIVE'), ($3,null,null,'PENDING')`, [key(1), pD.id, key(2)]));

  await expectError("deletion: another customer cannot begin deleting A's project", 'DS_NOT_FOUND', () => as(B, (tx) =>
    tx.query(`select ds_project_delete_begin($1)`, [pD.id])));
  await expectError("deletion: an admin cannot delete a customer's project either", 'DS_NOT_FOUND', () => as(ADM, (tx) =>
    tx.query(`select ds_project_delete_begin($1)`, [pD.id])));
  await expectError('deletion: the owner cannot delete the row from the browser (storage would be orphaned)', 'permission denied', () => as(A, (tx) =>
    tx.query(`delete from ds_projects where id=$1`, [pD.id])));
  await expectError('deletion: the browser cannot mark a project deleting itself', 'DS_SERVER_FIELD', () => as(A, (tx) =>
    tx.query(`update ds_projects set deleting_at=now() where id=$1`, [pD.id])));
  !['REVOKED', 'NOT_FOUND'].includes((await as('anon', (tx) => one(tx, `select ds_public_share($1) as r`, [token]))).r.status)
    ? ok('deletion: before deleting, the share link is live') : bad('share live', 'revoked early');

  const begun = await as(A, (tx) => one(tx, `select ds_project_delete_begin($1) as r`, [pD.id]));
  begun.r.sharesRevoked === 1 ? ok('deletion: beginning revokes every share at once') : bad('begin', JSON.stringify(begun.r));
  (await as('anon', (tx) => one(tx, `select ds_public_share($1) as r`, [token]))).r.status === 'REVOKED'
    ? ok('deletion: the old share link exposes nothing (REVOKED)') : bad('share after begin', 'still live');
  await expectError('deletion: a project being deleted cannot be renamed or edited', 'DS_PROJECT_DELETING', () => as(A, (tx) =>
    tx.query(`update ds_projects set name='Saved?' where id=$1`, [pD.id])));
  await expectError('deletion: nothing new can be added to a project being deleted (a version)', 'DS_PROJECT_DELETING', () => as(A, (tx) =>
    tx.query(`insert into ds_versions (project_id,user_id,source_id,name) values ($1,$2,$3,'Late')`, [pD.id, UA, srcD.id])));
  await expectError('deletion: ...nor a saved view', 'DS_PROJECT_DELETING', () => as(A, (tx) =>
    tx.query(`insert into ds_saved_views (project_id,user_id,name,camera) values ($1,$2,'Late','{}')`, [pD.id, UA])));
  await expectError('deletion: ...nor an existing version edited', 'DS_PROJECT_DELETING', () => as(A, (tx) =>
    tx.query(`update ds_versions set name='Late' where id=$1`, [verD.id])));
  await as(A, (tx) => tx.query(`select ds_project_delete_begin($1)`, [pD.id]));
  ok('deletion: beginning again (a retry) resumes rather than failing');
  const pSwitch = await as(A, (tx) => one(tx, `insert into ds_projects (user_id,name) values ($1,'Switch') returning id`, [UA]));
  const guc = await as(A, async (tx) => { await tx.query(`select ds_project_delete_begin($1)`, [pSwitch.id]);
    return one(tx, `select coalesce(current_setting('homatch.ds_project_deleting', true), '') as v`); });
  guc.v === '' ? ok('deletion: the internal switch is cleared before the call returns') : bad('guc', guc.v);
  await expectError('deletion: the browser cannot finish a deletion (service only)', 'permission denied', () => as(A, (tx) =>
    tx.query(`select ds_project_delete_finish($1)`, [pD.id])));
  await expectError('deletion: finishing is refused while an upload is still ACTIVE', 'DS_STORAGE_NOT_EMPTY', () => as('service', (tx) =>
    tx.query(`select ds_project_delete_finish($1)`, [pD.id])));
  await as('service', (tx) => tx.query(`update storage_objects set lifecycle='DELETED', deleted_at=now() where object_key=$1`, [key(1)]));
  await expectError('deletion: ...and while a row-less PENDING upload under its prefix remains', 'DS_STORAGE_NOT_EMPTY', () => as('service', (tx) =>
    tx.query(`select ds_project_delete_finish($1)`, [pD.id])));
  await as('service', (tx) => tx.query(`update storage_objects set lifecycle='DELETED', deleted_at=now() where object_key=$1`, [key(2)]));
  const running = await as('service', (tx) => one(tx, `insert into ds_jobs (user_id,project_id,kind,status,started_at) values ($1,$2,'RECONSTRUCT','RUNNING',now()) returning id`, [UA, pD.id]));
  await expectError('deletion: finishing waits for a job still at work', 'DS_JOBS_ACTIVE', () => as('service', (tx) =>
    tx.query(`select ds_project_delete_finish($1)`, [pD.id])));
  await as('service', (tx) => tx.query(`update ds_jobs set started_at = now() - interval '20 minutes' where id=$1`, [running.id]));
  ok('deletion: (a job silent for 20 minutes is treated as dead)');

  const done = await as('service', (tx) => one(tx, `select ds_project_delete_finish($1) as r`, [pD.id]));
  done.r.state === 'DELETED' && done.r.counts.versions === 1 && done.r.counts.shares === 1 && done.r.counts.jobs === 2
    ? ok('deletion: finishing deletes the project once storage is empty') : bad('finish', JSON.stringify(done.r));
  const gone = await db.query(`select (select count(*) from ds_projects where id=$1)::int p, (select count(*) from ds_versions where project_id=$1)::int v,
    (select count(*) from ds_spatial_sources where project_id=$1)::int s, (select count(*) from ds_shares where project_id=$1)::int sh,
    (select count(*) from ds_published_designs where project_id=$1)::int pub, (select count(*) from ds_jobs where project_id=$1)::int j,
    (select count(*) from storage_objects where object_key like $2)::int kept`, [pD.id, `users/${UA}/design-studio-%/${pD.id}/%`]);
  const g = gone.rows[0];
  g.p + g.v + g.s + g.sh + g.pub + g.j === 0 ? ok('deletion: versions, sources, shares, snapshots and jobs are all gone') : bad('cascade', JSON.stringify(g));
  g.kept === 2 ? ok('deletion: the storage rows stay, DELETED, as the audit of what was removed') : bad('storage audit', JSON.stringify(g));
  const tomb = await as('service', (tx) => one(tx, `select user_id, job_ids, counts from ds_project_tombstones where project_id=$1`, [pD.id]));
  tomb && tomb.user_id === UA && tomb.job_ids.includes(jobD.id) && tomb.job_ids.includes(running.id) && !JSON.stringify(tomb).includes('Doomed')
    ? ok('deletion: a tombstone keeps ids and counts only, so kept usage rows still resolve') : bad('tombstone', JSON.stringify(tomb));
  (await as(A, (tx) => tx.query(`select * from ds_project_tombstones`))).rows.length === 0
    ? ok('deletion: a customer cannot read tombstones') : bad('tombstone rls', 'visible');
  (await as('anon', (tx) => one(tx, `select ds_public_share($1) as r`, [token]))).r.status === 'NOT_FOUND'
    ? ok('deletion: afterwards the share link is simply not found') : bad('share after finish', 'still resolves');
  (await as('service', (tx) => one(tx, `select ds_project_delete_finish($1) as r`, [pD.id]))).r.state === 'ALREADY_DELETED'
    ? ok('deletion: finishing twice is harmless') : bad('finish twice', 'failed');
  (await db.query(`select count(*)::int n from ds_projects where id=$1`, [pKeep.id])).rows[0].n === 1
    ? ok("deletion: another customer's project is untouched") : bad('collateral', 'B project gone');
} else {
  // ── cascade (before permanent deletion existed, the owner deleted the row directly)
  await as(A, (tx) => tx.query(`delete from ds_projects where id=$1`, [pA.id]));
  const left = await db.query(`select (select count(*) from ds_versions where project_id=$1)::int v,
    (select count(*) from ds_spatial_sources where project_id=$1)::int s`, [pA.id]);
  left.rows[0].v === 0 && left.rows[0].s === 0 ? ok('deleting a project removes its versions and sources') : bad('cascade', JSON.stringify(left.rows[0]));
}

// ── Design Studio catalogue import (DS_CATALOG_MIGRATION) ───────────────
const CATALOG_MIGRATION = process.env.DS_CATALOG_MIGRATION ?? null;
if (CATALOG_MIGRATION) {
  await db.exec(fs.readFileSync(CATALOG_MIGRATION, 'utf8'));
  await db.exec(fs.readFileSync(CATALOG_MIGRATION, 'utf8'));
  ok('catalogue: migration applies and re-applies');
  const H = (n) => `hma_${String(n).padStart(26, '0')}`;
  const V = `hmv_${'1'.repeat(26)}`;
  const key = (d, h = H(1), area = 'materials', f = 'textures/a_diff_1k.jpg') => `design-studio/catalog/${d}/${area}/${h}/${V}/${f}`;
  const verdict = (who, k, action) => as(who, (tx) => one(tx, 'select public.storage_authorize($1,$2) as v', [k, action])).then((r) => r.v);
  const expectVerdict = async (name, who, k, action, want) => { const v = await verdict(who, k, action); if (v === want) ok(name); else bad(name, `got ${v}, want ${want}`); };
  await expectVerdict('catalogue: anyone reads a PUBLIC object', 'anon', key('public'), 'READ', 'ALLOW');
  await expectVerdict('catalogue: a stranger may not read a LICENSED object', 'anon', key('licensed'), 'READ', 'UNAUTHENTICATED');
  await expectVerdict('catalogue: a signed-in user reads a LICENSED object', A, key('licensed'), 'READ', 'ALLOW');
  await expectVerdict('catalogue: a customer may not read a RESTRICTED source', A, key('restricted', H(1), 'models', 'x.blend'), 'READ', 'NOT_ADMIN');
  await expectVerdict('catalogue: staff read a RESTRICTED source', ADM, key('restricted', H(1), 'models', 'x.blend'), 'READ', 'ALLOW');
  await expectVerdict('catalogue: nobody writes by signing, not even staff', ADM, key('public'), 'WRITE', 'NOT_ADMIN');
  await expectVerdict('catalogue: nobody deletes by signing', ADM, key('public'), 'DELETE', 'NOT_ADMIN');
  await expectVerdict('catalogue: an unknown delivery class is refused', 'anon', key('open'), 'READ', 'INVALID_KEY');
  await expectVerdict('catalogue: a malformed asset id is refused', 'anon', `design-studio/catalog/public/materials/hma_x/${V}/a.jpg`, 'READ', 'INVALID_KEY');
  await expectVerdict('catalogue: other namespaces are unchanged (diagnostics stays staff-only)', A, 'diagnostics/x.txt', 'READ', 'NOT_ADMIN');

  const imp = (n, extra = {}) => ({ homatch_asset_id: H(n), source_provider: 'polyhaven', source_asset_id: `asset_${n}`, source_type: 'textures', kind: 'MATERIAL',
    canonical_category: 'MATERIAL.WOOD', canonical_subcategory: 'FLOOR_BOARDS', display_name: `Wood ${n}`, source_asset: {}, policy: 'p', license_class: 'CC0', ...extra });
  const insertImport = (r) => as('service', (tx) => tx.query(`insert into ds_catalog_imports (homatch_asset_id, source_provider, source_asset_id, source_type, kind, canonical_category, canonical_subcategory, display_name, source_asset, policy, license_class, state)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [r.homatch_asset_id, r.source_provider, r.source_asset_id, r.source_type, r.kind, r.canonical_category, r.canonical_subcategory, r.display_name, r.source_asset, r.policy, r.license_class, r.state ?? 'QUEUED']));
  await insertImport(imp(1));
  await insertImport(imp(2, { license_class: 'ROYALTY_FREE', source_provider: 'blendkit', source_type: 'models', kind: 'MODEL' }));
  await insertImport(imp(3, { license_class: 'UNKNOWN', state: 'DISCOVERED' }));
  ok('catalogue: the importer records assets');
  await expectError('catalogue: one provider asset is one row (no duplicates)', 'duplicate key', () => insertImport(imp(9, { source_asset_id: 'asset_1' })));
  await expectError('catalogue: an UNKNOWN licence can never be READY', 'ds_catalog_imports_ready_licensed', () => as('service', (tx) => tx.query(`update ds_catalog_imports set state='READY' where homatch_asset_id=$1`, [H(3)])));
  await expectError('catalogue: a REJECT can never be READY', 'ds_catalog_imports_ready_licensed', () => as('service', (tx) => tx.query(`update ds_catalog_imports set state='READY', quality_tier='REJECT' where homatch_asset_id=$1`, [H(1)])));

  const insertFile = (h, d, k = key(d, h)) => as('service', (tx) => tx.query(`insert into ds_catalog_files (object_key, homatch_asset_id, version_id, variant, role, resolution, rel_path, delivery, bytes, md5, sha256, content_type)
    values ($1,$2,$3,'SOURCE','BASE_COLOR','1k','textures/a_diff_1k.jpg',$4,10,$5,$6,'image/jpeg')`, [k, h, V, d, 'a'.repeat(32), 'b'.repeat(64)]));
  await insertFile(H(1), 'public');
  ok('catalogue: a CC0 object is filed public');
  await expectError('catalogue: a non-CC0 asset is never filed public', 'DS_CATALOG_NOT_PUBLIC', () => insertFile(H(2), 'public'));
  await insertFile(H(2), 'licensed');
  ok('catalogue: a Royalty-Free runtime derivative can be filed licensed');
  await expectError('catalogue: the delivery column and the key can never disagree', 'ds_catalog_files_delivery_key', () => insertFile(H(1), 'licensed', key('public', H(1), 'materials', 'x.jpg')));

  // Claims: leased, bounded, resumable.
  const claimed = await as('service', (tx) => tx.query(`select homatch_asset_id, state, attempts, lease_owner from ds_catalog_claim('run-1', 10, 60)`));
  if (claimed.rows.length === 2 && claimed.rows.every((r) => r.state === 'DOWNLOADING' && r.attempts === 1 && r.lease_owner === 'run-1')) ok('catalogue: QUEUED assets are claimed with a lease and an attempt');
  else bad('claim', JSON.stringify(claimed.rows));
  const again = await as('service', (tx) => tx.query(`select homatch_asset_id from ds_catalog_claim('run-2', 10, 60)`));
  if (again.rows.length === 0) ok('catalogue: a leased asset is not claimed twice'); else bad('double claim', JSON.stringify(again.rows));
  await as('service', (tx) => tx.query(`update ds_catalog_imports set lease_until = now() - interval '1 minute' where homatch_asset_id=$1`, [H(1)]));
  const resumed = await as('service', (tx) => tx.query(`select homatch_asset_id, attempts from ds_catalog_claim('run-3', 10, 60)`));
  if (resumed.rows.length === 1 && resumed.rows[0].homatch_asset_id === H(1) && resumed.rows[0].attempts === 2) ok('catalogue: an interrupted asset is resumed when its lease expires');
  else bad('resume', JSON.stringify(resumed.rows));
  await as('service', (tx) => tx.query(`update ds_catalog_imports set lease_until = now() - interval '1 minute', attempts = max_attempts where homatch_asset_id=$1`, [H(1)]));
  await as('service', (tx) => tx.query(`select * from ds_catalog_claim('run-4', 10, 60)`));
  const failed = await as('service', (tx) => one(tx, `select state from ds_catalog_imports where homatch_asset_id=$1`, [H(1)]));
  if (failed.state === 'FAILED') ok('catalogue: retries are bounded (out of attempts → FAILED)'); else bad('bounded', failed.state);

  // The machinery is staff-only; the resolver hands out ids, never paths.
  const seen = await as(A, (tx) => tx.query(`select 1 from ds_catalog_imports`));
  if (seen.rows.length === 0) ok('catalogue: customers cannot read the import machinery'); else bad('imports rls', `${seen.rows.length} rows`);
  await expectError('catalogue: customers cannot write catalogue files', 'permission denied', () => as(A, (tx) => tx.query(`insert into ds_catalog_files (object_key, homatch_asset_id, version_id, variant, role, rel_path, delivery, bytes, md5, sha256, content_type) values ($1,$2,$3,'SOURCE','BASE_COLOR','y.jpg','public',1,$4,$5,'image/jpeg')`, [key('public', H(1), 'materials', 'y.jpg'), H(1), V, 'a'.repeat(32), 'b'.repeat(64)])));
  await as('service', (tx) => tx.query(`insert into ds_catalog_materials (id, code, name, category, pbr, provenance, homatch_asset_id, source_provider, source_asset_id, source_files_hash, canonical_category, canonical_subcategory, version_id, normalized_name, search_aliases, quality_state, license_class)
    values ('30000000-0000-0000-0000-000000000001',$1,'Light Oak Wood Planks','WOOD','{}'::jsonb,'LICENSED',$1,'polyhaven','asset_1','fh','MATERIAL.WOOD','FLOOR_BOARDS',$2,'light-oak-wood-planks',ARRAY['oak','light','floor','wood'],'READY','CC0')`, [H(1), V]));
  const res = await as(A, (tx) => tx.query(`select * from ds_catalog_resolve('MATERIAL', ARRAY['wood','oak','light','floor'], 5)`));
  if (res.rows.length === 1 && res.rows[0].homatch_asset_id === H(1) && res.rows[0].score > 0 && !Object.keys(res.rows[0]).some((k) => /key|path|url/.test(k))) ok('catalogue: the resolver returns canonical ids by meaning, never a path');
  else bad('resolve', JSON.stringify(res.rows));
  await expectError('catalogue: an imported row carries its whole identity or none', 'ds_catalog_materials_identity_check', () =>
    as('service', (tx) => tx.query(`insert into ds_catalog_materials (code, name, category, pbr, provenance, homatch_asset_id) values ('x-partial','X','WOOD','{}'::jsonb,'LICENSED',$1)`, [H(7)])));
}

// ── Design Studio catalogue management (DS_CATALOG_MGMT_MIGRATION) ────────
const MGMT_MIGRATION = process.env.DS_CATALOG_MGMT_MIGRATION ?? null;
if (CATALOG_MIGRATION && MGMT_MIGRATION) {
  await db.exec(fs.readFileSync(MGMT_MIGRATION, 'utf8'));
  await db.exec(fs.readFileSync(MGMT_MIGRATION, 'utf8'));
  ok('management: migration applies and re-applies');
  const H = (n) => `hma_${String(n).padStart(26, '0')}`;
  const MAT = '30000000-0000-0000-0000-000000000001';
  await as('service', (tx) => tx.query(`update ds_catalog_imports set state='READY', quality_tier=NULL, attempts=0 where homatch_asset_id=$1`, [H(1)]));
  const b = await as('service', (tx) => one(tx, `select import_batch_id, lifecycle from ds_catalog_imports where homatch_asset_id=$1`, [H(1)]));
  if (b.import_batch_id === 'ib_20261001_canary' && b.lifecycle === 'UNPUBLISHED') ok('management: existing imports are backfilled into the canary batch, unpublished');
  else bad('backfill', JSON.stringify(b));
  await expectError('management: a batch id never changes once set', 'DS_CATALOG_BATCH_IMMUTABLE', () =>
    as('service', (tx) => tx.query(`update ds_catalog_imports set import_batch_id='ib_other_batch' where homatch_asset_id=$1`, [H(1)])));
  const set = (who, ids, target, n) => as(who, (tx) => one(tx, `select public.ds_catalog_admin_set_lifecycle($1, $2, $3, 'test') as r`, [ids, target, n])).then((x) => x.r);
  await expectError('management: a customer cannot change the catalogue', 'DS_CATALOG_ADMIN_ONLY', () => set(A, [H(1)], 'ACTIVE', 1));
  await expectError('management: the confirmed count must match the selection', 'DS_CATALOG_CONFIRM_MISMATCH', () => set(ADM, [H(1)], 'ACTIVE', 2));
  const on = await set(ADM, [H(1)], 'ACTIVE', 1);
  const activeRow = await as('service', (tx) => one(tx, `select m.active, i.lifecycle from ds_catalog_materials m join ds_catalog_imports i using (homatch_asset_id) where m.homatch_asset_id=$1`, [H(1)]));
  if (on.changed === 1 && activeRow.active === true && activeRow.lifecycle === 'ACTIVE') ok('management: re-enable publishes a READY asset'); else bad('activate', JSON.stringify({ on, activeRow }));
  const res1 = await as(A, (tx) => tx.query(`select * from ds_catalog_resolve('MATERIAL', ARRAY['oak'], 5)`));
  if (res1.rows.length === 1) ok('management: the resolver offers an ACTIVE asset'); else bad('resolve active', JSON.stringify(res1.rows));
  // A saved design uses the material: removal from the catalogue is allowed, physical deletion is not.
  await as('service', (tx) => tx.query(`update ds_versions set state = jsonb_set(coalesce(state, '{}'::jsonb), '{surfaces}', jsonb_build_object('floor:r-1', jsonb_build_object('materialId', $2::text))) where id=$1`, [v1.id, MAT]));
  const dep = await as(ADM, (tx) => one(tx, `select * from ds_catalog_dependencies($1)`, [[H(1)]]));
  if (dep.versions === 1 && dep.projects === 1) ok('management: dependencies count the saved design that uses the material'); else bad('deps', JSON.stringify(dep));
  await expectError('management: customers cannot read dependencies', 'DS_CATALOG_ADMIN_ONLY', () => as(A, (tx) => tx.query(`select * from ds_catalog_dependencies($1)`, [[H(1)]])));
  const off = await set(ADM, [H(1)], 'DISABLED', 1);
  const offRow = await as('service', (tx) => one(tx, `select m.active, i.lifecycle from ds_catalog_materials m join ds_catalog_imports i using (homatch_asset_id) where m.homatch_asset_id=$1`, [H(1)]));
  if (off.changed === 1 && offRow.active === false && offRow.lifecycle === 'DISABLED') ok('management: disable takes an asset out of the catalogue'); else bad('disable', JSON.stringify({ off, offRow }));
  const res2 = await as(A, (tx) => tx.query(`select * from ds_catalog_resolve('MATERIAL', ARRAY['oak'], 5)`));
  if (res2.rows.length === 0) ok('management: the resolver no longer offers a DISABLED asset'); else bad('resolve disabled', JSON.stringify(res2.rows));
  const del = await set(ADM, [H(1)], 'PENDING_DELETE', 1);
  const delRow = await as('service', (tx) => one(tx, `select lifecycle from ds_catalog_imports where homatch_asset_id=$1`, [H(1)]));
  if (del.changed === 0 && del.blocked.length === 1 && del.blocked[0].versions === 1 && delRow.lifecycle === 'DISABLED') ok('management: deletion is refused for an asset a saved design uses, with the count');
  else bad('blocked delete', JSON.stringify({ del, delRow }));
  await as('service', (tx) => tx.query(`update ds_versions set state = state - 'surfaces' where id=$1`, [v1.id]));
  const del2 = await set(ADM, [H(1)], 'PENDING_DELETE', 1);
  if (del2.changed === 1) ok('management: an unreferenced asset can be queued for deletion'); else bad('delete', JSON.stringify(del2));
  const reactivate = await set(ADM, [H(1)], 'ACTIVE', 1);
  if (reactivate.changed === 0 && reactivate.skipped.includes(H(1))) ok('management: a deletion candidate cannot be re-published'); else bad('republish pending', JSON.stringify(reactivate));
  const back = await set(ADM, [H(1)], 'CANCEL_DELETE', 1);
  if (back.changed === 1) ok('management: a queued deletion can be cancelled'); else bad('cancel', JSON.stringify(back));
  const audit = await as(ADM, (tx) => tx.query(`select action, asset_count, actor_kind, import_batch_ids from ds_catalog_admin_events order by id`));
  const actions = audit.rows.map((r) => r.action).join(',');
  if (actions === 'ACTIVATE,DISABLE,REQUEST_DELETE,DELETE_BLOCKED,REQUEST_DELETE,ACTIVATE,CANCEL_DELETE' && audit.rows.every((r) => r.actor_kind === 'ADMIN' && r.import_batch_ids.includes('ib_20261001_canary')))
    ok('management: every change is audited with actor and batch');
  else bad('audit', actions);
  const seenAudit = await as(A, (tx) => tx.query(`select 1 from ds_catalog_admin_events`));
  if (seenAudit.rows.length === 0) ok('management: customers cannot read the audit trail'); else bad('audit rls', `${seenAudit.rows.length}`);
  await expectError('management: nobody writes the audit trail directly', 'permission denied', () => as(ADM, (tx) => tx.query(`insert into ds_catalog_admin_events (actor_kind, action, asset_count) values ('ADMIN','DISABLE',0)`)));

  const REPROCESS_MIGRATION = process.env.DS_CATALOG_REPROCESS_MIGRATION ?? null;
  if (REPROCESS_MIGRATION) {
    await db.exec(fs.readFileSync(REPROCESS_MIGRATION, 'utf8'));
    await db.exec(fs.readFileSync(REPROCESS_MIGRATION, 'utf8'));
    ok('reprocess: migration applies and re-applies');
    const rq = (who, ids, n) => as(who, (tx) => one(tx, `select public.ds_catalog_admin_requeue($1, $2, 'test') as r`, [ids, n])).then((x) => x.r);
    await expectError('reprocess: a customer cannot re-queue', 'DS_CATALOG_ADMIN_ONLY', () => rq(A, [H(1)], 1));
    await expectError('reprocess: the confirmed count must match', 'DS_CATALOG_CONFIRM_MISMATCH', () => rq(ADM, [H(1), H(3)], 1));
    const r1 = await rq(ADM, [H(1), H(3)], 2);
    const s1 = await as('service', (tx) => one(tx, `select state, attempts from ds_catalog_imports where homatch_asset_id=$1`, [H(1)]));
    if (r1.queued === 1 && r1.skipped.includes(H(3)) && s1.state === 'QUEUED' && s1.attempts === 0) ok('reprocess: a READY asset is re-queued; an UNKNOWN-licence discovery is not');
    else bad('requeue', JSON.stringify({ r1, s1 }));
    await as('service', (tx) => tx.query(`update ds_catalog_imports set state='READY', lifecycle='PENDING_DELETE' where homatch_asset_id=$1`, [H(1)]));
    const r2 = await rq(ADM, [H(1)], 1);
    if (r2.queued === 0) ok('reprocess: a deletion candidate is never re-queued'); else bad('requeue pending', JSON.stringify(r2));
    const last = await as(ADM, (tx) => one(tx, `select action from ds_catalog_admin_events order by id desc limit 1`));
    if (last.action === 'REPROCESS') ok('reprocess: audited'); else bad('reprocess audit', last.action);
  }
}

// ── the customer's original picture is kept, immutable (20261001210000)
if (ORIGINAL_MIGRATION) {
  await db.exec(fs.readFileSync(ORIGINAL_MIGRATION, 'utf8'));
  await db.exec(fs.readFileSync(ORIGINAL_MIGRATION, 'utf8'));
  ok('original: migration applies and re-applies');
  const pX = await as(A, (tx) => one(tx, `insert into ds_projects (user_id,name) values ($1,'Originals') returning id`, [UA]));
  const k = (f) => `users/${UA}/design-studio-floorplans/${pX.id}/${f}`;
  const sha = 'a'.repeat(64);
  const row = await as(A, (tx) => one(tx, `insert into ds_floorplans (project_id,user_id,object_key,mime,bytes,purpose,original_key,original_mime,original_bytes,original_sha256,original_width,original_height)
    values ($1,$2,$3,'image/jpeg',1000,'REFERENCE',$4,'image/png',30000000,$5,6000,4000) returning id, original_key`, [pX.id, UA, k('a.jpg'), k('orig.png'), sha]));
  row.original_key === k('orig.png') ? ok('original: a 30 MB original is recorded beside its analysis image') : bad('original insert', JSON.stringify(row));
  await expectError('original: an original outside the project prefix is refused', 'DS_OBJECT_KEY_INVALID', () => as(A, (tx) =>
    tx.query(`insert into ds_floorplans (project_id,user_id,object_key,mime,bytes,purpose,original_key,original_mime,original_bytes)
      values ($1,$2,$3,'image/jpeg',1000,'REFERENCE',$4,'image/jpeg',1000)`, [pX.id, UA, k('b.jpg'), `users/${UB}/design-studio-floorplans/${pX.id}/x.jpg`])));
  await expectError('original: the original never changes', 'DS_SERVER_FIELD', () => as(A, (tx) =>
    tx.query(`update ds_floorplans set original_key=$2 where id=$1`, [row.id, k('other.png')])));
  await expectError('original: more than 40 MB is refused', 'ds_floorplans_original_check', () => as(A, (tx) =>
    tx.query(`insert into ds_floorplans (project_id,user_id,object_key,mime,bytes,purpose,original_key,original_mime,original_bytes)
      values ($1,$2,$3,'image/jpeg',1000,'REFERENCE',$4,'image/jpeg',50000000)`, [pX.id, UA, k('c.jpg'), k('c-orig.jpg')])));
  const legacy = await as(A, (tx) => one(tx, `insert into ds_floorplans (project_id,user_id,object_key,mime,bytes,purpose) values ($1,$2,$3,'image/jpeg',1000,'REFERENCE') returning original_key`, [pX.id, UA, k('d.jpg')]));
  legacy.original_key === null ? ok('original: a row without one stays "not recorded" (nothing guessed)') : bad('original legacy', JSON.stringify(legacy));
}

if (FRAME_MIGRATION) {
  await db.exec(fs.readFileSync(FRAME_MIGRATION, 'utf8'));
  await db.exec(fs.readFileSync(FRAME_MIGRATION, 'utf8'));
  ok('frame: migration applies and re-applies');
  const pF = await as(A, (tx) => one(tx, `insert into ds_projects (user_id,name) values ($1,'Frames') returning id`, [UA]));
  const k = (f) => `users/${UA}/design-studio-floorplans/${pF.id}/${f}`;
  const geo = JSON.stringify({ v: 1, width: 1280, height: 998, footprint: [[0, 0], [1, 0], [1, 1]] });
  const row = await as(A, (tx) => one(tx, `insert into ds_floorplans (project_id,user_id,object_key,mime,bytes,purpose,plan_view_key,picture_geometry)
    values ($1,$2,$3,'image/jpeg',1000,'REFERENCE',$4,$5::jsonb) returning id, plan_view_key, picture_geometry`, [pF.id, UA, k('a.jpg'), k('a-plan.jpg'), geo]));
  row.plan_view_key === k('a-plan.jpg') && row.picture_geometry?.v === 1 ? ok('frame: the owner records a measured frame and its plan view') : bad('frame insert', JSON.stringify(row));
  await expectError('frame: a plan view outside the project prefix is refused', 'DS_OBJECT_KEY_INVALID', () => as(A, (tx) =>
    tx.query(`insert into ds_floorplans (project_id,user_id,object_key,mime,bytes,purpose,plan_view_key,picture_geometry)
      values ($1,$2,$3,'image/jpeg',1000,'REFERENCE',$4,$5::jsonb)`, [pF.id, UA, k('b.jpg'), `users/${UB}/design-studio-floorplans/${pF.id}/x.jpg`, geo])));
  await expectError('frame: a plan view without its frame is refused', 'ds_floorplans_picture_geometry_check', () => as(A, (tx) =>
    tx.query(`insert into ds_floorplans (project_id,user_id,object_key,mime,bytes,purpose,plan_view_key) values ($1,$2,$3,'image/jpeg',1000,'REFERENCE',$4)`, [pF.id, UA, k('c.jpg'), k('c-plan.jpg')])));
  await expectError('frame: an unknown frame version is refused', 'ds_floorplans_picture_geometry_check', () => as(A, (tx) =>
    tx.query(`insert into ds_floorplans (project_id,user_id,object_key,mime,bytes,purpose,plan_view_key,picture_geometry) values ($1,$2,$3,'image/jpeg',1000,'REFERENCE',$4,'{"v":2}'::jsonb)`, [pF.id, UA, k('d.jpg'), k('d-plan.jpg')])));
  await expectError('frame: an oversized frame is refused', 'ds_floorplans_picture_geometry_check', () => as(A, (tx) =>
    tx.query(`insert into ds_floorplans (project_id,user_id,object_key,mime,bytes,purpose,plan_view_key,picture_geometry) values ($1,$2,$3,'image/jpeg',1000,'REFERENCE',$4,$5::jsonb)`,
      [pF.id, UA, k('e.jpg'), k('e-plan.jpg'), JSON.stringify({ v: 1, pad: 'x'.repeat(20000) })])));
  await expectError('frame: the measured frame never changes', 'DS_SERVER_FIELD', () => as(A, (tx) =>
    tx.query(`update ds_floorplans set picture_geometry='{"v":1,"other":true}'::jsonb where id=$1`, [row.id])));
  await expectError('frame: the plan view never changes', 'DS_SERVER_FIELD', () => as(A, (tx) =>
    tx.query(`update ds_floorplans set plan_view_key=$2 where id=$1`, [row.id, k('z.jpg')])));
  const plain = await as(A, (tx) => one(tx, `insert into ds_floorplans (project_id,user_id,object_key,mime,bytes,purpose) values ($1,$2,$3,'image/jpeg',1000,'REFERENCE') returning plan_view_key, picture_geometry`, [pF.id, UA, k('f.jpg')]));
  plain.plan_view_key === null && plain.picture_geometry === null ? ok('frame: a picture that was not measured stays plain') : bad('frame plain', JSON.stringify(plain));
  // Someone else's rows stay invisible (RLS unchanged).
  const seen = await as(B, (tx) => tx.query(`select id from ds_floorplans where id=$1`, [row.id]));
  seen.rows.length === 0 ? ok('frame: another user cannot see the frame') : bad('frame rls', 'visible to B');
}

if (FACTORY_MIGRATION) {
  await db.exec(fs.readFileSync(FACTORY_MIGRATION, 'utf8'));
  await db.exec(fs.readFileSync(FACTORY_MIGRATION, 'utf8'));
  ok('factory: migration applies and re-applies');
  const pG = await as(A, (tx) => one(tx, `insert into ds_projects (user_id,name) values ($1,'Factory') returning id`, [UA]));
  const job = await as('service', (tx) => one(tx, `insert into ds_factory_jobs (project_id,user_id,source_kind,pass,idempotency_key,spec_sha256,engine_version,provider,spec)
    values ($1,$2,'PICTURE',1,$3,$3,'ds-factory-1','runpod','{"version":"hm-scene-1"}'::jsonb) returning id`, [pG.id, UA, 'a'.repeat(64)]));
  job.id ? ok('factory: the server records a pass') : bad('factory job', 'no id');
  const key = (folder, id, ext) => `users/${UA}/${folder}/${pG.id}/${id}.${ext}`;
  const ids = ['70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000004'];
  const asset = (id, role, tier, group, k, scope = 'PROJECT_PRIVATE') => as('service', (tx) => tx.query(`insert into ds_factory_assets (id,project_id,user_id,job_id,role,tier,group_key,object_key,provider,scope)
    values ($1,$2,$3,$4,$5,$6,$7,$8,'runpod',$9)`, [id, pG.id, UA, job.id, role, tier, group, k, scope]));
  await asset(ids[0], 'RENDER', 'QA', null, key('design-studio-thumbnails', ids[0], 'jpg'));
  await asset(ids[1], 'PIECE', 'RUNTIME', 'gsofa-1', key('design-studio-models', ids[1], 'glb'));
  ok("factory: a render and a piece are recorded in the project's own folders");
  await expectError("factory: a model outside the project's model folder is refused", 'check', () => asset(ids[2], 'SCENE', 'DESKTOP', null, `users/${UB}/design-studio-models/${pG.id}/${ids[2]}.glb`));
  await expectError('factory: a render stored as a model is refused', 'check', () => asset(ids[2], 'RENDER', 'QA', null, key('design-studio-models', ids[2], 'glb')));
  await expectError('factory: a piece without its group is refused', 'check', () => asset(ids[2], 'PIECE', 'RUNTIME', null, key('design-studio-models', ids[2], 'glb')));
  await expectError('factory: nothing built for a customer is ever shared scope', 'check', () => asset(ids[3], 'SCENE', 'DESKTOP', null, key('design-studio-models', ids[3], 'glb'), 'GLOBAL'));
  const mine = await as(A, (tx) => tx.query('select id from ds_factory_assets where project_id=$1', [pG.id]));
  mine.rows.length === 2 ? ok('factory: the owner reads their outputs') : bad('factory owner read', String(mine.rows.length));
  const theirs = await as(B, (tx) => tx.query('select id from ds_factory_assets union all select id from ds_factory_jobs'));
  theirs.rows.length === 0 ? ok('factory: another customer sees nothing') : bad('factory isolation', String(theirs.rows.length));
  await expectError('factory: anon has no access', 'permission denied', () => as('anon', (tx) => tx.query('select * from ds_factory_assets')));
  await expectError('factory: the owner cannot write the ledger', 'permission denied', () => as(A, (tx) => tx.query(`update ds_factory_jobs set state='COMPLETED' where id=$1`, [job.id])));
  await expectError('factory: the owner cannot insert outputs', 'permission denied', () => as(A, (tx) => tx.query(`insert into ds_factory_assets (id,project_id,user_id,role,tier,object_key,provider) values ($1,$2,$3,'SCENE','DESKTOP',$4,'x')`, [ids[3], pG.id, UA, key('design-studio-models', ids[3], 'glb')])));
  if (VIEWS_MIGRATION) {
    await db.exec(fs.readFileSync(VIEWS_MIGRATION, 'utf8'));
    await db.exec(fs.readFileSync(VIEWS_MIGRATION, 'utf8'));
    ok('factory views: migration applies and re-applies over recorded outputs');
    const v = ['71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000004'];
    await asset(v[0], 'VIEW', 'VIEW', 'v-master', key('design-studio-thumbnails', v[0], 'jpg'));
    await asset(v[1], 'VIEW_IDS', 'VIEW', 'v-master', key('design-studio-thumbnails', v[1], 'png'));
    await asset(v[2], 'VIEW_LEGEND', 'VIEW', 'v-master', key('design-studio-thumbnails', v[2], 'json'));
    ok("factory views: a view's picture, id image and legend are recorded in the project's own folder");
    await expectError('factory views: a view without its view id is refused', 'check', () => asset(v[3], 'VIEW', 'VIEW', null, key('design-studio-thumbnails', v[3], 'jpg')));
    await expectError('factory views: an id image stored as a JPEG is refused', 'check', () => asset(v[3], 'VIEW_IDS', 'VIEW', 'v-master', key('design-studio-thumbnails', v[3], 'jpg')));
    await expectError('factory views: a legend in the model folder is refused', 'check', () => asset(v[3], 'VIEW_LEGEND', 'VIEW', 'v-master', key('design-studio-models', v[3], 'json')));
    await expectError('factory views: a view in the render tier is refused', 'check', () => asset(v[3], 'VIEW', 'QA', 'v-master', key('design-studio-thumbnails', v[3], 'jpg')));
    await expectError('factory views: a render still needs its own tier', 'check', () => asset(v[3], 'RENDER', 'VIEW', null, key('design-studio-thumbnails', v[3], 'jpg')));
    await expectError('factory views: an unknown role is refused', 'check', () => asset(v[3], 'POSTER', 'VIEW', 'v-master', key('design-studio-thumbnails', v[3], 'jpg')));
    const seen = await as(A, (tx) => tx.query(`select id from ds_factory_assets where project_id=$1 and tier='VIEW'`, [pG.id]));
    seen.rows.length === 3 ? ok('factory views: the owner reads their view files') : bad('factory views owner read', String(seen.rows.length));
    const other = await as(B, (tx) => tx.query(`select id from ds_factory_assets where tier='VIEW'`));
    other.rows.length === 0 ? ok('factory views: another customer sees nothing') : bad('factory views isolation', String(other.rows.length));
  }
  if (SHARES_MIGRATION) {
    const scene = { schema: 1, geometryState: 'CALIBRATED', scene: { floors: [{ id: 'r1', kind: 'LIVING', areaM2: 20 }], walls: [] } };
    const fp = await as(A, (tx) => one(tx, `insert into ds_floorplans (project_id,user_id,object_key,mime,bytes,purpose) values ($1,$2,$3,'image/jpeg',1000,'REFERENCE') returning id`, [pG.id, UA, `users/${UA}/design-studio-floorplans/${pG.id}/g.jpg`]));
    const srcG = await as('service', (tx) => one(tx, `insert into ds_spatial_sources (project_id,user_id,kind,status,geometry_state,editability,floorplan_id,canonical)
      values ($1,$2,'FLOORPLAN_SCENE','READY','CALIBRATED','GENERATED',$3,$4) returning id`, [pG.id, UA, fp.id, JSON.stringify(scene)]));
    const privateKey = key('design-studio-models', ids[1], 'glb');
    const state = { schema: 1, objects: [{ instanceId: 'o1', assetId: 'dev/sofa-3', generated: { assetId: ids[1], key: privateKey, sha256: null }, provenance: { source: 'IMAGE_RECONSTRUCTION', ref: 'sofa' } }], surfaces: {}, palette: [] };
    const verG = await as(A, (tx) => one(tx, `insert into ds_versions (project_id,user_id,source_id,name,origin,state) values ($1,$2,$3,'3D','USER',$4) returning id`, [pG.id, UA, srcG.id, JSON.stringify(state)]));
    const link = await as(A, (tx) => one(tx, `select public.ds_create_share($1,'WALKTHROUGH',null,null) as r`, [verG.id])).then((x) => x.r);
    const pubG = await as('anon', (tx) => one(tx, 'select public.ds_public_share($1) as r', [link.token])).then((x) => x.r);
    const text = JSON.stringify(pubG);
    !text.includes(privateKey) && !text.includes(UA) && !text.includes('"generated"') && pubG.state.objects[0].instanceId === 'o1'
      ? ok("factory: a public link never carries a factory model's private key (the drawn piece stands in)") : bad('factory share leak', text.slice(0, 300));
  }

  // ── renders (20261006120000): the owner reads, only the server writes; the DNA rides on the version.
  //   DS_RENDERS_MIGRATION=supabase/migrations/20261006120000_design_studio_renders.sql (needs the factory and shares migrations)
  const RENDERS_MIGRATION = process.env.DS_RENDERS_MIGRATION ?? null;
  if (RENDERS_MIGRATION && SHARES_MIGRATION) {
    // Minimal stubs of the billing registry the product rows land in.
    await db.exec(`
      create table if not exists public.billing_plans (code text primary key, quality_tier text not null default 'STANDARD');
      insert into public.billing_plans values ('FREE','STANDARD') on conflict do nothing;
      create table if not exists public.billable_products (code text primary key, name text, billing_mode text, requires_reservation boolean,
        standard_retail_cents integer not null default 0, reference_landed_cogs_cents numeric not null default 0, min_gross_margin_bps integer,
        estimate_strategy text, enabled boolean, pricing_active boolean, min_viable_budget_credits numeric, sort_order integer, config jsonb);
      create table if not exists public.product_plan_entitlements (product_code text, plan_code text, included_per_period integer, period text,
        quality_tier text, primary key (product_code, plan_code));
    `);
    await db.exec(fs.readFileSync(RENDERS_MIGRATION, 'utf8'));
    await db.exec(fs.readFileSync(RENDERS_MIGRATION, 'utf8'));
    ok('renders: migration applies and re-applies');
    const prods = await db.query(`select code, pricing_active from billable_products where code in ('DS_MASTER_RENDER','DS_ROOM_RENDER','DS_RENDER_EDIT') order by code`);
    prods.rows.length === 3 && prods.rows.every((r) => r.pricing_active === false)
      ? ok('renders: three products registered, pricing inactive') : bad('renders products', JSON.stringify(prods.rows));
    const ents = await db.query(`select count(*)::int n from product_plan_entitlements where product_code in ('DS_MASTER_RENDER','DS_ROOM_RENDER','DS_RENDER_EDIT') and included_per_period = 0`);
    ents.rows[0].n >= 3 ? ok('renders: an entitlement row per plan (nothing included)') : bad('renders entitlements', String(ents.rows[0].n));

    const pR = await as(A, (tx) => one(tx, `insert into ds_projects (user_id,name) values ($1,'Renders') returning id`, [UA]));
    const fpR = await as(A, (tx) => one(tx, `insert into ds_floorplans (project_id,user_id,object_key,mime,bytes,purpose) values ($1,$2,$3,'image/jpeg',1000,'REFERENCE') returning id`, [pR.id, UA, `users/${UA}/design-studio-floorplans/${pR.id}/r.jpg`]));
    const srcR = await as('service', (tx) => one(tx, `insert into ds_spatial_sources (project_id,user_id,kind,status,geometry_state,editability,floorplan_id,canonical)
      values ($1,$2,'FLOORPLAN_SCENE','READY','CALIBRATED','GENERATED',$3,'{"schema":1}'::jsonb) returning id`, [pR.id, UA, fpR.id]));
    const verR = await as(A, (tx) => one(tx, `insert into ds_versions (project_id,user_id,source_id,name,origin,state) values ($1,$2,$3,'Design','USER','{"schema":1}'::jsonb) returning id, revision`, [pR.id, UA, srcR.id]));
    const view = JSON.stringify({ id: 'v-master', kind: 'MASTER' });
    const tk = (n) => n.toString(16).padStart(64, '0');
    const row = await as('service', (tx) => one(tx, `insert into ds_renders (project_id,user_id,version_id,kind,view,idempotency_key,base_key)
      values ($1,$2,$3,'MASTER',$4::jsonb,$5,$6) returning id, status`, [pR.id, UA, verR.id, view, tk(1), `users/${UA}/design-studio-thumbnails/${pR.id}/b.png`]));
    row.status === 'QUEUED' ? ok('renders: the server records a render (QUEUED)') : bad('renders insert', JSON.stringify(row));
    await expectError('renders: the same idempotency key is one render', 'duplicate key', () => as('service', (tx) =>
      tx.query(`insert into ds_renders (project_id,user_id,version_id,kind,view,idempotency_key) values ($1,$2,$3,'MASTER',$4::jsonb,$5)`, [pR.id, UA, verR.id, view, tk(1)])));
    await expectError("renders: a picture outside the customer's project folder is refused", 'check', () => as('service', (tx) =>
      tx.query(`insert into ds_renders (project_id,user_id,version_id,kind,view,idempotency_key,final_key) values ($1,$2,$3,'MASTER',$4::jsonb,$5,$6)`,
        [pR.id, UA, verR.id, view, tk(2), `users/${UB}/design-studio-thumbnails/${pR.id}/x.png`])));
    await expectError('renders: an edit names its parent and its change', 'check', () => as('service', (tx) =>
      tx.query(`insert into ds_renders (project_id,user_id,version_id,kind,view,idempotency_key) values ($1,$2,$3,'EDIT',$4::jsonb,$5)`, [pR.id, UA, verR.id, view, tk(3)])));
    const mineR = await as(A, (tx) => tx.query('select id from ds_renders where project_id=$1', [pR.id]));
    mineR.rows.length === 1 ? ok('renders: the owner reads their render') : bad('renders owner read', String(mineR.rows.length));
    const theirsR = await as(B, (tx) => tx.query('select id from ds_renders'));
    theirsR.rows.length === 0 ? ok('renders: another customer reads nothing') : bad('renders isolation', String(theirsR.rows.length));
    const admR = await as(ADM, (tx) => tx.query('select id from ds_renders where id=$1', [row.id]));
    admR.rows.length === 1 ? ok('renders: an admin may read') : bad('renders admin read', 'no row');
    await expectError('renders: anon has no access', 'permission denied', () => as('anon', (tx) => tx.query('select * from ds_renders')));
    await expectError('renders: the owner cannot insert a render', 'permission denied', () => as(A, (tx) =>
      tx.query(`insert into ds_renders (project_id,user_id,version_id,kind,view,idempotency_key) values ($1,$2,$3,'MASTER',$4::jsonb,$5)`, [pR.id, UA, verR.id, view, tk(4)])));
    await expectError('renders: the owner cannot mark a render READY', 'permission denied', () => as(A, (tx) =>
      tx.query(`update ds_renders set status='READY' where id=$1`, [row.id])));
    await expectError('renders: the owner cannot settle its billing', 'permission denied', () => as(A, (tx) =>
      tx.query(`update ds_renders set billing='{"state":"SETTLED"}'::jsonb where id=$1`, [row.id])));
    await expectError('renders: the owner cannot delete a render', 'permission denied', () => as(A, (tx) => tx.query('delete from ds_renders where id=$1', [row.id])));

    const dna = JSON.stringify({ version: 'ds-dna-1', look: ['warm oak', 'linen'], palette: ['#f0e6d8'] });
    const wrote = await as(A, (tx) => one(tx, 'update ds_versions set design_dna=$2::jsonb where id=$1 returning design_dna, revision', [verR.id, dna]));
    wrote?.design_dna?.version === 'ds-dna-1' && wrote.revision === verR.revision
      ? ok("renders: the owner writes the version's DNA (the revision does not move)") : bad('dna write', JSON.stringify(wrote));
    const bDna = await as(B, (tx) => tx.query('update ds_versions set design_dna=$2::jsonb where id=$1', [verR.id, dna]));
    bDna.affectedRows === 0 ? ok('renders: another customer cannot write the DNA') : bad('dna isolation', 'B wrote');
    await expectError('renders: an unknown DNA version is refused', 'ds_versions_design_dna_check', () => as(A, (tx) =>
      tx.query(`update ds_versions set design_dna='{"version":"x"}'::jsonb where id=$1`, [verR.id])));
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
