import test from 'node:test'
import assert from 'node:assert/strict'
import {receiptRows,reviewedReceipt} from '../lib/document-review.mjs'
const lines=[{id:'a',item:{item_code:'CY-2',description:'Cycle Lock',size:'2 ft'}},{id:'b',item:{item_code:'CY-3',description:'Cycle Lock',size:'3 ft'}}]
test('GRN OCR distinguishes size variants and does not interpret prices as quantities',()=>{
 const rows=receiptRows('CY-2 Cycle Lock 2 ft Qty: 6 LKR 240.00\nCycle Lock 3 ft 4 PCS 160.00\nTotal 400.00',lines)
 assert.equal(rows.length,2)
 assert.deepEqual(rows.map(r=>[r.lineId,r.qty,r.selected]),[['a','6',false],['b','4',false]])
 const priceOnly=receiptRows('CY-2 Cycle Lock 2 ft LKR 240.00',lines)
 assert.equal(priceOnly[0].qty,'')
})
test('OCR never auto-matches an ambiguous item without a size',()=>{
 const ambiguous=receiptRows('Cycle Lock Qty 6',lines)
 assert.equal(ambiguous[0].lineId,'')
 assert.equal(ambiguous[0].selected,false)
})
test('reviewed receipts reject unmapped, duplicate, negative and invalid quantities',()=>{
 const row={selected:true,lineId:'a',qty:'6'}
 assert.deepEqual(reviewedReceipt([row],lines),[{lineId:'a',received:'6'}])
 for(const qty of ['','-1','0','NaN','Infinity'])assert.throws(()=>reviewedReceipt([{...row,qty}],lines))
 assert.throws(()=>reviewedReceipt([row,{...row}],lines),/Combine/)
 assert.throws(()=>reviewedReceipt([{...row,lineId:'unknown'}],lines),/Choose/)
 assert.throws(()=>reviewedReceipt([{...row,selected:false}],lines),/Select/)
})
