#!/usr/bin/env node
// Verify Scaling — the Railway API contract, checked against Railway's live public schema (introspection needs
// no token and changes nothing). Confirms every type, field, argument and mutation that
// supabase/functions/_shared/railwayScaling.ts sends exists and is not deprecated. It cannot prove what a
// project token is authorised to do; that is proven by the first real, owner-approved scale (read back + logged).
//   node scripts/verify/railway-contract-check.mjs
const NEED = {
  ServiceInstance: ['region', 'numReplicas', 'latestDeployment'],
  ServiceInstanceUpdateInput: ['multiRegionConfig', 'numReplicas', 'region'],
  Mutation: ['serviceInstanceUpdate', 'serviceInstanceRedeploy'],
  Query: ['serviceInstance', 'metrics'],
};
const ARGS = { serviceInstanceUpdate: ['serviceId', 'environmentId', 'input'], serviceInstanceRedeploy: ['serviceId', 'environmentId'], serviceInstance: ['serviceId', 'environmentId'], metrics: ['projectId', 'serviceId', 'environmentId', 'startDate', 'measurements', 'sampleRateSeconds'] };
const q = (t) => `{ __type(name: "${t}") { fields(includeDeprecated: true) { name isDeprecated args { name } } inputFields(includeDeprecated: true) { name isDeprecated } } }`;
let bad = 0;
for (const [type, names] of Object.entries(NEED)) {
  const r = await fetch('https://backboard.railway.com/graphql/v2', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q(type) }) });
  const ty = (await r.json())?.data?.__type;
  if (!ty) { console.log(`MISSING type ${type}`); bad++; continue; }
  const all = [...(ty.fields ?? []), ...(ty.inputFields ?? [])];
  for (const n of names) {
    const f = all.find((x) => x.name === n);
    const missingArgs = f && ARGS[n] ? ARGS[n].filter((a) => !(f.args ?? []).some((x) => x.name === a)) : [];
    const ok = f && !f.isDeprecated && missingArgs.length === 0;
    if (!ok) bad++;
    console.log(`${ok ? 'ok      ' : 'PROBLEM '} ${type}.${n}${f?.isDeprecated ? ' (deprecated)' : ''}${missingArgs.length ? ` missing args ${missingArgs}` : ''}${f ? '' : ' (missing)'}`);
  }
}
console.log(bad ? `railway-contract-check: ${bad} problem(s)` : 'railway-contract-check: OK');
process.exit(bad ? 1 : 0);
