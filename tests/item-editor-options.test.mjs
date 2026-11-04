import test from 'node:test'
import assert from 'node:assert/strict'
import {itemOptionValues,updateItemGrouping} from '../lib/item-editor-options.mjs'

test('option lists deduplicate without changing stored labels',()=>{
 assert.deepEqual(itemOptionValues(['BATHROOM','GENERAL','general',''],['Electrical','bathroom'],null),['BATHROOM','Electrical','GENERAL'])
})
test('changing category invalidates old groups, but not item identity, movement or stock',()=>{
 const old={id:'stable',category:'GENERAL',main_group:'ROOFING',subgroup:'SHEETS',movement:'FAST',max_stock:50}
 assert.deepEqual(updateItemGrouping(old,'category','BATHROOM'),{...old,category:'BATHROOM',main_group:'',subgroup:''})
 assert.deepEqual(old.main_group,'ROOFING')
})
test('changing main group clears only child; choosing same parent preserves selection',()=>{
 const old={category:'GENERAL',main_group:'ROOFING',subgroup:'SHEETS',uom:'PCS'}
 assert.equal(updateItemGrouping(old,'main_group','PLUMBING').subgroup,'')
 assert.equal(updateItemGrouping(old,'main_group','ROOFING').subgroup,'SHEETS')
 assert.equal(updateItemGrouping(old,'subgroup','TILES').main_group,'ROOFING')
})
