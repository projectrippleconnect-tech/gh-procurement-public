import test from 'node:test'
import assert from 'node:assert/strict'
import {matchesRfqItem,supplierRequestItems,quoteSheetRows} from '../lib/rfq-sheet.js'
import {buildSupplierQuoteReplyText} from '../lib/rfq-share.js'
const items=Array.from({length:100},(_,i)=>({id:'row-'+i,requested_qty:i+1,requirement:{item:{id:'item-'+i,description:i%2?'Bathroom tap':'Hardware bolt',category:i%2?'BATHROOM':'GENERAL',size:String(i),item_code:'CODE-'+i}}}))
test('price search finds sparse items by words, size, code and category without mutating the list',()=>{
 assert.equal(items.filter(i=>matchesRfqItem(i,'tap 99')).length,1)
 assert.equal(items.filter(i=>matchesRfqItem(i,'CODE-42')).length,1)
 assert.equal(items.filter(i=>matchesRfqItem(i,'','BATHROOM')).length,50)
 assert.equal(items.length,100)
})
test('supplier requests use coverage or a saved explicit selection; other suppliers retain their lists',()=>{
 const inv={supplier_id:'s1'},scopes=[{supplier_id:'s1',scope_type:'category',scope_value:'BATHROOM'}]
 assert.equal(supplierRequestItems(items,inv,scopes).length,50)
 const selection=supplierRequestItems(items,{...inv,requested_item_ids:['row-1','row-99']},scopes)
 assert.deepEqual(selection.map(x=>x.id),['row-1','row-99'])
 const text=buildSupplierQuoteReplyText({items:selection})
 assert.match(text,/Bathroom tap/);assert.doesNotMatch(text,/Hardware bolt/)
 assert.equal(supplierRequestItems(items,{supplier_id:'s2'},scopes).length,100)
 assert.equal(supplierRequestItems(items,{...inv,requested_item_ids:[]},scopes).length,0)
})
test('comparison includes 100 items, overlapping quotes, ties, zero prices and explicit missing rows',()=>{
 const quotes=[{rfq_item_id:'row-1',supplier_id:'s1',unit_price:10},{rfq_item_id:'row-1',supplier_id:'s2',unit_price:8},{rfq_item_id:'row-3',supplier_id:'s1',unit_price:0},{rfq_item_id:'row-3',supplier_id:'s2',unit_price:0}]
 const rows=quoteSheetRows(items,quotes)
 assert.equal(rows.length,100);assert.equal(rows[1].lowest,8);assert.equal(rows[3].lowest,0)
 assert.equal(rows[0].lowest,null)
 assert.equal(quoteSheetRows(items,quotes,'','missing').length,98)
 assert.equal(quoteSheetRows(items,quotes,'','priced').length,2)
 assert.equal(quoteSheetRows(items,quotes,'CODE-1','priced').length,1)
})

test('review removes unpriced rows without reselecting deliberate exclusions',async()=>{
 const {pricedReviewSelection}=await import('../lib/rfq-sheet.js')
 const input=[{id:'a',selected_for_po:true},{id:'b',selected_for_po:false},{id:'c',selected_for_po:true}]
 const quotes=[{rfq_item_id:'a'},{rfq_item_id:'b'}]
 assert.deepEqual(pricedReviewSelection(input,quotes).map(x=>x.selected_for_po),[true,false,false])
 assert.deepEqual(pricedReviewSelection(input,quotes,true).map(x=>x.selected_for_po),[true,true,false])
 assert.equal(input[2].selected_for_po,true,'The helper does not mutate stored selections')
})
