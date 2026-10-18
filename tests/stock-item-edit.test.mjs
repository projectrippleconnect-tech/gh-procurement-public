import test from 'node:test'
import assert from 'node:assert/strict'
import {stockItemEditPatch} from '../lib/stock-item-edit.mjs'

const original={
 description:'AMANO REGIN GREEN',category:'GENERAL',main_group:'ROOFING',
 subgroup:'',brand:'AMAN0',size:'2',uom:'ROLL',movement:'FAST',max_stock:20,remarks:''
}
test('long-press editing sends changed name and movement without stock quantity or item identity',()=>{
 const patch=stockItemEditPatch(original,{...original,description:'AMAN0 REGIN GREEN',movement:'NORMAL',current_stock:999,item_id:'fake'})
 assert.deepEqual(patch,{description:'AMAN0 REGIN GREEN',movement:'NORMAL'})
})
test('unchanged item produces no writes',()=>{
 assert.deepEqual(stockItemEditPatch(original,{...original,max_stock:'20'}),{})
})
test('valid max stock is numeric and can be zero',()=>{
 assert.deepEqual(stockItemEditPatch(original,{...original,max_stock:'0'}),{max_stock:0})
})
test('empty item name, missing UOM, bad movement and invalid max stock are rejected',()=>{
 for(const changes of [{description:''},{uom:' '},{movement:'INVALID'},{max_stock:'-1'},{max_stock:'NaN'}]){
  assert.throws(()=>stockItemEditPatch(original,{...original,...changes}))
 }
})
test('removing optional fields is possible without touching unrelated fields',()=>{
 assert.deepEqual(stockItemEditPatch(original,{...original,main_group:''}),{main_group:''})
})
