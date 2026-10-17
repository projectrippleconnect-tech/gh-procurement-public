import test from 'node:test'
import assert from 'node:assert/strict'
import {receiptReview,rejectionNextAction,pendingReceiptOrderIds} from '../lib/receiving-guidance.mjs'
import {deliveryProgress} from '../lib/delivery-progress.mjs'
test('receipt review keeps rejected quantities outside accepted stock and outstanding balance',()=>{
 const rows=receiptReview([{id:'a',qty:10,cancelled_qty:1,item:{uom:'PCS'},grn:[{accepted_qty:2,receipt:{status:'posted'}},{accepted_qty:99,receipt:{status:'draft'}}]}],[{po_line_id:'a',received_qty:5,accepted_qty:4,rejected_qty:1}])
 assert.equal(rows[0].remaining,3);assert.equal(rows[0].accepted_qty,4);assert.equal(rows[0].rejected_qty,1)
})
test('follow-up suggests the outcome for an already requested replacement or credit',()=>{
 assert.equal(rejectionNextAction('replacement_due'),'replacement_received')
 assert.equal(rejectionNextAction('credit_note_due'),'credit_note_received')
 assert.equal(rejectionNextAction('returned'),'replacement_requested')
})
test('one over-settled line cannot hide another outstanding line',()=>{
 const p=deliveryProgress([{qty:10,cancelled_qty:5,grn:[{accepted_qty:10,receipt:{status:'posted'}}]},{qty:10,grn:[]}])
 assert.equal(p.remaining,10);assert.equal(p.remainingLines,1);assert.equal(p.percent,50)
})

test('uncertain attempts are discoverable after the order leaves the delivery queue',()=>{
 const id='00000000-0000-4000-8000-000000000007'
 const rows=new Map([['gh_receiving_draft_v1:owner:'+id,JSON.stringify({receiptKey:'saved',attempt:{lines:[{accepted_qty:10}]}})],['gh_receiving_draft_v1:other:00000000-0000-4000-8000-000000000008',JSON.stringify({receiptKey:'other',attempt:{lines:[{}]}})],['gh_receiving_draft_v1:owner:00000000-0000-4000-8000-000000000009',JSON.stringify({vals:{},attempt:null})],['gh_receiving_draft_v1:owner:invalid','broken']])
 const storage={length:rows.size,key:n=>[...rows.keys()][n],getItem:k=>rows.get(k)}
 assert.deepEqual(pendingReceiptOrderIds(storage,'owner'),[id])
})
