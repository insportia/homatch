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
caps.rows[0].capabilities.join() === 'MOVABLE,ROTATABLE,REPLACEABLE' && Array.isArray(caps.rows[0].interactions) && caps.rows[0].interactions.length === 0
  ? ok('catalog: a piece moves, turns and swaps by default, and opens nothing') : bad('capability defaults', JSON.stringify(caps.rows[0]));
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
}

// ── cascade
await as(A, (tx) => tx.query(`delete from ds_projects where id=$1`, [pA.id]));
const left = await db.query(`select (select count(*) from ds_versions where project_id=$1)::int v,
  (select count(*) from ds_spatial_sources where project_id=$1)::int s`, [pA.id]);
left.rows[0].v === 0 && left.rows[0].s === 0 ? ok('deleting a project removes its versions and sources') : bad('cascade', JSON.stringify(left.rows[0]));

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
