import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const migration=readFileSync(new URL('../supabase/migrations/20261011130219_procurement_staff_effective_permissions_rls_fix.sql',import.meta.url),'utf8')
const app=readFileSync(new URL('../components/procurement-app.jsx',import.meta.url),'utf8')

test('staff permission RPC can read protected role catalogs without widening RLS',()=>{
 assert.match(migration,/ALTER FUNCTION public\.proc_my_permissions_v1\(\) SECURITY DEFINER;/i)
 assert.match(migration,/ALTER FUNCTION public\.proc_my_permissions_v1\(\) SET search_path TO '';/i)
 assert.doesNotMatch(migration,/(?:CREATE\s+POLICY|ALTER\s+POLICY|DISABLE\s+ROW\s+LEVEL\s+SECURITY|GRANT\s+SELECT)/i)
})

test('staff grants RPC is restricted to authenticated callers',()=>{
 assert.match(migration,/REVOKE ALL ON FUNCTION public\.proc_my_permissions_v1\(\) FROM PUBLIC, anon;/i)
 assert.match(migration,/GRANT EXECUTE ON FUNCTION public\.proc_my_permissions_v1\(\) TO authenticated;/i)
})

test('workspace navigation reads the effective permission RPC instead of bypassing RBAC',()=>{
 assert.match(app,/supabase\.rpc\('proc_my_permissions_v1'\)/)
 assert.match(app,/if\(permissionsLoaded&&key\)return can\(key\)/)
 assert.match(app,/if\(!m\.enabled\)return false/)
})
