import {test} from 'node:test'
import assert from 'node:assert/strict'
import {nativeQaConfig,assertEmptyNativeDatabase} from '../scripts/qa/native-guard.mjs'
const config=url=>nativeQaConfig({GH_PORTAL_QA_ALLOW_BOOTSTRAP:'1',GH_PORTAL_QA_DATABASE_URL:url})
test('native QA refuses implicit URLs and hosted or ambiguous targets',()=>{
 assert.throws(()=>nativeQaConfig({DATABASE_URL:'postgres://production/db'}))
 for(const url of ['postgres://db.supabase.co/gh_portal_qa_test','postgres://127.0.0.1/postgres','postgres://127.0.0.1/gh_portal_qa_test?host=db.supabase.co','postgres://127.0.0.1/gh_portal_qa_test#other','https://localhost/gh_portal_qa_test'])assert.throws(()=>config(url))
 assert.equal(config('postgres://postgres:test@127.0.0.1:55432/gh_portal_qa_test').ssl,false)
})
test('native QA refuses reused schemas, objects and shared Supabase roles',async()=>{
 for(const extra of [{schemas:1},{objects:1},{roles:1},{name:'postgres'}])await assert.rejects(assertEmptyNativeDatabase({query:async()=>({rows:[{name:'gh_portal_qa_test',schemas:0,objects:0,roles:0,...extra}]})}))
 await assertEmptyNativeDatabase({query:async()=>({rows:[{name:'gh_portal_qa_test',schemas:0,objects:0,roles:0}]})})
})
