import test from 'node:test'
import assert from 'node:assert/strict'
import {supplierCaption,runSupplierBatch} from '../lib/rfq-batch.mjs'

test('batch captures only chosen recipients, deduplicates IDs and continues after a definite failure',async()=>{
 const calls=[],states=[],jobs=[{supplierId:'one'},{supplierId:'two'},{supplierId:'two'},{supplierId:'three'}]
 let running=0
 const results=await runSupplierBatch(jobs,async job=>{
  assert.equal(++running,1,'Recipients are sent sequentially')
  calls.push(job.supplierId);await new Promise(r=>setTimeout(r,1));running--
  if(job.supplierId==='two')throw new Error('Definite rejection')
  return {status:'accepted'}
 },{onResult:r=>states.push(r.status)})
 assert.deepEqual(calls,['one','two','three'])
 assert.deepEqual(states,['accepted','failed','accepted'])
 assert.equal(results.length,3);assert.equal(jobs.length,4)
})
test('unknown results halt the queue and cannot silently be retried',async()=>{
 const calls=[]
 const results=await runSupplierBatch([{supplierId:'one'},{supplierId:'two'}],async job=>{calls.push(job.supplierId);return {status:'unknown'}})
 assert.deepEqual(calls,['one']);assert.deepEqual(results.map(r=>r.status),['unknown','not_attempted'])
})
test('leaving the RFQ stops remaining recipients without pretending they were sent',async()=>{
 const results=await runSupplierBatch([{supplierId:'one'}],()=>assert.fail('Must not send'),{shouldStop:()=>true})
 assert.equal(results[0].status,'not_attempted')
})
test('supplier captions fill names and dates, normalize line breaks and reject empty or oversized text',()=>{
 assert.equal(supplierCaption('Hi {supplier_name}\\n{rfq_number} · {due_date}',{rfq_no:'RFQ-3',due_date:'2026-11-01'},{name:'Supplier three'}),'Hi Supplier three\nRFQ-3 · 2026-11-01')
 assert.throws(()=>supplierCaption(' ',{},{}));assert.throws(()=>supplierCaption('x'.repeat(2001),{},{}))
})
