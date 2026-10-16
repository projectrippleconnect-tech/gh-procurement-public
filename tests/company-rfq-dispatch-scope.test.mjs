import test from 'node:test'
import assert from 'node:assert/strict'
import {checkedRfqIds,submittedRfqIds} from '../lib/company-rfq-dispatch-scope.mjs'
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002'
test('new stock counts scope automatic RFQ dispatch to returned RFQ IDs only',()=>{
 assert.deepEqual(submittedRfqIds([{rfq_id:a},{rfq_id:b},{rfq_id:a}]),[a,b])
 assert.deepEqual(submittedRfqIds([]),[])
 assert.deepEqual(submittedRfqIds(null),[])
})
test('queue RFQ ID filter rejects empty, malformed, excessive, and mixed identifiers',()=>{
 for(const ids of [[],['old-rfq'],[a,42],Array(201).fill(a),null])assert.throws(()=>checkedRfqIds(ids),/valid RFQ identifiers/)
 assert.deepEqual(checkedRfqIds([b,b,a]),[b,a])
 assert.throws(()=>submittedRfqIds([{rfq_id:a},{rfq_id:'not-a-uuid'}]),/valid RFQ identifiers/)
})
