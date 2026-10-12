import test from 'node:test'
import assert from 'node:assert/strict'
import {additionalSizeLines,encodeSupplierQuoteNotes,decodeSupplierQuoteNotes,validateSupplierQuoteVariants} from '../lib/quote-line-notes.js'
test('additional sizes keep quantities through drafts and become separate requested lines',()=>{
 const sizes=[{size:'2 ft',price:'40',order_qty:'6',remarks:'Cycle lock'}]
 const restored=decodeSupplierQuoteNotes(encodeSupplierQuoteNotes({variants:sizes})).variants
 assert.equal(restored[0].order_qty,'6')
 const lines=additionalSizeLines([{id:'parent'}],{parent:{variants:[...restored,{size:'3 ft',price:'50',order_qty:''}]}})
 assert.deepEqual(lines,[{source_rfq_item_id:'parent',size:'2 ft',unit_price:40,qty:6,remarks:'Cycle lock'}])
 assert.equal(lines[0].qty*lines[0].unit_price,240)
})
test('required quantities reject invalid inputs and old reference sizes still load',()=>{
 for(const order_qty of ['0','-6','Infinity','NaN','six'])assert.equal(validateSupplierQuoteVariants([{size:'2 ft',price:'40',order_qty}]),false)
 assert.equal(validateSupplierQuoteVariants([{size:'2 ft',price:'40',order_qty:'0.5'}]),true)
 assert.equal(decodeSupplierQuoteNotes('GH_QUOTE_NOTES_V1:{"variants":[{"size":"2 ft","price":"40"}]}').variants[0].order_qty,'')
 assert.equal(validateSupplierQuoteVariants([{size:'2 ft',price:'40'}]),true)
})
