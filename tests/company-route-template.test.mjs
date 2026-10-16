import test from 'node:test'
import assert from 'node:assert/strict'
import {routeTemplate,routeCaption,routeImageModel} from '../lib/company-route-template.mjs'
const base={po_no:'PO-7',company:'Company',supplier:'Sales rep',lines:[{description:'Pipe',size:'25mm',qty:12,uom:'PCS',remarks:'Blue only'}]}
test('saved automatic image templates control heading, optional columns, note and caption',()=>{
 const job={...base,template:{name:'General Ceramics',title:'ORDER REQUEST',note:'Deliver to No.77',caption:'{company_name} | {supplier_name} | {po_number}',fields:{rate:false,uom:false,no:false,remarks:false}}}
 const m=routeImageModel(job)
 assert.equal(m.heading,'General Ceramics — ORDER REQUEST');assert.equal(m.template.note,'Deliver to No.77')
 assert.deepEqual(m.lines,[{index:null,description:'Pipe · 25mm',qty:'12',rate:null}])
 assert.equal(routeCaption(job),'General Ceramics | Sales rep | PO-7')
})
test('RFQ defaults show a blank unit rate and preserve quantity and remarks',()=>{
 const m=routeImageModel({...base,kind:'rfq'})
 assert.equal(m.lines[0].rate,'________');assert.equal(m.lines[0].qty,'12 PCS');assert.match(m.lines[0].description,/Blue only/)
 assert.match(routeCaption({...base,kind:'rfq',rfq_no:'RFQ-5'}),/RFQ: RFQ-5/)
})
test('PO rates are optional blanks, never invented prices',()=>{
 assert.equal(routeImageModel(base).lines[0].rate,null)
 assert.equal(routeImageModel({...base,template:{fields:{rate:true}}}).lines[0].rate,'________')
})
test('template defaults and limits prevent invalid sender data',()=>{
 assert.equal(routeTemplate({name:''}).name,'General Hardware')
 assert.throws(()=>routeTemplate({name:'x'.repeat(81)}),/Invalid/)
 assert.throws(()=>routeTemplate({caption:42}),/Invalid/)
})
