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
test('quantity-only company orders never disclose invented zero prices and retain variations',()=>{
 const po={...args.po,quantity_only:true};const lines=[{...args.lines[0],item:{...args.lines[0].item,colour:'Blue',variation:'Model A'}}]
 const selection=Object.fromEntries(Object.keys(defaultPoShareFields()).map(k=>[k,true]))
 const model=purchaseOrderShareModel({...args,po,lines,selection})
 assert.equal(model.total,null);assert.ok(!model.columns.some(c=>['unit_price','line_total','tax_percent','discount_percent'].includes(c.key)));assert.match(model.rows[0][0],/Blue.*Model A/)
})

test('direct company PO exports identify RFQ bypass and unit rates even when financial fields are hidden',()=>{
 const po={...args.po,company_id:'company-test',quantity_only:true};
 const m=purchaseOrderShareModel({...args,po});
 const rate=m.columns.findIndex(c=>c.key==='unit_price');
 assert.equal(m.columns[rate].label,'Unit Rate');assert.equal(m.rows[0][rate],'Direct PO');
 assert.equal(m.total,null);assert.ok(m.meta.some(([k,v])=>v==='Direct PO — RFQ bypassed'));
 assert.doesNotMatch(buildPurchaseOrderText({...args,po}),/235|705/);
 assert.match(buildPurchaseOrderText({...args,po}),/Unit Rate: Direct PO/);
})
