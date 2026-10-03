// THE SPEND-WHILE-VIEWED GUARD MUST NOT READ A COLUMN THE TABLE DOES NOT HAVE.
//
// public.homatch_refuse_spend_while_viewed() fires BEFORE INSERT on credit_ledger,
// credit_reservations and usage_reservations. Only credit_ledger has an amount column.
// 20260928400000 wrote
//
//     if tg_table_name = 'credit_ledger' and coalesce(new.amount, 0) >= 0 then
//
// PL/pgSQL does not short-circuit AND, so every usage_reservations insert raised 42703
// (record "new" has no field "amount") and every wallet_reserve() failed in production
// from 2026-09-22 on. These tests read the LATEST definition across
// supabase/migrations and require that new.amount is only evaluated inside a branch
// that has already established tg_table_name = 'credit_ledger', and never in the same
// boolean expression as the tg_table_name test.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS = join(root, 'supabase', 'migrations');
const FN = 'public.homatch_refuse_spend_while_viewed';

const stripSqlComments = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');

function latestDefinition() {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  let found = null;
  for (const file of files) {
    const sql = stripSqlComments(readFileSync(join(MIGRATIONS, file), 'utf8'));
    const re = new RegExp(`create\\s+or\\s+replace\\s+function\\s+${FN.replace('.', '\\.')}\\s*\\(\\s*\\)[\\s\\S]*?\\bas\\s+\\$\\$([\\s\\S]*?)\\$\\$`, 'gi');
    for (const m of sql.matchAll(re)) found = { file, body: m[1] };
  }
  return found;
}

/* Walk IF / ELSIF / ELSE / END IF and record, for every reference to new.amount,
   the stack of conditions that encloses it (a reference inside a condition is
   enclosed by the conditions around that IF, not by itself). */
function analyse(body) {
  const re = /\bend\s+if\b|\belsif\b|\belse\b|\bif\b|\bthen\b|\bnew\.amount\b/g;
  const src = body.toLowerCase();
  const conditions = [];
  const amountRefs = [];
  const stack = [];
  let collecting = null;
  for (const m of src.matchAll(re)) {
    const tok = m[0].replace(/\s+/g, ' ');
    if (collecting) {
      if (tok === 'new.amount') { amountRefs.push([...stack.slice(0, collecting.kind === 'if' ? stack.length : -1)]); continue; }
      if (tok !== 'then') continue;
      const cond = src.slice(collecting.from, m.index).replace(/\s+/g, ' ').trim();
      conditions.push(cond);
      if (collecting.kind === 'if') stack.push(cond);
      else stack[stack.length - 1] = cond;
      collecting = null;
      continue;
    }
    if (tok === 'end if') stack.pop();
    else if (tok === 'if' || tok === 'elsif') collecting = { kind: tok, from: m.index + m[0].length };
    else if (tok === 'else') stack[stack.length - 1] = 'else';
    else if (tok === 'new.amount') amountRefs.push([...stack]);
  }
  return { conditions, amountRefs };
}

const def = latestDefinition();

test('homatch_refuse_spend_while_viewed is defined in supabase/migrations', () => {
  assert.ok(def, `${FN}() not found in any migration`);
});

test('no single condition mixes the tg_table_name check with a read of new.amount', () => {
  const { conditions } = analyse(def.body);
  for (const cond of conditions) {
    assert.ok(
      !(/tg_table_name/.test(cond) && /new\.amount/.test(cond)),
      `${def.file}: "${cond}" evaluates new.amount in the same expression as the table check; ` +
        'PL/pgSQL does not short-circuit, so a table without amount raises 42703',
    );
  }
});

test('every read of new.amount sits inside a credit_ledger-only branch', () => {
  const { amountRefs } = analyse(def.body);
  assert.ok(amountRefs.length > 0, `${def.file}: expected the credit_ledger amount check to remain (top-ups must pass)`);
  for (const enclosing of amountRefs) {
    assert.ok(
      enclosing.some((c) => /^tg_table_name\s*=\s*'credit_ledger'$/.test(c.trim())),
      `${def.file}: new.amount is read outside an "if tg_table_name = 'credit_ledger' then" branch ` +
        `(enclosing conditions: ${JSON.stringify(enclosing)})`,
    );
  }
});

test('the refusal keeps its message, errcode and lockdown', () => {
  assert.match(def.body, /READ_ONLY_IMPERSONATION: no spend on %/);
  assert.match(def.body, /errcode\s*=\s*'42501'/);
  const sql = readFileSync(join(MIGRATIONS, def.file), 'utf8');
  assert.match(sql, /security\s+definer/i);
  assert.match(sql, /set\s+search_path\s*=\s*public,\s*pg_temp/i);
  assert.match(sql, new RegExp(`revoke\\s+all\\s+on\\s+function\\s+${FN.replace('.', '\\.')}\\(\\)\\s+from\\s+public,\\s*anon,\\s*authenticated`, 'i'));
});

test('the guard catches the original defect', () => {
  const broken = `begin
  if tg_table_name = 'credit_ledger' and coalesce(new.amount, 0) >= 0 then
    return new;
  end if;
  return new;
end`;
  const { conditions, amountRefs } = analyse(broken);
  assert.ok(conditions.some((c) => /tg_table_name/.test(c) && /new\.amount/.test(c)));
  assert.ok(amountRefs.length > 0);
  assert.ok(amountRefs.every((s) => !s.some((c) => /^tg_table_name\s*=\s*'credit_ledger'$/.test(c.trim()))));
});
