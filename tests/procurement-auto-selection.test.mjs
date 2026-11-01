import test from 'node:test'
import assert from 'node:assert/strict'
import {eligibleAutomaticJob,hasExistingAttempt,supplierSendRows,verifiedAuditGroup} from '../lib/procurement-auto-selection.mjs'

const created='2026-11-02T02:00:00Z'
const job={job_type:'rfq_send',entity_type:'rfq',entity_id:'3f3f3f3f-3333-4333-8333-333333333333',status:'needs_action',created_at:created}
test('only newly created eligible RFQ or approved workflow PO jobs qualify',()=>{
 assert.equal(eligibleAutomaticJob(job,'2026-11-02T01:59:59Z'),true)
 assert.equal(eligibleAutomaticJob({...job,job_type:'po_send',entity_type:'po'},'2026-11-02T01:00:00Z'),true)
 for(const invalid of [
  {...job,status:'completed'}, {...job,created_at:'2026-10-20T00:00:00Z'},
  {...job,entity_type:'po'}, {...job,entity_id:'not uuid'}, {...job,job_type:'stock_continue'}
 ])assert.equal(eligibleAutomaticJob(invalid,'2026-11-02T01:59:59Z'),false)
 assert.equal(eligibleAutomaticJob(job,''),false,'missing activation cutoff must fail closed')
})
test('duplicate and unknown attempts always block unattended retry',()=>{
 assert.equal(hasExistingAttempt(null),true,'database query failure is unsafe')
 assert.equal(hasExistingAttempt([]),false)
 for(const state of ['accepted','failed','unknown','sending'])assert.equal(hasExistingAttempt([{status:state}]),true)
})
test('supplier document requires valid positive quantities and nonempty UOM',()=>{
 assert.deepEqual(supplierSendRows([{description:'GI Pipe',size:'1 inch',uom:'PCS',qty:3}])[0],{description:'GI Pipe',size:'1 inch',uom:'PCS',qty:3})
 assert.throws(()=>supplierSendRows([]),/no supplier items/)
 assert.throws(()=>supplierSendRows([{description:'x',qty:0,uom:'PCS'}]),/Incomplete/)
 assert.throws(()=>supplierSendRows([{description:'x',qty:2}]),/Incomplete/)
 assert.deepEqual(supplierSendRows([{description:'GI pipe',size:'2 inch',qty:3,uom:'PCS',unitPrice:10.5,lineTotal:31.5}])[0],
  {description:'GI pipe',size:'2 inch',qty:3,uom:'PCS',unitPrice:10.5,lineTotal:31.5})
 assert.throws(()=>supplierSendRows([{description:'x',qty:2,uom:'PCS',unitPrice:null,lineTotal:4}]),/Invalid supplier price/)
})
test('owner-only audit group must be explicitly enabled and in proper WhatsApp group-id format',()=>{
 const config={enabled:'true',ownerOnly:'true',groupId:'120363123456789123@g.us'}
 assert.equal(verifiedAuditGroup(config),config.groupId)
 assert.equal(verifiedAuditGroup({...config,ownerOnly:'false'}),null)
 assert.equal(verifiedAuditGroup({...config,groupId:'94770000000@c.us'}),null)
})
