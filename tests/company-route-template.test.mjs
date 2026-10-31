import test from 'node:test'
import assert from 'node:assert/strict'
import {routeTemplate,routeCaption,routeImageModel,defaultRouteTemplate,switchRouteTemplate} from '../lib/company-route-template.mjs'
const base={po_no:'PO-7',company:'Company',supplier:'Sales rep',lines:[{description:'Pipe',size:'25mm',qty:12,uom:'PCS',remarks:'Blue only'}]}
test('saved automatic image templates control heading, optional columns, note and caption',()=>{
 const job={...base,template:{name:'General Ceramics',title:'ORDER REQUEST',note:'Deliver to No.77',caption:'{company_name} | {supplier_name} | {po_number}',fields:{rate:false,uom:false,no:false,remarks:false}}}
 const m=routeImageModel(job)
 assert.equal(m.heading,'General Ceramics — ORDER REQUEST');assert.match(m.template.note,/Direct PO.*RFQ bypassed.*Deliver to No.77/)
 assert.deepEqual(m.lines,[{index:null,description:'Pipe · 25mm',qty:'12',rate:'Direct PO'}])
 assert.equal(routeCaption(job),'General Ceramics | Sales rep | PO-7')
})
test('RFQ defaults show a blank unit rate and preserve quantity and remarks',()=>{
 const m=routeImageModel({...base,kind:'rfq'})
 assert.equal(m.lines[0].rate,'________');assert.equal(m.lines[0].qty,'12 PCS');assert.match(m.lines[0].description,/Blue only/)
 assert.match(routeCaption({...base,kind:'rfq',rfq_no:'RFQ-5'}),/RFQ: RFQ-5/)
})
test('direct POs always identify bypassed rates without inventing prices',()=>{
 assert.equal(routeImageModel(base).lines[0].rate,'Direct PO')
 assert.match(routeImageModel(base).template.note,/RFQ bypassed/)
 assert.equal(routeImageModel({...base,template:{fields:{rate:false}}}).lines[0].rate,'Direct PO')
})
test('template defaults and limits prevent invalid sender data',()=>{
 assert.equal(routeTemplate({name:''}).name,'General Hardware')
 assert.throws(()=>routeTemplate({name:'x'.repeat(81)}),/Invalid/)
 assert.throws(()=>routeTemplate({caption:42}),/Invalid/)
})

test('changing automation mode updates standard document wording and preserves custom branding',()=>{
 const rfq={...defaultRouteTemplate('rfq'),name:'Our company'}
 const po=switchRouteTemplate(rfq,'rfq','direct')
 assert.equal(po.title,'PURCHASE ORDER')
 assert.match(po.caption,/PO: \{po_number\}/)
 assert.doesNotMatch(po.caption,/rfq_number|Supplier Price Request/)
 assert.equal(po.name,'Our company')
 assert.equal(switchRouteTemplate({...rfq,note:'Deliver to warehouse'},'rfq','direct').note,'Deliver to warehouse')
 assert.deepEqual(switchRouteTemplate({},'rfq','direct'),{})
 assert.equal(switchRouteTemplate(po,'direct','rfq').title,'REQUEST FOR QUOTATION')
})
