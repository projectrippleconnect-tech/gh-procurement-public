import test from 'node:test'
import assert from 'node:assert/strict'
import {SUFFICIENT_STOCK,matchesStockSearch,stockSubmissionLine} from '../lib/stock-entry.mjs'
import {normalizeQuantityDraft} from '../lib/quantity-input.mjs'
import {stockCountBatch} from '../lib/stock-batch.mjs'

test('shelf search includes every movement and variation but excludes unrelated items',()=>{
 const items=[{description:'Concrete Nails',size:'1 inch',movement:'FAST'},{description:'Concrete nails',size:'2 inch',movement:'NORMAL'},{description:'Nails concrete',size:'3 inch',movement:'SLOW'},{description:'Wire nails',movement:'FAST'}]
 assert.equal(items.filter(i=>matchesStockSearch(i,'CONCRETE nails')).length,3)
 assert.equal(items.filter(i=>matchesStockSearch(i,' concrete   nails 2 ')).length,1)
 assert.equal(items.filter(i=>matchesStockSearch(i,'')).length,4)
 assert.equal(matchesStockSearch({description:'Shelf bracket',size:'8-inch'},'shelf bracket 8-inch'),true)
})
test('visual check survives draft restoration and submits without an invented quantity',()=>{
 const restored=normalizeQuantityDraft(JSON.parse(JSON.stringify({visual:SUFFICIENT_STOCK,counted:'04',untouched:''})))
 assert.equal(restored.visual,SUFFICIENT_STOCK)
 const batch=stockCountBatch(restored)
 assert.deepEqual(batch.checked.map(([id,value])=>stockSubmissionLine(id,value)),[{item_id:'visual',sufficient_stock:true},{item_id:'counted',current_stock:4}])
})
