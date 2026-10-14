import test from 'node:test'
import assert from 'node:assert/strict'
import {indexStockItems,searchStockItems} from '../lib/stock-search.mjs'
const rows=indexStockItems([{id:'1',description:'Concrete nails',category:'GENERAL',movement:'FAST',size:'2 inch'},{id:'2',description:'Copper wire',category:'ELECTRICAL',movement:'SLOW'},{id:'3',description:'Concrete drill',category:'GENERAL',movement:'SLOW'}])
test('results narrow from the first character through each keystroke',()=>{
 assert.equal(searchStockItems(rows,'c').length,3)
 assert.equal(searchStockItems(rows,'co').length,3)
 for(const query of ['con','conc','concr','CONCRETE'])assert.deepEqual(searchStockItems(rows,query).map(x=>x.item_id),['1','3'])
 assert.deepEqual(searchStockItems(rows,'concrete 2').map(x=>x.item_id),['1'])
 assert.equal(searchStockItems(rows,'').length,0)
})
test('filters and result limit are respected',()=>{
 assert.deepEqual(searchStockItems(rows,'c',{movement:'FAST'}).map(x=>x.item_id),['1'])
 assert.deepEqual(searchStockItems(rows,'c',{category:'ELECTRICAL'}).map(x=>x.item_id),['2'])
 assert.equal(searchStockItems(rows,'c',{},1).length,1)
})
test('large catalogue filters within a frame-sized budget',()=>{
 const large=indexStockItems(Array.from({length:20000},(_,id)=>({id:String(id),description:id%200===0?'Concrete nails':'Shelf bracket'})))
 const start=performance.now()
 for(const query of ['c','co','con','conc','concr'])assert.equal(searchStockItems(large,query).length,30)
 assert.ok(performance.now()-start<100,'Five searches should complete within 100ms')
})
