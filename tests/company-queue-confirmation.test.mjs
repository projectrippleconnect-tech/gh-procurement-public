import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const controls=readFileSync('components/company-controls.jsx','utf8')
const queue=controls.slice(controls.indexOf('<summary>Automatic RFQ / PO sending'),controls.lastIndexOf('</details>'))

test('company-wide WhatsApp queue processing uses one guarded confirmation per type',()=>{
 assert.match(controls,/import \{useDangerConfirmation\} from '\.\/danger-confirmation'/)
 assert.match(controls,/const confirmQueue=useDangerConfirmation\(\)/)
 assert.match(queue,/Send pending PO queue \(all categories\)/)
 assert.match(queue,/Send pending RFQ queue \(all categories\)/)
 assert.equal((queue.match(/onClick=\{\(\)=>confirmQueue\(/g)||[]).length,2)
 assert.doesNotMatch(queue,/>Process approved company orders</)
 assert.doesNotMatch(queue,/>Process queued RFQ images</)
})

test('queue confirmation states true sending scope and distinguishes acceptance from delivery',()=>{
 assert.match(queue,/This contacts real suppliers through WhatsApp/)
 assert.match(queue,/not only a currently selected category/)
 assert.match(queue,/across categories, not just one selected RFQ/)
 assert.match(queue,/Gateway acceptance does not prove message delivery/)
 assert.match(queue,/Confirm any uncertain send attempts/)
 assert.match(queue,/Existing accepted and unknown outcomes are not retried automatically/)
})

test('queue dispatch is invoked only from the confirmation callback, never from rendering or loading',()=>{
 const po=queue.indexOf("companyApi('orders',{companyId:company.id})")
 const rfq=queue.indexOf("companyApi('rfqs',{companyId:company.id})")
 assert.ok(po>=0&&rfq>po)
 assert.ok(queue.lastIndexOf("onConfirm:()=>run",po)>=0)
 assert.ok(queue.lastIndexOf("onConfirm:()=>run",rfq)>=0)
 assert.match(queue,/confirmLabel:'Send eligible queued POs'/)
 assert.match(queue,/confirmLabel:'Send eligible queued RFQs'/)
 assert.match(controls,/\{admin&&<><details className="section"><summary>Automatic RFQ \/ PO sending/)
})
