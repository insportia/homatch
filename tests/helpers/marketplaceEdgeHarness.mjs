import { createRequire } from 'node:module';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let ts;
try { ts = require('typescript'); }
catch { ts = createRequire(new URL('../../official-worker/package.json', import.meta.url))('typescript'); }

/** Execute the real edge handler with explicit transport/DB seams; domain code is real. */
export function edgeHandler(file, seams) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true);
  const withoutImports = ts.factory.updateSourceFile(source, source.statements.filter(s => !ts.isImportDeclaration(s)));
  const code = ts.transpileModule(ts.createPrinter().printFile(withoutImports), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let handler;
  vm.runInNewContext(code, { ...seams, Request, Response, TextEncoder, crypto, console,
    Deno: { serve(fn) { handler = fn; }, env: { get: key => ({ SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture-server-only' })[key] } } }, { filename: file });
  return handler;
}

export function memoryDatabase(tables, { user = 'owner-auth' } = {}) {
  const db = { tables, failure: null, auth: { getUser: async token => ({ data: { user: token === 'owner-jwt' ? { id: user } : null } }) },
    from(table) {
      tables[table] ??= [];
      let rows = [...tables[table]], update = null, remove = false;
      const orders = [];
      const run = () => {
        if (db.failure && table === 'discovery_marketplace_searches') return { data: null, error: db.failure };
        if (update) rows.forEach(row => Object.assign(row, update));
        if (remove) tables[table] = tables[table].filter(row => !rows.includes(row));
        return { data: rows, error: null };
      };
      const query = {
        select() { return query; }, eq(k,v) { rows = rows.filter(r => r[k] === v); return query; },
        neq(k,v) { rows = rows.filter(r => r[k] !== v); return query; }, in(k,v) { rows = rows.filter(r => v.includes(r[k])); return query; },
        is(k,v) { rows = rows.filter(r => (r[k] ?? null) === v); return query; }, lte(k,v) { rows = rows.filter(r => r[k] != null && r[k] <= v); return query; },
        order(k, {ascending = true} = {}) { orders.push([k,ascending]); rows.sort((a,b) => { for(const [key,asc] of orders){const n=String(a[key]).localeCompare(String(b[key]));if(n)return n*(asc?1:-1);}return 0; }); return query; },
        limit(n) { rows = rows.slice(0,n); return query; }, range(a,b) { rows = rows.slice(a,b+1); return query; },
        update(value) { update = value; return query; }, delete() { remove = true; return query; },
        async upsert(batch, {onConflict}) {
          const keys = onConflict.split(',');
          for (const row of batch) { const old = tables[table].find(r => keys.every(k => r[k] === row[k])); if (old) Object.assign(old,row); else tables[table].push({...row}); }
          return {error:null};
        },
        async maybeSingle() { const result = run(); return {...result,data:result.error ? null : result.data[0] ?? null}; },
        then(resolve,reject) { return Promise.resolve(run()).then(resolve,reject); },
      };
      return query;
    },
  };
  return db;
}
