import test from 'node:test'
import assert from 'node:assert/strict'
import {defaultPoShareFields,resolvePoShareFields,purchaseOrderShareModel,buildPurchaseOrderText,buildPurchaseOrderCaption} from '../lib/po-share.js'
const args={po:{po_no:'PO-TEST',supplier:{name:'Supplier'},total:705,terms:'Cash'},lines:[{item:{description:'Bench vice',size:'4 inch',uom:'PCS',item_code:'GEN-1'},qty:3,unit_price:235,discount_percent:5,tax_percent:10,line_total:705}],company:{name:'General Hardware'}}
test('supplier PO defaults disclose only four item fields and no financial values',()=>{
 const m=purchaseOrderShareModel(args)
 assert.deepEqual(m.columns.map(c=>c.key),['description','size','uom','qty'])
 assert.deepEqual(m.rows,[['Bench vice','4 inch','PCS','3']]);assert.equal(m.total,null)
 const text=buildPurchaseOrderText(args);assert.doesNotMatch(text,/235|705|Discount|Tax|Unit price|Line total|Cash/)
 assert.match(buildPurchaseOrderCaption(args),/PO-TEST/)
})
test('explicit field selections control every supplier output without mutating orders',()=>{
 const selection={...defaultPoShareFields(),size:false,unit_price:true,total:true,terms:true}
 const before=JSON.stringify(args),m=purchaseOrderShareModel({...args,selection})
 assert.deepEqual(m.columns.map(c=>c.key),['description','uom','qty','unit_price'])
 assert.equal(m.total,'LKR 705.00');assert.ok(m.meta.some(r=>r[1]==='Cash'))
 assert.match(buildPurchaseOrderText({...args,selection}),/235.00/);assert.doesNotMatch(buildPurchaseOrderText({...args,selection}),/4 inch/)
 assert.equal(JSON.stringify(args),before)
 assert.deepEqual(resolvePoShareFields({qty:'false',unexpected:true}),defaultPoShareFields())
})
test('empty fields or unavailable lines cannot generate misleading supplier documents',()=>{
 assert.throws(()=>purchaseOrderShareModel({...args,selection:Object.fromEntries(Object.keys(defaultPoShareFields()).map(k=>[k,false]))}),/at least one/)
 assert.throws(()=>purchaseOrderShareModel({...args,lines:[]}),/loading or unavailable/)
})
