import test from 'node:test'
import assert from 'node:assert/strict'
import {companyImportCollisionGuard} from '../lib/reviewed-company-import-guard.mjs'

test('new company or empty company list can import first records',()=>{
 assert.deepEqual(companyImportCollisionGuard([], [{source_key:'sheet:first'}]),{blocked:false,unknownCount:0,existingCount:0})
})
test('unchanged source identities remain importable after refresh',()=>{
 assert.deepEqual(companyImportCollisionGuard(['a','b'],[{source_key:'b'},{source_key:'a'}]),{blocked:false,unknownCount:0,existingCount:2})
})
test('renamed sheet rows do not silently insert a second stock item',()=>{
 assert.deepEqual(companyImportCollisionGuard(['old-a','b'],[{source_key:'new-a'},{source_key:'b'}]),{blocked:true,unknownCount:1,existingCount:2})
})
test('genuinely new rows in existing list require reviewed import, not blind auto-import',()=>{
 assert.equal(companyImportCollisionGuard(['a'],[{source_key:'a'},{source_key:'new-b'}]).blocked,true)
})
