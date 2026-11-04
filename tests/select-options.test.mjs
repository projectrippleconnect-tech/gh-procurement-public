import test from 'node:test'
import assert from 'node:assert/strict'
import {uniqueSelectOptions,hasFilterChoices} from '../lib/select-options.mjs'

test('pickers collapse duplicate text values while preserving the exact selection',()=>{
 const options=[{value:'BOARD ITEMS',text:'BOARD ITEMS'},{value:' board   items ',text:' board   items '},{value:'BIXTON',text:'BIXTON'}]
 const result=uniqueSelectOptions(options,' board   items ')
 assert.equal(result.length,2)
 assert.equal(result[0].value,' board   items ')
 assert.equal(options.length,3)
})
test('pickers retain distinct record IDs with identical display names',()=>{
 const options=[{value:'supplier-a',text:'SAME NAME'},{value:'supplier-b',text:'SAME NAME'}]
 assert.deepEqual(uniqueSelectOptions(options),options)
 assert.equal(uniqueSelectOptions([...options,options[0]]).length,2)
})
test('a duplicate disabled entry does not hide an available enabled choice',()=>{
 const result=uniqueSelectOptions([{value:'PCS',text:'PCS',disabled:true},{value:'PCS',text:'PCS',disabled:false}])
 assert.equal(result.length,1)
 assert.equal(result[0].disabled,false)
})
test('filters appear only when useful, with blanks and active filters preserved',()=>{
 const read=r=>r.category
 assert.equal(hasFilterChoices([],read),false)
 assert.equal(hasFilterChoices([{category:'BOARD ITEMS'},{category:'BOARD ITEMS'}],read),false)
 assert.equal(hasFilterChoices([{category:'BOARD ITEMS'},{}],read),true)
 assert.equal(hasFilterChoices([{category:'BOARD ITEMS'},{category:'OTHER'}],read),true)
 assert.equal(hasFilterChoices([],read,'BOARD ITEMS'),true)
})
