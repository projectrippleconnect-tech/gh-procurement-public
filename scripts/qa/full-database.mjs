// In-memory PostgreSQL only. No database URL, live user, gateway or business rows.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto'
const root=process.cwd(),snapshotPath='tests/schema/procurement-baseline.json'
const meta=JSON.parse(fs.readFileSync('tests/schema/procurement-baseline-meta.json','utf8'))
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex')
assert.equal(hash(snapshotPath),meta.sha256,'Schema snapshot changed; regenerate its metadata')
const snapshot=JSON.parse(fs.readFileSync(snapshotPath,'utf8'))
for(const row of meta.migrations)assert.equal(hash(row.path),row.sha256,'Historic migration changed: '+row.path)
const db=new PGlite({extensions:{pgcrypto}}),log=[]
async function execute(sql,label){try{return await db.exec(sql)}catch(e){throw new Error(label+': '+e.message,{cause:e})}}
await execute(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;CREATE SCHEMA private;CREATE SCHEMA extensions;CREATE EXTENSION pgcrypto WITH SCHEMA extensions;GRANT USAGE ON SCHEMA extensions TO anon,authenticated,service_role;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}',raw_app_meta_data jsonb DEFAULT '{}',created_at timestamptz DEFAULT now(),email_confirmed_at timestamptz,last_sign_in_at timestamptz);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role')$$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
GRANT USAGE ON SCHEMA auth,public,private TO anon,authenticated,service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon,authenticated,service_role;
SET check_function_bodies=off;`,'Supabase request-claim test adapter')
for(const kind of ['types','sequences','tables','constraints'])for(const row of snapshot[kind])await execute(row.sql,kind)
let pending=snapshot.functions.map(x=>({sql:x.sql.trim()+';',kind:'function'})).concat(snapshot.views.map(v=>({sql:'CREATE VIEW public.'+v.name+(v.options?.length?' WITH ('+v.options.join(',')+')':'')+' AS '+v.definition,kind:'view'})))
while(pending.length){
 const next=[]
 for(const row of pending){try{await db.exec(row.sql)}catch(e){if(['42P01','42704','42883'].includes(e.code))next.push({...row,error:e.message});else throw new Error(row.kind+': '+e.message,{cause:e})}}
 if(next.length===pending.length)throw Error('Unresolved schema dependencies: '+JSON.stringify(next.map(x=>({sql:x.sql.slice(0,90),error:x.error}))))
 pending=next
}
const reference=snapshot.reference_rows[0].data
for(const [key,table] of [['roles','proc_roles'],['permissions','proc_permissions'],['role_permissions','proc_role_permissions']])await db.query(`INSERT INTO public.${table} SELECT * FROM jsonb_populate_recordset(NULL::public.${table},$1::jsonb)`,[JSON.stringify(reference[key])])
await execute(`INSERT INTO auth.users(id,email) VALUES('00000000-0000-4000-8000-000000000111','qa-admin@example.invalid');
INSERT INTO public.proc_profiles(id,display_name,role,role_key) VALUES('00000000-0000-4000-8000-000000000111','Isolated QA Admin','admin','admin');
INSERT INTO private.proc_access_rules(scope_id,time_enabled,location_enabled) VALUES('00000000-0000-0000-0000-000000000000',false,false);
INSERT INTO public.proc_locations(id,code,name) VALUES('00000000-0000-4000-8000-000000000099','QA','Isolated QA location');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000111',false);`,'synthetic principals and unlocked test location')
for(const kind of ['triggers','rls','policies','grants'])for(const row of snapshot[kind])await execute(row.sql,kind)
for(const row of snapshot.function_acl){await execute(`REVOKE ALL ON FUNCTION ${row.signature} FROM PUBLIC;`,'function ACL');for(const g of row.grants)if(['PUBLIC','anon','authenticated','service_role'].includes(g.grantee))await execute(`GRANT EXECUTE ON FUNCTION ${row.signature} TO ${g.grantee};`,'function ACL')}
await execute('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public,private TO authenticated;SET check_function_bodies=on;','sequence ACL')
const applied=new Set(meta.migrations.map(x=>x.path)),patches=fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).map(f=>'supabase/migrations/'+f).filter(f=>!applied.has(f)).sort()
for(const file of patches)await execute(fs.readFileSync(file,'utf8'),'new migration '+file)
console.log(`PASS isolated production definitions: ${snapshot.tables.length} tables, ${snapshot.functions.length} functions, ${snapshot.views.length} views; ${patches.length} new migration(s)`)
function expand(file){return fs.readFileSync(file,'utf8').split('\n').map(line=>{const m=line.match(/^\\ir\s+(.+)$/);if(m)return expand(path.resolve(path.dirname(file),m[1]));return line.startsWith('\\')?'':line}).join('\n')}
const defaults=['tests/procurement-workflow.sql','tests/sql/workflow-efficiency.sql','tests/sql/role-boundaries.sql','tests/sql/disabled-role-helper.sql','tests/sql/large-stock-count.sql','tests/sql/api-table-privileges.sql','tests/sql/additional-sizes.sql','tests/sql/quote-variations.sql','tests/sql/add-rfq-supplier.sql','tests/sql/company-items.sql','tests/sql/custom-role-cloning.sql','tests/sql/user-removal.sql','tests/sql/admin-data-management.sql','tests/sql/reset-preserves-company-catalogue.sql','tests/sql/admin-safeupdate-static.sql','tests/sql/company-submit-boundaries.sql','tests/sql/company-supplier-setup.sql','tests/sql/receiving-closure.sql','tests/sql/supplier-portal.sql','tests/sql/supplier-portal-boundaries.sql']
const tableNames=snapshot.tables.map(t=>t.sql.match(/^CREATE TABLE (\S+)/)[1])
async function rowCounts(){const counts={};for(const name of tableNames){const r=await db.query('SELECT count(*)::integer n FROM '+name);counts[name]=r.rows[0].n}return counts}
const seededCounts=await rowCounts()
for(const file of (process.argv.length>2?process.argv.slice(2):defaults)){
 const started=Date.now()
 try{const sql=expand(path.resolve(file)),result=await db.exec(/^begin;/im.test(sql)?sql:'BEGIN;\n'+sql+'\nROLLBACK;');assert.deepEqual(await rowCounts(),seededCounts,'Test failed to roll back its fixture records');log.push({file,status:'passed',ms:Date.now()-started,checks:result.flatMap(x=>x.rows||[])})}
 catch(e){await db.exec('ROLLBACK;RESET ROLE;');log.push({file,status:'failed',ms:Date.now()-started,error:e.message,where:e.where})}
 console.log(JSON.stringify(log.at(-1)))
}
fs.mkdirSync('test-results',{recursive:true})
fs.writeFileSync('test-results/full-database.json',JSON.stringify({baseline:meta.source_commit,patches,results:log},null,2))
await db.close()
if(log.some(x=>x.status==='failed'))process.exitCode=1
