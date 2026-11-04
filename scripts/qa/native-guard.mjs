// This runner may initialize only a disposable local database, never a linked service.
export function nativeQaConfig(env=process.env){
 if(env.GH_PORTAL_QA_ALLOW_BOOTSTRAP!=='1')throw Error('Set GH_PORTAL_QA_ALLOW_BOOTSTRAP=1 for a new disposable local database')
 const raw=env.GH_PORTAL_QA_DATABASE_URL
 if(!raw)throw Error('GH_PORTAL_QA_DATABASE_URL is required; production DATABASE_URL is never used')
 const u=new URL(raw)
 if(!['postgres:','postgresql:'].includes(u.protocol)||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.search||u.hash)throw Error('Only a plain loopback PostgreSQL URL is permitted')
 if(!/^\/gh_portal_qa_[a-z0-9_]+$/.test(u.pathname))throw Error('Disposable database name must begin gh_portal_qa_')
 return {connectionString:raw,ssl:false,connectionTimeoutMillis:5000,statement_timeout:15000,application_name:'gh-portal-isolated-qa'}
}
export async function assertEmptyNativeDatabase(client){
 const {rows:[r]}=await client.query(`select current_database() name,
 (select count(*)::int from pg_namespace where nspname not in ('public','information_schema') and nspname not like 'pg_%') schemas,
 (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public') objects,
 (select count(*)::int from pg_roles where rolname in ('anon','authenticated','service_role')) roles`)
 if(!/^gh_portal_qa_[a-z0-9_]+$/.test(r.name)||r.schemas||r.objects||r.roles)throw Error('Refusing nonempty database or a cluster with Supabase roles; use a fresh disposable PostgreSQL container')
}
