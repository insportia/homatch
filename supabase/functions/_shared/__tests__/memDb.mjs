// A small stateful stand-in for the PostgREST client, enough to drive the
// Find Buyers pipeline end to end in node: select/eq/neq/in/is/limit,
// insert/update/upsert (onConflict), maybeSingle/single and .select() after a
// write returning the written rows with generated ids. Not a SQL engine.
import { randomUUID } from 'node:crypto';

export function memDb(seed = {}) {
  const tables = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const rpcs = [];
  const t = (name) => (tables[name] ??= []);
  const pathGet = (row, col) => {
    const m = String(col).match(/^(\w+)->>?(\w+)$/);
    return m ? row[m[1]]?.[m[2]] : row[col];
  };
  function builder(name) {
    const st = { op: 'select', filters: [], payload: null, single: false, limit: null, conflict: null, ignoreDuplicates: false, returning: false };
    const match = (r) => st.filters.every(([op, c, v]) => {
      const x = pathGet(r, c);
      if (op === 'eq') return x === v;
      if (op === 'neq') return x !== v;
      if (op === 'in') return v.includes(x);
      if (op === 'is') return v === null ? x == null : x === v;
      return true;
    });
    const exec = async () => {
      const rows = t(name);
      if (st.op === 'insert' || st.op === 'upsert') {
        const list = (Array.isArray(st.payload) ? st.payload : [st.payload]).map((r) => ({ id: r.id ?? randomUUID(), ...r }));
        const out = [];
        for (const r of list) {
          const keys = st.conflict ? st.conflict.split(',') : null;
          const hit = keys ? rows.find((x) => keys.every((k) => x[k] === r[k])) : null;
          if (hit) {
            if (st.op === 'insert') return { data: null, error: { code: '23505', message: 'duplicate' } };
            if (!st.ignoreDuplicates) Object.assign(hit, { ...r, id: hit.id });
            out.push(hit);
          } else { rows.push(r); out.push(r); }
        }
        return { data: st.single ? out[0] ?? null : out, error: null };
      }
      if (st.op === 'update') {
        const hit = rows.filter(match);
        hit.forEach((r) => Object.assign(r, st.payload));
        return { data: st.single ? hit[0] ?? null : hit, error: null };
      }
      let hit = rows.filter(match);
      if (st.limit != null) hit = hit.slice(0, st.limit);
      return { data: st.single ? hit[0] ?? null : hit, error: null };
    };
    const b = {};
    b.select = () => { st.returning = true; return b; };
    b.eq = (c, v) => { st.filters.push(['eq', c, v]); return b; };
    b.neq = (c, v) => { st.filters.push(['neq', c, v]); return b; };
    b.in = (c, v) => { st.filters.push(['in', c, v]); return b; };
    b.is = (c, v) => { st.filters.push(['is', c, v]); return b; };
    for (const m of ['not', 'or', 'order', 'gte', 'lte', 'gt', 'lt', 'ilike', 'like', 'contains', 'range']) b[m] = () => b;
    b.limit = (n) => { st.limit = n; return b; };
    b.insert = (p) => { st.op = 'insert'; st.payload = p; return b; };
    b.update = (p) => { st.op = 'update'; st.payload = p; return b; };
    b.upsert = (p, o = {}) => { st.op = 'upsert'; st.payload = p; st.conflict = o.onConflict ?? null; st.ignoreDuplicates = Boolean(o.ignoreDuplicates); return b; };
    b.maybeSingle = () => { st.single = true; return b; };
    b.single = () => { st.single = true; return b; };
    b.then = (ok, bad) => exec().then(ok, bad);
    return b;
  }
  const db = {
    from: builder,
    rpc: (n, a) => { rpcs.push({ n, a }); return { then: (ok, bad) => Promise.resolve({ data: true, error: null }).then(ok, bad) }; },
  };
  return { db, tables, rpcs };
}
