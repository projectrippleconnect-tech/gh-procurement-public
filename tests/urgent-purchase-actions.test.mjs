import test from 'node:test'
import assert from 'node:assert/strict'
import {urgentPurchaseSteps} from '../lib/procurement-flow.js'
const allow=()=>true
const row={id:'item-need',approval_status:'approved',remaining_to_order:6,has_active_rfq:false}
test('urgent quoting item opens its existing RFQ without suggesting a duplicate',()=>{
 const data={requests:[{rfq_id:'rfq-1',rfq:{rfq_no:'001',status:'sent'}}]}
 const steps=urgentPurchaseSteps(row,data,allow)
 assert.deepEqual(steps.map(s=>[s.view,s.id]),[['rfq','rfq-1']])
 assert.match(steps[0].label,/Enter prices/)
})
test('prepared RFQ, quoted RFQ and approved PO lead to sending, comparison and PO sending',()=>{
 for(const [status,label] of [['prepared',/send RFQ/],['quoted',/Compare prices/]]){
  const steps=urgentPurchaseSteps(row,{requests:[{rfq_id:'r',rfq:{status,rfq_no:'001'}}]},allow)
  assert.match(steps[0].label,label)
 }
 const steps=urgentPurchaseSteps({...row,remaining_to_order:0},{orders:[{po_id:'p',po:{status:'approved',po_no:'002'}}]},allow)
 assert.deepEqual(steps.map(s=>[s.view,s.id]),[['po','p']]);assert.match(steps[0].label,/Send PO/)
})
test('pending review and uncovered requirements open the exact requirement',()=>{
 assert.deepEqual(urgentPurchaseSteps({...row,approval_status:'pending_review'},{},allow).map(s=>[s.id,s.step]),[['requirement:item-need',2]])
 assert.deepEqual(urgentPurchaseSteps(row,{},allow).map(s=>[s.id,s.step]),[['requirement:item-need',3]])
 assert.deepEqual(urgentPurchaseSteps({...row,has_active_rfq:true},{},allow),[])
})
test('actions respect access, deduplicate document links and exclude cancelled orders',()=>{
 assert.deepEqual(urgentPurchaseSteps(row,{},()=>false),[])
 const request={rfq_id:'r',rfq:{status:'sent',rfq_no:'001'}}
 assert.equal(urgentPurchaseSteps(row,{requests:[request,request],orders:[{po_id:'p',po:{status:'cancelled'}}]},allow).length,1)
 assert.equal(urgentPurchaseSteps({...row,remaining_to_order:0},{requests:[{rfq_id:'r',rfq:{status:'closed'}}]},allow).length,0)
})
