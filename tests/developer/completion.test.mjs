// The promises the Developer OS makes about MONEY and about DOCUMENTS,
// asserted against the migrations themselves.
//
// Every one of these is a rule that costs nothing while it holds and is
// expensive the first time it does not: a bulk edit that quietly reprices a
// sold apartment, an extraction that overwrites a contract nobody checked, a
// buyer's page that carries a colleague's note, a commission netted off
// revenue so a sales report reads high. None of them announces itself.

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

function fn(sql, name) {
  const match = new RegExp(
    `create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, 'm',
  ).exec(sql);
  assert.ok(match, `${name} is defined`);
  return match[0];
}

// ── Bulk editing ───────────────────────────────────────────────────────────

test('a bulk edit cannot set a status that means money has moved', () => {
  const sql = migration('developer_os_completion');
  const body = fn(sql, 'dev_bulk_update_units');

  // Refused explicitly, with a sentence, before anything is written.
  assert.match(
    body,
    /if p_status is not null and p_status in \('RESERVED','CONTRACT_PENDING','SOLD'\) then[\s\S]{0,200}raise exception/,
    'RESERVED, CONTRACT_PENDING and SOLD are refused outright',
  );

  // And the update itself skips rows already in one of those states, so a
  // price change cannot touch an apartment somebody has paid a deposit on.
  assert.match(
    body,
    /and \(p_status is null or u\.status not in \('RESERVED','CONTRACT_PENDING','SOLD'\)\)/,
    'units already under reservation or contract are skipped',
  );
});

test('a bulk edit cannot straddle two workspaces', () => {
  const body = fn(migration('developer_os_completion'), 'dev_bulk_update_units');

  assert.match(
    body,
    /select count\(distinct workspace_id\)[\s\S]{0,400}if v_workspaces > 1 then[\s\S]{0,160}raise exception/,
    'a crafted id list spanning two tenants is refused',
  );

  // The capability check happens AFTER the single-workspace check, which is
  // the only order that is safe: checking permission on min(workspace_id)
  // first would authorise the whole list from one tenant's membership.
  const spanCheck = body.indexOf('v_workspaces > 1');
  const canCheck = body.indexOf("dev_can(v_workspace, 'inventory')");
  assert.ok(spanCheck > 0 && canCheck > spanCheck,
    'the workspace check precedes the permission check');
});

test('a bulk edit is capped and always writes an audit row', () => {
  const body = fn(migration('developer_os_completion'), 'dev_bulk_update_units');
  assert.match(body, /array_length\(p_unit_ids, 1\) > 2000/, 'the batch is bounded');
  assert.match(body, /insert into public\.dev_audit_log[\s\S]{0,300}'BULK_UPDATE'/);
});

// ── The extraction gate ────────────────────────────────────────────────────

test('an extraction never silently overwrites a value that disagrees', () => {
  const body = fn(migration('developer_os_offers_extraction'), 'dev_apply_extraction');

  for (const field of ['contract_number', 'contract_date', 'sale_price']) {
    assert.ok(
      body.includes(`'field', '${field}'`),
      `${field} is reported in the result`,
    );
  }

  // Three fields, three refusals. Each compares against what is stored and
  // declines unless p_overwrite was passed.
  const refusals = body.match(/'reason', 'DIFFERS_FROM_EXISTING'/g) ?? [];
  assert.equal(refusals.length, 3,
    'every writable field refuses a disagreement rather than resolving it');

  assert.match(
    body, /and not p_overwrite then/,
    'overwriting requires an explicit flag',
  );
});

test('changing a sale price through an extraction needs finance', () => {
  const body = fn(migration('developer_os_offers_extraction'), 'dev_apply_extraction');
  assert.match(
    body,
    /if not public\.dev_can\(v_doc\.workspace_id, 'finance'\) then[\s\S]{0,220}'REQUIRES_FINANCE'/,
    'the document permission alone does not authorise a price change',
  );
  // And the derived instalment plan has to follow the price it is derived from.
  assert.match(body, /perform public\.dev_refresh_schedule\(v_deal\.id\)/);
});

test('a receipt becomes a RECORDED payment, never a confirmed one', () => {
  const body = fn(migration('developer_os_offers_extraction'), 'dev_apply_extraction');
  const insert = /insert into public\.dev_payments[\s\S]*?returning id into v_payment;/m.exec(body);
  assert.ok(insert, 'a payment can be created from a receipt');
  assert.match(insert[0], /'RECORDED',/, 'the payment is recorded, not confirmed');
  assert.doesNotMatch(insert[0], /'CONFIRMED'/,
    'confirming money stays a separate, deliberate act by finance');

  // And the same receipt cannot produce two payments.
  assert.match(
    body,
    /if exists \(select 1 from public\.dev_payments where document_id = p_document_id\)[\s\S]{0,200}'PAYMENT_ALREADY_RECORDED'/,
  );
});

test('the extractor writes to the document and to nothing else', () => {
  const source = readFileSync(
    path.join(ROOT, 'supabase/functions/developer-document-extract/index.ts'), 'utf8',
  );

  // The ledger is changed by a person through dev_apply_extraction, or not at
  // all. If this function ever learns to write a deal or a payment, the
  // human gate has been bypassed.
  for (const table of ['dev_deals', 'dev_payments', 'dev_units', 'dev_reservations']) {
    assert.ok(
      !new RegExp(`from\\('${table}'\\)`).test(source),
      `the extractor must not touch ${table}`,
    );
  }
  assert.match(source, /from\('dev_documents'\)/);

  // A scan costs nothing: the model is never reached for a file with no text.
  // The guard, not the import line of the same name.
  const ocrGuard = source.indexOf('if (!hasMeaningfulText(text))');
  const billing = source.indexOf('await beginExecution(');
  assert.ok(ocrGuard > 0 && billing > ocrGuard,
    'the empty-text check runs before anything is charged');

  // No new paid provider: this is the product Homatch already meters.
  assert.match(source, /productCode: 'CONTRACT_INTELLIGENCE'/);
});

test('an extracted field must be quoted verbatim from the document', () => {
  const source = readFileSync(
    path.join(ROOT, 'supabase/functions/developer-document-extract/index.ts'), 'utf8',
  );
  // The single check that turns a plausible reading into a checkable one, and
  // it runs in code rather than being asked for in the prompt.
  assert.match(
    source,
    /!haystack\.includes\(evidence\.toLowerCase\(\)\.replace\(\/\\s\+\/g, ' '\)\)/,
    'a value whose evidence is not in the document is dropped',
  );
  assert.match(source, /if \(!allowed\.has\(name\)\)/,
    'only the closed list of fields is accepted');
});

// ── The buyer's room ───────────────────────────────────────────────────────

test('the buyer sees their own purchase and nothing internal', () => {
  const body = fn(migration('developer_os_completion'), 'dev_buyer_room');

  // Absent from the SELECT list rather than filtered in the client.
  for (const table of ['dev_activities', 'dev_tasks', 'dev_audit_log', 'dev_commissions']) {
    assert.ok(!body.includes(table), `the buyer payload must not read ${table}`);
  }

  // Documents are opt-in: PRIVATE is the default and stays invisible.
  assert.match(
    body,
    /from public\.dev_documents dc[\s\S]{0,160}dc\.visibility = 'BUYER'/,
    'only documents deliberately shared with the buyer are listed',
  );

  // Paid is confirmed money. A buyer must never watch their balance fall
  // because somebody uploaded a photograph.
  const paid = /'paid', coalesce\(\(select sum\(amount\) from public\.dev_payments p[\s\S]{0,140}\)/.exec(body);
  assert.ok(paid, 'the paid figure is present');
  assert.match(paid[0], /p\.status = 'CONFIRMED'/);
});

test('a buyer can only reach a document on their own token', () => {
  const body = fn(migration('developer_os_completion'), 'dev_buyer_room_document');
  assert.match(
    body,
    /where d\.id = p_document_id[\s\S]{0,140}and d\.lead_id = v_link\.target_id[\s\S]{0,80}and d\.visibility = 'BUYER'/,
    'the document must belong to this token’s lead and be shared',
  );
  assert.match(body, /target_type = 'BUYER_ROOM'/);

  // The edge function signs only what SQL handed back, and never a path the
  // caller supplied.
  const edge = readFileSync(
    path.join(ROOT, 'supabase/functions/developer-buyer-document/index.ts'), 'utf8',
  );
  assert.match(edge, /rpc\('dev_buyer_room_document'/);
  assert.match(edge, /createSignedUrl\(path, SIGNED_URL_SECONDS\)/);
  assert.ok(!/body\?\.(path|storagePath)/.test(edge),
    'the caller cannot name a storage path');
});

// ── Contracts and commissions ──────────────────────────────────────────────

test('the contract lifecycle is separate from the sale status', () => {
  const sql = migration('developer_os_completion');
  assert.match(
    sql,
    /add column if not exists contract_status text not null default 'DRAFT'/,
    'the paperwork has its own field',
  );
  // Six real states, not two dates.
  for (const state of ['DRAFT', 'REVIEW', 'SIGNED', 'ACTIVE', 'COMPLETED', 'CANCELLED']) {
    assert.ok(sql.includes(`'${state}'`), `${state} is a contract state`);
  }

  const body = fn(sql, 'dev_set_contract_status');
  assert.match(body, /dev_can\(v_deal\.workspace_id, 'legal'\)[\s\S]{0,80}dev_can\(v_deal\.workspace_id, 'sale'\)/);
  // The transition never touches dev_units.status — availability has exactly
  // one owner, and it is the reservation and contract workflow.
  assert.ok(!body.includes('dev_units'),
    'moving the paperwork must not move an apartment');
});

test('a commission is an expense and is never mixed into collected money', () => {
  const sql = migration('developer_os_completion');
  const dashboard = /create or replace function public\.dev_dashboard[\s\S]*?\n\$\$;/m.exec(sql);
  assert.ok(dashboard, 'dev_dashboard exists');

  // Commissions are reported as their own three sums, beside the money
  // figures and never subtracted from them.
  assert.match(dashboard[0], /'commissions', \(select jsonb_build_object\(/);
  const money = /'money', \(select jsonb_build_object\([\s\S]*?from dev_payments[^)]*\)/m.exec(dashboard[0]);
  assert.ok(money, 'the money block exists');
  assert.ok(!money[0].includes('commission'),
    'collected money is computed without reference to commissions');

  // Approving one is finance's act, checked in SQL.
  const setter = fn(sql, 'dev_set_commission_status');
  assert.match(setter, /if not public\.dev_can\(v_row\.workspace_id, 'finance'\) then/);
});

test('the dashboard is security invoker, so RLS decides what it counts', () => {
  const sql = migration('developer_os_completion');
  const dashboard = /create or replace function public\.dev_dashboard[\s\S]*?\n\$\$;/m.exec(sql)[0];
  // A sales agent and an owner run the same SQL and get different answers,
  // because the rows they may read differ — not because the query does.
  assert.ok(!/security definer/i.test(dashboard),
    'dev_dashboard must NOT be security definer');
  assert.match(dashboard, /set search_path to public, pg_catalog/);
});

// ── Offers ─────────────────────────────────────────────────────────────────

test('a discount needs the discount permission, checked in the database', () => {
  const body = fn(migration('developer_os_offers_extraction'), 'dev_create_offer');
  assert.match(
    body,
    /if v_disc > 0 and not public\.dev_can\(v_unit\.workspace_id, 'discount'\) then/,
    'a sales agent may quote list price and may not discount',
  );
  // The price comes from the unit inside the transaction, never from the
  // client: otherwise the figure a customer sees is whatever was sent.
  assert.match(body, /v_base := v_unit\.price;/);
  assert.match(body, /v_final := v_base - v_disc;/);
});

test('accepting an offer does not take the apartment off the market', () => {
  const body = fn(migration('developer_os_offers_extraction'), 'dev_set_offer_status');
  // Reserving is a second, deliberate act with its own deposit and expiry.
  assert.ok(!body.includes('dev_units'),
    'an offer status change must not touch a unit');
  assert.ok(!body.includes('dev_reservations'),
    'an offer status change must not create a reservation');
});

// ── The public surface ─────────────────────────────────────────────────────

test('the anonymous surface is exactly the eleven intended functions', () => {
  const sweep = migration('twin_scene_public');
  const list = /public_fns constant text\[\] := array\[([\s\S]*?)\];/m.exec(sweep);
  assert.ok(list, 'the public list is declared in one place');

  const names = [...list[1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(names, [
    'dev_buyer_room',
    'dev_buyer_room_document',
    'dev_public_project',
    'dev_share_resolve',
    'dev_share_track',
    'dt_building_floors',
    'dt_experience_manifest',
    'dt_floor_units',
    'dt_scene',
    'dt_track',
    'dt_unit_scene',
  ], 'nothing has quietly joined the public surface');

  // BOTH revokes, every time. PUBLIC is a pseudo-role; anon holds its own
  // grant, and revoking the first does not undo the second.
  assert.match(sweep, /revoke all on function public\.%I\(%s\) from public/);
  assert.match(sweep, /revoke all on function public\.%I\(%s\) from anon/);
});
