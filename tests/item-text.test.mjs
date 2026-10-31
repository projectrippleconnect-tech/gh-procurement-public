import test from 'node:test'
import assert from 'node:assert/strict'
import {uppercaseItemText,normalizeItemText,uppercaseItemAttributes} from '../lib/item-text.mjs'
import {indexStockItems,searchStockItems,stockItemLabel} from '../lib/stock-search.mjs'
import {companyCompactMeta} from '../lib/company-items.mjs'

test('lowercase item entry is normalized when saving',()=>{
 assert.equal(uppercaseItemText('concrete nails 2"'),'CONCRETE NAILS 2"')
 assert.equal(normalizeItemText('  gi   elbow  3/4 inch  '),'GI ELBOW 3/4 INCH')
 assert.equal(normalizeItemText('සිමෙන්ති தமிழ் abc'),'සිමෙන්ති தமிழ் ABC')
 const item=uppercaseItemAttributes({
  description:'concrete nails',main_group:'fasteners',subgroup:'nails',
  category:'general',size:'2 inch',brand:'abc',colour:'black',
  variation:'large',uom:'pcs',remarks:'zinc coated',
  item_code:'gh-lower-001',max_stock:10,reorder_level:5
 })
 for(const [key,expected] of Object.entries({
  description:'CONCRETE NAILS',main_group:'FASTENERS',subgroup:'NAILS',
  category:'GENERAL',size:'2 INCH',brand:'ABC',colour:'BLACK',
  variation:'LARGE',uom:'PCS',remarks:'ZINC COATED'
 }))assert.equal(item[key],expected)
 assert.equal(item.item_code,'gh-lower-001')
 assert.equal(item.max_stock,10)
 assert.equal(item.reorder_level,5)
})

test('uppercase presentation does not change existing database item or case-insensitive searches',()=>{
 const original={id:'1',description:'Concrete nails',size:'2 inch',category:'GENERAL'}
 const rows=indexStockItems([original,{id:'2',description:'Copper Wire'}])
 assert.deepEqual(searchStockItems(rows,'concrete').map(x=>x.item_id),['1'])
 assert.deepEqual(searchStockItems(rows,'CONCRETE').map(x=>x.item_id),['1'])
 assert.equal(uppercaseItemText(stockItemLabel(original)),'CONCRETE NAILS · 2 INCH')
 assert.equal(original.description,'Concrete nails')
})

test('company item metadata shows uppercase but keeps quantities independent',()=>{
 const meta=companyCompactMeta({description:'gi nut',brand:'sample',size:'1/2',uom:'pcs',colour:'silver'})
 assert.deepEqual(meta.map(x=>x.value),['1/2','SILVER','SAMPLE','PCS'])
})
