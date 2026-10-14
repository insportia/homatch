// One explicitly reviewed migration, applied atomically before its API deployment.
// Never repair historical ledger entries or replay unrelated pending migrations.
import fs from 'node:fs';
// Read the same job-local owed file used by upload and artifact proof.
const owedAt=process.argv.indexOf('--owed');
if(owedAt>=0&&!fs.readFileSync(process.argv[owedAt+1],'utf8').trim().split(/\s+/).includes('publishing-engine'))process.exit(0);
const version='20261014140000',name='publishing_engine_ssge';
const sql=fs.readFileSync(new URL('../../supabase/migrations/'+version+'_'+name+'.sql',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const query=`DO $publishing_release$
DECLARE previous text[];
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('publishing_engine_ssge_migration'));
 SELECT statements INTO previous FROM supabase_migrations.schema_migrations WHERE version=${quote(version)};
 IF FOUND THEN
  IF previous IS DISTINCT FROM ARRAY[${quote(sql)}]::text[] THEN RAISE EXCEPTION 'PUBLISHING_MIGRATION_PROVENANCE_MISMATCH'; END IF;
 ELSE
  EXECUTE ${quote(sql)};
  INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${quote(version)},${quote(name)},ARRAY[${quote(sql)}]);
 END IF;
END $publishing_release$;`;
if(process.argv.includes('--print'))process.stdout.write(query+'\n');
else {
 if(process.env.SUPABASE_PROJECT_REF!=='ptxajsjhobhvsfhmutjn'||!process.env.SUPABASE_ACCESS_TOKEN)throw Error('PUBLISHING_RELEASE_ENV_REQUIRED');
 const response=await fetch('https://api.supabase.com/v1/projects/ptxajsjhobhvsfhmutjn/database/query',{method:'POST',headers:{Authorization:'Bearer '+process.env.SUPABASE_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({query})});
 if(!response.ok)throw Error('PUBLISHING_MIGRATION_FAILED_HTTP_'+response.status);
 console.log('Verified publishing migration applied; historical migrations untouched.');
}

