import test from 'node:test'
import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto'
import {bootstrapProcurementSchema} from '../scripts/qa/schema-bootstrap.mjs'
test('workspace bootstrap returns current permissions and configuration in one invoker call',async()=>{
 const db=new PGlite({extensions:{pgcrypto}})
 try{
  await bootstrapProcurementSchema(db);await db.exec("insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000222','qa-second@example.invalid');insert into public.proc_profiles(id,display_name,role,role_key) values('00000000-0000-4000-8000-000000000222','Second QA Admin','admin','admin');set role authenticated")
  const read=async()=>(await db.query('select public.proc_workspace_bootstrap_v1() as data')).rows[0].data
  const value=await read();assert.equal(value.profile.id,'00000000-0000-4000-8000-000000000111');assert.ok(value.permissions.includes('stock.count.enter'));assert.ok(Array.isArray(value.config.fields));assert.ok(Array.isArray(value.config.modules));assert.equal(typeof value.config.settings,'object')
  const perms=(await db.query('select permission_key from public.proc_my_permissions_v1()')).rows.map(r=>r.permission_key).sort();assert.deepEqual([...value.permissions].sort(),perms)
  await db.exec("reset role;select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000222',false);update public.proc_profiles set active=false where id='00000000-0000-4000-8000-000000000111';select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000111',false);set role authenticated")
  await assert.rejects(read(),/disabled|restricted/)
  await db.exec("reset role;select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000222',false);update public.proc_profiles set active=true where id='00000000-0000-4000-8000-000000000111';select set_config('request.jwt.claim.sub','',false);set role authenticated")
  await assert.rejects(read(),/Authentication required/)
  await db.exec('reset role;set role anon');await assert.rejects(read(),/permission denied/)
  await db.exec('reset role')
  const acl=(await db.query("select prosecdef,has_function_privilege('anon',oid,'EXECUTE') as anon from pg_proc where proname='proc_workspace_bootstrap_v1'")).rows[0];assert.equal(acl.prosecdef,false);assert.equal(acl.anon,false)
 }finally{await db.close()}
})
